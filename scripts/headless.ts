import { loadPlayableWorld } from "./lib/playable-world.js";
import { characterCreationWorld } from "../apps/web/src/playable-world.js";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fromJson } from "@bufbuild/protobuf";
import type { WorldSnapshot } from "../apps/web/src/world-runtime.js";
import { WorldStateSchema } from "../packages/contracts/src/v2.js";
import { WorldHeadlessGame } from "../packages/headless/src/world.js";
import { startConsole } from "../packages/headless/src/server.js";
import { act, dump as createDump, endConversation, execute, observe, say } from "../packages/headless/src/client.js";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
  return value;
};
const socketPath = resolve(option("--socket") ?? `${tmpdir()}/kingmaker-${process.getuid?.() ?? "local"}/game.sock`);
const print = (value: unknown) => console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
const report = (error: unknown) => {
  const detail = error as Error & { data?: { logs?: string[] } };
  for (const line of detail.data?.logs ?? []) console.error(line);
  console.error(detail.message); process.exitCode = 1;
};
if (args[0] === "exec") {
  try {
    const code = option("--code") ?? readFileSync(option("--file") ?? 0, "utf8");
    const response = await execute(socketPath, code);
    for (const line of response.logs) console.error(line);
    print(response.value);
  } catch (error) { report(error); }
} else if (args[0] === "observe") {
  try { print(await observe(socketPath)); } catch (error) { report(error); }
} else if (args[0] === "act") {
  try { print((await act(socketPath, option("--id") ?? "")).value); } catch (error) { report(error); }
} else if (args[0] === "say") {
  try { print(await say(socketPath, option("--message") ?? "")); } catch (error) { report(error); }
} else if (args[0] === "end-conversation") {
  try { await endConversation(socketPath); print({}); } catch (error) { report(error); }
} else if (args[0] === "dump") {
  try {
    const requested = option("--output");
    if (!requested) throw new Error("dump requires --output with a descriptive ZIP filepath");
    const output = resolve(requested);
    await createDump(socketPath, option("--description") ?? "", output);
    print(output);
  } catch (error) { report(error); }
} else if (!args.length || args[0] === "start" || args[0]?.startsWith("--")) {
  const worldPath = option("--world");
  const source = worldPath ? JSON.parse(readFileSync(worldPath, "utf8")) : undefined;
  if (source && source.version !== 8 && !source.docs) throw new Error("Start a fresh game; this console requires a v2 world or snapshot.");
  const world = source ? (source.version === 8 ? source as WorldSnapshot : fromJson(WorldStateSchema, source))
    : args.includes("--dev-player") ? loadPlayableWorld() : characterCreationWorld(loadPlayableWorld());
  const game = new WorldHeadlessGame(world, process.env.OPENROUTER_API_KEY ?? "");
  mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
  const mode = args.includes("--qa") ? "qa" : "developer";
  const server = await startConsole(game, socketPath, mode);
  console.log(`Game ${mode === "qa" ? "QA" : "console"} ready: ${socketPath}`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
    server.close(() => process.exit(0));
  });
} else throw new Error("Usage: headless [start|exec|observe|act|say|end-conversation|dump] [--qa] [--socket path] [--world path] [--code source|--file path|--id action|--message text|--description text|--output path]");
