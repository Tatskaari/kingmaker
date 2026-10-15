import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { OVERLAY_OSC } from "../../game/look/door-art.ts";
import { doorsDrawn, doorsSeen, doorSync, placed, placement, watchDoorSync, type DoorsSeen, type Placement } from "../doors-check.ts";
import { lampPicture, lampShown, lampsSeen } from "../lamps-check.ts";
import { LANE_LAMP, laneGame } from "./lane.ts";
import { allowed, CONTENT } from "./content.ts";
import { dbName } from "./persist.ts";
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
 *                                                       mouse; copying; a scene offline; latency and
 *                                                       bandwidth; a problem reported (/report) and
 *                                                       its report downloaded and read back; saves
 *                                                       kept in IndexedDB through reloads; x x
 *                                                       deleting a game; the zoo (a sign,
 *                                                       an exhibit, a spell's SRD page, the action
 *                                                       menu, from above); the doors drawn as
 *                                                       pictures (on the right cells at 1x and 2x,
 *                                                       in step with the frames, under a menu, a
 *                                                       Fireball breaking one; ?doors=off); resizing; one
 *                                                       tab at a time; a browser that won't keep
 *                                                       anything; the key form (OpenRouter faked: no
 *                                                       key goes anywhere, a report from the title
 *                                                       included)
 *   node --no-warnings src/web/static/check.ts --live   also the key from ~/secrets typed into the key
 *                                                       form, the suggested lines after the opening, a
 *                                                       real GM reply, and the GM's notes on it
 *                                                       (held back, so Ctrl+C catches them running)
 *                                                       finished and saved before the next game
 *   ... --no-build                                      check the dist/web there is
 *
 * The lamp posts are checked after the doors: drawn as pictures on the right cells at 1x and 2x, by
 * day and at night, held still while you are, lit by Light from the action menu, and left to the
 * ASCII with ?lamps=off and ?doors=off.
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
/** The smoke test's backstory (src/app/smoke/smoke.py's BACKSTORY), so the screens can be the same. */
const BACKSTORY = "I kept a grain factor's books on the wharves for nine years, until the night the sums came out too right. I owe Fat Jory three crowns.";
/** The lore check's panel, as a regex in the page: a fix on show (the first look's, or the second's, after the fixes). */
const LORE_PANEL = String.raw`/The lore check[^\n]*?: \d+ of \d+[\s\S]*?Your story says: [^\n│]*/`;
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
  const expected = ["chunks", "client.js", "content.json", "doors.js", "fonts", "fonts.css", "fonts.json", "index.html", "style.css", "vendor", "worker-transport.js", "worker.js"];
  if (JSON.stringify(top) === JSON.stringify(expected)) ok(`dist/web holds the page, the game's bundle, the fonts and the content, and nothing else (${files.length} files)`);
  else fail(`dist/web's top level: ${top.join(", ")}`);
  const bytes = files.reduce((n, f) => n + statSync(f).size, 0);
  note(`dist/web: ${files.length} files, ${(bytes / 1e6).toFixed(2)} MB`);

  // The content is what the allowlist lets in (content.ts: lore and prompts as Markdown, the rules' content pack, the SRD's spells).
  const content = JSON.parse(readFileSync(join(DIST, "content.json"), "utf8")) as { files: Record<string, string> };
  const paths = Object.keys(content.files);
  const strays = paths.filter(p => !allowed(p));
  if (!strays.length && paths.length > 50) ok(`content.json holds only allowlisted files (${paths.length}: ${CONTENT.map(c => c.what).join(", ")})`);
  else fail(`content.json: ${paths.length} files, outside the allowlist: ${strays.slice(0, 5).join(", ")}`);
  // Each kind there: without one, the game goes without (the SRD's words on the sheet's spell pages, say) and says nothing.
  const absent = CONTENT.filter(c => !paths.some(p => p.startsWith(`${c.dir}/`)));
  if (!absent.length) ok("every kind of content the allowlist names is in it");
  else fail(`content.json has nothing of ${absent.map(c => c.what).join(", ")}`);

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

  // The build's stamp on what isn't named by its hash, and the list of what to load at once (each there to load).
  const stamp = /<html[^>]* data-build="([0-9a-f]{12})"/.exec(html)?.[1];
  const preload = (/<meta name="km-preload" content="([^"]*)">/.exec(html)?.[1] ?? "").split(/\s+/).filter(Boolean);
  const missing = preload.filter(path => !existsSync(join(DIST, path.replace(/\?.*$/, ""))));
  const stamped = ["client.js", "style.css", "fonts.css", "vendor/xterm.css"].every(file => html.includes(`"${file}?v=${stamp}"`));
  if (stamp && stamped && preload.includes(`worker.js?v=${stamp}`) && preload.includes(`content.json?v=${stamp}`) && preload.length >= 5 && !missing.length) {
    ok(`the build's stamp (${stamp}) is on the page's files, and it lists the ${preload.length} files the game loads at once, all there`);
  } else fail(`the build's stamp: ${stamp}; the page's files stamped: ${stamped}; preloads ${preload.join(" ")}${missing.length ? `, missing ${missing.join(", ")}` : ""}`);
  const client = readFileSync(join(DIST, "client.js"), "utf8");
  if (/from "\.\/vendor\/xterm\.mjs\?v=/.test(client) && client.includes(`from "./doors.js?v=${stamp}"`)) ok("client.js asks for xterm.js and the doors' pictures (doors.js) with the stamp too");
  else fail("client.js's imports aren't stamped");
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

/**
 * Report a problem (b, or /report in a scene): what went wrong, typed and sent; the report the
 * browser downloads (kingmaker-report-<time>.json.gz), saved beside the screens and read back; and
 * the game and the bar under it saying so. Enter puts it away.
 */
async function reportProblem(page: Page, how: string, words: string, what: string): Promise<{ file: string; dump: Record<string, unknown>; json: string } | undefined> {
  if (how === "/report") {
    await page.keyboard.type("/report", { delay: 15 });
    await press(page, "Enter");
  } else await press(page, how);
  await waitFor(page, "What went wrong\\?", `${how} asks what went wrong (${what})`);
  await page.keyboard.type(words, { delay: 10 });
  const downloading = page.waitForEvent("download", { timeout: 20000 });
  await press(page, "Enter");
  const download = await downloading.catch(() => undefined);
  if (!download) { fail(`no download came (${what})`); return undefined; }
  const name = download.suggestedFilename();
  const file = join(OUT, name);
  await download.saveAs(file);
  if (/^kingmaker-report-\d{8}-\d{6}\.json\.gz$/.test(name)) ok(`the browser downloads the report as ${name} (${what})`);
  else fail(`the report's file name: ${name}`);
  await waitFor(page, "Report saved.*Downloaded kingmaker-report-", `the game says it was downloaded, and what to tell Claude (${what})`);
  await shot(page, `report-${what.replace(/\W+/g, "-")}`);
  const bar = await page.innerText("#key-bar [data-report]").catch(() => "");
  if (bar === `Report downloaded: ${name}`) ok(`the bar under the game says so too ("${bar}")`);
  else fail(`the bar under the game says "${bar}"`);
  const bytes = readFileSync(file);
  const json = gunzipSync(bytes).toString("utf8");
  const dump = JSON.parse(json) as Record<string, unknown>;
  if (dump["kind"] === "kingmaker-report" && dump["words"] === words) ok(`it's a report, gzipped JSON, with the player's words (${(bytes.length / 1024).toFixed(0)} KB)`);
  else fail(`the downloaded file isn't the report: ${json.slice(0, 120)}`);
  await press(page, "Enter");
  await sleep(300);
  if (/Report saved/.test(await text(page))) fail(`Enter didn't put the report away (${what})`);
  return { file, dump, json };
}

function changed(a: string, b: string): number {
  let count = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) count++;
  return count;
}

