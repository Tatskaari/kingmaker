// Copied from the prototype's src/runtime/engine.ts at 44c6d4a: chainScene's middle (1070-1091), rememberBetween (1094-1114), crossBoundary (1161-1242) and moveOn (1262-1286), with the usual edits (a TurnView for the session, the request's calls through respond and respondJson, the campaign's scenes for sceneById). chainScene starts at what's owed: the candidates are the simulation's (shared/scene/graph.ts candidatesOf, engine.ts:1060-1069), and what it pushed onto the session and handed on to the next scene's (the history entry, the scene's own state, what's owed and brought over) is returned, for the simulation to keep. The memory "docs" approach's records are written once for a boundary, so a rerun after a crash writes none twice: the ending's and the time between's lines in the GM's notes on each person (rememberBetween's and broadcastEnding's, since the memories became those notes) are kept once, and the played scene is skipped when its doc is there. Presence (gm/presence.ts) is asked here, after the hand-off, rather than as the next scene opens. journalOf isn't copied: the notebook's lines are the simulation's rows.

import { characterEntry, errandsOf, readDoc, savePlayedScene, seedDoc, titleOf } from "../docs/docs.ts";
import { frontsText, moveFronts, type FrontChanges } from "../docs/fronts.ts";
import { note, type NotePerson, type NoteSection } from "../docs/notes.ts";
import type { Decider } from "../llm/decide.ts";
import { respond, respondJson, type CallContext } from "../llm/openrouter.ts";
import type { Chapter } from "../../shared/protocol/ai.ts";
import type { ScenePatch } from "../../shared/gm/state.ts";
import { nameTokens } from "../../shared/scene/names.ts";
import type { Cond } from "../../shared/scene/files.ts";
import type { Exit, Scene } from "../../shared/scene/types.ts";
import type { SceneWorld } from "../../shared/world/scene-world.ts";
import { sceneEntries, strangers } from "./brief.ts";
import { bringOver, OWED_INSTRUCTION, owedAtEnd, owedKey, owedPrep, owedSchema, owedText, type Owed, type OwedVerdict } from "./owed.ts";
import { settlePresence } from "./presence.ts";
import type { TurnView } from "./view.ts";
import { workingSet } from "./working-set.ts";

/** How a boundary's calls go, and the story it reads. */
export interface BoundaryCall {
  /** This request's model calls. */
  calls: CallContext;
  /** A scene of the campaign as play has it (the prototype's sceneById: an ending of its own added). Throws for one it hasn't got. */
  sceneById(id: string): Scene;
  /** Who decides who's here as the next scene opens (the v2 approach's luna-decisions). */
  decider: Decider;
}

/** The boundary crossed: the history entry of the scene just played, what's handed on to the next, what's still owed, what moved in the fronts. */
export interface Crossed {
  chapter: Chapter & { lastMoments: string[] };
  next: { scene: string; skipped: Array<{ sceneId: string; why: string }>; adjustments: string[]; opening?: string; lead?: string; absent: string[]; patches: ScenePatch[]; hinted: string[] };
  owed: Owed[];
  fronts: string[];
}

/**
 * Across the boundary into the first of `candidates` that still holds (chainScene, once the scene
 * has finished and its candidates are known): the hand-off, the verdict and the fronts at once, then
 * the scene's records in the game's docs, its last moments, who's here when the next one opens, and
 * what's still owed carried on.
 */
