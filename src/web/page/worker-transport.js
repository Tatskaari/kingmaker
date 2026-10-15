// The static build's transport (client.js loads it when <html data-mode="static">): the game runs
// in a Web Worker on this page (worker.js), and this speaks to the page in the server's messages
// (hello, started, exit, error, stats) so the rest of the page is the same. It also says what only
// the static build has to say, on the bar under the terminal: whether this browser is keeping the
// game, and the key. And it keeps to one tab at a time (src/web/static/worker.ts): a tab whose
// worker finds the game open in another offers to take it over, and the other tab, told so on a
// BroadcastChannel, saves its game and lets it go.
//
// The OpenRouter key is kept as V1 kept it: in localStorage under "kingmaker.openrouter-api-key"
// (the previews share an origin, so a key entered in one works in the others), asked for when
// there's none, checked with OpenRouter before it's kept, sent to the worker by postMessage, and
// changed or forgotten from the bar under the terminal. It's never put in a URL or a log line.

const KEY_STORAGE = "kingmaker.openrouter-api-key";
const KEY_SHAPE = /^[\x21-\x7e]{8,256}$/;
const KEY_CHECK = "https://openrouter.ai/api/v1/key";
// How long a closed game's worker may stay to finish its background jobs (the server's grace, src/web/server.ts).
const JOBS_GRACE_MS = 3 * 60 * 1000;
// The build's stamp (build.ts): every file that isn't named by its hash is asked for with it, so a new build's are never mixed with an old one's from the cache.
const BUILD = document.documentElement.dataset.build;
const VERSION = BUILD ? `?v=${encodeURIComponent(BUILD)}` : "";

// A key this browser wouldn't keep (localStorage blocked): it's still the key for as long as the page is open.
let pageKey = "";

export function storedKey() {
  try { return localStorage.getItem(KEY_STORAGE)?.trim() || pageKey; } catch { return pageKey; }
}

/** Whether the key is kept (localStorage can be blocked, with the rest of the site's data). */
function keepKey(key) {
  pageKey = key;
  try {
    localStorage.setItem(KEY_STORAGE, key);
    return localStorage.getItem(KEY_STORAGE) === key;
  } catch {
    return false;
  }
}

function forgetKey() {
  pageKey = "";
  try { localStorage.removeItem(KEY_STORAGE); } catch { /* nothing to forget */ }
}

const keptHere = () => {
  try { return !!localStorage.getItem(KEY_STORAGE)?.trim(); } catch { return false; }
};

/** What's wrong with a key, if it can be told from the key itself (as the server tells it). */
function keyProblem(key) {
  if (!KEY_SHAPE.test(key)) return "That doesn't look like an OpenRouter key.";
  if (key.startsWith("sk-or-")) return undefined;
  const needed = "The GM runs through OpenRouter, so it needs an OpenRouter key (they start with sk-or-).";
  if (key.startsWith("sk-ant-")) return `That looks like an Anthropic key. ${needed}`;
  if (key.startsWith("sk-")) return `That looks like an OpenAI key. ${needed}`;
  return "That doesn't look like an OpenRouter key: they start with sk-or-.";
}

