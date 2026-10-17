// Copied from the prototype's src/web/page/worker-transport.js at 44c6d4a, as v2's page's transport (browser-design §2, §5): two workers in place of one, the client's (client-worker.js: v2's screens on the JS OpenTUI) and the server's (server-worker.js: the simulation, the AI service and the saves), joined by a MessageChannel the page makes, port A to the client and port B to the server; what the page says goes to the worker it's for (understand-web.md §5.4: keys, resizes and quitting to the client; the key, flushes and taking over to the server), and what they say comes back in the server's messages as before, with ready (the server worker has the game); Play again starts a new client worker on a new channel, whose server end goes to the server worker ({type: "port"}); the fake GM ({fake: "dev" | "arc"}) in place of offline, and on it the bar offers a key, the page starting again with it; the key goes to the server worker only; a tab taking the game over has this tab's workers save it and go, and ends them; what goes into the game has a key taken out of it, and what comes out has the key masked (src/web/static/worker.ts:59-94's scrub and write, here, where the key is); km.heard is what the workers said; the report's download, the stats and a closed game's grace for its jobs go (V16; the server worker's jobs go on as the client comes and goes).

// The page's transport (page.js): the game runs in two Web Workers on this page, and this speaks to
// the page in the prototype's server's messages (hello, started, exit, error) so the rest of the page
// is as it was, with ready and busy from the server worker. It also says what only the page has to
// say, on the bar under the terminal: whether this browser is keeping the game, and the key. And it
// keeps to one tab at a time (the server worker holds a Web Lock named after the deployment): a tab
// whose server worker finds the game open in another offers to take it over, and the other tab, told
// so on a BroadcastChannel, has its workers save the game and let it go.
//
// The OpenRouter key is kept as V1 kept it: in localStorage under "kingmaker.openrouter-api-key"
// (the previews share an origin, so a key entered in one works in the others), asked for when
// there's none, checked with OpenRouter before it's kept, sent to the server worker by postMessage
// (never to the client worker), and changed or forgotten from the bar under the terminal. It's never
// put in a URL or a log line.

const KEY_STORAGE = "kingmaker.openrouter-api-key";
const KEY_SHAPE = /^[\x21-\x7e]{8,256}$/;
const KEY_CHECK = "https://openrouter.ai/api/v1/key";
// How long a tab's workers have to save the game and let it go, once another tab takes it over, before they're ended.
const LET_GO_MS = 3000;
// How long the page waits for the game to be saved before it loads again (Forget it, a key for the fake GM's game).
const SAVE_MS = 1500;
// The build's stamp (hosts/web/build.ts): every file that isn't named by its hash is asked for with it, so a new build's are never mixed with an old one's from the cache.
const BUILD = document.documentElement.dataset.build;
const VERSION = BUILD ? `?v=${encodeURIComponent(BUILD)}` : "";
// A worker's own script wouldn't load or run (a missing file after the preview was updated, or a browser that can't run it).
const UNSTARTED = "The game couldn't start in this browser: its files didn't load, or this browser can't run it. Reloading the page may help.";
const REFUSED = "OpenRouter didn't accept that key. You can check it, or make another, at openrouter.ai/keys.";
// What an OpenRouter key looks like, wherever it turns up.
const KEYISH = /sk-or-v1-[0-9a-f]{32,}/gi;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

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

/** What's wrong with a key, if it can be told from the key itself. */
function keyProblem(key) {
  if (!KEY_SHAPE.test(key)) return "That doesn't look like an OpenRouter key.";
  if (key.startsWith("sk-or-")) return undefined;
  const needed = "The GM runs through OpenRouter, so it needs an OpenRouter key (they start with sk-or-).";
  if (key.startsWith("sk-ant-")) return `That looks like an Anthropic key. ${needed}`;
  if (key.startsWith("sk-")) return `That looks like an OpenAI key. ${needed}`;
  return "That doesn't look like an OpenRouter key: they start with sk-or-.";
}

/**
 * Keys and the mouse, on their way into the game. A key pasted into the game (meant for the key form,
 * say) goes no further: typed into a scene it would go to the GM and into the saves.
 */
function scrub(bytes) {
  const text = decoder.decode(bytes);
  const key = storedKey();
  KEYISH.lastIndex = 0;
  if (!KEYISH.test(text) && !(key && text.includes(key))) return bytes;
  return encoder.encode((key ? text.split(key).join("") : text).replace(KEYISH, ""));
}

