import { Terminal } from "./vendor/xterm.mjs?v=dc00333e6945";
import { FitAddon } from "./vendor/addon-fit.mjs?v=dc00333e6945";
import { WebglAddon } from "./vendor/addon-webgl.mjs?v=dc00333e6945";
import { Unicode11Addon } from "./vendor/addon-unicode11.mjs?v=dc00333e6945";
import { doorOverlay } from "./doors.js?v=dc00333e6945";

// The page's half of Kingmaker in the browser (src/web/README.md): xterm.js draws the game, and
// keystrokes and output go over a transport. Served by src/web/server.ts, the game runs in a pty
// on the server and the transport is one WebSocket (binary messages are the terminal's bytes,
// text messages JSON for everything else). In the static build (<html data-mode="static">), the
// game runs in a Web Worker on this page and worker-transport.js speaks the same messages.

const STATIC = document.documentElement.dataset.mode === "static";
// The static build's stamp (build.ts): its files that aren't named by their hash are asked for with it.
const VERSION = STATIC && document.documentElement.dataset.build ? `?v=${encodeURIComponent(document.documentElement.dataset.build)}` : "";

// The static build loads the game's files (the worker, its chunks, the content) all at once, now, into
// the browser's cache: otherwise each is asked for only once the one before it has loaded and run.
if (STATIC) {
  for (const path of (document.querySelector('meta[name="km-preload"]')?.content ?? "").split(/\s+/).filter(Boolean)) {
    fetch(path, { priority: "low" }).then(response => response.arrayBuffer()).catch(() => {});
  }
}
// "Loading Kingmaker…" is on the page until the game draws (or the page asks for a key); if that takes long, it says what to do.
const slow = setTimeout(() => { document.getElementById("loading").textContent = "Still loading Kingmaker… If nothing comes up, reload the page."; }, 20000);
function loaded() {
  clearTimeout(slow);
  document.getElementById("loading").hidden = true;
}

// The game's palette (src/app/theme.ts). The game paints in truecolor, so these show around its
// edges and wherever something asks for a plain ANSI colour.
const THEME = {
  background: "#15131a",
  foreground: "#ddd5c4",
  cursor: "#c9a24a",
  cursorAccent: "#15131a",
  selectionBackground: "#3b3550",
  black: "#15131a",
  red: "#ff6b6b",
  green: "#7bd389",
  yellow: "#e8c170",
  blue: "#8fc7ff",
  magenta: "#a89bc4",
  cyan: "#9ad1d4",
  white: "#ddd5c4",
  brightBlack: "#5c564d",
  brightRed: "#ff7b6b",
  brightGreen: "#a3e4ad",
  brightYellow: "#ffd75e",
  brightBlue: "#b5dbff",
  brightMagenta: "#c6a0e0",
  brightCyan: "#bfe6e8",
  brightWhite: "#f3eee2",
};

// Adwaita Mono first (GNOME's terminal font, which has nearly every symbol the map uses), then
// what other systems have. Glyph fonts from assets/fonts go in front of it (see loadFonts).
const FONTS = ["Adwaita Mono", "JetBrains Mono", "Cascadia Mono", "SF Mono", "Menlo", "Consolas", "DejaVu Sans Mono", "Liberation Mono", "Noto Sans Mono"];

const params = new URLSearchParams(location.search);
// ?size=130x42 pins the terminal's size (the browser check compares screens with the terminal smoke run).
const pinned = /^(\d+)x(\d+)$/.exec(params.get("size") ?? "");
const fontSize = Number(params.get("font")) || 15;

const $ = id => document.getElementById(id);
const stats = { bytesIn: 0, messagesIn: 0, bytesOut: 0 };
const statsWaiters = [];
const encoder = new TextEncoder();
let transport;
let playing = false;
let renderer = "dom";

const glyphFonts = await loadFonts();
const term = new Terminal({
  fontFamily: [...glyphFonts, ...FONTS].map(name => `"${name}"`).join(", ") + ", monospace",
  fontSize,
  lineHeight: 1,
  theme: THEME,
  // The game draws on the alternate screen, so there's nothing to scroll back to, and the fit then
  // leaves no room for a scrollbar.
  scrollback: 0,
  cursorBlink: false,
  // xterm draws box and block characters itself (WebGL only), so the map's ▚▞▀▄█ join up.
  customGlyphs: true,
  rescaleOverlappingGlyphs: true,
  drawBoldTextInBrightColors: false,
  allowProposedApi: true,
  macOptionIsMeta: true,
  // Right-click is the game's (its action menus), not a word selection.
  rightClickSelectsWord: false,
  windowOptions: { getWinSizePixels: true, getCellSizePixels: true, getWinSizeChars: true },
});

