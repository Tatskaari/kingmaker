import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, firefox, type Page } from "playwright";
import type { LampFrame } from "../../game/look/lamp-art.ts";
import type { StyledLine } from "../../game/types.ts";
import { laneGame, putSaves, type SaveFile } from "./lane.ts";
import { DEFAULT_BASE, serveStatic } from "./serve.ts";

/**
 * Pictures of the static build, for seeing how it looks rather than checking that it works: the
 * granary lane on a new game's first morning, the zoo's Front Hall, and a sheet of every look a door
 * has on both faces of a wall (src/game/look/door-sheet.ts, written straight to the page's terminal
 * while the page waits for a key), at each device scale asked for (1x, and 1.2x as Firefox draws at
 * 120%), with the doors' pictures on and off (?doors=off), in headless Chromium with a real device
 * scale factor (Playwright's emulated one magnifies xterm's WebGL canvas: src/web/check.ts), or in
 * Firefox (whose emulated one is real: its canvases are drawn at the scale).
 *
 *   node --no-warnings src/web/static/shoot.ts [--dir dist/web] [--no-build] [--out runs/web-shots/<run>]
 *        [--scales 1,1.2] [--doors on,off] [--only lane,hall,doors] [--browser chromium|firefox]
 *
 * Each picture is <view>-<scale>x-doors-<on|off>.png (firefox-<view>-... in Firefox), the terminal's
 * text beside it (.txt). --dir shoots another build (an older one, for a before and after: it has no
 * door sheet); --no-build shoots dist/web as it is.
 *
 * The lamp posts (src/web/page/lamps.ts) have pictures of their own, with the lamps on and off
 * (?lamps=off: the doors still drawn, so it's the lamps alone that change):
 * <view>-<scale>x-lamps-<on|off>.png. `lamps` is a sheet of every look a lamp post has
 * (src/game/look/lamp-sheet.ts, left to right: by the hour, lit, put out, soaked, broken) on the map
 * (above) and on a place from above (below), by day (left) and at night (right); `lamp-day` and
 * `lamp-night` are the granary lane's lamp posts in a game put in the browser's saves
 * (src/web/static/lane.ts), each with a crop round every lamp post in view (-crop-<lamp>.png).
 *
 *        [--lamps on,off] [--only lamps,lamp-day,lamp-night]
 */

const { values } = parseArgs({
  options: {
    dir: { type: "string" }, "no-build": { type: "boolean" }, out: { type: "string" },
    scales: { type: "string" }, doors: { type: "string" }, only: { type: "string" }, browser: { type: "string" },
    lamps: { type: "string" },
  },
});
const FIREFOX = values.browser === "firefox";
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DIR = resolve(values.dir ?? join(ROOT, "dist", "web"));
const RUN = new Date().toLocaleString("sv").replace(/[-:]/g, "").replace(" ", "-");
const OUT = resolve(values.out ?? join(ROOT, "runs", "web-shots", RUN));
const SCALES = (values.scales ?? "1,1.2").split(",").map(Number).filter(n => n > 0);
const DOORS = (values.doors ?? "on,off").split(",").filter(d => d === "on" || d === "off");
const VIEWS = ["lane", "hall", "doors"].filter(v => (values.only ? values.only.split(",").includes(v) : v !== "doors" || !values.dir));
const LAMPS = (values.lamps ?? "on,off").split(",").filter(d => d === "on" || d === "off");
/** The lamps' own views: their pictures go on and off with ?lamps=off. */
const LAMP_VIEWS = ["lamps", "lamp-day", "lamp-night"].filter(v => (values.only ? values.only.split(",").includes(v) : v !== "lamps" || !values.dir));
// The static check's screen: 130x42 cells of 9x18 CSS pixels, and the page's frame round them.
const COLS = 130, ROWS = 42;
const WINDOW = { width: COLS * 9 + 20, height: ROWS * 18 + 16 + 26 };

if (!values.dir && !values["no-build"]) {
  const built = spawnSync(process.execPath, ["--no-warnings", "src/web/static/build.ts"], { cwd: ROOT, encoding: "utf8" });
  if (built.status !== 0) throw new Error(`the build failed:\n${built.stdout}${built.stderr}`);
}
if (!existsSync(join(DIR, "index.html"))) throw new Error(`no build in ${DIR}`);
mkdirSync(OUT, { recursive: true });

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const text = (page: Page) => page.evaluate("km.text()") as Promise<string>;

/** Polls the page's screen (its CSP forbids eval, which waitForFunction's strings need) until it matches. */
async function waitFor(page: Page, pattern: string, timeout = 90000): Promise<void> {
  const end = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate(`window.km ? new RegExp(${JSON.stringify(pattern)}, "s").test(km.text()) : false`)) return;
    if (Date.now() > end) throw new Error(`no /${pattern}/ on the screen within ${timeout / 1000}s`);
    await sleep(150);
  }
}