export async function chainScene(scene: Scene, state: TurnView, exit: Exit, candidates: Scene[], how: BoundaryCall, combatResult = "the party won"): Promise<Crossed> {
  // What the story still owes the player (missed here or before), from the world as this scene leaves it.
  const owed = owedAtEnd(scene, state);
  const { handoff, sceneId, adjustments, skipped, opening, lead, fronts, owed: verdict } = await crossBoundary(scene, state, exit, combatResult, candidates, undefined, owed, how);
  const next = how.sceneById(sceneId);
  // (The v2 approach's memory is "docs": the GM's notes on each person, at the ending and for the time between, and the played scene.)
  notesAtEnd(scene, next, state, exit);
  rememberBetween(scene, next, state, lead, adjustments);
  if (!readDoc(state.id, `story/scenes/${scene.id}.md`)) savePlayedScene(state.id, scene, exit.title, handoff);
  const lastMoments = sceneEntries(state).filter(e => e.kind !== "system").slice(-4)
    .map(e => e.kind === "player" ? `${state.player.name} (player): ${e.text}` : e.kind === "dialogue" ? `${scene.cast.find(c => c.id === e.speaker)?.name ?? e.speaker}: ${e.text}` : e.text);
  const chapter = { sceneId: scene.id, exitId: exit.id, summary: handoff, lastMoments, ...(skipped.length ? { skipped } : {}), ...(fronts.length ? { fronts } : {}), ...(state.established.length ? { facts: [...state.established] } : {}) };
  // Who from earlier scenes is there as it opens: by the hand-off, and what's true by then (the prototype asked as it opened).
  const absent = await settlePresence(next, { history: [...state.history, chapter], adjustments }, how.decider).catch(() => [] as string[]);
  // What's still owed goes on, and what can come up in the next scene is one of its essentials.
  const brought = bringOver(state, next, owed, verdict);
  return {
    chapter,
    next: { scene: sceneId, skipped, adjustments, ...(opening ? { opening } : {}), ...(lead ? { lead } : {}), absent, patches: brought.patches, hinted: brought.hinted },
    owed: brought.owed,
    fronts,
  };
}

/** Someone the notes are about, by their cast id: as the scenes' cast names them, else as their lore entry does. */
function personOf(id: string, cast: Map<string, NotePerson>): NotePerson {
  const known = cast.get(id);
  if (known) return known;
  const entry = characterEntry(id);
  const lore = entry ? seedDoc(entry) : undefined;
  return { id, name: lore ? titleOf(lore) : id };
}

/** Whether an effect holds as the scene ends: its `if` facts all established, its `unless` facts none (the simulation's holdsIn, story/effects.ts). */
function holdsAtEnd(scene: Scene, state: TurnView): (e: Cond) => boolean {
  const known = new Set(state.established);
  const isTrue = (id: string) => { const sentence = scene.facts?.[id]; return sentence !== undefined && known.has(sentence); };
  const listOf = (facts: string | string[] | undefined) => (facts === undefined ? [] : typeof facts === "string" ? [facts] : facts);
  return e => listOf(e.if?.established).every(isTrue) && !listOf(e.unless?.established).some(isTrue);
}

const firstName = (name: string) => name.split(" ")[0] ?? name;

/**
 * What the scene's end says of each person, in the GM's notes on them (docs/notes.ts), from its
 * effects as play made them hold, the ending's and the scene's own: an attitude is their standing
 * ("Friendly: The King's investigator made Prout's case properly."), a memory is a line of what they
 * did, a promise is in the notes of each side; and everyone there with no memory of it from the
 * ending has that they were there when it ended (V1's milestone broadcast, so the ending is never
 * left to chance). A boundary run again adds nothing: a line the notes have already is kept as it is.
 */
function notesAtEnd(scene: Scene, next: Scene, state: TurnView, exit: Exit): void {
  const cast = new Map([...next.cast, ...scene.cast].map(c => [c.id, { id: c.id, name: c.name }]));
  const at = { scene: scene.id, turn: state.turn };
  const player = firstName(state.player.name);
  const nameOf = (id: string) => (id === "$player" ? player : personOf(id, cast).name);
  const write = (id: string, section: NoteSection, line: string) => {
    if (id === "$player") return;
    try { note(state.id, personOf(id, cast), section, line, { origin: at }); } catch { /* best effort, as the boundary's other records are */ }
  };
  const holds = holdsAtEnd(scene, state);
  const remembered = new Set<string>();
  for (const e of [...(exit.effects ?? []), ...(scene.onEnd ?? [])].filter(holds)) {
    if (e.op === "attitude") write(e.who, "standing", `${e.to.charAt(0).toUpperCase()}${e.to.slice(1)}: ${e.text}`);
    else if (e.op === "remember") { write(e.who, "did", `${scene.title}, as it ended: ${e.text}`); remembered.add(e.who); }
    else if (e.op === "promise") {
      write(e.by, "promises", `Promised ${nameOf(e.to)}: ${e.text}`);
      write(e.to, "promises", `${nameOf(e.by)} promised them: ${e.text}`);
    }
  }
  for (const c of workingSet(scene, state).present) if (!remembered.has(c.id)) write(c.id, "did", `Was there when ${scene.title} ended: ${exit.title}.`);
}

