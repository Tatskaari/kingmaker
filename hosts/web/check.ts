// Its helpers (ok, fail, note, watch, open, until, waitFor, shot, press, :89-260) and its steps for two tabs, a browser that keeps nothing and the key form (:1209-1370) are copied from the prototype's src/web/static/check.ts at 44c6d4a, with the usual edits (v2's paths and screens, the saves read from every IndexedDB store, what the page sends each worker watched by a probe in front of its script); the play is v2's own, on the fake GM.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { Report } from "../../shared/report/format.ts";
import { DEFAULT_BASE, serveStatic } from "./serve.ts";
import { keyNeedles, readSite, siteProblems, textOf } from "./site.ts";

/**
 * The page-only build's check (browser-design §7, npm run web:check): the site in dist/web (npm run
 * build:web first) held to the build's rules, then served as GitHub Pages serves a preview (serve.ts,
 * under /kingmaker/pr-preview/pr-0/play/: files only, max-age=600) and played in headless Chromium with
 * Playwright, on the fake GM:
 *
 * - the gate: with no key kept, the page asks for one or offers the fake GM, and the key form turns
 *   back what isn't an OpenRouter key (OpenRouter faked: nothing goes to it);
 * - both workers started, each with its end of the page's channel (the client with the terminal's
 *   size and never a key, the server with the key or the fake: ?fake, ?fake=arc, or the form's
 *   choice), as the page sends them (each worker's script has a probe put in front of it);
 * - a made-up key from the form: kept in localStorage, and in no URL, console line, IndexedDB record
 *   or screen;
 * - then the play, on the fake GM: the title, a character made, the map ("The lead: The Hanged
 *   Clerk") with its action menu (m opens it, Esc closes it: town-design §1.1), g to the yard and
 *   the opening streamed in, a line and its reply with the suggested lines
 *   after it, a problem reported (/report: M5, the page downloading the report, the game in it the
 *   server worker's), a reload with the title's Continue carrying the game on from IndexedDB (the
 *   simulation's rows and the AI service's stores), another line, Ctrl+C and Play again (a new client
 *   worker, the server playing on), and a second tab told the game is open in this one (it takes it
 *   over); a browser that won't keep anything is told so.
 *
 * Then the zoo (M6): ?zoo=ring starts on the fake GM with no key asked for, the client worker visits
 * the combat ring as the page comes up, and its fight is on the fight's screen; the player's turn
 * comes (the other side's moves skipped to it with f), e ends it and the other side's moves play
 * on their own, nothing pressed, until it's theirs again in round 2; n fights it again from the
 * start, and o's list sets the dogs.
 *
 * Throughout: no page error, and no request leaves the origin (anything else is refused and failed),
 * but the key's check with OpenRouter, faked here.
 *
 *   npm run web:check [-- --dir dist/web] [--port 0]
 *
 * Screens go to runs/web/<run>/, a PNG and the terminal's text each. Exits 1 if anything failed.
 * KM_WEB_CHECK_DEBUG=1 prints the page's and the workers' console, and every request.
 */

const V2 = resolve(import.meta.dirname, "..", "..");
const RUN = new Date().toLocaleString("sv").replace(/[-:]/g, "").replace(" ", "-");
const OUT = join(V2, "runs", "web", RUN);
const DEBUG = !!process.env.KM_WEB_CHECK_DEBUG;
const KEY_STORAGE = "kingmaker.openrouter-api-key";
/** A made-up key, shaped like OpenRouter's: what the key form is given, looked for everywhere it mustn't be. */
const FAKE_KEY = `sk-or-v1-${"0123456789abcdef".repeat(4)}`;
// The terminal smoke run's size, the page's frame around it (10px and 8px of padding, the key's line under it) at 9x18 cells.
const COLS = 130;
const ROWS = 42;
const VIEWPORT = { width: COLS * 9 + 20, height: ROWS * 18 + 16 + 26 };
const NAME = "Tamsin Vell";
const CONCEPT = "a disgraced palace auditor with a ledger-keeper's eye and a borrowed rapier";
// Words the fake GM's golden replies have (hosts/dev/fake.json): the opening's first sentence and its last, the first reply's last.
const OPENING = { first: "pigeon", last: "clangs" };
const LINE = "Morning, Sergeant. What have we got?";
const REPLY = "drizzle";

let failures = 0;
let shots = 0;
const report: string[] = [];

async function main(argv: string[]): Promise<void> {
  const { dir, port } = argsOf(argv);
  mkdirSync(OUT, { recursive: true });

  inspect(dir);
  const served = await serveStatic(dir, DEFAULT_BASE, port);
  note(`${relative(V2, dir)} served on ${served.url}`);
  const browser = await chromium.launch();
  try {
    await theGate(browser, served.url);
    await theFakeGm(browser, served.url);
    await aKeyFromTheForm(browser, served.url);
    await thePlay(browser, served.url);
    await theZoo(browser, served.url);
  } catch (error) {
    fail((error as Error).message);
  } finally {
    await browser.close();
    served.server.close();
  }

  writeFileSync(join(OUT, "report.txt"), `${report.join("\n")}\n`);
  console.log(failures ? `${failures} FAILED (screens in ${relative(V2, OUT)})` : `PASS (screens in ${relative(V2, OUT)})`);
  process.exit(failures ? 1 : 0);
}

