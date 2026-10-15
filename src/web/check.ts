import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { chromium, type Browser, type Page } from "playwright";
import { WebSocket } from "ws";

/**
 * Headless check of Kingmaker in the browser: the real server and game, driven through Chromium
 * with Playwright, the keys pressed as a player would. Screens go to runs/web/<run>/ as PNGs, each
 * with the terminal's text beside it (to compare with src/app/smoke's screens).
 *
 *   node --no-warnings src/web/check.ts              offline: the screens, keys, latency, bandwidth, a
 *                                                    problem reported (saved on the server), closing
 *                                                    the tab, the cap, Origin and Host checks,
 *                                                    requests and messages that mustn't stop the server
 *   node --no-warnings src/web/check.ts --live       the server's own key (~/secrets): a real GM reply
 *   node --no-warnings src/web/check.ts --key-form   no key on the server: the page asks for one, turns
 *                                                    back the wrong kinds, and the key from ~/secrets
 *                                                    goes in through it; a real GM reply
 *   ... --gpu                                        Chromium draws with the GPU (Vulkan) rather than
 *                                                    in software, for latency as a player would see it
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const RUN = new Date().toLocaleString("sv").replace(/[-:]/g, "").replace(" ", "-");
const MODE = process.argv.includes("--live") ? "live" : process.argv.includes("--key-form") ? "key-form" : "offline";
const GPU = process.argv.includes("--gpu");
const BROWSER_ARGS = GPU ? ["--enable-gpu", "--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist"] : [];
const OUT = join(ROOT, "runs", "web", `${RUN}-${MODE}${GPU ? "-gpu" : ""}`);
// Every process of this run's games (and their background jobs) has this in its environment.
const RUNS_DIR = join(OUT, "runs");
const KEY_FILE = join(homedir(), "secrets", "kingmaker-dev-openrouter.txt");
// The smoke test's terminal size, so the screens line up with runs/app-smoke's.
const COLS = 130;
const ROWS = 42;
mkdirSync(OUT, { recursive: true });

let failures = 0;
let shots = 0;
const report: string[] = [];

function ok(what: string): void {
  console.log(`ok: ${what}`);
}

function fail(what: string): void {
  failures++;
  console.log(`FAIL: ${what}`);
}

function note(line: string): void {
  console.log(line);
  report.push(line);
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

interface Server {
  url: string;
  proc: ChildProcess;
  log(): string;
  alive(): boolean;
  /** Ctrl+C; if the server is still waiting on background work after `hurryAfter` ms, Ctrl+C again. */
  stop(hurryAfter?: number): Promise<void>;
}

async function startServer(args: string[], env: NodeJS.ProcessEnv): Promise<Server> {
  const proc = spawn(process.execPath, ["--no-warnings", "src/web/server.ts", "--port", "0", ...args], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  proc.stdout!.on("data", chunk => { log += chunk; });
  proc.stderr!.on("data", chunk => { log += chunk; });
  const exited = new Promise<void>(resolve => proc.on("exit", () => resolve()));
  for (let i = 0; i < 100 && !/Kingmaker on http/.test(log); i++) await sleep(100);
  const url = /Kingmaker on (http:\/\/\S+)/.exec(log)?.[1];
  if (!url) throw new Error(`the server didn't start:\n${log}`);
  return {
    url,
    proc,
    log: () => log,
    alive: () => proc.exitCode === null && proc.signalCode === null,
    stop: async (hurryAfter = 15000) => {
      proc.kill("SIGINT");
      await Promise.race([exited, sleep(hurryAfter)]);
      if (proc.exitCode === null && proc.signalCode === null) {
        proc.kill("SIGINT");
        await Promise.race([exited, sleep(15000)]);
      }
      writeFileSync(join(OUT, "server.log"), log);
    },
  };
}

/** This run's processes still running: anything with its runs directory in its environment (Linux: /proc). */
function leftovers(): number[] {
  const marker = Buffer.from(`\0KM_RUNS_DIR=${RUNS_DIR}\0`);
  const pids: number[] = [];
  let entries: string[];
  try { entries = readdirSync("/proc"); } catch { return pids; }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if (Buffer.concat([Buffer.from([0]), readFileSync(`/proc/${entry}/environ`)]).includes(marker)) pids.push(Number(entry));
    } catch { /* another user's, or gone */ }
  }
  return pids;
}

/**
 * This run's processes with the key in their environment; whether there are any is all that's said
 * of it. (Only this run's: other shells on the machine can have the same key in theirs.)
 */
function holding(secret: string): number[] {
  return leftovers().filter(pid => {
    try { return readFileSync(`/proc/${pid}/environ`, "latin1").includes(secret); } catch { return false; }
  });
}

async function open(browser: Browser, url: string, watch?: (page: Page) => void): Promise<Page> {
  // The pinned size plus the page's frame (10px and 8px of padding each side) at 9x18 cells.
  const page = await browser.newPage({ viewport: { width: COLS * 9 + 20, height: ROWS * 18 + 16 } });
  page.on("pageerror", error => fail(`page error: ${error.message}`));
  watch?.(page);
  if (process.env.KM_WEB_CHECK_DEBUG) {
    page.on("console", message => console.log(`  console.${message.type()}: ${message.text().slice(0, 300)}`));
    page.on("websocket", ws => {
      const t0 = performance.now();
      const at = () => `${((performance.now() - t0) / 1000).toFixed(3)}s`;
      ws.on("framesent", frame => { if (typeof frame.payload === "string") console.log(`  ${at()} sent ${frame.payload.replace(/"key":"[^"]*"/, '"key":"…"')}`); });
      ws.on("framereceived", frame => console.log(`  ${at()} received ${typeof frame.payload === "string" ? frame.payload : `${frame.payload.length} bytes`}`));
      ws.on("close", () => console.log("  the WebSocket closed"));
    });
  }
  await page.goto(`${url}?size=${COLS}x${ROWS}`);
  // The terminal (and km) comes after the fonts have loaded, which can be after the load event.
  if (!(await until(page, "!!window.km", 15000))) throw new Error("the page never set up its terminal");
  return page;
}

