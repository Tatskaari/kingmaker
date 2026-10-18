// Copied from the prototype's src/game/views.ts:80-110 at 44c6d4a (StageOptions, stageView): the world in place of the session (v2 rebuilds it from the place's rows), the time of day the look layer's TimeOfDay, the size a { w, h } (the map's Viewport).
import type { Point, SceneWorld } from "../../shared/world/scene-world.ts";
import type { TimeOfDay } from "./appearance.ts";
import type { Canvas } from "./canvas.ts";
import { dressingFor } from "./dressings.ts";
import type { Effects } from "./effects.ts";
import { glyphSet, type GlyphSet } from "./glyphs.ts";
import { renderStage, type StagePicks } from "./stage.ts";

export interface StageOptions {
  /** The animation clock in milliseconds. */
  t: number;
  time: TimeOfDay;
  glyphs?: GlyphSet;
  /** The scene's effects: fireballs, splashes, barks, damage numbers. */
  effects?: Effects;
  /** Where people are drawn mid-walk (the director's tweens), in the world's feet. */
  positions?: (id: string) => Point | undefined;
  /** Filled in with what's drawn where, for the mouse: pick.at(x, y) is who or what is in a cell, and the floor there. */
  pick?: StagePicks;
  /** What the pointer is on, lit up: someone or something by world id, or a cell of floor. */
  hover?: string | { x: number; y: number };
}

/**
 * A scene's place from above, Caves of Qud style: its world on the look layer's stage, dressed
 * with what the place is built of (dressings.ts), its people walking where the director has them,
 * its effects, barks and damage numbers. A Canvas, for a live view to paint. With `pick`, what's
 * drawn where, for the mouse; `hover` lights up what the pointer is on.
 */
export function stageView(world: SceneWorld | undefined, size: { w: number; h: number }, options: StageOptions): Canvas | undefined {
  if (!world) return undefined;
  return renderStage(world, dressingFor(world.scene), {
    w: size.w, h: size.h, t: options.t, time: options.time, glyphs: options.glyphs ?? glyphSet(),
    ...(options.effects ? { effects: options.effects } : {}), ...(options.positions ? { positions: options.positions } : {}),
    ...(options.pick ? { pick: options.pick } : {}), ...(options.hover !== undefined ? { hover: options.hover } : {}),
  });
}
