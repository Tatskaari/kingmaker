/**
 * The PR preview (`npm run build:web`, which .github/workflows/preview.yml runs for GitHub Pages): a
 * static page of the game's own screens. The game needs a terminal, or the browser server and a pty
 * (`npm run web`), and its GM is a language model, so Pages can't play it; the page says how to.
 *
 * The screens are the real ones (the App, as `npm run game` draws it) for ready-made characters (a
 * wizard, and the screen checks' rogue in a scene and fighter in a fight), offline and with no
 * model calls, drawn by OpenTUI headless the way the screen checks draw them
 * (src/app/smoke/screens-check.tsx, scene-check.tsx). Each is kept as its cells and their colours,
 * and the page paints them on a canvas a cell at a time, as a terminal would: the box and block
 * characters drawn as lines and rectangles so they join up whatever the font (as xterm.js does).
 *
 *   npm run build:web                                         # dist/web/index.html
 *   node --experimental-ffi --no-warnings --import tsx src/web/preview.tsx --out somewhere/else
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CapturedFrame } from "@opentui/core";

// Offline, whatever the environment has: no GM, no looks invented, the map's ASCII glyphs (the page
// has no glyph font), and the saves somewhere that goes away.
process.env.OPENROUTER_API_KEY = "offline-preview";
process.env.KM_LOOK_MODEL = "off";
process.env.KM_GLYPHS = "ascii";
const runs = mkdtempSync(join(tmpdir(), "km-preview-"));
process.env.KM_RUNS_DIR = runs;
process.on("exit", () => rmSync(runs, { recursive: true, force: true }));

const { rgbToHex, TextAttributes } = await import("@opentui/core");
const { testRender } = await import("@opentui/react/test-utils");
const { sceneById } = await import("../../scenes/index.ts");
const { pregenSession, PREGENS } = await import("../game/combat/index.ts");
const { mapFights } = await import("../game/fights.ts");
const { registerLookCanvas } = await import("../game/look/opentui.ts");
const { Game: Core } = await import("../game/play.ts");
const { town } = await import("../game/town.ts");
const { presentCast } = await import("../runtime/brief.ts");
const { forceEnding } = await import("../runtime/engine.ts");
const { sheetData } = await import("../rules/dnd.ts");
const { srdAttribution } = await import("../rules/spells.ts");
const { buildWorld, joinWorld } = await import("../world/scene-world.ts");
const { App } = await import("../app/app.tsx");
const { Game } = await import("../app/game.ts");
const { TIME_WORDS } = await import("../app/story.ts");
const { C } = await import("../app/theme.ts");
type AppGame = InstanceType<typeof Game>;
type Line = AppGame["lines"][number];

const flag = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const OUT = resolve(flag("out") ?? "dist/web");
const COLS = 130, ROWS = 42;

registerLookCanvas();

// ---------------------------------------------------------------------------------------------
// The screens.

interface Shot { id: string; title: string; caption: string; frame: CapturedFrame; text: string }
const shots: Shot[] = [];

/** The game's whole screen for `game` as it is, after `then` (a click, say) if there is one. */
async function shoot(id: string, title: string, caption: string, game: AppGame, then?: (s: Awaited<ReturnType<typeof testRender>>) => Promise<void>): Promise<void> {
  const setup = await testRender(<App game={game} onQuit={() => {}} />, { width: COLS, height: ROWS });
  // The game updates itself (its effects, its timers), not a test's act(): React needn't warn of it.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  await setup.renderOnce();
  await setup.renderOnce();
  if (then) { await then(setup); await setup.renderOnce(); await setup.renderOnce(); }
  shots.push({ id, title, caption, frame: setup.captureSpans(), text: setup.captureCharFrame() });
  await setup.dispose();
}

/** Where some text is on the screen, in cells (its middle); undefined when it isn't there. */
function find(frame: string, text: string): { x: number; y: number } | undefined {
  const rows = frame.split("\n");
  const y = rows.findIndex(r => r.includes(text));
  return y < 0 ? undefined : { x: [...rows[y]!].join("").indexOf(text) + Math.floor(text.length / 2), y };
}

