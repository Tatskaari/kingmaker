import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { DEFAULT_BASE, serveStatic } from "./serve.ts";

/**
 * Headless check of the static build (npm run build:web, src/web/README.md): built, served from a
 * plain static file server under /kingmaker/pr-preview/pr-650/ as GitHub Pages serves the PR
 * previews, and played in Chromium with Playwright, the game in the page's Web Worker. Screens go
 * to runs/web-static/<run>/ as PNGs, each with the terminal's text beside it.
 *
 *   node --no-warnings src/web/static/check.ts          the build and what's in it; the title, a new
 *                                                       character and its sheet beside the terminal
 *                                                       app's (runs/app-smoke); the map by keys and by
 *                                                       mouse; a scene offline; latency and bandwidth;
 *                                                       saves kept in IndexedDB through reloads; x x
 *                                                       deleting a game; resizing; the key form
 *                                                       (OpenRouter faked: no key goes anywhere)
 *   node --no-warnings src/web/static/check.ts --live   also the key from ~/secrets typed into the key
 *                                                       form, a real GM reply, and the GM's notes on it
 *                                                       (held back, so Ctrl+C catches them running)
 *                                                       finished and saved before the next game
 *   ... --no-build                                      check the dist/web there is
 *
 * KM_WEB_CHECK_DEBUG=1 prints the page's and the worker's console, and every request.
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DIST = join(ROOT, "dist", "web");
const LIVE = process.argv.includes("--live");
const BUILD = !process.argv.includes("--no-build");
const DEBUG = !!process.env.KM_WEB_CHECK_DEBUG;
const RUN = new Date().toLocaleString("sv").replace(/[-:]/g, "").replace(" ", "-");
const OUT = join(ROOT, "runs", "web-static", `${RUN}${LIVE ? "-live" : ""}`);
const KEY_FILE = join(homedir(), "secrets", "kingmaker-dev-openrouter.txt");
const KEY_STORAGE = "kingmaker.openrouter-api-key";
// The smoke test's terminal size, so the screens line up with runs/app-smoke's.
const COLS = 130;
const ROWS = 42;
// The pinned size plus the page's frame (10px and 8px of padding each side, and the key's line under it) at 9x18 cells.
const VIEWPORT = { width: COLS * 9 + 20, height: ROWS * 18 + 16 + 26 };
// At 130 columns the map's box is everything left of the sidebar (as in src/app/smoke/smoke.py).
const MAP_COLS = 89;
const NAME = "Tamsin Vell";
const CONCEPT = "a disgraced palace auditor with a ledger-keeper's eye and a borrowed rapier";
mkdirSync(OUT, { recursive: true });

let failures = 0;
let shots = 0;
const report: string[] = [];
/** The live key, once read: never printed, nor written to any file (it's masked out of everything this check says). */
let secret = "";
const mask = (text: string) => (secret ? text.split(secret).join("[the key]") : text);

function ok(what: string): void {
  console.log(mask(`ok: ${what}`));
}

function fail(what: string): void {
  failures++;
  console.log(mask(`FAIL: ${what}`));
}

function note(line: string): void {
  console.log(mask(line));
  report.push(mask(line));
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------
// The build, and what's in it

function build(): void {
  const started = performance.now();
  const result = spawnSync(process.execPath, ["--no-warnings", "src/web/static/build.ts"], { cwd: ROOT, encoding: "utf8" });
  const said = `${result.stdout}${result.stderr}`.trim();
  if (result.status === 0) ok(`npm run build:web: ${said.split("\n").at(-1)} (${((performance.now() - started) / 1000).toFixed(1)} s with node's start)`);
  else throw new Error(`the build failed:\n${mask(said)}`);
}

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true }).filter(e => e.isFile()).map(e => join(e.parentPath, e.name));
}

