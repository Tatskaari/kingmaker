import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error The browser's debug renderer is JavaScript.
import { debugOverview, characterTranscripts } from "../apps/web/src/debug-view.js";

test("overall debug exposes drill-downs instead of every character's private detail", () => {
  const data = { scenario: { characters: [
    { id: "corvin", name: "<Corvin>", currentGoal: "Secret goal" },
    { id: "player", name: "Envoy" },
  ], playerCharacterId: "player" } };
  const overview = debugOverview("debug", data);
  assert.match(overview, /data-debug-section="activity"/);
  assert.match(overview, /data-debug-section="characters"/);
  assert.doesNotMatch(overview, /Secret goal/);
  const characters = debugOverview("debug", data, "characters");
  assert.match(characters, /data-debug-character="corvin"/);
  assert.match(characters, /&lt;Corvin&gt;/);
  assert.doesNotMatch(characters, /data-debug-character="player"/);
  assert.doesNotMatch(characters, /data-objective-override="player"/);
});

test("character drill-downs use only the selected knowledge payload", () => {
  const data = { character: { id: "corvin", name: "Corvin" },
    knownWorld: { objects: [{ name: "Known key" }] },
    scenario: { world: { objects: [{ name: "Hidden crown" }] } },
    visibleNotes: [{ text: "A private recollection" }], modelMessages: [{ role: "system", content: "<Prompt>" }] };
  assert.doesNotMatch(debugOverview("debug_character", data), /Known key|A private recollection|Hidden crown/);
  const world = debugOverview("debug_character", data, "world");
  assert.match(world, /Known key/);
  assert.doesNotMatch(world, /Hidden crown/);
  assert.match(debugOverview("debug_character", data, "context"), /&lt;Prompt&gt;/);
});

test("character request logs exclude other characters without altering the global archive", () => {
  const data = { requests: [{ characterId: "corvin" }, { characterId: "mara" }],
    agentRuns: { corvinRun: { characterId: "corvin" }, maraRun: { characterId: "mara" } } };
  assert.deepEqual(characterTranscripts(data, "corvin"), {
    requests: [{ characterId: "corvin" }], agentRuns: { corvinRun: { characterId: "corvin" } },
  });
  assert.equal(data.requests.length, 2);
  assert.deepEqual(characterTranscripts({}, "corvin"), { requests: [], agentRuns: {} });
});