/**
 * What the boundary says of someone in the time between (what the player heard of it, in the lead;
 * how things stand for them, in the adjustments) goes into the GM's notes on them, so the next
 * scene's GM and their talks know it as theirs. Kell's afternoon at the Purveyor's wagons was in the
 * lead, and in the talk that followed she flatly denied it: her memories held only the granary. Only
 * the people of the scene that ended lived the time between: someone the next scene brings on has
 * no line of it (the lead's "followed the big man to the Rat" was never Hobb's doing, and what the
 * adjustments say of him is that scene's prep already).
 */
function rememberBetween(scene: Scene, next: Scene, state: TurnView, lead: string | undefined, adjustments: string[]): void {
  const between = `Between ${scene.title} and ${next.title}`;
  for (const c of scene.cast) {
    const names = (text: string) => nameTokens(c).some(t => new RegExp(`\\b${t}\\b`).test(text));
    const lines = [...(lead && names(lead) ? [`${between}, as ${firstName(state.player.name)} heard it: ${lead}`] : []), ...adjustments.filter(names).map(a => `${between}: ${a}`)];
    for (const line of lines) {
      try { note(state.id, { id: c.id, name: c.name }, "did", line, { origin: { scene: next.id, turn: state.turn } }); } catch { /* best effort, as the boundary's other records are */ }
    }
  }
}

/**
 * What the player character holds as a scene ends, by its world, in a line (as the GM's world view
 * lists it): the hand-off and the verdict say who holds what from it as well as from the transcript,
 * which says nothing of what an ending gave, or of a scene ended for QA, whose things were taken
 * without a word. Undefined with no world, or no player in it.
 */
function carriedOf(world: SceneWorld | undefined): string | undefined {
  if (!world?.entities.player) return undefined;
  const held = Object.values(world.entities).filter(e => e.parent === "player" && !e.states.includes("gone"));
  return held.length ? held.map(e => `${(e.quantity ?? 1) > 1 ? `${e.quantity} ` : ""}${e.name}`).join(", ") : "nothing";
}

/**
 * The scene boundary: the hand-off (the state of things as established in play), and, in parallel,
 * which upcoming scene still holds (a scene whose premise play has already settled or bypassed is
 * skipped) and where that scene's prep is out of date. Prep is written before play; this is where
 * it catches up. What the story still owes the player (`owed`) is judged in the same call: found
 * after all, or whether it can come up in that scene, and where (gm/owed.ts).
 */
