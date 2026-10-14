import type { SessionState } from "../runtime/session.ts";
import type { CombatController } from "./combat/index.ts";
import { battlefield, render, renderExplore, toPlain, type RenderOptions, type Viewport } from "./map/index.ts";
import type { GameState } from "./play.ts";
import { exploreState } from "./town.ts";
import type { MapActor, StoryState, StyledLine, Tile2 } from "./types.ts";

/**
 * Every picture of the world the game draws, in one place: the town as you walk it, a scene's place
 * with its world, and a fight on its battlefield. The app shows these as styled lines (MapView),
 * the QA console as plain text. The look layer (src/game/look) plugs in here, behind these calls.
 */

export interface ViewOptions {
  /** Animation frame (water, fire, the lead's pulse). */
  tick?: number;
  /** false: plain characters only (logs, tests). */
  color?: boolean;
}

/** The town round the player; in a scene, the scene's place with its world (where everyone is now). */
export function townView(game: GameState, session: SessionState | undefined, size: Viewport, options: ViewOptions = {}): StyledLine[] {
  const ex = exploreState(game);
  const world = ex.scene && session?.world && session.world.scene === ex.scene ? session.world : undefined;
  return renderExplore(ex, size, { ...(world ? { world } : {}), ...pick(options) });
}

export const townText = (game: GameState, session: SessionState | undefined, size: Viewport) => toPlain(townView(game, session, size, { color: false }));

export interface FightViewOptions extends ViewOptions {
  /** Where the camera looks (default: whoever's turn it is, or the player). */
  centre?: Tile2;
  /** Tinted tiles: where the player can move, a spell's area. */
  marks?: RenderOptions["marks"];
  /** The selected tile (a target), bracketed. */
  cursor?: Tile2;
  /** The time of day (the light). */
  time?: StoryState["time"];
}

/**
 * A fight on its battlefield, drawn by the map's renderer: the fighters and the lights from the
 * fight, the dust and the fire as tints, and the rest of the scene's place as its world has it (the
 * people not in the fight stand back, the furniture stays put). The roof is off: you need to see.
 */
export function fightView(fight: CombatController, session: SessionState | undefined, size: Viewport, options: FightViewOptions = {}): StyledLine[] {
  const view = fight.view();
  const G = fight.state();
  const fighters = new Set(Object.values(G.units).flatMap(u => [u.id, u.castId ?? u.id]));
  const field = session?.world ? battlefield(session.sceneId, session.world) : undefined;
  // The place round the fight: everything the world has but the fighters and the lights the fight now owns.
  const scenery: MapActor[] = (field?.actors ?? []).filter(a => a.map === G.map.id && a.kind !== "player" && !fighters.has(a.ref ?? a.id) && !G.props[a.ref ?? a.id] && !G.props[a.id]);
  const hazards = [
    ...view.hazards.dust.map(at => ({ at, color: "#6b5a2a" })),
    ...view.hazards.fire.map(at => ({ at, color: "#c0401a", glyph: "^" })),
  ];
  const active = view.turn ? G.units[view.turn.id]?.at : undefined;
  const centre = options.centre ?? active ?? G.units[G.pc]?.at ?? { x: Math.floor(G.map.width / 2), y: Math.floor(G.map.height / 2) };
  const actors = [...scenery, ...view.actors.map(a => ({ ...a, map: G.map.id }))];
  const marks = [...hazards, ...(options.marks ?? [])];
  return render(G.map, actors, centre, size, {
    roofs: false, time: options.time ?? "night", focus: centre, reveal: view.units.map(u => u.at),
    ...(marks.length ? { marks } : {}), ...(options.cursor ? { cursor: options.cursor } : {}), ...pick(options),
  });
}

function pick(options: ViewOptions): Pick<RenderOptions, "tick" | "color"> {
  return { ...(options.tick !== undefined ? { tick: options.tick } : {}), ...(options.color !== undefined ? { color: options.color } : {}) };
}