// ---------------------------------------------------------------------------------------------
// The saves, as the worker keeps them in IndexedDB (read from the page: the same origin)

interface Saved { path: string; data: string; mtimeMs: number }

/** The saves' database: this preview's own (persist.ts). */
const DB = dbName(DEFAULT_BASE);

const SAVES = `(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(${JSON.stringify(DB)}, 1);
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
  // A run that made its character through the cards and a backstory (the screens before them are named the same).
  const runs = readdirSync(dir).filter(run => smokeFile(join(dir, run), "the-rules-engine-made-a-sheet") && smokeFile(join(dir, run), "three-builds-that-fit-as-cards")).sort();
  return runs.length ? join(dir, runs.at(-1)!) : undefined;
}

/** A smoke test's screen by its name, whatever its number ("06-the-rules-engine-made-a-sheet.txt"). */
function smokeFile(run: string, name: string): string | undefined {
  if (!existsSync(run)) return undefined;
  const file = readdirSync(run).find(f => f.endsWith(`-${name}.txt`) && /^\d+-/.test(f));
  return file ? join(run, file) : undefined;
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
  const found = smokeFile(smoke, file);
  if (!found) { fail(`the smoke test's screens have no ${file} to compare ${what} with`); return; }
  file = relative(smoke, found);
  const want = normalize(readFileSync(found, "utf8"));
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
    await same(page, smoke, "title-screen", "the title screen");
    await clickOn(page, "New game");
    await waitFor(page, "Who are you\\?", "a click on New game: character creation");
    await same(page, smoke, "character-creation", "character creation");
    await page.keyboard.type(NAME, { delay: 15 });
    await press(page, "Enter");
    await page.keyboard.type(CONCEPT, { delay: 5 });
    await press(page, "Enter");
    // Three builds as cards, the first taken by a click, and a backstory in the box, as the smoke test makes its character.
    await waitFor(page, "Three ways to be Tamsin Vell.*HP \\d+.*Make my own", "three builds that fit, as cards (the class defaults, offline)", 90000);
    await same(page, smoke, "three-builds-that-fit-as-cards", "the three builds");
    await clickOn(page, "Halfling Rogue 3");
    await waitFor(page, "Who were you, before the King sent for you\\?", "a click on the first card: the backstory");
    await same(page, smoke, "the-first-card-taken-on-to-the-backstory", "the backstory, before it's written");
    await page.keyboard.type(BACKSTORY, { delay: 5 });
    await waitFor(page, "came out too right", "the backstory typed into the box (the browser's textarea)");
    await clickOn(page, " Done ");
    await waitFor(page, "Character sheet.*AC \\d+", "the rules engine (in the worker) made a sheet", 90000);
    await same(page, smoke, "the-rules-engine-made-a-sheet", "the character sheet");
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
  const doorBytes = () => page.evaluate("window.doorSync ? doorSync.bytes : 0") as Promise<number>;
  const before = await traffic(page), doorsBefore = await doorBytes();
  const started = Date.now();
  await during();
  const after = await traffic(page), doorsAfter = await doorBytes();
  const elapsed = (Date.now() - started) / 1000;
  const frames = after.frames - before.frames;
  note(`bandwidth, ${what} (${elapsed.toFixed(1)}s): ${((after.toPage - before.toPage) / 1000 / elapsed).toFixed(1)} KB/s from the game to the page (${((doorsAfter - doorsBefore) / 1000 / elapsed).toFixed(1)} KB/s of it where the doors are), ${((after.messagesIn - before.messagesIn) / elapsed).toFixed(1)} messages/s; ${(frames / elapsed).toFixed(1)} frames/s in the worker, ${(frames ? (after.renderMs - before.renderMs) / frames : 0).toFixed(1)} ms a frame (the slowest yet ${after.slowestMs.toFixed(0)} ms)`);
}

/**
 * From the concept to the sheet by the keys, the browser's multi-line box played: the cards (→ and
 * Enter take the second), the backstory typed with a new paragraph, a click back into its first
 * line and a word typed there, Tab to the buttons and Enter on Done; the lore check's fix taken if
 * it finds one (live).
 */
