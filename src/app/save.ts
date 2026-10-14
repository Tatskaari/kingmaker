import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CombatSetup, StoryState } from "../game/types.ts";
import { loadSession, runsDir, sessionDir, type SessionState } from "../runtime/session.ts";
import type { Position } from "./adapters.ts";

/**
 * The app's own state, saved next to the session (runs/sessions/<id>/app.json): where the player
 * stands, what mode the game is in and the story as the map sees it. The session itself is saved by
 * the runtime after every turn; together they resume the game.
 */

export type Mode = "explore" | "scene" | "combat" | "end";

export interface JournalEntry { sceneId: string; title: string; ending: string; lines: string[] }

export interface AppSave {
  version: 1;
  sessionId: string;
  mode: Mode;
  pos: Position;
  /** Where the player stood before the open scene began (they go back outside after it). */
  before?: Position;
  story: StoryState;
  /** A fight in progress restarts from its setup on resume (the stand-in keeps no mid-fight state). */
  combat?: CombatSetup;
  /** Explore messages, newest last. */
  messages: string[];
  /** The investigator's notebook: what each scene came to, in the exit scripts' own words. */
  journal?: JournalEntry[];
  savedAt: string;
}

const file = (id: string) => join(sessionDir(id), "app.json");

export function saveApp(save: Omit<AppSave, "version" | "savedAt">): void {
  const dir = sessionDir(save.sessionId);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `app.json.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify({ version: 1, ...save, savedAt: new Date().toISOString() }, null, 1));
  renameSync(tmp, file(save.sessionId));
}

export function loadApp(id: string): AppSave | undefined {
  try { return JSON.parse(readFileSync(file(id), "utf8")) as AppSave; } catch { return undefined; }
}

export interface Resumable { save: AppSave; session: SessionState; mtime: number }

/** Saved games, most recent first (sessions the app made: they have an app.json). */
export function resumable(limit = 5): Resumable[] {
  const root = join(runsDir(), "sessions");
  if (!existsSync(root)) return [];
  const found: Resumable[] = [];
  for (const id of readdirSync(root)) {
    if (!existsSync(file(id))) continue;
    try {
      const save = loadApp(id);
      if (!save || save.mode === "end") continue;
      found.push({ save, session: loadSession(id), mtime: statSync(file(id)).mtimeMs });
    } catch { /* a broken save is skipped */ }
  }
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}
