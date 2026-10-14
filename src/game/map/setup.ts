import { areaAt, type Entity, type SceneWorld } from "../../world/scene-world.ts";
import type { MapActor, Tile, Tile2, TileMap } from "../types.ts";
import { regionForScene } from "./places.ts";
import { actorsFromWorld, nearestWalk, tileToFeet } from "./reconcile.ts";
import { inBounds, isStructure, tileAt } from "./tiles.ts";

/**
 * For whoever sets up a fight on the map (combat's startCombat): the scene's place, where everyone
 * in its world stands, what's in the way, and free spots to put people the world doesn't have yet
 * (Sallow's Crakes, a lantern-boy).
 */

export interface Battlefield {
  /**
   * The place's map as the world has it for a fight: furniture and stacks stand in the way (and
   * block sight when they're big), and its doors are open, shut or barred as the world says.
   */
  map: TileMap;
  /** People (by cast id, and "player") and where they stand, collisions already sorted out. */
  people: Record<string, Tile2>;
  /** Furniture and stacks that stand in the way (and give cover), by world entity id. */
  obstacles: Array<{ id: string; name: string; at: Tile2; states: string[] }>;
  /** Everything else worth drawing (items, things hung from the ceiling, wreckage). */
  things: MapActor[];
  /** Everyone and everything as map actors (for drawing the place round a fight). */
  actors: MapActor[];
  /** Lit flames in the place (lanterns, braziers, lamps): a fight can knock them over. Ids are the world's. */
  lights: MapActor[];
  /** Tiles in an area thick with dust (the Heron's floor): fire there sets it off. */
  dust: Tile2[];
  /** Tiles that burn once fire reaches them: whatever stands there is flammable (sacks, trestles, a heap of empties). */
  fuel: Tile2[];
}

/** A scene's world laid out on its place's map, ready for a fight. */
export function battlefield(sceneId: string, world: SceneWorld): Battlefield | undefined {
  const found = regionForScene(sceneId);
  if (!found) return undefined;
  const base = found.map;
  const actors = actorsFromWorld(found.region, world, { map: base });
  const entity = (a: MapActor): Entity | undefined => world.entities[a.ref ?? a.id] ?? world.entities[a.id.split("#")[0]!];
  const people: Record<string, Tile2> = {};
  for (const a of actors) if (a.kind === "player" || a.kind === "person" || a.kind === "creature") people[a.kind === "player" ? "player" : a.ref ?? a.id] ??= { ...a.at };
  const blocking = actors.filter(a => a.kind === "object" && a.blocks);
  const obstacles = blocking.map(a => ({ id: a.ref ?? a.id, name: a.name, at: { ...a.at }, states: a.states ?? [] }));
  const things = actors.filter(a => !(a.kind === "object" && a.blocks) && a.kind !== "player" && a.kind !== "person" && a.kind !== "creature");

  // The map for the fight: a copy, so the town's map is untouched.
  const tiles: Tile[][] = base.tiles.map(row => row.map(t => ({ ...t })));
  for (const a of blocking) {
    const t = tiles[a.at.y]?.[a.at.x];
    if (!t || isStructure(t) || t.blocks) continue;
    const big = /huge|gargantuan/.test(entity(a)?.size ?? "") || /stack|sacks/i.test(a.name);
    Object.assign(t, { blocks: true, height: big ? 2 : 1, ...(big ? { opaque: true } : {}) });
  }
  // Doors as the world has them (a whole double door goes with its leaf): open, or barred and locked.
  for (const a of actors) {
    if (a.kind !== "object" || tileAt(base, a.at).terrain !== "door") continue;
    const s = a.states ?? [];
    const open = s.includes("open") || s.includes("destroyed") || s.includes("broken");
    const shut = !open && s.some(x => x === "locked" || x === "barred" || x === "bolted");
    if (!open && !shut) continue;
    for (const p of doorRun(base, a.at)) {
      const t = tiles[p.y]![p.x]!;
      if (open) delete t.blocks; else t.blocks = true;
    }
  }
  const map: TileMap = { ...base, tiles };

  // Lit flames: braziers, lanterns, lamps (kept by their world ids, so a fight can write back what became of them).
  const lights: MapActor[] = [];
  for (const a of [...things, ...blocking]) {
    const e = entity(a);
    if (!e || a.id.includes("#") || !(e.tags.includes("fire") || e.tags.includes("light")) || !e.states.includes("lit")) continue;
    // A light's ref would say who carries it: these stand or hang where they are.
    const { ref: _ref, ...light } = a;
    lights.push({ ...light, id: e.id, kind: "object", name: lightName(e), states: [...new Set([...(a.states ?? []), "lit"])] });
  }
  // A lantern-boy carries his lantern into it.
  if (world.entities["lantern-boy"] && people["lantern-boy"] && !world.entities["lantern-boy"]!.states.includes("gone")) {
    lights.push({ id: "boys-lantern", name: "lantern on a pole", kind: "object", glyph: "¤", color: "#ffd27f", map: base.id, at: { ...people["lantern-boy"] }, ref: "lantern-boy", states: ["lit", "carried"] });
  }

  // Dust: tiles whose area (the smallest one round the tile's middle) is dusty.
  const dust: Tile2[] = [];
  const r = found.region.rect;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    const p = { x, y };
    const t = tileAt(map, p);
    if (!inBounds(map, p) || t.blocks || isStructure(t) || t.terrain === "void" || t.terrain === "water" || t.terrain === "deep-water") continue;
    if (areaAt(world, tileToFeet(found.region, p)).states.includes("dusty")) dust.push(p);
  }
  // Fuel: where something flammable stands (a stack's every tile), and flammable spills.
  const fuel: Tile2[] = [];
  const seen = new Set<string>();
  for (const a of actors) {
    const e = entity(a);
    if (!e || a.kind === "player" || a.kind === "person" || a.kind === "creature" || !e.tags.includes("flammable") || e.states.includes("destroyed")) continue;
    const solidThing = a.blocks || e.kind === "surface";
    if (!solidThing) continue;
    const k = `${a.at.x},${a.at.y}`;
    if (!seen.has(k)) { seen.add(k); fuel.push({ ...a.at }); }
  }
  return { map, people, obstacles, things, actors, lights, dust, fuel };
}