/** Whether OpenRouter turns the key down (a free call). If it can't be asked, the game starts anyway and the GM says what's wrong. */
async function keyRefused(key) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 8000);
  try {
    const response = await fetch(KEY_CHECK, { headers: { Authorization: `Bearer ${key}` }, signal: timeout.signal });
    await response.body?.cancel();
    return response.status === 401 || response.status === 403;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function workerTransport(handlers, options) {
  let worker;
  let toPage = 0;
  let fromPage = 0;
  let offline = options.offline;
  // Whether the key in use is kept in this browser (or only on this page).
  let kept = keptHere();
  // How the saves are kept, as the worker last said (nothing to say when they're kept).
  let storage = { ok: true };
  const flushes = [];
  const statsWaiters = [];
  // A closed game's worker finishing its background jobs: resolves once it's gone.
  let finishing;
  // The game's channel to the other tabs (from "started"), and whether one of them has asked for the game.
  let channel;
  let movedAway = false;
  const bar = document.getElementById("key-bar");

  const self = {
    send(message) {
      switch (message.type) {
        case "start": void start(message); return;
        case "resize": worker?.postMessage({ type: "resize", cols: message.cols, rows: message.rows }); return;
        case "stats":
          // The game's own numbers (frames, the time they took, saves) with what's crossed between page and worker.
          if (!worker) return handlers.message({ type: "stats", toPage, fromPage, wireOut: toPage, wireIn: fromPage });
          statsWaiters.push(game => handlers.message({ ...game, type: "stats", toPage, fromPage, wireOut: toPage, wireIn: fromPage }));
          worker.postMessage({ type: "stats" });
          return;
      }
    },
    sendBytes(bytes) {
      if (!worker) return false;
      worker.postMessage({ type: "input", data: bytes }, [bytes.buffer]);
      fromPage += bytes.length;
      return true;
    },
    started(message) {
      offline = message.offline;
      showBar();
      // Another tab asking for the game: this one saves it and lets it go (its worker's lock with it).
      channel?.close();
      channel = message.channel && typeof BroadcastChannel === "function" ? new BroadcastChannel(message.channel) : undefined;
      if (channel) channel.onmessage = event => {
        if (event.data?.type !== "take-over" || !worker || movedAway) return;
        movedAway = true;
        worker.postMessage({ type: "quit" });
      };
    },
    flush() {
      if (!worker) return Promise.resolve();
      return new Promise(resolve => { flushes.push(resolve); worker.postMessage({ type: "flush" }); });
    },
    leaving() {
      worker?.postMessage({ type: "quit" });
    },
    close() {
      channel?.close();
      worker?.terminate();
      worker = undefined;
    },
    /** Whether a closed game is still finishing the GM's notes on its last turn. */
    finishing() {
      return !!finishing;
    },
    /** Resolves when nothing of a closed game is left running. */
    settled() {
      return finishing ?? Promise.resolve();
    },
  };

  /** This page wants the game another tab has: that tab is asked to save it and let go (this page's worker is waiting for it). */
  function takeOver(name) {
    if (typeof BroadcastChannel !== "function") return;
    const ask = new BroadcastChannel(name);
    ask.postMessage({ type: "take-over" });
    ask.close();
  }

  async function start(message) {
    let key = message.offline || offline ? "" : message.key ?? storedKey();
    if (message.key) {
      const problem = keyProblem(key);
      if (problem) return handlers.message({ type: "hello", needKey: true, error: problem });
      if (await keyRefused(key)) return handlers.message({ type: "hello", needKey: true, error: "OpenRouter didn't accept that key. You can check it, or make another, at openrouter.ai/keys." });
      kept = keepKey(key);
    }
    movedAway = false;
    worker = new Worker(new URL(`./worker.js${VERSION}`, import.meta.url), { type: "module" });
    const mine = worker;
    worker.onmessage = event => {
      const m = event.data;
      if (m.type === "output") {
        toPage += m.data.length;
        handlers.bytes(m.data);
      } else if (m.type === "flushed") {
        flushes.shift()?.();
      } else if (m.type === "stats") {
        statsWaiters.shift()?.(m);
      } else if (m.type === "storage") {
        storage = m;
        showBar();
      } else if (m.type === "busy") {
        handlers.message({ type: "busy", takeOver: () => takeOver(m.channel ?? "") });
      } else if (m.type === "key-refused") {
        // A kept key that's since been revoked, say: the page asks for another (once, while the form's closed).
        if (document.getElementById("gate").hidden) options.askForKey("OpenRouter turned down the key this game was using (it may have been revoked or used up). Enter another, or carry on without the GM.", keyOptions);
      } else if (m.type === "exit") {
        channel?.close();
        channel = undefined;
        handlers.message(movedAway ? { ...m, moved: true } : m);
        worker = undefined;
        if (!m.jobs) return mine.terminate();
        // Its background jobs (the GM's notes on the last turn) go on until they're done and saved, as the server lets them.
        finishing = new Promise(resolve => {
          const done = () => {
            mine.terminate();
            finishing = undefined;
            resolve();
          };
          mine.addEventListener("message", event => { if (event.data.type === "idle") done(); });
          setTimeout(done, JOBS_GRACE_MS);
        });
      } else if (m.type !== "idle") handlers.message(m);
    };
    // The worker's own script wouldn't load or run (a missing file after the preview was updated, or a browser that can't run it).
    worker.onerror = () => handlers.message({ type: "error", reload: true, message: "The game couldn't start in this browser: its files didn't load, or this browser can't run it. Reloading the page may help." });
    worker.postMessage({
      type: "start", cols: message.cols, rows: message.rows, ...(key ? { key } : { offline: true }),
      ...(options.glyphs ? { glyphs: options.glyphs } : {}), ...(options.jobDelayMs ? { jobDelayMs: options.jobDelayMs } : {}),
    });
    key = "";
  }

  // A key for the game already running (or, offline, one to play with from now on): checked, kept, and sent over.
  async function changeKey(key) {
    const problem = keyProblem(key);
    if (problem) return options.askForKey(problem, keyOptions);
    if (await keyRefused(key)) return options.askForKey("OpenRouter didn't accept that key. You can check it, or make another, at openrouter.ai/keys.", keyOptions);
    kept = keepKey(key);
    worker?.postMessage({ type: "key", key });
    offline = false;
    options.closeKeyForm();
    showBar();
  }
  // Over a game that's playing, the form can be left as it was: with the key it had, or offline.
  const keyOptions = { onKey: key => void changeKey(key), onOffline: () => {}, cancel: true };

  function showBar() {
    if (!bar) return;
    bar.hidden = false;
    const using = !!storedKey();
    bar.querySelector("[data-state]").textContent = offline && !using ? "Offline: the GM can't speak."
      : kept ? "Your OpenRouter key is kept in this browser."
      : "Your OpenRouter key is used on this page only: this browser won't keep it.";
    bar.querySelector("[data-change]").textContent = offline && !using ? "Enter a key" : "Change key";
    bar.querySelector("[data-forget]").hidden = !using;
    // Whether the game is being kept: said until it is.
    const said = bar.querySelector("[data-storage]");
    said.hidden = storage.ok;
    said.textContent = storage.ok ? "" : storage.message ?? "This browser isn't keeping the game.";
    said.title = said.textContent;
  }

  if (bar) {
    bar.querySelector("[data-change]").onclick = () => options.askForKey(undefined, keyOptions);
    bar.querySelector("[data-forget]").onclick = () => {
      forgetKey();
      // The game saves and stops (Ctrl+C's way); without a key, the page asks for one again.
      const reload = () => location.reload();
      if (!worker) return reload();
      worker.addEventListener("message", event => { if (event.data.type === "exit") reload(); });
      worker.postMessage({ type: "quit" });
      setTimeout(reload, 1500);
    };
  }

  // As the server says hello: whether the page must ask for a key first.
  queueMicrotask(() => handlers.message({ type: "hello", needKey: !offline && !storedKey(), offline }));
  return self;
}
