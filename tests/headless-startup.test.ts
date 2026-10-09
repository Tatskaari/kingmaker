import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { toJson } from "@bufbuild/protobuf";
import { WorldStateSchema } from "../packages/contracts/src/v2.js";
import { WorldHeadlessGame } from "../packages/headless/src/world.js";
import { execute } from "../packages/headless/src/client.js";
import { characterCreationWorld } from "../apps/web/src/playable-world.js";
import { loadPlayableWorld } from "./fixtures.js";

async function start(t: TestContext, args: string[] = [], source?: unknown) {
  const directory = mkdtempSync(join(tmpdir(), "kingmaker-startup-"));
  const socket = join(directory, "game.sock"), file = join(directory, "world.json");
  if (source !== undefined) writeFileSync(file, JSON.stringify(source));
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/headless.ts", "start", "--socket", socket,
    ...args, ...(source === undefined ? [] : ["--world", file])], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, OPENROUTER_API_KEY: "" }, stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, "exit");
      child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 1000);
      try { await stopped; } finally { clearTimeout(force); }
    }
    rmSync(directory, { recursive: true, force: true });
  });
  let output = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Console did not start: ${output}`)), 15_000);
    const finish = (error?: Error) => { clearTimeout(timer); error ? reject(error) : resolve(); };
    child.on("error", finish);
    child.on("exit", code => finish(new Error(`Console exited (${code}): ${output}`)));
    child.stderr.on("data", chunk => { output += chunk; });
    child.stdout.on("data", chunk => {
      output += chunk;
      if (output.includes(`Game console ready: ${socket}`)) finish();
    });
  });
  return async (code: string) => (await execute(socket, code)).value;
}

test("headless CLI starts a normal fresh game at character creation", async t => {
  const run = await start(t);
  assert.deepEqual(await run(`game.runtime.startIntroduction(); return {
    phase: game.overview().phase, player: game.inspect().player ?? null,
    day: game.inspect().simulation!.map.day, interview: !!game.snapshot().stranger
  };`), { phase: "player_creation", player: null, day: 0, interview: true });
  await assert.rejects(run("return game.actions();"), /Character is not placed/);
});

test("headless CLI --dev-player starts the playable development envoy", async t => {
  const run = await start(t, ["--dev-player"]);
  assert.deepEqual(await run(`return { phase: game.overview().phase, player: game.inspect().player,
    day: game.inspect().simulation!.map.day, canTalk: game.actions().some(a => a.id === "talk_corvin") };`), {
    phase: "conversations", player: "Players/envoy.md", day: 1, canTalk: true,
  });
  assert.match(String(await run("return game.observe();")), /^Great Hall/);
});

test("headless CLI preserves --world startup state regardless of --dev-player", async t => {
  const world = loadPlayableWorld();
  world.simulation!.map!.day = 7;
  const snapshot = new WorldHeadlessGame(characterCreationWorld(world)).snapshot();
  snapshot.stranger = { history: [{ role: "user", content: "I would like to be a bard." }] };
  for (const dev of [false, true]) {
    await t.test(`authored world, dev=${dev}`, async t => {
      const run = await start(t, dev ? ["--dev-player"] : [], toJson(WorldStateSchema, world));
      assert.deepEqual(await run("return { phase: game.overview().phase, day: game.inspect().simulation!.map.day, player: game.inspect().player };"),
        { phase: "conversations", day: 7, player: "Players/envoy.md" });
    });
    await t.test(`in-progress creation snapshot, dev=${dev}`, async t => {
      const run = await start(t, dev ? ["--dev-player"] : [], snapshot);
      assert.deepEqual(await run("return { phase: game.overview().phase, stranger: game.snapshot().stranger, player: game.inspect().player ?? null };"),
        { phase: "player_creation", stranger: snapshot.stranger, player: null });
    });
  }
});