/** A door tile and the door tiles in line with it (both leaves of a double door). */
function doorRun(map: TileMap, at: Tile2): Tile2[] {
  const out: Tile2[] = [at];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    for (let i = 1; i < 4; i++) {
      const p = { x: at.x + dx * i, y: at.y + dy * i };
      if (!inBounds(map, p) || tileAt(map, p).terrain !== "door") break;
      out.push(p);
    }
  }
  return out;
}

/** What a fight calls a light ("the brazier", "the hanging lantern"): the world's name without an article or an owner. */
function lightName(e: Entity): string {
  const name = e.name.replace(/^(a|an|the)\s+/i, "").replace(/^[A-Z][a-z]+'s\s+/, "");
  if (/lantern/i.test(name) && e.states.includes("hanging")) return "hanging lantern";
  return name;
}

/**
 * Tiles someone could walk to in so many 5-ft steps (diagonals count as one, as in 5e's default),
 * round walls, shut doors and whatever `blocked` says (other people, furniture), with the steps
 * each takes. For drawing a move range; the rules decide what a move really costs.
 */
export function reachable(map: TileMap, from: Tile2, steps: number, blocked: (p: Tile2) => boolean = () => false): Array<{ at: Tile2; steps: number }> {
  const standable = (p: Tile2) => {
    const t = map.tiles[p.y]?.[p.x];
    return !!t && !t.blocks && t.terrain !== "void" && t.terrain !== "wall" && t.terrain !== "window" && t.terrain !== "fence" && t.terrain !== "tree";
  };
  const seen = new Map<string, number>([[`${from.x},${from.y}`, 0]]);
  const queue: Tile2[] = [from];
  const out: Array<{ at: Tile2; steps: number }> = [];
  while (queue.length) {
    const p = queue.shift()!;
    const d = seen.get(`${p.x},${p.y}`)!;
    if (d >= steps) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const n = { x: p.x + dx, y: p.y + dy };
      const k = `${n.x},${n.y}`;
      if (seen.has(k) || !standable(n) || blocked(n)) continue;
      // No squeezing diagonally between two walls.
      if (dx && dy && !standable({ x: p.x + dx, y: p.y }) && !standable({ x: p.x, y: p.y + dy })) continue;
      seen.set(k, d + 1);
      out.push({ at: n, steps: d + 1 });
      queue.push(n);
    }
  }
  return out;
}

/** Free tiles near someone, nearest first by walking (never through a wall), avoiding the ones taken. */
export function spotsNear(map: TileMap, at: Tile2, count: number, taken: Tile2[] = []): Tile2[] {
  const used = new Set(taken.map(t => `${t.x},${t.y}`));
  used.add(`${at.x},${at.y}`);
  const out: Tile2[] = [];
  for (let i = 0; i < count; i++) {
    const spot = nearestWalk(map, at, p => !used.has(`${p.x},${p.y}`) && tileAt(map, p).terrain !== "water", 6);
    if (!spot) break;
    out.push(spot);
    used.add(`${spot.x},${spot.y}`);
  }
  return out;
}

