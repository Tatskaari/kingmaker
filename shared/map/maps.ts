// Copied from the prototype's src/game/map/maps/index.ts at 44c6d4a: MAPS, getMap and decorOf as they are; the four maps' imports replaced by useMaps, which fills MAPS from the campaign's map files (map_def rows), so the simulation and the client read the maps the campaign installed, and registers each with reconcile.ts as the prototype's import did. v2 adds peopleOf: who's about on a map by the hour, from its file (presence.ts's town).
import type { MapActor, TileMap } from "./types.ts";
import { registerMaps } from "./reconcile.ts";
import { mapOf, type MapDef, type MapFile, type MapPerson } from "./tiles.ts";

/** Every map in the game, by id: the town and the places its scenes are played in. */
export const MAPS: Record<string, MapDef> = {};

/** Who's about on each map at each hour of the day (its file's people), by map id. */
const PEOPLE: Record<string, MapPerson[]> = {};

/** The json each map was last built from, so a map installed again (the same version re-installed) is built again. */
const BUILT: Record<string, string> = {};

/**
 * The maps a game is played on, from its campaign's map files: each built once, and again only when
 * its file changes. Both sides call it before reading a map (exploreOf does).
 */
export function useMaps(files: MapFile[]): void {
  for (const file of files) {
    const json = JSON.stringify(file);
    if (BUILT[file.id] === json) continue;
    const def = mapOf(file);
    MAPS[file.id] = def;
    PEOPLE[file.id] = file.people ?? [];
    registerMaps([def.map]);
    BUILT[file.id] = json;
  }
}

/** Who's about on a map at some hour of the day (the town's people), as its file has them: fresh copies each time. */
export function peopleOf(id: string): MapPerson[] {
  return (PEOPLE[id] ?? []).map(p => ({ ...p, at: { ...p.at }, times: [...p.times], ...(p.states ? { states: [...p.states] } : {}) }));
}

export function getMap(id: string): TileMap {
  const def = MAPS[id];
  if (!def) throw new Error(`Unknown map ${id}. Known: ${Object.keys(MAPS).join(", ")}`);
  return def.map;
}

/** The static things standing on a map (lamps, stalls, bunting), fresh copies each time. */
export function decorOf(id: string): MapActor[] {
  return (MAPS[id]?.decor ?? []).map(a => ({ ...a, at: { ...a.at }, ...(a.states ? { states: [...a.states] } : {}) }));
}
