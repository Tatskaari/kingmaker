import { buildWorld } from "../../../world/scene-world.ts";
import type { MapActor, Tile2 } from "../../types.ts";
import { actorsFromWorld, feetToTile } from "../reconcile.ts";
import { liftOf, rowsOf, sceneCamera } from "./camera.ts";
import type { CompiledPlace } from "./compile.ts";
import { isStructureTile, isWallish, type Placement } from "./furnish.ts";
import { DIR, add, tkey } from "./layout.ts";
import type { Problem } from "./normalize.ts";
import { dir, sayBack } from "./orient.ts";
import { SIDES, type Side, type ThingPlan } from "./plan.ts";

/**
 * Checking a compiled place the way the game will use it: its world is built and drawn onto the
 * map by the game's own code (buildWorld, actorsFromWorld), and looked at through the game's own
 * renderer (render.ts, as it is). A place passes when nothing is an error:
 *
 *   reach     every room (and every place something is) can be walked to from the street
 *   access    everything has a square beside it that can be walked to
 *   overlap   one thing to a square; nothing in a wall or a doorway; nothing hung over another's square
 *   door      every door is in a straight wall between two floors, joining what the plan said
 *   relation  the plan's relations hold (against its wall, in its corner, near what it's near...)
 *   hidden    nothing that matters is out of sight: in each room's own view (the scene view with
 *             the player in that room) and in the scene's opening view, every thing and person
 *             changes the picture when it's taken away (camera.ts: the renderer is the judge)
 *   world     the world's feet land on the squares the things were put on
 *
 * Messages are written for the model to act on, in its own compass.
 */

const near8 = (p: Tile2) => [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]].map(([dx, dy]) => ({ x: p.x + dx!, y: p.y + dy! }));
const cheb = (a: Tile2, b: Tile2) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const centreOf = (ts: Tile2[]) => ({ x: ts.reduce((n, p) => n + p.x, 0) / ts.length, y: ts.reduce((n, p) => n + p.y, 0) / ts.length });

