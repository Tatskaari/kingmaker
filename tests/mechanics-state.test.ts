import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { MapStateSchema as MapSchema } from "../packages/contracts/src/index.js";
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
  assert.equal(after.simulation!.map!.day, 2);
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
  services.currentWorld().simulation!.map!.day = 2;
  release(); await write;
  assert.equal(services.scenario.snapshot().simulation!.map!.day, 2);
  assert.match((await services.docs.read(doc.path)).text, /Reviewed/);
});

test("document edits preserve concurrent simulation inventory changes", async t => {
  const { loadPlayableWorld } = await import("./fixtures.js");
  const { InventorySchema } = await import("../packages/contracts/src/index.js");
  const services = createScenarioServices(loadPlayableWorld());
  const doc = await services.docs.read(services.scenario.info().player!);
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  let release!: () => void, started!: () => void, calls = 0;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(crypto.subtle, "digest", async (...args: Parameters<typeof digest>) => {
    if (++calls === 2) { started(); await gate; }
    return digest(...args);
  });
  const write = services.docs.insert(doc.path, doc.sha, doc.text.trimEnd().split("\n").length, "Reviewed.");
  await waiting;
  const simulation = services.currentWorld().simulation!;
  const inventory = create(InventorySchema, { items: [{ id: "received", name: "Received item" }] });
  simulation.runtimeCharacters.player!.inventory = inventory;
  release(); await write;
  assert.match((await services.docs.read(doc.path)).text, /Reviewed/);
  assert.strictEqual(services.currentWorld().simulation, simulation);
  assert.strictEqual(simulation.runtimeCharacters.player!.inventory, inventory);
});

test("mechanics retain live references and validate property targets before publishing", () => {
  const services = createScenarioServices(worldState(create(MapSchema, { day: 1 }), new Map([
    ["Scenarios/Test/scenario.md", "Briefing"], ["Scenarios/Test/index.md", "Index"],
  ]), "Test"));
  const world = services.currentWorld(), docs = world.docs, map = create(MapSchema, { day: 2 });
  services.mechanics.commit(map, {});
  assert.strictEqual(services.currentWorld(), world);
  assert.strictEqual(world.simulation!.map, map);
  assert.strictEqual(world.docs, docs);
  const next = create(MapSchema, { day: 3 });
  assert.throws(() => services.mechanics.commit(next, { missing: {} as never }), /Unknown character/);
  assert.strictEqual(world.simulation!.map, map);
});
