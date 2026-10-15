import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionState } from "../../runtime/session.ts";
import type { Canvas } from "../look/canvas.ts";
import { dressingFor } from "../look/dressings.ts";
import { renderStage } from "../look/stage.ts";
import { toAnsi, toPlain, type Viewport } from "../map/index.ts";
import type { GameState } from "../play.ts";
import { exploreState } from "../town.ts";
import type { StyledLine } from "../types.ts";
import { townView } from "../views.ts";
import type { Look } from "./look.ts";
import { zooLead } from "./explorer.ts";

/**
 * Pictures of the zoo without a terminal, for the tour (and anyone without one to hand): the map
 * as the explore screen draws it (the wing's world, its effects, the next exhibit's marker), a
 * wing's world from above (the stage, with people mid-walk), saved as text, ANSI and PNG.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The map round the player at time t, as the explore screen draws it. */
export function mapPicture(game: GameState, session: SessionState | undefined, size: Viewport, t: number, look?: Look): StyledLine[] {
  const lead = zooLead(game);
  return townView(game, session, size, { t, ...(look ? { effects: look.fx } : {}), ...(lead ? { lead: { at: lead.at, label: lead.label } } : {}) });
}

/** A wing's world from above (v), with its effects and whoever's mid-walk where the director has them. */
export function stagePicture(game: GameState, size: Viewport, t: number, look?: Look): Canvas | undefined {
  const ex = exploreState(game);
  const world = look?.world ?? ex.roam?.[ex.map];
  if (!world) return undefined;
  return renderStage(world, dressingFor(world.scene), {
    w: size.w, h: size.h, t, time: game.story.time, ...(look ? { effects: look.fx, positions: id => look.director.tweens.at(id, t) } : {}),
  });
}

/** Lines from a picture (a canvas or styled lines). */
export const linesOf = (p: StyledLine[] | Canvas): StyledLine[] => (Array.isArray(p) ? p : p.toLines());

/**
 * Save a picture three ways: .txt (the characters), .ansi (24-bit colour: cat it in a terminal) and,
 * when Python and Pillow are about, .png (tools/ansi2png.py). Returns the files written.
 */
export function savePicture(dir: string, name: string, picture: StyledLine[] | Canvas, options: { png?: boolean } = {}): string[] {
  mkdirSync(dir, { recursive: true });
  const lines = linesOf(picture);
  const base = resolve(dir, name);
  writeFileSync(`${base}.txt`, `${toPlain(lines)}\n`);
  writeFileSync(`${base}.ansi`, `${toAnsi(lines)}\n`);
  const out = [`${base}.txt`, `${base}.ansi`];
  if (options.png !== false && pngWorks()) {
    try {
      execFileSync("python3", [join(ROOT, "tools", "ansi2png.py"), `${base}.ansi`, `${base}-png`], { stdio: "ignore" });
      if (existsSync(`${base}-png-0.png`)) { renameSync(`${base}-png-0.png`, `${base}.png`); out.push(`${base}.png`); }
      rmSync(`${base}-png-0.json`, { force: true });
    } catch { /* the PNG is a nicety */ }
  }
  return out;
}

let png: boolean | undefined;
/** Can tools/ansi2png.py run here (Python with Pillow)? */
export function pngWorks(): boolean {
  if (png !== undefined) return png;
  try { execFileSync("python3", ["-c", "import PIL"], { stdio: "ignore" }); png = true; } catch { png = false; }
  return png;
}
