import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { sessionDir } from "../runtime/session.ts";
import { stampOf, type Dump } from "./dump.ts";

/**
 * A report's game as a session of its own (src/cli/report.ts restore), at the moment it was reported:
 * its last save (game.json, state.json, app.json), its snapshots, its calls, the GM's notes and its
 * docs, under a new id. Nothing is overwritten: an id that's taken is refused. The QA console opens
 * it by id, and the app's Continue (or, for a zoo visit, the title's zoo) offers it as the latest.
 *
 * A report made mid-turn restores to the save before the turn (the turn's state in memory is in the
 * report, for reading, but a turn half done isn't a place to carry on from).
 */

/** A restored game: its id, and where it is. */
export interface Restored { id: string; dir: string; from: string }

export function restoreDump(dump: Dump, options: { id?: string } = {}): Restored {
  const game = dump.game;
  if (!game?.files.game || !game.files.state) throw new Error("This report has no game to restore (none had been played, or its saves were missing).");
  for (const [name, file] of [["game.json", game.files.game], ["state.json", game.files.state]] as const) {
    if ((file as { unreadable?: string }).unreadable !== undefined) throw new Error(`Its ${name} couldn't be read when it was reported, so there's nothing to carry on from (it's in the report as text: --json).`);
  }
  const id = options.id ?? `${game.id}-r${stampOf(new Date().toISOString())}`;
  if (!/^[\w.-]+$/.test(id)) throw new Error(`"${id}" won't do as a session id: letters, digits, dots, dashes and underscores only`);
  const dir = sessionDir(id);
  if (existsSync(dir)) throw new Error(`${dir} is already there: a restore never overwrites (--as <another id>)`);

  mkdirSync(join(dir, "snapshots"), { recursive: true });
  // The saves, under the new id (a session's id is inside it too: its background jobs write by it).
  writeJson(dir, "game.json", { ...(game.files.game as object), id });
  writeJson(dir, "state.json", { ...(game.files.state as object), id });
  if (game.files.app) writeJson(dir, "app.json", { ...(game.files.app as object), sessionId: id });
  for (const s of game.snapshots) writeJson(dir, join("snapshots", safe(s.name)), { ...(s.state as object), id });
  // What happened on the way there, as it was.
  writeLines(dir, "calls.jsonl", game.calls.kept);
  writeLines(dir, "memory-reviews.jsonl", game.memoryReviews);
  for (const r of game.repairs) writeJson(dir, safe(r.name), r.repair);
  for (const d of game.docs) {
    const path = join(dir, "docs", safe(d.path));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, d.text);
  }
  return { id, dir, from: game.id };
}

/** A path from the report, kept inside the folder it's written to. */
function safe(path: string): string {
  const clean = normalize(path).replace(/^([/\\])+/, "");
  if (clean.startsWith("..") || clean.includes("\0")) throw new Error(`The report names a file outside its game's folder: ${path}`);
  return clean;
}

function writeJson(dir: string, name: string, value: unknown): void {
  writeFileSync(join(dir, name), JSON.stringify(value, null, 1));
}

function writeLines(dir: string, name: string, values: unknown[]): void {
  if (values.length) writeFileSync(join(dir, name), values.map(v => JSON.stringify(v)).join("\n") + "\n");
}
