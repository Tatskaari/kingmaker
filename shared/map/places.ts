// Copied from the prototype's src/game/map/places.ts at 44c6d4a. Each place names its place file (`place: "granary-yard"`, places/<key>.json, now places/<key>.kmplace) in place of its world, whose spec comes from place_def rows (usePlaces: the simulation's, for sceneStart; the client has no place files and never needs one); storyFromSession is cut (the story is rows: rows.ts exploreOf). Imports from v2/shared.
import type { PlaceFile } from "../scene/files.ts";
import type { WorldSpec } from "../world/scene-world.ts";
import type { StoryState, Tile2, TileMap } from "./types.ts";
import { getMap } from "./maps.ts";
import { feetToTile } from "./reconcile.ts";
import type { PlaceRegion } from "./tiles.ts";

/**
 * Where each scene of the arc happens, and what the map needs to know about it: its place (a map
 * and a region lined up with its world), who's there before the player arrives, its time of day,
 * where the lead marker stands in the town, and where the player comes out afterwards.
 */

export interface ScenePlace {
  sceneId: string;
  /** Where it's played. */
  map: string;
  region: string;
  /** Its place file's key (places/<key>.kmplace): its world, where the player starts (sceneStart). v2: the world shown before the scene opens is its place's rows (ExploreState.waiting). */
  place: string;
  /** Cast ids there before the player arrives (Kell comes with the player after the first scene). */
  present: string[];
  time: StoryState["time"];
  /** The lead marker in the town, and what it's called. */
  lead: { map: string; at: Tile2; label: string };
  /** Where the player stands when the scene is over and they're back on their feet in the town. */
  after: { map: string; at: Tile2 };
}

export const PLACES: Record<string, ScenePlace> = {
  // The prologue on the King's Road (the afternoon before the eve) and the King's thanks that evening.
  "kings-road": {
    sceneId: "kings-road", map: "kings-road", region: "crossroads", place: "kings-road", present: ["fitch", "tansy"], time: "afternoon",
    lead: { map: "kings-road", at: { x: 13, y: 11 }, label: "the crossroads" }, after: { map: "kings-road", at: { x: 25, y: 11 } },
  },
  "toll-bridge": {
    sceneId: "toll-bridge", map: "kings-road", region: "toll-bridge", place: "toll-bridge", present: ["haskett", "tob", "garrow", "rearguard"], time: "evening",
    lead: { map: "kings-road", at: { x: 33, y: 11 }, label: "the toll bridge" }, after: { map: "kings-road", at: { x: 38, y: 12 } },
  },
  "kings-thanks": {
    sceneId: "kings-thanks", map: "palace", region: "kings-parlour", place: "kings-parlour", present: ["king", "holt", "tob"], time: "evening",
    lead: { map: "caerwyn", at: { x: 11, y: 13 }, label: "the palace" }, after: { map: "caerwyn", at: { x: 11, y: 14 } },
  },
  "hanged-clerk": {
    sceneId: "hanged-clerk", map: "caerwyn", region: "granary-yard", place: "granary-yard", present: ["kell", "cob", "moll"], time: "morning",
    lead: { map: "caerwyn", at: { x: 42, y: 10 }, label: "the granary yard" }, after: { map: "caerwyn", at: { x: 42, y: 9 } },
  },
  "drowned-rat": {
    sceneId: "drowned-rat", map: "drowned-rat", region: "drowned-rat", place: "drowned-rat", present: ["nan-quill", "arlo", "dilly", "hobb", "cob"], time: "evening",
    lead: { map: "caerwyn", at: { x: 26, y: 35 }, label: "the Drowned Rat" }, after: { map: "caerwyn", at: { x: 25, y: 35 } },
  },
  "heron-warehouse": {
    sceneId: "heron-warehouse", map: "heron", region: "heron", place: "heron", present: ["saul", "hep", "scrope", "hobb"], time: "night",
    lead: { map: "caerwyn", at: { x: 48, y: 38 }, label: "the Heron" }, after: { map: "caerwyn", at: { x: 49, y: 38 } },
  },
  "kings-morning": {
    sceneId: "kings-morning", map: "palace", region: "dressing-room", place: "dressing-room", present: ["king", "holt"], time: "next-morning",
    lead: { map: "caerwyn", at: { x: 11, y: 13 }, label: "the palace" }, after: { map: "caerwyn", at: { x: 11, y: 14 } },
  },
};

/** The interludes the map stands in for: their time of day, and the scene they lead on to. */
const INTERLUDES: Record<string, { time: StoryState["time"]; next: string }> = {
  "caerwyn-afternoon": { time: "afternoon", next: "drowned-rat" },
  "wharf-night": { time: "night", next: "heron-warehouse" },
};

/**
 * Places of scenes that aren't the story's (the zoo's rooms, src/game/zoo): the map plays them as it
 * plays the arc's (their region, where the player starts, the scene view), but nothing in the story
 * leads to them, shows them in the town or opens them: whoever registers them does.
 */
const OTHER_PLACES: Record<string, ScenePlace> = {};

export function registerPlace(place: ScenePlace): void {
  if (PLACES[place.sceneId]) throw new Error(`${place.sceneId} is the story's place, not one to register`);
  OTHER_PLACES[place.sceneId] = place;
}

export const scenePlace = (sceneId: string): ScenePlace | undefined => PLACES[sceneId] ?? OTHER_PLACES[sceneId];

/** v2: the places' worlds as authored, by place key: what sceneStart reads. Only the simulation has them (from place_def). */
const SPECS: Record<string, WorldSpec> = {};

/** The campaign's place files (place_def rows), for sceneStart: the simulation calls it before a scene opens. */
export function usePlaces(files: PlaceFile[]): void {
  for (const file of files) SPECS[file.key] = file;
}

/** A scene's place: the map and the region (with its worldOrigin) it's played in. */
export function regionForScene(sceneId: string): { map: TileMap; region: PlaceRegion } | undefined {
  const place = scenePlace(sceneId);
  if (place) {
    const map = getMap(place.map);
    const region = map.regions.find(r => r.id === place.region) as PlaceRegion | undefined;
    return region ? { map, region } : undefined;
  }
  return undefined;
}

/** Where the player stands when a scene opens: the world's own start for them, on its map. */
export function sceneStart(sceneId: string): { map: string; at: Tile2 } | undefined {
  const place = scenePlace(sceneId);
  const found = regionForScene(sceneId);
  if (!place || !found) return undefined;
  const start = SPECS[place.place]?.people.player?.at;
  const r = found.region.rect;
  return { map: place.map, at: start ? feetToTile(found.region, { x: start[0], y: start[1] }) : { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) } };
}

/** The time of day a scene happens at (interludes included). */
export function timeFor(sceneId: string | undefined): StoryState["time"] {
  if (!sceneId) return "morning";
  return PLACES[sceneId]?.time ?? INTERLUDES[sceneId]?.time ?? "afternoon";
}

/** The scene the lead marker points at: an interlude points on to where it leads. */
export const leadScene = (sceneId: string | undefined) => (sceneId && INTERLUDES[sceneId] ? INTERLUDES[sceneId]!.next : sceneId);

