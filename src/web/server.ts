import { readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { homedir, hostname, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { fontFaceCss, fontList, isFontFile, webFonts } from "./fonts.ts";
import { GameTerminal } from "./terminal.ts";

/**
 * Kingmaker in the browser: a small server that runs the game in a pty per connection and shows it
 * in xterm.js, with keystrokes and output over a WebSocket.
 *
 *   npm run web                         (node --no-warnings src/web/server.ts)
 *   npm run web -- --offline            (no GM: look around without a key)
 *   npm run web -- --host 0.0.0.0       (other machines too; see the warning it prints)
 *
 * The GM's key: OPENROUTER_API_KEY or ~/secrets/kingmaker-dev-openrouter.txt on the server, or else
 * the page asks for one and it goes into that game's environment only (src/web/README.md).
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PAGE = fileURLToPath(new URL("./page/", import.meta.url));
const FONTS = join(ROOT, "assets", "fonts");
const require = createRequire(import.meta.url);
const XTERM = dirname(dirname(require.resolve("@xterm/xterm")));
const addon = (name: string) => dirname(dirname(require.resolve(`@xterm/addon-${name}`)));
const KEY_FILE = join(homedir(), "secrets", "kingmaker-dev-openrouter.txt");

const { values: flags } = parseArgs({
  options: {
    host: { type: "string" },
    port: { type: "string" },
    origin: { type: "string", multiple: true },
    "max-games": { type: "string" },
    offline: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

if (flags.help) {
  console.log(`npm run web -- [--host 127.0.0.1] [--port 7311] [--max-games 4] [--offline] [--origin https://play.example]

  --host        address to listen on (KM_WEB_HOST); anything but loopback prints a warning
  --port        port (KM_WEB_PORT); 0 picks a free one
  --max-games   games running at once (KM_WEB_MAX_GAMES)
  --offline     every game runs without the GM (KM_WEB_OFFLINE=1)
  --origin      another origin allowed to open games, e.g. a TLS proxy in front (KM_WEB_ORIGINS, comma-separated)`);
  process.exit(0);
}

const HOST = flags.host ?? process.env.KM_WEB_HOST ?? "127.0.0.1";
const PORT = Number(flags.port ?? process.env.KM_WEB_PORT ?? 7311);
const MAX_GAMES = Math.max(1, Number(flags["max-games"] ?? process.env.KM_WEB_MAX_GAMES ?? 4) || 4);
const OFFLINE = flags.offline === true || process.env.KM_WEB_OFFLINE === "1";
const EXTRA_ORIGINS = [...(flags.origin ?? []), ...(process.env.KM_WEB_ORIGINS ?? "").split(",")]
  .map(origin => origin.trim())
  .filter(Boolean)
  .map(origin => new URL(origin).origin);

// What a pasted OpenRouter key can look like: printable ASCII, no spaces (it goes into an environment).
const KEY_SHAPE = /^[\x21-\x7e]{8,256}$/;
// OpenRouter answers this for any key it knows, free of charge.
const KEY_CHECK = "https://openrouter.ai/api/v1/key";

// A game's background jobs (the GM's notes on its last turn) may run this long after the game ends;
// whatever is left then is stopped.
const BACKGROUND_LIMIT_MS = 3 * 60_000;

// The terminal the game sees is the page's xterm.js, not whatever terminal started this server.
const TERMINAL_ENV = /^(TERM_|TERMINFO|COLORFGBG$|VTE_|TMUX|STY$|ZELLIJ|WT_|KITTY_|WEZTERM_|GHOSTTY_|ITERM_|LC_TERMINAL|KONSOLE_|ALACRITTY_|TERMUX_|VHS_|VSCODE_|KM_WEB_)/;

const files: Record<string, [string, string]> = {
  "/": [join(PAGE, "index.html"), "text/html; charset=utf-8"],
  "/client.js": [join(PAGE, "client.js"), "text/javascript; charset=utf-8"],
  "/style.css": [join(PAGE, "style.css"), "text/css; charset=utf-8"],
  "/vendor/xterm.mjs": [join(XTERM, "lib", "xterm.mjs"), "text/javascript; charset=utf-8"],
  "/vendor/xterm.css": [join(XTERM, "css", "xterm.css"), "text/css; charset=utf-8"],
  "/vendor/addon-fit.mjs": [join(addon("fit"), "lib", "addon-fit.mjs"), "text/javascript; charset=utf-8"],
  "/vendor/addon-webgl.mjs": [join(addon("webgl"), "lib", "addon-webgl.mjs"), "text/javascript; charset=utf-8"],
  "/vendor/addon-unicode11.mjs": [join(addon("unicode11"), "lib", "addon-unicode11.mjs"), "text/javascript; charset=utf-8"],
};
for (const path of Object.keys(files)) {
  if (path.endsWith(".mjs")) files[`${path}.map`] = [`${files[path]![0]}.map`, "application/json"];
}

type KeySource = "server" | "page" | "offline";

/** Whether the server can run the GM itself; the key itself is never read here, only that it's there. */
function serverKey(): "env" | "file" | undefined {
  if (process.env.OPENROUTER_API_KEY?.trim()) return "env";
  try { return statSync(KEY_FILE).size > 0 ? "file" : undefined; } catch { return undefined; }
}

/**
 * What's wrong with a key from the page, if anything can be told from the key itself. Another
 * provider's key would only fail when the GM first speaks, so it's turned back here, without being
 * sent anywhere.
 */
function keyProblem(key: string): string | undefined {
  if (!KEY_SHAPE.test(key)) return "That doesn't look like an OpenRouter key.";
  if (key.startsWith("sk-or-")) return undefined;
  const needed = "The GM runs through OpenRouter, so it needs an OpenRouter key (they start with sk-or-).";
  if (key.startsWith("sk-ant-")) return `That looks like an Anthropic key. ${needed}`;
  if (key.startsWith("sk-")) return `That looks like an OpenAI key. ${needed}`;
  return `That doesn't look like an OpenRouter key: they start with sk-or-.`;
}

/** Whether OpenRouter turns the key down. If it can't be asked, the game starts anyway and the GM says what's wrong. */
async function keyRefused(key: string): Promise<boolean> {
  try {
    const response = await fetch(KEY_CHECK, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
    await response.body?.cancel();
    return response.status === 401 || response.status === 403;
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    console.log(`Couldn't ask OpenRouter about a key from the page (${(error as Error).name}${code ? ` ${code}` : ""}); the game starts anyway.`);
    return false;
  }
}

function gameEnv(source: KeySource, key?: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !TERMINAL_ENV.test(name)) env[name] = value;
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  if (source === "offline") env.OPENROUTER_API_KEY = "offline";
  if (source === "page" && key) env.OPENROUTER_API_KEY = key;
  return env;
}

// Requests must name this server as it was reached (a DNS-rebinding page can't), and the WebSocket
// must come from this server's own page.
let allowedHosts = new Set<string>();

function hostsFor(port: number): Set<string> {
  const names = new Set<string>();
  const wildcard = HOST === "0.0.0.0" || HOST === "::";
  if (wildcard || isLoopback(HOST)) for (const name of ["127.0.0.1", "localhost", "[::1]"]) names.add(name);
  if (wildcard) {
    for (const nets of Object.values(networkInterfaces())) {
      for (const net of nets ?? []) names.add(net.family === "IPv6" ? `[${net.address.split("%")[0]}]` : net.address);
    }
    names.add(hostname().toLowerCase());
    if (!hostname().includes(".")) names.add(`${hostname().toLowerCase()}.local`);
  } else if (!isLoopback(HOST)) {
    names.add(HOST.includes(":") ? `[${HOST}]` : HOST.toLowerCase());
  }
  const hosts = new Set([...names].map(name => `${name}:${port}`));
  for (const origin of EXTRA_ORIGINS) hosts.add(new URL(origin).host);
  return hosts;
}

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "::1" || /^127\./.test(host);
}

function hostAllowed(host: string | undefined): host is string {
  return host !== undefined && allowedHosts.has(host.toLowerCase());
}

function originAllowed(origin: string | undefined, host: string): boolean {
  if (!origin) return false;
  return origin === `http://${host.toLowerCase()}` || EXTRA_ORIGINS.includes(origin);
}

function headers(res: ServerResponse, type: string, host: string): void {
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; ` +
      `connect-src 'self' ws://${host} wss://${host}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`,
  );
}

