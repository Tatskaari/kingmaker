import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { HeadlessGame } from "../packages/headless/src/index.js";
import { createDispatcher } from "../packages/headless/src/server.js";

function dispatcher() {
  return createDispatcher(new HeadlessGame(fromJsonString(ScenarioSchema,
    readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"))));
}
const request = (code: string, id: string | number = 1) => ({ jsonrpc: "2.0", id, method: "game.execute", params: { code } });

test("protobuf JSON-RPC executes TypeScript, awaits promises and preserves live state", async () => {
  const dispatch = dispatcher();
  assert.deepEqual(await dispatch(request('const day: number = 7; await Promise.resolve(); game.edit(s => { s.world.day = day; }); console.log("day", day); return day;', "first")),
    { jsonrpc: "2.0", id: "first", result: { value: 7, logs: ["day 7"] } });
  assert.deepEqual(await dispatch(request("return game.inspect().world.day;")),
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
  const notification = { jsonrpc: "2.0", method: "game.execute", params: { code: "game.edit(s => { s.world.day = 9; });" } };
  assert.equal(await dispatch(notification), undefined);
  const batch = await dispatch([notification, request("return game.inspect().world.day;")]) as any[];
  assert.equal(batch.length, 1);
  assert.equal(batch[0].result.value, 9);
  const failed = await dispatch(request('console.log("before"); throw new Error("oops");')) as any;
  assert.equal(failed.error.code, -32000);
  assert.deepEqual(failed.error.data.logs, ["before"]);
  assert.match(failed.error.data.stack, /oops/);
  assert.equal((await dispatch(request("return 1n;")) as any).error.code, -32000);
  assert.equal((await dispatch(request('return "x".repeat(1024 * 1024);')) as any).error.code, -32000);
  assert.equal((await dispatch(request("return 2;")) as any).result.value, 2);
});
