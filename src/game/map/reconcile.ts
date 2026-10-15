import { heldBy, positionOf, type Entity, type Point, type Rect, type SceneWorld } from "../../world/scene-world.ts";
import type { MapActor, Region, StoryState, Tile2, TileMap } from "../types.ts";
import { CAST, isCrowd, lookForEntity, raiseFor } from "./looks.ts";
import { inBounds, isStructure, tileAt, type PlaceRegion } from "./tiles.ts";

/**
 * Between a scene's world (feet, an entity tree) and the map (tiles). A region with a worldOrigin
 * says where the world's (0, 0) feet sits; a tile is 5 ft, and a point belongs to the tile it falls
 * in (so tile t covers feet [5t, 5t + 5) from the origin, and its centre is 5t + 2.5).
 *
 * actorsFromWorld draws the world as map actors: people where they stand (nudged off walls and off
 * each other, since a world can put two people in one 5-ft square), things by what they are, doors
 * on their door tiles with their states. Walls, trees and rivers the world mentions are already
 * terrain, so they only show when something happens to them (a burning elm).
 *
 * The overlay keeps what a scene did to its place after the scene ends (the world is dropped at the
 * scene boundary): the things as they were left, broken, burning, moved or gone, what was spilled
 * (puddles, slicks, scorch marks), and the place's own states (an exploded floor). The map shows
 * them from then on.
 */

export const FEET_PER_TILE = 5;

export function feetToTile(region: Region, p: Point): Tile2 {
  const o = region.worldOrigin ?? { x: region.rect.x, y: region.rect.y };
  return { x: o.x + Math.floor(p.x / FEET_PER_TILE), y: o.y + Math.floor(p.y / FEET_PER_TILE) };
}

/** The centre of a tile in the world's feet. */
export function tileToFeet(region: Region, t: Tile2): Point {
  const o = region.worldOrigin ?? { x: region.rect.x, y: region.rect.y };
  return { x: (t.x - o.x) * FEET_PER_TILE + FEET_PER_TILE / 2, y: (t.y - o.y) * FEET_PER_TILE + FEET_PER_TILE / 2 };
}

/** States worth showing on terrain-like things (an elm on fire, a wall knocked down). */
const NOTABLE = ["burning", "destroyed", "damaged", "smouldering", "broken", "open", "exploded"];
const DOWN = ["down", "unconscious", "dead", "prone"];

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

