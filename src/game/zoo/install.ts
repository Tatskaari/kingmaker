import { DRESSINGS } from "../look/dressings.ts";
import { MAPS } from "../map/maps/index.ts";
import { registerPlace } from "../map/places.ts";
import { registerMaps } from "../map/reconcile.ts";
import { buildMap, type MapDef, type PlaceRegion } from "../map/tiles.ts";
import type { MapActor, Tile2 } from "../types.ts";
import { dressingFromMap } from "./dressing.ts";
import type { Exhibit, Trigger, Wing } from "./model.ts";

/**
 * Putting a wing in the game: its map among the game's maps (getMap, travel), its region where
 * reconcile can find it, its world as a place (so a fight can be fought on it, and the rules can
 * reach it), and its dressing for the view from above. Signs and levers are the map's decor: they
 * stand where the exhibit says, and a sign's words are what looking at it says.
 */

const SIGN = "#e0c890";

export function installWing(wing: Wing): MapDef {
  // A place compiled from a plan comes with its map (its first region is the whole place, lined up with its world).
  const def = wing.compiled ? { map: { ...wing.compiled.map, exits: [...wing.compiled.map.exits, ...(wing.map.exits ?? [])] }, decor: [...wing.compiled.def.decor] } : drawn(wing);
  const own = def.map.regions[0] as PlaceRegion;
  const stood = new Set<string>();
  for (const e of wing.exhibits) {
    def.decor.push(signOf(wing, e));
    // One station to a tile (the wardrobe has seven sets of robes in it).
    for (const t of e.triggers) if (t.station && typeof t.at !== "string" && !stood.has(`${t.at.x},${t.at.y}`)) { stood.add(`${t.at.x},${t.at.y}`); def.decor.push(stationOf(wing, t, t.at)); }
  }
  for (const [i, n] of (wing.notices ?? []).entries()) {
    def.decor.push({ id: `${wing.id}:notice:${i}`, name: n.name, kind: "object", glyph: "▤", color: SIGN, map: wing.id, at: { ...n.at }, states: ["post"], interaction: { kind: "examine", text: n.text, label: `Read ${n.name}` } });
  }
  MAPS[wing.id] = def;
  registerMaps([def.map]);
  registerPlace({ sceneId: wing.id, map: wing.id, region: own.id, world: wing.world, present: [], time: "morning", lead: { map: wing.id, at: wing.entry, label: wing.name }, after: { map: wing.id, at: wing.entry } });
  // From above: the walls and floors read off the map, with what the wing says over them (its haze, a ground by name).
  const read = dressingFromMap(def.map, own, wing.world);
  DRESSINGS[wing.id] = {
    ...read, ...wing.dressing, ground: { ...read.ground, ...wing.dressing?.ground },
    indoor: [...new Set([...(read.indoor ?? []), ...(wing.dressing?.indoor ?? [])])],
  };
  return def;
}

/** A wing drawn by hand: its grid and legend, with its own region over the whole map. */
function drawn(wing: Wing): MapDef {
  const rows = wing.map.grid.replace(/^\n/, "").replace(/\n\s*$/, "").split("\n");
  const width = Math.max(...rows.map(r => [...r].length)), height = rows.length;
  const own: PlaceRegion = { id: wing.id, name: wing.name, rect: { x: 0, y: 0, w: width, h: height }, sceneId: wing.id, worldOrigin: { x: 0, y: 0 }, description: wing.about };
  return buildMap({ id: wing.id, name: capital(wing.name), ...wing.map, regions: [own, ...wing.map.regions] });
}

/** The sign's id on the map: what the explorer looks for when it's read. */
export const signId = (wing: string, exhibit: string) => `${wing}:sign:${exhibit}`;

function signOf(wing: Wing, e: Exhibit): MapActor {
  return {
    id: signId(wing.id, e.id), name: `the sign: ${e.title}`, kind: "object", glyph: "▤", color: SIGN, map: wing.id, at: { ...e.sign }, states: ["post"],
    interaction: { kind: "examine", text: `${e.title.toUpperCase()}. ${e.text}`, label: `Read the sign: ${e.title}` },
  };
}

function stationOf(wing: Wing, t: Trigger, at: Tile2): MapActor {
  const s = t.station!;
  return {
    id: `${wing.id}:station:${t.id}`, name: s.name, kind: "object", glyph: s.glyph, color: s.color ?? "#c8b28a", map: wing.id, at: { ...at }, states: ["post"],
    interaction: { kind: "examine", text: `${capital(s.name)}. ${t.label}: right-click it, or face it and press e.`, label: `Look at ${s.name}` },
  };
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
