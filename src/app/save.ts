import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GameState } from "../game/play.ts";
import { loadSession, runsDir, sessionDir, type SessionState } from "../runtime/session.ts";

/**
 * Saves. The game core keeps the game (runs/sessions/<id>/game.json: mode, story, where the player
 * stands, the fight) and the runtime the session (state.json). The app adds its own extras beside
 * them (app.json): the investigator's notebook and the latest messages from the map.
 */

export interface JournalEntry { sceneId: string; title: string; ending: string; lines: string[] }

export interface AppExtras {
  version: 2;
  sessionId: string;
  messages: string[];
  journal: JournalEntry[];
  savedAt: string;
}

const extrasFile = (id: string) => join(sessionDir(id), "app.json");
const gameFile = (id: string) => join(sessionDir(id), "game.json");

export function saveExtras(extras: Omit<AppExtras, "version" | "savedAt">): void {
  const dir = sessionDir(extras.sessionId);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `app.json.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify({ version: 2, ...extras, savedAt: new Date().toISOString() }, null, 1));
  renameSync(tmp, extrasFile(extras.sessionId));
}

export function loadExtras(id: string): AppExtras | undefined {
  try {
    const extras = JSON.parse(readFileSync(extrasFile(id), "utf8")) as Partial<AppExtras>;
    return { version: 2, sessionId: id, messages: extras.messages ?? [], journal: extras.journal ?? [], savedAt: extras.savedAt ?? "" };
  } catch { return undefined; }
}

export interface Resumable { id: string; game: GameState; session: SessionState; mtime: number }

/** Story games in progress, most recent first (games that have reached The End are left out, and so are zoo visits). */
export function resumable(limit = 5): Resumable[] {
  return saves(game => !game.hub).slice(0, limit);
}

/** Zoo visits (src/game/zoo), most recent first: the title's zoo carries on the latest. */
export function zooVisits(limit = 5): Resumable[] {
  return saves(game => game.hub === "zoo").slice(0, limit);
}

/** The game played last, whatever it was (the story's or a zoo visit, finished or not): what a report from the title is about. */
export function latestGame(): Resumable | undefined {
  return saves(() => true, { ended: true })[0];
}

function saves(keep: (game: GameState) => boolean, options: { ended?: boolean } = {}): Resumable[] {
  const root = join(runsDir(), "sessions");
  if (!existsSync(root)) return [];
  const found: Resumable[] = [];
  for (const id of readdirSync(root)) {
    if (!existsSync(gameFile(id))) continue;
    try {
      const game = JSON.parse(readFileSync(gameFile(id), "utf8")) as GameState;
      if ((game.mode === "end" && !options.ended) || !keep(game)) continue;
      found.push({ id, game, session: loadSession(id), mtime: statSync(gameFile(id)).mtimeMs });
    } catch { /* a broken save is skipped */ }
  }
  return found.sort((a, b) => b.mtime - a.mtime);
}

/**
 * Deletes a game from the title screen's list: its folder moves to runs/deleted/ (its logs are kept
 * there, for whoever wants to see what happened), so it's no longer offered.
 */
export function deleteSave(id: string): void {
  const from = sessionDir(id);
  if (!existsSync(from)) return;
  const bin = join(runsDir(), "deleted");
  mkdirSync(bin, { recursive: true });
  renameSync(from, existsSync(join(bin, id)) ? join(bin, `${id}-${Date.now()}`) : join(bin, id));
}