async function crossBoundary(scene: Scene, state: TurnView, exit: Exit, combatResult: string, candidates: Scene[], frontsDoc: string | undefined, owed: Owed[], how: BoundaryCall): Promise<{ handoff: string; sceneId: string; adjustments: string[]; skipped: Array<{ sceneId: string; why: string }>; opening?: string; lead?: string; fronts: string[]; owed?: OwedVerdict[] }> {
  const transcript = sceneEntries(state).map(e => e.kind === "player" ? `${state.player.name} (player): ${e.text}` : e.kind === "dialogue" ? `${scene.cast.find(c => c.id === e.speaker)?.name ?? e.speaker}: ${e.text}` : e.kind === "narration" ? `GM: ${e.text}` : `[${e.text}]`).join("\n\n");
  const ended = `${exit.title} (${scene.id}: ${exit.id}). ${exit.outcome}${exit.kind === "combat" ? ` The fight was then played out on the map: ${combatResult}.` : ""}`;
  const carries = carriedOf(state.world);
  const story = [
    ...(state.history.length ? [`## The story before the last scene\n${state.history.map(h => h.summary).join("\n\n")}`] : []),
    `## The last scene: ${scene.title}\nHow it ended: ${ended}\nThe player character: ${state.player.name}, ${state.player.concept} (the only player character).${carries === undefined ? "" : `\nWhat the player character carries as it ends, by the world's record (what play put in their hands, and what the ending gave them): ${carries}.`}\n\n${transcript}`,
  ].join("\n\n");
  const prep = (c: Scene) => [
    `### ${c.id}: ${c.title}`,
    `What it's about (the GM's question, not the player's): ${c.premise}`,
    c.assumes?.length ? `It takes for granted:\n${c.assumes.map(a => `- ${a}`).join("\n")}` : "It takes nothing for granted: it always holds.",
    `Its opening (its time and place): ${c.opening}`,
    ...(c.background?.length ? [`Its background: ${c.background.join(" ")}`] : []),
    // (With something owed, their ids: the verdict names who there could bring it out.)
    `Its people: ${c.cast.map(p => `${p.name}${owed.length ? ` [${p.id}]` : ""} (${p.look.slice(0, 220)}${p.look.length > 220 ? "..." : ""})`).join("; ")}`,
    ...(owed.length && owedPrep(c, owed) ? [owedPrep(c, owed)!] : []),
  ].join("\n");
  // The time between: what the people the story carries on with (the last scene's, who are in the
  // scenes to come) do on their own, from their lore, which is as true as play; and the names the
  // player hasn't heard, which mean nothing to them yet. The way on is told from those and from play.
  const onward = new Set(candidates.flatMap(c => c.cast.map(p => p.id)));
  const errands = scene.cast.filter(c => onward.has(c.id)).flatMap(c => { const text = errandsOf(state.id, c.id); return text ? [`### ${c.name}\n${text}`] : []; });
  const hookOf = (id: string) => { try { return how.sceneById(id).hook; } catch { return ""; } };
  const unheard = strangers([scene, ...candidates], state, [...state.history.map(h => hookOf(h.sceneId)), scene.hook]);
  const between = [
    ...(errands.length ? [`## What people do between scenes (their lore, GM only)\nWhat each of the people the story goes on with does on their own if nobody stops them. In the time before the next scene it happens as written, unless what happened in play rules it out (they were taken in, hurt or sent elsewhere, or the reason for it is gone). Whatever begins with an \"if\" happens only when play has made the if true (if Prout went into the book as a suicide, nothing that follows his going in as a murder happens). They know only what they did and saw, and the player only what they're told of it or were there for.\n\n${errands.join("\n\n")}`] : []),
    ...(unheard.length ? [`## Names the player hasn't heard\nNobody has said these names where the player could hear: to the player, each is only what's in quotes until someone does.\n${unheard.map(s => `- ${s.name}: "${s.called}"`).join("\n")}`] : []),
  ];
  const handoff = respond({
    operation: "handoff", effort: "low",
    instructions: "You write the hand-off between two scenes of a roleplaying game, for the GM of the next scene. Describe the state of things in the story at the moment the last scene ended, exactly as it was established in play (not as anyone planned it): who is where and in what state, who holds what, what was promised or agreed, what the player character learned, and how people feel. Always keep, when there are any: what anyone confessed or admitted, in their own words and in whose hearing; what was found, handed over or taken, and who has it now; and what each person who goes on with the player (a partner, a companion) saw and heard for themselves, from where they were, so they can tell it or swear to it later. Things that were offered but refused, or threatened but not done, didn't happen. Leave out anything said out of character (questions or agreements about the game itself). Be concrete and brief: a short paragraph, then up to eight bullet points.",
    input: [{ role: "user", content: story }],
    calls: how.calls,
  }).then(r => `Previous scene, "${scene.title}", ended: ${exit.title} (${scene.id}: ${exit.id}).\n${r.text.trim()}`).catch(() => `Previous scene, "${scene.title}", ended: ${ended}`);
  const verdict = respondJson<{ scenes: Array<{ id: string; holds: boolean; why: string }>; adjustments: string[]; opening: string; lead: string; owed?: Array<Omit<OwedVerdict, "here"> & { here: boolean }> }>({
    operation: "boundary", effort: "low",
    instructions: [
      "The upcoming scenes of a roleplaying game were written before play. Check them against what has actually happened in the story, and bring the player on to the next one.",
      "Everything you write must already be true: what happened in play, or what people did on their own in the time between scenes, as their lore below says. Make up no fact and no source for one: no record, message, witness, order or find that neither of those has (the one exception is the lead's, below, when play gave the player no way on). The player knows only what they saw and heard in play and what someone tells them, and knows nobody by name until they've heard the name: the list below has the people of these scenes whose names they haven't, and the same goes for anyone else.",
      "1. scenes: for each upcoming scene, in order, judge whether what it takes for granted still holds. A scene is overtaken when play has already done, prevented or bypassed what it is about (its central matter is settled, the people it needs are gone, the thing it's built around has already happened).",
      "2. adjustments: for the first upcoming scene that still holds, list each point where its prep (what it's about, its opening, its background, its people) no longer matches the story: where someone is or what state they're in, who holds what, what people know, what has already happened. The scene's own time and place stand (it may start after a gap, such as the next morning): say what's true by then. Nobody is there sooner than its prep brings them on (\"at the midnight bell the Master comes\") unless play has sent them there already: that's the scene's to play. Write each as a short statement of what is true instead, so its GM can adapt (\"Hobb is in the watch-house cells, not on the hoist.\"). Leave out everything that still fits. An empty list is fine.",
      "3. opening: that scene's opening direction, rewritten so it starts where the story actually is. Keep the author's intent (the place, the mood, what a first glance shows, what to end on, and who isn't there yet: \"Don't show Master Sallow: he isn't here yet\") and drop or change only what the adjustments make untrue; never replay something that has already happened (an arrival, a first meeting, a discovery). Write it as the author did: directions for its GM (what to show, in what order, what to end on: \"End on the landlady asking the sergeant whether she's on duty\"), never the scene's prose or its spoken lines; the GM writes those. It's told to the player, so anyone whose name they haven't heard goes by what they'd call them. If nothing needs changing, return the author's opening as it is.",
      "4. lead: one or two sentences of second-person fiction that the player reads as the time passes. Having read it, they know where the story goes next (that first scene that holds: its place), why they're going and what they hope to find out there, in their own terms (what they've seen and been told, never what the scene is about), and how the time between passed for them. Its reasons are what they learned in play and what someone tells them of what they did in the time between (in that person's own reasoning, as their lore has it), joined up the way the player would join them; never the coming scenes' prep or the GM's truth, not even as a hope. Anyone whose name they haven't heard goes by what they'd call them, and anyone they've never met or heard of comes in as they were seen (\"a woman in a grey hood\"). What someone tells them doesn't go against what that person said in play: what they found out since is told as new (\"I couldn't tell you who, this morning; this afternoon I saw him\"). It's always the story, never a note about it (what the story does or doesn't say, or that there's no lead): if play gave them no reason to go there, they pick up the trail in the time between from someone who'd know and say (a regular at the last place, a neighbour, whoever was about), told as plainly as that, and no more than that person would know. No game talk.",
      ...(owed.length ? [OWED_INSTRUCTION] : []),
    ].join("\n"),
    input: [{ role: "user", content: [story, ...between, ...(owed.length ? [owedText(owed)] : []), `## Upcoming scenes, in order (the GM's prep, written before play: the player knows none of it)\n${candidates.map(prep).join("\n\n")}`].join("\n\n") }],
    json: { name: "boundary", schema: { type: "object", additionalProperties: false, required: ["scenes", "adjustments", "opening", "lead", ...(owed.length ? ["owed"] : [])], properties: {
      scenes: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "holds", "why"], properties: { id: { type: "string" }, holds: { type: "boolean" }, why: { type: "string" } } } },
      adjustments: { type: "array", items: { type: "string" } },
      opening: { type: "string" },
      lead: { type: "string" },
      ...(owed.length ? { owed: owedSchema([...new Set(candidates.flatMap(c => c.cast.map(p => p.id)))]) } : {}),
    } } },
    calls: how.calls,
  }).catch(() => undefined);
  // What's in motion in the world (the GM's fronts), as it stands in this game, moves on here too.
  const frontsPath = frontsDoc ?? scene.fronts ?? candidates.find(c => c.fronts)?.fronts;
  const fronts = frontsPath ? frontsText(state.id, frontsPath) : undefined;
  const moving = fronts ? moveOn(story, candidates[0]!, fronts, how.calls) : Promise.resolve(undefined);
  const [text, result, motion] = await Promise.all([handoff, verdict, moving]);
  const moved = frontsPath && motion ? moveFronts(state.id, frontsPath, motion, scene.title) : [];
  // The first scene that holds: one that takes nothing for granted always does.
  const holds = (c: Scene) => !c.assumes?.length || result?.scenes.find(v => v.id === c.id)?.holds !== false;
  const chosen = candidates.find(holds) ?? candidates.at(-1)!;
  const skipped = candidates.slice(0, candidates.indexOf(chosen)).map(c => ({ sceneId: c.id, why: result?.scenes.find(v => v.id === c.id)?.why ?? "" }));
  // The rewritten opening is for the scene the verdict was about: the first that holds.
  const firstHolding = result ? candidates.find(c => !c.assumes?.length || result.scenes.find(v => v.id === c.id)?.holds !== false) : undefined;
  const opening = firstHolding?.id === chosen.id && result?.opening?.trim() ? result.opening.trim() : undefined;
  const lead = firstHolding?.id === chosen.id && result?.lead?.trim() ? result.lead.trim() : undefined;
  const shows = chosen.id === candidates[0]!.id ? motion?.shows ?? [] : [];
  const adjustments = [...(result?.adjustments ?? []).slice(0, 10), ...shows.slice(0, 2)].map(a => a.trim()).filter(Boolean);
  // What's owed: found after all (that's about the last scene), and whether and where it comes up
  // next (only when the verdict was about the scene the story goes to).
  const judged = result?.owed?.filter(v => owed.some(o => owedKey(o) === v.id))
    .map((v): OwedVerdict => firstHolding?.id === chosen.id ? v : { id: v.id, found: v.found, placedWith: [], carriers: [], why: v.why });
  return { handoff: text, sceneId: chosen.id, adjustments, skipped, ...(opening ? { opening } : {}), ...(lead ? { lead } : {}), fronts: moved, ...(judged ? { owed: judged } : {}) };
}