/** What the build put out: the page's files, the game's bundle, the allowlisted content, and nothing secret. */
function inspect(): void {
  const files = filesIn(DIST);
  const top = [...new Set(files.map(f => relative(DIST, f).split("/")[0]!))].sort();
  const expected = ["chunks", "client.js", "content.json", "fonts", "fonts.css", "fonts.json", "index.html", "style.css", "vendor", "worker-transport.js", "worker.js"];
  if (JSON.stringify(top) === JSON.stringify(expected)) ok(`dist/web holds the page, the game's bundle, the fonts and the content, and nothing else (${files.length} files)`);
  else fail(`dist/web's top level: ${top.join(", ")}`);
  const bytes = files.reduce((n, f) => n + statSync(f).size, 0);
  note(`dist/web: ${files.length} files, ${(bytes / 1e6).toFixed(2)} MB`);

  // The content is what the allowlist lets in (lore and prompts as Markdown, the rules' content pack).
  const content = JSON.parse(readFileSync(join(DIST, "content.json"), "utf8")) as { files: Record<string, string> };
  const paths = Object.keys(content.files);
  const strays = paths.filter(p => !/^(lore|prompts)\/[^.][^]*\.md$/.test(p) && p !== "vendor/dnd-srd-engine/starter-pack.json" || p.split("/").some(part => part.startsWith(".")));
  if (!strays.length && paths.length > 50) ok(`content.json holds only allowlisted files (${paths.length}: lore/ and prompts/ Markdown, the rules' starter pack)`);
  else fail(`content.json: ${paths.length} files, outside the allowlist: ${strays.slice(0, 5).join(", ")}`);

  // No secret: as grep -c -F -f ~/secrets/kingmaker-dev-openrouter.txt -r dist/web would look (each line of the file a fixed string).
  if (existsSync(KEY_FILE)) {
    const needles = readFileSync(KEY_FILE, "utf8").split("\n").map(line => line.replace(/\r$/, "")).filter(Boolean);
    const leaks = files.filter(f => { const text = readFileSync(f, "latin1"); return needles.some(n => text.includes(n)); });
    if (leaks.length) fail(`the dev key file's contents are in ${leaks.length} file(s) of dist/web: ${leaks.map(f => relative(DIST, f)).join(", ")}`);
    else ok(`the dev key (~/secrets/kingmaker-dev-openrouter.txt) is in no file of dist/web (${files.length} files searched)`);
  } else note("(no ~/secrets/kingmaker-dev-openrouter.txt on this machine to look for in dist/web)");
  const shaped = files.filter(f => /sk-or-v1-[0-9a-f]{32,}/.test(readFileSync(f, "latin1")));
  if (shaped.length) fail(`something shaped like an OpenRouter key is in ${shaped.map(f => relative(DIST, f)).join(", ")}`);
  else ok("nothing shaped like an OpenRouter key is in dist/web");

  // Only relative URLs, so the site works from the PR preview's path (or any other).
  const html = readFileSync(join(DIST, "index.html"), "utf8");
  const absolute = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1]!).filter(u => u.startsWith("/") || /^https?:/.test(u) && !u.startsWith("https://openrouter.ai"));
  if (!absolute.length) ok("index.html refers to its files by relative URLs");
  else fail(`index.html has absolute URLs: ${absolute.join(", ")}`);
}

// ---------------------------------------------------------------------------------------------
// The page

interface Watch { console: string[]; requests: string[] }

function watch(context: BrowserContext): Watch {
  const seen: Watch = { console: [], requests: [] };
  const line = (where: string, text: string) => {
    seen.console.push(text);
    if (DEBUG) console.log(mask(`  ${where} console: ${text.slice(0, 300)}`));
  };
  context.on("page", page => {
    page.on("console", m => line("page", m.text()));
    page.on("worker", worker => worker.on("console", m => line("worker", m.text())));
  });
  context.on("request", request => {
    seen.requests.push(request.url());
    if (DEBUG) console.log(mask(`  request: ${request.method()} ${request.url().slice(0, 200)}`));
  });
  return seen;
}

async function open(context: BrowserContext, url: string, query: string): Promise<{ page: Page; ms: number }> {
  const page = await context.newPage();
  page.on("pageerror", error => fail(`page error: ${error.message}`));
  const t0 = Date.now();
  await page.goto(`${url}?${query}`);
  if (!(await until(page, "!!window.km", 15000))) throw new Error("the page never set up its terminal");
  return { page, ms: Date.now() - t0 };
}

const text = (page: Page) => page.evaluate("km.text()") as Promise<string>;

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
async function waitFor(page: Page, pattern: string, what: string, timeout = 30000): Promise<number> {
  const t0 = Date.now();
  if (await until(page, `window.km ? new RegExp(${JSON.stringify(pattern)}, "is").test(km.text()) : false`, timeout)) {
    ok(what);
    return Date.now() - t0;
  }
  await shot(page, "failed").catch(() => undefined);
  throw new Error(`${what} (no /${pattern}/ within ${timeout / 1000}s)`);
}

async function shot(page: Page, name: string): Promise<void> {
  shots++;
  const base = join(OUT, `${String(shots).padStart(2, "0")}-${name}`);
  await page.screenshot({ path: `${base}.png` });
  const screen = await text(page).catch(() => "");
  if (secret && screen.includes(secret)) fail(`the key is on the screen (${name})`);
  writeFileSync(`${base}.txt`, mask(screen));
}

async function press(page: Page, ...keys: string[]): Promise<void> {
  for (const key of keys) {
    await page.keyboard.press(key);
    await sleep(120);
  }
}

/** The screen's cells, a character each (the second cell of a wide one is ""), straight from xterm's buffer. */
const cells = (page: Page) =>
  page.evaluate(`(() => {
    const buffer = km.term.buffer.active;
    const rows = [];
    for (let y = 0; y < km.term.rows; y++) {
      const line = buffer.getLine(buffer.viewportY + y);
      const row = [];
      for (let x = 0; x < km.term.cols; x++) row.push(line.getCell(x).getChars() || (line.getCell(x).getWidth() === 0 ? "" : " "));
      rows.push(row);
    }
    return rows;
  })()`) as Promise<string[][]>;

/** Where some text is on the screen (its first cell, from 0), counting cells; with `cols`, only text wholly left of that column. */
async function find(page: Page, what: string, cols = COLS): Promise<{ col: number; row: number } | undefined> {
  const grid = await cells(page);
  for (let row = 0; row < grid.length; row++) {
    const line = grid[row]!.slice(0, cols);
    // The text in cell order, and each character's cell.
    let joined = "";
    const at: number[] = [];
    line.forEach((ch, x) => { if (ch) { joined += ch; for (let i = 0; i < ch.length; i++) at.push(x); } });
    const i = joined.indexOf(what);
    if (i >= 0) return { col: at[i]!, row };
  }
  return undefined;
}

async function cellBox(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  return page.evaluate(`(() => {
    const r = document.querySelector(".xterm-screen").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width / km.term.cols, h: r.height / km.term.rows };
  })()`) as Promise<{ x: number; y: number; w: number; h: number }>;
}

