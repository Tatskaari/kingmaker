import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
process.env.KM_RUNS_DIR = mkdtempSync(join(tmpdir(), "km-saves-"));
const { deleteSave, resumable } = await import("./save.ts");
const { sessionDir } = await import("../runtime/session.ts");

/** A game in progress on disk, as the app and the runtime leave it (just enough to be listed). */
function saved(id: string, name: string): void {
  mkdirSync(sessionDir(id), { recursive: true });
  writeFileSync(join(sessionDir(id), "game.json"), JSON.stringify({ mode: "explore", story: {} }));
  writeFileSync(join(sessionDir(id), "state.json"), JSON.stringify({ id, sceneId: "hanged-clerk", player: { name }, transcript: [] }));
  writeFileSync(join(sessionDir(id), "calls.jsonl"), "{}\n");
}

test("a deleted game is no longer offered, and its folder (logs and all) goes to runs/deleted", () => {
  saved("game-a", "Tamsin Vell");
  saved("game-b", "Odo Brack");
  assert.deepEqual(resumable().map(r => r.id).sort(), ["game-a", "game-b"]);
  deleteSave("game-a");
  assert.deepEqual(resumable().map(r => r.id), ["game-b"]);
  assert.equal(existsSync(sessionDir("game-a")), false);
  assert.ok(existsSync(join(process.env.KM_RUNS_DIR!, "deleted", "game-a", "calls.jsonl")));
  // The same id deleted again (a new game that happened to get it) doesn't overwrite the first.
  saved("game-a", "Tamsin Vell");
  deleteSave("game-a");
  assert.equal(readdirSync(join(process.env.KM_RUNS_DIR!, "deleted")).filter(d => d.startsWith("game-a")).length, 2);
  // A game that's already gone is nothing to delete.
  assert.doesNotThrow(() => deleteSave("never-was"));
});
