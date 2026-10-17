// New: the story's rows at the arc's moments (story-design §1.2), as closeScene, the boundary and fight_it_out would leave them, for the screen check, the demo and the client's tests. The words are the campaign's as it was before M2 re-authored the hanged clerk (its open-case ending: the tests' own hanged clerk, shared/scene/testdata/hanged-clerk.kmscene, still has it) and the prototype's fallback hand-off.
import { storyViewOf, type StoryRows } from "../story/rows.ts";
import type { StoryView } from "../story/view.ts";
import type { SceneView } from "../scene/view.ts";
import { YARD } from "./fixture.ts";

/** The players: Pell Marrow (1) has the lead; Tamsin Vell (2) watches. */
export const LEAD = 1n;

/** The hanged clerk's open-case, as it was before M2 (the tests' own hanged clerk has it). */
export const OPEN_CASE = {
  ending: "Murder by persons unknown",
  journal: "Prout was murdered. The watch has it down as persons unknown.",
  quest: "Prout's death is on the books as murder by persons unknown.",
  handOff: [
    'Previous scene, "The Hanged Clerk", ended: Murder by persons unknown (hanged-clerk: open-case).',
    "- Prout was murdered, and the watch has it down as persons unknown.",
    "- Sergeant Kell walks with the investigator.",
  ].join("\n"),
};

/**
 * The yard ended through open-case (scene 7), as closeScene leaves it: its chapter with no hand-off
 * yet, the notebook's line, the quest advanced, the flag, Kell's attitude and Kell walking with the
 * investigator, and the boundary in flight (moving). The game's time is still the yard's.
 */
export function clerkEnded(): StoryRows {
  return {
    game: { time: "morning", status: "playing", leadScene: "hanged-clerk", leadText: undefined, onward: "moving", onwardNote: undefined },
    scenes: [{ id: 7n, sceneKey: "hanged-clerk", title: "The Hanged Clerk", status: "ended" }],
    chapters: [{ sceneId: 7n, seq: 1, title: "The Hanged Clerk", ending: OPEN_CASE.ending, summary: "", costMicros: 0n }],
    quests: [{ id: 1n, key: "hanged-clerk", title: "The Hanged Clerk", status: "active", stage: "murder_unnamed", notes: [OPEN_CASE.quest] }],
    flags: [{ id: 1n, name: "prout_death", value: "murder, unnamed" }],
    journal: [{ sceneId: 7n, seq: 1, text: OPEN_CASE.journal }],
    attitudes: [{ castKey: "kell", playerId: LEAD, attitude: "friendly", reason: "The King's investigator took the case seriously." }],
    followers: [{ castKey: "kell", name: "Sergeant Agnes Kell", leaderId: LEAD }],
    turns: [{ costMicros: 4_100n }, { costMicros: 3_900n }, { costMicros: 4_000n }],
  };
}

/** The boundary committed: the chapter's hand-off and cost, the Rat waiting (scene 8) as the lead, evening. `lead`: the boundary's words for it. */
export function ratWaiting(lead?: string): StoryRows {
  const rows = clerkEnded();
  return {
    ...rows,
    game: { time: "evening", status: "playing", leadScene: "drowned-rat", leadText: lead, onward: undefined, onwardNote: undefined },
    scenes: [...rows.scenes, { id: 8n, sceneKey: "drowned-rat", title: "The Drowned Rat", status: "waiting" }],
    chapters: [{ ...rows.chapters[0]!, summary: OPEN_CASE.handOff, costMicros: 12_000n }],
  };
}

/** The Heron's fight fought (scene 10, still being played): the Rat's chapter in, and the stand-in's line in the notebook. */
export function heronFought(): StoryRows {
  const rows = ratWaiting();
  return {
    ...rows,
    game: { time: "night", status: "playing", leadScene: "heron-warehouse", leadText: undefined, onward: undefined, onwardNote: undefined },
    scenes: [{ ...rows.scenes[0]! }, { id: 8n, sceneKey: "drowned-rat", title: "The Drowned Rat", status: "ended" }, { id: 10n, sceneKey: "heron-warehouse", title: "The Heron Warehouse", status: "live" }],
    chapters: [...rows.chapters, { sceneId: 8n, seq: 2, title: "The Drowned Rat", ending: "What Big Hobb knows", summary: 'Previous scene, "The Drowned Rat", ended: What Big Hobb knows (drowned-rat: hobb-talks).', costMicros: 11_000n }],
    journal: [...rows.journal, { sceneId: 8n, seq: 2, text: "Big Hobb named the Heron Warehouse." }, { sceneId: 10n, seq: 3, text: "The fight wasn't played: it's told as won." }],
  };
}

/** The King's ending went nowhere: The End, every scene a chapter. */
export function storyOver(): StoryRows {
  const rows = heronFought();
  return {
    ...rows,
    game: { time: "next-morning", status: "ended", leadScene: "kings-morning", leadText: undefined, onward: undefined, onwardNote: undefined },
    scenes: [...rows.scenes.slice(0, 2), { id: 10n, sceneKey: "heron-warehouse", title: "The Heron Warehouse", status: "ended" }, { id: 11n, sceneKey: "kings-morning", title: "The King's Morning", status: "ended" }],
    chapters: [...rows.chapters,
      { sceneId: 10n, seq: 3, title: "The Heron Warehouse", ending: "Caught in the act", summary: "", costMicros: 13_000n },
      { sceneId: 11n, seq: 4, title: "The King's Morning", ending: "Done right by", summary: "", costMicros: 0n }],
    journal: [...rows.journal, { sceneId: 11n, seq: 4, text: "The King has the ledger, and Sallow's initials on every lost wagon." }],
  };
}

/** The story's view of some rows, for Pell Marrow. */
export const storyOf = (rows: StoryRows): StoryView => storyViewOf(rows, LEAD, key => (key === "kell" ? "Sergeant Agnes Kell" : undefined));

/** The yard, ended through open-case: its last reply, then "Scene ends", the box shut; with the story as `rows` have it. */
export function yardOver(rows: StoryRows = clerkEnded(), more: Partial<SceneView> = {}): SceneView {
  return {
    ...YARD,
    entries: [...YARD.entries, { turn: 3, speaker: "system", kind: "system", text: `Scene ends: ${OPEN_CASE.ending}` }],
    phase: "done", mayType: false, over: true, suggestions: [], story: storyOf(rows), ...more,
  };
}

/** The Rat, as walk opens it (scene 8): its opening being written. */
export function ratOpening(rows: StoryRows = ratWaiting()): SceneView {
  return {
    ...YARD, sceneId: "8", title: "The Drowned Rat", time: "Evening",
    hook: "The Drowned Rat leans over the river stairs like a drunk over a rail.",
    present: [YARD.present[0]!, { key: "hobb", name: "the big man with the bandaged hand", color: "#c79bf2" }],
    entries: [], phase: "replying", turn: 0, mayType: false,
    draft: { speaker: "gm", kind: "narration", text: "The Drowned Rat smells of river and old beer.", attempt: 1, seq: 1 },
    suggestions: [], suggestionsComing: true, story: storyOf({ ...rows, scenes: rows.scenes.map(s => (s.id === 8n ? { ...s, status: "opening" } : s)) }),
  };
}
