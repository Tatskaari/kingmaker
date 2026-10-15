import { createCliRenderer, TextAttributes } from "@opentui/core";
import { createRoot, useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import type { TimeOfDay } from "./appearance.ts";
import { detectGlyphSet, type GlyphSet } from "./glyphs.ts";
import { inventionCalls, lastInventionError, lookCache } from "./invent.ts";
import { registerLookCanvas } from "./opentui.ts";
import type { Weather } from "./terrain.ts";
import { VIGNETTES, VignettePlayer, type LogLine } from "./vignettes.ts";

/**
 * The look gallery: animated vignettes of the world view, played on real scene worlds with the
 * real rules and physics.
 *
 *   node --experimental-ffi --no-warnings --import tsx src/game/look/gallery.tsx [vignette] [--glyphs kingmaker|nerd|ascii|plain]
 *
 * Keys: ←/→ or 1-8 change vignette · space pause · r restart · g glyph set · t time of day ·
 * w weather · q quit. Needs a real terminal (truecolor; Kingmaker Glyphs for the kingmaker glyph
 * set, `npm run glyphs`; a Nerd Font for the nerd one).
 * Names the rules don't know get looks from Luna if OPENROUTER_API_KEY is set (cached in
 * runs/look-cache.json; KM_LOOK_MODEL=off to stay offline).
 */

const C = { bg: "#0e0d12", panel: "#16141c", border: "#3a3446", title: "#e8c170", text: "#ddd5c4", dim: "#8a8273", faint: "#5c564d", rules: "#ffd166", gm: "#e9e2d0", key: "#c9a24a", tabOn: "#2a2436" };
const TIMES: Array<TimeOfDay | undefined> = [undefined, "morning", "afternoon", "evening", "night"];
const WEATHERS: Array<Weather | undefined> = [undefined, "drizzle", "rain", "clear"];
const GLYPHS: GlyphSet[] = ["ascii", "nerd", "plain", "kingmaker"];
const NEEDS: Partial<Record<GlyphSet, string>> = { nerd: " (needs a Nerd Font, Mono best)", kingmaker: " (needs Kingmaker Glyphs: npm run glyphs)" };
const HOLD = 2000;

/** Time, the player and the settings: kept out of React so the canvas can ask for frames at 30 fps. */
class Controller {
  player: VignettePlayer;
  started = performance.now();
  pausedAt: number | undefined;
  glyphs: GlyphSet;
  time: TimeOfDay | undefined;
  weather: Weather | undefined;
  frames = 0;
  fps = 0;
  private fpsAt = performance.now();
  constructor(index: number, glyphs: GlyphSet) { this.player = new VignettePlayer(VIGNETTES[index]!); this.glyphs = glyphs; }
  select(index: number): void { this.player = new VignettePlayer(VIGNETTES[index]!); this.started = performance.now(); if (this.pausedAt !== undefined) this.pausedAt = this.started; }
  restart(): void { this.player.reset(); this.started = performance.now(); if (this.pausedAt !== undefined) this.pausedAt = this.started; }
  togglePause(): void { const now = performance.now(); if (this.pausedAt === undefined) this.pausedAt = now; else { this.started += now - this.pausedAt; this.pausedAt = undefined; } }
  /** Milliseconds into the vignette (it holds its last frame a moment, then starts again). */
  elapsed(now = performance.now()): number {
    const len = this.player.vignette.length;
    let e = (this.pausedAt ?? now) - this.started;
    if (e > len + HOLD) { this.started = now; this.player.reset(); e = 0; }
    return Math.min(e, len);
  }
  frame(w: number, h: number, now: number) {
    this.frames++;
    if (now - this.fpsAt > 1000) { this.fps = Math.round((this.frames * 1000) / (now - this.fpsAt)); this.frames = 0; this.fpsAt = now; }
    return this.player.frame(this.elapsed(now), { w, h, glyphs: this.glyphs, ...(this.time ? { time: this.time } : {}), ...(this.weather ? { weather: this.weather } : {}) });
  }
}

function wrap(text: string, width: number, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) { out.push(line); line = ""; }
    line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  if (out.length > max) { out.length = max; out[max - 1] = `${out[max - 1]!.slice(0, Math.max(0, width - 1))}…`; }
  return out;
}

const logColor = (l: LogLine) => (l.kind === "rules" ? C.rules : l.kind === "gm" ? C.gm : l.kind === "say" ? "#c7b8f2" : C.dim);