const text = (page: Page) => page.evaluate("km.text()") as Promise<string>;
/** The lore check's panel, as a regex in the page: a fix on show (the first look's, or the second's, after the fixes). */
const LORE_PANEL = String.raw`/The lore check[^\n]*?: \d+ of \d+[\s\S]*?Your story says: [^\n│]*/`;

/**
 * Polls an expression in the page until it's truthy. (The page's CSP forbids eval, which
 * waitForFunction's string predicates need; evaluate goes through the debugger and isn't affected.)
 */
async function until(page: Page, expression: string, timeout: number): Promise<boolean> {
  const end = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate(expression)) return true;
    if (Date.now() > end) return false;
    await sleep(100);
  }
}

/** Waits for the screen to match; a miss stops the run (its screen is saved beside the others). */
async function waitFor(page: Page, pattern: string, what: string, timeout = 30000): Promise<void> {
  if (await until(page, `window.km ? new RegExp(${JSON.stringify(pattern)}, "is").test(km.text()) : false`, timeout)) {
    ok(what);
    return;
  }
  await shot(page, "failed").catch(() => undefined);
  throw new Error(`${what} (no /${pattern}/ within ${timeout / 1000}s)`);
}

async function shot(page: Page, name: string): Promise<void> {
  shots++;
  const base = join(OUT, `${String(shots).padStart(2, "0")}-${name}`);
  await page.screenshot({ path: `${base}.png` });
  writeFileSync(`${base}.txt`, await text(page).catch(() => ""));
}

async function press(page: Page, ...keys: string[]): Promise<void> {
  for (const key of keys) {
    await page.keyboard.press(key);
    await sleep(120);
  }
}

async function say(page: Page, line: string): Promise<void> {
  await waitFor(page, "Say it out loud", "the input is ready", 150000);
  await page.keyboard.type(line, { delay: 8 });
  // The scene's input submits what it holds as Enter comes, so an Enter in the same read as the last
  // letters sends them too; the pause is only to let the screen catch up before it moves on.
  await sleep(150);
  await press(page, "Enter");
}

async function newGame(page: Page, live: boolean): Promise<void> {
  await waitFor(page, "Hanged Clerk of Caerwyn", "title screen");
  await sleep(400);
  await shot(page, "title");
  await press(page, "n");
  await waitFor(page, "Who are you\\?", "character creation");
  await page.keyboard.type("Tamsin Vell", { delay: 15 });
  // Tab moves to the concept (the browser mustn't take it for focus).
  await press(page, "Tab");
  await page.keyboard.type("a disgraced palace auditor with a ledger-keeper's eye and a borrowed rapier", { delay: 5 });
  await sleep(300);
  if ((await text(page)).includes("ledger-keeper")) ok("Tab reached the game: the concept went into its own field");
  else fail("Tab didn't move to the concept field");
  await shot(page, "character-creation");
  await press(page, "Enter");
  // Three builds as cards (offline, the class defaults): → and Enter take the second.
  await waitFor(page, "Three ways to be Tamsin Vell.*HP \\d+.*Make my own", "three builds that fit, as cards", live ? 150000 : 90000);
  await shot(page, "builds");
  await press(page, "ArrowRight", "Enter");
  // The backstory: typed in its box a paragraph at a time, a click back into it and a word typed there, then Done.
  await waitFor(page, "Who were you, before the King sent for you\\?", "→ Enter takes the second: the backstory");
  await page.keyboard.type("I kept a grain factor's books on the wharves for nine years, until the night the sums came out too right.", { delay: 5 });
  await press(page, "Enter", "Enter");
  await page.keyboard.type("I owe Fat Jory three crowns.", { delay: 5 });
  await waitFor(page, "came out too right.*three crowns", "the backstory typed into the box, a paragraph at a time");
  // The middle of "I ke" is the k: the cursor goes just before "kept".
  await clickOn(page, "I ke");
  await page.keyboard.type("honestly ", { delay: 10 });
  await waitFor(page, "I honestly kept a grain factor", "a click put the cursor in the text, and what's typed went there");
  await shot(page, "backstory");
  await press(page, "Tab", "Enter");
  // The lore check's fixes, if it finds any (live): each taken with Enter, and its second look's too.
  for (let look = 0; live && look < 6; look++) {
    if (!await until(page, `window.km ? /Character sheet/.test(km.text()) || ${LORE_PANEL}.test(km.text()) : false`, 90000) || !await page.evaluate(`${LORE_PANEL}.test(km.text())`)) break;
    const shown = String(await page.evaluate(`(${LORE_PANEL}.exec(km.text()) || [""])[0]`));
    await shot(page, `lore-check-${look + 1}`);
    await press(page, "Enter");
    ok("the lore check offered a fix, and Enter took it");
    await until(page, `window.km ? !km.text().includes(${JSON.stringify(shown)}) : false`, 10000);
  }
  await waitFor(page, "Character sheet.*AC \\d+", "the rules engine made a sheet", live ? 150000 : 90000);
  await sleep(300);
  await shot(page, "sheet");
  await press(page, "Enter");
  await waitFor(page, "The lead:.*Hanged Clerk", "exploring Caerwyn, the lead is the hanged clerk");
}

