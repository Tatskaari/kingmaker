import { existsSync, readFileSync } from "node:fs";
import { worldView } from "../world/scene-world.ts";
import { PHYSICS } from "../world/systems.ts";
import { join } from "node:path";
import type { Beat, Character, Exit, Scene, Transition } from "./scene.ts";
import type { Entry, ScenePatch, SessionState } from "./session.ts";
import { titleCase } from "./dice.ts";

const PROMPTS_DIR = join(import.meta.dirname, "..", "..", "prompts");
const cache = new Map<string, string>();
/** A prompt by name. KM_PROMPTS_DIR tries another folder first (a variant to compare in the evals). */
export function prompt(name: string, vars: Record<string, string> = {}): string {
  let text = cache.get(name);
  if (text === undefined) {
    const variant = process.env.KM_PROMPTS_DIR ? join(process.env.KM_PROMPTS_DIR, `${name}.md`) : undefined;
    text = readFileSync(variant && existsSync(variant) ? variant : join(PROMPTS_DIR, `${name}.md`), "utf8").trim();
    cache.set(name, text);
  }
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "").replace(/\n{3,}/g, "\n\n");
}

/**
 * Every scene can also end in a way its prep didn't foresee, established in play (leaving with
 * someone, settling things another way). The world scribe makes it true afterwards. Without it, a
 * good improvised resolution has nowhere to go and the GM ends up retracting it.
 */
export const IMPROVISED_EXIT_ID = "own-ending";
export function withImprovisedEnding(scene: Scene): Scene {
  if (scene.exits.some(e => e.id === IMPROVISED_EXIT_ID)) return scene;
  // When every authored exit that continues goes to the same scene, an ending of their own does too.
  const nexts = [...new Set(scene.exits.map(e => e.next).filter((n): n is string => !!n))];
  return {
    ...scene,
    exits: [...scene.exits, {
      id: IMPROVISED_EXIT_ID, kind: "other", title: "An ending of their own",
      outcome: "The scene ends in a way the prep didn't foresee, as established in play.",
      closing: "Close on the moment the player chose, at the threshold, without narrating what comes next.",
      ...(nexts.length === 1 ? { next: nexts[0]! } : {}),
    }],
    anytime: [...(scene.anytime ?? []), {
      id: "improvised-ending", on: "outcome",
      when: "The scene's central matter has been settled, or left behind, in a way none of the other endings describe (the player resolved it their own way, or set off elsewhere with it), and nothing more needs to happen here.",
      to: IMPROVISED_EXIT_ID,
    }],
  };
}

/**
 * The authored scene as play has it: what the co-GM has added during play, and what the boundary
 * brought over from earlier scenes. An essential the scene preps for if the player missed it
 * earlier (`missed`) is the scene's only once the boundary has brought it over, and a route that
 * brings an essential the scene hasn't got isn't there.
 */
export function effectiveScene(authored: Scene, patches: ScenePatch[]): Scene {
  const scene = withImprovisedEnding(authored);
  const brought = patches.flatMap(p => (p.essential ? [p.essential] : []));
  if (!patches.length && !scene.essentials?.some(e => e.missed)) return scene;
  // The scene's own essentials, and what the boundary brought (in place of the scene's prep for it).
  const essentials = [...(scene.essentials ?? []).filter(e => !e.missed && !brought.some(b => b.id === e.id)), ...brought];
  const has = new Set(essentials.map(e => e.id));
  const live = (t: Transition) => !t.essential || has.has(t.essential);
  const beats = scene.beats.map(b => ({ ...b, transitions: b.transitions.filter(live) }));
  for (const patch of patches) {
    if (patch.beat && !beats.some(b => b.id === patch.beat!.id)) beats.push({ ...patch.beat, transitions: [...patch.beat.transitions] });
  }
  const anytime = (scene.anytime ?? []).filter(live);
  for (const patch of patches) {
    if (!patch.transition) continue;
    // "*" = scene-wide, so a later tracker move can't strand a route the player is pursuing.
    if (patch.transition.beat === "*") { if (!anytime.some(t => t.id === patch.transition!.transition.id)) anytime.push(patch.transition.transition); continue; }
    const beat = beats.find(b => b.id === patch.transition!.beat);
    if (beat && !beat.transitions.some(t => t.id === patch.transition!.transition.id)) beat.transitions.push(patch.transition.transition);
  }
  // What someone is keeping back now (the latest word on it wins).
  const cast = !patches.some(p => p.cast) ? scene.cast : scene.cast.map(c => {
    const amended = patches.filter(p => p.cast?.id === c.id).at(-1)?.cast;
    return amended ? { ...c, secrets: [...amended.secrets] } : c;
  });
  // Routes a ruling ruled out: gone from their beat (or from anywhere), wherever they came from.
  const closed = patches.filter(p => p.close).map(p => p.close!);
  for (const b of beats) if (closed.length) b.transitions = b.transitions.filter(t => !closed.some(c => c.beat === b.id && c.id === t.id));
  const open = closed.length ? anytime.filter(t => !closed.some(c => c.beat === "*" && c.id === t.id)) : anytime;
  return { ...scene, beats, anytime: open, cast, ...(scene.essentials || brought.length ? { essentials } : {}) };
}