const NAME = "Pell Marrow";
const wizard = await Core.create({ player: `${NAME}: ${PREGENS.wizard!.concept}`, level: 3, seed: 7, build: PREGENS.wizard!.build, explorer: town, fights: mapFights() });
const opening = `${TIME_WORDS[wizard.state.story.time]}. ${sceneById(wizard.session.sceneId).hook}`;
const playing = () => {
  const game = new Game();
  game.core = wizard;
  game.messages = [opening];
  return game;
};

{
  const game = playing();
  game.screen = "title";
  await shoot("title", "The title", "Continue is the game the next screens are from.", game);
}
{
  const game = playing();
  game.screen = "created";
  game.creating = { name: NAME, concept: PREGENS.wizard!.concept };
  game.sheet = await sheetData(wizard.session);
  await shoot("created", "A character, made", "The rules engine's sheet (SRD 5.2.1) for a 3rd-level wizard, as character creation leaves it.", game);
}
{
  const game = playing();
  game.screen = "explore";
  await shoot("map", "Caerwyn", "Exploring the town on the isometric map: click to walk, right-click someone or something for what you can do.", game);
}
{
  const game = playing();
  game.screen = "explore";
  await game.showSheet();
  await shoot("spell", "A spell on the sheet", "A spell on the character sheet, clicked: its card, what it does in this game at the character's own numbers, and the SRD's own words.", game, async setup => {
    // To the spells by their page's tab (the first "Spells" on screen), then a click on one.
    const tab = find(setup.captureCharFrame(), "Spells");
    if (tab) { await setup.mockMouse.click(tab.x, tab.y); await setup.renderOnce(); }
    const at = find(setup.captureCharFrame(), "Burning Hands");
    if (!at) throw new Error(`Burning Hands isn't on the sheet:\n${setup.captureCharFrame()}`);
    await setup.mockMouse.click(at.x, at.y);
  });
}
{
  // A scene's screen with a conversation made up for the screen checks (scene-check.tsx): offline, the GM can't speak.
  const session = await pregenSession({ pregen: "rogue", name: "Tamsin Vell", level: 3, seed: 3, sceneId: "hanged-clerk" });
  const scene = sceneById("hanged-clerk");
  Object.assign(session, { beat: scene.start });
  const cast = presentCast(scene, session);
  session.world = buildWorld(scene.id, scene.world!, cast.map(c => ({ id: c.id, name: c.name })), session.player);
  joinWorld(session.world, cast.map(c => ({ id: c.id, name: c.name })), 0);
  const game = new Game();
  game.core = { session, state: { version: 1, id: "preview", mode: "scene", story: { time: "morning", played: [], flags: {} }, explore: {}, recent: [] }, observe: () => ({ mode: "scene", text: "", actions: [] }) } as unknown as AppGame["core"];
  game.screen = "scene";
  game.lines = [
    { kind: "header", speaker: "system", name: scene.title, text: scene.hook },
    { kind: "narration", speaker: "gm", text: "The yard behind the King's Granary smells of wet grain and pigeons. Wendell Prout turns slowly on the sack hoist above the shut loft door, and a scrawny boy in enormous boots is lobbing gutter stones at him with a running commentary." },
    { kind: "dialogue", speaker: "kell", name: "Sergeant Agnes Kell", text: "“Sergeant Kell, of the watch. The Captain says suicide.” She does not say what she says. “Investigator.”" },
    { kind: "player", speaker: "player", name: "Tamsin Vell", text: "\"Morning, Sergeant. What have we got?\" I look up at the body, then at the boy with the stones, and I take out my notebook so that everybody can see that I have one too." },
    { kind: "roll", speaker: "dice", text: "Medicine check to examine Prout for signs he was killed before he was hanged: 11 + 1 = 12 vs DC 12: success" },
    { kind: "narration", speaker: "gm", text: "Up close, from the loft ladder, Prout's neck tells a different story from the Captain's: the rope mark rides high and clean, and under it, lower down, there is a second, darker bruise where a thumb pressed hard.\n\nSomebody held him first. The rope came after." },
    { kind: "player", speaker: "player", name: "Tamsin Vell", text: "*throws my javelin at the rope to bring him down*" },
    { kind: "info", speaker: "dice", text: "You no longer have your javelin" },
    { kind: "dialogue", speaker: "kell", name: "Sergeant Agnes Kell", text: "“That's a javelin in the King's granary wall, investigator.” She writes it down. “Noted.”" },
  ] satisfies Line[];
  game.choices = [
    { id: "say_1", label: "“Who cut him down last time, Sergeant?”", kind: "say" },
    { id: "say_2", label: "*looks at the girl's fist*", kind: "say" },
  ];
  await shoot("scene", "A scene", "A scene, played in plain words: the GM's reply, the dice the rules rolled, and the scene's place on the map beside it. The conversation, and the rogue having it, are the screen check's, made up for it: offline, the GM can't speak.", game);
}
{
  // The fight at the Heron, as the screens check sets it up: a fighter, at the start of their turn.
  const session = await pregenSession({ pregen: "fighter", level: 3, seed: 2 });
  Object.assign(session, { sceneId: "heron-warehouse", beat: "midnight", entered: ["sallow"] });
  session.established.push("Master Sallow has come to the Heron.");
  const heron = sceneById("heron-warehouse");
  const cast = presentCast(heron, session);
  session.world = buildWorld(heron.id, heron.world!, cast.map(c => ({ id: c.id, name: c.name })), session.player);
  joinWorld(session.world, cast.map(c => ({ id: c.id, name: c.name, ...(c.members ? { members: c.members } : {}) })), 0);
  forceEnding(session, "fight");
  const state = { version: 1 as const, id: "preview-fight", mode: "combat" as const, story: { time: "night" as const, played: [], flags: {} }, explore: {}, recent: [] };
  const fight = await mapFights().start(state, session);
  const game = new Game();
  game.core = { state, session, currentFight: fight, observe: () => ({ mode: "combat", text: "", actions: [] }) } as unknown as AppGame["core"];
  game.screen = "combat";
  await shoot("fight", "A fight", "Tactical combat on the Heron's own floor, by the rules engine, for a ready-made fighter at the start of their turn: click a blue tile to move, someone to aim at, and them again to attack.", game);
}

