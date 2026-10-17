import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, readlinkSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { basename, join, relative, resolve } from "node:path";
import type { FakeOptions } from "../../ai/llm/fake-openrouter.ts";
import { apiKey } from "../../ai/llm/openrouter.ts";
import { refusalIn } from "../../shared/protocol/refusals.ts";
import { aiProcess, containerName, type AiProcess } from "./ai-process.ts";
import { alive, groupMembers, processText, run, spawnLogged, stopGroup, tail, type Child } from "./child.ts";
import { doctor, type DoctorOptions, type DoctorReport } from "./doctor.ts";
import { waitFor } from "./http.ts";
import { describeInstall, installCampaign, type Installed } from "./install.ts";
import { aiListen, aiUrls, detectMode, localAddresses, modeProblem, pastaArgs, stdbListen, type Mode } from "./mode.ts";
import * as stdb from "./spacetime.ts";
import { readStackFile, writeStackFile, type StackFile } from "./stack-file.ts";
import { checkTools, which } from "./tools.ts";

/**
 * startStack: SpacetimeDB, the module and the AI service on one machine, as the dev host and the
 * e2e run them (v0-design §9.1). Everything lives in one folder (`root`): the server's data and keys,
 * the CLI's config, the AI service's store, the logs and stack.json, which the other tools read.
 */

export interface StackOptions {
  /** runs/dev, runs/e2e. */
  root: string;
  /** 3300 and 8787 for dev; 3310 and 8797 for the e2e. */
  stdbPort: number;
  aiPort: number;
  /** Detected when absent: host when 11.0.0.1 is this machine's. */
  mode?: Mode;
  model: "openrouter" | "fake";
  /** The fake model's options (KM_AI_FAKE). */
  fake?: FakeOptions;
  gm?: "pipeline" | "canned";
  /** The AI service in its podman image rather than as a node process. */
  container?: boolean;
  /** Start with no data: SpacetimeDB's, the AI service's store, and `sessions`. The keys stay, so identities do. */
  fresh?: boolean;
  /** More env for the AI service, at every start. */
  aiEnv?: Record<string, string>;
  /** The headless client's sessions (runs/play), emptied by `fresh`: they name games the fresh data hasn't got. */
  sessions?: string;
  /** Each step as it happens (the dev host prints them); the stack's log (logs/dev.log) has them either way. */
  log?(line: string): void;
  /** Aborts the start (a Ctrl+C while it runs): what's started is stopped, and startStack throws the abort. */
  signal?: AbortSignal;
}

export interface Stack {
  mode: Mode;
  http: string;
  ws: string;
  db: string;
  aiFromHost: string;
  aiFromSimulation: string;
  owner: stdb.Identity;
  ai: {
    identity: string;
    token: string;
    bearer: string;
    /** Starts it with the stack's env and `env` on top (a fault, the fake model's options), and waits for its health. */
    start(env?: Record<string, string>): Promise<void>;
    /** SIGTERM finishes what's in flight; SIGKILL is a crash. */
    stop(signal?: NodeJS.Signals): Promise<void>;
    /** The current run's exit code, once it exits (137 after an exit-after-store fault). */
    exited(): Promise<number>;
    running(): boolean;
  };
  stdb: { start(): Promise<void>; stop(): Promise<void>; running(): boolean };
  /** The stack as stack.json has it. */
  file(): StackFile;
  /** A reducer or procedure over HTTP, as the owner or the AI service: the answer's body (a procedure's value as JSON), or a CallError. */
  call(reducer: string, args: unknown, as?: "owner" | "ai"): Promise<string>;
  /** SQL as the owner (private tables too), rows decoded. */
  sql(query: string): Promise<Array<Record<string, unknown>>>;
  /** Builds and publishes the module again with the stack's env; the data stays unless the schema change needs it gone. */
  publish(): Promise<stdb.Published>;
  /** A campaign folder into both services; throws, saying which didn't take it and why, unless both did. */
  install(campaignDir: string): Promise<Installed>;
  doctor(options?: DoctorOptions): Promise<DoctorReport>;
  /** The AI service, then SpacetimeDB (pasta ends with its child). */
  down(): Promise<void>;
}

/** A call that didn't answer 200: its status (530 for a refusal) and its body (the refusal as JSON, refusalIn reads it). */
export class CallError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`${status}: ${refusalIn(body)?.text ?? body}`);
    this.status = status;
    this.body = body;
  }
}

const V2 = resolve(import.meta.dirname, "..", "..");