function reply(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`${text}\n`);
}

/** A request's path, or undefined when it isn't one (new URL throws on "//", "//[" and the like). */
function pathOf(url: string | undefined): string | undefined {
  try {
    return new URL(url ?? "/", "http://server").pathname;
  } catch {
    return undefined;
  }
}

// What went wrong and where, without the error's message, which can quote what the page sent.
function where(error: unknown): string {
  const frame = (error instanceof Error ? error.stack ?? "" : "").split("\n").find(line => line.trimStart().startsWith("at "));
  return `${error instanceof Error ? error.name : typeof error}${frame ? ` ${frame.trim()}` : ""}`;
}

function serve(req: IncomingMessage, res: ServerResponse): void {
  const host = req.headers.host;
  if (!hostAllowed(host)) return reply(res, 421, "This server doesn't answer to that name.");
  if (req.method !== "GET" && req.method !== "HEAD") return reply(res, 405, "Method not allowed.");
  const path = pathOf(req.url);
  if (path === undefined) return reply(res, 400, "Bad request.");
  let body: Buffer | string;
  let type: string;
  try {
    const file = files[path];
    if (file) {
      type = file[1];
      body = readFileSync(file[0]);
    } else if (path === "/fonts.css") {
      type = "text/css; charset=utf-8";
      body = fontFaceCss(webFonts(FONTS));
    } else if (path === "/fonts.json") {
      type = "application/json";
      body = JSON.stringify(fontList(webFonts(FONTS)));
    } else if (path.startsWith("/fonts/") && isFontFile(decodeURIComponent(path.slice(7)))) {
      const name = decodeURIComponent(path.slice(7));
      type = name.toLowerCase().endsWith(".otf") ? "font/otf" : "font/ttf";
      body = readFileSync(join(FONTS, name));
    } else {
      return reply(res, 404, "Not found.");
    }
  } catch {
    return reply(res, 404, "Not found.");
  }
  headers(res, type, host);
  res.writeHead(200);
  res.end(req.method === "HEAD" ? undefined : body);
}

