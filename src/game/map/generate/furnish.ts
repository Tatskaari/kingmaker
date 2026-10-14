import type { Tile2 } from "../../types.ts";
import type { Entity } from "../../../world/scene-world.ts";
import { isCrowd, raiseFor } from "../looks.ts";
import { tile, type MapTile } from "../tiles.ts";
import { TERRAIN_NAMES, type Problem } from "./normalize.ts";
import { dir } from "./orient.ts";
import { SIDES, type Corner, type PersonPlan, type PlacePlan, type Side, type ThingPlan } from "./plan.ts";
import { DIR, OPPOSITE, add, tkey, type AreaInfo, type DoorInfo, type Site } from "./layout.ts";

/**
 * Furnishing a laid-out place: every thing in the plan on tiles chosen by its relation (against a
 * wall, in a corner, near, beside, behind or between other things, by a door, in the middle,
 * overhead), people likewise, and the player by the way in. Hard rules: one thing to a tile, door
 * aprons (the squares either side of a door) kept clear, nothing that blocks may cut a pocket off,
 * and everything keeps a free square beside it to be reached from. Among what's allowed, the
 * relation scores, and a square the default camera can't see scores very badly.
 *
 * Long fixtures (a bar, a counter, shelves, pews) are runs of low wall (fence tiles, like the Rat's
 * skiff-hull bar); a bar or counter stands a square off its wall, with room behind it to serve
 * from and a gap at an end to get there. Huge things (a stack of sacks) take three squares in a
 * row, the way the map draws them.
 */

export interface Placement {
  id: string;
  name: string;
  area: string;
  /** The tiles it stands on (none for things on, in or under something). */
  tiles: Tile2[];
  /** Where the world says it is: a run's middle, a huge thing's first square. */
  anchor?: Tile2;
  /** Held by another thing or a person (on, in, under). */
  heldBy?: string;
  run?: boolean;
  /** Drawn over three squares in a row, as the map draws huge things. */
  spread?: boolean;
  aloft?: boolean;
  /** The ground itself (the river, the steps): drawn by the map, not as a thing. */
  terrain?: boolean;
  blocks?: boolean;
  person?: boolean;
  /** Its states as the world should have them (something hung up is "hanging"). */
  states?: string[];
}

export interface Furnished {
  things: Map<string, Placement>;
  people: Map<string, Placement>;
  start: Tile2;
  startArea: string;
  problems: Problem[];
  notes: string[];
}

const RUN_STYLE: Record<string, string> = { wood: "panel", stone: "stone", iron: "hull", steel: "hull", brass: "hull", glass: "panel" };
const COUNTER = /\b(bar|counter|serving|till)\b/i;
const BIG = new Set(["large", "huge", "gargantuan"]);

export const isStructureTile = (t: MapTile) => t.terrain === "wall" || t.terrain === "window" || t.terrain === "door" || t.terrain === "fence";
/** A wall to stand things against: walls, windows and doors, and on a boat its rail. */
export const isWallish = (t: MapTile | undefined, boat = false) => !!t && (t.terrain === "wall" || t.terrain === "window" || t.terrain === "door" || (boat && t.terrain === "fence" && t.style === "hull"));
const cheb = (a: Tile2, b: Tile2) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const near8 = (p: Tile2) => [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]].map(([dx, dy]) => ({ x: p.x + dx!, y: p.y + dy! }));
const centreOf = (ts: Tile2[]) => ({ x: ts.reduce((n, p) => n + p.x, 0) / ts.length, y: ts.reduce((n, p) => n + p.y, 0) / ts.length });
const hashOf = (...ns: number[]) => { let h = 2166136261; for (const n of ns) { h ^= n & 0xffff; h = Math.imul(h, 16777619); } return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };
const strHash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

/** Terrain things: the map draws them already (the river, the steps), so they take no square. */
export const isTerrainThing = (t: Pick<ThingPlan, "kind" | "size" | "name" | "material">) =>
  t.kind === "feature" && (t.size === "huge" || t.size === "gargantuan") && (TERRAIN_NAMES.test(t.name) || t.material === "liquid");

/** How far up the screen a thing is drawn (hanging, overhead), as the renderer will draw it. */
export const liftOf = (name: string, states: string[]) => raiseFor(name, states);

