import assert from "node:assert/strict";
import test from "node:test";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { loadPlayableWorld } from "./fixtures.js";
import { mapActionHooks } from "../packages/conversation/src/action-execution.js";

test("action hooks use injected map services; presentation follows the committed result", async () => {
  const calls: string[] = [];
  const world = loadPlayableWorld();
  const runtime = new WorldGameRuntime(world, "", undefined, undefined, undefined, {
    services: { map: {
      observe: id => { calls.push("observe"); return { characterId: id, map: world.map!, actions: [] }; },
      interact: command => { if (command.kind === "move") assert.equal(command.destination.x, 1); calls.push(command.kind); return { done: true, generations: {} }; },
    }, presentation: { renderMap: async (_view, result) => { assert.equal(result?.done, true); calls.push("render"); } } },
    hooks: { actionExecution: {
      classify: async context => { calls.push("classify"); if (context.command.kind === "move") context.command.destination.x = 999; return {}; },
      resolve: async (...args) => { calls.push("resolve"); return mapActionHooks.resolve(...args); },
    } },
  });
  const before = runtime.snapshot();
  const result = await runtime.executeAction({ command: { kind: "move", destination: { x: 1, y: 1 } } });
  assert.deepEqual(calls, ["classify", "resolve", "move"]);
  await runtime.presentMap("player", result);
  assert.deepEqual(calls.slice(-2), ["observe", "render"]);
  assert.deepEqual(runtime.snapshot(), before);
});

test("map actions commit movement, reject stale state and retain headless no-op presentation", async () => {
  const runtime = new WorldGameRuntime(loadPlayableWorld(), "");
  const observation = runtime.map.observe("player");
  const action = observation.actions.find(action => action.path.length > 1)!;
  const expected = { "v2:world": runtime.worldGeneration() };
  const result = await runtime.executeAction({ command: { kind: "move", destination: action.path[1]! }, expected });
  assert.deepEqual(runtime.world().map!.actors.find(actor => actor.characterId === "player")!.position, { ...runtime.world().map!.actors.find(actor => actor.characterId === "player")!.position, ...action.path[1] });
  await runtime.presentMap("player", result);
  await assert.rejects(runtime.executeAction({ command: { kind: "move", destination: action.path[0]! }, expected }), /World changed/);
  observation.map.actors.length = 0;
  assert.ok(runtime.world().map!.actors.length);
  const cancelled = new AbortController(); cancelled.abort();
  const before = runtime.snapshot();
  await assert.rejects(runtime.executeAction({ command: { kind: "move", destination: action.path[0]! } }, cancelled.signal), /abort/i);
  assert.deepEqual(runtime.snapshot(), before);
});
