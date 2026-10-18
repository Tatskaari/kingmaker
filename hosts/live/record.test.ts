import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callsOf, droppedOf, spentOf, worldSideOf } from "./record.ts";

const UID = "2b6c";

/** A stack folder with the AI service's store: the game's call log, and a kept answer. */
function store(): string {
  const root = mkdtempSync(join(tmpdir(), "km-live-record-"));
  mkdirSync(join(root, "ai", "games", UID), { recursive: true });
  mkdirSync(join(root, "ai", "answers"), { recursive: true });
  const call = (key: string, operation: string, costUsd: number, more = {}) => JSON.stringify({ key: `${UID}:s1:${key}`, operation, request: {}, costUsd, latencyMs: 900, ...more });
  writeFileSync(join(root, "ai", "games", UID, "calls.jsonl"), [
    JSON.stringify({ key: `${UID}:s1:t0:open`, operation: "gm.opening", started: "/api/v1/responses" }),
    call("t0:open", "gm.opening", 0.002, { model: "openai/gpt-6-luna" }),
    call("t0:suggest", "scene.suggest", 0.0003, { model: "openai/gpt-6-luna" }),
    call("t1:reply", "gm.reply", 0.003, { request: { model: "openai/gpt-6-luna" } }),
    call("t1:suggest-2", "scene.suggest", 0.0004),
    "",
  ].join("\n"));
  const answer = { lines: [], dropped: [{ text: "Who's Hobb?", why: "a name not heard: Hobb" }], usage: {} };
  writeFileSync(join(root, "ai", "answers", `${encodeURIComponent(`${UID}:s1:t1:suggest-2`)}.json`), JSON.stringify({ requestHash: "h", status: 200, body: JSON.stringify(answer), at: "now" }));
  return root;
}

test("the call log gives each done call with its key's turn, and the spend and the dearest turn", () => {
  const root = store();
  try {
    const calls = callsOf(root, UID);

    assert.deepEqual(calls.map(c => [c.operation, c.turn, c.model]), [
      ["gm.opening", 0, "openai/gpt-6-luna"], ["scene.suggest", 0, "openai/gpt-6-luna"], ["gm.reply", 1, "openai/gpt-6-luna"], ["scene.suggest", 1, "?"],
    ]);
    const spent = spentOf(root, UID);
    assert.equal(spent.total.toFixed(4), "0.0057");
    assert.equal(spent.dearest.toFixed(4), "0.0034");
    assert.deepEqual(callsOf(root, "no-such-game"), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("what the lines' answer screened out comes from the answer kept by its key", () => {
  const root = store();
  try {
    assert.deepEqual(droppedOf(root, `${UID}:s1:t1:suggest-2`), [{ text: "Who's Hobb?", why: "a name not heard: Hobb" }]);
    assert.deepEqual(droppedOf(root, `${UID}:s1:t1:suggest`), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the world's side of a turn: what changed in the place since the turn before, the rules' act and the reactions, from the path", () => {
  const before = [{ id: "hoist-rope", name: "the hoist rope", states: [] }, { id: "prout", name: "Wendell Prout's body", states: ["hanging"] }, { id: "cob", name: "Cob", states: [] }];
  const after = [{ id: "hoist-rope", name: "the hoist rope", states: ["destroyed"] }, { id: "prout", name: "Wendell Prout's body", states: ["fallen"] }, { id: "cob", name: "Cob", states: ["gone"] }];
  const worlds = new Map([[0, before], [1, after], [2, after]]);
  const path = ["1: yard -> yard via rules:cast:magic-missile (pre)", "1: yard -> yard via reactions:kell=intervene,cob=flee,moll=cower (pre)"];

  assert.deepEqual(worldSideOf(1, worlds, path), {
    world: ["the hoist rope: destroyed", "Wendell Prout's body: fallen, no longer hanging", "Cob: gone"],
    act: "cast:magic-missile", reactions: "kell=intervene, cob=flee, moll=cower",
  });
  assert.deepEqual(worldSideOf(2, worlds, path), { world: [] });
  worlds.set(3, [...after, { id: "smoke-1", name: "smoke", states: [] }]);
  assert.deepEqual(worldSideOf(3, worlds, path).world, ["smoke: appeared"]);
  assert.deepEqual(worldSideOf(0, worlds, path), { world: [] });
});