// Keypress to the screen, from the browser's keydown: to the game's first output parsed, to xterm's
// draw once the screen has changed (by more than a few cells, so the map's own flicker doesn't
// count), and to the next animation frame after that draw. xterm draws in an animation frame and the
// browser puts that frame on the screen afterwards, so by the next one it's there: that's "on screen".
const PROBE = `(() => {
  if (window.probe) return;
  const probe = window.probe = { samples: [], pending: null };
  document.addEventListener("keydown", event => {
    if (!probe.armed) return;
    probe.armed = false;
    probe.pending = { t0: event.timeStamp, before: km.text(), parsed: null };
  }, true);
  km.term.onWriteParsed(() => {
    const p = probe.pending;
    if (p && p.parsed === null) p.parsed = performance.now() - p.t0;
  });
  km.term.onRender(() => {
    const p = probe.pending;
    if (!p) return;
    const now = km.text();
    let changed = 0;
    for (let i = 0; i < now.length && changed < 20; i++) if (now[i] !== p.before[i]) changed++;
    if (changed < 20) return;
    probe.pending = null;
    const drawn = performance.now() - p.t0;
    requestAnimationFrame(() => probe.samples.push({ firstOutput: p.parsed, drawn, onScreen: performance.now() - p.t0 }));
  });
})()`;

interface Sample { firstOutput: number | null; drawn: number; onScreen: number }

async function latency(page: Page, keys: string[], gap: number): Promise<Sample[]> {
  await page.evaluate(PROBE);
  await page.evaluate("probe.samples = []");
  for (const key of keys) {
    await page.evaluate("probe.armed = true; probe.pending = null");
    await page.keyboard.press(key);
    await sleep(gap);
  }
  return page.evaluate("probe.samples") as Promise<Sample[]>;
}

/** What draws the page's WebGL (SwiftShader is Chromium's software renderer). */
const glRenderer = (page: Page) =>
  page.evaluate(`(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl && gl.getExtension("WEBGL_debug_renderer_info");
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown";
  })()`) as Promise<string>;

/**
 * Clicks the middle of where `what` first shows on the screen. Columns are counted in characters,
 * not UTF-16 units: the map's glyphs from the private-use planes are one cell each, but two units.
 */
async function clickOn(page: Page, what: string, button: "left" | "right" = "left"): Promise<void> {
  const lines = (await text(page)).split("\n");
  const row = lines.findIndex(line => line.includes(what));
  if (row < 0) throw new Error(`"${what}" isn't on the screen to click`);
  const col = [...lines[row]!.slice(0, lines[row]!.indexOf(what))].length + Math.floor(what.length / 2);
  const cell = await page.evaluate(`(() => {
    const r = document.querySelector(".xterm-screen").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width / km.term.cols, h: r.height / km.term.rows };
  })()`) as { x: number; y: number; w: number; h: number };
  await page.mouse.click(cell.x + (col + 0.5) * cell.w, cell.y + (row + 0.5) * cell.h, { button });
}

/**
 * The glyph atlas stays bounded. xterm's WebGL renderer keeps a glyph for each pair of colours it's
 * drawn in, merging its texture pages into ever bigger ones; the page starts a fresh atlas when a
 * merge reaches 2048 px. Screens of random colour pairs (far more than the map's animation draws)
 * until it does; then the text drawn before them must look as it did.
 */
async function atlasChurn(page: Page): Promise<void> {
  const clip = (await page.evaluate(`(() => {
    const r = document.querySelector(".xterm-screen").getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: 2 * r.height / km.term.rows };
  })()`)) as { x: number; y: number; width: number; height: number };
  await page.evaluate(`new Promise(done => km.term.write("\\x1b[H\\x1b[2K\\x1b[38;2;200;190;160mThe quick brown fox jumps over the lazy dog. 0123456789\\r\\n\\x1b[2K\\x1b[38;2;120;200;120m╭──────────╮ Sphinx of black quartz, judge my vow!\\x1b[0m", done))`);
  await sleep(400);
  const before = await page.screenshot({ clip });
  const t0 = performance.now();
  let screens = 0;
  while (screens < 120 && !(await page.evaluate("km.atlas.resets"))) {
    await page.evaluate(`new Promise(done => {
      const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,;:!?#%&*~^";
      let out = "\\x1b[3;1H";
      for (let y = 2; y < km.term.rows; y++) {
        for (let x = 0; x < km.term.cols; x++) {
          const f = (Math.random() * 0xffffff) | 0, b = (Math.random() * 0xffffff) | 0;
          out += "\\x1b[38;2;" + (f >> 16 & 255) + ";" + (f >> 8 & 255) + ";" + (f & 255) + ";48;2;" + (b >> 16 & 255) + ";" + (b >> 8 & 255) + ";" + (b & 255) + "m" + chars[(Math.random() * chars.length) | 0];
        }
        if (y < km.term.rows - 1) out += "\\r\\n";
      }
      km.term.write(out + "\\x1b[0m", () => requestAnimationFrame(() => requestAnimationFrame(done)));
    })`);
    screens++;
  }
  await sleep(600);
  const atlas = (await page.evaluate("km.atlas")) as { pages: number; merged: number; resets: number; widest: number };
  const renderer = await page.evaluate("km.renderer");
  const what = `${screens} screens of random colour pairs in ${((performance.now() - t0) / 1000).toFixed(0)} s: ${atlas.pages} pages made, ${atlas.merged} merged away, widest merged page ${atlas.widest} px, ${atlas.resets} fresh atlas`;
  if (atlas.resets && atlas.widest <= 2048 && renderer === "webgl") ok(`the glyph atlas stays bounded (${what})`);
  else fail(`the glyph atlas: ${what}; renderer ${renderer}`);
  const after = await page.screenshot({ clip });
  const differ = await page.evaluate(differing, [before.toString("base64"), after.toString("base64")]);
  if (differ === 0) ok("the text drawn before the fresh atlas looks just as it did");
  else {
    await shot(page, "atlas-after");
    fail(`the text drawn before the fresh atlas changed (${differ} pixels)`);
  }
}

