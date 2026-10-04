import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import test from "node:test";
import { WorldHeadlessGame } from "../packages/headless/src/world.js";
import { loadPlayableWorld } from "./fixtures.js";
import { startConsole } from "../packages/headless/src/server.js";
import { execute } from "../packages/headless/src/client.js";

test("socket persists across clients, serializes async edits, and preserves logs on errors", async t => {
  const directory = mkdtempSync(join(tmpdir(), "kingmaker-socket-")), path = join(directory, "game.sock");
  const game = new WorldHeadlessGame(loadPlayableWorld());
  const server = await startConsole(game, path);
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); });
  assert.equal(statSync(path).mode & 0o777, 0o600);
  await execute(path, "game.edit(s => { s.map.day = 1; });");
  const code = 'const day: number = game.inspect().map.day; await new Promise(r => setTimeout(r, 20)); game.edit(s => { s.map.day = day + 1; }); return game.inspect().map.day;';
  const responses = await Promise.all([execute(path, code), execute(path, code)]);
  assert.deepEqual(responses.map(reply => reply.value).sort(), [2, 3]);
  assert.equal((await execute(path, "return game.inspect().map.day;")).value, 3);
  assert.match(String((await execute(path, 'await game.act("enter_entrance_hall"); return game.observe();')).value), /^Entrance Hall/);
  await assert.rejects(execute(path, 'console.log("before error"); throw new Error("test failure");'), (error: any) => {
    assert.equal(error.code, -32000); assert.deepEqual(error.data.logs, ["before error"]); return true;
  });

  // Multiple frames, with a valid request split across socket writes.
  const replies = await new Promise<any[]>((resolve, reject) => {
    const socket = createConnection(path);
    let buffer = ""; const values: any[] = [];
    socket.setEncoding("utf8"); socket.on("error", reject);
    socket.on("connect", () => {
      socket.write('not-json\n{"jsonrpc":"2.0","id":7,');
      socket.write('"method":"game.execute","params":{"code":"return 42;"}}\n');
    });
    socket.on("data", chunk => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const end = buffer.indexOf("\n"); values.push(JSON.parse(buffer.slice(0, end))); buffer = buffer.slice(end + 1);
      }
      if (values.length === 2) { socket.end(); resolve(values); }
    });
  });
  assert.equal(replies[0].error.code, -32700);
  assert.equal(replies[1].result.value, 42);
});
