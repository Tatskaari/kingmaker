import type { SceneWorld } from "../../world/scene-world.ts";
import type { MapActor, Tile2, TileMap } from "../types.ts";
import { regionForScene } from "./places.ts";
import { actorsFromWorld, nearestWalk } from "./reconcile.ts";
import { tileAt } from "./tiles.ts";

/**
 * For whoever sets up a fight on the map (combat's startCombat): the scene's place, where everyone
 * in its world stands, what's in the way, and free spots to put people the world doesn't have yet
 * (Sallow's Crakes, a lantern-boy).
 */

export interface Battlefield {
  map: TileMap;
  /** People (by cast id, and "player") and where they stand, collisions already sorted out. */
  people: Record<string, Tile2>;
  /** Furniture and stacks that stand in the way (and give cover), by world entity id. */
  obstacles: Array<{ id: string; name: string; at: Tile2; states: string[] }>;
  /** Everything else worth drawing (items, things hung from the ceiling, wreckage). */
  things: MapActor[];
}

/** A scene's world laid out on its place's map, ready for a fight. */
export function battlefield(sceneId: string, world: SceneWorld): Battlefield | undefined {
  const found = regionForScene(sceneId);
  if (!found) return undefined;
  const actors = actorsFromWorld(found.region, world, { map: found.map });
  const people: Record<string, Tile2> = {};
  for (const a of actors) if (a.kind === "player" || a.kind === "person" || a.kind === "creature") people[a.kind === "player" ? "player" : a.ref ?? a.id] ??= { ...a.at };
  const obstacles = actors.filter(a => a.kind === "object" && a.blocks).map(a => ({ id: a.ref ?? a.id, name: a.name, at: { ...a.at }, states: a.states ?? [] }));
  const things = actors.filter(a => !(a.kind === "object" && a.blocks) && a.kind !== "player" && a.kind !== "person" && a.kind !== "creature");
  return { map: found.map, people, obstacles, things };
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
