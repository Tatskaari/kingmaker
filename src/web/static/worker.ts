import { mountReadOnly } from "./node/fs.ts";
import { process } from "./node/process.ts";
import { Store } from "./persist.ts";

/**
 * The game's Web Worker (the static build: src/web/README.md). The page's terminal shows what the
 * game draws; everything else happens here, so the map's animation and the game's work never
 * stall each other on the page:
 *
 *   page -> worker   { type: "start", cols, rows, key?, offline?, glyphs?, jobDelayMs? }  then input bytes, resizes, key changes
 *   worker -> page   { type: "started" }, { type: "output", data }, { type: "exit", jobs }, { type: "idle" }, { type: "error", message }
 *
 * The background jobs between turns (the GM's notes on a turn) run here too. When the game
 * closes, "exit" says how many are still running; the worker finishes them (and saves what they
 * write) before it says "idle", and the page lets it, as the server lets a closed game's jobs finish.
 *
 * Before the game's modules load (they read their settings as they load), the environment is set,
 * the game's content is mounted from content.json, and the saves are read back from IndexedDB.
 * Model calls go straight from here to OpenRouter with the player's key, which lives in this
 * worker's environment and nowhere else.
 */

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  location: { href: string };
}
const scope = self as unknown as WorkerScope;

let key = "";
let offline = false;
let store: Store | undefined;
let started: Promise<import("./game.tsx").Started> | undefined;
let output: string[] = [];
let flushing = false;
/** The background jobs running (the GM's notes on a turn: src/runtime/jobs.ts). */
const jobs = new Set<Promise<void>>();

/** The key never leaves this worker in anything it says: it's blanked from every message and log line. */
function redact(text: string): string {
  let out = key ? text.split(key).join("[redacted]") : text;
  out = out.replace(/sk-or-[A-Za-z0-9_-]{8,}/g, "[redacted]");
  return out;
}

/** The terminal's bytes go out in batches: whatever was drawn in one turn of the event loop is one message. */
function write(data: string): void {
  output.push(data);
  if (flushing) return;
  flushing = true;
  queueMicrotask(() => {
    flushing = false;
    const data = output.join("");
    output = [];
    // A key on screen (an error quoting it) would be masked cell for cell.
    scope.postMessage({ type: "output", data: key && data.includes(key) ? data.split(key).join("*".repeat(key.length)) : data });
  });
}

const fail = (error: unknown) => scope.postMessage({ type: "error", message: redact(error instanceof Error ? error.message : String(error)) });

// Console lines from the game (the background jobs' failures, warnings) can't carry the key either.
for (const level of ["log", "info", "warn", "error", "debug"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => original(...args.map(a => (typeof a === "string" ? redact(a) : a instanceof Error ? redact(a.stack ?? a.message) : a)));
}

// Model calls go to OpenRouter from here. Offline, they're turned away without going anywhere (the
// GM can't speak, as with the server's --offline). Whatever goes wrong is told without the key.
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (offline && url.startsWith("https://openrouter.ai/")) {
    return new Response(JSON.stringify({ error: { message: "Offline: there's no OpenRouter key, so the GM can't speak.", code: 401 } }), { status: 401, headers: { "content-type": "application/json" } });
  }
  try {
    return await realFetch(input, init);
  } catch (error) {
    throw new Error(redact(`${(error as Error).name}: ${(error as Error).message}`));
  }
};

const GLYPH_SETS = ["kingmaker", "ascii", "nerd", "plain"];

async function start(options: { cols: number; rows: number; key?: string; offline?: boolean; glyphs?: string; jobDelayMs?: number; debug?: boolean }): Promise<import("./game.tsx").Started> {
  offline = !!options.offline || !options.key;
  key = offline ? "" : options.key!.trim();
  // Only what's known goes into the game's environment from the page (it comes from the URL).
  const jobDelay = Math.min(60000, Math.max(0, Math.floor(Number(options.jobDelayMs) || 0)));
  Object.assign(process.env, {
    OPENROUTER_API_KEY: offline ? "offline" : key,
    KM_GLYPHS: GLYPH_SETS.includes(String(options.glyphs)) ? options.glyphs : "kingmaker",
    ...(jobDelay ? { KM_JOB_DELAY_MS: String(jobDelay) } : {}),
    ...(options.debug ? { KM_DEBUG: "1" } : {}),
  });
  const content = await (await realFetch(new URL("content.json", scope.location.href))).json() as { files: Record<string, string> };
  mountReadOnly(content.files);
  try {
    store = await Store.open();
    // The game plays on (what it holds is the only copy now): it says so, and the next save tries again.
    store.onError = error => {
      const said = redact(`This browser wouldn't keep the game just now (${(error as Error)?.message ?? error}); it will try again.`);
      console.warn(said);
      void started?.then(({ game }) => { game.status = said; game.emit(); });
    };
    await store.load();
    store.autosave();
  } catch (error) {
    // Without IndexedDB (a private window may refuse it) the game still plays; it just won't keep.
    console.warn("No IndexedDB here, so this game won't be kept:", error);
  }
  const { startGame } = await import("./game.tsx");
  const running = await startGame({
    cols: options.cols,
    rows: options.rows,
    write,
    onQuit: () => void quit(),
    onJob: job => {
      jobs.add(job);
      job.catch(error => console.warn("A background job (the GM's notes on a turn) failed:", error)).finally(() => jobs.delete(job));
    },
  });
  if (!store) {
    running.game.status = "This browser won't keep games (no IndexedDB here): this one plays, but it won't be here next time.";
    running.game.emit();
  }
  scope.postMessage({ type: "started", offline });
  return running;
}

/** Saved and gone: the page may end this worker once it hears so, or once it's idle if jobs were still running. */
async function quit(): Promise<void> {
  await store?.flush();
  scope.postMessage({ type: "exit", jobs: jobs.size });
  if (!jobs.size) return;
  // The GM's notes on the last turn, still being written: finished and saved before the worker goes.
  while (jobs.size) await Promise.allSettled([...jobs]);
  await store?.flush();
  scope.postMessage({ type: "idle" });
}

scope.addEventListener("message", event => {
  const message = event.data as { type?: string; [key: string]: unknown };
  switch (message.type) {
    case "start":
      if (started) return;
      started = start(message as never);
      started.catch(fail);
      return;
    case "input":
      void started?.then(({ renderer }) => renderer.processInput(message["data"] as Uint8Array | string));
      return;
    case "resize":
      void started?.then(({ renderer }) => renderer.resize(Number(message["cols"]), Number(message["rows"])));
      return;
    case "key":
      // A new key from the page: the next model call uses it.
      if (typeof message["key"] === "string" && message["key"]) {
        key = message["key"].trim();
        offline = false;
        process.env.OPENROUTER_API_KEY = key;
      }
      return;
    case "redraw":
      void started?.then(({ renderer }) => renderer.invalidate());
      return;
    case "flush":
      void (store?.flush() ?? Promise.resolve()).then(() => scope.postMessage({ type: "flushed" }));
      return;
    case "quit":
      // The page is going (Ctrl+C's way: save, then go).
      void started?.then(({ game }) => game.quit());
      return;
    case "stats":
      void started?.then(({ renderer }) => scope.postMessage({ type: "stats", ...renderer.stats, saves: store?.writes ?? 0 }));
      return;
  }
});