export async function startStack(options: StackOptions): Promise<Stack> {
  const paths = pathsOf(resolve(options.root));
  const log = stackLog(paths, options.log);
  const previous = readStackFile(paths.root);

  const ready = await readyToStart(options, paths);

  await clearLeftovers(previous, paths.root, log.say);
  prepareFolders(paths, options, log.say);
  await portsFree(options);
  options.signal?.throwIfAborted();

  const server = spacetimeServer(ready, options.stdbPort, paths, log.say);
  await server.start();

  try {
    return await startOnServer(options, ready, server, previous, paths, log);
  } catch (e) {
    await server.stop();
    throw e;
  }
}

/** What a start needs settled before it touches anything: the key (for real models), a mode that can run here, the CLI. */
interface Ready { key?: string; mode: Mode; http: string; cli: stdb.SpacetimeCli; urls: { fromHost: string; fromSimulation: string } }

async function readyToStart(options: StackOptions, paths: Paths): Promise<Ready> {
  const key = options.model === "openrouter" ? openRouterKey() : undefined;
  const mode = options.mode ?? detectMode(localAddresses());
  const problem = modeProblem(mode, localAddresses(), !!which("pasta"));
  if (problem) throw new Error(problem);
  const bin = await checkTools({ mode, container: !!options.container, config: paths.cliConfig });

  return {
    ...(key ? { key } : {}), mode, http: `http://127.0.0.1:${options.stdbPort}`,
    cli: { bin, config: paths.cliConfig, server: `kingmaker-${basename(paths.root)}` }, urls: aiUrls(options.aiPort),
  };
}

/** With SpacetimeDB up: the identities, the CLI logged in as the owner, the module published with its env, the AI service started. */
async function startOnServer(options: StackOptions, ready: Ready, server: SpacetimeServer, previous: StackFile | undefined, paths: Paths, log: StackLog): Promise<Stack> {
  options.signal?.throwIfAborted();
  const ids = await identities(ready.http, previous, log.say);
  await stdb.configureCli(ready.cli, ready.http, ids.owner);

  const moduleEnv = { AI_URL: ready.urls.fromSimulation, AI_TOKEN: ids.bearer, AI_IDENTITY: ids.ai.identity };
  await publishModule(ready.cli, moduleEnv, log, options.signal);

  // A start that fails or is aborted stops its own process; one aborted just after it's up is stopped here.
  const ai = aiProcess({ v2: V2, root: paths.root, container: !!options.container, url: ready.urls.fromHost, env: aiEnvOf(options, ready, ids, paths), log: paths.aiLog });
  log.say(`starting the AI service (${options.container ? "podman" : "node hosts/ai.ts"}, ${options.model} model)`);
  await ai.start({}, options.signal);
  if (options.signal?.aborted) await ai.stop();
  options.signal?.throwIfAborted();

  return stackOf(stackFileOf(options, ready, ids, paths.root), server, ai, moduleEnv, log);
}

/** stack.json's contents, the pids aside (they're the running stack's). */
function stackFileOf(options: StackOptions, ready: Ready, ids: Identities, root: string): StackFile {
  return {
    root, mode: ready.mode, http: ready.http, ws: ready.http.replace(/^http/, "ws"), db: stdb.DB, aiFromHost: ready.urls.fromHost, aiFromSimulation: ready.urls.fromSimulation,
    owner: ids.owner, ai: { ...ids.ai, bearer: ids.bearer, model: options.model, ...(options.gm ? { gm: options.gm } : {}), container: !!options.container },
    cli: ready.cli, ports: { stdb: options.stdbPort, ai: options.aiPort }, pids: {},
  };
}

// ---------------------------------------------------------------------------------------------
// The stack, running.