async function mouseAt(page: Page, col: number, row: number, action: "move" | "left" | "right"): Promise<void> {
  const cell = await cellBox(page);
  const x = cell.x + (col + 0.5) * cell.w, y = cell.y + (row + 0.5) * cell.h;
  if (action === "move") await page.mouse.move(x, y);
  else await page.mouse.click(x, y, { button: action });
}

/** Clicks the middle of where `what` first shows on the screen. */
async function clickOn(page: Page, what: string, button: "left" | "right" = "left"): Promise<void> {
  const at = await find(page, what);
  if (!at) throw new Error(`"${what}" isn't on the screen to click`);
  await mouseAt(page, at.col + Math.floor(what.length / 2), at.row, button);
}

function changed(a: string, b: string): number {
  let count = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) count++;
  return count;
}

// ---------------------------------------------------------------------------------------------
// The saves, as the worker keeps them in IndexedDB (read from the page: the same origin)

interface Saved { path: string; data: string; mtimeMs: number }

const SAVES = `(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("kingmaker-v2", 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("files")) request.result.createObjectStore("files", { keyPath: "path" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("files").objectStore("files").getAll();
      const latin1 = new TextDecoder("latin1");
      request.onsuccess = () => resolve(request.result.map(f => ({ path: f.path, data: typeof f.data === "string" ? f.data : latin1.decode(f.data), mtimeMs: f.mtimeMs })));
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
})()`;

const saves = (page: Page) => page.evaluate(SAVES) as Promise<Saved[]>;