function argsOf(argv: string[]): { dir: string; port: number } {
  const { values } = parseArgs({ args: argv, options: { dir: { type: "string" }, port: { type: "string" } } });
  return { dir: resolve(values.dir ?? join(V2, "dist", "web")), port: Number(values.port ?? 0) };
}

// ---------------------------------------------------------------------------------------------
// Saying how it went

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

const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));

// ---------------------------------------------------------------------------------------------
// The build, and what's in it

/** The site as built, held to the build's own rules (site.ts): the stamp, the preload list, the CSP, relative URLs, the allowlist, no key. */
function inspect(dir: string): void {
  const site = readSite(dir);
  const problems = siteProblems(site, keyNeedles(join(homedir(), "secrets", "kingmaker-dev-openrouter.txt")));
  for (const problem of problems) fail(`the build: ${problem}`);
  if (problems.length) throw new Error(`${relative(V2, dir)} isn't fit to publish: npm run build:web`);
  const content = JSON.parse(textOf(site, "content.json")) as { campaign: object; prompts: object };
  const stamp = /data-build="(\w+)"/.exec(textOf(site, "index.html"))?.[1];
  ok(`the build: ${site.size} files, stamped ${stamp} on all that isn't named by its hash, each the page loads at once in its preload list, the page's CSP, relative URLs only, content.json by the allowlist (${Object.keys(content.campaign).length} campaign files, ${Object.keys(content.prompts).length} prompts, the fake model), nothing like an OpenRouter key`);
}

// ---------------------------------------------------------------------------------------------
// The page

interface Watch {
  /** Every console line, the page's and the workers'. */
  console: string[];
  /** The console's errors. */
  errors: string[];
  /** Every request's URL. */
  requests: string[];
  /** Requests for anywhere but the page's origin: refused. */
  away: string[];
  /** What the page sent each worker, as the probe in front of its script told it: each kind of message once. */
  told: Told[];
}

/** A message the page sent a worker, as its probe told it: whether it carried a port and a key (never the key), and which fake. */
interface Told { worker: string; type: string; port: boolean; key: boolean; fake: string; cols: number; rows: number }

/**
 * A context watched: its console and requests, anything bound elsewhere than the page's origin refused
 * (OpenRouter, for the key's check, is a step's own route), and a probe in front of each worker's script
 * that tells the check what the page sends it. `serverFirst` goes in front of the server worker's too.
 */
async function watch(context: BrowserContext, origin: string, serverFirst = ""): Promise<Watch> {
  const seen: Watch = { console: [], errors: [], requests: [], away: [], told: [] };
  const line = (where: string, type: string, text: string) => {
    seen.console.push(text);
    if (type === "error") seen.errors.push(`${where}: ${text}`);
    if (DEBUG) console.log(`  ${where} console: ${text.slice(0, 300)}`);
  };
  context.on("page", page => {
    page.on("console", m => line("page", m.type(), m.text()));
    page.on("worker", worker => worker.on("console", m => line("worker", m.type(), m.text())));
  });
  context.on("request", request => {
    seen.requests.push(request.url());
    if (DEBUG) console.log(`  request: ${request.method()} ${request.url().slice(0, 200)}`);
  });
  await context.route("**/*", route => {
    const url = route.request().url();
    if (url.startsWith(origin)) return route.continue();
    seen.away.push(url);
    return route.abort();
  });
  for (const worker of ["client", "server"] as const) {
    await context.route(`**/${worker}-worker.js*`, async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: `${probe(worker)}${worker === "server" ? serverFirst : ""}${await response.text()}` });
    });
  }
  await context.route("**/__check?*", route => {
    const said = new URL(route.request().url()).searchParams;
    seen.told.push({ worker: said.get("worker") ?? "", type: said.get("type") ?? "", port: said.get("port") === "true", key: said.get("key") === "true", fake: said.get("fake") ?? "", cols: Number(said.get("cols")), rows: Number(said.get("rows")) });
    return route.fulfill({ status: 204 });
  });
  return seen;
}