async function press(page: Page, ...keys: string[]): Promise<void> {
  for (const key of keys) { await page.keyboard.press(key); await sleep(120); }
}

/** The door sheet as the terminal's bytes: its doors (the OSC the page listens for), then the frame, as the game sends them. */
async function doorSheetBytes(): Promise<string> {
  process.env.KM_GLYPHS = "kingmaker";
  const { doorSheet, DOOR_SHEET_CAMERA } = await import("../../game/look/door-sheet.ts");
  const { mapDoors, overlaySequence } = await import("../../game/look/overlay.ts");
  const { Picks, render, toAnsi } = await import("../../game/map/index.ts");
  const { map, doors } = doorSheet();
  const pick = new Picks({ doors: true });
  const lines = render(map, doors, DOOR_SHEET_CAMERA, { w: COLS, h: ROWS }, { cutaway: false, time: "afternoon", t: 0, pick });
  const osc = overlaySequence({ cols: COLS, rows: ROWS, doors: mapDoors(pick, lines) });
  return `\x1b[?25l\x1b[2J\x1b[H${osc}\x1b[?2026h${toAnsi(lines).split("\n").join("\r\n")}\x1b[?2026l`;
}

/** To the view: a new game's first morning (the lane by the granary gate), the zoo (z on the title), or the door sheet. */
async function open(page: Page, view: string): Promise<void> {
  if (view === "doors") {
    // The page waits for a key, so nothing else draws: the sheet goes straight to its terminal.
    await page.waitForSelector("#gate:not([hidden])", { timeout: 30000 });
    await page.evaluate(`document.getElementById("gate").hidden = true; document.getElementById("frame").inert = false`);
    await page.evaluate(`km.term.write(${JSON.stringify(await doorSheetBytes())})`);
    return;
  }
  await waitFor(page, "Hanged Clerk of Caerwyn");
  if (view === "hall") {
    await press(page, "z");
    await waitFor(page, "Next: Welcome to the Zoo");
    return;
  }
  await press(page, "n");
  await waitFor(page, "Who are you\\?");
  await page.keyboard.type("Tamsin Vell", { delay: 10 });
  await press(page, "Tab");
  await page.keyboard.type("a disgraced palace auditor with a ledger-keeper's eye and a borrowed rapier", { delay: 3 });
  await press(page, "Enter");
  await waitFor(page, "Character sheet.*AC \\d+");
  await press(page, "Enter");
  await waitFor(page, "The lead:.*Hanged Clerk");
}

/**
 * The lamp sheet as the terminal's bytes: every look a lamp post has on the map (above) and on a
 * place from above (below), by day (left) and at night (right), and their lamps (the OSC), as the
 * game sends them.
 */
async function lampSheetBytes(): Promise<string> {
  process.env.KM_GLYPHS = "kingmaker";
  const { LAMP_SHEET_CAMERA, lampSheet, lampStage } = await import("../../game/look/lamp-sheet.ts");
  const { mapLamps, moveLamp, stageLamps } = await import("../../game/look/lamps.ts");
  const { overlaySequence } = await import("../../game/look/overlay.ts");
  const { dressingFor } = await import("../../game/look/dressings.ts");
  const { renderStage, StagePicks } = await import("../../game/look/stage.ts");
  const { Picks, render, toAnsi } = await import("../../game/map/index.ts");
  const half = Math.floor((COLS - 2) / 2), top = 26;
  const blocks: Array<{ lines: StyledLine[]; lamps: ReturnType<typeof mapLamps>; x: number; y: number }> = [];
  for (const [i, time] of (["morning", "night"] as const).entries()) {
    const { map, lamps } = lampSheet(time);
    const pick = new Picks({ doors: true });
    const lines = render(map, lamps, LAMP_SHEET_CAMERA, { w: half, h: top }, { cutaway: false, time, t: 0, pick });
    blocks.push({ lines, lamps: mapLamps(pick, lines), x: i * (half + 2), y: 0 });
    const world = lampStage();
    const stage = new StagePicks({ doors: true });
    const canvas = renderStage(world, dressingFor(world.scene), { w: half, h: ROWS - top, t: 0, time, pick: stage });
    blocks.push({ lines: canvas.toLines(), lamps: stageLamps(stage), x: i * (half + 2), y: top });
  }
  // Two by two: the night's beside the day's, a gap between.
  const frame: StyledLine[] = Array.from({ length: ROWS }, () => []);
  for (const b of blocks) b.lines.forEach((line, k) => { const row = frame[b.y + k]; if (row) row.push(...(b.x ? [{ text: "  " }] : []), ...line); });
  const lamps = blocks.flatMap(b => b.lamps.flatMap(l => moveLamp(l, b.x, b.y, () => true) ?? []));
  const sheet: LampFrame = { cols: COLS, rows: ROWS, doors: [], lamps };
  return `\x1b[?25l\x1b[2J\x1b[H${overlaySequence(sheet)}\x1b[?2026h${toAnsi(frame).split("\n").join("\r\n")}\x1b[?2026l`;
}