export function currentBeat(scene: Scene, state: SessionState): Beat {
  const beat = scene.beats.find(b => b.id === state.beat);
  if (!beat) throw new Error(`Session ${state.id}: current beat ${state.beat} not in scene ${scene.id}`);
  return beat;
}

export function targetTitle(scene: Scene, id: string): string {
  const beat = scene.beats.find(b => b.id === id);
  if (beat) return beat.title;
  const exit = scene.exits.find(e => e.id === id);
  return exit ? `the scene ends: ${exit.title}` : id;
}

export function visitedBeats(state: SessionState): Set<string> {
  return new Set([state.beat, ...state.path.map(p => p.from), ...state.path.map(p => p.to)]);
}

export function presentCast(scene: Scene, state: SessionState): Character[] {
  const visited = visitedBeats(state);
  return scene.cast.filter(c => state.entered?.includes(c.id) || (!state.absent?.includes(c.id) && (!c.enters || visited.has(c.enters))));
}

const TITLES = new Set(["the", "a", "an", "big", "old", "young", "little", "master", "mister", "mr", "mrs", "miss", "sergeant", "corporal", "captain", "marshal", "king", "queen", "sir", "lady", "lord", "dame"]);

/** Everything the player has been told or shown: these hooks, and every line of play but the dice (their own turns too). */
export const heardIn = (state: SessionState, hooks: string[]) => [...hooks, ...state.transcript.filter(e => e.kind !== "roll").map(e => e.text)].join("\n");
const namedIn = (c: Pick<Character, "name" | "aka">, heard: string) => nameTokens(c).some(t => new RegExp(`\\b${t}\\b`).test(heard));

/**
 * Text the player will read (a dice line), with everyone whose name they haven't heard called what
 * they'd call them: "Master Sallow" is "the gentleman with the silver-topped cane" until someone says it.
 */
export function asHeard(text: string, unheard: Array<{ name: string; called: string; aka?: string[] }>): string {
  // Names as they're written (capitalised: "Will" is a name, "will" isn't), with any titles in front ("Master Sallow", "big Hobb").
  const titles = [...TITLES].flatMap(t => [t, t[0]!.toUpperCase() + t.slice(1)]).join("|");
  let out = text;
  for (const s of unheard) {
    // The whole name first, then any part of it.
    for (const part of [s.name, ...nameTokens(s)]) {
      out = out.replace(new RegExp(`\\b(?:(?:${titles})\\s+)*${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}('s)?\\b`, "g"), (_, own?: string) => `${s.called}${own ?? ""}`);
    }
  }
  return out;
}

/**
 * The cast the player has heard named: in anything said or shown so far (the hook, every reply,
 * their own turns), by any part of the name that isn't a title. People without a `called` aren't
 * tracked: they count as known.
 */
export function knownCast(scene: Scene, state: SessionState): Set<string> {
  const heard = heardIn(state, [scene.hook]);
  return new Set(scene.cast.filter(c => !c.called || namedIn(c, heard)).map(c => c.id));
}

/**
 * Across several scenes (a boundary's: the one just played and those the story may go to next),
 * the people whose names the player hasn't heard, with what the player would call them: as the
 * first of the scenes to card them has it. `hooks`: what the player was shown of the scenes played.
 */
export function strangers(scenes: Scene[], state: SessionState, hooks: string[]): Array<{ name: string; called: string }> {
  const heard = heardIn(state, hooks);
  const first = new Map<string, Character>();
  for (const c of scenes.flatMap(s => s.cast)) if (!first.has(c.id)) first.set(c.id, c);
  return [...first.values()].filter(c => c.called && !namedIn(c, heard)).map(c => ({ name: c.name, called: c.called! }));
}