/** What goes in front of a worker's script: each kind of message the page sends it, told once, by a request the check answers. Never the key itself. */
function probe(worker: "client" | "server"): string {
  return `{
  const told = new Set();
  self.addEventListener("message", event => {
    const m = event.data ?? {};
    if (told.has(m.type)) return;
    told.add(m.type);
    const said = { worker: ${JSON.stringify(worker)}, type: String(m.type), port: String(m.port instanceof MessagePort), key: String(typeof m.key === "string" && m.key.length > 0), fake: String(m.fake ?? ""), cols: String(m.cols ?? ""), rows: String(m.rows ?? "") };
    fetch("./__check?" + new URLSearchParams(said)).catch(() => {});
  });
}
`;
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

/** Polls something the check holds (what the probes told, say) until it's true. */
async function untilHere(test: () => boolean, timeout: number): Promise<boolean> {
  const end = Date.now() + timeout;
  while (!test()) {
    if (Date.now() > end) return false;
    await sleep(100);
  }
  return true;
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
  writeFileSync(`${base}.txt`, await text(page).catch(() => ""));
}

async function press(page: Page, ...keys: string[]): Promise<void> {
  for (const key of keys) {
    await page.keyboard.press(key);
    await sleep(120);
  }
}

/** Nothing went anywhere but the page's origin (OpenRouter's key check aside, where a step fakes it), and every request stayed under the preview's path. */
function stayedHome(seen: Watch, origin: string, what: string, openRouter = false): void {
  const away = seen.away.filter(url => !(openRouter && url.startsWith("https://openrouter.ai/")));
  const elsewhere = seen.requests.filter(url => url.startsWith(origin) && !new URL(url).pathname.startsWith(DEFAULT_BASE));
  if (!away.length && !elsewhere.length) ok(`${what}: no request left the origin, nor the preview's path (${seen.requests.length} requests)`);
  else fail(`${what}: requests went elsewhere: ${[...away, ...elsewhere].join(", ")}`);
}

// ---------------------------------------------------------------------------------------------
// Both workers, as the page starts them

/**
 * Both workers started on the page's channel: the client with its end, the terminal's size and no key;
 * the server with the other end, and the key or the fake. Then what they said: ready (the server has
 * the game) and started (the client drew).
 */
async function bothStarted(page: Page, seen: Watch, what: string, server: { fake: string; key: boolean }): Promise<void> {
  const started = (worker: string) => seen.told.find(t => t.worker === worker && t.type === "start");
  await untilHere(() => !!started("client") && !!started("server"), 15000);
  const client = started("client"), host = started("server");
  if (client?.port && !client.key && client.cols === COLS && client.rows === ROWS) ok(`${what}: the client worker was started with its end of the page's channel, the terminal's size (${client.cols}x${client.rows}) and no key`);
  else fail(`${what}: the client worker's start: ${JSON.stringify(client ?? "none")}`);
  if (host?.port && host.key === server.key && host.fake === server.fake) ok(`${what}: the server worker was started with the other end${server.fake ? `, on the fake GM (${server.fake})` : ""}${server.key ? ", and the key" : ""}`);
  else fail(`${what}: the server worker's start: ${JSON.stringify(host ?? "none")}, not ${JSON.stringify(server)}`);
  if (await until(page, `km.heard.some(h => h.from === "server" && h.type === "ready") && km.heard.some(h => h.from === "client" && h.type === "started")`, 60000)) ok(`${what}: the server worker has the game (ready), and the client worker drew its first screen (started)`);
  else fail(`${what}: the workers said ${JSON.stringify(await page.evaluate("km.heard"))}`);
}

// ---------------------------------------------------------------------------------------------
// The gate, and the fake GM

/** No key kept, no ?fake: the page asks for a key or offers the fake GM; the form turns back what isn't a key, and nothing starts until it's given one or the choice. */
async function theGate(browser: Browser, url: string): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const origin = new URL(url).origin;
  const seen = await watch(context, origin);
  const asked = await fakeOpenRouter(context, () => false);
  try {
    const { page } = await open(context, url, `size=${COLS}x${ROWS}`);
    await page.waitForSelector("#gate:not([hidden])", { timeout: 10000 });
    ok("with no key kept in this browser, the page asks for one");
    const choice = await page.textContent("#fake");
    if (choice === "Play with the fake GM" && (await page.isVisible("#fake-note"))) ok(`beside the key form, "${choice}", with a word on what it plays ("${await page.textContent("#fake-note")}")`);
    else fail(`the key form's other choice: "${choice}"`);
    await shot(page, "the-gate");
    await refusals(page, asked);
    if (!seen.told.length && !(await page.evaluate("km.heard.length"))) ok("nothing started while the form was up: the workers wait for a key or the fake GM");
    else fail(`with the form up, the workers were told ${JSON.stringify(seen.told)}`);

    await page.click("#fake");
    await bothStarted(page, seen, "Play with the fake GM", { fake: "dev", key: false });
    if (new URL(page.url()).searchParams.has("fake")) ok("the choice is in the page's address (?fake), so a reload carries the game on with the fake GM");
    else fail(`after Play with the fake GM, the address is ${page.url()}`);
    await shot(page, "the-fake-gm");
    stayedHome(seen, origin, "the gate", true);
    noErrors(seen, "the gate", /status of 401/);
  } finally {
    await context.close();
  }
}

