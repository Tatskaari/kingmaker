import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fromJson } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import type { RuntimeSnapshot } from "../apps/web/src/runtime.js";
import { HeadlessGame } from "../packages/headless/src/index.js";
import { startConsole } from "../packages/headless/src/server.js";
import { execute } from "../packages/headless/src/client.js";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
  return value;
};
const socketPath = resolve(option("--socket") ?? `${tmpdir()}/kingmaker-${process.getuid?.() ?? "local"}/game.sock`);
if (args[0] === "exec") {
  const code = option("--code") ?? readFileSync(option("--file") ?? 0, "utf8");
  try {
    const response = await execute(socketPath, code);
    for (const line of response.logs) console.error(line);
    console.log(typeof response.value === "string" ? response.value : JSON.stringify(response.value, null, 2));
  } catch (error) {
    const detail = error as Error & { data?: { logs?: string[] } };
    for (const line of detail.data?.logs ?? []) console.error(line);
    console.error(detail.message); process.exitCode = 1;
  }
} else if (!args.length || args[0] === "start" || args[0]?.startsWith("--")) {
  const worldPath = option("--world");
  const source = JSON.parse(readFileSync(worldPath ?? new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));
  const game = new HeadlessGame(source.scenario ? source as RuntimeSnapshot : fromJson(ScenarioSchema, source),
    process.env.OPENROUTER_API_KEY ?? "");
  if (args.includes("--dev-player") && !game.inspect().playerCharacterId) game.runtime.createDevelopmentPlayer();
  mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
  const server = await startConsole(game, socketPath);
  console.log(`Game console ready: ${socketPath}`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
    server.close(() => process.exit(0));
  });
} else throw new Error("Usage: headless [start|exec] [--socket path] [--world path] [--dev-player] [--code source|--file path]");
