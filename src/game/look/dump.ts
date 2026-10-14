/**
 * Headless frames of the gallery's vignettes, for tests, debugging and anyone without a terminal
 * to hand:
 *
 *   node --no-warnings src/game/look/dump.ts                       # list the vignettes
 *   node --no-warnings src/game/look/dump.ts rat --t 0,8000,15000  # three frames of the Rat
 *   node --no-warnings src/game/look/dump.ts yard --ansi --w 120 --h 40 --glyphs nerd
 *   node --no-warnings src/game/look/dump.ts all --plain           # one frame of each
 *   node --no-warnings src/game/look/dump.ts dust --json frames.json --t 0,11000,13000
 *
 * Output is plain text unless stdout is a terminal (or --ansi); --json writes every cell
 * ([glyph, fg, bg, bold]) for tools that rasterize frames. Frames are exact: a vignette at time t
 * is rebuilt from scratch, so the same command always prints the same thing. The model is never
 * called (KM_LOOK_MODEL=off unless you set it).
 */
import { writeFileSync } from "node:fs";
import type { GlyphSet } from "./glyphs.ts";
import { VIGNETTES, frameAt, VignettePlayer, vignetteById } from "./vignettes.ts";

process.env.KM_LOOK_MODEL ??= "off";
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const id = args.find(a => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--"));
const w = Number(flag("w") ?? 100), h = Number(flag("h") ?? 34);
const glyphs = (flag("glyphs") ?? "ascii") as GlyphSet;
const json = flag("json");
const ansi = args.includes("--ansi") || (!args.includes("--plain") && !json && process.stdout.isTTY);

if (!id) {
  for (const v of VIGNETTES) process.stdout.write(`${v.id.padEnd(12)} ${v.title} (${v.length / 1000}s)\n    ${v.blurb}\n`);
  process.exit(0);
}

const ids = id === "all" ? VIGNETTES.map(v => v.id) : [id];
const frames: unknown[] = [];
for (const vid of ids) {
  const v = vignetteById(vid);
  if (!v) { process.stderr.write(`no vignette "${vid}"\n`); process.exit(1); }
  const times = (flag("t") ?? (id === "all" ? String(Math.round(v.length * 0.45)) : "0")).split(",").map(Number);
  for (const t of times) {
    const frame = frameAt(vid, t, { w, h, glyphs });
    if (json) { frames.push({ id: vid, t, ...frame.toJSON() }); continue; }
    const player = new VignettePlayer(v);
    player.seek(t);
    const caption = player.recent(t, 3).map(l => `  ${l.text}`).join("\n");
    process.stdout.write(`\n== ${v.title} @ ${(t / 1000).toFixed(1)}s ${"=".repeat(Math.max(0, w - v.title.length - 14))}\n`);
    process.stdout.write(`${ansi ? frame.toAnsi() : frame.toPlain()}\n${caption}\n`);
  }
}
if (json) { writeFileSync(json, JSON.stringify(frames)); process.stdout.write(`${frames.length} frames -> ${json}\n`); }