/** The scene world's people and things as map actors on the region's map. */
export function actorsFromWorld(region: Region, world: SceneWorld, options: FromWorldOptions = {}): MapActor[] {
  const map = options.map ?? mapOfRegion(region);
  if (!map) throw new Error(`actorsFromWorld: no map has region ${region.id}`);
  const out: MapActor[] = [];
  const taken = new Map<string, MapActor>();
  // Tiles with furniture on: people would rather stand beside a table than on it.
  const furnished = new Set<string>();
  const blocked = (p: Tile2) => !inBounds(map, p) || !!tileAt(map, p).blocks || isStructure(tileAt(map, p)) || tileAt(map, p).terrain === "void";
  const occupied = (p: Tile2) => taken.has(key(p));
  const place = (a: MapActor) => {
    out.push(a);
    if (a.blocks || a.kind === "person" || a.kind === "creature" || a.kind === "player") taken.set(key(a.at), a);
    if (a.kind === "object" && !(a.states ?? []).some(s => s === "hanging" || s === "overhead")) furnished.add(key(a.at));
  };

  // Surfaces (puddles, slicks, smoke) aren't things standing on a tile: the renderer lays them on the ground.
  const entities = Object.values(world.entities).filter(e => e.kind !== "place" && e.kind !== "area" && e.kind !== "surface" && !e.states.includes("gone"));
  // People last, so things are where they are and people step round them.
  const rank = (e: Entity) => (e.player ? 3 : e.kind === "person" || e.kind === "creature" ? 2 : 0);
  for (const e of entities.sort((a, b) => rank(a) - rank(b))) {
    if (e.player && options.player === false) continue;
    const being = e.kind === "person" || e.kind === "creature";
    if (being && options.people === false && !e.player) continue;
    if (being && options.cast && !e.player && e.cast && !options.cast.includes(e.cast)) continue;
    const holder = heldBy(world, e);
    // Carried things go with their carrier; things in or on things aren't drawn, except a body on a rope.
    if (holder && (holder.kind === "person" || holder.kind === "creature")) continue;
    if (holder && !being && !e.tags.includes("body") && !e.states.includes("hanging")) continue;
    if (holder && e.tags.includes("hanging") && !e.tags.includes("body")) continue;
    const feet = positionOf(world, e.id);
    if (!feet) continue;
    let at = feetToTile(region, feet);
    if (!inBounds(map, at)) continue;
    const look = lookForEntity(e);
    const notable = e.states.some(s => NOTABLE.includes(s));
    const door = e.tags.includes("door");
    if (door) {
      at = nearestTile(map, at, p => tileAt(map, p).terrain === "door", 2) ?? at;
    } else if (e.kind === "feature") {
      const t = tileAt(map, at);
      // Walls, trees, steps and rivers are the terrain already.
      if ((e.size === "huge" || e.size === "gargantuan" || isStructure(t) || t.terrain === "tree") && !notable) continue;
    }
    const states = [...e.states.filter(s => s !== "gone")];
    if (being) {
      if (isCrowd(e)) { for (const a of crowd(e, at, look.color, map, p => occupied(p) || furnished.has(key(p)), blocked)) place(a); continue; }
      // On a low wall is a place to sit (Moll); anywhere else that's built up, step off it.
      const t = tileAt(map, at);
      const perch = isStructure(t) && (t.height ?? 0) <= 1 && t.terrain !== "door";
      if ((blocked(at) && !perch) || occupied(at) || furnished.has(key(at))) {
        at = nearestWalk(map, at, p => !occupied(p) && !furnished.has(key(p)), 2) ?? nearestWalk(map, at, p => !occupied(p), 5) ?? at;
      }
      place({
        id: e.player ? "player" : e.id, name: e.player ? "you" : CAST[e.cast ?? e.id]?.name ?? e.name, kind: e.player ? "player" : e.kind === "creature" ? "creature" : "person",
        glyph: look.glyph, color: look.color, map: map.id, at, ref: e.cast ?? e.id, ...(states.length ? { states } : {}), blocks: !states.some(s => DOWN.includes(s)),
      });
      continue;
    }
    // Things: big ones take up room (and stand in the way), huge stacks spread over three tiles.
    const big = e.size === "large" || e.size === "huge" || e.size === "gargantuan";
    // Things hung from the ceiling (eel traps, a lantern on a beam, a hoist) are over everyone's heads.
    const aloft = e.states.includes("hanging") || e.tags.includes("overhead") || raiseFor(e.name, e.states) >= 3;
    if (blocked(at) && !door && !aloft) at = nearestTile(map, at, p => !blocked(p), 2) ?? at;
    const blocks = big && !door && !aloft && !e.states.includes("destroyed") && e.kind !== "item";
    const actor: MapActor = {
      id: e.id, name: e.name, kind: e.kind === "item" ? "item" : "object", glyph: look.glyph, color: look.color, map: map.id, at, ref: e.id,
      ...(states.length ? { states } : {}), ...(blocks ? { blocks: true } : {}), ...(e.quantity !== undefined ? { quantity: e.quantity } : {}),
      ...(e.description ? { interaction: { kind: "examine" as const, text: e.description, label: `Look at ${e.name}` } } : {}),
    };
    out.push(actor);
    if (blocks) taken.set(key(at), actor);
    if (!aloft && e.kind !== "item") furnished.add(key(at));
    if (e.size === "huge" && !door && e.kind !== "feature") {
      for (const p of spreadAlong(map, at, 2, q => !blocked(q) && !occupied(q))) place({ ...actor, id: `${e.id}#${p.x},${p.y}`, at: p });
    }
  }
  return out;
}

/** A crowd ("the regulars", "the gang") as a few people round its spot. */
function crowd(e: Entity, at: Tile2, color: string, map: TileMap, occupied: (p: Tile2) => boolean, blocked: (p: Tile2) => boolean): MapActor[] {
  const glyphs = /gang|porters|bargees/i.test(e.name) ? "pqbp" : "ppqh";
  const spots: Tile2[] = [];
  for (let r = 0; r <= 2 && spots.length < 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || spots.length >= 4) continue;
    const p = { x: at.x + dx, y: at.y + dy };
    if (inBounds(map, p) && !blocked(p) && !occupied(p) && !spots.some(s => s.x === p.x && s.y === p.y)) spots.push(p);
  }
  return spots.map((p, i) => ({
    id: i ? `${e.id}#${i}` : e.id, name: e.name, kind: "person" as const, glyph: glyphs[i % glyphs.length]!, color: color === "#b8ad9c" ? ["#b8ad9c", "#a89c88", "#c4b8a4", "#9c927e"][i % 4]! : color,
    map: map.id, at: p, ref: e.id, ...(e.states.length ? { states: [...e.states] } : {}), blocks: true,
    ...(e.description ? { interaction: { kind: "examine" as const, text: e.description, label: `Look at ${e.name}` } } : {}),
  }));
}