// Ctrl+C (or Cmd+C) over selected text copies it, as a browser's Ctrl+C does; with nothing selected it's
// the game's, as in a terminal (save and quit). Shift+drag selects, as the game has the mouse.
term.attachCustomKeyEventHandler(event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || !(event.code === "KeyC" || event.key.toLowerCase() === "c") || !term.hasSelection()) return true;
  if (event.type === "keydown") {
    navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
    // After the browser's own copy (xterm answers it from the selection too, where there's no clipboard API).
    setTimeout(() => term.clearSelection());
  }
  return false;
});

// Unicode 11 widths: 🎲 and friends take two cells, as the game lays them out.
term.loadAddon(new Unicode11Addon());
term.unicode.activeVersion = "11";
const fit = new FitAddon();
term.loadAddon(fit);
term.open($("terminal"));
// The browser's own menu would take the right-click: the game's menus need it.
$("terminal").addEventListener("contextmenu", event => event.preventDefault());
// xterm's WebGL renderer keeps every glyph it has drawn, in each pair of colours it was drawn in, on
// texture pages, and merges full pages four at a time into bigger ones (512 px, 1024, 2048, ... up to
// the GPU's limit). The map draws in new colours all the time (fire, lamplight, water), so in a long
// game the pages grow until they break: Chromium throws on every frame, and Firefox draws everything
// on a page it couldn't upload as bits of other glyphs. A merge up to ATLAS_LIMIT starts a fresh
// atlas instead: a new WebGL addon, as the old one's atlas goes with it (a frame or two of work).
const ATLAS_LIMIT = 2048;
// (For the browser check: pages made, pages merged away, fresh atlases, the widest merged page.)
const atlas = { pages: 0, merged: 0, resets: 0, widest: 0 };
let webgl;
let fresh = false;
function useWebgl() {
  try {
    const addon = new WebglAddon();
    addon.onContextLoss(() => {
      addon.dispose();
      if (webgl === addon) webgl = undefined;
      renderer = "dom";
    });
    // A merge removes the pages it took, then adds the page it made; a page added on its own is a
    // new one (or, for a glyph too big for any page, one the size of the GPU's limit: not a merge).
    let merging = 0;
    addon.onRemoveTextureAtlasCanvas(() => {
      merging++;
      atlas.merged++;
    });
    addon.onAddTextureAtlasCanvas(canvas => {
      atlas.pages++;
      if (merging) atlas.widest = Math.max(atlas.widest, canvas.width);
      if (merging && canvas.width >= ATLAS_LIMIT) freshAtlas();
      merging = 0;
    });
    term.loadAddon(addon);
    webgl = addon;
    renderer = "webgl";
  } catch (error) {
    console.warn("No WebGL here: the terminal draws with the DOM, and box and block characters come from the font.", error);
  }
}
function freshAtlas() {
  if (fresh) return;
  fresh = true;
  // Not inside the draw the merge came from.
  setTimeout(() => {
    fresh = false;
    if (!webgl) return;
    webgl.dispose();
    webgl = undefined;
    atlas.resets++;
    useWebgl();
  });
}
useWebgl();
// The doors, drawn as pictures over the ASCII where the game says they are (src/web/page/doors.ts); ?doors=off leaves the ASCII alone.
const doors = params.get("doors") === "off" ? undefined : doorOverlay(term);
// No cursor until the game asks for one (it hides it anyway; this covers the moments before it starts).
term.write("\x1b[?25l");
resize();
term.focus();

let resizing = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(resizing);
  resizing = requestAnimationFrame(resize);
}).observe($("terminal"));
term.onResize(({ cols, rows }) => control({ type: "resize", cols, rows, window: windowSize() }));
term.onData(data => sendBytes(encoder.encode(data)));
term.onBinary(data => sendBytes(Uint8Array.from(data, ch => ch.charCodeAt(0) & 255)));
term.onTitleChange(title => {
  document.title = title ? `${title} · Kingmaker` : "Kingmaker";
});

window.addEventListener("focus", () => {
  if ($("gate").hidden) term.focus();
});

let cancelKeyForm;
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !$("gate").hidden && cancelKeyForm) cancelKeyForm();
});