// A game holds its place under --max-games until its background jobs (the GM's notes on its last
// turn) are done too: running, then finishing.
const running = new Set<GameTerminal>();
const finishing = new Set<GameTerminal>();
// How to end each game that hasn't finished yet (what the server does on its way out).
const endings = new Set<() => Promise<void>>();
let gameCount = 0;
let closing = false;

const full = () => running.size + finishing.size >= MAX_GAMES;
const counts = () => `${running.size} running${finishing.size ? `, ${finishing.size} finishing` : ""}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const duration = (ms: number) => {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
};

function busy(): string {
  const games = plural(MAX_GAMES, "game");
  if (!finishing.size) return `This server is already running ${games}. Try again when one ends.`;
  return `This server is already running ${games} (${finishing.size === 1 ? "one is" : `${finishing.size} are`} just finishing the GM's notes on a last turn). Try again in a minute or two.`;
}

/**
 * Ends a game: it saves and stops, then its background jobs get up to BACKGROUND_LIMIT_MS to finish
 * (they carry the game's key, so they're stopped then if they haven't), and only then is its place
 * free.
 */
async function retire(game: GameTerminal, id: number, played: number, traffic: () => string): Promise<void> {
  try {
    await game.stop();
    running.delete(game);
    const jobs = game.background().length;
    if (jobs) finishing.add(game);
    const left = game.lingering ? "; something of it is still running!" : "";
    console.log(`game ${id} ended after ${duration(played)}: ${traffic()}${left} (${counts()})`);
    if (!jobs) return;
    const them = jobs === 1 ? "it" : "them";
    const how = closing ? `waiting for ${them}, up to ${BACKGROUND_LIMIT_MS / 60_000} min (Ctrl+C again to stop ${them} now)` : `${jobs === 1 ? "it keeps" : "they keep"} the game's place for up to ${BACKGROUND_LIMIT_MS / 60_000} min`;
    console.log(`game ${id}: ${plural(jobs, "background job")} (the GM's notes on its last turn) still running; ${how}`);
    const since = Date.now();
    const { stopped } = await game.settle(BACKGROUND_LIMIT_MS);
    finishing.delete(game);
    console.log(`game ${id}: its background work ${stopped ? `was stopped after ${duration(Date.now() - since)}` : `finished after ${duration(Date.now() - since)}`} (${counts()})`);
  } finally {
    // Whatever happened, the place is free once this is over.
    running.delete(game);
    finishing.delete(game);
  }
}

