import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync, existsSync, mkdirSync, mountReadOnly, readdirSync, readFileSync, renameSync, requeue, restore, rmSync, statSync,
  takeChanges, unlinkSync, writeFileSync,
} from "./fs.ts";

// The static build's file system (src/web/README.md): the content read-only, runs/ writable and
// journalled for IndexedDB. One file system for the whole process, so each test has paths of its own.

mountReadOnly({ "lore/places/caerwyn.md": "# Caerwyn\n", "prompts/gm.md": "You are the GM." });

const code = (fn: () => unknown) => {
  try { fn(); } catch (error) { return (error as { code?: string }).code; }
  return "no error";
};

test("the content reads as files and directories, relative to the repo, and can't be changed", () => {
  assert.equal(readFileSync("lore/places/caerwyn.md", "utf8"), "# Caerwyn\n");
  assert.equal(readFileSync(new URL("file:///kingmaker/prompts/gm.md"), "utf8"), "You are the GM.");
  assert.deepEqual(readdirSync("/kingmaker/lore"), ["places"]);
  assert.ok(statSync("/kingmaker/lore")!.isDirectory());
  assert.equal(code(() => writeFileSync("/kingmaker/lore/places/caerwyn.md", "changed")), "EROFS");
  assert.equal(code(() => writeFileSync("/kingmaker/lore/new.md", "new")), "EROFS");
  assert.equal(code(() => mkdirSync("/kingmaker/src")), "EROFS");
  assert.equal(code(() => rmSync("/kingmaker/prompts/gm.md")), "EROFS");
  assert.equal(code(() => readFileSync("/kingmaker/lore/nowhere.md")), "ENOENT");
  assert.equal(code(() => readFileSync("/kingmaker/lore")), "EISDIR");
  // Nothing outside runs/ is journalled.
  assert.equal([...takeChanges().keys()].filter(p => !p.startsWith("/kingmaker/runs/")).length, 0);
});

test("runs/ is writable, and every change to a file in it is journalled", () => {
  takeChanges();
  mkdirSync("/kingmaker/runs/sessions/a", { recursive: true });
  writeFileSync("/kingmaker/runs/sessions/a/game.json", "{}");
  appendFileSync("/kingmaker/runs/sessions/a/calls.jsonl", "1\n");
  appendFileSync("/kingmaker/runs/sessions/a/calls.jsonl", "2\n");
  assert.equal(readFileSync("/kingmaker/runs/sessions/a/calls.jsonl", "utf8"), "1\n2\n");
  assert.deepEqual(readdirSync("runs/sessions/a"), ["calls.jsonl", "game.json"]);
  assert.deepEqual(Object.fromEntries(takeChanges()), { "/kingmaker/runs/sessions/a/game.json": "put", "/kingmaker/runs/sessions/a/calls.jsonl": "put" });
  unlinkSync("/kingmaker/runs/sessions/a/calls.jsonl");
  assert.deepEqual(Object.fromEntries(takeChanges()), { "/kingmaker/runs/sessions/a/calls.jsonl": "delete" });
  assert.equal(code(() => writeFileSync("/kingmaker/runs/nowhere/x.json", "{}")), "ENOENT");
  assert.equal(code(() => mkdirSync("/kingmaker/runs/sessions/a")), "EEXIST");
});

test("a rename over a file (a save's write-then-rename) and of a directory (deleting a game: its folder to runs/deleted/)", () => {
  mkdirSync("/kingmaker/runs/sessions/b/snapshots", { recursive: true });
  writeFileSync("/kingmaker/runs/sessions/b/app.json", "old");
  writeFileSync("/kingmaker/runs/sessions/b/app.json.1.tmp", "new");
  writeFileSync("/kingmaker/runs/sessions/b/snapshots/turn-001.json", "{}");
  takeChanges();
  renameSync("/kingmaker/runs/sessions/b/app.json.1.tmp", "/kingmaker/runs/sessions/b/app.json");
  assert.equal(readFileSync("/kingmaker/runs/sessions/b/app.json", "utf8"), "new");
  assert.deepEqual(Object.fromEntries(takeChanges()), { "/kingmaker/runs/sessions/b/app.json": "put", "/kingmaker/runs/sessions/b/app.json.1.tmp": "delete" });

  mkdirSync("/kingmaker/runs/deleted", { recursive: true });
  renameSync("/kingmaker/runs/sessions/b", "/kingmaker/runs/deleted/b");
  assert.equal(existsSync("/kingmaker/runs/sessions/b"), false);
  assert.ok(!readdirSync("/kingmaker/runs/sessions").includes("b"));
  assert.deepEqual(readdirSync("/kingmaker/runs/deleted/b", { recursive: true }), ["app.json", "snapshots", "snapshots/turn-001.json"]);
  assert.equal(readFileSync("/kingmaker/runs/deleted/b/snapshots/turn-001.json", "utf8"), "{}");
  const changes = Object.fromEntries(takeChanges());
  assert.equal(changes["/kingmaker/runs/sessions/b/app.json"], "delete");
  assert.equal(changes["/kingmaker/runs/sessions/b/snapshots/turn-001.json"], "delete");
  assert.equal(changes["/kingmaker/runs/deleted/b/app.json"], "put");
  assert.equal(changes["/kingmaker/runs/deleted/b/snapshots/turn-001.json"], "put");
  // A folder of that name already in runs/deleted/ isn't overwritten (deleteSave picks another name).
  mkdirSync("/kingmaker/runs/sessions/b2", { recursive: true });
  writeFileSync("/kingmaker/runs/sessions/b2/game.json", "{}");
  assert.equal(code(() => renameSync("/kingmaker/runs/sessions/b2", "/kingmaker/runs/deleted/b")), "ENOTEMPTY");
});

test("changes that couldn't be saved go back to the journal, behind any newer change to the same file", () => {
  takeChanges();
  mkdirSync("/kingmaker/runs/sessions/c", { recursive: true });
  writeFileSync("/kingmaker/runs/sessions/c/game.json", "{}");
  writeFileSync("/kingmaker/runs/sessions/c/state.json", "{}");
  const failed = takeChanges();
  rmSync("/kingmaker/runs/sessions/c/state.json");
  requeue(failed);
  assert.deepEqual(Object.fromEntries(takeChanges()), { "/kingmaker/runs/sessions/c/state.json": "delete", "/kingmaker/runs/sessions/c/game.json": "put" });
});

test("saves come back from IndexedDB with their directories and times, under runs/ only", () => {
  restore([
    { path: "/kingmaker/runs/sessions/d/game.json", data: '{"mode":"scene"}', mtimeMs: 1000 },
    { path: "/kingmaker/runs/sessions/d/look.bin", data: new Uint8Array([1, 2, 3]), mtimeMs: 2000 },
    { path: "/kingmaker/lore/places/caerwyn.md", data: "not from a save", mtimeMs: 3000 },
  ]);
  assert.equal(readFileSync("/kingmaker/runs/sessions/d/game.json", "utf8"), '{"mode":"scene"}');
  assert.equal(statSync("/kingmaker/runs/sessions/d/game.json")!.mtimeMs, 1000);
  assert.deepEqual([...readFileSync("/kingmaker/runs/sessions/d/look.bin")], [1, 2, 3]);
  assert.ok(readdirSync("/kingmaker/runs/sessions").includes("d"));
  assert.equal(readFileSync("/kingmaker/lore/places/caerwyn.md", "utf8"), "# Caerwyn\n");
});
