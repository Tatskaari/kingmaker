import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { WorldStateSchema as MapSchema } from "../packages/contracts/src/index.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { worldState } from "../packages/lore/src/world-state.js";

test("map commits preserve document updates without a whole-world guard", async () => {
  const services = createScenarioServices(worldState(create(MapSchema, { day: 1 }), new Map([
    ["Scenarios/Test/scenario.md", "Briefing"], ["Scenarios/Test/index.md", "Index"],
  ]), "Test"));
  const before = services.scenario.snapshot();
  const doc = await services.docs.read("Scenarios/Test/scenario.md");
  await services.docs.insert(doc.path, doc.sha, 1, "A changed circumstance.");

  const current = services.scenario.snapshot();
  services.mechanics.commit(create(MapSchema, { day: 2 }), {});
  const after = services.scenario.snapshot();
  assert.equal(after.map!.day, 2);
  assert.match(after.docs[doc.path]!.body, /changed circumstance/);
  services.mechanics.commit(create(MapSchema, { day: 3 }), {});
  assert.match(services.scenario.snapshot().docs[doc.path]!.body, /changed circumstance/);
});

test("movement during document hashing does not reject or undo the edit", async t => {
  const services = createScenarioServices(worldState(create(MapSchema, { day: 1 }), new Map([
    ["Scenarios/Test/scenario.md", "Briefing"], ["Scenarios/Test/index.md", "Index"],
  ]), "Test"));
  const doc = await services.docs.read("Scenarios/Test/scenario.md");
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  let release!: () => void, started!: () => void, calls = 0;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(crypto.subtle, "digest", async (...args: Parameters<typeof digest>) => {
    if (++calls === 2) { started(); await gate; }
    return digest(...args);
  });
  const write = services.docs.insert(doc.path, doc.sha, 1, "Reviewed.");
  await waiting;
  services.mechanics.commit(create(MapSchema, { day: 2 }), {});
  release(); await write;
  assert.equal(services.scenario.snapshot().map!.day, 2);
  assert.match((await services.docs.read(doc.path)).text, /Reviewed/);
});