// Output is held back while the page is this far behind, so a slow link slows the game's drawing
// rather than piling up in memory.
const HIGH_WATER = 1 << 20;
const LOW_WATER = 1 << 16;

function play(ws: WebSocket, req: IncomingMessage): void {
  const socket = req.socket;
  let game: GameTerminal | undefined;
  let end: (() => Promise<void>) | undefined;
  let checking = false;
  let id = 0;
  let size = { cols: 120, rows: 40 };
  let toPage = 0;
  let fromPage = 0;
  let pending: Buffer[] = [];
  let flushing = false;

  const control = (message: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };
  const keyNeeded = () => !OFFLINE && serverKey() === undefined;

  // Chunks read in the same turn go out as one message.
  const flush = () => {
    flushing = false;
    if (!pending.length || ws.readyState !== ws.OPEN) { pending = []; return; }
    const data = pending.length === 1 ? pending[0]! : Buffer.concat(pending);
    pending = [];
    toPage += data.length;
    ws.send(data, { binary: true }, () => {
      if (ws.bufferedAmount < LOW_WATER) game?.resume();
    });
    if (ws.bufferedAmount > HIGH_WATER) game?.pause();
  };

  const turnAway = (): boolean => {
    if (closing) {
      control({ type: "error", message: "The server is stopping." });
      ws.close(1001, "The server is stopping");
      return true;
    }
    if (!full()) return false;
    control({ type: "error", message: busy() });
    ws.close(1013, "Server busy");
    return true;
  };

  const start = (source: KeySource, key?: string) => {
    if (ws.readyState !== ws.OPEN || game || turnAway()) return;
    id = ++gameCount;
    try {
      game = new GameTerminal({
        cwd: ROOT,
        ...size,
        env: gameEnv(source, key),
        onData: chunk => {
          pending.push(chunk);
          if (!flushing) { flushing = true; setImmediate(flush); }
        },
        onExit: (code, signal) => {
          debug(`game ${id}: exited (code ${code}, signal ${signal})`);
          flush();
          control({ type: "exit", code, signal });
          ws.close(1000, "The game ended");
        },
      });
    } catch (error) {
      console.error(`game ${id} didn't start: ${(error as Error).message}`);
      control({ type: "error", message: "The game didn't start on the server." });
      ws.close(1011, "Game didn't start");
      return;
    }
    const started = game;
    const gameId = id;
    let ended: Promise<void> | undefined;
    end = () => {
      ended ??= retire(started, gameId, Date.now() - started.started, () => `${amount(toPage)} to the page, ${amount(socket.bytesWritten)} on the wire`)
        .catch(error => console.error(`game ${gameId}: ${where(error)}`))
        .finally(() => endings.delete(end!));
      return ended;
    };
    endings.add(end);
    running.add(started);
    const from = source === "page" ? "the key from the page" : source === "offline" ? "offline (no GM)" : "the server's key";
    console.log(`game ${id} started: pid ${started.pid}, ${size.cols}x${size.rows}, ${from} (${counts()})`);
    control({ type: "started", offline: source === "offline" });
  };

  // The key is checked with OpenRouter before the game starts, so a wrong one comes back to the form.
  const startWithKey = async (key: string) => {
    if (turnAway()) return;
    checking = true;
    const refused = await keyRefused(key).finally(() => { checking = false; });
    if (ws.readyState !== ws.OPEN) return;
    if (refused) return control({ type: "hello", needKey: true, offline: false, error: "OpenRouter didn't accept that key. You can check it, or make another, at openrouter.ai/keys." });
    start("page", key);
  };

  control({ type: "hello", needKey: keyNeeded(), offline: OFFLINE });

  const receive = (data: RawData, isBinary: boolean) => {
    if (isBinary) {
      const bytes = rawBytes(data);
      fromPage += bytes.length;
      game?.write(bytes);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBytes(data).toString("utf8"));
    } catch {
      parsed = undefined;
    }
    // Every message is a JSON object ("null" parses, and isn't one).
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      ws.close(1003, "Unreadable message");
      return;
    }
    const message = parsed as Record<string, unknown>;
    switch (message.type) {
      case "start": {
        if (game || checking) return;
        size = dimensions(message.cols, message.rows) ?? size;
        if (OFFLINE || message.offline === true) return start("offline");
        if (!keyNeeded()) return start("server");
        const key = typeof message.key === "string" ? message.key.trim() : "";
        const problem = keyProblem(key);
        if (problem) return control({ type: "hello", needKey: true, offline: false, error: problem });
        void startWithKey(key).catch(error => {
          console.error(`game ${id}: ${where(error)}`);
          ws.close(1011, "Server error");
        });
        return;
      }
      case "resize": {
        const next = dimensions(message.cols, message.rows);
        if (!next) return;
        size = next;
        game?.resize(next.cols, next.rows);
        return;
      }
      case "stats":
        return control({ type: "stats", toPage, fromPage, wireOut: socket.bytesWritten, wireIn: socket.bytesRead });
    }
  };

  // Whatever a page sends, the worst it can do is end its own connection.
  ws.on("message", (data: RawData, isBinary: boolean) => {
    try {
      receive(data, isBinary);
    } catch (error) {
      console.error(`game ${id}: ${where(error)}`);
      ws.close(1011, "Server error");
    }
  });

  ws.on("error", error => debug(`game ${id}: socket error: ${error.message}`));
  ws.on("close", (code, reason) => {
    debug(`game ${id}: socket closed (${code}${reason.length ? ` ${reason.toString()}` : ""})`);
    void end?.();
  });
}

