import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { create, fromJson, fromJsonString, toJson } from "@bufbuild/protobuf";
import { ScenarioSchema, TilePositionSchema } from "../packages/contracts/src/index.js";
import { transferItem, locatedItems, validateInventories } from "../packages/core/src/inventory.js";
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
import { diningSupplies, privateBelongings } from "../evals/jev/scenarios.js";

const load = () => fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));
test("old saves gain furnishings without refilling existing containers or duplicating carried items", () => {
  const authored = load(), saved = load(), world = saved.world!;
  transferItem(saved, "furn_bread", "corvin");
  world.fixtures = world.fixtures.filter(f => !f.id.startsWith("furn_"));
  delete world.facts!.palaceFurnishingsVersion;
  const drawer = world.fixtures.find(f => f.id === "palace_corvin_drawers")!;
  drawer.open = true;
  transferItem(saved, "palace_royal_key", "corvin");
  const actor = world.actors.find(a => a.characterId === "mara")!;
  actor.position = create(TilePositionSchema, { x: 21, y: 5 }); // Newly furnished bed.
  const runtime = new BrowserGameRuntime(authored, "test");
  const snapshot = runtime.snapshot(); snapshot.scenario = toJson(ScenarioSchema, saved);
  runtime.restore(snapshot);
  const upgraded = runtime.snapshot(), result = fromJson(ScenarioSchema, upgraded.scenario);
  assert.equal(result.world!.fixtures.length, authored.world!.fixtures.length);
  assert.equal(result.world!.fixtures.find(f => f.id === drawer.id)!.open, true);
  for (const id of ["furn_bread", "palace_royal_key"]) {
    assert.equal(locatedItems(result).filter(item => item.id === id).length, 1);
    assert.equal(locatedItems(result).find(item => item.id === id)!.locationId, "corvin");
  }
  const moved = result.world!.actors.find(a => a.characterId === "mara")!;
  assert.equal(moved.roomId, "mara_chamber");
  assert.ok(!result.world!.fixtures.some(f => f.position?.x === moved.position!.x && f.position.y === moved.position!.y));
  validateInventories(result);
  runtime.restore(upgraded); assert.deepEqual(runtime.snapshot(), upgraded);
});

test("new Jev evals use authored furnishings and require real inventory and closure outcomes", () => {
  for (const [definition, item, room, fixture, door] of [
    [diningSupplies, "furn_bread", "great_hall", "furn_dining_bread", undefined],
    [privateBelongings, "furn_mara_personal", "ironmark_salon", "furn_mara_desk", "mara_door"],
  ] as const) {
    const scenario = fromJson(ScenarioSchema, definition.createRuntime("test").snapshot().scenario);
    assert.equal(scenario.world!.fixtures.length, load().world!.fixtures.length);
    const assess = () => definition.evaluate({ scenario, terminalChoice: "complete", talkCalls: [] });
    assert.equal(assess().success, false);
    transferItem(scenario, item, definition.characterId);
    scenario.world!.actors.find(a => a.characterId === definition.characterId)!.roomId = room;
    assert.equal(assess().success, true);
    scenario.world!.fixtures.find(f => f.id === fixture)!.open = true;
    assert.equal(assess().success, false);
    scenario.world!.fixtures.find(f => f.id === fixture)!.open = false;
    if (door) { scenario.world!.doors.find(d => d.id === door)!.open = true; assert.equal(assess().success, false); }
  }
});

test("Jev's offered actions can retrieve belongings and leave the furnished bedroom", async t => {
  const { JevClient } = await import("../packages/providers/src/jev.js");
  const { runJevEvalOnce } = await import("../packages/evals/src/jev-world-eval.js");
  const choices = ["enter_entrance_hall", "enter_west_wing", "enter_ironmark_salon", "open_ironmark_quarters_door_0",
    "enter_ironmark_back_hall", "open_mara_door_1", "enter_mara_chamber", "open_furn_mara_desk", "take_furn_mara_personal",
    "close_furn_mara_desk", "enter_ironmark_back_hall", "close_mara_door_1", "enter_ironmark_salon", "complete"];
  t.mock.method(JevClient.prototype, "choose", async (_state: unknown, _instructions: unknown, criteria: Record<string, string>) => {
    const choice = choices.shift()!;
    assert.ok(criteria[choice], `${choice} must be executable`);
    return { choice, probabilities: { [choice]: 1 } };
  });
  const result = await runJevEvalOnce(privateBelongings, "test");
  assert.equal(result.success, true, result.reason ?? result.error ?? "Scripted route should complete");
  assert.equal(choices.length, 0);
});