/** In the page: how many pixels of two PNGs (base64) differ by more than a shade. */
async function differing([a, b]: string[]): Promise<number> {
  // The page's own globals (this file is typed for Node).
  const page = globalThis as unknown as { Image: new () => { onload: () => void; src: string; width: number; height: number }; document: { createElement(tag: "canvas"): { width: number; height: number; getContext(kind: "2d"): { drawImage(image: unknown, x: number, y: number): void; clearRect(x: number, y: number, w: number, h: number): void; getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } } } };
  const load = (src: string) => new Promise<InstanceType<typeof page.Image>>(done => { const image = new page.Image(); image.onload = () => done(image); image.src = `data:image/png;base64,${src}`; });
  const [first, second] = await Promise.all([load(a!), load(b!)]);
  const canvas = page.document.createElement("canvas");
  canvas.width = first.width;
  canvas.height = first.height;
  const draw = canvas.getContext("2d");
  draw.drawImage(first, 0, 0);
  const x = draw.getImageData(0, 0, canvas.width, canvas.height).data;
  draw.clearRect(0, 0, canvas.width, canvas.height);
  draw.drawImage(second, 0, 0);
  const y = draw.getImageData(0, 0, canvas.width, canvas.height).data;
  let count = 0;
  for (let i = 0; i < x.length; i += 4) if (Math.abs(x[i]! - y[i]!) + Math.abs(x[i + 1]! - y[i + 1]!) + Math.abs(x[i + 2]! - y[i + 2]!) > 30) count++;
  return count;
}

function changed(a: string, b: string): number {
  let count = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) count++;
  return count;
}

function summary(values: number[]): string {
  if (!values.length) return "no samples";
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return `median ${at(0.5).toFixed(0)} ms, p90 ${at(0.9).toFixed(0)} ms, min ${sorted[0]!.toFixed(0)}, max ${sorted[sorted.length - 1]!.toFixed(0)} (n=${values.length})`;
}

interface Traffic { bytesIn: number; messagesIn: number; wireOut: number }

async function traffic(page: Page): Promise<Traffic> {
  return page.evaluate(`km.serverStats().then(s => ({ bytesIn: km.stats.bytesIn, messagesIn: km.stats.messagesIn, wireOut: s.wireOut }))`) as Promise<Traffic>;
}

async function rate(page: Page, what: string, during: () => Promise<void>): Promise<void> {
  const before = await traffic(page);
  const started = Date.now();
  await during();
  const after = await traffic(page);
  const elapsed = (Date.now() - started) / 1000;
  const kb = (n: number) => `${(n / 1000 / elapsed).toFixed(1)} KB/s`;
  note(`bandwidth, ${what} (${elapsed.toFixed(1)}s): ${kb(after.bytesIn - before.bytesIn)} from the game, ${kb(after.wireOut - before.wireOut)} on the wire (compressed), ${((after.messagesIn - before.messagesIn) / elapsed).toFixed(1)} messages/s`);
}