async function makeCharacter(page: Page, live: boolean): Promise<void> {
  await waitFor(page, "Three ways to be Tamsin Vell.*HP \\d+.*Make my own", "three builds that fit, as cards", live ? 150000 : 90000);
  await press(page, "ArrowRight", "Enter");
  await waitFor(page, "Who were you, before the King sent for you\\?", "→ Enter takes the second: the backstory");
  await page.keyboard.type(BACKSTORY, { delay: 5 });
  await press(page, "Enter", "Enter");
  await page.keyboard.type("The King asked, and the pay is regular.", { delay: 5 });
  await waitFor(page, "came out too right.*the pay is regular", "the backstory typed into the box, a paragraph at a time (the browser's textarea)");
  // The middle of "I ke" is the k: the cursor goes just before "kept".
  await clickOn(page, "I ke");
  await page.keyboard.type("honestly ", { delay: 10 });
  await waitFor(page, "I honestly kept a grain factor", "a click put the cursor in the text, and what's typed went there");
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
  await makeCharacter(page, live);
  await waitFor(page, "Character sheet.*AC \\d+", "the rules engine made a sheet", live ? 150000 : 90000);
  await sleep(300);
  await shot(page, "sheet");
  await press(page, "Enter");
  await waitFor(page, "The lead:.*Hanged Clerk", "exploring Caerwyn, the lead is the hanged clerk");
}