/** Games kept in IndexedDB: runs/sessions/<id>/game.json, by id. */
async function games(page: Page): Promise<Map<string, { mode: string; at?: { map: string; x: number; y: number }; mtimeMs: number }>> {
  const found = new Map<string, { mode: string; at?: { map: string; x: number; y: number }; mtimeMs: number }>();
  for (const file of await saves(page)) {
    const id = /\/runs\/sessions\/([^/]+)\/game\.json$/.exec(file.path)?.[1];
    if (!id) continue;
    const game = JSON.parse(file.data) as { mode: string; explore?: { ex?: { map: string; at: { x: number; y: number } } } };
    const ex = game.explore?.ex;
    found.set(id, { mode: game.mode, at: ex ? { map: ex.map, x: ex.at.x, y: ex.at.y } : undefined, mtimeMs: file.mtimeMs });
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// Beside the terminal app

/** The smoke test's latest screens (python3 src/app/smoke/smoke.py), if there are any here. */
function smokeScreens(): string | undefined {
  const dir = join(ROOT, "runs", "app-smoke");
  if (!existsSync(dir)) return undefined;
  const runs = readdirSync(dir).filter(run => existsSync(join(dir, run, "03-the-rules-engine-made-a-sheet.txt"))).sort();
  return runs.length ? join(dir, runs.at(-1)!) : undefined;
}

/** The title's taglines (src/app/ui/title.tsx): it picks one at random each time it starts, so that row may differ. */
const TAGLINES = [...(/const TAGLINES = \[([^]*?)\];/.exec(readFileSync(join(ROOT, "src/app/ui/title.tsx"), "utf8"))?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(m => m[1]!);

const normalize = (screen: string) =>
  screen.split("\n").map(line => (TAGLINES.includes(line.trim()) ? "(a tagline)" : line.trimEnd())).join("\n").replace(/\n+$/, "");

/** The screen's text must be the terminal app's, as the smoke test saw it at the same size (only the title's tagline may differ). */
async function same(page: Page, smoke: string | undefined, file: string, what: string): Promise<void> {
  if (!smoke) {
    note(`(no smoke-test screens here to compare ${what} with: python3 src/app/smoke/smoke.py writes them)`);
    return;
  }
  const want = normalize(readFileSync(join(smoke, file), "utf8"));
  let got = "";
  for (let i = 0; i < 15; i++) {
    got = normalize(await text(page));
    if (got === want) break;
    await sleep(200);
  }
  if (got === want) {
    ok(`${what}: the same text as the terminal app's at ${COLS}x${ROWS} (${relative(ROOT, join(smoke, file))})`);
    return;
  }
  const a = got.split("\n"), b = want.split("\n");
  const rows = [...Array(Math.max(a.length, b.length)).keys()].filter(i => a[i] !== b[i]);
  writeFileSync(join(OUT, `differs-${file}`), mask(got));
  fail(`${what} isn't the terminal app's: ${rows.length} rows differ, first row ${rows[0]}: "${a[rows[0]!]?.trim()}" here, "${b[rows[0]!]?.trim()}" in the terminal`);
}

/** The title, a new character and its sheet, side by side with the terminal app's (ASCII glyphs, as the smoke test plays); then the map by mouse. */
async function besideTheTerminal(browser: Browser, url: string): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  watch(context);
  try {
    const smoke = smokeScreens();
    const { page } = await open(context, url, `offline&size=${COLS}x${ROWS}&glyphs=ascii`);
    await waitFor(page, "Hanged Clerk of Caerwyn", "the title screen (ASCII glyphs, as the smoke test plays)");
    await same(page, smoke, "01-title-screen.txt", "the title screen");
    await clickOn(page, "New game");
    await waitFor(page, "Who are you\\?", "a click on New game: character creation");
    await same(page, smoke, "02-character-creation.txt", "character creation");
    await page.keyboard.type(NAME, { delay: 15 });
    await press(page, "Enter");
    await page.keyboard.type(CONCEPT, { delay: 5 });
    await press(page, "Enter");
    await waitFor(page, "Character sheet.*AC \\d+", "the rules engine (in the worker) made a sheet", 90000);
    await same(page, smoke, "03-the-rules-engine-made-a-sheet.txt", "the character sheet");
    await shot(page, "sheet-ascii");
    await press(page, "Enter");
    await waitFor(page, "The lead:.*Hanged Clerk", "exploring Caerwyn, the lead is the hanged clerk");
    await waitFor(page, "Sergeant Kell", "Kell is about");

    // The map by mouse, as the smoke test plays it: pointing at Kell, a click to walk along the lane, a right-click for a menu.
    const kell = await find(page, "K", MAP_COLS);
    if (!kell) throw new Error("Kell's K isn't on the map");
    await mouseAt(page, kell.col, kell.row, "move");
    await waitFor(page, "Sergeant Kell \\S+ \\d+ +· +click to walk there", "pointing at Kell says who she is and what a click does");
    let start: { map: string; x: number; y: number } | undefined;
    for (let i = 0; i < 30 && !start; i++) { start = [...(await games(page)).values()][0]?.at; if (!start) await sleep(200); }
    if (!start) throw new Error("no game in IndexedDB to read where the player stands");
    const me = await find(page, "@", MAP_COLS);
    if (!me) throw new Error("the player's @ isn't on the map");
    // The map's projection (as smoke.py's on_screen): column 2(x + y), row y - x, from where the @ is.
    const from = start;
    const onScreen = (x: number, y: number) => ({ col: me.col + 2 * (x - from.x + (y - from.y)), row: me.row + (y - from.y - (x - from.x)) });
    const target = { x: 38, y: 8 };
    const there = onScreen(target.x, target.y);
    await mouseAt(page, there.col, there.row, "left");
    let now: { map: string; x: number; y: number } | undefined = start;
    for (let i = 0; i < 50 && !(now?.x === target.x && now?.y === target.y); i++) {
      await sleep(200);
      now = [...(await games(page)).values()][0]?.at;
    }
    await shot(page, "left-click-walk");
    if (now?.x === target.x && now?.y === target.y) ok(`a left click on the lane walks there (from ${start.x},${start.y} to ${now.x},${now.y}, as the save in IndexedDB says)`);
    else fail(`a left click on the lane: the save has the player at ${now?.x},${now?.y}, not ${target.x},${target.y}`);
    const street = { col: there.col - 4, row: there.row };
    await mouseAt(page, street.col, street.row, "right");
    await waitFor(page, "Walk here", "a right-click on the street opens its menu");
    await shot(page, "right-click-street");
    await press(page, "Escape");
    await sleep(400);
    if (/Esc never mind/.test(await text(page))) fail("Esc didn't close the street's menu");
    else ok("Esc closes the menu");
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Playing, as a player would: keys, the menus, a scene offline, saves through reloads, deleting

// Keypress to the screen, from the browser's keydown, to the next animation frame after xterm's draw (as src/web/check.ts measures it).
const PROBE = `(() => {
  if (window.probe) return;
  const probe = window.probe = { samples: [], pending: null };
  document.addEventListener("keydown", event => {
    if (!probe.armed) return;
    probe.armed = false;
    probe.pending = { t0: event.timeStamp, before: km.text() };
  }, true);
  km.term.onRender(() => {
    const p = probe.pending;
    if (!p) return;
    const now = km.text();
    let changed = 0;
    for (let i = 0; i < now.length && changed < 20; i++) if (now[i] !== p.before[i]) changed++;
    if (changed < 20) return;
    probe.pending = null;
    requestAnimationFrame(() => probe.samples.push(performance.now() - p.t0));
  });
})()`;

async function latency(page: Page, keys: string[], gap: number): Promise<number[]> {
  await page.evaluate(PROBE);
  await page.evaluate("probe.samples = []");
  for (const key of keys) {
    await page.evaluate("probe.armed = true; probe.pending = null");
    await page.keyboard.press(key);
    await sleep(gap);
  }
  return page.evaluate("probe.samples") as Promise<number[]>;
}

function summary(values: number[]): string {
  if (!values.length) return "no samples";
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return `median ${at(0.5).toFixed(0)} ms, p90 ${at(0.9).toFixed(0)} ms, min ${sorted[0]!.toFixed(0)}, max ${sorted[sorted.length - 1]!.toFixed(0)} (n=${values.length})`;
}

interface Traffic { toPage: number; frames: number; renderMs: number; slowestMs: number; messagesIn: number }

/** What the worker has sent the page, and its frames (km.serverStats() asks the worker in the static build). */
const traffic = (page: Page) =>
  page.evaluate(`km.serverStats().then(s => ({ toPage: s.toPage, frames: s.frames, renderMs: s.renderMs, slowestMs: s.slowestMs, messagesIn: km.stats.messagesIn }))`) as Promise<Traffic>;

async function rate(page: Page, what: string, during: () => Promise<void>): Promise<void> {
  const before = await traffic(page);
  const started = Date.now();
  await during();
  const after = await traffic(page);
  const elapsed = (Date.now() - started) / 1000;
  const frames = after.frames - before.frames;
  note(`bandwidth, ${what} (${elapsed.toFixed(1)}s): ${((after.toPage - before.toPage) / 1000 / elapsed).toFixed(1)} KB/s from the game to the page, ${((after.messagesIn - before.messagesIn) / elapsed).toFixed(1)} messages/s; ${(frames / elapsed).toFixed(1)} frames/s in the worker, ${(frames ? (after.renderMs - before.renderMs) / frames : 0).toFixed(1)} ms a frame (the slowest yet ${after.slowestMs.toFixed(0)} ms)`);
}

async function newGame(page: Page, live: boolean): Promise<void> {
  await press(page, "n");
  await waitFor(page, "Who are you\\?", "n: character creation");
  await page.keyboard.type(NAME, { delay: 15 });
  // Tab moves to the concept (the browser mustn't take it for focus).
  await press(page, "Tab");
  await page.keyboard.type(CONCEPT, { delay: 5 });
  await sleep(300);
  if ((await text(page)).includes("ledger-keeper")) ok("Tab reached the game: the concept went into its own field");
  else fail("Tab didn't move to the concept field");
  await press(page, "Enter");
  await waitFor(page, "Character sheet.*AC \\d+", "the rules engine made a sheet", live ? 150000 : 90000);
  await sleep(300);
  await shot(page, "sheet");
  await press(page, "Enter");
  await waitFor(page, "The lead:.*Hanged Clerk", "exploring Caerwyn, the lead is the hanged clerk");
}

async function play(browser: Browser, url: string): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const seen = watch(context);
  try {
    const { page, ms } = await open(context, url, `offline&size=${COLS}x${ROWS}`);
    const toTitle = ms + await waitFor(page, "Hanged Clerk of Caerwyn", "the title screen, the game in a Web Worker");
    note(`time to the title screen, a first visit (nothing cached): ${toTitle} ms`);
    const renderer = await page.evaluate("km.renderer");
    if (renderer === "webgl") ok("the WebGL renderer is drawing");
    else fail(`renderer is ${renderer}, not webgl`);
    if (!(await page.evaluate("km.static"))) fail("the page doesn't know it's the static build");
    await sleep(300);
    await shot(page, "title");
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

    // Right-click is the game's: someone in Nearby gets its menu, and the browser's own menu doesn't come up.
    await page.evaluate(`window.unprevented = 0;
      document.addEventListener("contextmenu", event => { if (!event.defaultPrevented) window.unprevented++; })`);
    await clickOn(page, "Sergeant Kell", "right");
    await waitFor(page, "Talk.*Esc never mind", "right-clicking Kell in Nearby opens the game's menu");
    await shot(page, "right-click");
    if (await page.evaluate("window.unprevented")) fail("the browser's own menu came up on a right-click");
    else ok("the browser's own menu stayed down");
    await press(page, "Escape");
    await sleep(300);
    if (/Esc never mind/.test(await text(page))) fail("Esc didn't close the right-click menu");

    // Overlays and the menu: c, ?, Esc.
    await press(page, "c");
    await waitFor(page, "Character sheet.*Saving throws.*Skills", "c opens the sheet");
    await press(page, "Escape");
    await press(page, "?");
    await waitFor(page, "How to play", "? opens the help");
    await shot(page, "help");
    await press(page, "Escape");
    await press(page, "Escape");
    await waitFor(page, "Save and quit", "Esc opens the menu");
    await press(page, "Escape");
    await sleep(500);

    // Keypress to the screen, the game in the worker.
    const steps = await latency(page, Array.from({ length: 16 }, (_, i) => (i % 2 ? "ArrowRight" : "ArrowLeft")), 400);
    note(`latency, a step on the map, keydown to on screen: ${summary(steps)}`);
    const sheets = await latency(page, Array.from({ length: 10 }, (_, i) => (i % 2 ? "Escape" : "c")), 400);
    note(`latency, opening and closing the sheet, keydown to on screen: ${summary(sheets)}`);
    if (steps.length >= 8) ok("latency measured");
    else fail(`only ${steps.length} of 16 steps changed the screen`);

    // Bandwidth on the map, page and worker (what the game draws, as the server check measures it from the pty): still, then walking four steps a second.
    await sleep(1000);
    await rate(page, "the map idle", () => sleep(10000));
    await rate(page, "walking 4 steps/s", async () => {
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press(i % 2 ? "ArrowRight" : "ArrowLeft");
        await sleep(250);
      }
    });

    // The granary scene, a step at a time with g. Offline the GM can't speak.
    await press(page, "g");
    await waitFor(page, "The Hanged Clerk ·", "g walks to the lead and the granary scene opens", 60000);
    await waitFor(page, "couldn't open the scene", "offline: the GM can't speak (expected)", 40000);
    await sleep(500);
    await shot(page, "granary-scene");

    // Ctrl+C saves and quits; the page says so, and the game is in IndexedDB.
    await press(page, "Control+c");
    try {
      await page.waitForSelector("#notice:not([hidden])", { timeout: 15000 });
      ok(`Ctrl+C ends the game and the page says so ("${await page.textContent("#notice-text")}")`);
    } catch {
      fail("no notice after Ctrl+C");
    }
    await shot(page, "closed");
    const kept = await games(page);
    const [id, game] = [...kept.entries()][0] ?? [];
    if (kept.size === 1 && game?.mode === "scene") ok(`the game is kept in IndexedDB, in its scene (runs/sessions/${id}/game.json, ${(await saves(page)).length} files)`);
    else fail(`IndexedDB holds ${kept.size} game(s)${game ? `, in mode ${game.mode}` : ""}`);

    // A reload: Continue is there, from IndexedDB, and resumes the scene.
    const t1 = Date.now();
    await page.reload();
    const toTitleAgain = (Date.now() - t1) + await waitFor(page, "Continue.*Tamsin Vell", "after a reload, Continue is offered (the saves came back from IndexedDB)");
    note(`time to the title screen, a reload (cached): ${toTitleAgain} ms`);
    await shot(page, "continue");
    await press(page, "Enter");
    await waitFor(page, "The Hanged Clerk ·", "Continue resumed the granary scene where Ctrl+C left it", 30000);

    // A reload mid-game, without Ctrl+C: what was played is kept (written through as it goes, and saved as the page goes).
    await sleep(1500);
    const midgame = (await games(page)).get(id!)?.mtimeMs ?? 0;
    await page.reload();
    await waitFor(page, "Continue.*Tamsin Vell", "a reload mid-game: the game is still offered");
    const after2 = (await games(page)).get(id!)?.mtimeMs ?? 0;
    if (after2 >= midgame) ok("and its save is no older than before the reload");
    else fail("the save went back in time over a reload");

    // x deletes a game (x again to be sure); its folder goes to runs/deleted/.
    await press(page, "x");
    await waitFor(page, "Delete this game\\?.*x again deletes it", "x on a game asks before deleting it");
    await shot(page, "delete-asks");
    await press(page, "Escape");
    await waitFor(page, "Continue.*Tamsin Vell", "any other key keeps it");
    await press(page, "x");
    await waitFor(page, "x again deletes it", "x asks again");
    await press(page, "x");
    await sleep(800);
    const title = await text(page);
    await shot(page, "deleted");
    if (!/Tamsin Vell/.test(title) && /New game/.test(title)) ok("x again deletes it: the title no longer offers the game");
    else fail("the game is still on the title after x x");
    await page.evaluate("km.flush()");
    const files = await saves(page);
    const live = files.filter(f => f.path.includes(`/runs/sessions/${id}/`));
    const binned = files.filter(f => f.path.includes(`/runs/deleted/${id}/`));
    if (!live.length && binned.some(f => f.path.endsWith("/game.json"))) ok(`its folder moved to runs/deleted/ in IndexedDB (${binned.length} files)`);
    else fail(`after deleting: ${live.length} files left in runs/sessions/${id}/, ${binned.length} in runs/deleted/${id}/`);
    await page.reload();
    await waitFor(page, "Hanged Clerk of Caerwyn", "after another reload");
    if (/Tamsin Vell/.test(await text(page))) fail("the deleted game came back after a reload");
    else ok("the deleted game stays deleted over a reload");

    const outside = seen.requests.filter(r => r.startsWith("http://127.0.0.1") && !new URL(r).pathname.startsWith(DEFAULT_BASE));
    if (!outside.length) ok(`every request stayed under ${DEFAULT_BASE} (${seen.requests.length} requests)`);
    else fail(`requests outside the preview's path: ${outside.join(", ")}`);
    const away = seen.requests.filter(r => !r.startsWith("http://127.0.0.1") && !r.startsWith("data:"));
    if (!away.length) ok("offline, nothing was asked of any other site");
    else fail(`offline, requests went elsewhere: ${away.join(", ")}`);
  } finally {
    await context.close();
  }
}

/** Resize follows the browser: an unpinned page fits the window, and the game in the worker redraws to it. */
async function resize(browser: Browser, url: string): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  watch(context);
  try {
    const { page } = await open(context, url, "offline");
    await waitFor(page, "Hanged Clerk of Caerwyn", "an unpinned page");
    const size1 = (await page.evaluate("[km.term.cols, km.term.rows]")) as number[];
    await page.setViewportSize({ width: 1000, height: 640 });
    await sleep(1200);
    const size2 = (await page.evaluate("[km.term.cols, km.term.rows]")) as number[];
    const lines = (await text(page)).split("\n");
    const widest = Math.max(...lines.map(line => [...line].length));
    if (size1[0] !== size2[0] && lines.length === size2[1] && widest <= size2[0]! && /Hanged Clerk/.test(lines.join("\n"))) ok(`resize follows the window: ${size1.join("x")} -> ${size2.join("x")}, and the game redrew at the new size (its text is ${widest} columns at most)`);
    else fail(`resize: ${size1.join("x")} -> ${size2.join("x")}, ${lines.length} lines of up to ${widest} columns`);
    await shot(page, "resized");
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------
// The key form: OpenRouter faked here, so no key goes anywhere

const FAKE_KEY = `sk-or-v1-${"0123456789abcdef".repeat(4)}`;

async function keyForm(browser: Browser, url: string): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const seen = watch(context);
  const asked: string[] = [];
  let accept = false;
  await context.route("https://openrouter.ai/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const known = request.headers()["authorization"] === `Bearer ${FAKE_KEY}` && accept;
    asked.push(`${request.method()} ${path}${known ? "" : " (refused)"}`);
    if (path === "/api/v1/key" && known) return route.fulfill({ status: 200, contentType: "application/json", body: '{"data":{"label":"the check\'s fake"}}' });
    return route.fulfill({ status: 401, contentType: "application/json", body: '{"error":{"message":"User not found.","code":401}}' });
  });
  try {
    const { page } = await open(context, url, `size=${COLS}x${ROWS}`);
    await page.waitForSelector("#gate:not([hidden])", { timeout: 10000 });
    ok("with no key kept in this browser, the page asks for one");
    await shot(page, "key-form");
    for (const [what, wrong, expected] of [
      ["a malformed key", "not a key", /doesn't look like an OpenRouter key/],
      ["an OpenAI key", `sk-proj-${"Xy7".repeat(16)}`, /looks like an OpenAI key/],
      ["an OpenRouter key OpenRouter doesn't know", FAKE_KEY, /OpenRouter didn't accept that key/],
    ] as const) {
      await page.fill("#key", wrong);
      await page.click("button[type=submit]");
      const said = (await until(page, `(() => { const e = document.getElementById("key-error"); return !e.hidden && !document.getElementById("key").disabled; })()`, 15000))
        ? await page.textContent("#key-error")
        : "(no answer)";
      if (expected.test(said ?? "") && !(await page.evaluate("km.playing"))) ok(`${what} is turned back: "${said}"`);
      else fail(`${what}: the form said "${said}", playing: ${await page.evaluate("km.playing")}`);
    }
    if (await page.evaluate(`localStorage.getItem(${JSON.stringify(KEY_STORAGE)})`)) fail("a refused key was kept");
    // Typed in as a player would; OpenRouter (faked) knows it now.
    accept = true;
    await page.locator("#key").pressSequentially(FAKE_KEY, { delay: 5 });
    await page.click("button[type=submit]");
    if (!(await until(page, "km.playing", 15000))) throw new Error("the key from the form didn't start a game");
    await waitFor(page, "Hanged Clerk of Caerwyn", "the key from the form started a game");
    await sleep(500);
    await shot(page, "key-kept");
    const stored = await page.evaluate(`localStorage.getItem(${JSON.stringify(KEY_STORAGE)})`);
    if (stored === FAKE_KEY) ok(`the key is kept in localStorage ("${KEY_STORAGE}")`);
    else fail("the key isn't in localStorage");
    if ((await page.inputValue("#key")) === "") ok("the key field is cleared once it's sent");
    else fail("the key is still in the field");
    if (!page.url().includes(FAKE_KEY) && !seen.requests.some(r => r.includes(FAKE_KEY))) ok("the key is in no URL (the page's, or any request's)");
    else fail("the key is in a URL");
    if (!seen.console.some(line => line.includes(FAKE_KEY))) ok(`the key is in no console line of the page or the worker (${seen.console.length} lines)`);
    else fail("the key is in the console");
    if (!(await saves(page)).some(f => f.data.includes(FAKE_KEY))) ok("the key is in none of the game's files in IndexedDB");
    else fail("the key is in IndexedDB");
    note(`OpenRouter (faked) was asked: ${[...new Set(asked)].join("; ")}`);
    if (asked.includes("GET /api/v1/key")) ok("the key was checked with OpenRouter before it was kept");
    const bar = await page.innerText("#key-bar");
    if (/kept in this browser.*Change key.*Forget it/s.test(bar)) ok(`the bar under the game says so, and offers to change or forget it ("${bar.replace(/\s+/g, " ").trim()}")`);
    else fail(`the key's bar: "${bar}"`);

    // Forget it: the game saves and goes, and the page asks again.
    await page.click("#key-bar [data-forget]");
    await page.waitForSelector("#gate:not([hidden])", { timeout: 15000 });
    if (!(await page.evaluate(`localStorage.getItem(${JSON.stringify(KEY_STORAGE)})`))) ok("Forget it: the key is gone from localStorage and the page asks for one again");
    else fail("Forget it left the key in localStorage");
    await page.click("#offline");
    await waitFor(page, "Hanged Clerk of Caerwyn", "Look around offline starts the game without a key");
    const offlineBar = await page.innerText("#key-bar");
    if (/Offline.*Enter a key/s.test(offlineBar) && !/Forget/.test(offlineBar)) ok(`offline, the bar offers a key ("${offlineBar.replace(/\s+/g, " ").trim()}")`);
    else fail(`offline, the key's bar: "${offlineBar}"`);
    await shot(page, "offline-bar");
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Live: the key from ~/secrets typed into the form, and a real GM reply

async function live(browser: Browser, url: string): Promise<void> {
  secret = readFileSync(KEY_FILE, "utf8").trim();
  const context = await browser.newContext({ viewport: VIEWPORT });
  const seen = watch(context);
  const streamed: string[] = [];
  context.on("response", response => {
    if (response.url().startsWith("https://openrouter.ai/api/v1/responses")) streamed.push(response.headers()["content-type"] ?? "");
  });
  try {
    // The background jobs held back 5 s (?jobdelay), so the GM's notes on the turn are still to come when Ctrl+C closes the game.
    const { page } = await open(context, url, `size=${COLS}x${ROWS}&jobdelay=5000`);
    await page.waitForSelector("#gate:not([hidden])", { timeout: 10000 });
    ok("the page asks for a key");
    await page.locator("#key").pressSequentially(secret, { delay: 5 });
    await page.click("button[type=submit]");
    if (!(await until(page, "km.playing", 20000))) throw new Error("the key from the form didn't start a game");
    ok("OpenRouter accepted the key from the form, and the game started");
    if ((await page.evaluate(`localStorage.getItem(${JSON.stringify(KEY_STORAGE)})`)) === secret) ok("the key is kept in localStorage");
    else fail("the key isn't in localStorage");
    await waitFor(page, "Hanged Clerk of Caerwyn", "the title screen");
    await newGame(page, true);
    await sleep(800);
    await shot(page, "live-map");
    await press(page, "g");
    await waitFor(page, "The Hanged Clerk ·", "g walks to the granary scene", 60000);
    await waitFor(page, "Kell", "the GM's opening mentions Kell", 150000);
    await waitFor(page, "Say it out loud", "the GM's opening is done", 150000);
    await shot(page, "gm-opening");
    const line = "\"Morning, Sergeant. What have we got?\" I look up at the body, then at the boy with the stones.";
    await waitFor(page, "Say it out loud", "the input is ready", 150000);
    await page.keyboard.type(line, { delay: 8 });
    await sleep(150);
    await press(page, "Enter");
    await waitFor(page, "Morning, Sergea", "the player's line is in the transcript", 20000);
    await sleep(2000);
    await waitFor(page, "Say it out loud", "the GM replied", 180000);
    const reply = await text(page);
    await shot(page, "gm-reply");
    // Ctrl+C straight after the reply: the GM's notes on the turn (the scene CLI's remember job, in
    // the worker) are still to be written. The worker finishes them before it goes, and Play again
    // waits for that, so the next game reads them.
    await press(page, "Control+c");
    if (/couldn't/.test(reply)) fail("the GM couldn't answer (look at the screenshot)");
    else ok("a real GM reply, in the browser, from the worker");
    if (streamed.length && streamed.some(type => type.includes("text/event-stream"))) ok(`the GM's calls came back streamed (${streamed.length} calls; ${[...new Set(streamed)].join(", ")})`);
    else note(`the GM's calls as Playwright saw them: ${streamed.length} (${[...new Set(streamed)].join(", ")})`);
    await page.waitForSelector("#notice:not([hidden])", { timeout: 20000 });
    ok("Ctrl+C ends the game and the page says so");
    const finishing = await page.evaluate("km.finishing()");
    await page.click("#notice-button");
    if (finishing) {
      const said = await page.textContent("#notice-text");
      if (/Finishing the GM's notes/.test(said ?? "")) ok(`the GM's notes on the last turn were still being written, and Play again waits for them ("${said}")`);
      else fail(`Play again while the notes were being written: "${said}"`);
    } else fail("the GM's notes on the last turn were done before Ctrl+C, though they were held back 5 s");
    await waitFor(page, "Continue.*Tamsin Vell", "Play again: Continue is offered", 200000);
    const files = await saves(page);
    const names = files.map(f => f.path.replace(/^\/kingmaker\/runs\/sessions\/[^/]+\//, ""));
    note(`IndexedDB holds the game's files: ${names.join(", ")}`);
    const locks = names.filter(n => /\.lock$/.test(n));
    if (!locks.length) ok("no background job was left half-done (no lock files in the saves)");
    else fail(`background jobs left half-done: ${locks.join(", ")}`);
    if (names.some(n => n.endsWith("memory-reviews.jsonl"))) ok("the GM's notes on the turn ran in the worker and were saved (memory-reviews.jsonl)");
    else fail("no memory review of the turn in the saves");
    const calls = files.filter(f => f.path.endsWith("/calls.jsonl")).flatMap(f => f.data.split("\n").filter(Boolean).map(line => { try { return String((JSON.parse(line) as { operation?: string }).operation ?? "?"); } catch { return "?"; } }));
    note(`the game's model calls (calls.jsonl): ${calls.length}, ${[...new Set(calls)].join(", ")}`);
    if (!files.some(f => f.data.includes(secret))) ok("the key is in none of the game's files in IndexedDB (saves, call logs)");
    else fail(`the key is in ${files.filter(f => f.data.includes(secret)).length} file(s) in IndexedDB`);
    if (!page.url().includes(secret) && !seen.requests.some(r => r.includes(secret))) ok(`the key is in no URL (the page's, or any of ${seen.requests.length} requests')`);
    else fail("the key is in a URL");
    if (!seen.console.some(l => l.includes(secret))) ok(`the key is in no console line of the page or the worker (${seen.console.length} lines)`);
    else fail("the key is in the console");
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------

const server = await (async () => {
  if (BUILD) build();
  if (!existsSync(join(DIST, "index.html"))) throw new Error("no dist/web: npm run build:web first");
  inspect();
  return serveStatic(DIST, DEFAULT_BASE);
})();
note(`dist/web served on ${server.url}`);
const browser = await chromium.launch();
try {
  await besideTheTerminal(browser, server.url);
  await play(browser, server.url);
  await resize(browser, server.url);
  await keyForm(browser, server.url);
  if (LIVE) await live(browser, server.url);
} catch (error) {
  fail((error as Error).message);
} finally {
  await browser.close();
  server.server.close();
}
// Nothing this run wrote holds the key.
if (secret) {
  const leaks = filesIn(OUT).filter(f => readFileSync(f).includes(secret));
  if (leaks.length) fail(`the key is in ${leaks.length} file(s) the check wrote`);
  else ok("the key isn't in any file the check wrote (screens and their text)");
}
writeFileSync(join(OUT, "report.txt"), report.join("\n") + "\n");
console.log(failures ? `${failures} FAILED (screens in ${OUT})` : `PASS (screens in ${OUT})`);
process.exit(failures ? 1 : 0);