function rawBytes(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function dimensions(cols: unknown, rows: unknown): { cols: number; rows: number } | undefined {
  if (typeof cols !== "number" || typeof rows !== "number" || !Number.isFinite(cols) || !Number.isFinite(rows)) return undefined;
  return { cols: Math.min(500, Math.max(20, Math.floor(cols))), rows: Math.min(200, Math.max(8, Math.floor(rows))) };
}

const amount = (bytes: number) => (bytes < 1e6 ? `${(bytes / 1e3).toFixed(1)} KB` : `${(bytes / 1e6).toFixed(2)} MB`);

// KM_WEB_DEBUG=1 says what happens to each connection (never what's in it).
function debug(line: string): void {
  if (process.env.KM_WEB_DEBUG) console.log(`[debug ${(performance.now() / 1000).toFixed(3)}s] ${line}`);
}

// A request the server can't make sense of is answered (or dropped) on its own; it never takes the
// server, and everyone's games, down with it.
const server = createServer((req, res) => {
  try {
    serve(req, res);
  } catch (error) {
    console.error(`request: ${where(error)}`);
    if (res.headersSent) res.destroy();
    else reply(res, 500, "Something went wrong.");
  }
});
// The output is mostly the same few escape sequences over and over: compression (with the context
// kept between messages) cuts it several times over. Keystrokes are too small to bother.
const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20, perMessageDeflate: { threshold: 512 } });