/** The nearest tile (by rings) that passes a test, within a radius. */
export function nearestTile(map: TileMap, from: Tile2, ok: (p: Tile2) => boolean, radius: number): Tile2 | undefined {
  if (inBounds(map, from) && ok(from)) return from;
  for (let r = 1; r <= radius; r++) {
    const ring: Tile2[] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) ring.push({ x: from.x + dx, y: from.y + dy });
    // Orthogonal neighbours before diagonal ones: it keeps people beside what they're beside.
    ring.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
    const hit = ring.find(p => inBounds(map, p) && ok(p));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The nearest standable tile by walking (never through a wall): for someone the world put in a
 * square that's taken, or inside a wall's thickness. From inside a wall, any floor beside it will do.
 */
export function nearestWalk(map: TileMap, from: Tile2, ok: (p: Tile2) => boolean, radius: number): Tile2 | undefined {
  const floor = (p: Tile2) => inBounds(map, p) && !tileAt(map, p).blocks && !isStructure(tileAt(map, p)) && tileAt(map, p).terrain !== "void";
  const seeds = floor(from) ? [from] : [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([dx, dy]) => ({ x: from.x + dx!, y: from.y + dy! })).filter(floor);
  const seen = new Set(seeds.map(key));
  let ring = seeds;
  for (let d = 0; d <= radius && ring.length; d++) {
    const hit = ring.find(ok);
    if (hit) return hit;
    const next: Tile2[] = [];
    for (const p of ring) for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]] as const) {
      const n = { x: p.x + dx, y: p.y + dy };
      if (seen.has(key(n)) || !floor(n)) continue;
      seen.add(key(n));
      next.push(n);
    }
    ring = next;
  }
  return undefined;
}

/** More tiles beside one, along whichever axis has room (a stack of sacks along a wall). */
function spreadAlong(map: TileMap, at: Tile2, count: number, ok: (p: Tile2) => boolean): Tile2[] {
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
    const run: Tile2[] = [];
    for (let i = 1; i <= count; i++) {
      const p = { x: at.x + dx * i, y: at.y + dy * i };
      if (!inBounds(map, p) || !ok(p)) break;
      run.push(p);
    }
    if (run.length === count) return run;
  }
  return [];
}

const key = (t: Tile2) => `${t.x},${t.y}`;

// ---------------------------------------------------------------------------------------------
// The overlay: what scenes did to their places, kept after the world is gone.

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

/**
 * What the rules did to a map's own things outside scenes (Fireball at a door, a Fire Bolt at a
 * stall): the things as they were left, the people as they were left until the story's clock moves
 * on (the town's people are the time of day's), and what was spilled or scorched.
 */
export interface TownChanges {
  things: Record<string, ThingChange>;
  /** The town's people as the rules (or a fight) left them, until the clock moves on: their states, and where a fight left them. */
  people?: { time: StoryState["time"]; states: Record<string, string[]>; at?: Record<string, Tile2> };
  /** The world's surfaces (puddles, scorch marks, burning patches), in the map's feet (5 ft a tile from its corner). */
  surfaces?: Entity[];
  surfacesTime?: StoryState["time"];
}

export const emptyOverlay = (): MapOverlay => ({ scenes: {} });

/** The region a town's world lines up with: the whole map, its (0, 0) feet at the map's corner. */
export function townRegion(map: TileMap): Region {
  return { id: `${map.id}:town`, name: map.name, rect: { x: 0, y: 0, w: map.width, h: map.height }, worldOrigin: { x: 0, y: 0 } };
}

/** States that say a thing is no longer what it was: what's in the way isn't, a door is a hole. */
const WRECKED = ["destroyed", "broken"];

/**
 * The map's actors with what happened to the town's own things applied: a burnt stall, a door
 * broken open (an actor on its tile, which is how the map knows a door's state), people run off or
 * knocked flat until the clock moves on. By a later time of day what was burning has burned out.
 */
