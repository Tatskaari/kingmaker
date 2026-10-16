// Stub (K): the prototype's src/game/map/reconcile.ts at 44c6d4a, its types copied whole and its functions' signatures, each a stub. Package M replaces this file with the whole copy (structuredClone as a JSON copy, for ES2021), keeping every export.
import type { Entity, Point, Rect, SceneWorld } from "../world/scene-world.ts";
import type { MapActor, Region, StoryState, Tile2, TileMap } from "./types.ts";
import { notBuilt } from "./stub.ts";

export const FEET_PER_TILE = 5;

export interface FromWorldOptions {
  /** The map the region is on (found from the region otherwise). */
  map?: TileMap;
  /** Include the player's own entity (default true). */
  player?: boolean;
  /** Include people and creatures (default true); false keeps only things (a place before anyone's come). */
  people?: boolean;
  /** Only these cast ids (the scene's people present); others in the world are left out. */
  cast?: string[];
}

export interface OverlayScene {
  map: string;
  region: string;
  /** When the scene was played: how long things have had to burn out since. */
  time?: StoryState["time"];
  /** The place's things as the scene left them (and anyone left lying there). */
  things: MapActor[];
  /** The place's own states (exploded, burning), from its areas. */
  states: string[];
  /** What was spilled or scorched there (the world's surfaces, in its feet), and the place's extent. */
  surfaces?: { place: Rect; patches: Entity[] };
}

export interface MapOverlay {
  scenes: Record<string, OverlayScene>;
  /** What happened to each map's own things outside scenes (src/game/town-world.ts), by map id. */
  town?: Record<string, TownChanges>;
}

/** A thing of the town's (a door, a cart, a stall) as the rules left it. */
export interface ThingChange {
  states: string[];
  /** Hit points left, when hurt. */
  hp?: number;
  /** What it's called (a door the map has no actor for). */
  name?: string;
  at?: Tile2;
  /** When it happened: what was burning has burned out by a later time of day. */
  time?: StoryState["time"];
}

export interface TownChanges {
  things: Record<string, ThingChange>;
  /** The town's people as the rules (or a fight) left them, until the clock moves on: their states, and where a fight left them. */
  people?: { time: StoryState["time"]; states: Record<string, string[]>; at?: Record<string, Tile2> };
  /** The world's surfaces (puddles, scorch marks, burning patches), in the map's feet (5 ft a tile from its corner). */
  surfaces?: Entity[];
  surfacesTime?: StoryState["time"];
}

export function feetToTile(region: Region, p: Point): Tile2 { return notBuilt(`feetToTile(${region.id}, ${p.x}, ${p.y})`); }
export function tileToFeet(region: Region, t: Tile2): Point { return notBuilt(`tileToFeet(${region.id}, ${t.x}, ${t.y})`); }
export function actorsFromWorld(region: Region, _world: SceneWorld, _options: FromWorldOptions = {}): MapActor[] { return notBuilt(`actorsFromWorld(${region.id})`); }
export function nearestTile(map: TileMap, _from: Tile2, _ok: (p: Tile2) => boolean, _radius: number): Tile2 | undefined { return notBuilt(`nearestTile(${map.id})`); }
export function nearestWalk(map: TileMap, _from: Tile2, _ok: (p: Tile2) => boolean, _radius: number): Tile2 | undefined { return notBuilt(`nearestWalk(${map.id})`); }
export const emptyOverlay = (): MapOverlay => ({ scenes: {} });
export function townRegion(map: TileMap): Region { return notBuilt(`townRegion(${map.id})`); }
export function withTownChanges(_overlay: MapOverlay, mapId: string, _now: StoryState["time"] | undefined, _actors: MapActor[]): MapActor[] { return notBuilt(`withTownChanges(${mapId})`); }
export function townSurfaces(_overlay: MapOverlay, map: TileMap, _now?: StoryState["time"]): Array<{ region: Region; world: SceneWorld }> { return notBuilt(`townSurfaces(${map.id})`); }
export function captureScene(_overlay: MapOverlay, region: Region, _world: SceneWorld, _time?: StoryState["time"]): MapOverlay { return notBuilt(`captureScene(${region.id})`); }
export function overlaySurfaces(_overlay: MapOverlay, map: TileMap, _now?: StoryState["time"]): Array<{ region: Region; world: SceneWorld }> { return notBuilt(`overlaySurfaces(${map.id})`); }
export function overlayActors(_overlay: MapOverlay, mapId: string, _now?: StoryState["time"]): MapActor[] { return notBuilt(`overlayActors(${mapId})`); }
export function overlayRegionStates(_overlay: MapOverlay, map: TileMap, _now?: StoryState["time"]): Record<string, string[]> { return notBuilt(`overlayRegionStates(${map.id})`); }
export function registerMaps(maps: TileMap[]): void { notBuilt(`registerMaps(${maps.length})`); }
export function mapOfRegion(region: Region): TileMap | undefined { return notBuilt(`mapOfRegion(${region.id})`); }
