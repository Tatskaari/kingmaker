import { deciderFor, type ChoiceQuestion, type Decider } from "../llm/decide.ts";
import { modelOffline, respond, type RespondRequest } from "../llm/openrouter.ts";
import { sceneById, SCENES, ZOO_SCENES } from "../../scenes/index.ts";
import { sceneApproach } from "./approaches.ts";
import { currentBeat, effectiveScene, IMPROVISED_EXIT_ID, nameTokens, presentCast, prompt, sceneEntries, scriptTranscript, spentHere, unnamed } from "./brief.ts";
import { titleCase } from "./dice.ts";
import type { TurnHooks } from "./engine.ts";
import type { Character, Scene, Transition } from "./scene.ts";
import type { SessionState, Suggestion } from "./session.ts";
import type { Entity } from "../world/scene-world.ts";

/**
 * What the player might say or do next in a scene, as a cRPG offers its dialogue choices: after a GM
 * reply (an opening, a turn's, a fight's aftermath), one small call proposes three to five lines in
 * the player character's own voice, a mix of kinds:
 * - something to say;
 * - a deed in brackets;
 * - a risky try that would call for a roll, worded the way the decider reads one ("(I try to talk the
 *   boy round with a promise...)": an attempt, how, and what for);
 * - a way to leave, when one fits.
 * A word with a companion has its own (src/runtime/talk.ts).
 *
 * Off the critical path: started once the reply is in, alongside the after-reply work, and never
 * waited for. They're the session's when they come (`suggestions`, for that scene and turn only, so a
 * line said meanwhile leaves them behind), and the hooks say so (onSuggestions).
 *
 * What they're grounded in: what the player knows and nothing else. Their character (concept, build,
 * spells, what they carry, backstory), what they came in knowing, and the scene as they've seen it:
 * who's here now by the names they know, what's come out, the last few exchanges as they read them.
 * Never the GM's prep: given it "behind the screen" to choose threads by, the call put its answers in
 * the player's mouth (Hobb's mother, the Heron's river door, the dog's name, before the story had
 * them), so a line asks the question and never gives the answer.
 *
 * Vetted before they're offered: first by what can be read off the words (`screen`: the player's own
 * words and deeds only, none of the GM's markup, nothing they haven't met, a name, a place or a
 * thing, nobody who isn't here, nothing the scene's limits name, nothing just said or offered last
 * time), then by the GM's own judge, the session's decider, given every fact with its status (`judge`:
 * does a line give away or take for granted what's held, fall behind the story, reach for what the
 * scene can't offer, or decide for someone else; would a risky try really take a roll), then a mix of
 * kinds (`mix`). The call and the judge take about two and a half seconds between them, and the stage
 * manager about four and a half: the lines are there before the turn is.
 *
 * The call is given the replies as the player reads them (each entry's `text`), never the GM's
 * markup (src/runtime/markup.ts: who says each line, the notes on its marks), which only the GM's
 * own history puts back; and a line that comes back with any (`screen`) isn't offered. At no
 * reasoning effort its text comes back with noise now and then (another script, two lines run
 * together, its own planning), which `parseSuggestions` cleans away or leaves out.
 */

/** The kinds, in the order they're listed. */
const KINDS: Array<Suggestion["kind"]> = ["say", "do", "try", "leave"];

/** One in flight per session: a later reply's takes over from an earlier one's. */
const inFlight = new WeakMap<SessionState, { controller: AbortController; done: Promise<void> }>();

/** The lines for this moment: made for the scene and turn the session is at, or none. */
export function currentSuggestions(state: SessionState): Suggestion[] {
  const s = state.suggestions;
  return s && s.scene === state.sceneId && s.turn === state.turn && !state.ended && !state.talk ? s.lines : [];
}

/** Lines for this moment are still coming. */
export const suggesting = (state: SessionState): boolean => inFlight.has(state);

/** Settles once the lines in flight have come, or given up (the QA console waits for them before it lists the choices). */
export const suggested = (state: SessionState): Promise<void> => inFlight.get(state)?.done ?? Promise.resolve();

/** Stop waiting for them: the scene is over, or they've been turned off. */
export function stopSuggesting(state: SessionState): void {
  inFlight.get(state)?.controller.abort();
  inFlight.delete(state);
}

/**
 * Start on the lines for this moment, from the reply just given. Nothing waits for them: they're the
 * session's when they come, if it's still at the same scene and turn, and then onSuggestions says so.
 * One that fails leaves none for this moment (and says so too).
 */
export function startSuggesting(state: SessionState, hooks: Pick<TurnHooks, "onSuggestions"> = {}): void {
  stopSuggesting(state);
  if (state.ended || state.talk || modelOffline()) return;
  const at = { scene: state.sceneId, turn: state.turn };
  const controller = new AbortController();
  const started = performance.now();
  const land = (lines: Suggestion[], costUsd: number) => {
    if (inFlight.get(state)?.controller === controller) inFlight.delete(state);
    if (controller.signal.aborted || state.sceneId !== at.scene || state.turn !== at.turn || state.ended) return;
    state.suggestions = { ...at, lines, ms: Math.round(performance.now() - started), costUsd };
    hooks.onSuggestions?.();
  };
  const done = propose(state, { signal: controller.signal }).then(made => land(made.lines, made.costUsd), () => land([], 0));
  inFlight.set(state, { controller, done });
}

/** What the lines came to: those kept, those dropped and why, and the calls' text, cost and time (the model's and the judge's). */
export interface Proposed { lines: Suggestion[]; dropped: Array<{ text: string; why: string }>; text: string; costUsd: number; latencyMs: number; judgeMs?: number }

/** A model to ask: OpenRouter's, or a test's stand-in. */
export type Ask = (request: RespondRequest) => Promise<{ text: string; costUsd: number; latencyMs: number; cutShort?: boolean }>;

/**
 * The lines for this moment: one call for them, then vetted, first by what can be read off the
 * words (screen), then by the GM's own judge, the session's decider (judge), then the mix.
 */