/** The terminal's bytes: a key on screen (an error quoting it) would be masked cell for cell. */
function masked(data) {
  const key = storedKey();
  return typeof data === "string" && key && data.includes(key) ? data.split(key).join("*".repeat(key.length)) : data;
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
  let client;
  let server;
  // The fake GM ("dev", or "arc": the whole story's recipe) in place of a key: from ?fake, or the form's choice.
  let fake = options.fake;
  // Whether the key in use is kept in this browser (or only on this page).
  let kept = keptHere();
  // How the saves are kept, as the server worker last said (nothing to say when they're kept).
  let storage = { ok: true };
  const flushes = [];
  // What the workers have said, for the browser check: who, the message's type, and an error's words (the terminal's bytes aside).
  const heard = [];
  // The game's channel to the other tabs (from "ready"), and whether one of them has asked for the game.
  let channel;
  let movedAway = false;
  const bar = document.getElementById("key-bar");

  const self = {
    heard,
    send(message) {
      switch (message.type) {
        case "start": void start(message); return;
        case "resize": client?.postMessage({ type: "resize", cols: message.cols, rows: message.rows, window: message.window }); return;
      }
    },
    sendBytes(bytes) {
      if (!client) return false;
      const data = scrub(bytes);
      client.postMessage({ type: "input", data }, [data.buffer]);
      return true;
    },
    flush() {
      if (!server) return Promise.resolve();
      return new Promise(resolve => { flushes.push(resolve); server.postMessage({ type: "flush" }); });
    },
    leaving() {
      client?.postMessage({ type: "quit" });
      server?.postMessage({ type: "flush" });
    },
  };

  /** The game started: both workers, or (Play again, Try again) a new client worker, the server worker and its game playing on. */
  async function start(message) {
    if (server) {
      const port = startClient(message);
      server.postMessage({ type: "port", port }, [port]);
      return;
    }
    if (message.fake) fake = message.fake;
    let key = fake ? "" : message.key ?? storedKey();
    if (message.key && !fake) {
      const problem = keyProblem(key);
      if (problem) return handlers.message({ type: "hello", needKey: true, error: problem });
      if (await keyRefused(key)) return handlers.message({ type: "hello", needKey: true, error: REFUSED });
      kept = keepKey(key);
    }
    movedAway = false;
    const port = startClient(message);
    startServer(port, key);
    key = "";
  }

  /** A client worker (v2's screens, drawing into the page's terminal) on port A of a new channel; port B, the server's end, is returned. */
  function startClient(message) {
    // One that said something went wrong may still be there: it goes first.
    client?.terminate();
    const { port1, port2 } = new MessageChannel();
    const worker = new Worker(new URL(`./client-worker.js${VERSION}`, import.meta.url), { type: "module" });
    client = worker;
    worker.onmessage = event => fromClient(worker, event.data);
    worker.onerror = () => handlers.message({ type: "error", reload: true, message: UNSTARTED });
    worker.postMessage({
      type: "start", port: port1, cols: message.cols, rows: message.rows, ...(message.window ? { window: message.window } : {}),
      ...(options.glyphs ? { glyphs: options.glyphs } : {}),
    }, [port1]);
    return port2;
  }

  /** The server worker (the simulation, the AI service and the saves) on port B: the key goes here, and nowhere else. */
  function startServer(port, key) {
    server = new Worker(new URL(`./server-worker.js${VERSION}`, import.meta.url), { type: "module" });
    server.onmessage = event => fromServer(event.data);
    server.onerror = () => handlers.message({ type: "error", reload: true, message: UNSTARTED });
    server.postMessage({ type: "start", port, ...(key ? { key } : {}), ...(fake ? { fake } : {}) }, [port]);
  }

  /** What the client worker says: the terminal's bytes, its first screen, its end, what went wrong. */
  function fromClient(worker, m) {
    // An old client's last words (after Play again, or once it was ended).
    if (worker !== client) return;
    if (m.type === "output") return handlers.bytes(masked(m.data));
    hear("client", m);
    if (m.type === "exit") {
      client = undefined;
      worker.terminate();
      // The game is saved as it goes; and now, at once.
      server?.postMessage({ type: "flush" });
      return handlers.message(movedAway ? { type: "exit", moved: true } : { type: "exit" });
    }
    if (m.type === "started" || m.type === "error") handlers.message(m);
  }

  /** What the server worker says: it has the game, another tab has it, how it's kept, the key turned down, a flush done, what went wrong. */
  function fromServer(m) {
    hear("server", m);
    switch (m.type) {
      case "ready": return ready(m.channel);
      case "busy": return handlers.message({ type: "busy", takeOver: () => takeOver(m.channel ?? "") });
      case "storage":
        storage = m;
        return showBar();
      case "key-refused":
        // A kept key that's since been revoked, say: the page asks for another (once, while the form's closed).
        if (document.getElementById("gate").hidden) options.askForKey("OpenRouter turned down the key this game was using (it may have been revoked or used up). Enter another.", keyOptions);
        return;
      case "flushed": return flushes.shift()?.();
      // The server worker is the game's host: once it has failed, only a new page starts it again.
      case "error": return handlers.message({ type: "error", reload: true, message: m.message });
    }
  }

  /** The server worker has the game (after the lock, the load and the install): the bar shows, and another tab asking for the game is heard. */
  function ready(name) {
    showBar();
    handlers.message({ type: "ready" });
    channel?.close();
    channel = name && typeof BroadcastChannel === "function" ? new BroadcastChannel(name) : undefined;
    if (channel) channel.onmessage = event => { if (event.data?.type === "take-over") letGo(); };
  }

  /** Another tab takes the game over: this tab's workers save it and go, and each is ended once it has (or after LET_GO_MS). */
  function letGo() {
    if (movedAway || !server) return;
    movedAway = true;
    channel?.close();
    channel = undefined;
    const going = server;
    server = undefined;
    // The server worker saves the game and lets go of the lock (it says flushed once it's saved).
    const end = () => going.terminate();
    going.onmessage = event => { if (event.data?.type === "flushed") end(); };
    setTimeout(end, LET_GO_MS);
    going.postMessage({ type: "quit" });
    // The client worker closes the game (it says exit); a closed one has nothing to say.
    const quitting = client;
    if (!quitting) return handlers.message({ type: "exit", moved: true });
    quitting.postMessage({ type: "quit" });
    setTimeout(() => fromClient(quitting, { type: "exit" }), LET_GO_MS);
  }

  /** This page wants the game another tab has: that tab is asked to save it and let go (this page's server worker is waiting for it). */
  function takeOver(name) {
    if (typeof BroadcastChannel !== "function") return;
    const ask = new BroadcastChannel(name);
    ask.postMessage({ type: "take-over" });
    ask.close();
  }

  // A key for the game already running: checked, kept, and sent to the server worker. On the fake GM, the page starts again with it.
  async function changeKey(key) {
    const problem = keyProblem(key);
    if (problem) return options.askForKey(problem, keyOptions);
    if (await keyRefused(key)) return options.askForKey(REFUSED, keyOptions);
    kept = keepKey(key);
    if (fake) return withTheKey();
    server?.postMessage({ type: "key", key });
    options.closeKeyForm();
    showBar();
  }
  // Over a game that's playing, the form can be left as it was: with the key it had, or on the fake GM.
  const keyOptions = { onKey: key => void changeKey(key), onCancel: () => {}, cancel: true };

  /** The fake GM's game, played on with the key: the game is saved, and the page loads again without ?fake (with the key kept, it starts with it). */
  function withTheKey() {
    const url = new URL(location.href);
    url.searchParams.delete("fake");
    saveThen(() => location.assign(url));
  }

  /** The game saved (or SAVE_MS gone by), then `then`. */
  function saveThen(then) {
    void Promise.race([self.flush(), new Promise(resolve => setTimeout(resolve, SAVE_MS))]).then(then);
  }

  function showBar() {
    if (!bar) return;
    bar.hidden = false;
    const using = !!storedKey();
    bar.querySelector("[data-state]").textContent = fake ? "Playing with the fake GM: canned replies, no key, no cost."
      : kept ? "Your OpenRouter key is kept in this browser."
      : "Your OpenRouter key is used on this page only: this browser won't keep it.";
    bar.querySelector("[data-change]").textContent = !fake ? "Change key" : using ? "Use my key" : "Use a key";
    bar.querySelector("[data-forget]").hidden = !using;
    // Whether the game is being kept: said until it is.
    const said = bar.querySelector("[data-storage]");
    said.hidden = storage.ok;
    said.textContent = storage.ok ? "" : storage.message ?? "This browser isn't keeping the game.";
    said.title = said.textContent;
  }

  function hear(from, m) {
    heard.push({ from, type: String(m?.type), ...(m?.type === "error" ? { message: String(m.message ?? "") } : {}) });
  }

  if (bar) {
    bar.querySelector("[data-change]").onclick = () => (fake && storedKey() ? withTheKey() : options.askForKey(undefined, keyOptions));
    bar.querySelector("[data-forget]").onclick = () => {
      forgetKey();
      // The game is saved, and the page starts again: without a key (or ?fake), it asks for one.
      saveThen(() => location.reload());
    };
  }

  // As the server said hello: whether the page must ask for a key first.
  queueMicrotask(() => handlers.message({ type: "hello", needKey: !fake && !storedKey() }));
  return self;
}
