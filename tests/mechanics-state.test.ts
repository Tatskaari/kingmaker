import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { WorldStateSchema as MapSchema } from "../packages/contracts/src/index.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { worldState } from "../packages/lore/src/world-state.js";

test("physical commits share the document authority and reject stale world snapshots", async () => {
  const services = createScenarioServices(worldState(create(MapSchema, { day: 1 }), new Map([
    ["Scenarios/Test/scenario.md", "Briefing"], ["Scenarios/Test/index.md", "Index"],
  ]), "Test"));
  const before = services.scenario.snapshot();
  const doc = await services.docs.read("Scenarios/Test/scenario.md");
  await services.docs.insert(doc.path, doc.sha, 1, "A changed circumstance.");
  assert.throws(() => services.mechanics.commit(before, create(MapSchema, { day: 9 }), {}), /World changed/);
  const current = services.scenario.snapshot();
  services.mechanics.commit(current, create(MapSchema, { day: 2 }), {});
  const after = services.scenario.snapshot();
  assert.equal(after.map!.day, 2);
  assert.match(after.docs[doc.path]!.body, /changed circumstance/);
  assert.throws(() => services.mechanics.commit(current, create(MapSchema), {}), /World changed/);
});