function sessions(runs: string): Array<{ id: string; mtime: number }> {
  const dir = join(runs, "sessions");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(id => existsSync(join(dir, id, "game.json")))
    .map(id => ({ id, mtime: statSync(join(dir, id, "game.json")).mtimeMs }));
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function pidsFromLog(log: string): number[] {
  return [...log.matchAll(/started: pid (\d+)/g)].map(m => Number(m[1]));
}

/** The status line a raw request gets: it can say what fetch and ws won't, such as a path of "//". */
function rawRequest(url: string, request: string): Promise<string> {
  return new Promise(resolve => {
    const { hostname, port } = new URL(url);
    const socket = connect(Number(port), hostname);
    let got = "";
    socket.on("data", data => { got += data.toString("latin1"); });
    socket.on("close", () => resolve(got.split("\r\n")[0] || "no answer"));
    socket.on("error", error => resolve(`error ${error.message}`));
    socket.write(request);
    setTimeout(() => socket.end(), 1500);
  });
}

/** How the server answers a text message from its own page that isn't a JSON object (its close code). */
function oddMessage(url: string, payload: string): Promise<string> {
  return new Promise(resolve => {
    const own = new URL(url);
    const ws = new WebSocket(`ws://${own.host}/play`, { headers: { Origin: own.origin } });
    ws.on("open", () => ws.send(payload));
    ws.on("close", code => resolve(`closed ${code}`));
    ws.on("error", error => resolve(`error ${error.message}`));
  });
}

async function wsRefused(url: string, headers: Record<string, string>): Promise<string> {
  return new Promise(resolve => {
    const ws = new WebSocket(url.replace(/^http/, "ws") + "play", { headers });
    ws.on("open", () => { ws.close(); resolve("opened"); });
    ws.on("unexpected-response", (_req, res) => resolve(`refused ${res.statusCode}`));
    ws.on("error", error => resolve(`error ${error.message}`));
  });
}

async function offline(): Promise<void> {
  const runs = RUNS_DIR;
  const server = await startServer(["--offline", "--max-games", "2"], { ...process.env, KM_RUNS_DIR: runs });
  const browser = await chromium.launch({ args: BROWSER_ARGS });
  try {
    const page = await open(browser, server.url);
    const renderer = await page.evaluate("km.renderer");
    if (renderer === "webgl") ok("the WebGL renderer is drawing (box and block characters drawn by xterm)");
    else fail(`renderer is ${renderer}, not webgl`);
    note(`WebGL is drawn by: ${await glRenderer(page)}`);
    await newGame(page, false);
    await waitFor(page, "Sergeant Kell", "Kell is about");
    await sleep(800);
    await shot(page, "map-morning");

    // Walking: an arrow and a WASD step. The view follows the player, so a step scrolls the map.
    const before = await text(page);
    await press(page, "ArrowLeft", "a");
    await sleep(600);
    const after = await text(page);
    await shot(page, "walking");
    if (!/The wall wins/.test(after) && changed(before, after) > 200) ok(`two steps left, with an arrow and with a: the map scrolled (${changed(before, after)} cells changed)`);
    else fail(`walking left: ${changed(before, after)} cells changed${/The wall wins/.test(after) ? ", into a wall" : ""}`);
    await press(page, "ArrowRight", "d");
    await sleep(400);

    // Right-click is the game's: someone in Nearby gets its menu of what you can do, and the browser's
    // own menu (which would cover it, and take the next click) doesn't come up.
    await page.evaluate(`window.unprevented = 0;
      document.addEventListener("contextmenu", event => { if (!event.defaultPrevented) window.unprevented++; })`);
    await clickOn(page, "Sergeant Kell", "right");
    await waitFor(page, "Talk.*Esc never mind", "right-clicking Kell in Nearby opens the game's menu");
    await shot(page, "right-click");
    const unprevented = await page.evaluate("window.unprevented") as number;
    if (unprevented) fail(`the browser's own menu came up on a right-click (${unprevented})`);
    else ok("the browser's own menu stayed down");
    if (await page.evaluate("km.term.getSelection()")) fail("the right-click selected text");
    await press(page, "Escape");
    await sleep(300);
    if (/Esc never mind/.test(await text(page))) fail("Esc didn't close the right-click menu");

    // Overlays and the menu: c, ?, Esc.
    await press(page, "c");
    await waitFor(page, "Character sheet.*Saving throws.*Skills", "c opens the sheet");
    await press(page, "Escape");
    await press(page, "?");
    await waitFor(page, "How to play", "? opens the help");
    await sleep(300);
    await shot(page, "help");
    await press(page, "Escape");
    await press(page, "Escape");
    await waitFor(page, "Save and quit", "Esc opens the menu");
    await press(page, "Escape");
    await sleep(500);

    // Keypress to the screen.
    const steps = await latency(page, Array.from({ length: 24 }, (_, i) => (i % 2 ? "ArrowRight" : "ArrowLeft")), 400);
    if (/The wall wins/.test(await text(page))) fail("a step in the latency run hit a wall");
    note(`latency, a step on the map, keydown to on screen (the next frame after xterm's draw): ${summary(steps.map(s => s.onScreen))}`);
    note(`latency, a step on the map, keydown to xterm's draw: ${summary(steps.map(s => s.drawn))}`);
    note(`latency, a step on the map, keydown to the game's first output parsed: ${summary(steps.flatMap(s => (s.firstOutput === null ? [] : [s.firstOutput])))}`);
    const sheets = await latency(page, Array.from({ length: 16 }, (_, i) => (i % 2 ? "Escape" : "c")), 400);
    note(`latency, opening and closing the sheet, keydown to on screen: ${summary(sheets.map(s => s.onScreen))}`);
    note(`latency, opening and closing the sheet, keydown to xterm's draw: ${summary(sheets.map(s => s.drawn))}`);
    if (steps.length >= 12) ok("latency measured");
    else fail(`only ${steps.length} of 24 steps changed the screen`);

    // Bandwidth on the map: still, then walking four steps a second.
    await sleep(1000);
    await rate(page, "the map idle", () => sleep(10000));
    await rate(page, "walking 4 steps/s", async () => {
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press(i % 2 ? "ArrowRight" : "ArrowLeft");
        await sleep(250);
      }
    });

    // The granary scene, a step at a time with g.
    await press(page, "g");
    await waitFor(page, "The Hanged Clerk ·", "g walks to the lead and the granary scene opens", 60000);
    await waitFor(page, "couldn't open the scene", "offline: the GM can't speak (expected)", 40000);
    await sleep(500);
    await shot(page, "granary-scene");

    // A problem reported mid-scene (/report): saved on the server, under its runs/reports, with what the page said of the browser.
    await page.keyboard.type("/report", { delay: 15 });
    await press(page, "Enter");
    await waitFor(page, "What went wrong\\?", "/report asks what went wrong");
    await page.keyboard.type("The GM never opened the scene", { delay: 10 });
    await press(page, "Enter");
    await waitFor(page, "Report saved.*tell", "the report is saved on the server, and the game says where, to tell Claude");
    await shot(page, "report-saved");
    const reports = join(runs, "reports");
    const filed = existsSync(reports) ? readdirSync(reports).filter(f => f.endsWith(".json.gz")) : [];
    const dump = filed.length ? JSON.parse(gunzipSync(readFileSync(join(reports, filed[0]!))).toString("utf8")) as { words: string; build: { host: string }; settings: { userAgent?: string; window?: string; terminal?: { cols: number } }; game?: { id: string } } : undefined;
    if (dump?.words === "The GM never opened the scene" && dump.build.host === "server" && /Chrome/.test(dump.settings.userAgent ?? "") && /^\d+x\d+@[\d.]+$/.test(dump.settings.window ?? "") && dump.settings.terminal?.cols === COLS && dump.game) {
      ok(`it's in the server's runs/reports (${filed[0]}): the server's game, the browser's agent and window (${dump.settings.window}), the game's files`);
    } else fail(`the report on the server: ${filed.join(", ") || "none"}${dump ? `, ${JSON.stringify({ host: dump.build.host, ua: dump.settings.userAgent, window: dump.settings.window, terminal: dump.settings.terminal })}` : ""}`);
    await press(page, "Enter");
    await sleep(300);

    // PgUp and PgDn scroll the scene's transcript. Offline it's short, so #exits fills it past its
    // height first; then the transcript's top lines (between the first pair of │) must move and come back.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.type("#exits", { delay: 10 });
      await sleep(150);
      await press(page, "Enter");
    }
    await sleep(500);
    const top = async () => (await text(page)).split("\n").slice(1, 4).map(line => line.split("│")[1]?.trim() ?? "").join(" / ");
    const bottom = await top();
    await press(page, "PageUp");
    await sleep(400);
    const up = await top();
    await shot(page, "scene-scrolled-up");
    await press(page, "PageDown", "PageDown");
    await sleep(400);
    const down = await top();
    if (up !== bottom && down === bottom) ok(`PgUp scrolls the scene's transcript back ("${bottom.slice(0, 32)}…" became "${up.slice(0, 32)}…") and PgDn returns`);
    else fail(`PgUp/PgDn: the transcript's top was "${bottom.slice(0, 60)}", after PgUp "${up.slice(0, 60)}", after PgDn "${down.slice(0, 60)}"`);

    // The scene's help has the one wide glyph the game draws (🎲). If the game and xterm disagreed on
    // its width, everything after it on its row would shift a column: the borders on its row must sit
    // in the same columns as on the rows around it.
    await say(page, "#help");
    await waitFor(page, "🎲", "#help in a scene shows the dice glyph");
    await sleep(300);
    await shot(page, "scene-help");
    const dice = (await page.evaluate(`(() => {
      const buffer = km.term.buffer.active;
      const rows = [];
      for (let y = 0; y < km.term.rows; y++) {
        const line = buffer.getLine(buffer.viewportY + y);
        const row = { dice: -1, width: 0, edges: [] };
        for (let x = 0; x < km.term.cols; x++) {
          const cell = line.getCell(x);
          const ch = cell.getChars();
          if (ch === "🎲") { row.dice = x; row.width = cell.getWidth(); }
          if (ch && "│║┃".includes(ch)) row.edges.push(x);
        }
        rows.push(row);
      }
      const at = rows.findIndex(row => row.dice >= 0);
      // The help box's own sides either side of the die: the scene's place, drawn beside the box, has walls of its own.
      const d = rows[at].dice;
      const sides = edges => [Math.max(...edges.filter(x => x < d)), Math.min(...edges.filter(x => x > d))];
      return { width: rows[at].width, edges: [rows[at - 1].edges, rows[at].edges, rows[at + 1].edges].map(e => sides(e).join(",")) };
    })()`)) as { width: number; edges: string[] };
    if (dice.width === 2 && dice.edges[0] === dice.edges[1] && dice.edges[1] === dice.edges[2]) ok(`🎲 takes two cells in xterm as in the game (the borders on its row line up: columns ${dice.edges[1]})`);
    else fail(`🎲 is ${dice.width} cells wide; borders above, on and below its row: ${dice.edges.join(" / ")}`);
    await press(page, "Escape");

    // Ctrl+C saves and quits; the page says so.
    const savedBefore = sessions(runs);
    await press(page, "Control+c");
    try {
      await page.waitForSelector("#notice:not([hidden])", { timeout: 15000 });
      ok("Ctrl+C ends the game and the page says so");
    } catch {
      fail("no notice after Ctrl+C");
    }
    await shot(page, "closed");
    const saved = sessions(runs);
    if (saved.length && saved.some(s => !savedBefore.find(b => b.id === s.id && b.mtime === s.mtime))) ok("Ctrl+C saved the game");
    else fail("no save after Ctrl+C");
    // The game's gone, so nothing else draws while the atlas fills.
    await atlasChurn(page);

    // Play again: Continue is offered, and closing the tab mid-game saves and ends the process.
    await page.click("#notice-button");
    await waitFor(page, "Continue.*Tamsin Vell", "Play again: Continue is offered on the title screen");
    await shot(page, "continue");
    // x on a game asks first; any other key keeps it.
    await press(page, "x");
    await waitFor(page, "Delete this game\\?.*x again deletes it", "x on a game asks before deleting it");
    await press(page, "Escape");
    await waitFor(page, "Continue.*Tamsin Vell", "any other key keeps it (and Esc doesn't quit)");
    await press(page, "Enter");
    await waitFor(page, "The Hanged Clerk ·", "Continue resumed the granary scene where Ctrl+C left it", 30000);
    await sleep(500);
    const pid = pidsFromLog(server.log()).at(-1)!;
    const savesBefore = sessions(runs);
    await page.close();
    for (let i = 0; i < 100 && alive(pid); i++) await sleep(100);
    if (!alive(pid)) ok(`closing the tab ended the game (pid ${pid} is gone)`);
    else fail(`pid ${pid} still running after the tab closed`);
    await sleep(300);
    const savesAfter = sessions(runs);
    if (savesAfter.some(s => s.mtime > (savesBefore.find(b => b.id === s.id)?.mtime ?? 0))) ok("closing the tab saved the game (Ctrl+C's way)");
    else fail("closing the tab didn't save");
    if (/ended after/.test(server.log())) ok("the server logged the game's end");

    // Resize follows the browser: an unpinned page fits the window, and the game redraws to it.
    const wide = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await wide.goto(server.url);
    await waitFor(wide, "Hanged Clerk of Caerwyn", "an unpinned page");
    const size1 = (await wide.evaluate("[km.term.cols, km.term.rows]")) as number[];
    await wide.setViewportSize({ width: 1000, height: 640 });
    await sleep(1200);
    const size2 = (await wide.evaluate("[km.term.cols, km.term.rows]")) as number[];
    const lines = (await text(wide)).split("\n");
    const widest = Math.max(...lines.map(line => [...line].length));
    if (size1[0] !== size2[0] && lines.length === size2[1] && widest <= size2[0]! && /Hanged Clerk/.test(lines.join("\n"))) ok(`resize follows the window: ${size1.join("x")} -> ${size2.join("x")}, and the game redrew at the new size (its text is ${widest} columns at most)`);
    else fail(`resize: ${size1.join("x")} -> ${size2.join("x")}, ${lines.length} lines of up to ${widest} columns`);
    await shot(wide, "resized");

    // The cap (2 games here): a third page is turned away.
    const second = await open(browser, server.url);
    await waitFor(second, "Hanged Clerk of Caerwyn", "a second game alongside");
    const third = await open(browser, server.url);
    try {
      await third.waitForSelector("#notice:not([hidden])", { timeout: 10000 });
      const said = await third.textContent("#notice-text");
      if (/already running 2 games/.test(said ?? "")) ok(`the cap turns a third game away: "${said}"`);
      else fail(`third page notice: ${said}`);
      await shot(third, "server-full");
    } catch {
      fail("a third game was allowed past the cap of 2");
    }
    await Promise.all([wide.close(), second.close(), third.close()]);

    // HiDPI, with a real device scale factor: Playwright's emulated one tells the page 2x while the
    // canvas's device-pixel box stays 1x, so the WebGL canvas comes out magnified (an artifact of the
    // emulation, not of the page). The saved game opens in the granary scene, its place drawn in blocks.
    await sleep(1000);
    for (const scale of [2, 1.25]) {
      // (Cells round to whole device pixels, so at 1.25x a row is 18.4px: a little more room.)
      const hidpi = await chromium.launch({ args: [...BROWSER_ARGS, `--force-device-scale-factor=${scale}`, `--window-size=${COLS * 9 + 20},${ROWS * 19 + 16}`] });
      try {
        const sharp = await (await hidpi.newContext({ viewport: null })).newPage();
        await sharp.goto(`${server.url}?size=${COLS}x${ROWS}`);
        await waitFor(sharp, "Continue.*Tamsin Vell", `at ${scale}x: the title`);
        await press(sharp, "Enter");
        await waitFor(sharp, "The Hanged Clerk ·", `at ${scale}x: Continue opens the granary scene`);
        await sleep(600);
        const canvas = (await sharp.evaluate(`(() => {
          const d = km.term._core._renderService.dimensions.device.canvas;
          const gl = [...document.querySelectorAll("#terminal canvas")].find(c => !c.className);
          return { dpr: devicePixelRatio, drawn: d.width + "x" + d.height, canvas: gl ? gl.width + "x" + gl.height : "none" };
        })()`)) as { dpr: number; drawn: string; canvas: string };
        if (canvas.dpr === scale && canvas.drawn === canvas.canvas) ok(`at ${scale}x the WebGL canvas is the size xterm draws for (${canvas.canvas})`);
        else fail(`at ${scale}x: devicePixelRatio ${canvas.dpr}, xterm draws ${canvas.drawn}, the canvas is ${canvas.canvas}`);
        await shot(sharp, `hidpi-${scale}x`);
        await sharp.close();
        await sleep(800);
      } finally {
        await hidpi.close();
      }
    }

    // Another site can't open a game: the WebSocket checks Origin, and every request checks Host.
    const own = new URL(server.url);
    const evil = await wsRefused(server.url, { Origin: "http://evil.example" });
    const none = await wsRefused(server.url, {});
    const rebound = await wsRefused(server.url, { Origin: `http://evil.example:${own.port}`, Host: `evil.example:${own.port}` });
    if (evil === "refused 403" && none === "refused 403" && rebound === "refused 421") ok(`the WebSocket refuses other origins (${evil}), no origin (${none}) and other host names (${rebound})`);
    else fail(`origin checks: evil ${evil}, none ${none}, rebound ${rebound}`);
    // (fetch won't send a Host header of its own, so plain http.)
    const status = await new Promise<number | undefined>(resolve => {
      get(server.url, { headers: { Host: `evil.example:${own.port}` } }, res => { res.resume(); resolve(res.statusCode); }).on("error", () => resolve(undefined));
    });
    if (status === 421) ok("the page itself refuses another host name (DNS rebinding)");
    else fail(`the page with another Host: ${status}`);

    // What a page (or anything on this machine) might send that isn't what the page sends gets an
    // answer, and the server stays up for everyone else: "//" isn't a path new URL can read, and
    // null, [] and 1 aren't messages.
    const host = `Host: ${own.host}\r\n`;
    const slashes = await rawRequest(server.url, `GET // HTTP/1.1\r\n${host}\r\n`);
    const upgrade = await rawRequest(server.url, `GET // HTTP/1.1\r\n${host}Origin: ${own.origin}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
    const odd = [await oddMessage(server.url, "null"), await oddMessage(server.url, "[]"), await oddMessage(server.url, "1")];
    const still = await new Promise<number | undefined>(resolve => {
      get(server.url, res => { res.resume(); resolve(res.statusCode); }).on("error", () => resolve(undefined));
    });
    if (/ 400 /.test(slashes) && / 400 /.test(upgrade) && odd.every(o => o === "closed 1003") && still === 200 && server.alive()) ok(`a path of // gets a 400 (as a page and as a WebSocket), messages of null, [] and 1 close that connection (1003), and the server carries on`);
    else fail(`odd requests: GET // -> ${slashes}; upgrade // -> ${upgrade}; null, [], 1 -> ${odd.join(", ")}; the page afterwards -> ${still}; server alive: ${server.alive()}`);
  } finally {
    await browser.close();
    await server.stop();
    const lingering = pidsFromLog(server.log()).filter(alive);
    if (lingering.length) fail(`games still running after the server stopped: ${lingering.join(", ")}`);
    else ok("every game process is gone after the server stopped");
    const left = leftovers();
    if (left.length) fail(`processes of this run still running after the server stopped: ${left.join(", ")}`);
    else ok("nothing of this run's games is left (no process has its runs directory in its environment)");
  }
}