server.on("upgrade", (req, socket, head) => {
  // A client that resets mid-handshake mustn't take the server down with it.
  const onError = (error: Error) => debug(`upgrade: socket error: ${error.message}`);
  socket.on("error", onError);
  const refuse = (status: number, text: string) => {
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  try {
    const path = pathOf(req.url);
    if (path === undefined) return refuse(400, "Bad Request");
    if (path !== "/play") return refuse(404, "Not Found");
    if (!hostAllowed(req.headers.host)) return refuse(421, "Misdirected Request");
    if (!originAllowed(req.headers.origin, req.headers.host)) return refuse(403, "Forbidden");
    if (closing) return refuse(503, "Service Unavailable");
    wss.handleUpgrade(req, socket, head, ws => {
      // The WebSocket handles its socket's errors from here.
      socket.off("error", onError);
      play(ws, req);
    });
  } catch (error) {
    console.error(`upgrade: ${where(error)}`);
    socket.destroy();
  }
});

// The first Ctrl+C (or SIGTERM, or the terminal going away) stops every game, each saving as it
// goes, and waits for their background jobs; another Ctrl+C stops those at once. Under npm run, one
// Ctrl+C arrives twice (the terminal's, and npm passing it on a fraction of a millisecond later), so
// "another" is one that comes a little after the first.
let closingAt = 0;
let hurried = false;
async function shutdown(): Promise<void> {
  if (closing) {
    if (hurried || Date.now() - closingAt < 300) return;
    hurried = true;
    if (finishing.size || running.size) console.log("Stopping the background work now.");
    for (const game of [...running, ...finishing]) game.hurryUp();
    return;
  }
  closing = true;
  closingAt = Date.now();
  server.close();
  if (running.size) console.log(`Stopping ${plural(running.size, "game")} (each saves as it goes)...`);
  // (A game that ends from here on says so itself.)
  if (finishing.size) console.log(`Waiting for the background work of ${plural(finishing.size, "game")} that ended (the GM's notes on a last turn), up to ${BACKGROUND_LIMIT_MS / 60_000} min; Ctrl+C again to stop it now.`);
  for (const ws of wss.clients) ws.close(1001, "The server is stopping");
  await Promise.all([...endings].map(end => end()));
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
process.on("SIGHUP", () => void shutdown());
// Should the server die some other way, the games still save and stop (the pty hangs up on them),
// but their background jobs, in sessions of their own, wouldn't notice: they're stopped here.
process.on("exit", () => {
  for (const game of [...running, ...finishing]) game.abandonBackground();
});
// A log line that can't be written (the terminal has gone) is no reason to stop.
process.stdout.on("error", () => undefined);
process.stderr.on("error", () => undefined);

server.listen(PORT, HOST, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : PORT;
  allowedHosts = hostsFor(port);
  const shown = HOST === "0.0.0.0" || HOST === "::" ? "localhost" : HOST.includes(":") ? `[${HOST}]` : HOST;
  const key = OFFLINE ? "offline: no GM" : serverKey() === "env" ? "the GM's key from OPENROUTER_API_KEY" : serverKey() === "file" ? "the GM's key from ~/secrets" : "no key here, so the page asks for one";
  console.log(`Kingmaker on http://${shown}:${port}/ (${key}; up to ${plural(MAX_GAMES, "game")} at once)`);
  if (!isLoopback(HOST)) {
    console.warn(
      `Warning: listening on ${HOST}, so anyone who can reach it can play here, on this server's key if it has one.\n` +
        `There's no TLS: a key typed into the page would travel in the clear. Put an HTTPS proxy in front (and pass its --origin) before using it beyond a trusted network.`,
    );
  }
});