/** The lane's lamp post games (src/web/static/lane.ts), made once. */
const laneGames: Partial<Record<"morning" | "night", SaveFile[]>> = {};

/** To a lamp view: the lamp sheet, or the granary lane's lamp posts by day or at night, in a game put in the browser's saves. */
async function openLamps(page: Page, view: string): Promise<void> {
  if (view === "lamps") {
    // As the door sheet: the page waits for a key, so nothing else draws.
    await page.waitForSelector("#gate:not([hidden])", { timeout: 30000 });
    await page.evaluate(`document.getElementById("gate").hidden = true; document.getElementById("frame").inert = false`);
    await page.evaluate(`km.term.write(${JSON.stringify(await lampSheetBytes())})`);
    return;
  }
  const time = view === "lamp-day" ? "morning" : "night";
  const files = (laneGames[time] ??= await laneGame(join(OUT, `fixture-lane-${time}`), time));
  await waitFor(page, "Hanged Clerk of Caerwyn");
  await putSaves(page, files);
  await page.reload();
  await waitFor(page, "Continue.*Vesper Hale");
  await press(page, "Enter");
  await waitFor(page, "The lead:.*Hanged Clerk");
}

const { server, url } = await serveStatic(DIR, DEFAULT_BASE, 0);
const shots: string[] = [];
try {
  for (const scale of SCALES) {
    const browser = FIREFOX ? await firefox.launch() : await chromium.launch({ args: [`--force-device-scale-factor=${scale}`, `--window-size=${WINDOW.width},${WINDOW.height}`] });
    try {
      for (const view of VIEWS) for (const doors of DOORS) {
        const context = FIREFOX ? await browser.newContext({ viewport: WINDOW, deviceScaleFactor: scale }) : await browser.newContext({ viewport: null });
        const page = await context.newPage();
        // The door sheet has the page wait for a key (no ?offline), so the game never starts and draws over it.
        await page.goto(`${url}?size=${COLS}x${ROWS}${view === "doors" ? "" : "&offline"}${doors === "off" ? "&doors=off" : ""}`);
        await open(page, view);
        // The fonts, the first frames, and the doors after them.
        await sleep(1500);
        const name = `${FIREFOX ? "firefox-" : ""}${view}-${scale}x-doors-${doors}`;
        await page.screenshot({ path: join(OUT, `${name}.png`) });
        writeFileSync(join(OUT, `${name}.txt`), await text(page));
        shots.push(join(OUT, `${name}.png`));
        console.log(`${name}.png (devicePixelRatio ${await page.evaluate("devicePixelRatio")})`);
        await context.close();
      }
      for (const view of LAMP_VIEWS) for (const lamps of LAMPS) {
        const context = FIREFOX ? await browser.newContext({ viewport: WINDOW, deviceScaleFactor: scale }) : await browser.newContext({ viewport: null });
        const page = await context.newPage();
        // The sheet has the page wait for a key (no ?offline); the lane is played offline.
        await page.goto(`${url}?size=${COLS}x${ROWS}${view === "lamps" ? "" : "&offline"}${lamps === "off" ? "&lamps=off" : ""}`);
        await openLamps(page, view);
        await sleep(1500);
        const name = `${FIREFOX ? "firefox-" : ""}${view}-${scale}x-lamps-${lamps}`;
        await page.screenshot({ path: join(OUT, `${name}.png`) });
        writeFileSync(join(OUT, `${name}.txt`), await text(page));
        shots.push(join(OUT, `${name}.png`));
        console.log(`${name}.png (devicePixelRatio ${await page.evaluate("devicePixelRatio")})`);
        if (view !== "lamps") {
          // Each lamp post in view, close up: 13 cells across, 6 down, round its lantern (the game says where, lamps on or off).
          const where = (await page.evaluate("km.doors && km.doors.frame && km.doors.frame.lamps ? km.doors.frame.lamps.map(l => ({ id: l.id, x: l.x, y: l.y })) : []")) as Array<{ id: string; x: number; y: number }>;
          const box = (await page.evaluate(`(() => { const r = document.querySelector(".xterm-screen").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width / km.term.cols, h: r.height / km.term.rows }; })()`)) as { x: number; y: number; w: number; h: number };
          for (const l of where) {
            const crop = `${name}-crop-${l.id.replace(/^.*:/, "").replace(/\W+/g, "-")}.png`;
            await page.screenshot({ path: join(OUT, crop), clip: { x: box.x + (l.x - 6) * box.w, y: box.y + (l.y - 3) * box.h, width: 13 * box.w, height: 6 * box.h } });
            shots.push(join(OUT, crop));
          }
        }
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}
console.log(`${shots.length} pictures in ${OUT}`);