/** ?fake: no form, the fake GM; ?fake=arc: the whole story's recipe. */
async function theFakeGm(browser: Browser, url: string): Promise<void> {
  for (const [query, fake] of [["fake", "dev"], ["fake=arc", "arc"]] as const) {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const origin = new URL(url).origin;
    const seen = await watch(context, origin);
    try {
      const { page } = await open(context, url, `${query}&size=${COLS}x${ROWS}`);
      await bothStarted(page, seen, `?${query}`, { fake, key: false });
      if (!(await page.isVisible("#gate"))) ok(`?${query}: no key asked for`);
      else fail(`?${query}: the page asked for a key`);
      stayedHome(seen, origin, `?${query}`);
      noErrors(seen, `?${query}`);
    } finally {
      await context.close();
    }
  }
}

/** The console said nothing went wrong (but what `expected` matches: the 401s of a key OpenRouter turned down, say). */
function noErrors(seen: Watch, what: string, expected?: RegExp): void {
  const errors = seen.errors.filter(line => !expected?.test(line));
  if (!errors.length) ok(`${what}: no error in the console (${seen.console.length} lines)`);
  else fail(`${what}: errors in the console: ${errors.slice(0, 3).join(" | ")}`);
}

// ---------------------------------------------------------------------------------------------
// The key form: OpenRouter faked here, so no key goes anywhere

/** OpenRouter, faked: its key check knows the made-up key once `knows` says so; everything else is a 401. What it was asked, by method and path. */
async function fakeOpenRouter(context: BrowserContext, knows: () => boolean): Promise<string[]> {
  const asked: string[] = [];
  await context.route("https://openrouter.ai/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const known = request.headers()["authorization"] === `Bearer ${FAKE_KEY}` && knows();
    asked.push(`${request.method()} ${path}${known ? "" : " (refused)"}`);
    if (path === "/api/v1/key" && known) return route.fulfill({ status: 200, contentType: "application/json", body: '{"data":{"label":"the check\'s fake"}}' });
    return route.fulfill({ status: 401, contentType: "application/json", body: '{"error":{"message":"User not found.","code":401}}' });
  });
  return asked;
}

/** What isn't an OpenRouter key is turned back, by its shape or by OpenRouter, and isn't kept. */
async function refusals(page: Page, asked: string[]): Promise<void> {
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
  if (asked.includes("GET /api/v1/key (refused)")) ok("the OpenRouter-shaped key was checked with OpenRouter (faked) before anything else");
  else fail(`OpenRouter (faked) was asked: ${asked.join("; ") || "nothing"}`);
}

/**
 * A key from the form (OpenRouter faked, knowing it): checked, kept in localStorage, the field
 * cleared, sent to the server worker and never the client, and in no URL, console line, IndexedDB
 * record or screen; then the title, the bar, Change key and Cancel, Forget it.
 */
async function aKeyFromTheForm(browser: Browser, url: string): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const origin = new URL(url).origin;
  const seen = await watch(context, origin);
  const asked = await fakeOpenRouter(context, () => true);
  try {
    const { page } = await open(context, url, `size=${COLS}x${ROWS}`);
    await page.waitForSelector("#gate:not([hidden])", { timeout: 10000 });
    await page.locator("#key").pressSequentially(FAKE_KEY, { delay: 5 });
    await page.click("button[type=submit]");
    await bothStarted(page, seen, "a key from the form", { fake: "", key: true });
    if (asked.includes("GET /api/v1/key")) ok("the key was checked with OpenRouter (faked) before it was kept");
    else fail(`OpenRouter (faked) was asked: ${asked.join("; ") || "nothing"}`);
    if ((await page.evaluate(`localStorage.getItem(${JSON.stringify(KEY_STORAGE)})`)) === FAKE_KEY) ok(`the key is kept in localStorage ("${KEY_STORAGE}")`);
    else fail("the key isn't in localStorage");
    if ((await page.inputValue("#key")) === "") ok("the key field is cleared once it's sent");
    else fail("the key is still in the field");
    await theBar(page);
    await shot(page, "a-key");
    await keyNowhere(page, seen);
    stayedHome(seen, origin, "a key from the form", true);
  } finally {
    await context.close();
  }
}

/** The key is in no URL (the page's, or any request's), console line, IndexedDB record, or screen the check saved. */
async function keyNowhere(page: Page, seen: Watch): Promise<void> {
  if (!page.url().includes(FAKE_KEY) && !seen.requests.some(url => url.includes(FAKE_KEY))) ok(`the key is in no URL (the page's, or any of ${seen.requests.length} requests')`);
  else fail("the key is in a URL");
  if (!seen.console.some(line => line.includes(FAKE_KEY))) ok(`the key is in no console line of the page or the workers (${seen.console.length} lines)`);
  else fail("the key is in the console");
  const records = Object.values(await saves(page)).flat();
  if (!records.some(record => record.includes(FAKE_KEY))) ok(`the key is in no IndexedDB record (${records.length} records)`);
  else fail("the key is in IndexedDB");
  if (!(await text(page)).includes(FAKE_KEY)) ok("the key isn't on the screen");
  else fail("the key is on the screen");
}

