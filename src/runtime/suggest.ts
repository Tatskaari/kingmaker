import { deciderFor, type ChoiceQuestion, type Decider } from "../llm/decide.ts";
import { modelOffline, respond, type RespondRequest } from "../llm/openrouter.ts";
import { sceneById, SCENES, ZOO_SCENES } from "../../scenes/index.ts";
import { sceneApproach } from "./approaches.ts";
import { currentBeat, effectiveScene, IMPROVISED_EXIT_ID, knownCast, nameTokens, presentCast, prompt, sceneEntries, scriptTranscript, spentHere, unnamed } from "./brief.ts";
import { titleCase } from "./dice.ts";
import type { TurnHooks } from "./engine.ts";
import type { Character, Exit, Scene, Transition } from "./scene.ts";
import type { PlayerCharacter, SessionState, Suggestion } from "./session.ts";

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
 * What they're grounded in: the character (concept, build, backstory), the last few exchanges, and
 * the scene's open threads as the GM's prep has them (who's here and what they're after, the ways on
 * from here and their rolls, what the scene still needs the player to come across, its endings and
 * limits), with everyone the player hasn't heard named called what the player would call them. What
 * people hide stays behind the screen: a line can only ask after it.
 *
 * Vetted before they're offered: first by what can be read off the words (`screen`: the player's own
 * words and deeds only, no name they haven't heard, no word of what's still hidden, nothing the
 * scene's limits name, nothing just said or offered last time), then by the GM's own judge, the
 * session's decider, given every fact (`judge`: does a line give away or take for granted what's
 * hidden, reach for what the scene can't offer, or decide for someone else; would a risky try really
 * take a roll), then a mix of kinds (`mix`). The call and the judge take about two and a half seconds
 * between them, and the stage manager about four and a half: the lines are there before the turn is.
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
  const screened = screen(parseSuggestions(result.cutShort ? result.text.slice(0, result.text.lastIndexOf("\n") + 1) : result.text), v);
  const judged = await judge(scene, state, screened.kept, options.decider ?? deciderFor(sceneApproach(state, scene).decider)).catch(() => undefined);
  const mixed = mix(judged?.lines ?? screened.kept, v.leave);
  return {
    lines: mixed.lines, dropped: [...screened.dropped, ...(judged?.dropped ?? []), ...mixed.dropped], text: result.text,
    costUsd: result.costUsd + (judged?.costUsd ?? 0), latencyMs: result.latencyMs, ...(judged ? { judgeMs: Math.round(judged.latencyMs) } : {}),
  };
}

/** The judge's verdicts on a line: fit to offer, or why not. */
const VERDICTS: Record<string, string> = {
  fine: "Fit to offer: it rests only on what the player has seen, heard or been told (or a fair guess from it), it's their own words or deeds, and the scene can offer it.",
  gives_away: "It gives away, or takes for granted, something only hidden_from_the_player says: a fact, a clue or a detail they haven't come across, or a name they haven't heard. (Asking about or looking at what they've seen is fine.)",
  ruled_out: "It reaches for something the scene can't offer (what_the_scene_cannot_offer).",
  not_theirs: "It says what someone else says, does or feels, or how it turns out.",
};
const WHY: Record<string, string> = { gives_away: "the judge: gives away what's hidden", ruled_out: "the judge: the scene can't offer it", not_theirs: "the judge: not the player's own" };

/**
 * The GM's own judge on the lines, in one call to the session's decider, with every fact: what the
 * player knows, what's hidden from them, what the scene can't offer. A line that gives away or takes
 * for granted what's hidden, reaches for what the scene can't offer, or decides for someone else is
 * dropped; a risky try that wouldn't take a roll is a deed. Words alone can't tell a line that asks
 * after a hidden thing from one that gives it away; the judge can.
 */
