import { hangedClerkWorld } from "../../../scenes/worlds/hanged-clerk.ts";
import { drownedRatWorld } from "../../../scenes/worlds/drowned-rat.ts";
import type { WorldSpec } from "../../world/scene-world.ts";
import type { StoryState, Tile2, TileMap } from "../types.ts";
import { getMap } from "./maps/index.ts";
import { feetToTile } from "./reconcile.ts";
import type { PlaceRegion } from "./tiles.ts";
import { dressingRoomWorld } from "../../../scenes/worlds/kings-morning.ts";
import { heronWorld } from "../../../scenes/worlds/heron-warehouse.ts";

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
  /** Its world: for showing the place before the scene opens, and where the player starts. */
  world: WorldSpec;
  /** Cast ids there before the player arrives (Kell comes with the player after the first scene). */
  present: string[];
  time: StoryState["time"];
  /** The lead marker in the town, and what it's called. */
  lead: { map: string; at: Tile2; label: string };
  /** Where the player stands when the scene is over and they're back on their feet in the town. */
  after: { map: string; at: Tile2 };
}

export const PLACES: Record<string, ScenePlace> = {
  "hanged-clerk": {
    sceneId: "hanged-clerk", map: "caerwyn", region: "granary-yard", world: hangedClerkWorld, present: ["kell", "cob", "moll"], time: "morning",
    lead: { map: "caerwyn", at: { x: 42, y: 10 }, label: "the granary yard" }, after: { map: "caerwyn", at: { x: 42, y: 9 } },
  },
  "drowned-rat": {
    sceneId: "drowned-rat", map: "drowned-rat", region: "drowned-rat", world: drownedRatWorld, present: ["nan-quill", "arlo", "dilly", "hobb", "cob"], time: "evening",
    lead: { map: "caerwyn", at: { x: 26, y: 35 }, label: "the Drowned Rat" }, after: { map: "caerwyn", at: { x: 25, y: 35 } },
  },
  "heron-warehouse": {
    sceneId: "heron-warehouse", map: "heron", region: "heron", world: heronWorld, present: ["saul", "hep", "scrope", "hobb"], time: "night",
    lead: { map: "caerwyn", at: { x: 48, y: 38 }, label: "the Heron" }, after: { map: "caerwyn", at: { x: 49, y: 38 } },
  },
  "kings-morning": {
    sceneId: "kings-morning", map: "palace", region: "dressing-room", world: dressingRoomWorld, present: ["king", "holt"], time: "next-morning",
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
  const start = place.world.people.player?.at;
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

/**
 * Where the story is, as the map needs it, from a scene session: the scenes played, and the one it's
 * heading for (the session's current scene, until it's been opened). The app adds its flags.
 */
export function storyFromSession(session: { sceneId: string; history: Array<{ sceneId: string }>; ended?: unknown }, options: { opened?: boolean; flags?: StoryState["flags"] } = {}): StoryState {
  const played = session.history.map(h => h.sceneId);
  if (session.ended || options.opened) played.push(session.sceneId);
  const heading = played.includes(session.sceneId) ? undefined : session.sceneId;
  const lead = leadScene(heading);
  return { time: timeFor(heading ?? played.at(-1)), played, ...(lead ? { lead } : {}), flags: options.flags ?? {} };
}