/** The bar under the game: the key kept, Change key over the game (inert behind it; Cancel and Esc leave it be), and Forget it (the page asks again). */
async function theBar(page: Page): Promise<void> {
  await waitFor(page, "Hanged Clerk of Caerwyn", "the key from the form started the game: the title");
  const bar = await page.innerText("#key-bar");
  if (/kept in this browser.*Change key.*Forget it/s.test(bar)) ok(`the bar under the game says so, and offers to change or forget it ("${bar.replace(/\s+/g, " ").trim()}")`);
  else fail(`the key's bar: "${bar}"`);
  await page.click("#key-bar [data-change]");
  await page.waitForSelector("#gate:not([hidden])", { timeout: 5000 });
  const second = await page.textContent("#fake");
  const inert = await page.evaluate(`document.getElementById("frame").inert`);
  await press(page, "Escape");
  await sleep(300);
  if (second === "Cancel" && inert && !(await page.isVisible("#gate")) && (await page.evaluate(`localStorage.getItem(${JSON.stringify(KEY_STORAGE)})`)) === FAKE_KEY) ok("Change key over the game: the game behind it is inert, and Cancel (or Esc) leaves the key and the game as they were");
  else fail(`Change key: second button "${second}", game inert ${inert}, form still up ${await page.isVisible("#gate")}`);
  await page.click("#key-bar [data-forget]");
  await page.waitForSelector("#gate:not([hidden])", { timeout: 15000 });
  if (!(await page.evaluate(`localStorage.getItem(${JSON.stringify(KEY_STORAGE)})`))) ok("Forget it: the key is gone from localStorage, and the page asks for one again");
  else fail("Forget it left the key in localStorage");
}

// ---------------------------------------------------------------------------------------------
// The saves, as the server worker keeps them in IndexedDB (read from the page: the same origin)

/**
 * Every record of every IndexedDB store on the origin, as JSON (bigints as "<n>n"), by "database /
 * store". Only databases that are there are opened (opening one that isn't would make it, empty).
 */
const SAVES = `(async () => {
  const found = {};
  const json = value => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v + "n" : v instanceof Uint8Array ? new TextDecoder("latin1").decode(v) : v);
  const all = (store, how) => new Promise((resolve, reject) => { const r = store[how](); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  for (const { name } of await indexedDB.databases()) {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      for (const store of db.objectStoreNames) {
        const keys = await all(db.transaction(store).objectStore(store), "getAllKeys");
        const values = await all(db.transaction(store).objectStore(store), "getAll");
        found[name + " / " + store] = values.map((value, i) => json({ key: keys[i], value }));
      }
    } finally {
      db.close();
    }
  }
  return found;
})()`;

const saves = (page: Page) => page.evaluate(SAVES) as Promise<Record<string, string[]>>;

// ---------------------------------------------------------------------------------------------
// The play, on the fake GM

async function thePlay(browser: Browser, url: string): Promise<void> {
  await play(browser, url);
  await twoTabs(browser, url);
  await noStorage(browser, url);
}

/** The title, a character, the map, the yard's opening streamed, a line and its reply, then a reload: Continue carries the game on from IndexedDB, and it plays on. */
async function play(browser: Browser, url: string): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const origin = new URL(url).origin;
  const seen = await watch(context, origin);
  try {
    const { page, ms } = await open(context, url, `fake&size=${COLS}x${ROWS}`);
    const toTitle = ms + await waitFor(page, "Hanged Clerk of Caerwyn", "the title, drawn in the client worker from the server worker's rows", 60000);
    note(`time to the title, a first visit (nothing cached): ${toTitle} ms`);
    await theTitle(page);
    await aCharacter(page);
    await waitFor(page, "The lead:.*Hanged Clerk", "Set off: the town's map, and the lead is the hanged clerk", 60000);
    await shot(page, "map");
    await theMenu(page);
    await theOpening(page);
    await aLine(page, LINE, "What have we got", REPLY, "the fake GM's reply");
    await aReport(page);
    await theSaves(page);
    await reloadAndContinue(page);
    await aLine(page, "Who's the girl on the wall, Sergeant?", "girl on the wall, Sergeant", "smirk", "after the reload, the game plays on: the next line's reply");
    await closeAndPlayAgain(page, seen);
    stayedHome(seen, origin, "the play");
    noErrors(seen, "the play");
  } finally {
    await context.close();
  }
}

/** The title as the page has it: WebGL drawing, the loading note gone, and Esc leaving the game be (on a page, Esc dismisses things). */
async function theTitle(page: Page): Promise<void> {
  const renderer = await page.evaluate("km.renderer");
  if (renderer === "webgl") ok("the WebGL renderer is drawing");
  else fail(`renderer is ${renderer}, not webgl`);
  if (await page.isVisible("#loading")) fail("\"Loading Kingmaker…\" is still up over the title");
  else ok("\"Loading Kingmaker…\" went once the title was drawn");
  await shot(page, "title");
  await press(page, "Escape");
  await sleep(600);
  if (!(await page.isVisible("#notice")) && /Hanged Clerk of Caerwyn/.test(await text(page))) ok("Esc on the title leaves the game be");
  else fail("Esc on the title closed the game");
}