async function judge(scene: Scene, state: SessionState, lines: Suggestion[], decider: Decider): Promise<{ lines: Suggestion[]; dropped: Array<{ text: string; why: string }>; costUsd: number; latencyMs: number }> {
  if (!lines.length) return { lines, dropped: [], costUsd: 0, latencyMs: 0 };
  const known = (text: string) => asTheyKnowIt(text, scene, state);
  const called = unnamed(scene, state);
  const present = presentCast(scene, state);
  // What changes least first (the prep), what changes every turn last (the scene so far).
  const facts = {
    hidden_from_the_player: [
      ...present.flatMap(c => [`${called[c.id] ?? c.name} is after: ${known(c.wants)}`, ...(c.secrets ?? []).map(s => `${called[c.id] ?? c.name} hides: ${known(s)}`)]),
      ...(scene.essentials ?? []).filter(e => !state.landed?.includes(e.id)).map(e => `Not yet come across: ${known(e.what)} (with: ${e.placedWith.map(known).join("; ")})`),
      ...Object.values(state.world?.entities ?? {}).filter(e => e.tags.includes("hidden") || e.states.includes("hidden")).map(e => `Hidden: ${e.name}`),
    ].join("\n"),
    what_the_scene_cannot_offer: (scene.limits ?? []).map(l => `- ${known(limitHead(l))}`).join("\n") || "(nothing in particular)",
    rolls_the_scene_calls_for: rolled(scene, state).map(t => `- ${known(t.when)} (${titleCase(t.check!.skill)})`).join("\n") || "(none of its own: any risky attempt)",
    what_the_player_knows: [
      `They came in knowing: ${state.lead ?? scene.hook}`,
      ...(state.history.length ? [`The story so far: ${state.history.at(-1)!.summary}`] : []),
      `Who's here, as they see them: ${present.map(c => `${called[c.id] ?? c.name}: ${known(c.look)}`).join(" ")}`,
      `The scene so far:\n${scriptTranscript(scene, state, sceneEntries(state).filter(e => e.kind !== "system").slice(-24))}`,
    ].join("\n\n"),
  };
  const questions: Record<string, ChoiceQuestion> = {};
  lines.forEach((l, i) => {
    questions[`line_${i + 1}`] = { instructions: `A line offered to the player as something they might say or do next: "${l.text}". Judge it against what_the_player_knows, hidden_from_the_player and what_the_scene_cannot_offer.`, criteria: VERDICTS };
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
    // A clear verdict only: on the live turns, its leaks were judged 0.6 and over, and a bird asked what it saw half "can't offer".
    if (verdict && verdict.choice !== "fine" && (verdict.probabilities?.[verdict.choice] ?? 1) >= 0.6) { dropped.push({ text: l.text, why: WHY[verdict.choice] ?? verdict.choice }); return; }
    const roll = decision.answers[`roll_${i + 1}`];
    kept.push(roll?.choice === "safe" && (roll.probabilities?.safe ?? 1) >= 0.6 ? { ...l, kind: "do" } : l);
  });
  return { lines: kept, dropped, costUsd: decision.costUsd, latencyMs: decision.latencyMs };
}

// ---------------------------------------------------------------------------------------------
// What the call is given

/** The player character, as the lines are to be in their voice: who they are, what they're good at, their spells, what they carry, their backstory. */
function who(state: SessionState): string {
  // Character creation's backstory (app/creation), when there is one: read as it's shaped there.
  const p = state.player as PlayerCharacter & { backstory?: { summary?: string; bonds?: string[]; flaws?: string[] } };
  const strengths = Object.entries(p.modifiers).filter((e): e is [string, number] => typeof e[1] === "number").sort((a, b) => b[1] - a[1]).slice(0, 4);
  const spells = state.rules?.spells?.map(s => s.name) ?? [];
  const carried = carriedNames(state);
  const story = p.backstory?.summary ? [`Their backstory: ${p.backstory.summary}`, ...(p.backstory.bonds?.length ? [`Bonds: ${p.backstory.bonds.join("; ")}.`] : []), ...(p.backstory.flaws?.length ? [`Flaws: ${p.backstory.flaws.join("; ")}.`] : [])] : [];
  return [
    `${p.name}: ${p.concept.replace(/\.$/, "")}.`,
    ...(p.build ? [`In game terms: ${p.build}.`] : []),
    ...(strengths.length ? [`Good at: ${strengths.map(([k]) => titleCase(k)).join(", ")}.`] : []),
    ...(spells.length ? [`Spells: ${spells.slice(0, 12).join(", ")}.`] : []),
    ...(carried.length ? [`Carrying: ${carried.join(", ")}.`] : []),
    ...story,
  ].join(" ");
}