// ---------------------------------------------------------------------------------------------
// The page.

/** A frame as rows of runs, [text, fg, bg, style, cells], the colours by index into one palette for the page; style is 1 bold, 2 italic, 4 underline. */
const palette: string[] = [];
const colour = (hex: string) => { let i = palette.indexOf(hex); if (i < 0) { i = palette.length; palette.push(hex); } return i; };
const blend = (a: string, b: string, t: number) => `#${[1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, "0")).join("")}`;
type Run = [string, number, number, number, number];

function rowsOf(frame: CapturedFrame): Run[][] {
  return frame.lines.map(line => line.spans.map(s => {
    const a = s.attributes & 0xff;
    let fg = s.fg.a > 0 ? rgbToHex(s.fg).slice(0, 7) : C.text;
    let bg = s.bg.a > 0 ? rgbToHex(s.bg).slice(0, 7) : C.bg;
    if (a & TextAttributes.INVERSE) [fg, bg] = [bg, fg];
    if (a & TextAttributes.DIM) fg = blend(fg, bg, 0.4);
    if (a & TextAttributes.HIDDEN) fg = bg;
    const style = (a & TextAttributes.BOLD ? 1 : 0) | (a & TextAttributes.ITALIC ? 2 : 0) | (a & TextAttributes.UNDERLINE ? 4 : 0);
    return [s.text, colour(fg), colour(bg), style, s.width] satisfies Run;
  }));
}