export async function propose(state: SessionState, options: { signal?: AbortSignal; ask?: Ask; decider?: Decider } = {}): Promise<Proposed> {
  const scene = effectiveScene(sceneById(state.sceneId), state.patches);
  // Plain lines, not JSON: structured output costs about a second more (the talk's lines found so).
  const result = await (options.ask ?? respond)({
    // Six lines take about 120 tokens: a cap just over that bounds a reply that goes on thinking aloud, or says it all twice.
    operation: "scene.suggest", effort: "none", maxOutputTokens: 150, asFarAsItGot: true,
    instructions: prompt("suggest"),
    input: [{ role: "user", content: suggestionBrief(scene, state) }],
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const v = vetting(scene, state);
  // Cut short, its last line may be half a line: it goes.
  const screened = screen(parseSuggestions(result.text, { cutShort: !!result.cutShort }), v);
  const judged = await judge(scene, state, screened.kept, options.decider ?? deciderFor(sceneApproach(state, scene).decider)).catch(() => undefined);
  const mixed = mix(judged?.lines ?? screened.kept, v.leave);
  return {
    lines: mixed.lines, dropped: [...screened.dropped, ...(judged?.dropped ?? []), ...mixed.dropped], text: result.text,
    costUsd: result.costUsd + (judged?.costUsd ?? 0), latencyMs: result.latencyMs, ...(judged ? { judgeMs: Math.round(judged.latencyMs) } : {}),
  };
}

/** The judge's verdicts on a line: fit to offer (two ways), or why not. */
const VERDICTS: Record<string, string> = {
  fine: "Fit to offer: everything it names or takes for granted is in what_the_player_knows (or a fair guess from it), it fits what_is_true_now, it's the player's own words or deeds, and the scene can offer it.",
  asks_after: "Fit to offer: it asks about, presses on or looks into something the player hasn't been told (what someone's hiding, a name nobody has said, what happens next), without saying what it is. The question, not the answer.",
  gives_away: "It names or takes for granted something the player hasn't come across: anything in held_from_the_player that what_the_player_knows doesn't show them (a person, a name, a place, a thing, a detail of someone's looks the scene hasn't described, someone's family, fears or plans, where something is, what's going to happen). An answer they haven't been given, not a question.",
  out_of_date: "It's behind the story (what_is_true_now): it asks for something already done or settled, or something the player already has, or it reaches for someone who isn't here now.",
  ruled_out: "It reaches for something the scene can't offer (what_the_scene_cannot_offer).",
  not_theirs: "It says what someone else says, does or feels (a line for someone else to say, or one that speaks of the player by name), or how it turns out.",
};
const WHY: Record<string, string> = { gives_away: "the judge: gives away what's held", out_of_date: "the judge: out of date", ruled_out: "the judge: the scene can't offer it", not_theirs: "the judge: not the player's own" };

/**
 * A line goes when the judge is clear it's unfit (0.6 for its verdict), and when it may well give
 * away what's held (0.45, whatever's on top). Given the GM's prep as known and only "fine" to put a
 * question in, the old judge passed every leak the testers found, with "fine" on top and gives_away
 * at 0.08 to 0.44. Told what's held, and with a question its own verdict (asks_after), it put the
 * six leaks among 37 lines at seven of the testers' moments (live) at 0.48 to 0.81, and the fit
 * lines at 0 to 0.37.
 */
const CLEAR = 0.6;
const GIVES_AWAY = 0.45;
/** The verdicts that let a line be offered. */
const FIT = new Set(["fine", "asks_after"]);

/**
 * The GM's own judge on the lines, in one call to the session's decider, with every fact and its
 * status: what the player knows (exactly what the lines' call was given), what's held from them (the
 * people here as the GM pictures them, what they're after and fear, what they hide, the names the
 * player hasn't heard, what the scene still needs them to come across, what nobody can see), what's
 * true now (who's here and who isn't, what the player carries), and what the scene can't offer. A
 * line that gives away or takes for granted what's held, is behind the story, reaches for what the
 * scene can't offer, or decides for someone else is dropped; a risky try that wouldn't take a roll is
 * a deed. Words alone can't tell a line that asks after a held thing from one that gives it away, or
 * see that a deed's already done; the judge can.
 */
export async function judge(scene: Scene, state: SessionState, lines: Suggestion[], decider: Decider): Promise<{ lines: Suggestion[]; dropped: Array<{ text: string; why: string }>; costUsd: number; latencyMs: number }> {
  if (!lines.length) return { lines, dropped: [], costUsd: 0, latencyMs: 0 };
  const known = (text: string) => asTheyKnowIt(text, scene, state);
  const called = unnamed(scene, state);
  const here = hereNow(scene, state);
  const nameOf = (c: Character) => called[c.id] ?? c.name;
  const v = vetting(scene, state);
  const strangers = storyCast(storyScenes(scene, state)).filter(c => c.called && nameTokens(c).every(t => v.names.includes(t)));
  const otherNames = v.names.filter(n => !strangers.some(c => nameTokens(c).includes(n)));
  const gone = scene.cast.filter(c => state.world?.entities[c.id]?.states.includes("gone"));
  const met = new Set(metHere(scene, state).map(c => c.id));
  const unseen = here.filter(c => !met.has(c.id));
  const found = foundOut(scene, state, v);
  // What changes least first (the prep), what changes every turn last (the scene so far).
  const facts = {
    held_from_the_player: [
      ...here.flatMap(c => [
        `How the GM pictures ${nameOf(c)} (the player knows only what the scene so far has described): ${known(c.look)}`,
        `${nameOf(c)} is after: ${known(c.wants)}`, ...(c.fears ? [`${nameOf(c)} fears: ${known(c.fears)}`] : []),
        ...(c.secrets ?? []).map(s => `${nameOf(c)} hides: ${known(s)}`),
      ]),
      ...(strangers.length ? [`People whose names the player hasn't heard: ${strangers.map(c => `${c.name}${c.called ? ` (to the player, "${c.called}")` : ""}`).join("; ")}.`] : []),
      ...(otherNames.length ? [`Other names the player hasn't heard (parts of someone's name, the world's names for things and creatures): ${otherNames.join(", ")}.`] : []),
      ...(scene.essentials ?? []).filter(e => !state.landed?.includes(e.id)).map(e => `Not yet come across: ${known(e.what)} (with: ${e.placedWith.map(known).join("; ")})`),
      ...Object.values(state.world?.entities ?? {}).filter(e => !e.player && e.kind !== "person" && e.kind !== "creature" && !visible(state, e)).map(e => `Out of sight: ${e.name}`),
    ].join("\n"),
    what_is_true_now: [
      `Here now, and met: ${here.filter(c => met.has(c.id)).map(c => `${nameOf(c)}${shape(state, c.id) ? ` (${shape(state, c.id)})` : ""}`).join("; ") || "nobody but the player"}.`,
      ...(unseen.length ? [`Here, but the player hasn't seen them yet (held): ${unseen.map(nameOf).join("; ")}.`] : []),
      ...(gone.length ? [`Gone from here: ${gone.map(nameOf).join("; ")}.`] : []),
      `The player carries: ${carriedNames(state).join(", ") || "nothing of note"}.`,
    ].join("\n"),
    what_the_scene_cannot_offer: (scene.limits ?? []).map(l => `- ${known(limitHead(l))}`).join("\n") || "(nothing in particular)",
    rolls_the_scene_calls_for: rolled(scene, state).map(t => `- ${known(t.when)} (${titleCase(t.check!.skill)})`).join("\n") || "(none of its own: any risky attempt)",
    what_the_player_knows: [
      `Who they are: ${who(state)}`,
      `They came in knowing: ${state.lead ?? scene.hook}`,
      ...(state.history.length ? [`The story so far, scene by scene: ${state.history.map(h => h.summary).join("\n\n")}`] : []),
      ...(found.length ? [`What's come out here: ${found.join(" ")}`] : []),
      `The scene so far, as they read it:\n${scriptTranscript(scene, state, sceneEntries(state).filter(e => e.kind !== "system").slice(-24))}`,
    ].join("\n\n"),
  };
  const questions: Record<string, ChoiceQuestion> = {};
  lines.forEach((l, i) => {
    questions[`line_${i + 1}`] = { instructions: `A line offered to the player as something they might say or do next: "${l.text}". The player knows only what_the_player_knows; held_from_the_player is what they don't know unless the scene so far has shown it. Judge the line against those, what_is_true_now and what_the_scene_cannot_offer.`, criteria: VERDICTS };
    if (l.kind === "try") questions[`roll_${i + 1}`] = {
      instructions: `Would the game call for a roll if the player did this: "${l.text}"? (The scene's own rolls are in rolls_the_scene_calls_for; anything else risky is rolled too.)`,
      criteria: { risky: "Yes: a risky attempt whose outcome is genuinely uncertain (sneaky, physical, magical or social), where failure would change the situation.", safe: "No: ordinary talk or questions, looking around, or something where failing would only mean trying again." },
    };
  });
  const decision = await decider.decide(facts, questions, "scene.suggest.judge");
  const kept: Suggestion[] = [];
  const dropped: Array<{ text: string; why: string }> = [];
  lines.forEach((l, i) => {
    const verdict = decision.answers[`line_${i + 1}`];
    const p = verdict?.probabilities ?? {};
    const unfit = verdict && !FIT.has(verdict.choice) && (p[verdict.choice] ?? 1) >= CLEAR ? verdict.choice : (p.gives_away ?? 0) >= GIVES_AWAY ? "gives_away" : undefined;
    if (unfit) { dropped.push({ text: l.text, why: WHY[unfit] ?? unfit }); return; }
    const roll = decision.answers[`roll_${i + 1}`];
    kept.push(roll?.choice === "safe" && (roll.probabilities?.safe ?? 1) >= CLEAR ? { ...l, kind: "do" } : l);
  });
  return { lines: kept, dropped, costUsd: decision.costUsd, latencyMs: decision.latencyMs };
}

// ---------------------------------------------------------------------------------------------
// What the call is given

/** The player character, as the lines are to be in their voice: who they are, what they're good at, their spells, what they carry, their backstory. */
function who(state: SessionState): string {
  const p = state.player;
  const strengths = Object.entries(p.modifiers).filter((e): e is [string, number] => typeof e[1] === "number").sort((a, b) => b[1] - a[1]).slice(0, 4);
  const spells = state.rules?.spells?.map(s => s.name) ?? [];
  const carried = carriedNames(state);
  // Character creation's backstory, when there is one: who they are, what binds them and their flaws give a line its colour.
  const b = p.backstory;
  const story = b?.summary ? [`Their backstory: ${b.summary}`, ...(b.bonds.length ? [`Bonds: ${b.bonds.join("; ")}.`] : []), ...(b.flaws.length ? [`Flaws: ${b.flaws.join("; ")}.`] : [])] : [];
  return [
    `${p.name}: ${p.concept.replace(/\.$/, "")}.`,
    ...(p.build ? [`In game terms: ${p.build}.`] : []),
    ...(strengths.length ? [`Good at: ${strengths.map(([k]) => titleCase(k)).join(", ")}.`] : []),
    ...(spells.length ? [`Spells: ${spells.slice(0, 12).join(", ")}.`] : []),
    ...(carried.length ? [`Carrying: ${carried.join(", ")}.`] : []),
    ...story,
  ].join(" ");
}

/** What the player carries in the scene's world, as theirs ("dagger", not "Nim's dagger": a line of theirs says "my dagger"). */
function carriedNames(state: SessionState): string[] {
  const world = state.world;
  if (!world) return [];
  const own = new RegExp(`^(?:${nameTokens({ name: state.player.name }).map(escape).join("|") || "\\0"})['’]s\\s+`);
  return Object.values(world.entities).filter(e => e.parent === "player" && !e.states.includes("gone")).slice(0, 8)
    .map(e => `${(e.quantity ?? 1) > 1 ? `${e.quantity} ` : ""}${e.name.replace(own, "")}`);
}

const TITLE_WORDS = "Mister|Master|Mistress|Sergeant|Corporal|Captain|Sir|Lady|Lord|Dame|Big|Old|Young|Little|Mr|Mrs|Miss";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Prep as the player would put it: anyone whose name they haven't heard goes by what they'd call them ("the boy in the too-big boots"). */
export function asTheyKnowIt(text: string, scene: Scene, state: SessionState): string {
  let out = text;
  for (const [id, called] of Object.entries(unnamed(scene, state))) {
    const c = scene.cast.find(x => x.id === id);
    if (!c) continue;
    out = out.replace(new RegExp(`\\b${escape(c.name)}\\b`, "g"), called);
    for (const token of nameTokens(c)) out = out.replace(new RegExp(`(?:\\b(?:${TITLE_WORDS})\\s+)?\\b${escape(token)}\\b`, "g"), called);
  }
  return out;
}

/** The ways on from here that take a roll (the current beat's and the scene's own), not yet won. */
function rolled(scene: Scene, state: SessionState): Transition[] {
  const spent = spentHere(state);
  return [...currentBeat(scene, state).transitions, ...(scene.anytime ?? [])].filter(t => t.check && !spent.has(t.id));
}

/** A limit by what it rules out: its words before the reason (most are written "What's ruled out: why"). */
export function limitHead(limit: string): string {
  const head = limit.split(/:\s/)[0]!.trim();
  return head.length >= 12 && head.length < limit.length ? head : limit.slice(0, 200);
}

/**
 * A way out fits now: the story is at one of the scene's endings (closing, held for a last word, or
 * leaning towards one), or the player has been here a while.
 */
export function leaveFits(state: SessionState): boolean {
  const turns = sceneEntries(state).filter(e => e.kind === "player").length;
  return !!(state.closing || state.pendingExit || state.endingLead) || turns >= 4;
}

/** Someone the world has seen leave, or go down, or die. */
const OUT = ["gone", "down", "dead"];

/**
 * Who's here now: the scene's people on stage, and anyone the world has put here since (the corporal
 * and his dead-cart, come at the bell whether or not the scene reached its beat), less anyone the
 * world has gone (they've left).
 */
function hereNow(scene: Scene, state: SessionState): Character[] {
  const world = state.world;
  const present = new Set(presentCast(scene, state).map(c => c.id));
  return scene.cast.filter(c => (present.has(c.id) || !!world?.entities[c.id]) && !world?.entities[c.id]?.states.includes("gone"));
}

/**
 * The people here the player has met in this scene: who has spoken, or whom the scene so far has
 * shown them, by name or by the words of what they'd call them ("the watchman"). Not everyone on
 * stage: at the Heron's door the clerk in the counting-box and the forewoman are inside, and a list of
 * who's here that had them put the counting-box in the lines before the story did. (Not the lead into
 * the scene either: "Hobb's words stay with you" doesn't put Hobb on the wharf.)
 */
function metHere(scene: Scene, state: SessionState): Character[] {
  const entries = sceneEntries(state).filter(e => e.kind !== "system");
  const text = entries.map(e => e.text).join("\n");
  const shown = new Set(words(text).map(stem));
  const spoke = new Set(entries.flatMap(e => [e.speaker, ...(e.marked?.speech.map(s => s.speaker) ?? [])]));
  // By name, by their rank ("the sergeant"), or by the words of what they'd call them.
  const rank = (c: Character) => ROLE.exec(c.name)?.[1]?.toLowerCase();
  return hereNow(scene, state).filter(c => spoke.has(c.id) || nameTokens(c).some(t => new RegExp(`\\b${escape(t)}\\b`).test(text))
    || (rank(c) && shown.has(stem(rank(c)!))) || words(c.called ?? "").map(stem).some(w => w.length >= 4 && !STOP.has(w) && shown.has(w)));
}

/** A rank at the head of someone's name, which the narration may call them by ("the sergeant", "the Marshal"). */
const ROLE = /^(Sergeant|Corporal|Captain|Marshal|King|Queen|Lady|Lord|Constable)\b/;

/** Someone by as much of their name as the player has heard, with its title ("Sergeant Kell", not "Sergeant Agnes Kell"), else by what they'd call them. */
function knownAs(c: Character, v: Vetting): string {
  const parts = c.name.split(/\s+/).filter(w => !v.names.includes(w.replace(/[^\w']/g, "")));
  return parts.some(w => !new RegExp(`^(?:${TITLE_WORDS})$`, "i").test(w)) ? parts.join(" ") : c.called ?? c.name;
}

/** What someone here is in, as the world has it: down, or dead. */
const shape = (state: SessionState, id: string) => OUT.filter(s => s !== "gone" && state.world?.entities[id]?.states.includes(s)).join(", ");

/**
 * The scene, the character and the moment, for the call, from what the player knows and nothing else
 * (thief#4, wizard#13, barbarian#37: given the GM's prep "behind the screen" to choose threads by, the
 * call put its answers in the player's mouth, Hobb's mother, the Heron's river door, the dog's name,
 * seven times before the story did, and its judge passed them all): who they are (their sheet, what
 * they carry, their backstory), what they came in knowing (the lead, and the story so far), what this
 * scene can't offer (in words the player has met), and the scene as they've seen it: who's here now,
 * by the names they know, what's come out (in words they've met), and the last ten entries, as they
 * read them; then the way out, if the scene is ending in front of them, and what's not to be offered
 * again. What changes least first, so the provider's cache keeps the most of it.
 */
export function suggestionBrief(scene: Scene, state: SessionState): string {
  const v = vetting(scene, state);
  const called = unnamed(scene, state);
  const here = metHere(scene, state);
  const exits = scene.exits.filter(e => e.id !== IMPROVISED_EXIT_ID && !state.fought?.includes(e.id));
  const ending = (id: string | undefined) => exits.find(e => e.id === id);
  const at = ending(state.closing?.exitId) ?? ending(state.pendingExit?.exitId);
  const entries = sceneEntries(state).filter(e => e.kind !== "system");
  const said = entries.filter(e => e.kind === "player").at(-1)?.text;
  const offered = lastOffered(state);
  const found = foundOut(scene, state, v);
  const limits = (scene.limits ?? []).map(l => asTheyKnowIt(limitHead(l), scene, state)).filter(l => !unmetIn(l, v));
  const ends = at && !unmetIn(at.title, v) ? at.title : undefined;
  return [
    `# Who they are\n${who(state)}`,
    `# What they came in knowing\n${state.lead ?? scene.hook}${state.history.length ? `\n\nThe story so far, scene by scene:\n${state.history.map(h => h.summary).join("\n\n")}` : ""}`,
    ...(limits.length ? [`# What this scene can't offer (never suggest reaching for these)\n${limits.map(l => `- ${l}`).join("\n")}`] : []),
    "# The scene as they've seen it (this is all they know of it)",
    `## Who's here now\n${here.map(c => `- ${called[c.id] ?? knownAs(c, v)}${called[c.id] ? " (the player hasn't heard their name: call them that)" : ""}${c.group ? ` (${asTheyKnowIt(c.group, scene, state)})` : ""}${shape(state, c.id) ? ` (${shape(state, c.id)})` : ""}`).join("\n") || "(nobody but the player)"}`,
    ...(found.length ? [`## What's come out here (settled: no line asks after it again, though one may act on it; the latest last, and a later one may have changed an earlier one)\n${found.map(f => `- ${f}`).join("\n")}`] : []),
    `## The scene so far (the latest last)\n${scriptTranscript(scene, state, entries.slice(-10)) || "(It's just begun.)"}`,
    `# A way out\n${ends ? `It's ending now: ${ends}. The player has a last word.` : leaveFits(state) ? "A leave line can fit now, if the moment's right." : "No leave line yet: the scene is still young."}`,
    `# Not again\n${said ? `The player just said: ${said}\n` : ""}${offered.length ? `Offered last time (none of these again, not even in other words: the player has seen them):\n${offered.map(l => `- ${l}`).join("\n")}` : "Nothing offered yet."}`,
  ].join("\n\n");
}

/**
 * What's come out in this scene, as the player has it: what the scene needed them to come across
 * that they have, and the facts play has established, a sentence at a time and only in words they've
 * met, with anyone whose name they haven't heard called what they'd call them. Both are the GM's
 * words, and can run ahead of the story: "The rest (his master's name, the Heron) comes as he's
 * asked"; and the thief's Rat had Hobb's way in come across (the river door, its grille, the midnight
 * bell) when she'd only stolen his token, ten turns before he told her what it opened. Settled: a
 * line acts on it, never asks after it again.
 */
function foundOut(scene: Scene, state: SessionState, v: Vetting): string[] {
  // Someone they know by part of their name by that part ("Big Hobb Mallory" is Big Hobb).
  const partly = storyCast(storyScenes(scene, state)).map(c => [c.name, knownAs(c, v)] as const).filter(([name, known]) => name !== known && name.includes(known.split(" ").at(-1)!));
  const named = (text: string) => partly.reduce((t, [name, known]) => t.replaceAll(name, known), text);
  // A sentence at a time ("J. Sallow" isn't the end of one).
  const met = (text: string, keep: (s: string) => boolean = () => true) => asTheyKnowIt(named(text), scene, state).split(/(?<=(?<!\b\p{Lu})[.!?]["”’)]*)\s+(?=["“'‘(]?\p{Lu})/u)
    .map(s => s.trim()).filter(s => s && !unmetIn(s, v) && keep(s)).join(" ");
  // What the player carries is as the world has it now, in who they are: a fact about one of those
  // things can be behind it ("Nim's dagger lies on the cobbles near Kell", ten turns after she'd taken
  // it back, and the lines had her ask Kell for it).
  // (Not their coins: "the Crown" isn't a crown in their purse.)
  const own = new RegExp(`^(?:${nameTokens({ name: state.player.name }).map(escape).join("|") || "\\0"})['’]s\\s+`);
  const theirs = new Set(Object.values(state.world?.entities ?? {}).filter(e => e.parent === "player" && !e.states.includes("gone") && !e.tags.includes("coin"))
    .map(e => headNoun(e.name.replace(own, ""))).filter(h => !MONEY.test(h)).map(stem));
  const current = (s: string) => !words(s).some(w => theirs.has(stem(w)));
  const landed = (scene.essentials ?? []).filter(e => state.landed?.includes(e.id)).map(e => met(e.what));
  return [...new Set([...landed, ...state.established.map(f => met(f, current))].filter(Boolean))];
}

/** Money, by the word for it. */
const MONEY = /^(?:crowns?|shillings?|penn(?:y|ies)|pence|silver|gold|coppers?|coins?|marks?)$/;

/** A thing by the word that names it: "a silver crown stamped with a wheat-ear" is a crown, "2 silver crowns" crowns. */
const headNoun = (name: string) => name.toLowerCase().replace(/^(?:\d+|the|a|an|some)\s+/, "").split(/\s+(?:stamped|with|of|from|for|in|on|marked|full|that)\s+/)[0]!.split(/\s+/).at(-1)!;

/** The lines offered last time, in this scene. */
function lastOffered(state: SessionState): string[] {
  const s = state.suggestions;
  return s && s.scene === state.sceneId ? s.lines.map(l => l.text) : [];
}

// ---------------------------------------------------------------------------------------------
// Reading and vetting the lines

/**
 * The call's lines, "kind: line" one a line, as the player would type them: speech plain, a deed in
 * brackets ("(I ...)"). Forgiving of bullets, numbers, bold, quotes, a deed in asterisks or square
 * brackets, a deed with no kind, and a risky try written down as a deed. A line that's neither tagged
 * nor a deed is passed over before the list ("Here are some lines:") and ends it after: what follows
 * is the model thinking aloud ("Need ensure say lines...").
 *
 * At no reasoning effort the model's text comes back with noise in about one call in eight (21 of
 * 165 in the goals check), and the lines are cleaned of it before anything else reads them:
 * - two lines run together ("…the yard.)say: Sergeant, …", "…and leave.) pangsay: …") are two lines;
 * - runs of other scripts and symbols ("♀♀♀♀", "娱乐登录", "】【。】【") go;
 * - a deed is its bracketed part, and what's stuck on after it goes ("…the proof) (The barge sails)",
 *   "…today.)(final) Williams"); one left open is closed;
 * - the model's own planning ("The user requires 4-6 lines only…", "TBC") isn't a line;
 * - and what's left of one that couldn't be cleaned (a fragment, a stray word) isn't either.
 * `cutShort`: the reply ran out of tokens, so its last line may be half a line, and goes.
 */
export function parseSuggestions(text: string, options: { cutShort?: boolean } = {}): Suggestion[] {
  const out: Suggestion[] = [];
  const lines = text.normalize("NFC").split("\n").flatMap(l => l.split(RUN_ON));
  if (options.cutShort) lines.pop();
  for (const raw of lines) {
    let line = raw.replace(NOISE, " ").replace(/\s+/g, " ").trim().replace(/^(?:[-*•]|\d+[.)])\s+/, "").replace(/^\*\*(.+?)\*\*/, "$1").trim();
    // Nothing to read (a bullet or a number left over from a line run on): not a line, nor the end of the list.
    if (!/\p{L}/u.test(line)) continue;
    const tagged = TAG.exec(line);
    let kind = (tagged?.[1]?.toLowerCase() ?? "") as Suggestion["kind"] | "";
    if (tagged) line = line.slice(tagged[0].length).trim();
    line = line.replace(/^[*_]{2}|[*_]{2}$/g, "").trim();
    // A deed in asterisks or square brackets is a deed in round ones.
    const marked = /^\*([^*]+)\*$/.exec(line) ?? /^\[([^\]]+)\]?$/.exec(line);
    if (marked) line = `(${marked[1]!.trim()})`;
    const deed = line.startsWith("(");
    if (!kind && !deed) { if (out.length) break; continue; }
    if (!kind) kind = "do";
    if (kind === "say") {
      if (deed) kind = "do";
      else line = speechOf(line);
    }
    if (kind !== "say") {
      // A deed written without its brackets ("I look up at him").
      if (!deed && /^I\b/.test(line)) line = `(${line.replace(/\.$/, "")})`;
      if (line.startsWith("(")) line = deedOf(line);
      if (kind === "do" && /^\(I (?:try|attempt)\b/i.test(line)) kind = "try";
    }
    line = line.replace(/\s+/g, " ").trim();
    // The model's planning, in a line's clothes ("(Actually line format correction omitted? Need only four-six lines"): the list is over.
    if (PLANNING.test(line)) { if (out.length) break; continue; }
    if (line && !fragment(line)) out.push({ kind, text: line });
  }
  return out;
}

/** A kind's tag at the start of a line, however it's dressed ("say:", "**do:**", "Try –"). */
const TAG = /^[*_]*(say|do|try|leave)[*_]*\s*[:：–-]\s*/i;

/**
 * Where the model ran two lines together: a kind's tag in the middle of one, glued to what came
 * before ("…the yard.)say:", "…leave.) pangsay:"), with a line's start after it (a bracket, a quote,
 * "I", a capital), so "what to do: run" stays as it is.
 */
const RUN_ON = /(?<=\S)\s*(?=(?:say|do|try|leave)\s*[:：]\s*(?:[("“'‘[*]|I\b|\p{Lu}))/u;

/**
 * Anything a line in English has no use for: other scripts (娱乐登录, રાજકોટ, пәй), symbols (♀, ★,
 * 】【), private-use and stray code points. Latin letters (accented ones too: séance), digits, spaces
 * and the punctuation the lines use stay.
 */
const NOISE = /[^\p{Script=Latin}0-9\s.,;:!?'"‘’“”()[\]\-–—…/&*_]+/gu;

/** The model talking about the task instead of doing it ("The user requires 4-6 lines only", "Need exact format", "TBC"). */
const PLANNING = /\b(?:the user|user (?:wants|requires|asked)|instructions? (?:say|followed)|kind prefix|malformed|artifact|lines? only|four[- ]six|4-6|exact format|need (?:ensure|exact|only|to (?:ensure|provide|output))|must (?:only|provide|output)|TBC)\b/i;

/**
 * A deed is its bracketed part: what's stuck on after the bracket that closes it is noise or a line
 * run on ("…the yard.) pang", "…proof) (The barge sails)"). One left open is closed.
 */
function deedOf(line: string): string {
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "(") depth++;
    else if (line[i] === ")" && --depth === 0) return line.slice(0, i + 1);
  }
  return `${line.replace(/[\s.)]*$/, "")})`;
}

/**
 * Speech as the player would type it: no quotes round it, and no bracket left over from a deed run
 * into it ("…the noose?)"); a word or two stuck on after its last full stop is noise ("…on the hook?
 * eject").
 */
function speechOf(line: string): string {
  let s = line.replace(/^["“'‘]+|["”'’]+$/g, "").trim();
  const extra = (s.match(/\)/g) ?? []).length - (s.match(/\(/g) ?? []).length;
  if (extra > 0) s = s.replace(/\)+\s*$/, close => close.slice(0, Math.max(0, close.length - extra))).trim();
  // Noise after the last full stop: a word or two in lower case, or anything stuck to it ("hook?eject").
  const tail = /[.!?…]["”’]?(\s*)([^.!?…]{1,24})$/u.exec(s);
  if (tail && (!tail[1] || /^\p{Ll}/u.test(tail[2]!)) && tail[2]!.trim().split(/\s+/).length <= 2) s = s.slice(0, tail.index + 1 + (/^["”’]/.test(s.slice(tail.index + 1)) ? 1 : 0));
  return s.replace(/^["“'‘]+|["”'’]+$/g, "").trim();
}

/** What's left of a line that couldn't be cleaned: nothing to say, a deed of a word ("(I)"), or the model's markers stuck to its words ("JSImportassistant", "to=final"). */
function fragment(line: string): boolean {
  const words = line.replace(/^\(|\)$/g, "").trim().split(/\s+/).filter(w => /\p{L}/u.test(w)).length;
  return words < (line.startsWith("(") ? 2 : 1) || /\p{L}assistant|assistant\p{L}|\bto=\w/iu.test(line);
}

/** What a set of lines is vetted against: see vetting(). */
export interface Vetting {
  /** What the player has said lately in this scene (the latest last). */
  said: string[];
  /** The lines offered last time. */
  offered: string[];
  /**
   * Names the player hasn't heard, as they're written ("Hobb", "Duchess"): the story's people (here,
   * met before or still to come) and whatever the world here calls by a name.
   */
  names: string[];
  /** Word stems of what's still hidden (secrets, what the scene still needs the player to find, what nobody can see), the player hasn't met. */
  hidden: string[];
  /** The names and places in the prep the player hasn't met, as they're written: "the Heron" isn't the heron on a token. */
  proper: string[];
  /** Word stems of the things the scene's limits name as ruled out, the player hasn't met (a séance, a coroner, tomorrow). */
  limits: string[];
  /** A way out fits now (leaveFits). */
  leave: boolean;
  /** Word stems of the signs of what someone here hides in how the GM pictures them, that the scene hasn't shown (the string round Hobb's neck, Moll's fist). */
  looks?: string[];
  /** Places and things of the story's other scenes the player hasn't heard of, in a few words each ("river door", "plank walk"). */
  places?: string[];
  /** The player character's own names: their lines speak of them as "I". */
  self?: string[];
  /** Names of people the player knows of who aren't in the scene now, and haven't been (not come yet, or elsewhere in the story): nobody does anything to them here. */
  away?: string[];
}

/**
 * The vetting for the session's moment: what's been said and offered, and what the player has and
 * hasn't met. Met is what they've been told or shown (heardText), and the place as the screen shows
 * it; never the GM's descriptions of people (Hobb's string, Kell's borrowed coat), nor its record of
 * what play established, which can run ahead of the story.
 */
export function vetting(scene: Scene, state: SessionState): Vetting {
  const heard = heardText(scene, state);
  const here = hereNow(scene, state);
  // What they see of the people they've met here is what they call them ("the big man with the bandaged hand"), and what the scene has shown.
  const seen = new Set(words(`${heard}\n${visibleThings(state).join("\n")}\n${metHere(scene, state).map(c => c.called ?? "").join("\n")}`).map(stem));
  const named = new Set(capitalised(heard));
  const fresh = (list: string[]) => [...new Set(list.map(stem).filter(w => w.length >= 3 && !STOP.has(w) && !seen.has(w)))];
  const story = storyScenes(scene, state);
  const ordinary = everyday(story);
  const present = new Set(presentCast(scene, state).map(c => c.id));
  const said = heard.toLowerCase();
  const world = state.world;
  const secrets = [
    ...scene.cast.filter(c => present.has(c.id)).flatMap(c => c.secrets ?? []),
    ...(scene.essentials ?? []).filter(e => !state.landed?.includes(e.id)).map(e => e.what),
    ...Object.values(world?.entities ?? {}).filter(e => !e.player && !visible(state, e)).map(e => `${e.name}. ${e.description ?? ""}`),
  ].join("\n");
  // What a limit rules out, by the things it names in brackets ("a séance, a priest who can call up
  // Prout's ghost"): its other words ("talk to the dead") are too common to rule a line out by.
  const ruledOut = (scene.limits ?? []).flatMap(l => [...limitHead(l).matchAll(/\(([^)]*)\)/g)].map(m => m[1]!)).join("\n");
  const people = storyCast(story);
  const unheard = people.filter(c => c.called && !nameTokens(c).some(t => named.has(t)));
  // The parts of a name nobody has said, of someone they do know by another ("Mallory", for Hobb; "Agnes", for Kell).
  const partly = people.filter(c => !unheard.includes(c)).flatMap(c => nameTokens(c).filter(t => !named.has(t)));
  const self = nameTokens({ name: state.player.name });
  // The world's own names for things and creatures (Duchess, Manners): names, heard or not.
  const worldNames = Object.values(world?.entities ?? {}).filter(e => !e.player && !e.cast && !scene.cast.some(c => c.id === e.id))
    .flatMap(e => capitalised(e.name.replace(/^(?:the|a|an)\s+/i, "")).filter(w => /^\p{Lu}\p{Ll}{2,}$/u.test(w) && !STOP.has(stem(w)) && !named.has(w)));
  const onStage = new Set(here.map(c => c.id));
  // Who's away: people of the story the player has heard of who aren't on stage and haven't been (they
  // come later, or belong to another scene). Someone who has just left can still be gone after.
  const left = new Set(scene.cast.filter(c => world?.entities[c.id]?.states.includes("gone")).map(c => c.id));
  const away = people.filter(c => !onStage.has(c.id) && !left.has(c.id) && !unheard.includes(c)).flatMap(nameTokens).filter(t => !self.includes(t));
  // The places and things of the story's other scenes, by the few words that name them ("the river door
  // off the plank walk" is the river door), that nobody has spoken of yet; not what this place has too
  // (the granary yard has a hoist rope as well as the Heron).
  const own =`${scene.setting}\n${Object.values(world?.entities ?? {}).map(e => `${e.name} ${e.description ?? ""}`).join("\n")}`.toLowerCase();
  const places = story.filter(s => s.id !== scene.id && s.world).flatMap(s => [...s.world!.areas, ...s.world!.things].map(t => placeName(t.name)))
    .filter((p): p is string => !!p && !said.includes(p) && !own.includes(p));
  return {
    said: sceneEntries(state).filter(e => e.kind === "player").slice(-3).map(e => e.text),
    offered: lastOffered(state),
    names: [...new Set([...unheard.flatMap(nameTokens), ...partly, ...worldNames])].filter(t => !self.includes(t)),
    // Only the words particular to what's hidden here (a crackle, scuffs, lavender), not the ones any scene uses (trust, read).
    hidden: fresh(words(secrets)).filter(w => !ordinary.has(w)),
    // The story's, not just this scene's: at the granary, "the Heron" is a name too.
    proper: [...new Set(story.flatMap(namesInPrep).filter(w => !named.has(w) && !self.includes(w)))],
    limits: fresh(words(ruledOut).filter(w => !/ing$/i.test(w))),
    leave: leaveFits(state),
    // The signs of what someone hides in how the GM pictures them (the string round Hobb's neck, that
    // his token hangs on), which the scene hasn't shown yet: the words their look and their secrets share.
    looks: [...new Set(here.flatMap(c => { const hides = new Set(words((c.secrets ?? []).join("\n")).map(stem)); return fresh(words(c.look)).filter(w => hides.has(w) && !plainStems().has(w)); }))],
    places: [...new Set(places)],
    self,
    away: [...new Set(away)],
  };
}

/** A place or thing by the few words that name it: "the river door off the plank walk" is "river door"; a name of one plain word ("the floor") isn't one to go by. */
function placeName(name: string): string | undefined {
  const head = name.replace(/\s*\([^)]*\)/g, "").toLowerCase().replace(/^(?:the|a|an|some)\s+/, "")
    .split(/\s+(?:of|off|outside|by|in|on|with|at|behind|beside|under|over|from|for|near|into|onto|above|below|and|full|where|that)\s+/)[0]!.trim();
  return head.split(/[\s-]+/).length >= 2 && head.length >= 6 ? head : undefined;
}

/** What a text names that the player hasn't met, if anything: a name they haven't heard, a name or place only the prep has, a word only what's hidden has. */
function unmetIn(text: string, v: Vetting): string | undefined {
  const caps = capitalised(text);
  const name = v.names.find(n => caps.includes(n));
  if (name) return `a name not heard: ${name}`;
  const proper = caps.find(w => v.proper.includes(w));
  if (proper) return `a name or place not met: ${proper}`;
  const stems = words(text).map(stem);
  const hidden = stems.find(w => v.hidden.includes(w));
  if (hidden) return `hidden: ${hidden}`;
  const look = stems.find(w => v.looks?.includes(w));
  if (look) return `not shown: ${look}`;
  const lower = text.toLowerCase();
  const place = v.places?.find(p => lower.includes(p));
  return place ? `a place not met: ${place}` : undefined;
}

/** The capitalised words of some text, as names are compared: without "'s" ("Sallow's" is Sallow). */
const capitalised = (text: string) => words(text).filter(w => /^\p{Lu}/u.test(w)).map(nameKey);
const nameKey = (w: string) => w.replace(/['’]s?$/, "");

let plain: Set<string> | undefined;
let plainStemmed: Set<string> | undefined;
/**
 * Words that are only capitalised for where they stand ("Yes", "Common", "Noted", "Master"): titles,
 * and any word the GM's standing instructions use in lower case.
 */
function plainWords(): Set<string> {
  plain ??= new Set([...TITLE_WORDS.toLowerCase().split("|"), ...(`${prompt("gm")}\n${prompt("tone-comic")}`.match(/\b\p{Ll}[\p{L}'’-]*/gu) ?? [])]);
  return plain;
}
/** The same, as stems: words too plain to call a description's own ("hand", "corner", "watching"). */
const plainStems = (): Set<string> => (plainStemmed ??= new Set([...plainWords()].map(stem)));

const prepNames = new Map<string, string[]>();
/** A scene's names and places, as its prep writes them, less the words only capitalised for where they stand. */
function namesInPrep(scene: Scene): string[] {
  let names = prepNames.get(scene.id);
  if (!names) prepNames.set(scene.id, names = [...new Set(properNouns(prepText(scene)).map(nameKey).filter(w => w.length >= 3 && !plainWords().has(w.toLowerCase()) && !STOP.has(stem(w))))]);
  return names;
}

/** The names in some text: its capitalised words that don't start a sentence, a line or a quote ("'Noted.'"). */
function properNouns(text: string): string[] {
  return text.split(/[.!?:;—]\s+|\n+|["“”‘’()[\]]|(?<=\s)'|'(?=[\s.,;:!?])/).flatMap(sentence => words(sentence).slice(1).filter(w => /^\p{Lu}/u.test(w)));
}

/**
 * Everything the player has been told or shown, as they read it: the hooks of the scenes played and
 * this one, the lead into it, the notebook's lines of each scene played, every line of play (theirs,
 * and the dice's), who they are and what they carry. Not the GM's hand-offs, its descriptions of
 * people, its record of what play established, or its words for what the player has come across
 * (foundOut): those are the GM's, and can say more than the player was told.
 */
function heardText(scene: Scene, state: SessionState): string {
  const p = state.player;
  return [
    scene.hook, state.lead ?? "",
    ...state.history.flatMap(h => [safeScene(h.sceneId)?.hook ?? "", ...(h.journal ?? [])]),
    ...state.transcript.filter(e => e.kind !== "system").map(e => e.text),
    p.name, p.concept, p.build ?? "", p.backstory?.summary ?? "", p.backstory?.text ?? "",
    ...carriedNames(state),
  ].join("\n");
}

/** A thing the screen shows: not hidden, not gone, and not in anyone else's hands. People and creatures aren't things. */
function visible(state: SessionState, e: Entity): boolean {
  const holder = e.parent ? state.world?.entities[e.parent] : undefined;
  return !e.tags.includes("hidden") && !e.states.includes("hidden") && !e.states.includes("gone") && !(holder && ["person", "creature"].includes(holder.kind) && !holder.player);
}

/**
 * The place as the screen shows it, pointed at (src/game/scene-menu.ts): its areas and things by
 * name, how they are (the loft door barred) and what the story has said of them; how the people are
 * (who go by the names the player knows). Never the world's descriptions: they're written for the GM.
 */
function visibleThings(state: SessionState): string[] {
  return Object.values(state.world?.entities ?? {}).filter(e => !e.player && visible(state, e))
    .flatMap(e => [...(e.kind === "person" || e.kind === "creature" ? [] : [e.name]), ...e.states, ...e.notes.map(n => n.text)]);
}

const safeScene = (id: string): Scene | undefined => { try { return sceneById(id); } catch { return undefined; } };

/** The story's scenes, as far as this one's concerned: those played, this one, and those it can lead to. */
function storyScenes(scene: Scene, state: SessionState): Scene[] {
  const out = new Map<string, Scene>([[scene.id, scene]]);
  for (const h of state.history) { const s = safeScene(h.sceneId); if (s && !s.companion) out.set(s.id, s); }
  const queue = [scene];
  while (queue.length) {
    for (const e of queue.shift()!.exits) {
      if (!e.next || out.has(e.next)) continue;
      const next = safeScene(e.next);
      if (next) { out.set(next.id, next); queue.push(next); }
    }
  }
  return [...out.values()];
}

/** The story's people, each once (as this scene cards them, else the first scene that does). */
function storyCast(scenes: Scene[]): Character[] {
  const first = new Map<string, Character>();
  for (const c of scenes.flatMap(s => s.cast)) if (!first.has(c.id)) first.set(c.id, c);
  return [...first.values()];
}

/** All the scene's prep: the cards, the beats and their routes, the endings, what it needs, its limits. */
function prepText(scene: Scene): string {
  return [
    scene.setting, scene.premise, ...(scene.background ?? []),
    ...scene.cast.flatMap(c => [c.name, c.voice, c.wants, c.fears ?? "", ...c.knows, ...(c.secrets ?? []), c.attitude, c.group ?? ""]),
    ...scene.beats.flatMap(b => [b.direction, ...Object.values(b.cast ?? {}), b.pressure ?? "", ...b.transitions.flatMap(routeText)]),
    ...(scene.anytime ?? []).flatMap(routeText),
    ...scene.exits.flatMap(e => [e.outcome, e.closing]),
    ...(scene.essentials ?? []).flatMap(e => [e.what, ...e.placedWith, e.unlocks]),
    ...(scene.limits ?? []),
  ].join("\n");
}

const routeText = (t: Transition) => [t.when, ...(t.check ? [t.check.reason ?? "", t.check.success, t.check.failure] : []), ...(t.establishes ?? [])];

const stemsOf = (text: string) => new Set(words(text).map(stem));
let corpus: Map<string, Set<string>> | undefined;
const ordinaries = new Map<string, Set<string>>();

/**
 * The words any scene might use, as far as this story's concerned: the prep of every scene outside it
 * and the GM's standing instructions. What's hidden here, in words of its own, is what they don't
 * have. The story's own scenes don't count: they share its secrets (the Heron's prep has Hobb's token,
 * the river door and the midnight bell, so with them in, none of those was hidden at the Rat).
 */
function everyday(story: Scene[]): Set<string> {
  const key = story.map(s => s.id).sort().join(" ");
  const cached = ordinaries.get(key);
  if (cached) return cached;
  corpus ??= new Map([...SCENES, ...ZOO_SCENES].map(s => [s.id, stemsOf(prepText(s))]));
  const out = stemsOf(`${prompt("gm")}\n${prompt("tone-comic")}`);
  for (const [id, stems] of corpus) if (!story.some(s => s.id === id)) for (const w of stems) out.add(w);
  ordinaries.set(key, out);
  return out;
}

/** The words of some text, as written (apostrophes kept: "Sallow's"). */
const words = (text: string) => text.match(/[\p{L}][\p{L}'’-]*/gu) ?? [];

/** A word's stem, for matching one form against another: lower case, without "'s" or a common ending (strangled, strangle, strangles). */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/['’]s$/, "").replace(/['’]/g, "");
  for (const ending of ["ings", "ing", "ed", "es", "s"]) {
    if (w.endsWith(ending) && w.length - ending.length >= 4) { w = w.slice(0, -ending.length); break; }
  }
  return w.length >= 5 && w.endsWith("e") ? w.slice(0, -1) : w;
}

/** Common words, never taken for something hidden or ruled out (they'd be in any line). */
const STOP = new Set([
  "the", "and", "you", "him", "her", "his", "she", "who", "why", "how", "for", "was", "are", "not", "but", "has", "had", "did", "any", "all", "can", "its",
  "our", "out", "now", "too", "get", "got", "let", "may", "one", "two", "off", "yet", "see", "saw", "say", "ask", "put", "own", "way", "use",
  "about", "above", "after", "again", "against", "also", "always", "among", "another", "anyone", "anything", "around", "asked", "away", "back", "because", "become",
  "been", "before", "behind", "being", "believe", "below", "best", "better", "between", "both", "bring", "brought", "call", "called", "came", "cannot", "carry",
  "close", "come", "could", "didn", "does", "doesn", "done", "down", "during", "each", "either", "else", "enough", "even", "ever", "every", "everyone",
  "everything", "face", "fact", "find", "first", "found", "from", "gave", "give", "given", "goes", "going", "gone", "good", "great", "half", "hand", "hands",
  "happen", "happened", "have", "having", "head", "hear", "heard", "help", "here", "herself", "himself", "hold", "home", "however", "inside", "into", "isn",
  "itself", "just", "keep", "kept", "kind", "know", "known", "last", "late", "later", "least", "leave", "left", "less", "like", "little", "long", "look",
  "looked", "made", "make", "many", "maybe", "mean", "might", "mind", "minute", "moment", "more", "most", "much", "must", "myself", "name", "near", "need",
  "never", "next", "nice", "night", "nobody", "none", "nothing", "once", "only", "onto", "other", "others", "ought", "over", "part", "people", "perhaps",
  "place", "point", "quite", "rather", "real", "really", "right", "round", "said", "same", "saying", "says", "seem", "seen", "self", "shall", "should", "show",
  "side", "since", "some", "someone", "something", "sometimes", "soon", "sort", "still", "such", "sure", "take", "taken", "talk", "tell", "than", "that",
  "their", "them", "then", "there", "these", "they", "thing", "things", "think", "this", "those", "though", "thought", "three", "through", "till", "time",
  "together", "told", "took", "tried", "true", "turn", "under", "until", "upon", "very", "want", "wanted", "wants", "watch", "well", "went", "were", "what",
  "when", "where", "whether", "which", "while", "whole", "whom", "whose", "will", "wish", "with", "within", "without", "word", "words", "work", "would",
  "wouldn", "year", "years", "your", "yours", "yourself", "player", "players", "person", "business", "official", "owner", "liked", "effort",
  "believable", "picture",
  // Words any line of this story might use, that a secret happens to have too (on the testers' turns:
  // the noose and the gallows threatened, a round bought, a body looked at, a gang, a ledger's entries).
  "man", "men", "woman", "women", "size", "body", "bear", "bears", "buy", "buys", "pint", "gang", "entry", "entries", "noose", "gallows",
  "sleeve", "sleeves", "head", "table", "tray", "big", "round",
].map(stem));

/** Lines as comparable words: lower case, no punctuation, the little words gone. */
function gist(text: string): Set<string> {
  return new Set(words(text).map(stem).filter(w => w.length >= 3 && !LITTLE.has(w)));
}

/** The little words a line is made of whatever it says, left out when lines are compared. */
const LITTLE = new Set([
  "the", "and", "you", "him", "her", "his", "she", "who", "why", "how", "for", "was", "are", "not", "but", "has", "had", "did", "any", "all", "can", "its",
  "our", "out", "now", "too", "may", "yet", "this", "that", "with", "from", "have", "were", "what", "when", "where", "which", "your", "their", "them", "they",
  "then", "than", "there", "these", "those", "into", "onto", "just", "very", "will", "would", "could", "should", "been", "being", "does", "about", "some",
].map(stem));

/** The same line again, or near enough (most of its words). */
function same(a: string, b: string): boolean {
  const x = gist(a), y = gist(b);
  if (!x.size || !y.size) return a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const shared = [...x].filter(w => y.has(w)).length;
  return (shared >= 2 && shared / new Set([...x, ...y]).size >= 0.5) || (shared === Math.min(x.size, y.size) && shared >= 3);
}

type Dropped = Array<{ text: string; why: string }>;

/**
 * The lines worth offering, by what can be read off their words, and why the rest were dropped: the
 * player's own words and deeds (a deed is "(I ...)", speech isn't anyone else's, and neither speaks of
 * the player by name: "Nim's the one asking" is Kell's), none of the GM's markup (src/runtime/markup.ts:
 * a speaker's tag, a note, anything else in square brackets, which the call is never shown but might
 * write all the same), short enough to read at a glance, nothing the player hasn't met (a name they
 * haven't heard, the story's people or the world's own names; a name or place only the prep has; a
 * word only what's hidden has), nothing the limits name, nobody who isn't here done to or spoken to
 * as if they were, nothing they've just said or were offered last time, nothing twice, and a way out
 * only when one fits.
 */
export function screen(candidates: Suggestion[], v: Vetting): { kept: Suggestion[]; dropped: Dropped } {
  const dropped: Dropped = [];
  const kept: Suggestion[] = [];
  const has = (stems: string[], text: string) => words(text).map(stem).find(w => stems.includes(w));
  for (const s of candidates) {
    const why = s.kind === "say" ? (/^[\p{Lu}][\p{L}'’ .-]{0,30}:\s/u.test(s.text) ? "someone else's words" : undefined)
      : !/^\(I\b/.test(s.text) ? "not the player's own deed" : undefined;
    const spoken = spokenOf(s.text, v.self);
    const away = notHere(s, v.away);
    const reason = why
      ?? (/[[\]]/.test(s.text) ? "the GM's markup" : undefined)
      ?? (s.text.length > 150 ? "too long" : undefined)
      ?? (spoken ? `not their voice: ${spoken}, by name` : undefined)
      ?? unmetIn(s.text, v)
      ?? (has(v.limits, s.text) ? `the scene can't offer it: ${has(v.limits, s.text)}` : undefined)
      ?? (away ? `not here: ${away}` : undefined)
      ?? (v.said.some(t => same(t, s.text)) ? "just said" : undefined)
      ?? (v.offered.some(t => same(t, s.text)) ? "offered last time" : undefined)
      ?? (kept.some(k => same(k.text, s.text)) ? "said twice" : undefined)
      ?? (s.kind === "leave" && !v.leave ? "no way out yet" : undefined);
    if (reason) dropped.push({ text: s.text, why: reason });
    else kept.push(s);
  }
  return { kept, dropped };
}

/** The player spoken of by name, in a line that's theirs ("Nim's the one asking"), unless it's them saying who they are ("I'm Nim"). */
function spokenOf(text: string, self: string[] = []): string | undefined {
  for (const t of self) {
    const at = new RegExp(`\\b${escape(t)}\\b`).exec(text);
    if (at && !/\b(?:I['’]m|I am|name['’]s|name is|call me|it['’]s|this is)\s+(?:\p{Lu}[\p{L}'’-]*\s+)?$/iu.test(text.slice(0, at.index))) return t;
  }
  return undefined;
}

/** What comes between a deed's verb and whoever it's done to ("go after", "shout at"). */
const TO = "(?: (?:the|a|at|to|on|with|for|up|down|over|after|past|by|towards?|into))?";

/**
 * Someone who isn't here (not come yet, or elsewhere in the story), done to or spoken to as if they
 * were: a deed's first object ("(I try to frighten Sallow…)", before he's come), or speech to them
 * ("Sallow, you'll hang", "You'll hang, Sallow."). Speaking of them, or of what's theirs, is fine.
 */
function notHere(s: Suggestion, away: string[] = []): string | undefined {
  const title = `(?:(?:${TITLE_WORDS}) )?`;
  return away.find(n => {
    const name = `${title}${escape(n)}\\b(?!['’])`;
    return new RegExp(`^\\(I (?:try to |attempt to )?\\S+${TO} ${name}`).test(s.text)
      || (s.kind === "say" && new RegExp(`^${name}[,!?]|,\\s*${name}[.!?]*$`).test(s.text));
  });
}

/**
 * A mix of what's left: up to two to say, a deed, a risky try and a way out (when one fits), filled
 * to four from what's spare, five at most, in that order.
 */
export function mix(kept: Suggestion[], leave: boolean): { lines: Suggestion[]; dropped: Dropped } {
  const of = (kind: Suggestion["kind"]) => kept.filter(s => s.kind === kind);
  const chosen = [...of("say").slice(0, 2), ...of("do").slice(0, 1), ...of("try").slice(0, 1), ...(leave ? of("leave").slice(0, 1) : [])];
  for (const spare of [...of("do").slice(1), ...of("say").slice(2), ...of("try").slice(1)]) if (chosen.length < 4) chosen.push(spare);
  const dropped = kept.filter(s => !chosen.includes(s)).map(s => ({ text: s.text, why: s.kind === "leave" && !leave ? "no way out yet" : "enough of its kind" }));
  return { lines: chosen.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind)).slice(0, 5), dropped };
}

/** Both, as the call's lines are vetted when there's no judge to ask. */
export function vet(candidates: Suggestion[], v: Vetting): { lines: Suggestion[]; dropped: Dropped } {
  const screened = screen(candidates, v);
  const mixed = mix(screened.kept, v.leave);
  return { lines: mixed.lines, dropped: [...screened.dropped, ...mixed.dropped] };
}