/** What the player carries in the scene's world. */
function carriedNames(state: SessionState): string[] {
  const world = state.world;
  if (!world) return [];
  return Object.values(world.entities).filter(e => e.parent === "player" && !e.states.includes("gone")).slice(0, 8)
    .map(e => `${(e.quantity ?? 1) > 1 ? `${e.quantity} ` : ""}${e.name}`);
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

const phaseOf = (t: Transition) => t.on ?? (t.check ? "attempt" : "outcome");

/** The ways on from here that take a roll (the current beat's and the scene's own), not yet won. */
function rolled(scene: Scene, state: SessionState): Transition[] {
  const spent = spentHere(state);
  return [...currentBeat(scene, state).transitions, ...(scene.anytime ?? [])].filter(t => t.check && !spent.has(t.id));
}
const firstSentence = (text: string) => /^.*?[.!?](?=\s|$)/.exec(text.trim())?.[0] ?? text.trim();

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

/**
 * The scene, the character and the moment, for the call: what the player knows (who they are, what
 * they came in knowing), behind the screen, where the threads are (what people are after, the ways on
 * and their rolls, what the scene still needs the player to come across, its endings and limits), then
 * what the player knows of the scene (who's here as they look, the scene so far), and what's not to be
 * offered again. In that order, what changes least first, so the provider's cache keeps the most of it.
 */
export function suggestionBrief(scene: Scene, state: SessionState): string {
  const known = (text: string) => asTheyKnowIt(text, scene, state);
  const called = unnamed(scene, state);
  const present = presentCast(scene, state);
  const nameOf = (c: Character) => called[c.id] ?? c.name;
  const exitOf = (t: Transition) => scene.exits.find(e => e.id === (t.check ? t.check.onSuccess : t.to));
  const beat = currentBeat(scene, state);
  const spent = spentHere(state);
  // The ways on the player attempts (a roll's, a simple act's, an ending's), not what the world does
  // or what only someone else can give. A roll by its skill alone: its reason can take for granted
  // what the player hasn't found ("to get him to trust you with what he heard").
  const routes = [...beat.transitions, ...(scene.anytime ?? [])]
    .filter(t => phaseOf(t) === "attempt" && !t.given && !spent.has(t.id) && t.to !== IMPROVISED_EXIT_ID && !state.fought?.includes(exitOf(t)?.id ?? ""))
    .map(t => `- ${known(t.when)}${t.check ? ` (a roll: ${titleCase(t.check.skill)})` : ""}${exitOf(t) ? ` (it ends the scene: ${exitOf(t)!.title})` : ""}`);
  const needs = (scene.essentials ?? []).filter(e => !state.landed?.includes(e.id))
    .map(e => `- ${known(e.what)} Where: ${e.placedWith.map(known).join("; ")}.${state.hinted?.includes(e.id) ? " (The player has had a sign of it.)" : ""}`);
  const exits = scene.exits.filter(e => e.id !== IMPROVISED_EXIT_ID && !state.fought?.includes(e.id));
  const ending = (id: string | undefined) => exits.find(e => e.id === id);
  const at = ending(state.closing?.exitId) ?? ending(state.pendingExit?.exitId);
  const leaning = ending(state.endingLead?.exitId);
  const entries = sceneEntries(state).filter(e => e.kind !== "system");
  const said = entries.filter(e => e.kind === "player").at(-1)?.text;
  const offered = lastOffered(state);
  return [
    "# What the player knows: who they are, and what they came in knowing",
    `## Who they are\n${who(state)}`,
    `## What they came in knowing\n${state.lead ?? scene.hook}${state.history.length ? `\n\nThe story so far: ${state.history.at(-1)!.summary}` : ""}`,
    "# Behind the screen (the GM's prep: the player knows none of it)",
    `## What the scene is about\n${known(scene.premise)}`,
    ...(present.length ? [`## What they're after\n${present.map(c => `- ${nameOf(c)}: ${known(c.wants)} With the player: ${known(firstSentence(c.attitude))}`).join("\n")}`] : []),
    ...(routes.length ? [`## Ways on from here\n${routes.join("\n")}`] : []),
    ...(needs.length ? [`## What the scene still needs the player to come across, and where\n${needs.join("\n")}`] : []),
    `## How it can end\n${exits.map((e: Exit) => `- ${e.title}${e.kind === "leave" ? " (walking away)" : ""}`).join("\n")}${at ? `\nIt's ending now: ${at.title}. The player has a last word.` : leaning ? `\nThe story is heading for: ${leaning.title}.` : ""}\n${leaveFits(state) ? "A leave line can fit now, if the moment's right." : "No leave line yet: the scene is still young."}`,
    ...(scene.limits?.length ? [`## What this scene can't offer (never suggest reaching for these)\n${scene.limits.map(l => `- ${known(limitHead(l))}`).join("\n")}`] : []),
    "# What the player knows of the scene",
    `## Who's here, as the player sees them\n${present.map(c => `- ${nameOf(c)}${called[c.id] ? " (the player hasn't heard their name: call them that)" : ""}${c.group ? ` (${known(c.group)})` : ""}: ${known(c.look)}`).join("\n") || "(nobody but the player)"}`,
    `## The scene so far (the latest last)\n${scriptTranscript(scene, state, entries.slice(-10)) || "(It's just begun.)"}`,
    `# Not again\n${said ? `The player just said: ${said}\n` : ""}${offered.length ? `Offered last time (none of these again, not even in other words: the player has seen them):\n${offered.map(l => `- ${l}`).join("\n")}` : "Nothing offered yet."}`,
  ].join("\n\n");
}

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
 * nor a deed ends the list: what follows is the model thinking aloud ("Need ensure say lines...").
 */
export function parseSuggestions(text: string): Suggestion[] {
  const out: Suggestion[] = [];
  for (const raw of text.split("\n")) {
    let line = raw.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, "").replace(/^\*\*(.+?)\*\*/, "$1").trim();
    if (!line) continue;
    const tagged = /^[*_]*(say|do|try|leave)[*_]*\s*[:：–-]\s*/i.exec(line);
    let kind = (tagged?.[1]?.toLowerCase() ?? "") as Suggestion["kind"] | "";
    if (tagged) line = line.slice(tagged[0].length).trim();
    line = line.replace(/^[*_]{2}|[*_]{2}$/g, "").trim();
    // A deed in asterisks or square brackets is a deed in round ones.
    const marked = /^\*([^*]+)\*$/.exec(line) ?? /^\[([^\]]+)\]?$/.exec(line);
    if (marked) line = `(${marked[1]!.trim()})`;
    const deed = line.startsWith("(");
    if (!kind && !deed) break;
    if (!kind) kind = "do";
    if (kind === "say") {
      if (deed) kind = "do";
      else line = line.replace(/^["“'‘]+|["”'’]+$/g, "").trim();
    }
    if (kind !== "say") {
      // A deed written without its brackets ("I look up at him").
      if (!deed && /^I\b/.test(line)) line = `(${line.replace(/\.$/, "")})`;
      if (line.startsWith("(") && !line.endsWith(")")) line = `${line.replace(/[.)]*$/, "")})`;
      if (kind === "do" && /^\(I (?:try|attempt)\b/i.test(line)) kind = "try";
    }
    line = line.replace(/\s+/g, " ");
    if (line) out.push({ kind, text: line });
  }
  return out;
}

/** What a set of lines is vetted against: see vetting(). */
export interface Vetting {
  /** What the player has said lately in this scene (the latest last). */
  said: string[];
  /** The lines offered last time. */
  offered: string[];
  /** Names the player hasn't heard (people here, or still to come). */
  names: string[];
  /** Word stems of what's still hidden (secrets, what the scene still needs the player to find), the player hasn't met. */
  hidden: string[];
  /** Word stems of the names and places in the prep the player hasn't met (Sallow, the Mending House). */
  proper: string[];
  /** Word stems of the things the scene's limits name as ruled out, the player hasn't met (a séance, a coroner, tomorrow). */
  limits: string[];
  /** A way out fits now (leaveFits). */
  leave: boolean;
}

/** The vetting for the session's moment: what's been said and offered, and what the player has and hasn't met. */
export function vetting(scene: Scene, state: SessionState): Vetting {
  const seen = new Set(words(visibleText(scene, state)).map(stem));
  const fresh = (list: string[]) => [...new Set(list.map(stem).filter(w => w.length >= 4 && !STOP.has(w) && !seen.has(w)))];
  const ordinary = everyday(scene.id);
  const known = knownCast(scene, state);
  const present = new Set(presentCast(scene, state).map(c => c.id));
  const secrets = [
    ...scene.cast.filter(c => present.has(c.id)).flatMap(c => c.secrets ?? []),
    ...(scene.essentials ?? []).filter(e => !state.landed?.includes(e.id)).map(e => e.what),
    ...Object.values(state.world?.entities ?? {}).filter(e => e.tags.includes("hidden") || e.states.includes("hidden")).map(e => `${e.name}. ${e.description ?? ""}`),
  ].join("\n");
  // What a limit rules out, by the things it names in brackets ("a séance, a priest who can call up
  // Prout's ghost"): its other words ("talk to the dead") are too common to rule a line out by.
  const ruledOut = (scene.limits ?? []).flatMap(l => [...limitHead(l).matchAll(/\(([^)]*)\)/g)].map(m => m[1]!)).join("\n");
  return {
    said: sceneEntries(state).filter(e => e.kind === "player").slice(-3).map(e => e.text),
    offered: lastOffered(state),
    names: scene.cast.filter(c => !known.has(c.id)).flatMap(nameTokens),
    // Only the words particular to what's hidden here (a crackle, scuffs, lavender), not the ones any scene uses (trust, read).
    hidden: fresh(words(secrets)).filter(w => !ordinary.has(w)),
    proper: fresh(properNouns(prepText(scene))),
    limits: fresh(words(ruledOut).filter(w => !/ing$/i.test(w))),
    leave: leaveFits(state),
  };
}

/** The names in some text: its capitalised words that don't start a sentence, a line or a quote. */
function properNouns(text: string): string[] {
  return text.split(/[.!?:;]\s+|\n+|["“”‘’()[\]]/).flatMap(sentence => words(sentence).slice(1).filter(w => /^\p{Lu}/u.test(w)));
}

/**
 * Everything the player has met: the scene's hook and the story told so far, who they are, who's here
 * as they look, the place as the screen shows it (what's in it by name, but nothing hidden and nothing
 * in someone else's hands), and what they carry.
 */
function visibleText(scene: Scene, state: SessionState): string {
  const p = state.player as PlayerCharacter & { backstory?: { text?: string } };
  const world = state.world;
  const shown = world ? Object.values(world.entities).filter(e => !e.player && !e.tags.includes("hidden") && !e.states.includes("hidden") && !e.states.includes("gone")
    && !(e.parent && ["person", "creature"].includes(world.entities[e.parent]?.kind ?? "") && !world.entities[e.parent]?.player)).map(e => e.name) : [];
  return [
    scene.hook, state.lead ?? "", ...state.history.map(h => h.summary),
    ...state.transcript.filter(e => e.kind !== "system").map(e => e.text),
    p.name, p.concept, p.build ?? "", p.backstory?.text ?? "",
    ...presentCast(scene, state).map(c => `${c.look} ${c.called ?? ""}`),
    ...[...knownCast(scene, state)].map(id => scene.cast.find(c => c.id === id)?.name ?? ""),
    ...shown, ...carriedNames(state),
  ].join("\n");
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
 * The words any scene might use, as far as this one's concerned: every other scene's prep and the
 * GM's standing instructions. What's hidden here, in words of its own, is what they don't have.
 */
function everyday(sceneId: string): Set<string> {
  const cached = ordinaries.get(sceneId);
  if (cached) return cached;
  corpus ??= new Map([...SCENES, ...ZOO_SCENES].map(s => [s.id, stemsOf(prepText(s))]));
  const out = stemsOf(`${prompt("gm")}\n${prompt("tone-comic")}`);
  for (const [id, stems] of corpus) if (id !== sceneId) for (const w of stems) out.add(w);
  ordinaries.set(sceneId, out);
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
 * player's own words and deeds (a deed is "(I ...)", and speech isn't anyone else's), short enough to
 * read at a glance, no name the player hasn't heard, no word of what's hidden or of a place or name
 * they haven't met, nothing the limits name, nothing they've just said or were offered last time,
 * nothing twice, and a way out only when one fits.
 */
export function screen(candidates: Suggestion[], v: Vetting): { kept: Suggestion[]; dropped: Dropped } {
  const dropped: Dropped = [];
  const kept: Suggestion[] = [];
  const has = (stems: string[], text: string) => words(text).map(stem).find(w => stems.includes(w));
  for (const s of candidates) {
    const why = s.kind === "say" ? (/^[\p{Lu}][\p{L}'’ .-]{0,30}:\s/u.test(s.text) ? "someone else's words" : undefined)
      : !/^\(I\b/.test(s.text) ? "not the player's own deed" : undefined;
    const name = v.names.find(n => new RegExp(`\\b${escape(n)}\\b`, "i").test(s.text));
    const proper = words(s.text).filter(w => /^\p{Lu}/u.test(w)).map(stem).find(w => v.proper.includes(w));
    const reason = why
      ?? (s.text.length > 150 ? "too long" : undefined)
      ?? (name ? `a name not heard: ${name}` : undefined)
      ?? (proper ? `a name or place not met: ${proper}` : undefined)
      ?? (has(v.hidden, s.text) ? `hidden: ${has(v.hidden, s.text)}` : undefined)
      ?? (has(v.limits, s.text) ? `the scene can't offer it: ${has(v.limits, s.text)}` : undefined)
      ?? (v.said.some(t => same(t, s.text)) ? "just said" : undefined)
      ?? (v.offered.some(t => same(t, s.text)) ? "offered last time" : undefined)
      ?? (kept.some(k => same(k.text, s.text)) ? "said twice" : undefined)
      ?? (s.kind === "leave" && !v.leave ? "no way out yet" : undefined);
    if (reason) dropped.push({ text: s.text, why: reason });
    else kept.push(s);
  }
  return { kept, dropped };
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