export function withTownChanges(overlay: MapOverlay, mapId: string, now: StoryState["time"] | undefined, actors: MapActor[]): MapActor[] {
  const town = overlay.town?.[mapId];
  if (!town) return actors;
  const people = town.people && town.people.time === now ? town.people.states : {};
  const where = town.people && town.people.time === now ? town.people.at ?? {} : {};
  const out: MapActor[] = [];
  const seen = new Set<string>();
  for (const a of actors) {
    seen.add(a.id);
    const person = people[a.id];
    if (person) {
      if (person.includes("gone")) continue;
      const down = person.some(s => DOWN.includes(s));
      out.push({ ...a, states: [...(a.states ?? []).filter(s => !["hurt", "badly hurt", "down", "unconscious", "prone", "cowering"].includes(s)), ...person], ...(down ? { blocks: false } : {}), ...(where[a.id] ? { at: { ...where[a.id]! } } : {}) });
      continue;
    }
    const change = town.things[a.id];
    out.push(change ? changed(a, change, now) : a);
  }
  // Doors the map draws as its tiles: an actor on the tile says how it was left. A door some scene
  // has a thing of its own for (the yard gate, before its scene and after) is that scene's, not the town's.
  const held = new Set(actors.filter(a => a.kind === "object").map(a => `${a.at.x},${a.at.y}`));
  for (const [id, change] of Object.entries(town.things)) {
    if (seen.has(id) || !change.at || held.has(`${change.at.x},${change.at.y}`)) continue;
    out.push(changed({ id, name: change.name ?? "a door", kind: "object", glyph: "+", color: "#a0703a", map: mapId, at: { ...change.at } }, change, now));
  }
  return out;
}

/** The map's own marks on its things, which the town's world leaves out (src/game/town-world.ts): how it draws them, not how they are. */
const MARKS = ["post", "lamp", "scenery"];

function changed(a: MapActor, change: ThingChange, now: StoryState["time"] | undefined): MapActor {
  const later = !!now && !!change.time && TIMES.indexOf(now) > TIMES.indexOf(change.time);
  const burnt = later && change.states.includes("burning");
  const changedTo = burnt ? [...new Set([...change.states.filter(s => s !== "burning" && s !== "damaged"), "destroyed", "burnt"])] : change.states;
  // What still stands keeps the map's marks: a lamp post lit by the Light cantrip is still up its
  // post (and a lamp). A wreck is only a wreck, on the ground.
  const marks = changedTo.includes("destroyed") ? [] : (a.states ?? []).filter(s => MARKS.includes(s));
  const states = [...new Set([...marks, ...changedTo])];
  const { blocks: _blocks, ...rest } = a;
  return { ...rest, states, ...(a.blocks && !states.some(s => WRECKED.includes(s)) ? { blocks: true } : {}) };
}

/** The town's own spills and scorch marks on a map, for the renderer to lay on the ground. */
export function townSurfaces(overlay: MapOverlay, map: TileMap, now?: StoryState["time"]): Array<{ region: Region; world: SceneWorld }> {
  const town = overlay.town?.[map.id];
  if (!town?.surfaces?.length) return [];
  const later = !!now && !!town.surfacesTime && TIMES.indexOf(now) > TIMES.indexOf(town.surfacesTime);
  const region = townRegion(map);
  const root = `${map.id}:town:place`;
  const entities: Record<string, Entity> = { [root]: { id: root, name: map.name, kind: "place", parent: null, rect: { x: 0, y: 0, w: map.width * FEET_PER_TILE, h: map.height * FEET_PER_TILE }, tags: [], states: [], notes: [] } };
  for (const e of town.surfaces.filter(e => !later || !e.tags.includes("cloud"))) entities[e.id] = later && e.states.includes("burning") ? { ...e, name: "a scorch mark", tags: ["ash"], states: [] } : e;
  return [{ region, world: { scene: `${map.id}:town`, root, entities, log: [] } }];
}

/**
 * Keep a scene's world on the map after it ends. Call it when the scene ends, before chainScene
 * (which drops state.world). Things are kept whole, so a revisit shows the place as it was left.
 */
