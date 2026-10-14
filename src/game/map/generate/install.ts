import type { StoryState, Tile2 } from "../../types.ts";
import { MAPS } from "../maps/index.ts";
import { PLACES, type ScenePlace } from "../places.ts";
import { registerMaps } from "../reconcile.ts";
import type { CompiledPlace } from "./compile.ts";

/**
 * Putting a generated place into play: its map among the game's maps (getMap, travel, exits), its
 * region where reconcile can find it (actorsFromWorld), and its scene's place (regionForScene,
 * sceneStart, the scene view's framing), exactly where a hand-made place's entries are. After
 * this the rest of the game can't tell it from one drawn by hand.
 *
 * The town doesn't change: a way in from Caerwyn (the lead marker, a door) is the caller's to give.
 */

export interface InstallOptions {
  /** Cast ids there before the player arrives. */
  present?: string[];
  time?: StoryState["time"];
  /** The lead marker in the town, and where the player comes out afterwards. */
  lead?: { map: string; at: Tile2; label: string };
  after?: { map: string; at: Tile2 };
}

/** Hand-made places a generated one stands in for, by scene, to put back. */
const replaced = new Map<string, ScenePlace>();

export function installPlace(place: CompiledPlace, options: InstallOptions = {}): ScenePlace | undefined {
  if (MAPS[place.id] && MAPS[place.id]!.map !== place.map) throw new Error(`A map called ${place.id} is already in the game`);
  MAPS[place.id] = place.def;
  registerMaps([place.map]);
  const sceneId = place.region.sceneId;
  if (!sceneId) return undefined;
  const street = place.site.entrance?.outside ?? place.furnished.start;
  const scenePlace: ScenePlace = {
    sceneId, map: place.id, region: place.region.id, world: place.world, present: options.present ?? place.cast.map(c => c.id),
    time: options.time ?? "evening",
    lead: options.lead ?? { map: place.id, at: street, label: place.plan.name },
    after: options.after ?? { map: place.id, at: street },
  };
  // A scene can be given a new place (the GM's version of a hand-made one): the old one comes back on uninstall.
  if (PLACES[sceneId] && PLACES[sceneId]!.map !== place.id && !replaced.has(sceneId)) replaced.set(sceneId, PLACES[sceneId]!);
  PLACES[sceneId] = scenePlace;
  return scenePlace;
}

/** Take a generated place out of play again (a scene that's over, a test). */
export function uninstallPlace(place: CompiledPlace): void {
  if (MAPS[place.id]?.map === place.map) delete MAPS[place.id];
  const sceneId = place.region.sceneId;
  if (!sceneId || PLACES[sceneId]?.map !== place.id) return;
  const before = replaced.get(sceneId);
  if (before) { PLACES[sceneId] = before; replaced.delete(sceneId); }
  else delete PLACES[sceneId];
}