/** A character, as a player makes one: a name and a sentence, the first of three builds (the class defaults: the fake GM has none of its own), the backstory skipped, the sheet. */
async function aCharacter(page: Page): Promise<void> {
  await press(page, "n");
  await waitFor(page, "Who are you\\?", "n: character creation");
  await page.keyboard.type(NAME, { delay: 15 });
  await press(page, "Tab");
  await page.keyboard.type(CONCEPT, { delay: 5 });
  await press(page, "Enter");
  await waitFor(page, `Three ways to be ${NAME}`, "three builds, as cards", 60000);
  await shot(page, "cards");
  await press(page, "Enter");
  await waitFor(page, "Who were you, before the King sent for you\\?", "Enter takes the first: the backstory", 60000);
  // Tab to the buttons (Done picked out), ← to Skip.
  await press(page, "Tab", "ArrowLeft", "Enter");
  await waitFor(page, "Character sheet", "Skip: the sheet the rules engine made", 60000);
  await shot(page, "sheet");
  await press(page, "Enter");
}

/** m on the map: the action menu over it, made from the sheet's catalogue (town-design §1.1, step 1); Esc closes it, and the map is as it was. */
async function theMenu(page: Page): Promise<void> {
  await press(page, "m");
  await waitFor(page, "What will you do\\?", "m on the map: the action menu", 30000);
  await shot(page, "menu");
  await press(page, "Escape");
  await sleep(400);
  const screen = await text(page);
  if (!/What will you do\?/.test(screen) && /The lead:.*Hanged Clerk/s.test(screen)) ok("Esc closes the action menu, the map as it was");
  else fail("Esc left the action menu up, or the map wasn't under it");
}

/** g walks to the lead and the yard opens; the fake's opening streams in, its first words before its last; then the box is open. */
async function theOpening(page: Page): Promise<void> {
  await press(page, "g");
  await waitFor(page, "The Hanged Clerk ·", "g walks to the lead, and the yard opens", 90000);
  let early = false;
  const end = Date.now() + 60000;
  for (;;) {
    const screen = await text(page);
    if (screen.includes(OPENING.last)) break;
    if (screen.includes(OPENING.first)) early = true;
    if (Date.now() > end) throw new Error(`the fake GM's opening never finished ("${OPENING.last}")`);
    await sleep(100);
  }
  if (early) ok("the fake GM's opening streamed in: its first words were on the screen before its last");
  else fail("the fake GM's opening came whole, not streamed");
  await waitFor(page, "Say it out loud", "the opening done, the box is open", 60000);
  await shot(page, "opening");
}

/** A line said: in the talk, then the reply (`replied`: a word only it has), then the lines suggested over the box. */
async function aLine(page: Page, line: string, said: string, replied: string, what: string): Promise<void> {
  await page.keyboard.type(line, { delay: 15 });
  await press(page, "Enter");
  await waitFor(page, said, `the line is in the talk ("${line}")`, 20000);
  await waitFor(page, replied, what, 60000);
  await waitFor(page, "1–\\d into the box", "then the lines suggested, over the box", 30000);
  await shot(page, `reply-${replied}`);
}

/**
 * A problem reported from the page (M5): /report with its words in the scene's box files it at once;
 * the client worker makes the report, its game asked of the server worker (its rows, the AI service's
 * calls and docs, the host's log), and the page downloads it as kingmaker-report-<time>.json.gz; the
 * screen says where it went, to tell Claude; the download is the report (its words, where, the screen,
 * the game), gzipped. Enter puts the word away, the scene as it was.
 */
async function aReport(page: Page): Promise<void> {
  const words = "The fake GM never answers what I say";
  const downloaded = page.waitForEvent("download", { timeout: 60000 });
  await page.keyboard.type(`/report ${words}`, { delay: 10 });
  await press(page, "Enter");
  const download = await downloaded.catch(() => undefined);
  if (!download) { fail("/report: no download came"); return; }
  const name = download.suggestedFilename();
  if (/^kingmaker-report-\d{8}-\d{6}\.json\.gz$/.test(name)) ok(`/report: the page downloads ${name}`);
  else fail(`/report: the download is named ${name}`);
  // The box wraps its words, so "tell" and "Claude" may be a row apart (the rest of each row between them).
  const named = name.replace(/\./g, "\\.");
  await waitFor(page, `Downloaded ${named}.*tell.*Claude 'report ${named}'`, "the screen says where it went, to tell Claude", 20000);
  await shot(page, "report");
  const file = join(OUT, name);
  await download.saveAs(file);
  const report = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as Report;
  const game = report.game && !("error" in report.game) ? report.game : undefined;
  const ai = game && !("error" in game.ai) ? game.ai : undefined;
  if (report.kind === "kingmaker-report" && report.words === words && report.where.screen === "scene" && report.build.host === "page" && report.screens.now?.includes("The Hanged Clerk")) ok(`the download is the report: its words, where (${report.where.scene?.title}, turn ${report.where.scene?.turn}), the screen as it was, the build (stamp ${report.build.stamp})`);
  else fail(`the download isn't the report it should be: ${JSON.stringify({ kind: report.kind, words: report.words, where: report.where, build: report.build }).slice(0, 300)}`);
  if (game?.rows.transcript?.some(r => r.text === LINE) && ai?.calls.calls.some(c => c.operation === "two-part.reply") && game.log?.length) ok(`with the game the server worker gave: ${Object.values(game.rows).reduce((n, list) => n + list.length, 0)} rows, ${ai.calls.calls.length} call lines from IndexedDB, ${ai.docs.docs.length} docs, ${game.log.length} log lines`);
  else fail(`the report's game isn't the server worker's: ${JSON.stringify(report.game).slice(0, 300)}`);
  const heard = await page.evaluate(`km.heard.filter(h => h.type === "report").map(h => h.name)`) as string[];
  if (heard.includes(name)) ok("the page heard the report from the client worker");
  else fail(`km.heard has no report: ${JSON.stringify(heard)}`);
  await press(page, "Enter");
  await sleep(400);
  if (!/Report saved/.test(await text(page))) ok("Enter puts the word away, the scene as it was");
  else fail("the report's word stayed up after Enter");
}