function stackOf(file: StackFile, server: SpacetimeServer, ai: AiProcess, moduleEnv: Record<string, string>, log: StackLog): Stack {
  const save = () => writeStackFile({ ...file, pids: { host: process.pid, stdb: server.pid(), ai: ai.pid() } });
  save();

  return {
    mode: file.mode, http: file.http, ws: file.ws, db: file.db, aiFromHost: file.aiFromHost, aiFromSimulation: file.aiFromSimulation, owner: file.owner,
    ai: {
      identity: file.ai.identity, token: file.ai.token, bearer: file.ai.bearer,
      async start(env) { await ai.start(env); save(); },
      async stop(signal) { await ai.stop(signal); save(); },
      exited: () => ai.exited(),
      running: () => ai.running(),
    },
    stdb: {
      async start() { await server.start(); save(); },
      async stop() { await server.stop(); save(); },
      running: () => server.pid() !== undefined,
    },
    file: () => ({ ...file, pids: { host: process.pid, stdb: server.pid(), ai: ai.pid() } }),
    async call(reducer, args, as = "owner") {
      const answer = await stdb.call(file.http, reducer, args, as === "owner" ? file.owner.token : file.ai.token);
      if ("error" in answer) throw new Error(`${reducer}: ${answer.error}`);
      if (answer.status !== 200) throw new CallError(answer.status, answer.body);
      return answer.body;
    },
    sql: query => stdb.sql(file.http, query, file.owner.token),
    publish: () => publishModule(file.cli, moduleEnv, log),
    async install(dir) {
      const installed = await installCampaign(resolve(dir), file);
      if (!installed.words.ok || !installed.structure.ok) throw new Error(describeInstall(installed));
      return installed;
    },
    doctor: options => doctor(file, options),
    async down() {
      log.say("stopping the AI service, then SpacetimeDB");
      await ai.stop();
      await server.stop();
      writeStackFile({ ...file, pids: {} });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The steps.

interface Paths { root: string; stdb: string; keys: string; ai: string; logs: string; cliConfig: string; devLog: string; stdbLog: string; aiLog: string }

function pathsOf(root: string): Paths {
  const logs = join(root, "logs");
  return {
    root, stdb: join(root, "stdb"), keys: join(root, "keys"), ai: join(root, "ai"), logs, cliConfig: join(root, "cli.toml"),
    devLog: join(logs, "dev.log"), stdbLog: join(logs, "spacetime.log"), aiLog: join(logs, "ai.log"),
  };
}

/** The stack's log (logs/dev.log): each step, also to the caller's log; and a command's output, to the file alone. */
interface StackLog { say(line: string): void; raw(text: string): void }

function stackLog(paths: Paths, print?: (line: string) => void): StackLog {
  mkdirSync(paths.logs, { recursive: true });
  const path = paths.devLog;
  return {
    say(line) {
      appendFileSync(path, `${new Date().toISOString()} ${line}\n`);
      print?.(line);
    },
    raw: text => appendFileSync(path, text.endsWith("\n") ? text : `${text}\n`),
  };
}

/** The OpenRouter key as v2/ai/llm reads it (OPENROUTER_API_KEY, else ~/secrets/kingmaker-dev-openrouter.txt). */
function openRouterKey(): string {
  try {
    return apiKey();
  } catch {
    throw new Error("there's no OpenRouter key (OPENROUTER_API_KEY, or ~/secrets/kingmaker-dev-openrouter.txt): run with --fake for the fake model");
  }
}

/**
 * A stack this folder left running (its host died without stopping it) is stopped; one whose host is
 * still running is left alone, and this start refused. A pid is only signalled when its command line
 * or environment names this folder, so a stranger that reused the pid is never touched.
 */
async function clearLeftovers(previous: StackFile | undefined, root: string, say: (line: string) => void): Promise<void> {
  const host = previous?.pids.host;
  if (host && host !== process.pid && alive(host) && isOurHost(host)) throw new Error(`a stack is already running from ${root} (pid ${host}): quit it first (q in its dev host)`);

  for (const [what, pgid, signal] of [["SpacetimeDB", previous?.pids.stdb, "SIGINT"], ["the AI service", previous?.pids.ai, "SIGTERM"]] as const) {
    if (!pgid || !groupMembers(pgid).some(pid => processText(pid).includes(root))) continue;
    say(`stopping ${what} left running from ${root} (process group ${pgid})`);
    await stopGroup(pgid, signal, 10_000);
  }
  if (which("podman")) await run("podman", ["rm", "--force", containerName(root)]);
}

/** Is this pid a stack host (the dev host, the e2e) run from this v2/? */
function isOurHost(pid: number): boolean {
  try {
    return processText(pid).includes("hosts/") && readlinkSync(`/proc/${pid}/cwd`) === V2;
  } catch {
    return false;
  }
}

/** The folders, emptied by --fresh, with the procedure pool sized before SpacetimeDB first reads its config. */
function prepareFolders(paths: Paths, options: StackOptions, say: (line: string) => void): void {
  if (options.fresh) {
    const gone = [paths.stdb, paths.ai, ...(options.sessions ? [resolve(options.sessions)] : [])];
    say(`fresh: deleting ${gone.map(d => relative(process.cwd(), d) || d).join(", ")} (the keys stay)`);
    for (const dir of gone) rmSync(dir, { recursive: true, force: true });
  }
  for (const dir of [paths.keys, paths.ai]) mkdirSync(dir, { recursive: true });
  stdb.ensurePoolSize(paths.stdb);
}

/** Both ports free on the host's loopback, or a refusal naming the flag that moves the stack. */
async function portsFree(options: StackOptions): Promise<void> {
  for (const [port, flag] of [[options.stdbPort, "--port"], [options.aiPort, "--ai-port"]] as const) {
    if (await listening(port)) throw new Error(`127.0.0.1:${port} is in use (another stack? npm run doctor says): choose another with ${flag}`);
  }
}

function listening(port: number): Promise<boolean> {
  return new Promise(done => {
    const socket = connect({ host: "127.0.0.1", port, timeout: 1_000 });
    socket.on("connect", () => { socket.destroy(); done(true); });
    socket.on("error", () => done(false));
    socket.on("timeout", () => { socket.destroy(); done(false); });
  });
}

interface SpacetimeServer { start(): Promise<void>; stop(): Promise<void>; pid(): number | undefined }

/** SpacetimeDB on the stack's port: on the host, or inside pasta in namespace mode, listening on every address there. */
function spacetimeServer(ready: Ready, port: number, paths: Paths, say: (line: string) => void): SpacetimeServer {
  let child: Child | undefined;
  const command = stdb.startArgs(ready.cli, { listen: stdbListen(ready.mode, port), dataDir: paths.stdb, keysDir: paths.keys });
  const [bin, args] = ready.mode === "namespace" ? ["pasta", pastaArgs(port, command)] : [command[0]!, command.slice(1)];

  return {
    async start() {
      say(`starting SpacetimeDB on 127.0.0.1:${port}${ready.mode === "namespace" ? " inside pasta" : ""}`);
      child = spawnLogged(bin, args, { cwd: paths.root, env: process.env, log: paths.stdbLog });
      const up = await waitFor(() => stdb.ping(ready.http), { timeoutMs: 30_000, gaveUp: () => !child!.running() });
      if (!up) {
        await child.stop("SIGKILL");
        throw new Error(`SpacetimeDB didn't answer on ${ready.http}. Its log (${paths.stdbLog}):\n${tail(paths.stdbLog)}`);
      }
    },
    // SIGINT, which it handles by shutting down cleanly: in namespace mode it's PID 1 of pasta's PID
    // namespace, where a signal it has no handler for (SIGTERM) is dropped, so it would outlive pasta.
    async stop() {
      await child?.stop("SIGINT", 10_000);
    },
    pid: () => (child?.running() ? child.pid : undefined),
  };
}

/** The owner and the AI service as identities on this server, and the bearer the module sends the AI service. */
interface Identities { owner: stdb.Identity; ai: stdb.Identity; bearer: string }

/** Each identity kept from the last run while the keys still sign it, else a new one; the bearer made once. */
async function identities(http: string, previous: StackFile | undefined, say: (line: string) => void): Promise<Identities> {
  const keep = async (id: stdb.Identity | undefined, who: string) => {
    if (id && (await stdb.stillValid(http, id))) return { identity: id.identity, token: id.token };
    say(`a new identity for ${who}`);
    return stdb.newIdentity(http);
  };
  return {
    owner: await keep(previous?.owner, "the owner"),
    ai: await keep(previous?.ai, "the AI service"),
    bearer: previous?.ai.bearer ?? randomBytes(32).toString("hex"),
  };
}

/** The module built and published with its env (v0-design §3.6), loudly when the schema change deleted the data. */
async function publishModule(cli: stdb.SpacetimeCli, env: Record<string, string>, log: StackLog, abort?: AbortSignal): Promise<stdb.Published> {
  const say = log.say;
  say("building and publishing the module");
  const published = await stdb.publish(cli, join(V2, "simulation"), env, abort);
  log.raw(published.output);
  abort?.throwIfAborted();
  if (!published.ok) {
    const owned = /not authorized|permission/i.test(published.output) ? " (the database belongs to another identity: start with --fresh)" : "";
    throw new Error(`spacetime publish failed${owned}:\n${published.output.trim().split("\n").slice(-12).join("\n")}`);
  }
  if (published.wiped) say("THE SCHEMA CHANGE DELETED THE DATABASE'S DATA (--delete-data=on-conflict): every game is gone");
  else say(published.created ? "the module is published (a new database)" : "the module is published (its data kept)");
  return published;
}

/** The AI service's env (v0-design §5.7): where it listens, its bearer, its store, SpacetimeDB as its own identity, the model. */
function aiEnvOf(options: StackOptions, ready: Ready, ids: Identities, paths: Paths): Record<string, string> {
  return {
    KM_AI_LISTEN: aiListen(ready.mode, options.aiPort),
    KM_AI_TOKEN: ids.bearer,
    KM_AI_STORE: paths.ai,
    KM_STDB_URL: ready.http,
    KM_STDB_DB: stdb.DB,
    KM_STDB_TOKEN: ids.ai.token,
    KM_AI_MODEL: options.model,
    ...(options.gm ? { KM_AI_GM: options.gm } : {}),
    ...(options.model === "fake" && options.fake ? { KM_AI_FAKE: JSON.stringify(options.fake) } : {}),
    ...(ready.key ? { OPENROUTER_API_KEY: ready.key } : {}),
    ...options.aiEnv,
  };
}