export function captureScene(overlay: MapOverlay, region: Region, world: SceneWorld, time?: StoryState["time"]): MapOverlay {
  const map = mapOfRegion(region);
  if (!map) throw new Error(`captureScene: no map has region ${region.id}`);
  const all = actorsFromWorld(region, world, { map, player: false });
  // People move on with the story; the fallen stay where they fell.
  const things = all.filter(a => a.kind === "object" || a.kind === "item" || (a.states ?? []).some(s => DOWN.includes(s)));
  const states = [...new Set(Object.values(world.entities).filter(e => e.kind === "area" || e.kind === "place").flatMap(e => e.states.filter(s => ["exploded", "burning", "burnt", "scorched", "flooded"].includes(s))))];
  const patches = Object.values(world.entities).filter(e => e.kind === "surface" && !e.states.includes("gone")).map(e => structuredClone(e));
  const place = world.entities[world.root]?.rect;
  overlay.scenes[world.scene] = { map: map.id, region: region.id, ...(time ? { time } : {}), things, states, ...(patches.length && place ? { surfaces: { place, patches } } : {}) };
  return overlay;
}

/**
 * What played scenes spilled on this map, as worlds for the renderer to lay on the ground. By a
 * later time of day the smoke has cleared and what was burning has burned out to a scorch mark.
 */
export function overlaySurfaces(overlay: MapOverlay, map: TileMap, now?: StoryState["time"]): Array<{ region: Region; world: SceneWorld }> {
  const out: Array<{ region: Region; world: SceneWorld }> = [];
  for (const [sceneId, s] of Object.entries(overlay.scenes)) {
    const region = s.map === map.id && s.surfaces ? map.regions.find(r => r.id === s.region) : undefined;
    if (!region || !s.surfaces) continue;
    const later = !!now && !!s.time && TIMES.indexOf(now) > TIMES.indexOf(s.time);
    const patches = s.surfaces.patches.filter(e => !later || !e.tags.includes("cloud")).map(e => (later && e.states.includes("burning") ? { ...e, name: "a scorch mark", tags: ["ash"], states: [] } : e));
    const root = `${sceneId}:place`;
    const entities: Record<string, Entity> = { [root]: { id: root, name: sceneId, kind: "place", parent: null, rect: s.surfaces.place, tags: [], states: [], notes: [] } };
    for (const e of patches) entities[e.id] = e;
    out.push({ region, world: { scene: sceneId, root, entities, log: [] } });
  }
  return out;
}

const TIMES: StoryState["time"][] = ["morning", "afternoon", "evening", "night", "next-morning"];

/**
 * The overlay's things on a map, as they are now: anything that was burning when the scene ended
 * has burned out by a later time of day (a smouldering heap), and the fire in the place has died.
 */
export function overlayActors(overlay: MapOverlay, mapId: string, now?: StoryState["time"]): MapActor[] {
  const out: MapActor[] = [];
  for (const [sceneId, s] of Object.entries(overlay.scenes)) {
    if (s.map !== mapId) continue;
    const later = !!now && !!s.time && TIMES.indexOf(now) > TIMES.indexOf(s.time);
    for (const a of s.things) {
      const states = a.states ?? [];
      const burnt = later && states.includes("burning");
      out.push({ ...a, id: a.id.includes(":") ? a.id : `${sceneId}:${a.id}`, ...(burnt ? { states: [...states.filter(x => x !== "burning" && x !== "damaged"), "destroyed", "burnt"], blocks: false } : {}) });
    }
  }
  return out;
}

/** Region states from the overlay, for the renderer: a scene's place and any region that's its outside. */
export function overlayRegionStates(overlay: MapOverlay, map: TileMap, now?: StoryState["time"]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [sceneId, s] of Object.entries(overlay.scenes)) {
    if (!s.states.length) continue;
    const later = !!now && !!s.time && TIMES.indexOf(now) > TIMES.indexOf(s.time);
    const states = later ? [...new Set([...s.states.filter(x => x !== "burning"), ...(s.states.includes("burning") || s.states.includes("exploded") ? ["burnt"] : [])])] : s.states;
    for (const r of map.regions as PlaceRegion[]) if ((r.id === s.region && s.map === map.id) || r.exteriorOf === sceneId) out[r.id] = [...new Set([...(out[r.id] ?? []), ...states])];
  }
  return out;
}

// The maps register themselves here, so a region can find its map.
const REGISTRY: TileMap[] = [];
export function registerMaps(maps: TileMap[]): void { for (const m of maps) if (!REGISTRY.includes(m)) REGISTRY.push(m); }
export function mapOfRegion(region: Region): TileMap | undefined {
  return REGISTRY.find(m => m.regions.includes(region)) ?? REGISTRY.find(m => m.regions.some(r => r.id === region.id));
}