async function play(browser: Browser, url: string): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT, permissions: ["clipboard-read", "clipboard-write"] });
  const seen = watch(context);
  try {
    const { page, ms } = await open(context, url, `offline&size=${COLS}x${ROWS}`);
    await watchDoorSync(page);
    const toTitle = ms + await waitFor(page, "Hanged Clerk of Caerwyn", "the title screen, the game in a Web Worker");
    note(`time to the title screen, a first visit (nothing cached): ${toTitle} ms`);
    const renderer = await page.evaluate("km.renderer");
    if (renderer === "webgl") ok("the WebGL renderer is drawing");
    else fail(`renderer is ${renderer}, not webgl`);
    if (!(await page.evaluate("km.static"))) fail("the page doesn't know it's the static build");
    if (await page.isVisible("#loading")) fail("\"Loading Kingmaker…\" is still up over the title");
    else ok("\"Loading Kingmaker…\" went once the title was drawn");
    await sleep(300);
    await shot(page, "title");
    // On a page, Esc is for dismissing things: on the title it doesn't close the game (q does).
    await press(page, "Escape");
    await sleep(600);
    if (!(await page.isVisible("#notice")) && /Hanged Clerk of Caerwyn/.test(await text(page))) ok("Esc on the title leaves the game be");
    else fail("Esc on the title closed the game");
    await newGame(page, false);
    await waitFor(page, "Sergeant Kell", "Kell is about");
    await sleep(800);
    await shot(page, "map-morning");

    // Ctrl+C over text selected with Shift+drag copies it, as a browser's Ctrl+C does (without a selection it's the game's).
    const story = await find(page, "Morning, on the eve");
    if (story) {
      const cell = await cellBox(page);
      const y = cell.y + (story.row + 0.5) * cell.h;
      await page.keyboard.down("Shift");
      await page.mouse.move(cell.x + (story.col + 0.5) * cell.w, y);
      await page.mouse.down();
      await page.mouse.move(cell.x + (story.col + 18.5) * cell.w, y, { steps: 5 });
      await page.mouse.up();
      await page.keyboard.up("Shift");
      await sleep(200);
      const selected = (await page.evaluate("km.term.getSelection()")) as string;
      await press(page, "Control+c");
      await sleep(500);
      const copied = (await page.evaluate("navigator.clipboard.readText()").catch(() => "")) as string;
      if (selected.startsWith("Morning") && copied === selected && !(await page.isVisible("#notice")) && (await page.evaluate("km.playing"))) ok(`Ctrl+C over selected text copies it ("${copied}") and the game plays on`);
      else fail(`Ctrl+C over a selection ("${selected}"): copied "${copied}", the game ${await page.isVisible("#notice") ? "closed" : "is still up"}`);
      if (await page.evaluate("km.term.getSelection()")) fail("the selection is still there after the copy");
    } else fail("the story's first line isn't on the map's screen to select");

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

    // A problem reported mid-scene (/report): the browser downloads it, and the page says so.
    const reported = await reportProblem(page, "/report", "The GM never opened the scene", "mid-scene");
    if (reported) {
      const stamp = await page.evaluate("document.documentElement.dataset.build");
      const d = reported.dump as { build: { host: string; stamp?: string; commit?: string }; settings: { userAgent?: string; window?: string; terminal?: { cols: number; rows: number } }; where: { screen: string }; game?: { id: string; files: { state?: unknown } }; screens: { now?: string } };
      const right = d.build.host === "static" && d.build.stamp === stamp && /^[0-9a-f]{40}$/.test(d.build.commit ?? "") && /Chrome/.test(d.settings.userAgent ?? "")
        && /^\d+x\d+@[\d.]+$/.test(d.settings.window ?? "") && d.settings.terminal?.cols === COLS && d.where.screen === "scene" && !!d.game?.files.state && /The Hanged Clerk ·/.test(d.screens.now ?? "");
      if (right) ok(`the report says the static build (stamp ${stamp}, commit ${d.build.commit?.slice(0, 7)}), the browser and its window (${d.settings.window}), the scene's screen as it was, and the game's files (${d.game?.id})`);
      else fail(`the report's build, settings, where or game: ${JSON.stringify({ build: d.build, window: d.settings.window, terminal: d.settings.terminal, where: d.where, game: d.game?.id })}`);
    }

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
    // In a browser nobody can go and look in runs/deleted/: the game deletes it for good as it starts.
    let leftover = -1;
    for (let i = 0; i < 20 && leftover !== 0; i++) { leftover = (await saves(page)).filter(f => f.path.includes("/runs/deleted/")).length; if (leftover) await sleep(200); }
    if (!leftover) ok("and its files are gone from IndexedDB for good (runs/deleted/ is cleared as the game starts)");
    else fail(`${leftover} files of deleted games are still in IndexedDB after the game started again`);

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

/**
 * The zoo (src/game/zoo), in the browser: from the title (z), a visit on its own maps; a sign read in
 * its card, and an exhibit set off from it (the window onto the story's first morning); a spell on the
 * sheet with the SRD's own words (vendor/srd-spells, from content.json); the action menu; the view
 * from above; and back to the title, where the visit is carried on and not offered as a game to
 * Continue. Offline: nothing in it needs the GM.
 */
async function zoo(browser: Browser, url: string): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  watch(context);
  try {
    const { page } = await open(context, url, `offline&size=${COLS}x${ROWS}`);
    await waitFor(page, "Hanged Clerk of Caerwyn", "the title, for the zoo");
    await press(page, "z");
    await waitFor(page, "Next: Welcome to the Zoo", "z opens the zoo: a visit on a map of its own, the next exhibit in the sidebar", 60000);
    await waitFor(page, "Welcome to the Zoo: everything the game does", "the zoo's welcome in What happens");
    await sleep(500);
    await shot(page, "zoo-hall");
    // A sign read (a right-click on it in Nearby, then Read): its card, in full.
    const read = async (sign: string, card: string, what: string) => {
      await waitFor(page, `the sign: ${sign}`, `the sign "${sign}" is in Nearby`);
      await clickOn(page, `the sign: ${sign}`, "right");
      // The menu's own line (the sidebar's e line says Read the sign too, when you face one).
      await waitFor(page, `1 Read the sign: ${sign}`, `a right-click on the sign "${sign}" offers to read it`);
      await clickOn(page, `1 Read the sign: ${sign}`);
      await waitFor(page, card, what);
    };
    await read("Welcome", "Welcome to the Zoo.*Everything the game does", "the welcome sign's card");
    await press(page, "Escape");
    await read("The story's", "The story's first morning.*Set it off.*1 Look out of the window", "the first morning's sign: its card, and what it sets off");
    await shot(page, "zoo-sign");
    // Set off from the card: the zoo's explorer and the story's map, in the worker.
    await press(page, "1");
    await waitFor(page, "Through the window: the story's first morning", "1 on the card sets it off: the window onto Caerwyn's first morning");
    await sleep(400);
    await shot(page, "zoo-window");
    await press(page, "Escape");
    // A spell on the sheet: its card, the game's numbers, and the SRD's own words (content.json's vendor/srd-spells).
    await press(page, "c");
    await waitFor(page, "Character sheet", "c: the visitor's sheet");
    await clickOn(page, "Spells");
    await waitFor(page, "Fire Bolt", "the sheet's spells");
    await clickOn(page, "Fire Bolt");
    await waitFor(page, "Fire Bolt.*In this game.*From the SRD 5\\.2\\.1.*You hurl a mote of fire", "a click on Fire Bolt shows its card and the SRD's description");
    await shot(page, "zoo-spell");
    for (let i = 0; i < 4 && /Character sheet/.test(await text(page)); i++) await press(page, "Escape");
    // The action menu, on the wing's world.
    await press(page, "m");
    await waitFor(page, "What will you do\\?.*Fire Bolt", "m: the action menu in the zoo");
    await shot(page, "zoo-menu");
    await press(page, "Escape");
    await press(page, "v");
    await waitFor(page, "The Front Hall, from above", "v looks down on the wing from above");
    await press(page, "Escape");
    await press(page, "Escape");
    await waitFor(page, "Save and return to the title", "Esc: the menu");
    await clickOn(page, "Save and return to the title");
    await waitFor(page, "carry on your visit", "back on the title, the zoo carries the visit on");
    if (/Continue.*Wren Ashdown/s.test(await text(page))) fail("the zoo visit is offered as a game to Continue");
    else ok("the zoo visit isn't offered as a game to Continue");
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------
// The doors, drawn as pictures over the ASCII where the game says they are (src/web/page/doors.ts)

/** The porters' door, on the granary lane: a wizard's Fireball (the action menu's) breaks it. */
const PORTERS = "caerwyn:door@52,5";

interface SaveFile { path: string; data: string; mtimeMs: number }

/**
 * A wizard's game (level 5, so Fireball) standing on the granary lane by the porters' lodgings,
 * made here as the game makes one (offline: the rules engine, no GM), as the files the browser keeps.
 */
async function wizardGame(): Promise<SaveFile[]> {
  const runs = join(OUT, "fixture-runs");
  mkdirSync(runs, { recursive: true });
  const was = { runs: process.env.KM_RUNS_DIR, key: process.env.OPENROUTER_API_KEY };
  process.env.KM_RUNS_DIR = runs;
  process.env.OPENROUTER_API_KEY = "offline";
  try {
    const { Game: Core } = await import("../../game/play.ts");
    const { town, exploreState } = await import("../../game/town.ts");
    const { mapFights } = await import("../../game/fights.ts");
    const { PREGENS } = await import("../../game/combat/pregen.ts");
    const core = await Core.create({ player: `Vesper Hale: ${PREGENS.wizard!.concept}`, level: 5, build: PREGENS.wizard!.build, explorer: town, fights: mapFights(), seed: 11 });
    exploreState(core.state).at = { x: 47, y: 9 };
    core.save();
  } finally {
    if (was.runs === undefined) delete process.env.KM_RUNS_DIR; else process.env.KM_RUNS_DIR = was.runs;
    if (was.key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = was.key;
  }
  return filesIn(runs).map(file => ({ path: `/kingmaker/runs/${relative(runs, file).split("\\").join("/")}`, data: readFileSync(file, "utf8"), mtimeMs: statSync(file).mtimeMs }));
}

/** Files put in this preview's saves (IndexedDB), as the worker keeps them: the next game to start reads them. */
const putSaves = (page: Page, files: SaveFile[]) => page.evaluate(`(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(${JSON.stringify(DB)}, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("files")) request.result.createObjectStore("files", { keyPath: "path" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      for (const file of ${JSON.stringify(files)}) tx.objectStore("files").put(file);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
})()`);

/** The box of a bordered panel round some text (its rounded corners), in cells. */
async function boxAround(page: Page, title: string): Promise<{ left: number; top: number; right: number; bottom: number } | undefined> {
  const grid = await cells(page);
  const at = await find(page, title);
  if (!at) return undefined;
  const row = grid[at.row]!;
  let left = at.col, right = at.col, bottom = at.row;
  while (left > 0 && row[left] !== "╭") left--;
  while (right < row.length - 1 && row[right] !== "╮") right++;
  while (bottom < grid.length - 1 && grid[bottom]![left] !== "╰") bottom++;
  return row[left] === "╭" && row[right] === "╮" ? { left, top: at.row, right, bottom } : undefined;
}

/**
 * The doors in the browser: drawn where the game says, on the cells it says, at 1x and 2x (a real
 * device scale factor); in step with the frames as the map scrolls under you; hidden under the action
 * menu and back when it goes; changed when a door is (Fireball at the porters' door, from the action
 * menu, on a wizard's game put in this browser's saves); and ?doors=off leaves the ASCII alone.
 */
async function doors(url: string): Promise<void> {
  const game = await wizardGame();
  for (const scale of [1, 2]) {
    const browser = await chromium.launch({ args: [`--force-device-scale-factor=${scale}`, `--window-size=${VIEWPORT.width},${VIEWPORT.height}`] });
    try {
      const context = await browser.newContext({ viewport: null });
      watch(context);
      const { page } = await open(context, url, `offline&size=${COLS}x${ROWS}`);
      await waitFor(page, "Hanged Clerk of Caerwyn", `at ${scale}x: the title, for the doors`);
      await putSaves(page, game);
      await page.reload();
      await waitFor(page, "Continue.*Vesper Hale", `at ${scale}x: the wizard's game, put in this browser's saves, is offered`);
      await watchDoorSync(page);
      await press(page, "Enter");
      await waitFor(page, "The lead:.*Hanged Clerk", `at ${scale}x: on the granary lane, by the porters' lodgings`);
      const seen = await doorsDrawn(page, 3, PORTERS);
      if (seen && seen.drawn >= 3 && seen.doors.some(d => d.id === PORTERS)) ok(`at ${scale}x: the doors on the lane are drawn as pictures (${seen.drawn} of ${seen.doors.length}: ${seen.doors.map(d => `${d.id.replace("caerwyn:", "")} ${d.look}`).join(", ")})`);
      else { fail(`at ${scale}x: the doors on the lane: ${JSON.stringify(seen)}`); continue; }
      const where = await placement(page);
      if (placed(where, scale) && where.drawn > 1000) {
        ok(`at ${scale}x: every pixel of them is in a cell the game said they may paint (${where.drawn} device pixels), on a canvas exactly over xterm's (${where.size} device pixels, ${where.cell} a cell)`);
      } else fail(`at ${scale}x: the doors' placement: ${JSON.stringify(where)}`);
      await shot(page, `doors-${scale}x`);
      if (scale !== 1) continue;

      // In step: walking scrolls the map under you, and the doors with it.
      const before = (await doorSync(page)).taken;
      for (const key of ["ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowRight", "ArrowRight", "ArrowRight", "a", "d"]) {
        await page.keyboard.press(key);
        await sleep(350);
      }
      await sleep(600);
      const sync = await doorSync(page);
      if (sync.taken - before >= 6 && !sync.takenOff && !sync.drawnOff && sync.drawn > 0) {
        ok(`walking, the doors keep in step with the frames: taken ${sync.taken} times and drawn with xterm ${sync.drawn} times, on the cells of the frame they came with every time (${sync.cells} cells compared)`);
      } else fail(`walking, the doors out of step: ${JSON.stringify(sync)}`);

      // Under the action menu: hidden where it covers them, back when it goes.
      const count = (await doorsSeen(page))?.drawn ?? 0;
      await press(page, "m");
      await waitFor(page, "What will you do\\?", "m: the action menu, over the map");
      const menu = await boxAround(page, "What will you do?");
      let under: Placement | undefined;
      for (let i = 0; i < 20 && menu; i++) {
        under = await placement(page, menu);
        if (!under.cellsInside && !under.drawnInside) break;
        await sleep(150);
      }
      await shot(page, "doors-under-menu");
      if (menu && under && !under.cellsInside && !under.drawnInside && !under.outside) ok(`under the action menu (cells ${menu.left}-${menu.right} by ${menu.top}-${menu.bottom}) the doors are hidden: none of their cells or pixels is in it`);
      else fail(`the doors under the action menu: ${JSON.stringify({ menu, under })}`);
      await press(page, "Escape");
      let back = 0;
      for (let i = 0; i < 20 && back < count; i++) { await sleep(150); back = (await doorsSeen(page))?.drawn ?? 0; }
      if (back >= count) ok(`and back when it goes (${back} drawn)`);
      else fail(`after the menu, ${back} doors drawn, ${count} before it`);

      // A door's state: Fireball at the porters' door, from the action menu aimed at it, breaks it.
      const door = (await doorsSeen(page))!.doors.find(d => d.id === PORTERS)!;
      const look = door.look;
      const box = await cellBox(page);
      const region = `(() => { const c = km.doors.canvas, k = km.doors.cell; const x = ${door.x - 3} * k.width, y = ${door.y - 4} * k.height;
        return Array.from(c.getContext("2d").getImageData(x, y, 8 * k.width, 7 * k.height).data).join(","); })()`;
      const pictureBefore = (await page.evaluate(region)) as string;
      await page.mouse.click(box.x + (door.x + 0.5) * box.w, box.y + (door.y + 0.5) * box.h, { button: "right" });
      await waitFor(page, "The door of the porters' lodgings.*Do something…", "a right-click on the porters' door: its menu");
      await press(page, "2");
      await waitFor(page, "Do something: the door of the porters' lodgings.*Fireball", "Do something…: the action menu, aimed at the door");
      await clickOn(page, "Fireball");
      await waitFor(page, "Fireball → the door of the porters' lodgings", "Fireball, aimed at the porters' door");
      await press(page, "Enter");
      // Broken, and drawn so once the fireball's burst has gone from over it (the doors stop changing).
      let broken: DoorsSeen["doors"][number] | undefined;
      for (let i = 0; i < 60 && broken?.look !== "broken"; i++) { await sleep(200); broken = (await doorsSeen(page))?.doors.find(d => d.id === PORTERS); }
      let said = -1;
      for (let i = 0; i < 40; i++) {
        const now = (await doorsSeen(page))?.received ?? 0;
        if (now === said) break;
        said = now;
        await sleep(1200);
      }
      broken = (await doorsSeen(page))?.doors.find(d => d.id === PORTERS);
      const pictureAfter = (await page.evaluate(region)) as string;
      await shot(page, "doors-fireball");
      if (broken?.look === "broken" && pictureAfter !== pictureBefore) ok(`Fireball at the porters' door breaks it, and its picture changes with it (${look} to broken)`);
      else fail(`the porters' door after the Fireball: ${JSON.stringify(broken)}, its picture ${pictureAfter === pictureBefore ? "the same" : "changed"}`);
      const after = await placement(page);
      if (!after.outside) ok("and every pixel of the doors is still in a cell the game said they may paint");
      else fail(`after the Fireball, ${after.outside} pixels outside the doors' cells`);
    } finally {
      await browser.close();
    }
  }

  // ?doors=off: the ASCII alone.
  const plain = await chromium.launch();
  try {
    const context = await plain.newContext({ viewport: VIEWPORT });
    watch(context);
    const { page } = await open(context, url, `offline&size=${COLS}x${ROWS}&doors=off`);
    await page.evaluate(`window.doorsSaid = 0; km.term.parser.registerOscHandler(${OVERLAY_OSC}, () => { window.doorsSaid++; return false; })`);
    await waitFor(page, "Hanged Clerk of Caerwyn", "?doors=off: the title");
    await press(page, "z");
    await waitFor(page, "Next: Welcome to the Zoo", "?doors=off: the zoo's Front Hall, its doors round the walls");
    await sleep(1500);
    const none = await page.evaluate(`km.doors === undefined && !document.querySelector(".km-doors") && window.doorsSaid === 0`);
    if (none) ok("?doors=off leaves the ASCII alone: no overlay, and the game in the worker doesn't say where the doors are");
    else fail(`?doors=off: an overlay ${await page.evaluate("!!document.querySelector('.km-doors')")}, the game said where the doors are ${await page.evaluate("window.doorsSaid")} times`);
  } finally {
    await plain.close();
  }
}

// ---------------------------------------------------------------------------------------------
// The lamp posts, drawn as pictures with the doors (src/web/page/lamps.ts)

/** On the lane by its lamp post, in a game put in this browser's saves (the overlay's OSC counted from before the game starts, with `count`). */
async function toTheLamp(page: Page, files: SaveFile[], what: string, count = false): Promise<void> {
  await waitFor(page, "Hanged Clerk of Caerwyn", `${what}: the title`);
  await putSaves(page, files);
  await page.reload();
  await waitFor(page, "Continue.*Vesper Hale", `${what}: the wizard's game by the lamp post, put in this browser's saves, is offered`);
  if (count) await page.evaluate(`window.doorsSaid = 0; km.term.parser.registerOscHandler(${OVERLAY_OSC}, () => { window.doorsSaid++; return false; })`);
  await press(page, "Enter");
  await waitFor(page, "The lead:.*Hanged Clerk", `${what}: on the lane by its lamp post`);
}

/**
 * The lamp posts in the browser: the lane's drawn where the game says, on the cells it says, at 1x
 * and 2x (a real device scale factor), by day (pale) and at night (lit, with its glow), covering the
 * game's ¤ and post; standing still at night, nothing new sent (its flicker doesn't move it); lit by
 * the action menu's Light by day, and its picture lit with it; ?lamps=off leaves them to the ASCII
 * (the doors still drawn), and ?doors=off leaves both.
 */
async function lamps(url: string): Promise<void> {
  // A wizard (Light among its cantrips: a touch) by the lane's lamp post, by day and at night (src/web/static/lane.ts).
  const games = { morning: await laneGame(join(OUT, "fixture-lane-morning"), "morning"), night: await laneGame(join(OUT, "fixture-lane-night"), "night") };
  for (const scale of [1, 2]) {
    const browser = await chromium.launch({ args: [`--force-device-scale-factor=${scale}`, `--window-size=${VIEWPORT.width},${VIEWPORT.height}`] });
    try {
      for (const time of ["morning", "night"] as const) {
        const when = time === "night" ? "at night" : "by day";
        const context = await browser.newContext({ viewport: null });
        watch(context);
        try {
          const { page } = await open(context, url, `offline&size=${COLS}x${ROWS}`);
          await toTheLamp(page, games[time], `at ${scale}x, ${when}`);
          const look = time === "night" ? "lit" : "out";
          const seen = await lampShown(page, LANE_LAMP, look);
          const lamp = seen?.lamps.find(l => l.id === LANE_LAMP);
          if (seen && lamp?.look === look && (time === "night") === lamp.glow > 0) ok(`at ${scale}x, ${when}: the lane's lamp post is drawn as a picture, ${look}${lamp.glow ? `, its glow on ${lamp.glow} cells` : ""} (${seen.drawn} lamp posts drawn: ${seen.lamps.map(l => `${l.id.replace("caerwyn:", "")} ${l.look}`).join(", ")})`);
          else { fail(`at ${scale}x, ${when}: the lamp posts: ${JSON.stringify(seen)}`); continue; }
          const where = await placement(page);
          if (placed(where, scale)) ok(`at ${scale}x, ${when}: every pixel on the doors' canvas, the lamps' and their glow's with the doors', is in a cell the game said may be painted (${where.drawn} device pixels), the canvas exactly over xterm's (${where.size}, ${where.cell} a cell)`);
          else fail(`at ${scale}x, ${when}: the lamps' placement: ${JSON.stringify(where)}`);
          const picture = await lampPicture(page, LANE_LAMP);
          if (picture && picture.ground === 2 && !picture.gaps) ok(`at ${scale}x, ${when}: the game's ¤ and post are under the picture (the two cells it took back to the ground are covered)`);
          else fail(`at ${scale}x, ${when}: the lamp's cells: ${JSON.stringify(picture)}`);
          await shot(page, `lamps-${time}-${scale}x`);
          if (scale !== 1) continue;
          if (time === "night") {
            // Standing still: the lamp's flicker, and its light's on the ground under it, don't move its picture.
            await sleep(1000);
            const before = (await lampsSeen(page))?.received ?? 0;
            await sleep(3000);
            const after = (await lampsSeen(page))?.received ?? 0;
            if (after === before) ok("standing still at night by a lit lamp, nothing new about the doors or the lamps is sent (3 s)");
            else fail(`standing still at night, ${after - before} new frames of doors and lamps in 3 s`);
            continue;
          }
          // The Light cantrip, from the action menu aimed at the lamp post (a right-click's Do something…).
          const box = await cellBox(page);
          await page.mouse.click(box.x + (lamp.x + 0.5) * box.w, box.y + (lamp.y + 1.5) * box.h, { button: "right" });
          await waitFor(page, "A lamp post.*Do something…", "a right-click on the lamp post: its menu");
          await clickOn(page, "Do something…");
          await waitFor(page, "Do something: a lamp post.*Light.*shines like a torch", "Do something…: the action menu, aimed at the lamp post, Light among it");
          await clickOn(page, "Light");
          await waitFor(page, "A lamp post shines like a torch", "Light, on the lamp post: it shines like a torch");
          // Lit, and drawn so once the spell's sparkles have gone from over it (the overlay stops changing).
          let said = -1;
          for (let i = 0; i < 40; i++) {
            const now = (await lampsSeen(page))?.received ?? 0;
            if (now === said) break;
            said = now;
            await sleep(1200);
          }
          const lit = await lampShown(page, LANE_LAMP, "lit");
          const after = await lampPicture(page, LANE_LAMP);
          await shot(page, "lamps-light");
          if (lit?.lamps.find(l => l.id === LANE_LAMP)?.look === "lit" && after && after.ground === 2 && after.hash !== picture?.hash && !after.gaps) ok("by day, the lamp post Light lit is drawn lit, and still up its post: its picture changed with it (out to lit)");
          else fail(`the lamp post after Light: ${JSON.stringify(lit)}, its picture ${after?.hash === picture?.hash ? "the same" : "changed"}`);
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }

  // ?lamps=off: the doors drawn, the lamps left to the ASCII; ?doors=off: neither, and the game says nothing of either.
  const plain = await chromium.launch();
  try {
    for (const off of ["lamps", "doors"] as const) {
      const context = await plain.newContext({ viewport: VIEWPORT });
      watch(context);
      try {
        const { page } = await open(context, url, `offline&size=${COLS}x${ROWS}&${off}=off`);
        await toTheLamp(page, games.night, `?${off}=off, at night`, off === "doors");
        await sleep(1500);
        if (off === "lamps") {
          const seen = await lampsSeen(page), doorsNow = await doorsSeen(page);
          const picture = await lampPicture(page, LANE_LAMP);
          if (seen?.lamps.some(l => l.id === LANE_LAMP) && seen.drawn === 0 && (doorsNow?.drawn ?? 0) > 0 && picture && picture.gaps > 0) ok(`?lamps=off: the doors are drawn (${doorsNow!.drawn}), the lamp posts left as the ASCII draws them`);
          else fail(`?lamps=off: lamps ${JSON.stringify(seen)}, doors drawn ${doorsNow?.drawn}, the lamp's cells ${JSON.stringify(picture)}`);
        } else {
          const none = await page.evaluate("km.doors === undefined && !document.querySelector('.km-doors') && window.doorsSaid === 0");
          if (none) ok("?doors=off leaves the lamp posts to the ASCII too: no overlay, and the game in the worker says nothing of doors or lamps");
          else fail(`?doors=off by the lamp: an overlay ${await page.evaluate("!!document.querySelector('.km-doors')")}, the game said ${await page.evaluate("window.doorsSaid")} times`);
        }
        await shot(page, `lamps-${off}-off`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await plain.close();
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
// One tab at a time, and a browser that won't keep anything

/** The same game opened in a second tab: it's told so, takes the game over, and plays on from the first tab's progress. */
async function twoTabs(browser: Browser, url: string): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  watch(context);
  try {
    const { page: a } = await open(context, url, `offline&size=${COLS}x${ROWS}`);
    await waitFor(a, "Hanged Clerk of Caerwyn", "tab A: the title");
    await newGame(a, false);
    await press(a, "ArrowLeft", "ArrowLeft");
    await sleep(1500);
    await a.evaluate("km.flush()");
    const [id, game] = [...(await games(a)).entries()][0] ?? [];
    if (!id || !game?.at) throw new Error("tab A's game isn't in IndexedDB");
    const { page: b } = await open(context, url, `offline&size=${COLS}x${ROWS}`);
    try {
      await b.waitForSelector("#notice:not([hidden])", { timeout: 10000 });
    } catch {
      throw new Error("tab B, opened while tab A plays, wasn't told the game is open in another tab");
    }
    const said = await b.textContent("#notice-text");
    if (/open in another tab/.test(said ?? "") && !(await text(b)).trim()) ok(`tab B, opened while A plays, is told so and doesn't start a copy of its own ("${said}")`);
    else fail(`tab B: "${said}", its screen: "${(await text(b)).trim().slice(0, 60)}"`);
    await shot(b, "second-tab");
    await b.click("#notice-button");
    await waitFor(b, "Continue.*Tamsin Vell", "Play here instead: tab B has the game now, and Continue offers it", 20000);
    const told = await a.textContent("#notice-text");
    if (await a.isVisible("#notice") && /another tab/.test(told ?? "") && !(await a.evaluate("km.playing"))) ok(`tab A saved its game, let it go, and says so ("${told}")`);
    else fail(`tab A after B took the game: "${told}", playing: ${await a.evaluate("km.playing")}`);
    await press(b, "Enter");
    await waitFor(b, "The lead:.*Hanged Clerk", "tab B continues tab A's game");
    await sleep(1000);
    await b.evaluate("km.flush()");
    const there = (await games(b)).get(id)?.at;
    if (there && there.x === game.at.x && there.y === game.at.y) ok(`and from where A left it (${there.x},${there.y}): nothing of A's was lost`);
    else fail(`tab B's game is at ${there?.x},${there?.y}, A left it at ${game.at.x},${game.at.y}`);
    // And back: A takes it again.
    await a.click("#notice-button");
    await a.waitForSelector("#notice:not([hidden])", { timeout: 10000 });
    await a.click("#notice-button");
    await waitFor(a, "Continue.*Tamsin Vell", "tab A takes it back the same way", 20000);
  } finally {
    await context.close();
  }
}

/** A browser that won't let the page keep anything (IndexedDB refused, as with this site's data blocked): the game plays, and the bar says it won't be kept. */
async function noStorage(browser: Browser, url: string): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  watch(context);
  await context.route("**/worker.js*", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `IDBFactory.prototype.open = function () { throw new DOMException("The user denied permission to access the database.", "SecurityError"); };\n${await response.text()}` });
  });
  try {
    const { page } = await open(context, url, `offline&size=${COLS}x${ROWS}`);
    await waitFor(page, "Hanged Clerk of Caerwyn", "without IndexedDB: the title");
    const said = await page.innerText("#key-bar [data-storage]").catch(() => "");
    if (/won't keep/.test(said) && await page.isVisible("#key-bar [data-storage]")) ok(`without IndexedDB the game plays, and the bar under it says it won't be kept ("${said}")`);
    else fail(`without IndexedDB the bar says "${said}"`);
    await shot(page, "no-storage");
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

    // A report from the title, with the key in use: it's about the latest game (none here), and the key isn't in it.
    const titled = await reportProblem(page, "b", "The title's tagline keeps changing", "from the title, with a key in use");
    if (titled) {
      if (!titled.json.includes(FAKE_KEY) && !readFileSync(titled.file).includes(FAKE_KEY)) ok("the key in use is nowhere in the report");
      else fail("the key in use is in the report");
      const d = titled.dump as { where: { screen: string; latest?: boolean }; settings: { offline: boolean }; game?: unknown };
      if (d.where.screen === "title" && d.where.latest && !d.game && d.settings.offline === false) ok("the report from the title is about the latest game (there's none in this browser yet), with the GM online");
      else fail(`the report from the title: where ${JSON.stringify(d.where)}, offline ${d.settings.offline}, a game ${!!d.game}`);
    }

    // Change key over the game: the game behind the form takes nothing, and the form can be left as it was (Cancel, or Esc).
    await page.click("#key-bar [data-change]");
    await page.waitForSelector("#gate:not([hidden])", { timeout: 5000 });
    const second = await page.textContent("#offline");
    const inert = await page.evaluate(`document.getElementById("frame").inert`);
    await press(page, "Escape");
    await sleep(300);
    if (second === "Cancel" && inert && !(await page.isVisible("#gate")) && (await page.evaluate(`localStorage.getItem(${JSON.stringify(KEY_STORAGE)})`)) === FAKE_KEY && (await page.evaluate("km.playing"))) {
      ok("Change key over the game: the game behind it is inert, and Cancel (or Esc) leaves the key and the game as they were");
    } else fail(`Change key: second button "${second}", game inert ${inert}, form still up ${await page.isVisible("#gate")}`);

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
    // A moment later, the suggested lines (src/runtime/suggest.ts, in the worker), numbered over the box.
    await waitFor(page, "1–\\d into the box", "the suggested lines come after the opening, numbered over the box", 30000);
    await shot(page, "suggested-lines");
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
    // A considered turn: something a roll should settle that none of the scene's routes does. The
    // status line says the GM is considering, then moves on a step at a time, as in a terminal.
    // (Whether the decider flags the turn is the model's call: one it doesn't is noted, not failed.)
    const sideways = "*I crouch to the boy's height and nod at his enormous boots* Tell you what, champ: let me have a proper look at the backs of those heels, right here on your feet, and there's a hot pie in it. Nobody touches the laces.";
    await page.keyboard.type(sideways, { delay: 8 });
    await sleep(150);
    await press(page, "Enter");
    const statuses: string[] = [];
    for (const t0 = Date.now(); ;) {
      const screen = await text(page);
      const status = /(The GM [^\n│]*?…|[A-Z][\w' ]+ is speaking…)/.exec(screen)?.[1];
      if (status && statuses.at(-1) !== status) {
        statuses.push(status);
        if (/considering the ramifications/.test(status)) await shot(page, "gm-considering");
      }
      if ((Date.now() - t0 > 3000 && /Say it out loud/.test(screen)) || Date.now() - t0 > 180000) break;
      await sleep(100);
    }
    if (statuses.some(s => /considering the ramifications/.test(s))) ok(`a considered turn, the status line a step at a time: ${statuses.join(" → ")}`);
    else note(`the decider didn't send this turn to the GM's ruling this time: ${statuses.join(" → ")}`);
    await shot(page, "gm-ruling");
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
  await zoo(browser, server.url);
  await doors(server.url);
  await lamps(server.url);
  await resize(browser, server.url);
  await twoTabs(browser, server.url);
  await noStorage(browser, server.url);
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