/** IndexedDB holds the game: the simulation's rows (the character's among them) and the AI service's stores (an answer kept). */
async function theSaves(page: Page): Promise<void> {
  await page.evaluate("km.flush()");
  const found = await saves(page);
  const records = Object.values(found).flat();
  note(`IndexedDB: ${Object.entries(found).map(([store, rows]) => `${store} (${rows.length})`).join(", ") || "nothing"}`);
  if (records.some(record => record.includes(NAME))) ok(`IndexedDB holds the simulation's rows: ${NAME}'s among them`);
  else fail(`no record in IndexedDB names ${NAME}`);
  if (records.some(record => record.includes("requestHash"))) ok("IndexedDB holds the AI service's stores: its answers among them");
  else fail("no answer of the AI service's is in IndexedDB");
}

/** A reload: the title's Continue offers the game (from IndexedDB), and carries it on, the talk as it was. */
async function reloadAndContinue(page: Page): Promise<void> {
  const t0 = Date.now();
  await page.reload();
  const toTitle = (Date.now() - t0) + await waitFor(page, `Continue.*${NAME}`, "after a reload, the title's Continue offers the game (the saves came back from IndexedDB)", 60000);
  note(`time to the title, a reload (cached): ${toTitle} ms`);
  await shot(page, "continue");
  await press(page, "Enter");
  await waitFor(page, "The Hanged Clerk ·", "Continue carries the game on, in the yard", 60000);
  await waitFor(page, `What have we got.*${REPLY}`, "the talk as it was: the line and its reply", 20000);
  await waitFor(page, "Say it out loud", "the box is open", 30000);
}

/**
 * Ctrl+C closes the game: the client worker goes, the page says so, and Play again starts a new client
 * worker on a new channel, whose other end goes to the server worker as it plays on ({type: "port"}):
 * the title's Continue offers the game, and carries it on.
 */
async function closeAndPlayAgain(page: Page, seen: Watch): Promise<void> {
  await press(page, "Control+c");
  try {
    await page.waitForSelector("#notice:not([hidden])", { timeout: 15000 });
  } catch {
    throw new Error("no notice after Ctrl+C");
  }
  ok(`Ctrl+C closes the game, and the page says so ("${await page.textContent("#notice-text")}")`);
  await shot(page, "closed");
  await page.click("#notice-button");
  await waitFor(page, `Continue.*${NAME}`, "Play again: a new client worker, and the title's Continue offers the game", 30000);
  const readies = await page.evaluate(`km.heard.filter(h => h.from === "server" && h.type === "ready").length`);
  if (readies === 1 && seen.told.some(t => t.worker === "server" && t.type === "port" && t.port)) ok("the server worker played on through it (ready once), and was handed the new client's port");
  else fail(`Play again: the server worker said ready ${readies} times, and was told ${JSON.stringify(seen.told.filter(t => t.worker === "server"))}`);
  await press(page, "Enter");
  await waitFor(page, "The Hanged Clerk ·.*smirk", "Continue carries the game on, in the yard, as it was", 60000);
}