export function validate(place: CompiledPlace): Problem[] {
  const { map, site, furnished, laid } = place;
  const out: Problem[] = [];
  const problem = (check: Problem["check"], subject: string, message: string, severity: Problem["severity"] = "error") => out.push({ check, subject, message, severity });
  const inBounds = (p: Tile2) => p.x >= 0 && p.y >= 0 && p.x < map.width && p.y < map.height;
  const tileAt = (p: Tile2) => (inBounds(p) ? map.tiles[p.y]![p.x]! : undefined);
  const areaAt = (p: Tile2) => (inBounds(p) ? site.area[p.y * map.width + p.x] : undefined);
  const nameOf = (id: string) => laid.things.find(t => t.id === id)?.name ?? laid.people.find(p => p.id === id)?.name ?? site.areas.get(id)?.name ?? site.doors.find(d => d.id === id)?.plan.name ?? id;

  // The world, built and drawn as the game does it.
  const world = buildWorld(place.region.sceneId ?? place.id, place.world, place.cast, { name: "you" });
  const actors = actorsFromWorld(place.region, world, { map });
  const placement = (a: MapActor): Placement | undefined => {
    const id = (a.ref ?? a.id).split("#")[0]!;
    return furnished.things.get(id) ?? furnished.people.get(id);
  };
  const isDoorThing = (a: MapActor) => site.doors.some(d => d.id === a.ref);
  const aloft = (a: MapActor) => !!placement(a)?.aloft || (a.states ?? []).some(s => s === "hanging" || s === "overhead") || liftOf(a) >= 3;

  // world: the feet in the world come back to the squares things were put on.
  for (const spec of place.world.things) {
    if (!spec.at) continue;
    const p = furnished.things.get(spec.id);
    const at = feetToTile(place.region, { x: spec.at[0], y: spec.at[1] });
    const want = p?.anchor ?? site.doors.find(d => d.id === spec.id)?.at;
    if (want && (at.x !== want.x || at.y !== want.y)) problem("world", spec.id, `${spec.name} is at (${at.x}, ${at.y}) in the world but on (${want.x}, ${want.y}) on the map.`);
  }

  // reach: from the street (where the player arrives), through doors, round furniture.
  const blocking = new Set<string>();
  for (const a of actors) if (a.blocks && a.kind !== "person" && a.kind !== "player" && a.kind !== "creature") blocking.add(tkey(a.at));
  const passable = (p: Tile2) => {
    const t = tileAt(p);
    if (!t || t.terrain === "void" || t.terrain === "wall" || t.terrain === "window" || t.terrain === "fence" || t.terrain === "deep-water") return false;
    if (t.blocks && t.terrain !== "door") return false;
    return !blocking.has(tkey(p));
  };
  const origin = site.entrance?.outside ?? furnished.start;
  const reached = new Set<string>();
  if (passable(origin)) {
    const queue = [origin];
    reached.add(tkey(origin));
    while (queue.length) {
      const p = queue.pop()!;
      for (const s of SIDES) {
        const n = add(p, DIR[s]);
        if (!reached.has(tkey(n)) && passable(n)) { reached.add(tkey(n)); queue.push(n); }
      }
    }
  }
  if (!site.entrance) problem("reach", place.id, "Nothing opens onto the outside: give the main room a door onto the street.");
  for (const a of site.areas.values()) {
    const open = a.tiles.filter(p => passable(p));
    const got = open.filter(p => reached.has(tkey(p)));
    const matters = a.room || laid.things.some(t => t.in === a.id && !furnished.things.get(t.id)?.terrain) || laid.people.some(p => p.in === a.id);
    if (!matters || !open.length) continue;
    if (!got.length) problem("reach", a.id, `${a.name} can't be reached from ${site.entrance ? nameOf(site.entrance.to) : "outside"}: ${a.room ? "give it a door to a room that can be reached" : "nothing leads to it"}.`);
    else if (got.length < open.length) problem("reach", a.id, `${open.length - got.length} square${open.length - got.length > 1 ? "s" : ""} of ${a.name} are shut off by furniture.`, "warning");
  }

  // access and overlap, on what the game draws.
  const byTile = new Map<string, MapActor[]>();
  for (const a of actors) {
    if (isDoorThing(a)) continue;
    const k = tkey(a.at);
    byTile.set(k, [...(byTile.get(k) ?? []), a]);
  }
  const aprons = new Map<string, string>();
  for (const d of site.doors) { aprons.set(tkey(d.inside), d.id); aprons.set(tkey(d.outside), d.id); }
  for (const [k, here] of byTile) {
    const ground = here.filter(a => !aloft(a));
    const high = here.filter(aloft);
    const first = here[0]!;
    if (ground.length > 1) {
      const names = [...new Set(ground.map(a => placement(a)?.name ?? a.name))];
      if (names.length > 1) problem("overlap", (ground[0]!.ref ?? ground[0]!.id).split("#")[0]!, `${names.join(" and ")} are on the same square.`);
    }
    if (high.length > 1) problem("overlap", (high[0]!.ref ?? high[0]!.id).split("#")[0]!, `${high.map(a => a.name).join(" and ")} hang from the same spot.`);
    const t = tileAt(first.at);
    if (t && (isStructureTile(t) || t.terrain === "void" || t.terrain === "deep-water") && ground.length) problem("overlap", (ground[0]!.ref ?? ground[0]!.id).split("#")[0]!, `${ground[0]!.name} is in a wall or the water.`);
    const door = aprons.get(k);
    const things = ground.filter(a => a.kind === "object" || a.kind === "item");
    if (door && things.length) problem("overlap", (things[0]!.ref ?? things[0]!.id).split("#")[0]!, `${things[0]!.name} is in the way of ${nameOf(door)}: keep the squares either side of a door clear.`);
  }
  // One to a cell on screen: something hung up is drawn on the cell of a square behind it (render.ts
  // draws column x + y, row y - x - lift), so a lantern can hide whoever stands there.
  // What else it paints counts too: a hanging lantern's rope, a stack's top, a fire's flame.
  const owners = new Map<string, MapActor[]>(), painters = new Map<string, MapActor[]>();
  for (const a of actors) {
    if (isDoorThing(a) || (a.states ?? []).includes("overhead")) continue;
    const rows = rowsOf(a);
    rows.forEach((r, i) => {
      const k = `${a.at.x + a.at.y},${a.at.y - a.at.x - r}`;
      if (i === 0) owners.set(k, [...(owners.get(k) ?? []), a]);
      painters.set(k, [...(painters.get(k) ?? []), a]);
    });
  }
  const reported = new Set<string>();
  for (const [k, here] of owners) {
    for (const behind of here) {
      // Painted later (nearer the viewer) by something on another square: it's covered.
      const front = (painters.get(k) ?? []).find(a => tkey(a.at) !== tkey(behind.at) && a.at.y - a.at.x >= behind.at.y - behind.at.x && (a.ref ?? a.id).split("#")[0] !== (behind.ref ?? behind.id).split("#")[0]);
      if (!front) continue;
      const id = (front.ref ?? front.id).split("#")[0]!;
      if (reported.has(`${id}|${behind.name}`)) continue;
      reported.add(`${id}|${behind.name}`);
      problem("overlap", id, `${front.name} is drawn over ${behind.name} and hides it: move one of them.`);
    }
  }
  const standable = (p: Tile2) => reached.has(tkey(p)) && !blocking.has(tkey(p));
  for (const p of [...furnished.things.values(), ...furnished.people.values()]) {
    if (!p.tiles.length || p.aloft || p.terrain) continue;
    const own = new Set(p.tiles.map(tkey));
    const ok = p.tiles.some(q => near8(q).some(n => !own.has(tkey(n)) && standable(n)) || (!p.blocks && !p.run && standable(q)));
    if (!ok) problem("access", p.id, `${p.name} can't be got at: no square beside it can be walked to.`);
  }

  // doors: in a straight wall, between two floors, joining what the plan said.
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    const t = map.tiles[y]![x]!;
    if (t.terrain !== "door") continue;
    const at = { x, y };
    const d = site.doors.find(o => o.at.x === x && o.at.y === y);
    const floor = (p: Tile2) => { const n = tileAt(p); return !!n && !isStructureTile(n) && n.terrain !== "void" && n.terrain !== "deep-water"; };
    const wall = (p: Tile2) => { const n = tileAt(p); return !!n && isStructureTile(n); };
    const ns = floor(add(at, DIR.north)) && floor(add(at, DIR.south)) && wall(add(at, DIR.east)) && wall(add(at, DIR.west));
    const ew = floor(add(at, DIR.east)) && floor(add(at, DIR.west)) && wall(add(at, DIR.north)) && wall(add(at, DIR.south));
    if (!ns && !ew) problem("door", d?.id ?? `${x},${y}`, `${d?.plan.name ?? "A door"} isn't in a straight wall between two floors.`);
    if (d) {
      const joins = [areaAt(d.inside), areaAt(d.outside)];
      const to = site.areas.get(d.to);
      const toOk = joins.includes(d.to) || (to && !to.room && joins.some(j => j && site.areas.get(j)?.side === to.side));
      if (!joins.includes(d.from) || !toOk) problem("door", d.id, `${d.plan.name} doesn't join ${nameOf(d.from)} and ${nameOf(d.to)}.`);
    }
  }

  // relations: as the plan asked, within reason.
  const wallish = (p: Tile2, area?: string) => isWallish(tileAt(p), !!(area && site.areas.get(area)?.boat));
  const tilesOf = (id: string, area: string): Tile2[] | undefined => {
    const p = furnished.things.get(id) ?? furnished.people.get(id);
    if (p) return p.tiles.length ? p.tiles : p.heldBy ? tilesOf(p.heldBy, area) : undefined;
    const d = site.doors.find(o => o.id === id);
    if (d) return [d.at];
    return undefined;
  };
  for (const t of laid.things) {
    const p = furnished.things.get(t.id);
    if (!p || p.terrain) continue;
    const said = sayRelation(t, nameOf);
    const wrong = (message: string, severity: Problem["severity"] = "error") => problem("relation", t.id, `${t.name} should be ${said}, but ${message}.`, severity);
    switch (t.relation) {
      case "on": case "in": case "under":
        if (p.heldBy !== t.target) wrong("it ended up on the floor");
        break;
      case "against": {
        // A wall on the side asked for, if the area has one there at all; else any wall will do.
        const area = site.areas.get(p.area);
        const sides = t.wall !== "none" && area?.tiles.some(q => wallish(add(q, DIR[t.wall as Side]), p.area)) ? [t.wall] : [...SIDES];
        const flush = (s: Side) => p.tiles.some(q => wallish(add(q, DIR[s]), p.area) || (p.run && wallish(add(q, DIR[s], 2), p.area)));
        if (!sides.some(flush)) {
          if (SIDES.some(flush)) wrong(`it's against another wall`, "warning");
          else wrong(`there was no room for it against ${t.wall !== "none" ? "that" : "a"} wall: make the room bigger or the wall less crowded`);
        }
        break;
      }
      case "corner": {
        const [s1, s2] = (t.corner !== "none" ? t.corner.split("-") : ["north", "east"]) as [Side, Side];
        const inCorner = p.tiles.some(q => near8(q).concat([q]).some(r => areaAt(r) === p.area && wallish(add(r, DIR[s1]), p.area) && wallish(add(r, DIR[s2]), p.area)));
        if (!inCorner) {
          if (p.tiles.some(q => wallish(add(q, DIR[s1]), p.area) || wallish(add(q, DIR[s2]), p.area))) wrong("it's along the wall, not in the corner", "warning");
          else wrong("its corner was taken: put it somewhere else, or something else elsewhere");
        }
        break;
      }
      case "near": case "beside": case "by-door": case "behind": {
        const target = tilesOf(t.target, p.area);
        if (!target) break;
        const d = Math.min(...p.tiles.flatMap(q => target.map(r => cheb(q, r))));
        // Within reach, or as near as its own area comes (sacks on the barge, by the river door: the barge is out in the river).
        const nearest = Math.min(...(site.areas.get(p.area)?.tiles ?? p.tiles).flatMap(q => target.map(r => cheb(q, r))));
        const limit = Math.max(t.relation === "beside" ? 1 : 2, nearest);
        if (d > limit + 1) wrong(`it's ${d} squares from ${nameOf(t.target)}: there wasn't room by it`);
        else if (d > limit) wrong(`it's ${d} squares from ${nameOf(t.target)}`, "warning");
        if (t.relation === "behind" && d <= limit + 1) {
          const way = site.doors.find(o => o === site.entrance && areaAt(o.inside) === p.area) ?? site.doors.find(o => areaAt(o.inside) === p.area || areaAt(o.outside) === p.area);
          if (way) {
            const from = areaAt(way.inside) === p.area ? way.inside : way.outside;
            const tc = centreOf(target), c = centreOf(p.tiles);
            const v = { x: tc.x - from.x, y: tc.y - from.y }, u = { x: c.x - tc.x, y: c.y - tc.y };
            const cos = (u.x * v.x + u.y * v.y) / ((Math.hypot(u.x, u.y) || 1) * (Math.hypot(v.x, v.y) || 1));
            if (cos < -0.5) wrong(`it's in front of ${nameOf(t.target)} (between it and the door), not behind it`);
          }
        }
        break;
      }
      case "between": {
        const a = tilesOf(t.target, p.area), b = tilesOf(t.target2, p.area);
        if (!a || !b) break;
        const pa = centreOf(a), pb = centreOf(b), c = centreOf(p.tiles);
        const ab = { x: pb.x - pa.x, y: pb.y - pa.y }, l2 = ab.x * ab.x + ab.y * ab.y || 1;
        const u = ((c.x - pa.x) * ab.x + (c.y - pa.y) * ab.y) / l2;
        const cu = Math.max(0, Math.min(1, u));
        const off = Math.hypot(c.x - (pa.x + ab.x * cu), c.y - (pa.y + ab.y * cu));
        if (u < -0.25 || u > 1.25 || off > 2.5) wrong(`it isn't between them: there wasn't room between ${nameOf(t.target)} and ${nameOf(t.target2)}`);
        break;
      }
      case "centre": {
        const a = site.areas.get(p.area)!;
        const m = centreOf(a.tiles), c = centreOf(p.tiles);
        if (Math.hypot(c.x - m.x, c.y - m.y) > Math.max(2.5, Math.min(a.bbox.w, a.bbox.h) * 0.5)) wrong("the middle was taken", "warning");
        break;
      }
    }
  }
  for (const r of laid.rooms) {
    const a = site.areas.get(r.id);
    if (!a || r.where === "main") continue;
    const b = site.building;
    const touches = (s: Side) => a.tiles.some(q => { const n = add(q, DIR[s]); return (s === "north" && n.y === b.y) || (s === "south" && n.y === b.y + b.h - 1) || (s === "west" && n.x === b.x) || (s === "east" && n.x === b.x + b.w - 1); });
    const want = r.where.split("-") as Side[];
    if (!want.every(touches)) problem("relation", r.id, `${r.name} should be on the ${dir(r.where)} side of the building, but isn't.`);
  }

  // hidden: drawn where it stands, in its room's own view and in the scene's opening view.
  const cam = sceneCamera(map, actors);
  const top = (a: MapActor) => {
    const here = (byTile.get(tkey(a.at)) ?? []).filter(b => aloft(b) === aloft(a));
    const rank = (b: MapActor) => (b.kind === "player" ? 3 : b.kind === "person" || b.kind === "creature" ? 2 : b.kind === "object" ? 0 : 1);
    return [...here].sort((x, y) => rank(x) - rank(y)).at(-1) === a;
  };
  const focusOf = (areaId: string) => {
    const a = site.areas.get(areaId)!;
    const m = centreOf(a.tiles);
    return [...a.tiles].filter(p => reached.has(tkey(p))).sort((p, q) => Math.hypot(p.x - m.x, p.y - m.y) - Math.hypot(q.x - m.x, q.y - m.y))[0] ?? a.tiles[0]!;
  };
  // Who's looked for in which view: each in its own area's, people also in the opening view; one
  // batch of renders per view.
  const looked = actors.filter(a => !isDoorThing(a) && !a.id.includes("#") && !(a.states ?? []).includes("overhead") && top(a));
  const areaOfActor = (a: MapActor) => placement(a)?.area ?? areaAt(a.at);
  const byFocus = new Map<string, { focus: Tile2; who: MapActor[] }>();
  const want = (focus: Tile2, a: MapActor) => { const k = tkey(focus); if (!byFocus.has(k)) byFocus.set(k, { focus, who: [] }); byFocus.get(k)!.who.push(a); };
  for (const a of looked) {
    const area = areaOfActor(a);
    if (area && site.areas.has(area)) want(focusOf(area), a);
    if (a.kind === "person" || a.kind === "creature" || a.kind === "player") want(furnished.start, a);
  }
  for (const { focus, who } of byFocus.values()) cam.check(focus, who);
  for (const a of looked) {
    const p = placement(a);
    const area = areaOfActor(a);
    const inItsRoom = area && site.areas.has(area) ? cam.seen(a, focusOf(area)) : true;
    const atStart = a.kind === "person" || a.kind === "creature" || a.kind === "player" ? cam.seen(a, furnished.start) : true;
    if (!inItsRoom || !atStart) {
      const id = (a.ref ?? a.id).split("#")[0]!;
      const by = blocker(a);
      problem("hidden", id, `${p?.name ?? a.name} can't be seen${!inItsRoom && area ? ` from inside ${nameOf(area)}` : " when the scene opens"}${by ? `: ${by} is in front of it` : ""}. Move it away from that wall.`);
    }
  }
  /** What stands in front of a square on screen (south-west of it). */
  function blocker(a: MapActor): string | undefined {
    const b = site.building;
    for (let d = 1; d <= 3; d++) {
      const q = { x: a.at.x - d, y: a.at.y + d };
      const t = tileAt(q);
      if (!t || !isStructureTile(t) || (t.height ?? 1) < 2 * d) continue;
      if (q.x === b.x) return `the building's ${dir("west")} wall`;
      if (q.y === b.y + b.h - 1) return `the building's ${dir("south")} wall`;
      if (q.y === b.y) return `the building's ${dir("north")} wall`;
      if (q.x === b.x + b.w - 1) return `the building's ${dir("east")} wall`;
      return t.terrain === "fence" ? "a low wall" : "a wall";
    }
    return undefined;
  }

  // The compiler's own findings, then these; said back in the plan's compass, once each.
  const all = [...place.problems, ...out.map(p => ({ ...p, message: sayBack(place.turn, p.message) }))];
  const unique = new Map<string, Problem>();
  for (const p of all) { const k = `${p.check}|${p.subject}|${p.message}`; if (!unique.has(k)) unique.set(k, p); }
  return [...unique.values()];
}

export { sceneCamera } from "./camera.ts";

/** A thing's relation in words, by names. */
export function sayRelation(t: ThingPlan, nameOf: (id: string) => string): string {
  switch (t.relation) {
    case "against": return t.wall !== "none" ? `against the ${dir(t.wall)} wall` : "against a wall";
    case "corner": return t.corner !== "none" ? `in the ${dir(t.corner)} corner` : "in a corner";
    case "between": return `between ${nameOf(t.target)} and ${nameOf(t.target2)}`;
    case "centre": return "in the middle of the room";
    case "overhead": return "overhead";
    case "by-door": return `by ${nameOf(t.target)}`;
    default: return `${t.relation} ${nameOf(t.target)}`;
  }
}

export const errorsOf = (problems: Problem[]) => problems.filter(p => p.severity === "error");