/**
 * The key form, up or down. While it's up the game behind it takes nothing (a key pasted beside the
 * form would go into the game). A notice it comes up over (the game has closed, say) is back when it goes.
 */
let noticeUnder = false;
function keyForm(open) {
  if (open && !$("notice").hidden) {
    noticeUnder = true;
    $("notice").hidden = true;
  }
  $("gate").hidden = !open;
  $("frame").inert = open;
  if (!open && noticeUnder) {
    noticeUnder = false;
    $("notice").hidden = false;
  }
}
// Closing the tab saves and ends the game; ask first, since Ctrl+W is a word-delete in terminals.
window.addEventListener("beforeunload", event => {
  if (playing) event.preventDefault();
});
// In the static build the game is on this page: going away is Ctrl+C's way out (it saves).
window.addEventListener("pagehide", () => transport?.leaving?.());
document.addEventListener("visibilitychange", () => { if (document.hidden) transport?.flush?.(); });
// The notice's button: what it does is the notice's (play again, reload, take the game over from another tab).
let noticeAction = playAgain;
$("notice-button").addEventListener("click", () => noticeAction());

async function playAgain() {
  // The static build: a closed game's last notes are finished (and saved) before the next game reads the saves.
  if (transport?.finishing?.()) {
    $("notice-text").textContent = "Finishing the GM's notes on your last turn first (they're kept with the game)…";
    $("notice-button").disabled = true;
    await transport.settled();
    $("notice-button").disabled = false;
  }
  $("notice").hidden = true;
  term.reset();
  term.write("\x1b[?25l");
  connect();
}

// For the browser checks (src/web/check.ts, src/web/static/check.ts) and anyone curious in the console.
window.km = {
  term,
  stats,
  static: STATIC,
  get renderer() {
    return renderer;
  },
  atlas,
  /** The doors' overlay (undefined with ?doors=off): the last frame of doors the game sent, and how many are drawn. */
  doors,
  get playing() {
    return playing;
  },
  text() {
    const buffer = term.buffer.active;
    const lines = [];
    // Up to the terminal's width: after it narrows, xterm keeps the cells past the edge (for reflow).
    for (let y = 0; y < term.rows; y++) lines.push(buffer.getLine(buffer.viewportY + y)?.translateToString(true, 0, term.cols) ?? "");
    return lines.join("\n");
  },
  serverStats() {
    return new Promise(resolve => {
      statsWaiters.push(resolve);
      control({ type: "stats" });
    });
  },
  /** The static build: write the game's saves to IndexedDB now; resolves when they're in. */
  flush() {
    return transport?.flush?.() ?? Promise.resolve();
  },
  /** The static build: whether a closed game is still finishing the GM's notes on its last turn. */
  finishing() {
    return transport?.finishing?.() ?? false;
  },
};

await connect();

async function connect() {
  let settled = false;
  const handlers = {
    bytes(data) {
      stats.bytesIn += data.length;
      stats.messagesIn++;
      term.write(data);
    },
    message(message) {
      switch (message.type) {
        case "hello":
          if (message.needKey) askForKey(message.error);
          else start({});
          return;
        case "started":
          playing = true;
          loaded();
          keyForm(false);
          $("notice").hidden = true;
          transport?.started?.(message);
          term.focus();
          return;
        case "busy":
          // The static build: the game is open in another tab of this browser, and only one can play it at a time.
          showNotice("Kingmaker is open in another tab of this browser. Only one tab can play it at a time, or each would overwrite the other's saves.", "Play here instead", () => {
            message.takeOver();
            $("notice-text").textContent = "Waiting for the other tab to save the game and let it go…";
            $("notice-button").disabled = true;
          });
          return;
        case "exit":
          settled = true;
          playing = false;
          // The game hands back an empty screen with the cursor showing; there's nothing to type into.
          term.write("\x1b[?25l");
          if (message.moved) showNotice("The game is being played in another tab now (it saved here first).", "Play here instead");
          else showNotice("The game has closed (it saves as it goes).", "Play again");
          return;
        case "error":
          settled = true;
          playing = false;
          if (message.reload) showNotice(message.message, "Reload the page", () => location.reload());
          else showNotice(message.message, "Try again");
          return;
        case "stats":
          statsWaiters.shift()?.(message);
          return;
      }
    },
    closed(current) {
      if (transport !== current || settled) return;
      playing = false;
      showNotice("Lost the connection to the server.", "Reconnect");
    },
  };
  if (STATIC) {
    transport?.close?.();
    const { workerTransport } = await import(`./worker-transport.js${VERSION}`);
    // ?glyphs=ascii draws letters, as the smoke test plays; ?jobdelay=<ms> holds back the background jobs (for the check).
    transport = workerTransport(handlers, {
      offline: params.has("offline"), glyphs: params.get("glyphs") ?? undefined, jobDelayMs: Number(params.get("jobdelay")) || undefined, askForKey,
      closeKeyForm: () => { keyForm(false); term.focus(); },
    });
  } else {
    transport = socketTransport(handlers);
  }
}

