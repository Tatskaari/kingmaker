import { Terminal } from "/vendor/xterm.mjs";
import { FitAddon } from "/vendor/addon-fit.mjs";
import { WebglAddon } from "/vendor/addon-webgl.mjs";
import { Unicode11Addon } from "/vendor/addon-unicode11.mjs";

// The page's half of Kingmaker in the browser (src/web/README.md): xterm.js draws the game that
// runs in a pty on the server, and keystrokes and output go over one WebSocket. Binary messages
// are the terminal's bytes either way; text messages are JSON for everything else.

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
let ws;
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
  windowOptions: { getWinSizePixels: true, getCellSizePixels: true, getWinSizeChars: true },
});

// Unicode 11 widths: 🎲 and friends take two cells, as the game lays them out.
term.loadAddon(new Unicode11Addon());
term.unicode.activeVersion = "11";
const fit = new FitAddon();
term.loadAddon(fit);
term.open($("terminal"));
try {
  const webgl = new WebglAddon();
  webgl.onContextLoss(() => {
    webgl.dispose();
    renderer = "dom";
  });
  term.loadAddon(webgl);
  renderer = "webgl";
} catch (error) {
  console.warn("No WebGL here: the terminal draws with the DOM, and box and block characters come from the font.", error);
}
// No cursor until the game asks for one (it hides it anyway; this covers the moments before it starts).
term.write("\x1b[?25l");
resize();
term.focus();

let resizing = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(resizing);
  resizing = requestAnimationFrame(resize);
}).observe($("terminal"));
term.onResize(({ cols, rows }) => control({ type: "resize", cols, rows }));
term.onData(data => sendBytes(encoder.encode(data)));
term.onBinary(data => sendBytes(Uint8Array.from(data, ch => ch.charCodeAt(0) & 255)));
term.onTitleChange(title => {
  document.title = title ? `${title} · Kingmaker` : "Kingmaker";
});

window.addEventListener("focus", () => {
  if ($("gate").hidden) term.focus();
});
// Closing the tab saves and ends the game; ask first, since Ctrl+W is a word-delete in terminals.
window.addEventListener("beforeunload", event => {
  if (playing) event.preventDefault();
});
$("notice-button").addEventListener("click", () => {
  $("notice").hidden = true;
  term.reset();
  term.write("\x1b[?25l");
  connect();
});

// For the browser check (src/web/check.ts) and anyone curious in the console.
window.km = {
  term,
  stats,
  get renderer() {
    return renderer;
  },
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
};

connect();

function connect() {
  const url = new URL("/play", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  ws = socket;
  let settled = false;
  socket.onmessage = event => {
    if (typeof event.data !== "string") {
      stats.bytesIn += event.data.byteLength;
      stats.messagesIn++;
      term.write(new Uint8Array(event.data));
      return;
    }
    const message = JSON.parse(event.data);
    switch (message.type) {
      case "hello":
        if (message.needKey) askForKey(message.error);
        else start({});
        return;
      case "started":
        playing = true;
        $("gate").hidden = true;
        $("notice").hidden = true;
        term.focus();
        return;
      case "exit":
        settled = true;
        playing = false;
        // The game hands back an empty screen with the cursor showing; there's nothing to type into.
        term.write("\x1b[?25l");
        showNotice("The game has closed (it saves as it goes).", "Play again");
        return;
      case "error":
        settled = true;
        playing = false;
        showNotice(message.message, "Try again");
        return;
      case "stats":
        statsWaiters.shift()?.(message);
        return;
    }
  };
  socket.onclose = () => {
    if (ws !== socket || settled) return;
    playing = false;
    showNotice("Lost the connection to the server.", "Reconnect");
  };
}

function start(extra) {
  control({ type: "start", cols: term.cols, rows: term.rows, ...extra });
}

function askForKey(error) {
  const input = $("key");
  const problem = $("key-error");
  $("gate").hidden = false;
  checking(false);
  problem.hidden = !error;
  problem.textContent = error ?? "";
  input.focus();
  $("key-form").onsubmit = event => {
    event.preventDefault();
    const key = input.value.trim();
    // The key goes straight to the server and isn't kept on the page.
    input.value = "";
    if (!key) {
      problem.hidden = false;
      problem.textContent = "Paste a key, or look around offline.";
      input.focus();
      return;
    }
    // The server asks OpenRouter about it first: "started" closes the form, a refusal reopens it.
    problem.hidden = true;
    checking(true);
    start({ key });
  };
  $("offline").onclick = () => {
    input.value = "";
    $("gate").hidden = true;
    start({ offline: true });
    term.focus();
  };
}

function checking(on) {
  for (const field of $("key-form").elements) field.disabled = on;
  $("key-checking").hidden = !on;
}

function showNotice(text, button) {
  $("gate").hidden = true;
  $("notice-text").textContent = text;
  $("notice-button").textContent = button;
  $("notice").hidden = false;
  $("notice-button").focus();
}

function control(message) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function sendBytes(bytes) {
  if (!playing || ws?.readyState !== WebSocket.OPEN) return;
  ws.send(bytes);
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

// Glyph fonts (assets/fonts, served with /fonts.css) are loaded before the terminal measures its
// cells, so their glyphs are there from the first frame.
async function loadFonts() {
  try {
    const fonts = await (await fetch("/fonts.json")).json();
    await Promise.all(fonts.map(font => document.fonts.load(`${font.style} ${font.weight} ${fontSize}px "${font.family}"`, font.sample).catch(() => [])));
    return [...new Set(fonts.map(font => font.family))];
  } catch {
    return [];
  }
}
