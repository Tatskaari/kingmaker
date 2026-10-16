import type { Attitude, Chapter, Flag, Follower, Game, Journal, Quest, Scene, Turn } from "../module_bindings/types.ts";
import type { NotebookEntry, StoryView } from "./view.ts";

/**
 * The story's view from the game's rows (story-design §4.5): the game row's boundary in flight and
 * its lead; the game's scenes (the lead's waiting one, a scene still being played); the story tables
 * the endings write (chapter, quest, flag, journal, attitude, follower); and every turn's cost. Pure:
 * the connection keeps the rows, and the scene's view carries this beside it. The rows are the
 * bindings' types narrowed to what's read here, so a change to the schema shows in the type check.
 */

export interface StoryRows {
  game: Pick<Game, "time" | "status" | "leadScene" | "leadText" | "onward" | "onwardNote">;
  scenes: Array<Pick<Scene, "id" | "sceneKey" | "title" | "status">>;
  chapters: Array<Pick<Chapter, "sceneId" | "seq" | "title" | "ending" | "summary" | "costMicros">>;
  quests: Array<Pick<Quest, "id" | "key" | "title" | "status" | "stage" | "notes">>;
  flags: Array<Pick<Flag, "id" | "name" | "value">>;
  journal: Array<Pick<Journal, "sceneId" | "seq" | "text">>;
  attitudes: Array<Pick<Attitude, "castKey" | "playerId" | "attitude" | "reason">>;
  followers: Array<Pick<Follower, "castKey" | "name" | "leaderId">>;
  /** Each turn's cost, every scene's: the GM's bar tab. */
  turns: Array<Pick<Turn, "costMicros">>;
}

const ONWARD: ReadonlyArray<NonNullable<StoryView["onward"]>> = ["moving", "waiting", "failed"];

/**
 * The story as it stands, for the scene's lead (`lead`: whose followers walk with them, and how the
 * cast stand towards them), the cast named as the player knows them (`name`, by key).
 */
export function storyViewOf(rows: StoryRows, lead: bigint, name: (key: string) => string | undefined = () => undefined): StoryView {
  const { game } = rows;
  const onward = ONWARD.find(o => o === game.onward);
  const note = onward ? game.onwardNote : undefined;
  const waiting = game.leadScene === undefined ? undefined : rows.scenes.find(s => s.sceneKey === game.leadScene && s.status === "waiting");
  const theirs = rows.followers.filter(f => f.leaderId === lead);
  const spent = [...rows.turns, ...rows.chapters].reduce((sum, r) => sum + r.costMicros, 0n);
  return {
    time: game.time,
    ended: game.status === "ended",
    ...(onward ? { onward } : {}),
    ...(note ? { note } : {}),
    ...(waiting ? { lead: { key: waiting.sceneKey, title: waiting.title, ...(game.leadText ? { text: game.leadText } : {}) } } : {}),
    with: (theirs.length ? theirs : rows.followers).map(f => ({ key: f.castKey, name: f.name })),
    notebook: notebookOf(rows),
    quests: [...rows.quests].sort((a, b) => Number(a.id - b.id)).map(q => ({ key: q.key, title: q.title, status: q.status, ...(q.stage ? { stage: q.stage } : {}), notes: [...q.notes] })),
    flags: [...rows.flags].sort((a, b) => Number(a.id - b.id)).map(f => ({ name: f.name, value: f.value })),
    attitudes: rows.attitudes.filter(a => a.playerId === lead).map(a => ({ who: name(a.castKey) ?? rows.followers.find(f => f.castKey === a.castKey)?.name ?? a.castKey, attitude: a.attitude, reason: a.reason })),
    spentUsd: Number(spent) / 1e6,
  };
}

/**
 * The notebook (the prototype's journal entries, from its history): each scene played, by the order
 * it was played, its lines in theirs, and how things stood after it (the hand-off after its first
 * line); then a scene still being played whose fight is on the record already, as the prototype
 * notes a fight ("A fight").
 */
function notebookOf(rows: StoryRows): NotebookEntry[] {
  const linesOf = (sceneId: bigint) => rows.journal.filter(j => j.sceneId === sceneId).sort((a, b) => a.seq - b.seq).map(j => j.text);
  const chapters = [...rows.chapters].sort((a, b) => a.seq - b.seq);
  const entries: NotebookEntry[] = chapters.map(c => {
    const stood = c.summary.split("\n").slice(1).join("\n").trim();
    return { sceneId: String(c.sceneId), title: c.title, ending: c.ending, lines: linesOf(c.sceneId), ...(stood ? { stood } : {}), chapter: true };
  });
  const open = [...new Set(rows.journal.map(j => j.sceneId))].filter(id => !chapters.some(c => c.sceneId === id));
  for (const id of open.sort((a, b) => Number(a - b))) {
    entries.push({ sceneId: String(id), title: rows.scenes.find(s => s.id === id)?.title ?? "This scene", ending: "A fight", lines: linesOf(id), chapter: false });
  }
  return entries;
}
