import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { StoryState } from "../game/types.ts";
import { sessionSpend } from "../llm/openrouter.ts";
import { sessionDir, type SessionState } from "../runtime/session.ts";
import { sceneById } from "../../scenes/index.ts";

/**
 * What the app adds to the game core's story flow (src/game/play.ts owns the flow itself, and the
 * combat module the fight's line-up): the notebook lines a scene's ending writes, the epilogue, and
 * words for the time of day.
 */

export const LEVEL = 3;
export const DEFAULT_NAME = "Wren Ashdown";
export const DEFAULT_CONCEPT = "a quick-witted half-elf ranger with a longbow, a dry sense of humour and a soft spot for underdogs";

export const TIME_WORDS: Record<StoryState["time"], string> = {
  morning: "Morning, on the eve of the Assembly",
  afternoon: "Afternoon, on the eve of the Assembly",
  evening: "Evening, on the eve of the Assembly",
  night: "Night, before the midnight bells",
  "next-morning": "The morning of the Assembly",
};

export const timeOf = (sceneId: string): StoryState["time"] => {
  try { return sceneById(sceneId).time ?? "morning"; } catch { return "morning"; }
};

/**
 * What the investigator's notebook says about how a scene ended: the exit's world script writes it
 * ("Big Hobb talked..."). The session forgets the script's operations once the story moves on, so
 * read them from the scene's last snapshot, the one taken as it ended.
 */
export function notebookLines(session: SessionState, sceneId: string): string[] {
  const dir = join(sessionDir(session.id), "snapshots");
  if (!existsSync(dir)) return [];
  const last = readdirSync(dir).filter(f => f.startsWith(`${sceneId}-turn-`)).sort().at(-1);
  if (!last) return [];
  try {
    const snapshot = JSON.parse(readFileSync(join(dir, last), "utf8")) as SessionState;
    return (snapshot.ended?.operations ?? []).filter(o => o.op === "journal").map(o => String(o.args["entry"] ?? "")).filter(Boolean);
  } catch { return []; }
}

export interface Epilogue {
  closing: string;
  chapters: Array<{ sceneId: string; title: string; ending: string }>;
  spentUsd: number;
}

/** The End: the last scene's closing narration and how each scene ended. */
export function epilogue(session: SessionState): Epilogue {
  const last = [...session.transcript].reverse().find(e => e.kind === "narration" && e.scene === session.sceneId);
  const chapter = (sceneId: string, exitId: string) => {
    const scene = sceneById(sceneId);
    return { sceneId, title: scene.title, ending: scene.exits.find(e => e.id === exitId)?.title ?? exitId };
  };
  const chapters = session.history.filter(h => !sceneById(h.sceneId).interlude).map(h => chapter(h.sceneId, h.exitId));
  if (session.ended) chapters.push(chapter(session.sceneId, session.ended.exitId));
  return { closing: last?.text ?? "And that, as they say in Caerwyn, was that.", chapters, spentUsd: sessionSpend() };
}