function Gallery({ start, glyphs, onQuit }: { start: number; glyphs: GlyphSet; onQuit: () => void }) {
  const { width, height } = useTerminalDimensions();
  const ctl = useMemo(() => new Controller(start, glyphs), []);
  const [index, setIndex] = useState(start);
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(x => x + 1), 200); return () => clearInterval(id); }, []);
  const choose = (i: number) => { const n = (i + VIGNETTES.length) % VIGNETTES.length; ctl.select(n); setIndex(n); };
  useKeyboard(key => {
    if (key.name === "q" || key.name === "escape" || (key.ctrl && key.name === "c")) { onQuit(); return; }
    if (key.name === "right" || key.name === "tab") choose(index + 1);
    else if (key.name === "left") choose(index - 1);
    else if (/^[1-9]$/.test(key.name) && Number(key.name) <= VIGNETTES.length) choose(Number(key.name) - 1);
    else if (key.name === "space") ctl.togglePause();
    else if (key.name === "r") ctl.restart();
    else if (key.name === "g") ctl.glyphs = GLYPHS[(GLYPHS.indexOf(ctl.glyphs) + 1) % GLYPHS.length]!;
    else if (key.name === "t") ctl.time = TIMES[(TIMES.indexOf(ctl.time) + 1) % TIMES.length];
    else if (key.name === "w") ctl.weather = WEATHERS[(WEATHERS.indexOf(ctl.weather) + 1) % WEATHERS.length];
    setTick(x => x + 1);
  });

  const v = VIGNETTES[index]!;
  const canvasW = Math.max(20, width - 2);
  const canvasH = Math.max(8, height - 11);
  const t = ctl.elapsed();
  const recent = ctl.player.recent(t, 3);
  const blurb = wrap(v.blurb, width - 4, 2);
  const settings = [
    `glyphs: ${ctl.glyphs}${NEEDS[ctl.glyphs] ?? ""}`,
    `time: ${ctl.time ?? "as scripted"}`, `weather: ${ctl.weather ?? "as scripted"}`,
  ].join("  ·  ");
  const luna = `looks from Luna: ${lookCache().size} cached, ${inventionCalls()} call${inventionCalls() === 1 ? "" : "s"} this run${lastInventionError() ? ` (last failed: ${lastInventionError()!.slice(0, 40)})` : ""}`;
  return <box width={width} height={height} flexDirection="column" backgroundColor={C.bg}>
    <text height={1} flexShrink={0}>
      <span fg={C.title} attributes={TextAttributes.BOLD}>{" Kingmaker · the look "}</span>
      {VIGNETTES.map((x, i) => <span key={x.id} fg={i === index ? C.title : C.dim} {...(i === index ? { bg: C.tabOn, attributes: TextAttributes.BOLD } : {})}>{` ${i + 1} ${x.short} `}</span>)}
    </text>
    <box width={width} height={canvasH + 2} border borderColor={C.border} title={` ${v.title} `} titleAlignment="left" flexShrink={0}>
      <lookCanvas width={canvasW} height={canvasH} painter={(w, h, now) => ctl.frame(w, h, now)} />
    </box>
    <box flexDirection="column" paddingX={1} flexShrink={0} height={6}>
      {blurb.map((line, i) => <text key={`b${i}`} fg={C.text} height={1}>{line}</text>)}
      {recent.map((l, i) => <text key={`l${i}`} fg={logColor(l)} height={1}>{`${(l.at / 1000).toFixed(1).padStart(5)}s  ${l.text}`.slice(0, width - 3)}</text>)}
    </box>
    <text height={1} flexShrink={0} fg={C.faint}>{` ${settings}  ·  ${luna}`.slice(0, width)}</text>
    <text height={1} flexShrink={0}>
      <span fg={C.key}>{` ←/→ 1-${VIGNETTES.length}`}</span><span fg={C.dim}>{" vignette  "}</span>
      <span fg={C.key}>{"space"}</span><span fg={C.dim}>{ctl.pausedAt === undefined ? " pause  " : " play   "}</span>
      <span fg={C.key}>{"r"}</span><span fg={C.dim}>{" restart  "}</span>
      <span fg={C.key}>{"g"}</span><span fg={C.dim}>{" glyphs  "}</span>
      <span fg={C.key}>{"t"}</span><span fg={C.dim}>{" time  "}</span>
      <span fg={C.key}>{"w"}</span><span fg={C.dim}>{" weather  "}</span>
      <span fg={C.key}>{"q"}</span><span fg={C.dim}>{" quit"}</span>
      <span fg={C.faint}>{`     ${(t / 1000).toFixed(1)}s / ${(v.length / 1000).toFixed(0)}s · ${ctl.fps} fps`}</span>
    </text>
  </box>;
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("The gallery needs a real terminal. For frames without one: node --no-warnings src/game/look/dump.ts");
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const asked = args.find(a => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--"));
const start = Math.max(0, VIGNETTES.findIndex(v => v.id === asked));
const glyphs = (flag("glyphs") as GlyphSet | undefined) ?? detectGlyphSet().set;

registerLookCanvas();
const renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 30, maxFps: 30 });
const root = createRoot(renderer);
let closing = false;
const quit = () => {
  if (closing) return;
  closing = true;
  try { root.unmount(); } catch { /* gone */ }
  try { renderer.destroy(); } catch { /* gone */ }
  process.exit(0);
};
process.on("SIGTERM", quit);
process.on("SIGHUP", quit);
root.render(<Gallery start={start} glyphs={glyphs} onQuit={quit} />);