/** The game open in a second tab: it's told so and starts nothing of its own; it takes the game over, and the first tab says so. */
async function twoTabs(browser: Browser, url: string): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const origin = new URL(url).origin;
  const seen = await watch(context, origin);
  try {
    const { page: a } = await open(context, url, `fake&size=${COLS}x${ROWS}`);
    await waitFor(a, "Hanged Clerk of Caerwyn", "tab A: the title");
    const { page: b } = await open(context, url, `fake&size=${COLS}x${ROWS}`);
    try {
      await b.waitForSelector("#notice:not([hidden])", { timeout: 15000 });
    } catch {
      throw new Error("tab B, opened while tab A plays, wasn't told the game is open in another tab");
    }
    const said = await b.textContent("#notice-text");
    if (/open in another tab/.test(said ?? "") && !(await text(b)).trim()) ok(`tab B, opened while A plays, is told so and starts no game of its own ("${said}")`);
    else fail(`tab B: "${said}", its screen: "${(await text(b)).trim().slice(0, 60)}"`);
    await shot(b, "second-tab");
    await b.click("#notice-button");
    await waitFor(b, "Hanged Clerk of Caerwyn", "Play here instead: tab B has the game now", 30000);
    const told = await a.textContent("#notice-text");
    if ((await a.isVisible("#notice")) && /another tab/.test(told ?? "") && !(await a.evaluate("km.playing"))) ok(`tab A saved the game, let it go, and says so ("${told}")`);
    else fail(`tab A after B took the game: "${told}", playing: ${await a.evaluate("km.playing")}`);
    stayedHome(seen, origin, "two tabs");
  } finally {
    await context.close();
  }
}

/** A browser that won't let the page keep anything (IndexedDB refused, as with this site's data blocked): the game plays, and the bar says it won't be kept. */
async function noStorage(browser: Browser, url: string): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const refuse = `IDBFactory.prototype.open = function () { throw new DOMException("The user denied permission to access the database.", "SecurityError"); };\n`;
  await watch(context, new URL(url).origin, refuse);
  try {
    const { page } = await open(context, url, `fake&size=${COLS}x${ROWS}`);
    await waitFor(page, "Hanged Clerk of Caerwyn", "without IndexedDB: the title", 60000);
    const said = await page.innerText("#key-bar [data-storage]").catch(() => "");
    if (said && (await page.isVisible("#key-bar [data-storage]"))) ok(`without IndexedDB the game plays, and the bar under it says it won't be kept ("${said}")`);
    else fail(`without IndexedDB the bar says "${said}"`);
    await shot(page, "no-storage");
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------
// The zoo (M6)

/**
 * ?zoo=ring: no key asked for (the zoo plays on the fake GM), the combat ring's fight on the fight's
 * screen as the page comes up; the player's turn (f skips the other side's moves to it), e ends it, the
 * other side's moves play and it comes round again; n fights it again from its start; o lists the
 * line-ups, and the third sets the dogs.
 */
async function theZoo(browser: Browser, url: string): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const origin = new URL(url).origin;
  const seen = await watch(context, origin);
  try {
    const { page } = await open(context, url, `zoo=ring&size=${COLS}x${ROWS}`);
    await bothStarted(page, seen, "?zoo=ring", { fake: "dev", key: false });
    if (!(await page.isVisible("#gate"))) ok("?zoo=ring: no key asked for (the zoo plays on the fake GM)");
    else fail("?zoo=ring: the page asked for a key");
    await waitFor(page, "The combat ring · Round 1", "?zoo=ring: the combat ring's fight, on the fight's screen", 60000);
    await waitFor(page, "Master Sallow|Josiah Sallow", "Sallow and the Crakes in the order across the top", 10000);
    await toMyTurn(page, "the player's turn comes round (f skips the other side's moves to it)");
    await shot(page, "zoo-ring");
    await press(page, "e");
    await waitFor(page, "One move at a time|Round 2 · ", "e ends the turn: the other side's moves play", 20000);
    // Nothing pressed: the page host's fight clock plays the other side's turns one at a time, each when the last has played.
    await waitFor(page, "▶ YOUR TURN.*Round 2 · ", "and they play on their own, a turn at a time, to the player's turn in round 2 (no F pressed)", 60000);
    await shot(page, "zoo-ring-round-2");
    await press(page, "n");
    await waitFor(page, "The combat ring · Round 1", "n fights it again: a new fight, from round 1", 30000);
    await press(page, "o");
    await waitFor(page, "Other foes.*A pack of dogs", "o lists the line-ups to fight instead", 10000);
    await shot(page, "zoo-foes");
    await press(page, "3");
    await waitFor(page, "brindle|mastiff", "the third picked: the pack of dogs in the ring", 30000);
    await shot(page, "zoo-dogs");
    stayedHome(seen, origin, "the zoo");
    noErrors(seen, "the zoo");
  } finally {
    await context.close();
  }
}

/**
 * The player's turn on the fight's screen (its side panel's "▶ YOUR TURN", in capitals: the keys' "skip
 * to your turn" isn't it), skipping the other side's moves to it (f) while they play; `round`, the
 * round it must be.
 */
async function toMyTurn(page: Page, what: string, round = 1): Promise<void> {
  const mine = `▶ YOUR TURN.*Round ${round} · `;
  const end = Date.now() + 60000;
  while (!(await until(page, `new RegExp(${JSON.stringify(mine)}, "s").test(km.text())`, 1500))) {
    if (Date.now() > end) { await shot(page, "failed"); throw new Error(`${what} (no /${mine}/ within 60s)`); }
    await press(page, "f");
  }
  ok(what);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