/** The parts of someone's names that mean them in text ("Kell", "Agnes"; not "Sergeant"). */
export function nameTokens(c: Pick<Character, "name" | "aka">): string[] {
  return [...c.name.split(/[\s-]+/), ...(c.aka ?? [])].map(t => t.replace(/[^\w']/g, "")).filter(t => t.length >= 3 && !TITLES.has(t.toLowerCase()));
}

/** What to call the cast whose names the player hasn't heard yet. */
export function unnamed(scene: Scene, state: SessionState): Record<string, string> {
  const known = knownCast(scene, state);
  return Object.fromEntries(scene.cast.filter(c => c.called && !known.has(c.id)).map(c => [c.id, c.called!]));
}

export function offstageCast(scene: Scene, state: SessionState): Character[] {
  const present = new Set(presentCast(scene, state).map(c => c.id));
  return scene.cast.filter(c => !present.has(c.id));
}

const bullets = (items: readonly string[] | undefined, none = "- (nothing in particular)") => items?.length ? items.map(i => `- ${i}`).join("\n") : none;

function castBlock(scene: Scene, c: Character, present: boolean): string {
  const lines = [
    `### ${c.name}${c.group ? ` (${c.group})` : ""}`,
    `- Look: ${c.look}`,
    `- Voice: ${c.voice}`,
    `- Wants: ${c.wants}`,
    ...(c.fears ? [`- Fears: ${c.fears}`] : []),
    `- Knows:\n${c.knows.map(k => `  - ${k}`).join("\n")}`,
    ...(c.secrets?.length ? [`- Secrets (they come out only when earned):\n${c.secrets.map(s => `  - ${s}`).join("\n")}`] : []),
    `- Attitude at the start, and what brings them round (your prep: they never spell it out): ${c.attitude}`,
  ];
  if (!present && c.enters) lines.push(`- Not on stage yet: arrives when the scene reaches "${targetTitle(scene, c.enters)}".`);
  return lines.join("\n");
}

function exitBlock(exit: Exit): string {
  return `- ${exit.title}: ${exit.outcome}`;
}

/**
 * Who the player character is, in a line for a model's brief: their name and concept, and from their
 * backstory (character creation's) who they are, in a sentence or two.
 */
export function playerWho(state: SessionState): string {
  const p = state.player;
  return `${p.name}: ${p.concept}${p.backstory?.summary ? `. ${p.backstory.summary}` : ""}`;
}

/**
 * The player character's own backstory, for the GM: who they are in short (every brief), and where
 * the whole of it is (`inNotes`: the GM's notes from the docs service have it, so it isn't repeated;
 * otherwise it's here in full). Their past, known in the story only where someone would know it.
 */
function backstoryBrief(state: SessionState, inNotes: boolean): string {
  const b = state.player.backstory;
  if (!b?.text.trim()) return "";
  // A trait in its own words may end in a full stop ("I owe Fat Jory three crowns."): the list has its own.
  const bare = (t: string) => t.trim().replace(/[.;:,]+$/, "");
  const traits = ([["personality", b.personality], ["ideals", b.ideals], ["bonds", b.bonds], ["flaws", b.flaws]] as const).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.map(bare).join("; ")}`);
  return [
    `\nWho they are, from their own backstory: ${b.summary}${traits.length ? ` (${traits.join(". ")}.)` : ""}`,
    inNotes ? "The whole of their backstory, in their own words, is in your notes (the player character's doc)." : `Their backstory, in their own words:\n${b.text.trim().split(/\n+/).map(l => `> ${l}`).join("\n")}`,
    "It's their past, and true for them: let it colour the world when it would (a face from home, an old debt coming due, a name that means something to them), but people in the story know of it only what they'd plausibly know (someone from that past, something that was public) or what the player tells or shows them. Nobody brings it up out of nowhere. What it says of the story's own people and places is what they believe or heard: where your prep says otherwise, your prep is the truth.",
    "When the player tells someone of their past without saying it word for word (\"I tell her where I'm from\"), they tell it as their backstory has it: show what they told, in its own details, and how the listener takes it.",
  ].join("\n");
}

/**
 * Who knew the player character before the story began: none of its people (whoever sent for them
 * aside). Without it the GM yes-ands a leading line ("Sergeant, you'll remember me") into an old
 * acquaintance, and puts the scene's own secrets in it (Prout's visit to the watch house, as theirs).
 */
const STRANGER = "Before the story began, none of its people had met them (whoever sent for them aside): they know them only from what's happened in play since, and of their past only what they'd plausibly know or have been told. If the player claims an old acquaintance with one of them (\"You'll remember me\"), it isn't so, and that person says so in their own way; people from the player's own past are another matter.";

/** Stable prep for the GM: everything that doesn't change turn to turn (cache-friendly prefix). */
export function sceneBrief(scene: Scene, state: SessionState, options: { secrets?: boolean; hideEssentials?: boolean; lastHandoffOnly?: boolean; docs?: boolean } = {}): string {
  options = { secrets: true, ...options };
  const present = new Set(presentCast(scene, state).map(c => c.id));
  const cast = scene.cast.map(c => castBlock(scene, options.secrets ? c : { ...c, secrets: [] }, present.has(c.id))).join("\n\n");
  const last = state.history.at(-1);
  return [
    `# Your prep for this scene: ${scene.title}`,
    `## The place\n${scene.setting}`,
    `## What this scene is about\n${scene.premise}`,
    ...(scene.background?.length ? [`## Background\n${bullets(scene.background)}`] : []),
    ...(last ? [`## What happened just before this scene\nThis is what actually happened in the story. Where it disagrees with this prep about the state of the fiction (who is where, who has what, what was said), what happened wins: adapt the prep to it. It doesn't change what this scene is about. It's your knowledge, not everyone's: people here know only what they saw, did or have been told, so someone who wasn't there doesn't know it unless they hear it.\n\n${(options.lastHandoffOnly ? [last] : state.history).map(h => h.summary).join("\n\n")}${options.lastHandoffOnly && state.history.length > 1 ? "\n\n(Earlier scenes are in the story notes under \"What people remember\".)" : ""}${last.lastMoments?.length ? `\n\nThe last moments, word for word:\n${last.lastMoments.map(m => `> ${m}`).join("\n")}` : ""}`] : []),
    ...(state.adjustments?.length ? [`## Where the prep is out of date\nThe story has moved on from parts of this prep. These are true now, and they override anything in the prep that says otherwise:\n${bullets(state.adjustments)}`] : []),
    `## The people here\n${cast}`,
    `## Ways this scene can end\nThese are the only ways it can close. The player's choices decide which; don't force one.\n${scene.exits.map(exitBlock).join("\n")}`,
    ...(scene.essentials?.length && !options.hideEssentials ? [`## What the player needs to come across\nThe author placed these somewhere specific. Players often go elsewhere: when they do, don't let the scene starve. Move the thing to whatever they are engaging with (another person who could know it, an object, an event), or nudge softly (a remark, a telltale detail, a chance to notice or remember), so it reaches them through the path they chose.\n${scene.essentials.map(e => `- ${e.what} (placed with: ${e.placedWith.join("; ")}). It opens up: ${e.unlocks}${e.missed ? " [missed in an earlier scene, and the story still needs it: what it's in stays where the world has it, with whoever has it]" : ""}${state.landed?.includes(e.id) ? " [already come across]" : state.hinted?.includes(e.id) ? " [already hinted at: the player has had a sign of it. Don't point at it again; let them take it up, or let it reach them another way]" : ""}`).join("\n")}`] : []),
    ...(scene.limits?.length ? [`## What this scene can't offer\nIf the player reaches for one of these, let the world say no honestly, in the fiction, and show them what is possible instead.\n${bullets(scene.limits)}`] : []),
    `## The player character\n${state.player.name}: ${state.player.concept}.${state.player.build ? ` In game terms: ${state.player.build}; their spells, weapons and gear are what their sheet says.` : ""} They are the only player character. Other people only know their name if they've been told it. ${STRANGER}${skillSummary(state)}${backstoryBrief(state, !!options.docs)}`,
    `## Table rules (for out-of-character questions)\n${state.rules
      ? "- The game runs D&D rules: it rolls the dice for checks, saving throws, spells, attacks and rests, and you're told each result (🎲). You never roll, ask for a roll or invent numbers.\n- The player can see their character sheet out of game (/sheet). Levels come at story milestones. A real fight moves to the battle map."
      : "- The game rolls a d20 plus a skill modifier at the scene's key moments; you'll be told the result. You don't roll or promise rolls yourself.\n- There's no experience or loot system yet."}\n- Scenes play in order; a scene can be brief, but it can't be skipped.\n- Your prep (what the scene is about, secrets, how it can end) stays behind the screen.`,
  ].join("\n\n");
}

function transitionLine(scene: Scene, t: Transition): string {
  if (t.check) {
    const fail = t.check.onFailure ? targetTitle(scene, t.check.onFailure) : "the scene carries on from here";
    return `- ${t.when} The dice decide (${titleCase(t.check.skill)}): success leads to ${targetTitle(scene, t.check.onSuccess)}; failure means ${fail}.`;
  }
  return `- ${t.when} Leads to ${targetTitle(scene, t.to!)}.`;
}

/** Strongest and weakest skills, so the GM narrates competence consistently and can answer "what am I good at?". */
function skillSummary(state: SessionState): string {
  const mods = Object.entries(state.player.modifiers).filter((e): e is [string, number] => typeof e[1] === "number").sort((a, b) => b[1] - a[1]);
  if (!mods.length) return "";
  const show = (xs: Array<[string, number]>) => xs.map(([k, v]) => `${titleCase(k)} ${v >= 0 ? "+" : ""}${v}`).join(", ");
  return `\nGood at: ${show(mods.slice(0, 4))}. Weak at: ${show(mods.slice(-3).reverse())}. (Skill modifiers for the dice; talk about them in plain words, not numbers, unless the player asks out of character.)`;
}

/**
 * Routes already achieved in this visit to the current beat: they looped back here having done
 * their work (a check won, a thing done). Offering them again invites a second roll for something
 * already settled, and a failure that takes back what was said. Failed checks stay open.
 */
export function spentHere(state: SessionState): Set<string> {
  const spent = new Set<string>();
  for (let i = state.path.length - 1; i >= 0; i--) {
    const p = state.path[i]!;
    if (p.to !== state.beat) break;
    if (p.from !== state.beat) break;
    if (p.roll?.success !== false) spent.add(p.via);
  }
  return spent;
}

/** The routes to offer now: not one already achieved here, nor one that brings what the player has already come across. */
export function openRoutes(transitions: Transition[], state: SessionState): Transition[] {
  const spent = spentHere(state);
  return transitions.filter(t => !spent.has(t.id) && !(t.essential && state.landed?.includes(t.essential)));
}

/** The per-turn note: where we are, what moves things on, co-GM notes and this reply's direction. */
const GUARD_NOTE: Record<string, string> = {
  surface: "nothing has shown yet. What would show first is something that doesn't fit: a dodge, a slip, a reaction they can't quite hide.",
  tell: "something has shown. If the player picks at it, their guard goes up, and something personal shows (someone or something they care about that bears on it).",
  stirred: "guard up. If the player keeps at it, what they're torn between comes out, in their own words: a worry, or a question to the player that shows it, never terms.",
  torn: "torn, in the open. Next, the thing itself comes out (told, bargained over or refused, depending on how the player has treated them), one piece at a time as the questions reach it.",
  settled: "settled. They answer follow-ups as far as what they know.",
};

/** Staged secrets: where each holder present stands, and the one step they can take next. */
function guardNote(scene: Scene, state: SessionState): string | undefined {
  const holders = presentCast(scene, state).filter(c => c.secrets?.length);
  if (!holders.length || !state.guard) return undefined;
  return `## How far people have opened up\nPeople give up what they're hiding the way they would at a good table: something that doesn't fit shows first; picked at, their guard goes up and something personal shows; kept at, what they're torn between comes out in their own words; only then does the thing itself come out, told, bargained over or refused, depending on how the player has treated them. A reply takes someone one step at most, and only when the player has given them a reason; proof, or leverage that really reaches them, can take them straight to the end. Nothing that's out goes back in.\n${holders.map(c => `- ${c.name}: ${GUARD_NOTE[state.guard?.[c.id]?.stage ?? "surface"]}`).join("\n")}`;
}

export function nowNote(scene: Scene, state: SessionState, directive: string[], options: { castNotes?: boolean; remind?: string } = {}): string {
  const beat = currentBeat(scene, state);
  const present = new Set(presentCast(scene, state).map(c => c.id));
  const castNotes = Object.entries(beat.cast ?? {}).filter(([id]) => present.has(id))
    .map(([id, note]) => `- ${scene.cast.find(c => c.id === id)?.name ?? id}: ${note}`);
  const transitions = openRoutes([...beat.transitions, ...(scene.anytime ?? [])], state);
  const strangers = Object.entries(unnamed(scene, state)).filter(([id]) => present.has(id)).map(([id, called]) => `- ${scene.cast.find(c => c.id === id)!.name}: "${called}"`);
  const parts = [
    `## Where the scene is now: ${beat.title}\n${beat.direction}`,
    // Cast notes are a beat's opening agenda: once voiced, re-sending them turns them into repeated lines.
    ...(options.castNotes !== false && castNotes.length && state.turnsInBeat <= 1 ? [`What people are after in this part of the scene (they pursue it naturally, react first to what just happened, and don't repeat themselves):\n${castNotes.join("\n")}`] : []),
    ...(options.castNotes !== false && castNotes.length && state.turnsInBeat > 1 ? [`People have already made their wants known here (${castNotes.map(n => n.split(":")[0]!.slice(2)).join(", ")}): now they act on them, wait, change tack or give ground; they don't restate them.`] : []),
    // Pressure is for stalls, and fires once: offered every turn, it gets replayed word for word.
    ...(beat.pressure && state.turnsInBeat >= 2 && !state.pressureOffered?.includes(beat.id) ? [`The scene has been sitting here a while. If it's stalling or drifting, the world can push: ${beat.pressure}`] : []),
    `(The scene has been at this point for ${state.turnsInBeat} exchange${state.turnsInBeat === 1 ? "" : "s"}.)`,
    `## What moves the scene on from here\n${transitions.map(t => transitionLine(scene, t)).join("\n")}`,
    ...(guardNote(scene, state) ? [guardNote(scene, state)!] : []),
    // Co-GM notes steer the middle of a scene; a closing works from what happened, not stale steering.
    ...(!state.closing && !state.pendingExit && (state.notes || state.whispers?.length) ? [`## Notes from your co-GM (for you, written a moment ago: let them shape what people do, but nobody recites them; if the player has since chosen otherwise, the player's choice wins)\n${[state.notes ?? "", ...(state.whispers ?? []).map(w => `- On ${scene.cast.find(c => c.id === w.to)?.name ?? w.to}'s mind: ${w.note}`)].filter(Boolean).join("\n")}`] : []),
    ...(state.canon.length || state.established.length ? [`## Details established in play (keep them true)\n${bullets([...state.established, ...state.canon])}`] : []),
    ...(playerNow(state) ? [playerNow(state)!] : []),
    ...(strangers.length ? [`## Names the player hasn't heard yet\nUntil someone in the story says their name, the narration (and anyone who wouldn't know it) doesn't use it: call them what the player would.\n${strangers.join("\n")}`] : []),
    ...(state.world ? [`## The world right now\nWhere everyone and everything is, and what state it's in (ids in brackets). Keep to it, since it's updated after every reply: people and things are where it says, and what's destroyed, burning or gone stays that way until the story changes it. Details it doesn't list are yours to invent, consistent with it.\n${PHYSICS}\n\n${worldView(state.world)}`] : []),
    // A word on the reply's form comes before what it must do, which has the last word.
    ...(options.remind ? [options.remind] : []),
    ...(directive.length ? [`## For this reply\n${directive.join("\n\n")}`] : []),
  ];
  return parts.join("\n\n");
}

/** The player's state from the rules, when it should show in the story: hurt, or under a condition. */
function playerNow(state: SessionState): string | undefined {
  const status = state.rules?.status;
  if (!status) return undefined;
  const hp = /^HP (\d+)\/(\d+)/.exec(status);
  const hurt = !!hp && Number(hp[1]) < Number(hp[2]);
  const conditions = status.split(", ").slice(1).filter(p => !p.startsWith("spell slots") && !/^\d/.test(p));
  return hurt || conditions.length ? `## The player character now\n${status}. Let it show: someone hurt moves and looks hurt.` : undefined;
}

export function sceneEntries(state: SessionState): Entry[] {
  return state.transcript.filter(e => (e.scene ?? state.sceneId) === state.sceneId);
}

export function speakerName(scene: Scene, state: SessionState, speaker: string): string {
  if (speaker === "player") return state.player.name;
  if (speaker === "gm") return "GM";
  return scene.cast.find(c => c.id === speaker)?.name ?? speaker;
}

/** Script-style transcript, used for actors, deciders and the repair agent. */
export function scriptTranscript(scene: Scene, state: SessionState, entries = sceneEntries(state)): string {
  return entries.map(e => {
    if (e.kind === "roll" || e.kind === "system") return `[${e.text}]`;
    const name = speakerName(scene, state, e.speaker);
    return e.speaker === "player" ? `${name} (player): ${e.text}` : `${name}: ${e.text}`;
  }).join("\n\n");
}
