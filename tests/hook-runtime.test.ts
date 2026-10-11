import assert from "node:assert/strict";
import test from "node:test";
import { compileHook } from "../packages/hooks/src/compiler.js";
import { runHook } from "../packages/hooks/src/runtime.js";
import { bindHookServices } from "../packages/lore/src/hook-services.js";
import { WorldStore } from "../packages/lore/src/world-store.js";
import { loadPlayableWorld } from "./fixtures.js";
const signal = () => new AbortController().signal;
const compile = (body: string) => compileHook("Hooks/test.ts", `export default async function run(services: HookServices): Promise<TransitionResult> { ${body} }`);

test("bounded hooks read detached data and update authoritative quest progress", async () => {
  const store = new WorldStore(loadPlayableWorld());
  const result = await runHook(compile('const q = services.quests.read("assembly_programme"); await services.quests.setActive(q.id, true, q.revision); return {status:"accepted", message:"activated"};'), guard => bindHookServices(store, guard), signal());
  assert.deepEqual(result, {status:"accepted", message:"activated"});
  assert.equal(store.state.quests.assembly_programme!.active, true);
  assert.deepEqual(await runHook(compile('return {status:"accepted", message:typeof (globalThis as any).process + ":" + typeof (globalThis as any).fetch};'), guard => bindHookServices(store, guard), signal()), {status:"accepted", message:"undefined:undefined"});
});

test("fixture callbacks preserve unrelated fields and reject async or nested effects", async () => {
  const store = new WorldStore(loadPlayableWorld());
  const before = store.state.simulation!.map!.fixtures.find(f => f.id === "furn_cart_left")!;
  const body = 'await services.map.updateFixture("furn_cart_left", f => { f.actions.push({id:"hook-smash", label:"Smash", handler:"smash-cart", actorId:"player", illegal:true, order:25}); }); return {status:"accepted", message:"ok"};';
  await runHook(compile(body), guard => bindHookServices(store, guard), signal());
  const after = store.state.simulation!.map!.fixtures.find(f => f.id === before.id)!;
  assert.equal(after.actions.length, before.actions.length + 1);
  assert.deepEqual(after.position, before.position);
  for (const callback of ['async f => { f.actions = []; }', 'f => { services.quests.read("assembly_programme"); }', 'f => { f.actions = [{id:"bad"} as any]; }']) {
    await assert.rejects(runHook(compile(`await services.map.updateFixture("furn_cart_left", ${callback}); return {status:"accepted", message:"bad"};`), guard => bindHookServices(store, guard), signal()));
    assert.deepEqual(store.state.simulation!.map!.fixtures.find(f => f.id === before.id), after);
  }
});

test("infinite execution, cancelled hooks and unresolved promises terminate", async () => {
  const store = new WorldStore(loadPlayableWorld());
  await assert.rejects(runHook(compile('while (true) {}'), guard => bindHookServices(store, guard), signal(), 30));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runHook(compile('return {status:"accepted", message:"ok"};'), guard => bindHookServices(store, guard), controller.signal), /abort/i);
  await assert.rejects(runHook(compile('await new Promise(() => {}); return {status:"accepted", message:"bad"};'), guard => bindHookServices(store, guard), signal()), /unresolved/);
});
