// Stub (K): the walking half of the prototype's src/game/map/explore.ts at 44c6d4a (all but 645-754, the drawing, which is the client's: client/map/frame.ts): its types copied whole, with v2's `waiting` on ExploreState, its keys as they are, and its functions' signatures, each a stub. Package M replaces this file with the copy (`.at(-1)` and structuredClone replaced, for ES2021), keeping every export.
import type { SceneWorld } from "../world/scene-world.ts";
import type { QuipMemory } from "./quips.ts";
import type { MapOverlay } from "./reconcile.ts";
import { notBuilt } from "./stub.ts";
import type { PlaceRegion } from "./tiles.ts";
import type { Interaction, MapActor, StoryState, Tile2, TileMap } from "./types.ts";

export interface Follower { id: string; name: string; glyph: string; color: string; map: string; at: Tile2 }

export interface ExploreState extends QuipMemory {
  map: string;
  at: Tile2;
  /** The way the player last stepped: what's "in front" for interact(). */
  facing: Tile2;
  story: StoryState;
  overlay: MapOverlay;
  /** Who walks with the player (Kell, after the granary). */
  followers: Follower[];
  /** The scene being played: its world, when passed in, drives its place's actors. */
  scene?: string;
  steps: number;
  /** Out of sight (a Stealth check made on the map): until they do something that shows them. */
  hidden?: boolean;
  /**
   * Worlds live on maps outside any scene, by map id (the zoo's wings: src/game/zoo): their people
   * and things are about on the map, in the way and to be looked at, and its puddles and fires lie
   * on its ground. Each lines up with the region of its map whose sceneId is the world's (roamRegion).
   * The player is the map's: the world's own player entity isn't drawn.
   */
  roam?: Record<string, SceneWorld>;
  /**
   * v2: the places built on the maps whose scenes haven't been played yet (the lead's, its people
   * waiting), by scene id: their worlds from rows. presence.ts's places() draws these where the
   * prototype built each one afresh from its spec. (Played places are the overlay, made from rows.)
   */
  waiting?: Record<string, SceneWorld>;
}

export interface MoveResult {
  moved: boolean;
  map: string;
  at: Tile2;
  /** For the log: what happened, in the house style. */
  message?: string;
  /** Walked into someone or something in the way. */
  bumped?: MapActor;
  /** Went through a door or along a path to another map. */
  travelled?: { from: string; to: string; label: string };
  /** A scene opens here: the app starts it (openScene). */
  trigger?: Extract<Interaction, { kind: "scene" }>;
}

export interface Nearby {
  at: Tile2;
  /** Steps away (diagonals count as one). */
  distance: number;
  /** A compass word from the player ("north-east"; on screen, north is up-left and east up-right). */
  direction: string;
  label: string;
  actor?: MapActor;
  interaction?: Interaction;
}

export function roamRegion(map: TileMap, _world: SceneWorld): PlaceRegion | undefined { return notBuilt(`roamRegion(${map.id})`); }
export function newExploration(_story: StoryState, _options: { overlay?: MapOverlay; map?: string; at?: Tile2 } = {}): ExploreState { return notBuilt("newExploration"); }
export function setStory(_state: ExploreState, _story: StoryState): void { notBuilt("setStory"); }
export function actorsHere(_state: ExploreState, _world?: SceneWorld, _mapId?: string): MapActor[] { return notBuilt("actorsHere"); }
export function doorState(_actors: MapActor[], _at: Tile2): "open" | "locked" | undefined { return notBuilt("doorState"); }
export function move(_state: ExploreState, _dx: number, _dy: number, _world?: SceneWorld): MoveResult { return notBuilt("move"); }
export function travel(_state: ExploreState, _to: { map: string; at: Tile2 }, _label = "On you go"): MoveResult { return notBuilt("travel"); }
export function pathTo(_state: ExploreState, _target: Tile2, _world?: SceneWorld): Array<[number, number]> | undefined { return notBuilt("pathTo"); }
export function walkPlan(_state: ExploreState, _target: Tile2, _world?: SceneWorld): { path: Array<[number, number]>; reaches: boolean } | undefined { return notBuilt("walkPlan"); }
export function look(_state: ExploreState, _world?: SceneWorld): string { return notBuilt("look"); }
export function actorsAt(_state: ExploreState, _at: Tile2, _world?: SceneWorld): MapActor[] { return notBuilt("actorsAt"); }
export function tileName(_state: ExploreState, _at: Tile2, _world?: SceneWorld): string { return notBuilt("tileName"); }
export function exitLabel(_exit: { label: string; to: { map: string } }): string { return notBuilt("exitLabel"); }
export function lookAt(_state: ExploreState, _at: Tile2, _world?: SceneWorld): string { return notBuilt("lookAt"); }
export function whereabouts(_state: ExploreState): { map: string; place: string; time: StoryState["time"] } { return notBuilt("whereabouts"); }
export function nearby(_state: ExploreState, _radius = 2, _world?: SceneWorld): Nearby[] { return notBuilt("nearby"); }
export function interact(_state: ExploreState, _world?: SceneWorld): { interaction: Interaction; actor?: MapActor; at: Tile2 } | undefined { return notBuilt("interact"); }
export function enterScene(_state: ExploreState, _sceneId: string): { map: string; at: Tile2 } | undefined { return notBuilt("enterScene"); }
export function leaveScene(_state: ExploreState, _world?: SceneWorld): void { notBuilt("leaveScene"); }
export function steer(_state: ExploreState, _dx: number, _dy: number, _world?: SceneWorld): [number, number] { return notBuilt("steer"); }

/**
 * Arrow keys by the screen (recommended): up goes straight up the screen, which on the map is a
 * diagonal step (north-east), right is south-east, and so on. Doors and streets all take diagonal
 * steps, so this gets everywhere.
 */
export const SCREEN_KEYS: Record<string, [number, number]> = {
  up: [1, -1], w: [1, -1], down: [-1, 1], s: [-1, 1], left: [-1, -1], a: [-1, -1], right: [1, 1], d: [1, 1],
  // The numpad's corners go along the map's own lines (the streets): up-left is north, and so on.
  home: [0, -1], pageup: [1, 0], end: [-1, 0], pagedown: [0, 1],
};

/** Keys by the compass, for an app that prefers them: WASD and arrows north/south/west/east, QEZC diagonally. */
export const KEYS: Record<string, [number, number]> = {
  up: [0, -1], w: [0, -1], k: [0, -1], down: [0, 1], s: [0, 1], j: [0, 1], left: [-1, 0], a: [-1, 0], h: [-1, 0], right: [1, 0], d: [1, 0], l: [1, 0],
  q: [-1, -1], home: [-1, -1], e: [1, -1], pageup: [1, -1], z: [-1, 1], end: [-1, 1], c: [1, 1], pagedown: [1, 1],
};
