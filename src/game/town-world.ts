import { talkable } from "../../scenes/talk.ts";
import { areaAt, objectStats, type Entity, type Material, type SceneWorld, type Size } from "../world/scene-world.ts";
import { actorsHere, getMap, PLACES, tileAt, tileName, townRegion, type ExploreState, type MapOverlay } from "./map/index.ts";
import type { MapActor, Region, StoryState, Tile2, TileMap } from "./types.ts";

/**
 * The town's world: a map's own things (its doors, carts, stalls and signs), what played scenes
 * left in their places, the people about and the player, as a scene world (src/world/scene-world.ts)
 * that the rules can act on outside scenes: Fireball at a door breaks it, a Fire Bolt sets a stall
 * alight. Its feet run from the map's corner, 5 ft a tile (townRegion), so the map, the rules and the
 * look layer's effects agree on where everything is.
 *
 * The world is built fresh for each act from what the map has (actorsHere), and keepTown writes back
 * what the rules changed: the town's things into the map's overlay (ex.overlay.town), which the map
 * draws from then on and which saves with the game, a played scene's leftovers into that scene's
 * overlay, the people (hurt, knocked flat, run off) until the story's clock moves on, and what was
 * spilled or scorched.
 *
 * Not in it: a place whose scene hasn't been played yet (its people and things are the scene's to
 * show); its waiting people come back as `waiting`, since anything done to them opens their scene.
 * Ways out to other maps stay the story's (the Drowned Rat's door opens at dusk however it's knocked).
 */

export interface TownWorld {
  world: SceneWorld;
  map: TileMap;
  /** The whole map, its (0, 0) feet at the map's corner. */
  region: Region;
  /** Everyone and everything the map has here (actorsHere), as the world was built from them. */
  mapActors: MapActor[];
  /** What the map drew for each entity (by entity id). */
  actors: Map<string, MapActor>;
  /** People whose scene is waiting for the player (the lead's place, unplayed): by actor id. */
  waiting: Map<string, { castId: string; sceneId: string; at: Tile2; name: string }>;
  /** How everything was when it was built (states and hit points), to tell what the rules changed. */
  before: Map<string, string>;
}

export const FEET = 5;
/** A tile's middle, in the town world's feet. */
export const feetOf = (t: Tile2) => ({ x: t.x * FEET + FEET / 2, y: t.y * FEET + FEET / 2 });
/** The tile a point in the town world's feet is on. */
export const tileOfFeet = (p: { x: number; y: number }): Tile2 => ({ x: Math.floor(p.x / FEET), y: Math.floor(p.y / FEET) });

/** What the town's things are made of, and how big, by their names (the map's decor has neither). */
const STUFF: Array<[RegExp, Material, Size, string[]?]> = [
  [/bunting|washing line|banner|garland|awning|flag/, "cloth", "small", ["hanging"]],
  [/lamp post|lantern|lamp\b/, "iron", "medium", ["light"]],
  [/brazier/, "iron", "medium", ["light"]],
  [/statue/, "brass", "large"],
  [/well\b/, "stone", "large"],
  [/bollard/, "iron", "small"],
  [/price board|sign\b|notice|board\b|programme/, "wood", "medium"],
  [/elm|oak|tree/, "wood", "huge"],
  [/crane/, "wood", "huge"],
  [/cart|stall|stocks|crates?\b|barrel|butt\b|bench|table|desk|shelf|cupboard|wardrobe/, "wood", "large"],
  [/sacks?\b|sacking|grain/, "cloth", "medium"],
  [/rope|noose/, "rope", "small"],
  [/door|gate|hatch|wicket|shutter/, "wood", "medium", ["door"]],
  [/body|corpse/, "flesh", "medium", ["body"]],
  [/book|ledger|letter|paper|roll\b|page/, "paper", "tiny"],
  [/jar|bottle|glass|mirror/, "glass", "tiny"],
  [/coin|ring|key|knife|hook/, "iron", "tiny"],
];
const BURNS = new Set<Material>(["cloth", "paper", "rope", "wood", "leather"]);

function stuffOf(name: string, kind: MapActor["kind"]): { material: Material; size: Size; tags: string[] } {
  const n = name.toLowerCase();
  for (const [re, material, size, tags] of STUFF) if (re.test(n)) return { material, size, tags: [...(tags ?? [])] };
  return { material: "wood", size: kind === "item" ? "tiny" : "medium", tags: [] };
}