/** What paints the screens on the page, inlined (a script tag's end can't be in it). */
const PAINT = readFileSync(new URL("./preview-paint.js", import.meta.url), "utf8");
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const commit = (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { return ""; } })();
const screens = shots.map(s => ({ id: s.id, cols: s.frame.cols, rows: rowsOf(s.frame) }));
const data = JSON.stringify({ palette, background: C.bg, screens }).replace(/</g, "\\u003c");

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Kingmaker V2</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='2' fill='%2315131a'/%3E%3Cpath d='M3 12h10l1-7-3 2.5L8 3 5 7.5 2 5z' fill='%23e8c170'/%3E%3C/svg%3E">
<style>
  :root { --bg: ${C.bg}; --panel: ${C.panel}; --border: ${C.border}; --title: ${C.title}; --text: ${C.text}; --dim: ${C.dim}; }
  * { box-sizing: border-box; }
  html { background: var(--bg); }
  body { margin: 0 auto; padding: 32px 16px 64px; max-width: 1240px; background: var(--bg); color: var(--text); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1 { margin: 0 0 4px; color: var(--title); font-size: 30px; letter-spacing: 0.04em; }
  h2 { margin: 40px 0 8px; color: var(--title); font-size: 19px; }
  p { max-width: 74ch; }
  a { color: var(--title); }
  .sub { margin: 0; color: var(--dim); }
  code, pre { font-family: "Adwaita Mono", "JetBrains Mono", "Cascadia Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace; font-size: 14px; }
  pre.run { max-width: 100%; overflow-x: auto; padding: 12px 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; line-height: 1.5; }
  pre.run .note { color: var(--dim); }
  nav { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 24px 0 0; }
  figure { margin: 0; }
  figcaption { margin: 8px 0 0; color: var(--dim); max-width: 90ch; }
  .screen { display: block; max-width: 100%; height: auto; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); }
  details { margin: 6px 0 0; color: var(--dim); }
  details pre { overflow-x: auto; padding: 8px; background: var(--panel); color: var(--text); line-height: 1.2; }
  footer { margin: 56px 0 0; padding: 16px 0 0; border-top: 1px solid var(--border); color: var(--dim); font-size: 14px; }
</style>
</head>
<body>
<h1>KINGMAKER V2</h1>
<p class="sub">The Hanged Clerk of Caerwyn${commit ? ` · this preview is of ${esc(commit)}` : ""}</p>
<p>A murder mystery in a terminal. You make a character, walk the town on the map and talk your way through scenes that a language model runs as the Game Master, under D&amp;D rules (the SRD 5.2.1) kept by a rules engine, and the fights are tactical, on the map.</p>
<p>The game needs a terminal, or a small server that runs it in one for the browser, and a GM to talk to, so this page can't play it. What it shows are the game's own screens from this build, drawn offline for a ready-made character, cell for cell as a terminal shows them.</p>
<pre class="run">npm install
npm run game                <span class="note"># in a terminal (80x24 or bigger); the GM needs OPENROUTER_API_KEY</span>
npm run web                 <span class="note"># or in a browser, at http://127.0.0.1:7311/</span>
npm run web -- --offline    <span class="note"># no GM: make a character and walk the town</span></pre>
<nav>${shots.map(s => `<a href="#${s.id}">${esc(s.title)}</a>`).join("")}</nav>
${shots.map(s => `<section id="${s.id}">
<h2>${esc(s.title)}</h2>
<figure>
<canvas class="screen" data-screen="${s.id}" width="${s.frame.cols * 9}" height="${s.frame.rows * 19}" role="img" aria-label="${esc(`${s.title}: ${s.caption}`)}"></canvas>
<figcaption>${esc(s.caption)}</figcaption>
</figure>
<details><summary>As text</summary><pre>${esc(s.text.replace(/[ \t]+$/gm, ""))}</pre></details>
</section>`).join("\n")}
<footer><p>${esc(srdAttribution())}</p></footer>
<script type="application/json" id="screens">${data}</script>
<script>${PAINT}</script>
</body>
</html>
`;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "index.html"), page);
console.log(`${shots.length} screens: ${join(OUT, "index.html")} (${Math.round(page.length / 1024)} KB)`);
process.exit(0);
