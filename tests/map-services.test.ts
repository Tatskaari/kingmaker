import assert from "node:assert/strict";
import test from "node:test";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { loadPlayableWorld } from "./fixtures.js";
import { mapActionStrategy } from "../packages/conversation/src/action-execution.js";

test("action strategies use injected map services; presentation follows the committed result", async () => {
  const calls: string[] = [];
  const world = loadPlayableWorld();
  const runtime = new WorldGameRuntime(world, "", undefined, undefined, undefined, {
    services: { map: {
      observe: id => { calls.push("observe"); return { characterId: id, map: world.simulation!.map!, actions: [] }; },
      interact: command => { if (command.kind === "move") assert.equal(command.destination.x, 1); calls.push(command.kind); return { done: true }; },
    }, presentation: { renderMap: async (_view, result) => { assert.equal(result?.done, true); calls.push("render"); } } },
    strategies: { actionExecution: {
      classify: async context => { calls.push("classify"); if (context.command.kind === "move") context.command.destination.x = 999; return {}; },
      resolve: async (...args) => { calls.push("resolve"); return mapActionStrategy.resolve(...args); },
    } },
  });
  const before = runtime.snapshot();
  const result = await runtime.executeAction({ command: { kind: "move", destination: { x: 1, y: 1 } } });
  assert.deepEqual(calls, ["classify", "resolve", "move"]);
  await runtime.presentMap("player", result);
  assert.deepEqual(calls.slice(-2), ["observe", "render"]);
  assert.deepEqual(runtime.snapshot(), before);
});

test("map actions validate current state without generation IDs and retain headless no-op presentation", async () => {
  const runtime = new WorldGameRuntime(loadPlayableWorld(), "");
  const observation = runtime.map.observe("player");
  const action = observation.actions.find(action => action.path.length > 1)!;
  const result = await runtime.executeAction({ command: { kind: "move", destination: action.path[1]! } });
  assert.deepEqual(runtime.world().simulation!.map!.actors.find(actor => actor.characterId === "player")!.position, { ...runtime.world().simulation!.map!.actors.find(actor => actor.characterId === "player")!.position, ...action.path[1] });
  await runtime.presentMap("player", result);
  await runtime.executeAction({ command: { kind: "move", destination: action.path[0]! } });
  assert.ok(!("generations" in result));
  assert.ok(!("generations" in runtime.view()));
  const unchanged = runtime.snapshot();
  await assert.rejects(runtime.executeAction({ command: { kind: "move", destination: { x: 0, y: 0 } } }), /not reachable|outside/);
  assert.deepEqual(runtime.snapshot(), unchanged);
  observation.map.actors.length = 0;
  assert.ok(runtime.world().simulation!.map!.actors.length);
  const cancelled = new AbortController(); cancelled.abort();
  const before = runtime.snapshot();
  await assert.rejects(runtime.executeAction({ command: { kind: "move", destination: action.path[0]! } }, cancelled.signal), /abort/i);
  assert.deepEqual(runtime.snapshot(), before);
});
