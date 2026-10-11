import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { WorldHeadlessGame } from "../packages/headless/src/world.js";
import { loadPlayableWorld } from "./fixtures.js";
import { createDispatcher } from "../packages/headless/src/server.js";

function dispatcher() {
  return createDispatcher(new WorldHeadlessGame(loadPlayableWorld()));
}
const request = (code: string, id: string | number = 1) => ({ jsonrpc: "2.0", id, method: "game.execute", params: { code } });

test("protobuf JSON-RPC executes TypeScript, awaits promises and preserves live state", async () => {
  const dispatch = dispatcher();
  assert.deepEqual(await dispatch(request('const day: number = 7; await Promise.resolve(); game.services.mechanics.commit({ ...game.inspect().simulation!.map, day: day }, {}); console.log("day", day); return day;', "first")),
    { jsonrpc: "2.0", id: "first", result: { value: 7, logs: ["day 7"] } });
  assert.deepEqual(await dispatch(request("return game.inspect().simulation!.map.day;")),
    { jsonrpc: "2.0", id: 1, result: { value: 7, logs: [] } });
  assert.deepEqual(await dispatch(request("const local = 1;")),
    { jsonrpc: "2.0", id: 1, result: { value: null, logs: [] } });
});

test("protocol validation, notifications, batches and execution errors", async () => {
  const dispatch = dispatcher();
  for (const [input, code] of [[null, -32600], [[], -32600], [{ ...request("return 1;"), method: "missing" }, -32601],
    [{ ...request("return 1;"), params: { code: 42 } }, -32602], [request(""), -32602]] as const) {
    assert.equal((await dispatch(input) as any).error.code, code);
  }
  const notification = { jsonrpc: "2.0", method: "game.execute", params: { code: "game.services.mechanics.commit({ ...game.inspect().simulation!.map, day: 9 }, {});" } };
  assert.equal(await dispatch(notification), undefined);
  const batch = await dispatch([notification, request("return game.inspect().simulation!.map.day;")]) as any[];
  assert.equal(batch.length, 1);
  assert.equal(batch[0].result.value, 9);
  const direct = await dispatch(request("game.inspect().simulation!.map.day = 99;")) as any;
  assert.equal(direct.error.code, -32000);
  assert.equal((await dispatch(request("return game.inspect().simulation!.map.day;")) as any).result.value, 9);
  const failed = await dispatch(request('console.log("before"); throw new Error("oops");')) as any;
  assert.equal(failed.error.code, -32000);
  assert.deepEqual(failed.error.data.logs, ["before"]);
  assert.match(failed.error.data.stack, /oops/);
  assert.equal((await dispatch(request("return 1n;")) as any).error.code, -32000);
  assert.equal((await dispatch(request('return "x".repeat(1024 * 1024);')) as any).error.code, -32000);
  assert.equal((await dispatch(request("return 2;")) as any).result.value, 2);
});

test("QA protocol exposes only current player observations, actions and conversation turns", async t => {
  const game = new WorldHeadlessGame(loadPlayableWorld());
  const dispatch = createDispatcher(game, "qa");
  const call = (method: string, params: unknown = {}, id: string | number = 1) =>
    dispatch({ jsonrpc: "2.0", id, method, params }) as Promise<any>;
  const observed = await call("game.observe");
  assert.match(observed.result.observation, /^Great Hall/);
  assert.ok(observed.result.actions.some((action: any) => action.id === "enter_entrance_hall"));
  assert.ok(observed.result.quests.some((quest: any) => quest.id === "talk_to_aldren"));
  assert.equal((await call("game.execute", { code: "return game.inspect();" })).error.code, -32601);
  const unavailable = await call("game.act", { id: "not_an_observed_action" });
  assert.equal(unavailable.error.code, -32000);
  assert.match(unavailable.error.message, /Unavailable player action/);
  assert.equal((await call("game.act", {})).error.code, -32602);
  assert.equal((await call("game.act", { id: "enter_entrance_hall" })).result.value.done, true);
  assert.match((await call("game.observe")).result.observation, /^Entrance Hall/);
  t.mock.method(game.runtime, "checkedTalkToCharacter", async () => "Welcome, envoy.");
  t.mock.method(game.runtime, "endConversation", async () => undefined);
  assert.deepEqual((await call("game.act", { id: "talk_rowan" })).result.value, { characterId: "rowan" });
  const conversation = await call("game.observe");
  assert.deepEqual(conversation.result.activeConversation, { characterId: "rowan" });
  assert.deepEqual(conversation.result.actions, []);
  assert.deepEqual((await call("game.say", { message: "Hello" })).result,
    { characterId: "rowan", reply: "Welcome, envoy." });
  assert.match((await call("game.act", { id: "enter_great_hall" })).error.message, /End the conversation/);
  assert.deepEqual((await call("game.end_conversation")).result, {});
  assert.equal((await call("game.observe")).result.activeConversation, undefined);
  assert.equal((await call("game.dump", {})).error.code, -32602);
  assert.match((await call("game.dump", { description: "The door vanished", filepath: "relative.zip" })).error.message,
    /filepath must be absolute/);
  const directory = mkdtempSync(join(tmpdir(), "kingmaker-protocol-dump-")), filepath = join(directory, "door-vanished.zip");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.deepEqual((await call("game.dump", { description: "The door vanished", filepath })).result, {});
  assert.equal(statSync(filepath).mode & 0o777, 0o600);
  const files = unzipSync(readFileSync(filepath));
  assert.match(strFromU8(files["report.md"]!), /The door vanished/);
  assert.equal(JSON.parse(strFromU8(files["environment.json"]!)).source, "headless-qa");
  assert.ok(files["world-state.json"]);
  assert.match((await call("game.dump", { description: "Again", filepath })).error.message, /exist/i);
});
