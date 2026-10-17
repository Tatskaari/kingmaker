import { appendFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { run, spawnLogged, tail, type Child } from "./child.ts";
import { request, waitFor } from "./http.ts";

/**
 * The AI service as the stack runs it (v0-design §5.7): `node hosts/ai.ts` under plain node, or the
 * same files in its podman image. Its settings are env (KM_AI_*, KM_STDB_*, the model's key), set by
 * the stack; `start` can add to them for one run (a fault, a slower fake model).
 */
export interface AiProcess {
  /** Starts it with its env and `extra` on top, and waits for its health; `abort` stops a start under way (the image's build, the wait). */
  start(extra?: Record<string, string>, abort?: AbortSignal): Promise<void>;
  /** Signals it and waits for it to go: SIGTERM finishes what's in flight; SIGKILL is a crash. Resolves with its exit code. */
  stop(signal?: NodeJS.Signals): Promise<number>;
  /** The current run's exit code, once it has exited. */
  exited(): Promise<number>;
  running(): boolean;
  pid(): number | undefined;
}

export interface AiProcessOptions {
  v2: string;
  root: string;
  container: boolean;
  /** The service's URL from the host: its health is polled there. */
  url: string;
  /** Everything it's told, the bearer and the key included; KM_AI_STORE is the stack's ai/ folder (the image's /data). */
  env: Record<string, string>;
  log: string;
  /** The image, built from ai/Containerfile at every start (podman's cache makes an unchanged build quick). */
  image?: string;
}

export const IMAGE = "kingmaker-ai";

/** How long a SIGTERM'd service has before it's killed: it finishes what's in flight for up to 10 s. */
const GRACE_MS = 15_000;

/** The container's name: one per stack folder, so the dev stack and the e2e's don't collide. */
export const containerName = (root: string) => `kingmaker-ai-${basename(root)}`;

export function aiProcess(options: AiProcessOptions): AiProcess {
  let child: Child | undefined;

  return {
    async start(extra = {}, abort) {
      if (child?.running()) throw new Error("the AI service is already running");
      const env = { ...options.env, ...extra };

      child = options.container ? await startContainer(options, env, abort) : startNode(options, env);
      const up = await waitFor(() => healthy(options.url), { timeoutMs: 30_000, gaveUp: () => !child!.running() || !!abort?.aborted });

      if (!up) {
        await child.stop("SIGKILL");
        abort?.throwIfAborted();
        throw new Error(`the AI service didn't answer at ${options.url}/v1/health. Its log (${options.log}):\n${tail(options.log)}`);
      }
    },
    async stop(signal = "SIGTERM") {
      if (!child?.running()) return child ? child.exited : 0;
      if (options.container) return stopContainer(child, containerName(options.root), signal);
      return child.stop(signal, GRACE_MS);
    },
    exited: () => child?.exited ?? Promise.resolve(0),
    running: () => !!child?.running(),
    pid: () => (child?.running() ? child.pid : undefined),
  };
}

/** `node --no-warnings hosts/ai.ts`, as `npm run ai` and the container run it. */
function startNode(options: AiProcessOptions, env: Record<string, string>): Child {
  mkdirSync(env.KM_AI_STORE ?? join(options.root, "ai"), { recursive: true });
  return spawnLogged(process.execPath, ["--no-warnings", "hosts/ai.ts"], { cwd: options.v2, env: { ...process.env, ...env }, log: options.log });
}

/**
 * The image built (from v2/, so it has the current code; its log goes to the AI service's), then run
 * with the host's network, so it listens and reaches SpacetimeDB as the node process does. The store
 * is mounted as /data (the image's KM_AI_STORE), with --userns=keep-id: the container runs as this
 * user, so what it writes there is this user's. Values are passed by name (-e NAME), never on podman's
 * command line, where ps would show the key.
 */
async function startContainer(options: AiProcessOptions, env: Record<string, string>, abort?: AbortSignal): Promise<Child> {
  const image = options.image ?? IMAGE, name = containerName(options.root);
  const store = env.KM_AI_STORE ?? join(options.root, "ai");
  mkdirSync(store, { recursive: true });

  const built = await run("podman", ["build", "-f", "ai/Containerfile", "-t", image, "."], { cwd: options.v2, timeoutMs: 600_000, ...(abort ? { abort } : {}) });
  appendFileSync(options.log, `--- podman build -f ai/Containerfile -t ${image} .\n${built.stdout}${built.stderr}`);
  abort?.throwIfAborted();
  if (built.code !== 0) throw new Error(`podman build -f ai/Containerfile failed:\n${tail(options.log)}`);
  await run("podman", ["rm", "--force", name]);

  const { KM_AI_STORE: _store, ...passed } = env;
  const args = [
    "run", "--rm", "--name", name, "--network=host", "--userns=keep-id", "-v", `${store}:/data:Z`,
    ...Object.keys(passed).flatMap(k => ["-e", k]), image,
  ];
  return spawnLogged("podman", args, { cwd: options.v2, env: { ...process.env, ...passed }, log: options.log });
}

/** The container signalled through podman (podman run then exits with its code); removed by force if it won't go. */
async function stopContainer(child: Child, name: string, signal: NodeJS.Signals): Promise<number> {
  await run("podman", ["kill", "--signal", signal, name]);
  const code = await within(child.exited, GRACE_MS);
  if (code !== undefined) return code;
  await run("podman", ["rm", "--force", name]);
  return child.stop("SIGKILL");
}

/** A promise's value, or undefined when it takes longer than ms (the timer cleared either way, so nothing waits on it). */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let clear = () => {};
  const late = new Promise<undefined>(r => {
    const timer = setTimeout(r, ms);
    clear = () => clearTimeout(timer);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clear();
  }
}

/** Does /v1/health answer? */
async function healthy(url: string): Promise<boolean> {
  const answer = await request(`${url}/v1/health`, { timeoutMs: 2_000 });
  return "status" in answer && answer.status === 200;
}
