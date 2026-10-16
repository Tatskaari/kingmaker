import assert from "node:assert/strict";
import { test } from "node:test";
import { sceneViewOf, type SceneRows } from "./rows.ts";

const base = (): SceneRows => ({
  me: { id: 1n, name: "Tamsin Vell", characterId: 10n },
  scene: { id: 7n, sceneKey: "hanged-clerk", title: "The Hanged Clerk", hook: "A clerk hangs in the granary yard.", status: "live", controllerId: 1n },
  time: "Morning",
  transcript: [
    { id: 2n, sceneId: 7n, turn: 1, seq: 2, speaker: "player:1", kind: "player", text: "Sergeant, who found him?" },
    { id: 1n, sceneId: 7n, turn: 0, seq: 1, speaker: "gm", kind: "narration", text: "“Sergeant Kell, of the watch.”", markup: JSON.stringify({ speech: [{ start: 0, end: 30, speaker: "kell" }], marks: [] }) },
  ],
  drafts: [], turns: [], players: [{ id: 1n, name: "Tamsin Vell", characterId: 10n }],
  onStage: [{ entityId: 10n, sceneId: 7n, role: "controller" }, { entityId: 20n, sceneId: 7n, role: "cast" }, { entityId: 30n, sceneId: 7n, role: "cast" }],
  names: [{ entityId: 20n, key: "kell", name: "Sergeant Agnes Kell" }, { entityId: 30n, key: "cob", name: "the boy in the too-big boots" }],
  looks: [{ entityId: 20n, fg: "#6d9eeb" }],
});

test("the transcript in order, with names and markup; who's here, by the names the player knows, in their looks' colours", () => {
  const view = sceneViewOf(base());
  assert.deepEqual(view.entries.map(e => e.kind), ["narration", "player"]);
  assert.equal(view.entries[1]!.name, "Tamsin Vell");
  assert.equal(view.entries[0]!.markup?.speech[0]?.speaker, "kell");
  assert.deepEqual(view.present.map(p => [p.name, p.color !== undefined]), [["Sergeant Agnes Kell", true], ["the boy in the too-big boots", true]]);
  assert.equal(view.present[0]!.color, "#6d9eeb");
  assert.equal(view.phase, "idle");
  assert.equal(view.mayType, true);
});

test("a turn in flight: the phase, the draft, and no typing until it's settling", () => {
  const rows = base();
  rows.scene.turnId = 5n;
  rows.turns = [{ id: 5n, sceneId: 7n, n: 1, playerId: 1n, phase: "replying" }];
  rows.drafts = [{ turnId: 5n, sceneId: 7n, speaker: "gm", text: "Sergeant Kell glances up", seq: 3, done: false }];
  let view = sceneViewOf(rows);
  assert.equal(view.phase, "replying");
  assert.equal(view.draft?.text, "Sergeant Kell glances up");
  assert.equal(view.mayType, false);
  rows.turns = [{ id: 5n, sceneId: 7n, n: 1, playerId: 1n, phase: "settling" }];
  rows.drafts = [];
  view = sceneViewOf(rows);
  assert.equal(view.mayType, true);
  assert.equal(view.draft, undefined);
});

test("a watcher never types, and a failed turn says why", () => {
  const rows = base();
  rows.scene.controllerId = 2n;
  assert.equal(sceneViewOf(rows).mayType, false);
  rows.scene.controllerId = 1n;
  rows.scene.turnId = 5n;
  rows.turns = [{ id: 5n, sceneId: 7n, n: 1, playerId: 1n, phase: "failed", error: "the AI API timed out" }];
  const view = sceneViewOf(rows);
  assert.equal(view.failed, "the AI API timed out");
  assert.equal(view.mayType, false);
});
