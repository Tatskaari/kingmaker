// Copied from the prototype's src/web/page/client.js at 44c6d4a, as v2's page (browser-design §2, §5): the workers' transport (transport.js) is the only one, so the socket transport and the server's branches go, and it's imported with the rest; the doors' pictures (doors.js) aren't drawn yet (a follow-up); the key form's other choice is Play with the fake GM (?fake skips the form on it, and the choice puts ?fake in the address, so a reload keeps it; ?fake=arc plays the whole story's recipe); a tab told the game is open in another (busy) plays once its server worker has the game (ready); Play again (and Try again) starts the client worker again, the server worker playing on, and Play here instead (the game moved to another tab) loads the page again; km.heard says what the workers said; the server's stats, the report's download and the wait for a closed game's notes go (V16; v2's jobs are the server worker's, and it plays on).
import { Terminal } from "./vendor/xterm.mjs";
import { FitAddon } from "./vendor/addon-fit.mjs";
import { WebglAddon } from "./vendor/addon-webgl.mjs";
import { Unicode11Addon } from "./vendor/addon-unicode11.mjs";
import { workerTransport } from "./transport.js";

// The page's half of Kingmaker in the browser (browser-design §2): xterm.js draws the game, which runs
// in two Web Workers on this page, joined by a MessageChannel: the client (v2's screens, on the JS
// OpenTUI) and the server (the simulation, the AI service and the saves, kept in IndexedDB).
// transport.js starts them and speaks for them, in the messages the prototype's server spoke (hello,
// started, exit, error), with the server worker's ready and busy.

// The build's stamp (hosts/web/build.ts): its files that aren't named by their hash are asked for with it.
const VERSION = document.documentElement.dataset.build ? `?v=${encodeURIComponent(document.documentElement.dataset.build)}` : "";

// The page loads the game's files (both workers, their chunks, the content) all at once, now, into the
// browser's cache: otherwise each is asked for only once the one before it has loaded and run.
for (const path of (document.querySelector('meta[name="km-preload"]')?.content ?? "").split(/\s+/).filter(Boolean)) {
  fetch(path, { priority: "low" }).then(response => response.arrayBuffer()).catch(() => {});
}
// "Loading Kingmaker…" is on the page until the game draws (or the page asks for a key); if that takes long, it says what to do.
const slow = setTimeout(() => { document.getElementById("loading").textContent = "Still loading Kingmaker… If nothing comes up, reload the page."; }, 20000);
function loaded() {
  clearTimeout(slow);
  document.getElementById("loading").hidden = true;
}

// The game's palette (client/theme.ts). The game paints in truecolor, so these show around its
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
// what other systems have. Glyph fonts from web/fonts go in front of it (see loadFonts).
const FONTS = ["Adwaita Mono", "JetBrains Mono", "Cascadia Mono", "SF Mono", "Menlo", "Consolas", "DejaVu Sans Mono", "Liberation Mono", "Noto Sans Mono"];

const params = new URLSearchParams(location.search);
// ?size=130x42 pins the terminal's size (the browser check plays at the terminal smoke run's).
const pinned = /^(\d+)x(\d+)$/.exec(params.get("size") ?? "");
const fontSize = Number(params.get("font")) || 15;
// ?fake plays with the fake GM without asking for a key; ?fake=arc with the whole story's recipe (each scene ends in two lines).
const fake = params.has("fake") ? (params.get("fake") === "arc" ? "arc" : "dev") : undefined;

const $ = id => document.getElementById(id);
const stats = { bytesIn: 0, messagesIn: 0, bytesOut: 0 };
const encoder = new TextEncoder();
let transport;
let playing = false;
// Another tab has the game, until this tab's server worker gets it (it says ready).
let busy = false;
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
// Closing the tab ends the game (it's saved as it goes); ask first, since Ctrl+W is a word-delete in terminals.
window.addEventListener("beforeunload", event => {
  if (playing) event.preventDefault();
});
// The game is on this page: going away is Ctrl+C's way out for the client, and the server saves.
window.addEventListener("pagehide", () => transport?.leaving());
document.addEventListener("visibilitychange", () => { if (document.hidden) transport?.flush(); });
// The notice's button: what it does is the notice's (play again, reload, take the game over from another tab).
let noticeAction = playAgain;
$("notice-button").addEventListener("click", () => noticeAction());

/** A new client worker, the server worker (and its game) as it was: the title again. */
function playAgain() {
  $("notice").hidden = true;
  term.reset();
  term.write("\x1b[?25l");
  start({});
}