/** The server's transport: one WebSocket to /play beside the page. */
function socketTransport(handlers) {
  const url = new URL("play", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  const self = {
    send(message) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
    sendBytes(bytes) {
      if (socket.readyState !== WebSocket.OPEN) return false;
      socket.send(bytes);
      return true;
    },
  };
  socket.onmessage = event => {
    if (typeof event.data !== "string") handlers.bytes(new Uint8Array(event.data));
    else handlers.message(JSON.parse(event.data));
  };
  socket.onclose = () => handlers.closed(self);
  return self;
}

function start(extra) {
  // ?doors=off: the game needn't say where the doors are, as they aren't drawn.
  control({ type: "start", cols: term.cols, rows: term.rows, window: windowSize(), ...(doors ? {} : { doors: false }), ...extra });
}

/** The browser's window, for a report of a problem (src/report): its size in CSS pixels and its pixel ratio ("1280x800@2"). */
function windowSize() {
  return `${Math.round(innerWidth)}x${Math.round(innerHeight)}@${Math.round(devicePixelRatio * 100) / 100}`;
}

function askForKey(error, options = {}) {
  const input = $("key");
  const problem = $("key-error");
  loaded();
  keyForm(true);
  checking(false);
  problem.hidden = !error;
  problem.textContent = error ?? "";
  // Over a game that's playing (the bar's Change key), the form can be left as it was: Cancel, or Esc.
  $("offline").textContent = options.cancel ? "Cancel" : "Look around offline";
  $("offline-note").hidden = !!options.cancel;
  // (Esc anywhere on the page: the game behind the form can't have it.)
  cancelKeyForm = options.cancel ? () => $("offline").click() : undefined;
  input.focus();
  $("key-form").onsubmit = event => {
    event.preventDefault();
    const key = input.value.trim();
    // The key goes straight to the game and isn't kept on the page (the static build keeps it in localStorage, as V1 did).
    input.value = "";
    if (!key) {
      problem.hidden = false;
      problem.textContent = options.cancel ? "Paste a key, or Cancel." : "Paste a key, or look around offline.";
      input.focus();
      return;
    }
    // The key is checked with OpenRouter first: "started" closes the form, a refusal reopens it.
    problem.hidden = true;
    checking(true);
    if (options.onKey) options.onKey(key);
    else start({ key });
  };
  $("offline").onclick = () => {
    input.value = "";
    keyForm(false);
    if (options.onOffline) options.onOffline();
    else start({ offline: true });
    term.focus();
  };
}

function checking(on) {
  for (const field of $("key-form").elements) field.disabled = on;
  $("key-checking").hidden = !on;
}

function showNotice(text, button, action = playAgain) {
  loaded();
  keyForm(false);
  $("notice-text").textContent = text;
  $("notice-button").textContent = button;
  $("notice-button").disabled = false;
  noticeAction = action;
  $("notice").hidden = false;
  $("notice-button").focus();
}

function control(message) {
  transport?.send(message);
}

function sendBytes(bytes) {
  if (!playing || !$("gate").hidden || !transport?.sendBytes(bytes)) return;
  stats.bytesOut += bytes.length;
}

function resize() {
  if (pinned) {
    term.resize(Number(pinned[1]), Number(pinned[2]));
    return;
  }
  try {
    fit.fit();
  } catch {
    // Not laid out yet; the observer calls again.
  }
}

// Glyph fonts (assets/fonts, served with fonts.css) are loaded before the terminal measures its
// cells, so their glyphs are there from the first frame.
async function loadFonts() {
  try {
    const fonts = await (await fetch(`fonts.json${VERSION}`)).json();
    await Promise.all(fonts.map(font => document.fonts.load(`${font.style} ${font.weight} ${fontSize}px "${font.family}"`, font.sample).catch(() => [])));
    return [...new Set(fonts.map(font => font.family))];
  } catch {
    return [];
  }
}