export function furnish(site: Site, plan: PlacePlan): Furnished {
  const problems: Problem[] = [];
  const notes: string[] = [];
  const { width, height, tiles } = site;
  const inBounds = (p: Tile2) => p.x >= 0 && p.y >= 0 && p.x < width && p.y < height;
  const tileAt = (p: Tile2) => (inBounds(p) ? tiles[p.y]![p.x]! : undefined);
  const areaAt = (p: Tile2) => (inBounds(p) ? site.area[p.y * width + p.x] : undefined);
  const occupied = new Map<string, string>(); // floor things
  const aloftAt = new Map<string, string>();
  const peopleAt = new Map<string, string>();
  const blocked = new Set<string>(); // tiles that blocking things stand on
  const reserved = new Set<string>();
  /** Squares with only a small item on: the map stands people on them, so crowds must avoid them. */
  const items = new Set<string>();
  for (const d of site.doors) { reserved.add(tkey(d.inside)); reserved.add(tkey(d.outside)); }

  // The player stands by the way in, on the start's side of the door.
  const startArea = site.areas.has(plan.start) ? plan.start : site.entrance?.to ?? [...site.areas.keys()][0]!;
  const door = site.entrance;
  let start: Tile2 = door ? (areaAt(door.outside) === startArea ? door.outside : areaAt(door.inside) === startArea ? door.inside : door.outside) : site.areas.get(startArea)!.tiles[0]!;
  if (door && areaAt(start) !== startArea) start = door.outside;
  reserved.add(tkey(start));

  // Moving about: walkable tiles, doors open (even locked ones: they open from somewhere).
  const passable = (p: Tile2, extra?: Set<string>) => {
    const t = tileAt(p);
    if (!t || t.terrain === "void" || t.terrain === "wall" || t.terrain === "window" || t.terrain === "fence" || t.terrain === "deep-water") return false;
    if (t.blocks && t.terrain !== "door") return false;
    const k = tkey(p);
    return !blocked.has(k) && !extra?.has(k);
  };
  const origin = door?.outside ?? start;
  const reach = (extra?: Set<string>) => {
    const seen = new Set<string>();
    if (!passable(origin, extra)) return seen;
    const queue = [origin];
    seen.add(tkey(origin));
    while (queue.length) {
      const p = queue.pop()!;
      for (const s of SIDES) {
        const n = add(p, DIR[s]);
        const k = tkey(n);
        if (!seen.has(k) && inBounds(n) && passable(n, extra)) { seen.add(k); queue.push(n); }
      }
    }
    return seen;
  };
  let reached = reach();

  // What the default camera sees: the scene view (roofs off), the room you're in opened up.
  const cutFor = new Map<string, Set<string>>();
  const cutOf = (areaId: string) => {
    let cut = cutFor.get(areaId);
    if (cut) return cut;
    cut = new Set();
    const a = site.areas.get(areaId);
    if (a?.room) {
      for (const p of a.tiles) for (const n of [add(p, DIR.west), add(p, DIR.south), { x: p.x - 1, y: p.y + 1 }]) { const t = tileAt(n); if (t && isStructureTile(t)) cut.add(tkey(n)); }
      for (const k of [...cut]) {
        const [x, y] = k.split(",").map(Number) as [number, number];
        for (const n of [{ x: x - 1, y: y + 1 }, { x: x - 1, y }, { x, y: y + 1 }]) { const t = tileAt(n); if (t && isStructureTile(t) && a.tiles.some(r => cheb(r, n) <= 1)) cut.add(tkey(n)); }
      }
    }
    cutFor.set(areaId, cut);
    return cut;
  };
  /** Hidden: something in front of it on screen (south-west, d squares) stands at least 2d + lift rows tall. */
  const hidden = (p: Tile2, areaId: string, lift = 0) => {
    const cut = cutOf(areaId);
    for (let d = 1; d <= 3; d++) {
      const q = { x: p.x - d, y: p.y + d };
      const t = tileAt(q);
      if (!t || !isStructureTile(t)) continue;
      const h = cut.has(tkey(q)) ? 1 : t.height ?? 1;
      if (h >= 2 * d + lift) return true;
    }
    return false;
  };

  const free = (p: Tile2, area: string, opts: { aloft?: boolean; person?: boolean } = {}) => {
    const t = tileAt(p);
    if (!t || areaAt(p) !== area || !passable(p)) return false;
    // Not in the shallows, and not on a gangplank (a boat's only way aboard).
    const a = site.areas.get(area);
    if (t.terrain === "water" || (t.terrain === "bridge" && (a?.ground === "water" || a?.boat))) return false;
    const k = tkey(p);
    if (opts.aloft) return !aloftAt.has(k);
    if (occupied.has(k) || peopleAt.has(k) || reserved.has(k)) return false;
    return true;
  };

  const things = new Map<string, Placement>();
  const people = new Map<string, Placement>();
  const doorById = new Map(site.doors.map(d => [d.id, d]));
  const nameOf = (id: string) => plan.things.find(t => t.id === id)?.name ?? plan.people.find(p => p.id === id)?.name ?? doorById.get(id)?.plan.name ?? id;
  /** Where a target is: a placed thing's squares, a door's apron on this side, a person's square. */
  const targetTiles = (id: string, area: string): Tile2[] | undefined => {
    const t = things.get(id) ?? people.get(id);
    if (t) return t.tiles.length ? t.tiles : t.heldBy ? targetTiles(t.heldBy, area) : t.anchor ? [t.anchor] : undefined;
    const d = doorById.get(id);
    if (d) return [areaAt(d.inside) === area ? d.inside : areaAt(d.outside) === area ? d.outside : d.at];
    return undefined;
  };
  /** The way into an area: the door people come in by (the reference for "behind"). */
  const wayIn = (area: string): Tile2 | undefined => {
    const ds = site.doors.filter(d => areaAt(d.inside) === area || areaAt(d.outside) === area);
    const d = ds.find(x => x === site.entrance) ?? ds[0];
    return d ? (areaAt(d.inside) === area ? d.inside : d.outside) : undefined;
  };

  type Want = { relation: ThingPlan["relation"]; wall: Side | "none"; corner: Corner | "none"; target: string; target2: string };
  const hasWall = (area: AreaInfo, side: Side) => area.tiles.some(p => isWallish(tileAt(add(p, DIR[side])), area.boat));
  /** How well squares honour a relation (higher is better). */
  const relationScore = (ts: Tile2[], want: Want, area: AreaInfo, counter: boolean): number => {
    const c = centreOf(ts);
    switch (want.relation) {
      case "against": {
        // The wall asked for, if the area has one on that side (a quay's only wall is the building's).
        const sides: Side[] = want.wall !== "none" && hasWall(area, want.wall) ? [want.wall] : [...SIDES];
        let best = -1e9;
        for (const s of sides) {
          const flush = ts.filter(p => isWallish(tileAt(add(p, DIR[s])), area.boat)).length / ts.length;
          const offset = counter ? ts.filter(p => free(add(p, DIR[s]), area.id) && isWallish(tileAt(add(p, DIR[s], 2)))).length / ts.length : 0;
          const exact = counter ? Math.max(offset, flush * 0.6) : flush;
          // Room in front of it to use it (a bar with one row of floor before it is a corridor).
          const front = ts.reduce((n, p) => { let k = 0; while (k < 3 && free(add(p, DIR[OPPOSITE[s]], k + 1), area.id)) k++; return n + k; }, 0) / ts.length;
          // Along a wall, the middle of it is best.
          best = Math.max(best, 24 * exact + 2 * front * exact - 0.3 * Math.abs((s === "north" || s === "south" ? c.x - (area.bbox.x + (area.bbox.w - 1) / 2) : c.y - (area.bbox.y + (area.bbox.h - 1) / 2))));
        }
        return best;
      }
      case "corner": {
        const [s1, s2] = (want.corner !== "none" ? want.corner.split("-") : [want.wall !== "none" ? want.wall : "north", "east"]) as [Side, Side];
        const both = ts.some(p => isWallish(tileAt(add(p, DIR[s1])), area.boat) && isWallish(tileAt(add(p, DIR[s2])), area.boat));
        const one = ts.some(p => isWallish(tileAt(add(p, DIR[s1])), area.boat) || isWallish(tileAt(add(p, DIR[s2])), area.boat));
        const cx = s1 === "east" || s2 === "east" ? area.bbox.x + area.bbox.w - 1 : area.bbox.x;
        const cy = s1 === "south" || s2 === "south" ? area.bbox.y + area.bbox.h - 1 : area.bbox.y;
        return (both ? 24 : one ? 8 : 0) - 1.5 * Math.hypot(c.x - cx, c.y - cy);
      }
      case "centre": case "overhead": {
        const m = centreOf(area.tiles);
        return 10 - 2 * Math.hypot(c.x - m.x, c.y - m.y);
      }
      case "near": case "beside": case "by-door": {
        const target = targetTiles(want.target, area.id);
        if (!target) return 0;
        const d = Math.min(...ts.flatMap(p => target.map(q => cheb(p, q))));
        const orth = ts.some(p => target.some(q => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1));
        if (want.relation === "beside") return d === 1 ? (orth ? 20 : 14) : d === 2 ? 5 : -3 * d;
        if (want.relation === "by-door") {
          const dd = doorById.get(want.target);
          const dist = dd ? Math.min(...ts.map(p => cheb(p, dd.at))) : d;
          // Beside the door along its wall, inside: a square off the apron.
          return dist === 1 ? 20 : dist === 2 ? 12 : -2 * dist;
        }
        return d === 1 ? 16 : d === 2 ? 11 : d === 3 ? 5 : -2 * d;
      }
      case "behind": {
        const target = targetTiles(want.target, area.id);
        if (!target) return 0;
        const tc = centreOf(target);
        const from = wayIn(area.id) ?? centreOf(area.tiles);
        const v = { x: tc.x - from.x, y: tc.y - from.y }, len = Math.hypot(v.x, v.y) || 1;
        const u = { x: c.x - tc.x, y: c.y - tc.y }, ulen = Math.hypot(u.x, u.y) || 1;
        const along = (u.x * v.x + u.y * v.y) / (len * ulen);
        const d = Math.min(...ts.flatMap(p => target.map(q => cheb(p, q))));
        return (d === 1 ? 12 : d === 2 ? 6 : -2 * d) + 10 * along;
      }
      case "between": {
        const a = targetTiles(want.target, area.id), b = targetTiles(want.target2, area.id);
        if (!a || !b) return 0;
        const pa = centreOf(a), pb = centreOf(b);
        const ab = { x: pb.x - pa.x, y: pb.y - pa.y }, l2 = ab.x * ab.x + ab.y * ab.y || 1;
        const u = ((c.x - pa.x) * ab.x + (c.y - pa.y) * ab.y) / l2;
        const cu = Math.max(0, Math.min(1, u));
        const off = Math.hypot(c.x - (pa.x + ab.x * cu), c.y - (pa.y + ab.y * cu));
        const touching = ts.some(p => [...a, ...b].some(q => cheb(p, q) === 0));
        return 18 - 4 * off - 6 * Math.abs(u - 0.5) - (u < 0 || u > 1 ? 10 : 0) - (touching ? 20 : 0);
      }
      default: return 0;
    }
  };

  /** Straight runs of `length` free squares in an area (both ways), or single squares. */
  const runsIn = (area: AreaInfo, length: number, opts: { aloft?: boolean; person?: boolean } = {}): Tile2[][] => {
    const out: Tile2[][] = [];
    for (const p of area.tiles) {
      if (!free(p, area.id, opts)) continue;
      if (length === 1) { out.push([p]); continue; }
      for (const s of ["east", "south"] as const) {
        const run = Array.from({ length }, (_, i) => add(p, DIR[s], i));
        if (run.every(q => free(q, area.id, opts))) out.push(run);
      }
    }
    return out;
  };

  /** Would blocking these squares cut anything reachable off? */
  const cutsOff = (ts: Tile2[]) => {
    const extra = new Set(ts.map(tkey));
    const after = reach(extra);
    for (const k of reached) if (!extra.has(k) && !after.has(k)) return true;
    return false;
  };
  /** A free square beside it to stand on and reach it from. */
  const reachable = (ts: Tile2[]) => {
    const own = new Set(ts.map(tkey));
    return ts.some(p => near8(p).some(n => !own.has(tkey(n)) && reached.has(tkey(n)) && !blocked.has(tkey(n))));
  };
  // Where each thing and person is drawn on screen: column x + y, row y - x - lift (render.ts's
  // projection). One to a cell, or one hides the other: a lantern hung two rows up is drawn on the
  // cell of the square behind it (north-east), a hoist beam four rows up on the next one again.
  const drawn = new Map<string, string>();
  const cellOf = (p: Tile2, lift = 0) => `${p.x + p.y},${p.y - p.x - lift}`;
  const clearCells = (ts: Tile2[], lift: number) => ts.every(p => !drawn.has(cellOf(p, lift)));
  const draw = (ts: Tile2[], lift: number, id: string) => { for (const p of ts) drawn.set(cellOf(p, lift), id); };
  /** Every placed thing still has a free square beside it (a new blocker mustn't wall one in). */
  const stillReachable = (extra: Tile2[]) => {
    const now = new Set(extra.map(tkey));
    for (const p of things.values()) {
      if (!p.tiles.length || p.aloft || p.terrain || p.person) continue;
      const own = new Set(p.tiles.map(tkey));
      if (!p.tiles.some(q => near8(q).some(n => !own.has(tkey(n)) && !now.has(tkey(n)) && reached.has(tkey(n)) && !blocked.has(tkey(n))))) return false;
    }
    return true;
  };

  const place = (t: ThingPlan): Placement | undefined => {
    const area = site.areas.get(t.in);
    if (!area) { problems.push({ check: "plan", subject: t.id, message: `${t.name} is in ${t.in}, which didn't make it onto the map.`, severity: "error" }); return undefined; }
    if (isTerrainThing(t)) return { id: t.id, name: t.name, area: area.id, tiles: [], anchor: nearestTo(area.tiles, centreOf(area.tiles)), terrain: true };
    if (t.relation === "on" || t.relation === "in" || t.relation === "under") {
      if (things.has(t.target) || people.has(t.target) || plan.things.some(x => x.id === t.target) || plan.people.some(p => p.id === t.target)) return { id: t.id, name: t.name, area: area.id, tiles: [], heldBy: t.target };
    }
    const aloft = t.relation === "overhead";
    const states = aloft && liftOf(t.name, t.states) < 2 ? [...t.states, "hanging"] : t.states;
    const lift = liftOf(t.name, states);
    // The map draws huge things over three squares (a gargantuan stack is drawn as a huge one);
    // what hangs overhead, or is a long fixture, isn't spread.
    const huge = (t.size === "huge" || t.size === "gargantuan") && !aloft && t.tiles < 2 && t.kind !== "item" && t.kind !== "crowd" && t.kind !== "creature";
    const small = t.kind === "item" || t.kind === "crowd" || t.kind === "creature" || t.size === "tiny" || t.size === "small";
    const run = !aloft && !huge && !small && t.tiles >= 2;
    const length = huge ? 3 : run ? Math.min(t.tiles, Math.max(2, Math.max(area.bbox.w, area.bbox.h) - 2)) : 1;
    const blocks = run || (!aloft && t.kind !== "item" && t.kind !== "crowd" && BIG.has(t.size));
    const counter = run && COUNTER.test(t.name) && t.relation === "against";
    const want: Want = { relation: t.relation === "on" || t.relation === "in" || t.relation === "under" ? "centre" : t.relation, wall: t.wall, corner: t.corner, target: t.target, target2: t.target2 };
    const targets = new Set([want.target, want.target2]);
    let options = runsIn(area, length, { aloft });
    if (huge) options = options.filter(ts => spreadsLikeTheMap(ts));
    // Drawn where nothing else is; a run of low wall is terrain, not drawn as a thing.
    if (!run) options = options.filter(ts => clearCells(ts, lift));
    const scored = options.map(ts => {
      let s = relationScore(ts, want, area, counter);
      if (ts.some(p => hidden(p, area.id, lift))) s -= 60;
      if (!aloft) {
        // Spread out a little: a crowded square scores less (its own target doesn't count).
        const crowd = ts.reduce((n, p) => n + near8(p).filter(q => { const o = occupied.get(tkey(q)); return o && !targets.has(o); }).length, 0);
        s -= 1.2 * crowd / ts.length;
        // Keep big things off the squares in front of doors and out of the middle of narrow places.
        if (blocks && ts.some(p => near8(p).some(q => reserved.has(tkey(q))))) s -= 3;
      }
      s += 0.01 * hashOf(strHash(t.id), ts[0]!.x, ts[0]!.y);
      return { ts, s };
    }).sort((a, b) => b.s - a.s);
    for (const { ts } of scored) {
      if (!aloft && !reachable(ts)) continue;
      if (blocks && (cutsOff(ts) || !stillReachable(ts))) continue;
      for (const p of ts) (aloft ? aloftAt : occupied).set(tkey(p), t.id);
      if (!aloft && t.kind === "item") for (const p of ts) items.add(tkey(p));
      if (!run) draw(ts, lift, t.id);
      if (blocks) { for (const p of ts) blocked.add(tkey(p)); reached = reach(); }
      const anchor = run ? ts[Math.floor((ts.length - 1) / 2)]! : ts[0]!;
      if (run) for (const p of ts) tiles[p.y]![p.x] = tile("fence", { style: /hull|skiff|boat/i.test(t.name) ? "hull" : RUN_STYLE[t.material] ?? "fence", height: 1 });
      return { id: t.id, name: t.name, area: area.id, tiles: ts, anchor, states, ...(run ? { run: true } : {}), ...(huge ? { spread: true } : {}), ...(aloft ? { aloft: true } : {}), ...(blocks ? { blocks: true } : {}) };
    }
    problems.push({ check: "fit", subject: t.id, message: `There was no room for ${t.name} ${describe(want, nameOf)} in ${area.name}: it's too full, or too small. Put it somewhere else, or leave something out.`, severity: "error" });
    return undefined;

    /** The map draws a huge thing over three squares, east of its first if it can, else south. */
    function spreadsLikeTheMap(ts: Tile2[]): boolean {
      if (ts[1]!.x === ts[0]!.x + 1) return true;
      const east = [add(ts[0]!, DIR.east), add(ts[0]!, DIR.east, 2)];
      return east.some(p => { const tt = tileAt(p); return !tt || tt.blocks || isStructureTile(tt) || blocked.has(tkey(p)); });
    }
  };

  // In order: what stands on the floor (by walls and corners first, then by what it's near), the
  // people (clear of it), the crowds (over the squares round them, as the map spreads them), and
  // last what hangs overhead (never drawn over anyone's square).
  const placeAll = (list: ThingPlan[]) => {
    const pending = [...list];
    const rank = (t: ThingPlan) => (["against", "corner"].includes(t.relation) ? (t.tiles >= 2 ? 0 : 1) : t.relation === "centre" ? 1 : 2);
    pending.sort((a, b) => rank(a) - rank(b));
    for (let pass = 0; pass < 6 && pending.length; pass++) {
      for (let i = 0; i < pending.length; i++) {
        const t = pending[i]!;
        const needs = [t.target, t.target2].filter(Boolean).filter(id => !doorById.has(id) && list.some(x => x.id === id));
        // Wait for what it's placed by, unless that's waiting on it (or never comes).
        if (pass < 5 && t.relation !== "on" && t.relation !== "in" && t.relation !== "under" && needs.some(id => !things.has(id))) continue;
        pending.splice(i--, 1);
        const p = place(t);
        if (p) things.set(t.id, p);
      }
    }
  };
  // Something hung overhead that other things are placed by ("the book near the counting-box") goes
  // up first; the rest of what hangs waits until everyone is in place.
  const targeted = new Set(plan.things.flatMap(t => [t.target, t.target2]));
  const early = (t: ThingPlan) => t.relation !== "overhead" || targeted.has(t.id);
  placeAll(plan.things.filter(t => early(t) && t.kind !== "crowd"));

  // People: on free squares by their relation; never on a thing, in a doorway or out of sight.
  const placePerson = (p: PersonPlan) => {
    const area = site.areas.get(p.in) ?? site.areas.get(startArea)!;
    const want: Want = { relation: p.relation, wall: "none", corner: "none", target: p.target, target2: "" };
    const scored = area.tiles.filter(q => free(q, area.id, { person: true }) && !blocked.has(tkey(q)) && reached.has(tkey(q)) && clearCells([q], 0))
      .map(q => ({ q, s: relationScore([q], want, area, false) - (hidden(q, area.id) ? 60 : 0) - near8(q).filter(n => peopleAt.has(tkey(n))).length + 0.01 * hashOf(strHash(p.id), q.x, q.y) }))
      .sort((a, b) => b.s - a.s);
    const best = scored[0]?.q;
    if (!best) { problems.push({ check: "fit", subject: p.id, message: `There was no room for ${p.name} in ${area.name}.`, severity: "error" }); return; }
    peopleAt.set(tkey(best), p.id);
    draw([best], 0, p.id);
    people.set(p.id, { id: p.id, name: p.name, area: area.id, tiles: [best], anchor: best, person: true });
  };
  for (const p of plan.people) placePerson(p);

  /**
   * Where the map will stand a crowd's members (reconcile.ts, crowd()): its square, then the rings
   * round it in reading order, skipping what's built, taken by someone or furnished, four at most.
   * Crowds the map doesn't recognise by name are one person.
   */
  const membersAt = (anchor: Tile2, name: string): Tile2[] => {
    if (!isCrowd({ kind: "person", name } as Entity)) return [anchor];
    const spots: Tile2[] = [];
    for (let r = 0; r <= 2 && spots.length < 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || spots.length >= 4) continue;
      const q = { x: anchor.x + dx, y: anchor.y + dy };
      const t = tileAt(q);
      if (!t || t.blocks || isStructureTile(t) || t.terrain === "void") continue;
      const k = tkey(q);
      if (blocked.has(k) || peopleAt.has(k) || (occupied.has(k) && !items.has(k)) || spots.some(o => o.x === q.x && o.y === q.y)) continue;
      spots.push(q);
    }
    return spots;
  };
  for (const t of plan.things.filter(x => x.kind === "crowd" && x.relation !== "on" && x.relation !== "in" && x.relation !== "under")) {
    const area = site.areas.get(t.in) ?? site.areas.get(startArea)!;
    const want: Want = { relation: t.relation === "overhead" ? "centre" : t.relation, wall: t.wall, corner: t.corner, target: t.target, target2: t.target2 };
    const scored = area.tiles.filter(q => free(q, area.id, { person: true }) && reached.has(tkey(q)) && clearCells([q], 0))
      .map(q => ({ q, s: relationScore([q], want, area, false) + 0.01 * hashOf(strHash(t.id), q.x, q.y) }))
      .sort((a, b) => b.s - a.s);
    let done = false;
    for (const { q } of scored) {
      const members = membersAt(q, t.name);
      // Every member on clear floor, in sight, off the doorways and off the player's square.
      if (members.some(m => reserved.has(tkey(m)) || items.has(tkey(m)) || !clearCells([m], 0) || areaAt(m) !== area.id || !reached.has(tkey(m)) || hidden(m, area.id) || tileAt(m)!.terrain === "water")) continue;
      for (const m of members) peopleAt.set(tkey(m), t.id);
      draw(members, 0, t.id);
      things.set(t.id, { id: t.id, name: t.name, area: area.id, tiles: members, anchor: q, person: true });
      done = true;
      break;
    }
    if (!done) problems.push({ check: "fit", subject: t.id, message: `There was no room for ${t.name} in ${area.name}: a crowd needs a clear patch of floor.`, severity: "error" });
  }

  placeAll(plan.things.filter(t => !early(t) && t.kind !== "crowd"));
  return { things, people, start, startArea, problems, notes };
}

export function describe(want: { relation: string; wall: string; corner: string; target: string; target2: string }, nameOf: (id: string) => string = id => id): string {
  switch (want.relation) {
    case "against": return want.wall !== "none" ? `against the ${dir(want.wall)} wall` : "against a wall";
    case "corner": return want.corner !== "none" ? `in the ${dir(want.corner)} corner` : "in a corner";
    case "between": return `between ${nameOf(want.target)} and ${nameOf(want.target2)}`;
    case "centre": return "in the middle";
    case "overhead": return "overhead";
    case "by-door": return `by ${nameOf(want.target)}`;
    default: return `${want.relation} ${nameOf(want.target)}`;
  }
}

function nearestTo(ts: Tile2[], c: { x: number; y: number }): Tile2 {
  return [...ts].sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0]!;
}

export type { DoorInfo };
