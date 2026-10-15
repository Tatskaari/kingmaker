import { mountReadOnly } from "./node/fs.ts";
import { process } from "./node/process.ts";
import { dbName, Store } from "./persist.ts";

/**
 * The game's Web Worker (the static build: src/web/README.md). The page's terminal shows what the
 * game draws; everything else happens here, so the map's animation and the game's work never
 * stall each other on the page:
 *
 *   page -> worker   { type: "start", cols, rows, window?, key?, offline?, glyphs?, jobDelayMs? }  then input bytes, resizes, key changes
 *   worker -> page   { type: "started", offline, channel }, { type: "output", data }, { type: "storage", ok, message? },
 *                    { type: "busy", channel }, { type: "key-refused" }, { type: "exit", jobs }, { type: "idle" },
 *                    { type: "report", name, data }, { type: "error", message, reload? }
 *
 * A report of a problem (src/report) is made here and handed to the page as gzipped bytes, which it
 * downloads: what's kept in the browser is out of reach of anyone investigating it.
 *
 * The background jobs between turns (the GM's notes on a turn) run here too. When the game
 * closes, "exit" says how many are still running; the worker finishes them (and saves what they
 * write) before it says "idle", and the page lets it, as the server lets a closed game's jobs finish.
 *
 * Before the game's modules load (they read their settings as they load), the environment is set,
 * the game's content is mounted from content.json, and the saves are read back from IndexedDB
 * ("storage" tells the page when they can't be kept, until they can). Model calls go straight from
 * here to OpenRouter with the player's key, which lives in this worker's environment and nowhere
 * else; a call it turns down for the key ("key-refused") has the page ask for another.
 *
 * One tab at a time plays from the saves: each worker holds its own copy of them, and the last to
 * write a file wins, so a second tab playing its stale copy would undo the first one's progress. A
 * worker holds a Web Lock named after the deployment (as its database is) for as long as it runs.
 * One that finds the lock held says "busy" and waits for it; the page offers to take the game over,
 * and the tab holding it hears that on a BroadcastChannel of the same name (the "channel" it was
 * told when its game started), saves its game and closes it, and its worker lets go.
 */

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  location: { href: string; search: string };
}
const scope = self as unknown as WorkerScope;

/** Where this copy of the game is published (the directory worker.js is in): its saves and its lock are named after it. */
const NAME = dbName(new URL(".", scope.location.href).pathname);

let key = "";
let offline = false;
let store: Store | undefined;
let started: Promise<import("./game.tsx").Started> | undefined;
let output: string[] = [];
let flushing = false;
/** The background jobs running (the GM's notes on a turn: src/runtime/jobs.ts). */
const jobs = new Set<Promise<void>>();

/** What an OpenRouter key looks like, wherever it turns up. */
const KEYISH = /sk-or-v1-[0-9a-f]{32,}/gi;

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

const decoder = new TextDecoder();

/**
 * Keys and the mouse, on their way into the game. A key pasted into the game (meant for the key form,
 * say) goes no further: typed into a scene it would go to the GM and into the saves.
 */
function scrub(data: Uint8Array | string): Uint8Array | string {
  const text = typeof data === "string" ? data : decoder.decode(data);
  KEYISH.lastIndex = 0;
  if (!KEYISH.test(text) && !(key && text.includes(key))) return data;
  return (key ? text.split(key).join("") : text).replace(KEYISH, "");
}

/** The site's files didn't all load: the preview was published again while this page was open, say. */
class Unloaded extends Error {}

/** How a browser says a module of the game wouldn't load (Chromium, Firefox, Safari). */
const unloaded = (error: unknown) =>
  error instanceof Unloaded || /dynamically imported module|Importing a module script failed/i.test(String((error as Error)?.message ?? error));

function fail(error: unknown): void {
  const said = redact(error instanceof Error ? error.message : String(error));
  if (unloaded(error)) {
    console.warn("The game's files didn't load:", said);
    scope.postMessage({ type: "error", reload: true, message: `The game's files didn't all load, perhaps because this preview was updated since the page opened. Reload the page to get the new ones. (${said})` });
  } else scope.postMessage({ type: "error", message: said });
}