async function live(keyForm: boolean): Promise<void> {
  const key = readFileSync(KEY_FILE, "utf8").trim();
  const env: NodeJS.ProcessEnv = { ...process.env, KM_RUNS_DIR: RUNS_DIR };
  delete env.OPENROUTER_API_KEY;
  if (keyForm) env.HOME = mkdtempSync(join(OUT, "home-"));
  const server = await startServer([], env);
  if (keyForm && /the page asks for one/.test(server.log())) ok("with no key on the server, it says the page will ask");
  else if (keyForm) fail("the server thinks it has a key");
  const browser = await chromium.launch({ args: BROWSER_ARGS });
  const received: string[] = [];
  try {
    // Every frame the page gets back, from the first: none may carry the key.
    const page = await open(browser, server.url, watched => {
      watched.on("websocket", ws => ws.on("framereceived", frame => received.push(typeof frame.payload === "string" ? frame.payload : frame.payload.toString("latin1"))));
    });
    if (keyForm) {
      await page.waitForSelector("#gate:not([hidden])", { timeout: 10000 });
      ok("the page asks for a key");
      await shot(page, "key-form");
      // The wrong kinds of key are turned back without starting a game: a malformed one and another
      // provider's (both told from the key itself), and one OpenRouter doesn't know (it's asked).
      for (const [what, wrong, expected] of [
        ["a malformed key", "not a key", /doesn't look like an OpenRouter key/],
        ["an OpenAI key", `sk-proj-${"Xy7".repeat(16)}`, /looks like an OpenAI key/],
        ["an OpenRouter key OpenRouter doesn't know", `sk-or-v1-${"0".repeat(64)}`, /OpenRouter didn't accept that key/],
      ] as const) {
        await page.fill("#key", wrong);
        await page.click("button[type=submit]");
        const said = (await until(page, `(() => { const e = document.getElementById("key-error"); return !e.hidden && !document.getElementById("key").disabled; })()`, 15000))
          ? await page.textContent("#key-error")
          : "(no answer)";
        if (expected.test(said ?? "") && !(await page.evaluate("km.playing"))) ok(`${what} is turned back: "${said}"`);
        else fail(`${what}: the form said "${said}", playing: ${await page.evaluate("km.playing")}`);
      }
      await shot(page, "key-refused");
      await page.fill("#key", key);
      await page.click("button[type=submit]");
      if (!(await until(page, "km.playing", 15000))) throw new Error("the key from the form didn't start a game");
      ok("the key from the form started a game");
      if ((await page.inputValue("#key")) === "") ok("the key field is cleared once it's sent");
      else fail("the key is still in the field");
    }
    await newGame(page, true);
    await sleep(800);
    await shot(page, "map-morning");
    await press(page, "g");
    await waitFor(page, "The Hanged Clerk ·", "g walks to the granary scene", 60000);
    await waitFor(page, "Kell", "the GM's opening mentions Kell", 150000);
    await waitFor(page, "Say it out loud", "the GM's opening is done", 150000);
    await shot(page, "gm-opening");
    // With the key from the page, a line the cast will remember (without leaving the scene): the GM's
    // notes on it, a background job with the key in its environment, are then likely to be still
    // running when the game ends.
    const line = keyForm
      ? "\"I knew Wendell Prout,\" I tell Kell quietly. \"He owed me forty crowns, and I'm not sorry he's dead.\""
      : "\"Morning, Sergeant. What have we got?\" I look up at the body, then at the boy with the stones.";
    await say(page, line);
    await waitFor(page, line.slice(0, 16).replace(/[".?]/g, "."), "the player's line is in the transcript", 20000);
    await sleep(2000);
    await waitFor(page, "Say it out loud", "the GM replied", 180000);
    await sleep(500);
    await shot(page, "gm-reply");
    if (/couldn't/.test(await text(page))) fail("the GM couldn't answer (look at the screenshot)");
    else ok("a real GM reply, in the browser");
    await press(page, "Control+c");
    await page.waitForSelector("#notice:not([hidden])", { timeout: 15000 }).catch(() => undefined);
    if (page.url().includes(key)) fail("the key is in the page's URL");
  } finally {
    await browser.close();
    // The turn just played has started the GM's notes on it in the background, and they carry the
    // key. --live stops the server as Ctrl+C twice would (the second stops them); --key-form lets
    // them finish while the server waits.
    await server.stop(keyForm ? 200000 : 5000);
    const background = server.log().split("\n").filter(line => /background/.test(line));
    for (const line of background) note(`server: ${line}`);
    if (background.some(line => /background work (finished|was stopped)/.test(line))) ok("the server waited for the game's background jobs before letting it go");
    else note("(no background job was still running when the game ended)");
    const left = leftovers();
    if (left.length) fail(`processes of this run still running after the server stopped: ${left.join(", ")}`);
    else ok("nothing of this run's games, nor of their background jobs, is left after the server stopped");
    const holders = holding(key);
    if (holders.length) fail(`${holders.length} process(es) of this run still hold the key in their environment`);
    else ok("no process of this run holds the key once the server has stopped");
    // The key mustn't come back to the page, nor turn up in the server's output or any file of the run.
    if (received.some(frame => frame.includes(key))) fail("the key came back over the WebSocket");
    else ok(`the key never came back over the WebSocket (${received.length} frames)`);
    if (server.log().includes(key)) fail("the key is in the server's log");
    else ok("the key isn't in the server's log");
    const leaks = filesContaining(OUT, key);
    if (leaks.length) fail(`the key is in ${leaks.length} file(s) of the run: ${leaks.join(", ")}`);
    else ok("the key isn't in any file the run wrote (saves, call logs, screens)");
  }
}

function filesContaining(dir: string, needle: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    if (readFileSync(path).includes(needle)) found.push(path.slice(OUT.length + 1));
  }
  return found;
}

try {
  if (MODE === "offline") await offline();
  else await live(MODE === "key-form");
} catch (error) {
  fail((error as Error).message);
}
writeFileSync(join(OUT, "report.txt"), report.join("\n") + "\n");
console.log(failures ? `${failures} FAILED (screens in ${OUT})` : `PASS (screens in ${OUT})`);
process.exit(failures ? 1 : 0);
