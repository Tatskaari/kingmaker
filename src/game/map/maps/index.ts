import type { MapActor, TileMap } from "../../types.ts";
import { registerMaps } from "../reconcile.ts";
import type { MapDef } from "../tiles.ts";
import { caerwyn } from "./caerwyn.ts";
import { drownedRat } from "./drowned-rat.ts";
import { heron } from "./heron.ts";
import { palace } from "./palace.ts";

/** Every map in the game, by id: the town and the places its scenes are played in. */
export const MAPS: Record<string, MapDef> = { caerwyn, "drowned-rat": drownedRat, heron, palace };

registerMaps(Object.values(MAPS).map(d => d.map));

export function getMap(id: string): TileMap {
  const def = MAPS[id];
  if (!def) throw new Error(`Unknown map ${id}. Known: ${Object.keys(MAPS).join(", ")}`);
  return def.map;
}

/** The static things standing on a map (lamps, stalls, bunting), fresh copies each time. */
export function decorOf(id: string): MapActor[] {
  return (MAPS[id]?.decor ?? []).map(a => ({ ...a, at: { ...a.at }, ...(a.states ? { states: [...a.states] } : {}) }));
}
