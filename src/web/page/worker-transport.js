// The static build's transport (client.js loads it when <html data-mode="static">): the game runs
// in a Web Worker on this page (worker.js), and this speaks to the page in the server's messages
// (hello, started, exit, error, stats) so the rest of the page is the same.
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

export function storedKey() {
  try { return localStorage.getItem(KEY_STORAGE)?.trim() || ""; } catch { return ""; }
}

function keepKey(key) {
  try { localStorage.setItem(KEY_STORAGE, key); } catch { /* the game still plays; the key won't keep */ }
}

function forgetKey() {
  try { localStorage.removeItem(KEY_STORAGE); } catch { /* nothing to forget */ }
}

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
  try {
    const response = await fetch(KEY_CHECK, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
    await response.body?.cancel();
    return response.status === 401 || response.status === 403;
  } catch {
    return false;
  }
}

export function workerTransport(handlers, options) {
  let worker;
  let toPage = 0;
  let fromPage = 0;
  let offline = options.offline;
  const flushes = [];
  const statsWaiters = [];
  // A closed game's worker finishing its background jobs: resolves once it's gone.
  let finishing;
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
    },
    flush() {
      if (!worker) return Promise.resolve();
      return new Promise(resolve => { flushes.push(resolve); worker.postMessage({ type: "flush" }); });
    },
    leaving() {
      worker?.postMessage({ type: "quit" });
    },
    close() {
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

  async function start(message) {
    let key = message.offline || offline ? "" : message.key ?? storedKey();
    if (message.key) {
      const problem = keyProblem(key);
      if (problem) return handlers.message({ type: "hello", needKey: true, error: problem });
      if (await keyRefused(key)) return handlers.message({ type: "hello", needKey: true, error: "OpenRouter didn't accept that key. You can check it, or make another, at openrouter.ai/keys." });
      keepKey(key);
    }
    worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    worker.onmessage = event => {
      const m = event.data;
      if (m.type === "output") {
        toPage += m.data.length;
        handlers.bytes(m.data);
      } else if (m.type === "flushed") {
        flushes.shift()?.();
      } else if (m.type === "stats") {
        statsWaiters.shift()?.(m);
      } else if (m.type === "exit") {
        handlers.message(m);
        const closed = worker;
        worker = undefined;
        if (!m.jobs) return closed?.terminate();
        // Its background jobs (the GM's notes on the last turn) go on until they're done and saved, as the server lets them.
        finishing = new Promise(resolve => {
          const done = () => {
            closed.terminate();
            finishing = undefined;
            resolve();
          };
          closed.addEventListener("message", event => { if (event.data.type === "idle") done(); });
          setTimeout(done, JOBS_GRACE_MS);
        });
      } else if (m.type !== "idle") handlers.message(m);
    };
    worker.onerror = () => handlers.message({ type: "error", message: "The game couldn't start in this browser." });
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
    keepKey(key);
    worker?.postMessage({ type: "key", key });
    offline = false;
    document.getElementById("gate").hidden = true;
    showBar();
  }
  const keyOptions = { onKey: key => void changeKey(key), onOffline: () => {} };

  function showBar() {
    if (!bar) return;
    bar.hidden = false;
    const kept = !!storedKey();
    bar.querySelector("[data-state]").textContent = offline && !kept ? "Offline: the GM can't speak." : "Your OpenRouter key is kept in this browser.";
    bar.querySelector("[data-change]").textContent = offline && !kept ? "Enter a key" : "Change key";
    bar.querySelector("[data-forget]").hidden = !kept;
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
