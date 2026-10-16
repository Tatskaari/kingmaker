import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { BuildsFile, CampaignFile } from "../shared/scene/files.ts";
import { signalGroup } from "./dev/child.ts";
import { reportLines, type DoctorReport } from "./dev/doctor.ts";
import { describeInstall } from "./dev/install.ts";
import { AI_ADDRESS, type Mode } from "./dev/mode.ts";
import { startStack, type Stack } from "./dev/stack.ts";

/**
 * The dev stack, one command (v0-design §1.1, §9.1): SpacetimeDB with the module published, the AI
 * service, the campaign installed in both and the doctor's two paths checked; then keys to break and
 * mend the AI service while you play.
 *
 *   npm run dev [-- --fake] [--container] [--fresh] [--mode host|namespace] [--port 3300] [--ai-port 8787]
 *               [--root runs/dev] [--gm pipeline|canned] [--no-keys]
 *
 * It stops everything on q, Ctrl+C or SIGTERM. A --root is relative to where it's run (v2/ under npm).
 */

const USAGE = `npm run dev [-- options]
  --fake                the fake model (no key, no cost)
  --container           the AI service in its podman image (built from ai/Containerfile)
  --fresh               no data: SpacetimeDB's, the AI service's store, runs/play (the keys stay)
  --mode host|namespace detected when absent: host when ${AI_ADDRESS} is on this machine
  --port <n>            SpacetimeDB's port (3300)
  --ai-port <n>         the AI service's port (8787)
  --root <dir>          the stack's folder (runs/dev)
  --gm pipeline|canned  the AI service's GM (canned: no model at all)
  --no-keys             no keyboard; stops on SIGTERM`;

const V2 = resolve(import.meta.dirname, "..");
const CAMPAIGN = join(V2, "campaigns", "caerwyn");
/** f's fault: the service exits (137) right after it stores its next answer, before it answers (v0-design §5.1). */
const FAULT = "exit-after-store:any";

const flags = flagsOf(process.argv.slice(2));
const campaign = JSON.parse(readFileSync(join(CAMPAIGN, "campaign.json"), "utf8")) as CampaignFile;
const builds = Object.keys(JSON.parse(readFileSync(join(CAMPAIGN, "builds.json"), "utf8")) as BuildsFile);
const campaignId = `${campaign.id}@${campaign.version}`;

/** Each key's action runs after the one before it has finished. */
let queue = Promise.resolve();
let quitting = false;
/** Set while the dev host stops the AI service itself, so that exit isn't reported as a surprise. */
let stopping = false;
/** Set while the AI service runs with f's fault. */
let faulted = false;

/** The keys (§1.1), each an action on the stack. */
const ACTIONS: Record<string, () => Promise<void>> = {
  async k() {
    if (!stack.ai.running()) return note("the AI service isn't running: s starts it");
    await stopAi("SIGKILL");
    note("the AI service is killed (SIGKILL): s starts it");
  },
  async s() {
    if (stack.ai.running()) return note("the AI service is already running (r restarts it)");
    await startAi();
    note("the AI service is up");
  },
  async r() {
    await stopAi("SIGTERM");
    await startAi();
    note("the AI service is restarted");
  },
  async f() {
    await stopAi("SIGTERM");
    await startAi({ KM_AI_FAULTS: FAULT });
    note(`the AI service is restarted with KM_AI_FAULTS=${FAULT}: it exits right after it stores its next answer, before answering`);
  },
  async p() {
    const published = await stack.publish();
    note(published.wiped ? "republished: THE SCHEMA CHANGE DELETED THE DATA" : "republished (the data kept)");
    note(`campaign: ${await installCampaign()}`);
    await doctorNow();
  },
  d: doctorNow,
};

const stack = await start();
const installed = await installCampaign();
const report = await stack.doctor({ campaign: campaignId });
print("", ...screen(stack, installed, report));
watchAi();
listen();

// ---------------------------------------------------------------------------------------------
// Starting, and the screen.

async function start(): Promise<Stack> {
  try {
    return await startStack({
      root: flags.root, stdbPort: flags.port, aiPort: flags.aiPort, ...(flags.mode ? { mode: flags.mode } : {}),
      model: flags.fake ? "fake" : "openrouter", ...(flags.gm ? { gm: flags.gm } : {}), container: flags.container, fresh: flags.fresh,
      sessions: join(V2, "runs", "play"), log: line => print(`  … ${line}`),
    });
  } catch (e) {
    console.error(`\nThe dev stack didn't start: ${(e as Error).message}`);
    process.exit(1);
  }
}