// For the browser check (hosts/web/check.ts) and anyone curious in the console.
window.km = {
  term,
  stats,
  get renderer() {
    return renderer;
  },
  atlas,
  get playing() {
    return playing;
  },
  /** What the workers have said ({from: "client" | "server", type, message?}), the terminal's bytes aside. */
  get heard() {
    return transport?.heard ?? [];
  },
  text() {
    const buffer = term.buffer.active;
    const lines = [];
    // Up to the terminal's width: after it narrows, xterm keeps the cells past the edge (for reflow).
    for (let y = 0; y < term.rows; y++) lines.push(buffer.getLine(buffer.viewportY + y)?.translateToString(true, 0, term.cols) ?? "");
    return lines.join("\n");
  },
  /** Write the game's saves to IndexedDB now; resolves when they're in. */
  flush() {
    return transport?.flush() ?? Promise.resolve();
  },
};

connect();

/** The workers' transport, and what the page does with what they say. */
function connect() {
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
          // The client worker has drawn its first screen.
          playing = true;
          loaded();
          keyForm(false);
          if (!busy) $("notice").hidden = true;
          term.focus();
          return;
        case "ready":
          // The server worker has the game: a tab that was waiting for another to let it go plays now.
          if (!busy) return;
          busy = false;
          $("notice").hidden = true;
          term.focus();
          return;
        case "busy":
          // The game is open in another tab of this browser, and only one can play it at a time.
          busy = true;
          showNotice("Kingmaker is open in another tab of this browser. Only one tab can play it at a time, or each would overwrite the other's saves.", "Play here instead", () => {
            message.takeOver();
            $("notice-text").textContent = "Waiting for the other tab to save the game and let it go…";
            $("notice-button").disabled = true;
          });
          return;
        case "exit":
          playing = false;
          // The game hands back an empty screen with the cursor showing; there's nothing to type into.
          term.write("\x1b[?25l");
          if (message.moved) showNotice("The game is being played in another tab now (it saved here first).", "Play here instead", () => location.reload());
          else showNotice("The game has closed (it saves as it goes).", "Play again");
          return;
        case "error":
          playing = false;
          if (message.reload) showNotice(message.message, "Reload the page", () => location.reload());
          else showNotice(message.message, "Try again");
          return;
      }
    },
  };
  // ?glyphs=ascii draws letters, as the smoke test plays.
  transport = workerTransport(handlers, {
    fake, glyphs: params.get("glyphs") ?? undefined, askForKey,
    closeKeyForm: () => { keyForm(false); term.focus(); },
  });
}

function start(extra) {
  control({ type: "start", cols: term.cols, rows: term.rows, window: windowSize(), ...extra });
}

/** The browser's window, for the game to know: its size in CSS pixels and its pixel ratio ("1280x800@2"). */
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
  $("fake").textContent = options.cancel ? "Cancel" : "Play with the fake GM";
  $("fake-note").hidden = !!options.cancel;
  // (Esc anywhere on the page: the game behind the form can't have it.)
  cancelKeyForm = options.cancel ? () => $("fake").click() : undefined;
  input.focus();
  $("key-form").onsubmit = event => {
    event.preventDefault();
    const key = input.value.trim();
    // The key goes straight to the transport and isn't kept on the page (it's kept in localStorage, as V1 did).
    input.value = "";
    if (!key) {
      problem.hidden = false;
      problem.textContent = options.cancel ? "Paste a key, or Cancel." : "Paste a key, or play with the fake GM.";
      input.focus();
      return;
    }
    // The key is checked with OpenRouter first: "started" closes the form, a refusal reopens it.
    problem.hidden = true;
    checking(true);
    if (options.onKey) options.onKey(key);
    else start({ key });
  };
  $("fake").onclick = () => {
    input.value = "";
    keyForm(false);
    if (options.onCancel) options.onCancel();
    else playWithTheFake();
    term.focus();
  };
}

/** The fake GM, chosen on the form: the page's address says so too (?fake), so a reload carries the game on with it rather than asking for a key again. */
function playWithTheFake() {
  const url = new URL(location.href);
  if (!url.searchParams.has("fake")) url.search += url.search ? "&fake" : "?fake";
  history.replaceState(history.state, "", url);
  start({ fake: "dev" });
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
  if (!playing || busy || !$("gate").hidden || !transport?.sendBytes(bytes)) return;
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

// Glyph fonts (web/fonts, served with fonts.css) are loaded before the terminal measures its
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
