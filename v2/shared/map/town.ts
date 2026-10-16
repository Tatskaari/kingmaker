// Stub (K): the map half of the prototype's src/game/town.ts at 44c6d4a (all but 465-490, the action menu's), with v2's seams: the game and the session become the ExploreState (made from rows: rows.ts exploreOf) and the names the player hasn't heard; `act` says what to take (Done.take) for the simulation to move, and throws Unavailable for an id it doesn't offer. Its types and walkId, where and the compass are as they are; its functions are stubs. Package M replaces this file with the copy (talkable false: talks are V11's; no action menu, V10; no fights, V12; observe is the client's, since it draws), keeping every export.
import type { ExploreState } from "./explore.ts";
import { notBuilt } from "./stub.ts";
import type { Interaction, MapActor, Tile2 } from "./types.ts";

/**
 * One of the explorer's actions, by its readable, stable id (the prototype's src/game/play.ts:29).
 * The ids are the QA console's: walk_<dir>, go_to_lead, go_to_<x>, talk_<x>, examine_<x>, enter_<x>,
 * travel_<x>, open_door_<dir>, take_<x>, interact, look, and by the tile walk@x,y, look@x,y,
 * talk@x,y, enter@x,y, travel@x,y, door@x,y (town.ts's header). moves.ts maps them onto the moves.
 */
export interface Action {
  id: string;
  /** What it does. */
  label: string;
  kind: "move" | "talk" | "enter" | "travel" | "examine" | "use" | "fight" | "wait" | "say";
}

/** The cast the player hasn't heard named, with what they'd call them: asHeard's pairs (shared/scene/names.ts). */
export type Unheard = Array<{ name: string; called: string }>;

/** What an act came to: what's said; whether the lead's scene opens; a thing to pick up, which the simulation moves into the player's pockets. */
export interface Done {
  text: string;
  scene?: boolean;
  /** take_<x>: the thing a played scene left lying about (its place's scene id, and its id in that world). */
  take?: { sceneId: string; id: string };
}

/** An act with an id that isn't on offer from where the player stands: the simulation refuses it (`unavailable`). */
export class Unavailable extends Error {}

export interface Target {
  /** The action id: "talk_kell", "go_to_market_square", "travel_up_the_river_stairs". */
  id: string;
  label: string;
  kind: Action["kind"];
  at: Tile2;
  distance: number;
  direction: string;
  actor?: MapActor;
  interaction?: Interaction;
  /** Walk onto it (a way out, a place) rather than up beside it (a person, a thing). */
  onto?: boolean;
  /** A place to walk into: any tile of it will do. */
  area?: { x: number; y: number; w: number; h: number };
}

/** Where g walks to: a tile, what it's called, whether to walk onto it, the way out first (`via`), the place it's in. */
export interface LeadTarget { at: Tile2; label: string; onto: boolean; via?: string; area?: { x: number; y: number; w: number; h: number } }

export interface TileActions {
  at: Tile2;
  /** What's there, for a menu's title: "Sergeant Kell", "a cabbage cart", "the watch house". */
  title: string;
  /** What can be done with it, the likeliest first, walking there last. */
  actions: Action[];
}

export const COMPASS: Record<string, [number, number]> = {
  north: [0, -1], northeast: [1, -1], east: [1, 0], southeast: [1, 1], south: [0, 1], southwest: [-1, 1], west: [-1, 0], northwest: [-1, -1],
};

/** The action id for one step (dx, dy each -1, 0 or 1; north is -y): "walk_northeast". */
export function walkId(dx: number, dy: number): string {
  const name = Object.entries(COMPASS).find(([, [x, y]]) => x === Math.sign(dx) && y === Math.sign(dy))?.[0];
  return name ? `walk_${name}` : "look";
}

/** How far, in words: "here", "just north", "3 steps north-east". */
export const where = (d: number, dir: string) => (d === 0 ? "here" : d === 1 ? `just ${dir}` : `${d} steps ${dir}`);

/** Everyone, everything, every way out and every place within sight that the player can do something with, nearest first, each with its action id. */
export function targets(_ex: ExploreState, _unheard: Unheard): Target[] { return notBuilt("targets"); }
/** Where the lead is from here: its marker on this map, or the way out towards it (`via`). */
export function leadTarget(_ex: ExploreState): LeadTarget | undefined { return notBuilt("leadTarget"); }
/** "the Drowned Rat, 14 steps south-west" or "the palace: back along the wharves first (6 steps west)". */
export function leadWords(_lead: LeadTarget, _from: Tile2): string { return notBuilt("leadWords"); }
/** What a click on a tile can do (the right-click menu). */
export function actionsAt(_ex: ExploreState, _unheard: Unheard, _at: Tile2): TileActions { return notBuilt("actionsAt"); }
/** What interact (the e key) would do now, in words. */
export function interactLabel(_ex: ExploreState): { label: string; scene: boolean } | undefined { return notBuilt("interactLabel"); }
/** The explorer's actions from here (the QA console's ACTIONS: town.actions). */
export function actions(_ex: ExploreState, _unheard: Unheard): Action[] { return notBuilt("actions"); }
/** An act by its id (town.act): changes the state as the prototype's does, and says what came of it. Throws Unavailable for an id not on offer. */
export function act(_ex: ExploreState, _unheard: Unheard, id: string): Done { return notBuilt(`act(${id})`); }
