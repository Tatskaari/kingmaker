import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_SERVER, keepToken, serverFor, sessionAt } from "./session.ts";

const runsIn = () => mkdtempSync(join(tmpdir(), "km-session-"));

test("a session keeps its identity's token for the next process, readable only by its owner", () => {
  const runs = runsIn();
  try {
    const fresh = sessionAt(runs, "wren");
    assert.equal(fresh.token, undefined);

    keepToken(fresh, "c200abc", "a.jwt.token");

    assert.equal(sessionAt(runs, "wren").token, "a.jwt.token");
    assert.deepEqual(JSON.parse(readFileSync(join(runs, "play", "wren.json"), "utf8")), { identity: "c200abc", token: "a.jwt.token" });
    assert.equal(statSync(join(runs, "play", "wren.json")).mode & 0o777, 0o600);
  } finally {
    rmSync(runs, { recursive: true, force: true });
  }
});

test("a session's name is a file's name, never a path", () => {
  assert.throws(() => sessionAt("runs", "../wren"), /letters, digits, dots, dashes and underscores/);
  assert.throws(() => sessionAt("runs", ".hidden"), /letters, digits/);
});

test("the server: what was asked for, else the running dev stack's, else its defaults", () => {
  const stack = runsIn();
  try {
    assert.deepEqual(serverFor({}, stack), DEFAULT_SERVER);

    mkdirSync(stack, { recursive: true });
    writeFileSync(join(stack, "stack.json"), JSON.stringify({ ws: "ws://127.0.0.1:3350", http: "http://127.0.0.1:3350", db: "kingmaker" }));
    assert.deepEqual(serverFor({}, stack), { url: "ws://127.0.0.1:3350", db: "kingmaker" });
    assert.deepEqual(serverFor({ url: "ws://127.0.0.1:3310", db: "e2e" }, stack), { url: "ws://127.0.0.1:3310", db: "e2e" });

    writeFileSync(join(stack, "stack.json"), JSON.stringify({ http: "http://127.0.0.1:3399" }));
    assert.deepEqual(serverFor({}, stack), { url: "http://127.0.0.1:3399", db: "kingmaker" });
  } finally {
    rmSync(stack, { recursive: true, force: true });
  }
});