/**
 * The world's turn at a scene boundary: which steps of what's in motion (the fronts doc) play or
 * the time passing has made true or meaningless, any new bills to come due, and how what's newly
 * true shows in the next scene. Runs alongside the boundary verdict.
 */
async function moveOn(story: string, next: Scene, fronts: string, calls: CallContext): Promise<(FrontChanges & { shows: string[] }) | undefined> {
  const step = { type: "object", additionalProperties: false, required: ["front", "step"], properties: { front: { type: "string" }, step: { type: "string" } } };
  return respondJson<FrontChanges & { shows: string[] }>({
    operation: "fronts", effort: "low",
    instructions: [
      "You keep a roleplaying game's world moving between scenes, whether or not the player is looking. Below are the story so far, the next scene (its time and place), and what's in motion: fronts, each with a clock of steps.",
      "- ticked: the unticked steps (\"- [ ]\") that what happened, or the time passing until the next scene opens, has now made true. Give each by its front (the ## heading) and the step's bold opening words. A step ticks because its condition is met or its hour has come, never because it would be dramatic, and nobody acts on what they couldn't have learned (each step says who learns what, and from whom).",
      "- struck: unticked steps that play has made impossible or meaningless (the person is arrested, dead or gone, the thing destroyed, the matter settled), with why in a few words.",
      "- bills: usually none. When the player did something reckless, violent or daft in the last scene that the world would answer later, a line for each such consequence: \"If <what happened>: <who answers it, how, and where it will show>\". The bills already listed are on their way: never add one again, and add only what none of them covers. At most two.",
      "- shows: what's newly true that the player could meet in the next scene, by how it shows there (something seen, or someone who'd say it), as short statements of fact for its GM, and first any bill (listed already, or new) that comes due there, as what happens there and who brings it (\"Sallow gives his account of the Heron first: he calls the investigator a violent intruder and the true book stolen\"). Only what fits the next scene's time and place, at most one per front and from no more than two fronts. Often none.",
    ].join("\n"),
    input: [{ role: "user", content: `${story}\n\n## The next scene: ${next.title}\nWhen and where: ${next.setting}\nIts opening: ${next.opening}\n\n## What's in motion (GM only)\n${fronts}` }],
    json: { name: "fronts", schema: { type: "object", additionalProperties: false, required: ["ticked", "struck", "bills", "shows"], properties: {
      ticked: { type: "array", items: step },
      struck: { type: "array", items: { ...step, required: ["front", "step", "why"], properties: { ...step.properties, why: { type: "string" } } } },
      bills: { type: "array", items: { type: "string" } },
      shows: { type: "array", items: { type: "string" } },
    } } },
    calls,
  }).catch(() => undefined);
}