const sig = (e: Entity) => `${[...e.states].sort().join("|")}#${e.hp?.current ?? ""}`;
const isPerson = (a: MapActor) => a.kind === "person" || a.kind === "creature";
/** A stack's other tiles are the same thing (sacks spread along a wall): "sacks#48,12" is "sacks". */
const baseId = (id: string) => id.replace(/#\d+,\d+$/, "");

/** The statblock the rules use for one of the town's people, by what they are. */
function statblockOf(a: MapActor): string {
  if (/guard|watch(man)?\b|soldier|halberd/i.test(a.name)) return "guard";
  if (a.kind === "creature") return "giant-rat";
  return "commoner";
}

/** Build the town's world for the map the player is on. */
export function townWorld(ex: ExploreState): TownWorld {
  const map = getMap(ex.map);
  const region = townRegion(map);
  const root = `${map.id}:town:place`;
  const entities: Record<string, Entity> = {
    [root]: { id: root, name: map.name, kind: "place", parent: null, rect: { x: 0, y: 0, w: map.width * FEET, h: map.height * FEET }, tags: [], states: [], notes: [] },
  };
  for (const r of map.regions) entities[`area:${r.id}`] = { id: `area:${r.id}`, name: r.name, kind: "area", parent: root, rect: { x: r.rect.x * FEET, y: r.rect.y * FEET, w: r.rect.w * FEET, h: r.rect.h * FEET }, tags: [], states: [], notes: [] };
  const world: SceneWorld = { scene: `${map.id}:town`, root, entities, log: [] };
  const place = (e: Entity, at: Tile2) => { e.at = feetOf(at); e.parent = areaAt(world, e.at).id; entities[e.id] = e; };
  const actors = new Map<string, MapActor>();
  const waiting: TownWorld["waiting"] = new Map();
  const changes = ex.overlay.town?.[map.id];
  const doorsDrawn = new Set<string>();
  const mapActors = actorsHere(ex);
  for (const a of mapActors) {
    if (a.map !== map.id) continue;
    if (a.kind === "player") {
      place({ id: "player", name: "you", kind: "person", parent: root, tags: [], states: ex.hidden ? ["hidden"] : [], notes: [], player: true }, a.at);
      continue;
    }
    // A place whose scene is still to come is the scene's: its people wait for it.
    const scene = a.id.includes(":") ? a.id.split(":")[0]! : undefined;
    if (scene && PLACES[scene] && !ex.story.played.includes(scene)) {
      if (isPerson(a) && a.interaction?.kind === "scene") waiting.set(a.id, { castId: a.ref ?? a.id.slice(scene.length + 1), sceneId: a.interaction.sceneId, at: { ...a.at }, name: a.name });
      continue;
    }
    if (tileAt(map, a.at).terrain === "door" && a.kind === "object") doorsDrawn.add(`${a.at.x},${a.at.y}`);
    const id = baseId(a.id);
    if (entities[id]) continue;
    actors.set(id, a);
    const states = [...(a.states ?? [])].filter(s => s !== "post" && s !== "scenery" && s !== "lamp");
    if (isPerson(a)) {
      const follower = ex.followers.find(f => f.id === a.id);
      place({
        id, name: a.name, kind: a.kind === "creature" ? "creature" : "person", parent: root, tags: [], states, notes: [],
        ...(follower ? { cast: follower.id } : { stats: { statblock: statblockOf(a) } }),
        ...(a.interaction?.kind === "examine" ? { description: a.interaction.text } : {}),
      }, a.at);
      continue;
    }
    const stuff = stuffOf(a.name, a.kind);
    const stats = objectStats(stuff.material, stuff.size);
    const change = changes?.things[id];
    const wrecked = states.includes("destroyed");
    place({
      id, name: a.name, kind: a.kind === "item" ? "item" : stuff.tags.includes("door") ? "feature" : "object", parent: root, size: stuff.size, material: stuff.material,
      tags: [...new Set([...stuff.tags, "fixed", ...(BURNS.has(stuff.material) ? ["flammable"] : []), ...(states.includes("overhead") ? ["hanging"] : [])])],
      states, notes: [], ac: stats.ac, hp: { current: change?.hp ?? (wrecked ? 0 : stats.hp), max: stats.hp },
      ...(a.interaction?.kind === "examine" ? { description: a.interaction.text } : {}),
    }, a.at);
  }
  // The town's doors: the map draws them as its tiles. Ways out to other maps are the story's.
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    const t = tileAt(map, { x, y });
    if (t.terrain !== "door" || doorsDrawn.has(`${x},${y}`) || map.exits.some(e => e.at.x === x && e.at.y === y)) continue;
    const id = `${map.id}:door@${x},${y}`;
    if (entities[id]) continue;
    const stats = objectStats("wood", "medium");
    const change = changes?.things[id];
    place({ id, name: tileName(ex, { x, y }), kind: "feature", parent: root, size: "medium", material: "wood", tags: ["door", "fixed", "flammable"], states: change?.states ?? (t.blocks ? ["closed", "locked"] : ["closed"]), notes: [], ac: stats.ac, hp: { current: change?.hp ?? stats.hp, max: stats.hp } }, { x, y });
  }
  // What the town's own fires and spills left on the ground.
  for (const s of changes?.surfaces ?? []) entities[s.id] = structuredClone(s);
  const before = new Map(Object.values(entities).filter(e => e.kind !== "place" && e.kind !== "area").map(e => [e.id, sig(e)]));
  return { world, map, region, actors, mapActors, waiting, before };
}