// Console lines from the game (the background jobs' failures, warnings) can't carry the key either.
for (const level of ["log", "info", "warn", "error", "debug"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => original(...args.map(a => (typeof a === "string" ? redact(a) : a instanceof Error ? redact(a.stack ?? a.message) : a)));
}

// Model calls go to OpenRouter from here. Offline, they're turned away without going anywhere (the
// GM can't speak, as with the server's --offline). Whatever goes wrong is told without the key, and
// a key OpenRouter turns down (revoked since it was kept, say) has the page ask for another.
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (offline && url.startsWith("https://openrouter.ai/")) {
    return new Response(JSON.stringify({ error: { message: "Offline: there's no OpenRouter key, so the GM can't speak.", code: 401 } }), { status: 401, headers: { "content-type": "application/json" } });
  }
  let response: Response;
  try {
    response = await realFetch(input, init);
  } catch (error) {
    throw new Error(redact(`${(error as Error).name}: ${(error as Error).message}`));
  }
  if (response.status === 401 && url.startsWith("https://openrouter.ai/")) scope.postMessage({ type: "key-refused" });
  return response;
};

const GLYPH_SETS = ["kingmaker", "ascii", "nerd", "plain"];

/** How the saves are being kept, for the page to say under the game until it changes: nothing when they're kept. */
function storage(ok: boolean, message?: string): void {
  scope.postMessage({ type: "storage", ok, ...(message ? { message } : {}) });
}

/** The game's content (lore, prompts, the rules' content pack), from beside this worker (with its build's ?v=). */
async function content(): Promise<Record<string, string>> {
  const response = await realFetch(new URL(`content.json${scope.location.search}`, scope.location.href)).catch(error => { throw new Unloaded(`content.json: ${(error as Error).message}`); });
  if (!response.ok) throw new Unloaded(`content.json: HTTP ${response.status}`);
  try {
    return ((await response.json()) as { files: Record<string, string> }).files;
  } catch (error) {
    throw new Unloaded(`content.json: ${(error as Error).message}`);
  }
}

/** One tab at a time (see above): resolves once this worker holds the lock, which it then keeps for as long as it runs. */
async function claim(): Promise<void> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  // No Web Locks here (an older browser, or a page that isn't https or localhost): every tab plays its own copy, as before.
  if (!locks) return;
  const held = () => new Promise<never>(() => {});
  try {
    // A moment's grace first: a tab being reloaded lets go as its old page goes.
    const wait = new AbortController();
    const timer = setTimeout(() => wait.abort(), 1500);
    const got = await new Promise<boolean>(resolve => {
      locks.request(NAME, { signal: wait.signal }, () => { clearTimeout(timer); resolve(true); return held(); }).catch(() => resolve(false));
    });
    if (got) return;
    scope.postMessage({ type: "busy", channel: NAME });
    await new Promise<void>(resolve => { locks.request(NAME, () => { resolve(); return held(); }).catch(() => resolve()); });
  } catch (error) {
    // Locks refused outright (a sandboxed page, say): as without them.
    console.warn("No Web Locks here, so another tab could play the same saves:", error);
  }
}

