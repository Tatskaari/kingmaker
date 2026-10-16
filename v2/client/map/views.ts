// Copied from the prototype's src/game/views.ts at 44c6d4a: :25-51 (ViewOptions, TownViewOptions), :53-78 (townView, townText) and :235-241 (pick), whole but for the seam: the town's view from an ExploreState (made from rows: shared/map/rows.ts exploreOf) and the scene's world when one is on the map, in place of the game and the session.
import { positionOf, type SceneWorld } from "../../shared/world/scene-world.ts";
import { roamRegion, type ExploreState } from "../../shared/map/explore.ts";
import { getMap } from "../../shared/map/maps.ts";
import { regionForScene } from "../../shared/map/places.ts";
import { townRegion } from "../../shared/map/reconcile.ts";
import type { Tile2 } from "../../shared/map/types.ts";
import type { Effects } from "../look/effects.ts";
import type { GlyphSet } from "../look/glyphs.ts";
import type { StyledLine } from "../ui/types.ts";
import { toPlain } from "./ansi.ts";
import type { Picks, RenderOptions, Viewport } from "./render.ts";
import { xrayExplore } from "./xray.ts";

/**
 * The town as you walk it (the prototype's views.ts, its town half): the look layer (client/look)
 * decides how everything in it looks, alive, by one clock: `t`, in milliseconds.
 */

export interface ViewOptions {
  /** The animation clock in milliseconds: water runs, fire flickers, effects play. */
  t?: number;
  /** The clock in the map's old 100 ms ticks, when there's no `t`. */
  tick?: number;
  /** false: plain characters only (logs, tests): no motion, no effects, no icons. */
  color?: boolean;
  /** The glyph set (default: KM_GLYPHS, or what the terminal suggests). */
  glyphs?: GlyphSet;
  /** What's playing (the scene's or the fight's Effects), drawn over the place. */
  effects?: Effects;
  /** The tile under the pointer, lit up. */
  hover?: Tile2;
  /** Filled in with what's drawn where, for the mouse: pick.at(x, y) is the tile (and who) in a cell. */
  pick?: Picks;
}

export interface TownViewOptions extends ViewOptions {
  /** Outside a scene, the town's world the effects play in (src/game/town-world.ts: a spell at a door, a stall on fire). */
  town?: SceneWorld;
  /** Tinted tiles (aiming: how far it reaches, who it could be aimed at, what an area covers). */
  marks?: RenderOptions["marks"];
  /** The tile aimed at, bracketed. */
  cursor?: Tile2;
  /** A lead marker of the explorer's own (a hub's next exhibit), in place of the story's. */
  lead?: { at: Tile2; label: string };
}

/**
 * The town round the player; in a scene, the scene's place with its world (where everyone is now)
 * and its effects. With `pick`, what's drawn where, for the mouse; `hover` lights up a tile. Outside
 * a scene, the effects play in a world live on the map (a zoo's wing), or else in the town's own
 * world (`town`), lined up with the whole map. (v2: the state is made from rows; `scene` is the
 * world of the scene being played on the map, when there is one.)
 */
export function townView(ex: ExploreState, scene: SceneWorld | undefined, size: Viewport, options: TownViewOptions = {}): StyledLine[] {
  const world = ex.scene && scene && scene.scene === ex.scene ? scene : undefined;
  const place = world ? regionForScene(world.scene) : undefined;
  const roaming = !world ? ex.roam?.[ex.map] : undefined;
  const roamed = roaming ? roamRegion(getMap(ex.map), roaming) : undefined;
  const town = !world && !roamed && options.town ? options.town : undefined;
  const shown = world && place ? { region: place.region, world }
    : roaming && roamed ? { region: roamed, world: roaming }
    : town ? { region: townRegion(getMap(ex.map)), world: town } : undefined;
  const effects = shown && options.effects ? { region: shown.region, frame: options.effects.frame(options.t ?? 0, id => positionOf(shown.world, id)) } : undefined;
  // Whoever's behind a building shows through it, a little greyer (the user's call): see map/xray.ts.
  return xrayExplore(ex, size, {
    ...(world ? { world } : {}), ...(effects ? { effects } : {}), ...pick(options),
    ...(options.lead ? { lead: options.lead.at, leadLabel: options.lead.label } : {}),
    ...(options.marks?.length ? { marks: options.marks } : {}), ...(options.cursor ? { cursor: options.cursor } : {}),
  });
}

export const townText = (ex: ExploreState, scene: SceneWorld | undefined, size: Viewport) => toPlain(townView(ex, scene, size, { color: false }));

function pick(options: ViewOptions): Pick<RenderOptions, "t" | "tick" | "color" | "glyphs" | "hover" | "pick"> {
  return {
    ...(options.t !== undefined ? { t: options.t } : {}), ...(options.tick !== undefined ? { tick: options.tick } : {}),
    ...(options.color !== undefined ? { color: options.color } : {}), ...(options.glyphs ? { glyphs: options.glyphs } : {}),
    ...(options.hover ? { hover: options.hover } : {}), ...(options.pick ? { pick: options.pick } : {}),
  };
}