/** Who and what stands on each tile (built once a world: a menu asks of every tile in reach). */
const byTile = new WeakMap<SceneWorld, Map<string, Entity[]>>();
function onTile(tw: TownWorld, at: Tile2): Entity[] {
  let index = byTile.get(tw.world);
  if (!index) {
    index = new Map();
    for (const e of Object.values(tw.world.entities)) {
      if (!e.at || e.kind === "area" || e.kind === "place" || e.kind === "surface") continue;
      const t = tileOfFeet(e.at), k = `${t.x},${t.y}`;
      index.set(k, [...(index.get(k) ?? []), e]);
    }
    byTile.set(tw.world, index);
  }
  return (index.get(`${at.x},${at.y}`) ?? []).filter(e => !e.states.includes("gone"));
}

/** The entity standing for a tile: who's on it (people first), else what's on it; undefined for bare ground. */
export function entityAt(tw: TownWorld, at: Tile2, options: { people?: boolean; things?: boolean; self?: boolean } = {}): Entity | undefined {
  const here = onTile(tw, at);
  const person = here.find(e => (e.kind === "person" || e.kind === "creature") && !e.player);
  if (person && options.people !== false) return person;
  const me = here.find(e => e.player);
  if (me && options.self) return me;
  // Things you can see: not what's overhead, unless nothing else is there.
  const things = here.filter(e => e.kind !== "person" && e.kind !== "creature" && !e.states.includes("destroyed"));
  if (options.things === false) return undefined;
  return things.find(e => !e.tags.includes("hanging")) ?? things[0];
}

/** Keep what the rules did to the town's world: on the map from now on, and in the saved game. What changed, in a few words. */
export function keepTown(ex: ExploreState, tw: TownWorld): string[] {
  const overlay: MapOverlay = ex.overlay;
  const town = ((overlay.town ??= {})[tw.map.id] ??= { things: {} });
  const time = ex.story.time;
  const said: string[] = [];
  for (const e of Object.values(tw.world.entities)) {
    if (e.kind === "place" || e.kind === "area" || e.kind === "surface") continue;
    if (e.player) { ex.hidden = e.states.includes("hidden") || undefined; if (!ex.hidden) delete ex.hidden; continue; }
    const was = tw.before.get(e.id);
    if (was === undefined || was === sig(e)) continue;
    const states = e.states.filter(s => s !== "fixed");
    if (e.kind === "person" || e.kind === "creature") {
      // Who walks with the player is the rules' (their hit points); the town's people are the time of day's.
      if (e.cast) continue;
      if (!town.people || town.people.time !== time) town.people = { time, states: {} };
      town.people.states[e.id] = states;
      said.push(`${e.name}: ${states.join(", ") || "unhurt"}`);
      continue;
    }
    const scene = e.id.includes(":") ? e.id.split(":")[0]! : "";
    const kept = overlay.scenes[scene];
    if (kept && PLACES[scene]) {
      // A played scene's leftovers: their own record is the scene's overlay.
      const raw = e.id.slice(scene.length + 1);
      for (const thing of kept.things.filter(t => baseId(t.id) === raw)) {
        thing.states = [...states];
        if (states.some(s => s === "destroyed" || s === "broken")) delete thing.blocks;
      }
    } else {
      const actor = tw.actors.get(e.id);
      const at = e.at ? tileOfFeet(e.at) : undefined;
      town.things[e.id] = { states, ...(e.hp && e.hp.current < e.hp.max ? { hp: e.hp.current } : {}), time, ...(!actor ? { name: e.name, ...(at ? { at } : {}) } : {}) };
    }
    said.push(`${e.name}: ${states.filter(s => !["closed", "open", "locked", "hanging"].includes(s)).join(", ") || "as it was"}`);
  }
  const surfaces = Object.values(tw.world.entities).filter(e => e.kind === "surface" && !e.states.includes("gone"));
  if (surfaces.length || town.surfaces?.length) { town.surfaces = surfaces.map(s => structuredClone(s)); town.surfacesTime = time; }
  return said;
}

/** Someone who walks with the player and has a life of their own to talk from (Kell): what's done to them is a talk's to play. */
export const companion = (tw: TownWorld, id: string) => tw.world.entities[id]?.cast && talkable(id) ? tw.world.entities[id] : undefined;

export type { StoryState };