/** The saves: opened, read back, and kept as the game goes. Without them the game still plays, and the page says it won't keep. */
async function keep(): Promise<void> {
  try {
    store = await Store.open(NAME);
  } catch (error) {
    // A private window may refuse IndexedDB, and so does a browser blocking this site's data.
    console.warn("No IndexedDB here, so this game won't be kept:", error);
    storage(false, /didn't answer/.test(String((error as Error)?.message))
      ? "This browser's storage didn't answer, so this game won't be kept."
      : "This browser won't keep games here: this one goes when the page closes.");
    return;
  }
  let failing = false;
  // The game plays on (what it holds is the only copy now), and the next save tries again.
  store.onError = error => {
    failing = true;
    console.warn(redact(`This browser wouldn't keep the game just now (${(error as Error)?.message ?? error}); it will try again.`));
    storage(false, "This browser wouldn't save the game just now (is its storage full?). Still trying.");
  };
  store.onSaved = () => {
    if (!failing) return;
    failing = false;
    storage(true);
  };
  try {
    await store.load();
  } catch (error) {
    // What's kept can't be offered, but what's played from now on can still be kept.
    console.warn("Couldn't read the saved games back from IndexedDB:", error);
    storage(false, "This browser couldn't read back the games it kept; this one is kept as it goes.");
  }
  store.autosave();
}

/** The browser's window, as the page says it ("1280x800@2": CSS pixels and the device pixel ratio), for a report; anything else isn't kept. */
const windowOf = (said: unknown) => (typeof said === "string" && /^\d{1,5}x\d{1,5}@\d{1,2}(\.\d{1,4})?$/.test(said) ? said : undefined);

async function start(options: { cols: number; rows: number; window?: string; key?: string; offline?: boolean; glyphs?: string; jobDelayMs?: number; debug?: boolean }): Promise<import("./game.tsx").Started> {
  offline = !!options.offline || !options.key;
  key = offline ? "" : options.key!.trim();
  // Only what's known goes into the game's environment from the page (it comes from the URL).
  const jobDelay = Math.min(60000, Math.max(0, Math.floor(Number(options.jobDelayMs) || 0)));
  // The build's stamp (this worker is asked for with it: ?v=), for a report to say which build it was.
  const stamp = new URLSearchParams(scope.location.search).get("v") ?? "";
  const size = windowOf(options.window);
  Object.assign(process.env, {
    OPENROUTER_API_KEY: offline ? "offline" : key,
    KM_GLYPHS: GLYPH_SETS.includes(String(options.glyphs)) ? options.glyphs : "kingmaker",
    // The game is on a web page: Esc there dismisses things, and there's nothing to quit to.
    KM_IN_BROWSER: "1",
    KM_HOST: "static",
    KM_BROWSER_UA: navigator.userAgent,
    ...(/^[0-9a-f]{6,64}$/.test(stamp) ? { KM_BUILD_STAMP: stamp } : {}),
    ...(size ? { KM_WINDOW: size } : {}),
    ...(jobDelay ? { KM_JOB_DELAY_MS: String(jobDelay) } : {}),
    ...(options.debug ? { KM_DEBUG: "1" } : {}),
  });
  const files = content();
  files.catch(() => {});
  await claim();
  mountReadOnly(await files);
  await keep();
  // (A chunk of it that won't load is told as such by fail().)
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
    // A part of the game that loads as it's needed didn't (the preview was updated since): the page offers a reload. The game's saved as it goes.
    onUnloaded: error => { void (store?.flush() ?? Promise.resolve()).then(() => fail(error)); },
    unloaded,
    // A report of a problem: its bytes (the key already taken out of it) to the page, which downloads it.
    onReport: (name, bytes) => {
      const data = bytes.slice().buffer;
      scope.postMessage({ type: "report", name, data }, [data]);
    },
  });
  scope.postMessage({ type: "started", offline, channel: NAME });
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
    case "input": {
      const data = scrub(message["data"] as Uint8Array | string);
      void started?.then(({ renderer }) => renderer.processInput(data));
      return;
    }
    case "resize": {
      const size = windowOf(message["window"]);
      if (size) process.env.KM_WINDOW = size;
      void started?.then(({ renderer }) => renderer.resize(Number(message["cols"]), Number(message["rows"])));
      return;
    }
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
      // The page is going (Ctrl+C's way: save, then go), or another tab is taking the game over.
      void started?.then(({ game }) => game.quit());
      return;
    case "stats":
      void started?.then(({ renderer }) => scope.postMessage({ type: "stats", ...renderer.stats, saves: store?.writes ?? 0 }));
      return;
  }
});