function screen(s: Stack, campaignLine: string, report: DoctorReport): string[] {
  const file = s.file(), logs = relative(process.cwd(), join(file.root, "logs")) || ".";
  // The clients find runs/dev's stack by themselves; another folder they're told.
  const stackFlag = file.root === join(V2, "runs", "dev") ? "" : ` --stack ${relative(process.cwd(), file.root) || "."}`;
  const modeLine = s.mode === "namespace"
    ? `namespace mode (SpacetimeDB in a pasta namespace; ${AI_ADDRESS} is this machine's loopback)`
    : `host mode (${AI_ADDRESS} is on this machine)`;
  const model = `${file.ai.model}${file.ai.gm === "canned" ? " (canned GM)" : ""}${file.ai.container ? " · in podman" : ""}`;
  // The two paths are the summary's; anything else wrong is listed under it.
  const failing = report.checks.filter(c => !c.ok && !c.name.includes("→"));
  return [
    `Kingmaker dev stack · ${modeLine}`,
    `  SpacetimeDB   ${s.ws}  database ${s.db}       log ${logs}/spacetime.log`,
    `  AI service    ${s.aiFromHost} · the module calls ${s.aiFromSimulation} · ${model}   log ${logs}/ai.log`,
    `  Campaign      ${campaignLine}`,
    `  Doctor        ${report.summary}`,
    ...failing.map(c => `                ✗ ${c.name}: ${c.detail}`),
    `Play:  npm run client -- --session <name> --new "Name: concept" [--build ${builds.join("|")}]${stackFlag}`,
    `       npm run client -- --session <name> --join <game>${stackFlag}`,
    ...(flags.keys
      ? ["Keys:  k kill the AI service · s start it · r restart it · f kill it after its next stored answer", "       p republish the module · d doctor · q quit"]
      : ["Keys:  off (--no-keys): SIGTERM or Ctrl+C stops the stack"]),
    ...(s.mode === "namespace" ? [`Tip:   sudo ip addr add ${AI_ADDRESS}/32 dev lo  runs the stack without a namespace (host mode)`] : []),
    "",
  ];
}

// ---------------------------------------------------------------------------------------------
// The keys.

function listen(): void {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => void quit());
  if (!flags.keys) return;
  // A terminal gives keys one at a time; a pipe (an agent's) gives them as they're written.
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (keys: string) => {
    for (const key of keys) {
      // q and Ctrl+C don't queue: quitting waits for the action in hand, then stops the stack.
      if (key === "q" || key === "Q" || key === "\u0003") return void quit();
      const action = ACTIONS[key.toLowerCase()];
      if (action) queue = queue.then(action).catch((e: Error) => note(`${key}: ${e.message}`));
    }
  });
}

async function startAi(env?: Record<string, string>): Promise<void> {
  await stack.ai.start(env);
  faulted = !!env?.KM_AI_FAULTS;
  watchAi();
}

async function stopAi(signal: NodeJS.Signals): Promise<void> {
  stopping = true;
  try {
    await stack.ai.stop(signal);
  } finally {
    stopping = false;
  }
}

/** Says so when the AI service exits by itself: f's fault, or a crash. */
function watchAi(): void {
  const fault = faulted;
  void stack.ai.exited().then(code => {
    if (stopping || quitting) return;
    note(fault
      ? `the AI service exited (${code}) after storing an answer, as f asked: s starts it again, without the fault`
      : `the AI service exited (${code}): s starts it again (its log says why)`);
  });
}

async function installCampaign(): Promise<string> {
  try {
    return describeInstall(await stack.install(CAMPAIGN));
  } catch (e) {
    return `not installed: ${(e as Error).message}`;
  }
}

async function doctorNow(): Promise<void> {
  const report = await stack.doctor({ campaign: campaignId });
  print(`Doctor: ${report.ok ? "all well" : "something's wrong"}`, ...reportLines(report));
}

/** Waits for the action in hand, then stops the AI service and SpacetimeDB. Asked twice, it kills them both at once. */
async function quit(): Promise<void> {
  if (quitting) return killNow();
  quitting = true;
  note("stopping the stack (q or Ctrl+C again kills it at once)");
  await queue.catch(() => undefined);
  await stack.down();
  done(0);
}

function killNow(): void {
  const { pids } = stack.file();
  note("killing the stack");
  for (const pid of [pids.ai, pids.stdb]) if (pid) signalGroup(pid, "SIGKILL");
  done(1);
}

function done(code: number): never {
  if (process.stdin.isTTY && flags.keys) process.stdin.setRawMode(false);
  note("stopped");
  process.exit(code);
}

// ---------------------------------------------------------------------------------------------
// Output and flags.

function print(...lines: string[]): void {
  process.stdout.write(lines.map(l => `${l}\n`).join(""));
}

function note(line: string): void {
  print(`${new Date().toTimeString().slice(0, 8)}  ${line}`);
}

function flagsOf(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      fake: { type: "boolean" }, container: { type: "boolean" }, fresh: { type: "boolean" }, "no-keys": { type: "boolean" }, help: { type: "boolean" },
      mode: { type: "string" }, port: { type: "string" }, "ai-port": { type: "string" }, root: { type: "string" }, gm: { type: "string" },
    },
  });
  if (values.help) {
    print(USAGE);
    process.exit(0);
  }
  const mode = values.mode as Mode | undefined, gm = values.gm as "pipeline" | "canned" | undefined;
  if (mode && mode !== "host" && mode !== "namespace") fail(`--mode is host or namespace, not ${mode}`);
  if (gm && gm !== "pipeline" && gm !== "canned") fail(`--gm is pipeline or canned, not ${gm}`);
  return {
    fake: !!values.fake, container: !!values.container, fresh: !!values.fresh, keys: !values["no-keys"], mode, gm,
    port: portOf(values.port, 3300, "--port"), aiPort: portOf(values["ai-port"], 8787, "--ai-port"), root: resolve(values.root ?? join(V2, "runs", "dev")),
  };
}

function portOf(value: string | undefined, fallback: number, flag: string): number {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) fail(`${flag} is a port number, not ${value}`);
  return port;
}

function fail(why: string): never {
  console.error(`${why}\n\n${USAGE}`);
  process.exit(2);
}
