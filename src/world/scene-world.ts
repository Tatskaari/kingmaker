import { rng } from "../runtime/dice.ts";

/**
 * The scene's world: an entity tree (the place, its areas, the things and people in them, what
 * people carry) with positions in feet, D&D object stats (AC and hit points by material and size),
 * states (burning, broken, wet, hidden...) and notes. It's the one record of where everything is and
 * what state it's in: the rules write to it deterministically (a Fireball burns what's in its
 * radius), the stage manager writes what the story established after each reply (through the
 * operations below), and the GM reads it, a part at a time, before replying. Later the map view
 * draws from it.
 */

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export type Size = "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";
export type Material = "cloth" | "paper" | "rope" | "glass" | "ice" | "crystal" | "wood" | "bone" | "leather" | "stone" | "iron" | "steel" | "brass" | "silver" | "flesh" | "liquid";
export type EntityKind = "place" | "area" | "feature" | "object" | "item" | "person" | "creature";

export interface Note { text: string; turn: number; by: "author" | "rules" | "stage" }

export interface Entity {
  id: string;
  name: string;
  kind: EntityKind;
  /** The tree: the area a thing is in, or the person or container holding it. */
  parent: string | null;
  /** Feet in the place's frame (x east, y south). Carried and contained things are where their holder is. */
  at?: Point;
  /** Areas (and the place): their extent. */
  rect?: Rect;
  size?: Size;
  material?: Material;
  ac?: number;
  hp?: { current: number; max: number };
  /** What kind of thing it is, for rules and selectors: flammable, furniture, container, door, light, fixed, liquid... */
  tags: string[];
  /** Its state right now: burning, damaged, destroyed, wet, slick, poisoned, locked, open, overturned, hidden, lit, prone, unconscious... */
  states: string[];
  notes: Note[];
  description?: string;
  /** A person or creature from the scene's cast. */
  cast?: string;
  player?: boolean;
  /** Turn it came into the story, when play created it. */
  created?: number;
}

export interface WorldEvent { turn: number; text: string; by: "rules" | "stage" }

export interface SceneWorld {
  scene: string;
  root: string;
  entities: Record<string, Entity>;
  log: WorldEvent[];
}

// ---------------------------------------------------------------------------------------------
// Authoring: a scene's world, written once (scenes/worlds/*.ts).

export interface ThingSpec {
  id: string;
  name: string;
  /** A person here is a crowd or a bystander outside the cast ("the regulars"). */
  kind?: "feature" | "object" | "item" | "creature" | "person";
  /** An area id, or the id of whoever or whatever holds it (a person, a container). */
  in: string;
  at?: [number, number];
  size?: Size;
  material?: Material;
  tags?: string[];
  states?: string[];
  description?: string;
  ac?: number;
  hp?: number;
}

export interface WorldSpec {
  name: string;
  description: string;
  size: { w: number; h: number };
  areas: Array<{ id: string; name: string; rect: Rect; description?: string; tags?: string[]; states?: string[] }>;
  things: ThingSpec[];
  /** Where people start: cast ids (and "player"), with an area and optionally a spot. */
  people: Record<string, { in: string; at?: [number, number]; note?: string }>;
}

/** D&D object armour class by material (DMG "Statistics for Objects"). */
const MATERIAL_AC: Record<Material, number> = {
  cloth: 11, paper: 11, rope: 11, liquid: 10, glass: 13, ice: 13, crystal: 13, wood: 15, bone: 15, leather: 12,
  stone: 17, iron: 19, steel: 19, brass: 17, silver: 17, flesh: 10,
};
/** Hit points by size, fragile and resilient (DMG), with homebrew huge and gargantuan. */
const SIZE_HP: Record<Size, [number, number]> = { tiny: [2, 5], small: [3, 10], medium: [4, 18], large: [5, 27], huge: [10, 50], gargantuan: [20, 100] };
const FRAGILE = new Set<Material>(["cloth", "paper", "rope", "glass", "ice", "crystal", "liquid"]);
const BURNS = new Set<Material>(["cloth", "paper", "rope", "wood", "leather"]);

export function objectStats(material: Material = "wood", size: Size = "medium"): { ac: number; hp: number } {
  return { ac: MATERIAL_AC[material] ?? 15, hp: SIZE_HP[size][FRAGILE.has(material) ? 0 : 1] };
}

/** Build a scene's world from its spec, with the people present placed where the spec says. */
export function buildWorld(sceneId: string, spec: WorldSpec, people: Array<{ id: string; name: string; description?: string }>, player: { name: string }): SceneWorld {
  const root = `${sceneId}:place`;
  const entities: Record<string, Entity> = {
    [root]: { id: root, name: spec.name, kind: "place", parent: null, rect: { x: 0, y: 0, w: spec.size.w, h: spec.size.h }, tags: [], states: [], notes: [], description: spec.description },
  };
  for (const a of spec.areas) entities[a.id] = { id: a.id, name: a.name, kind: "area", parent: root, rect: a.rect, tags: a.tags ?? [], states: a.states ?? [], notes: [], ...(a.description ? { description: a.description } : {}) };
  const world: SceneWorld = { scene: sceneId, root, entities, log: [] };
  const place = (id: string, where: { in: string; at?: [number, number] }) => {
    const holder = entities[where.in];
    const e = entities[id]!;
    e.parent = holder ? holder.id : root;
    if (where.at) e.at = { x: where.at[0], y: where.at[1] };
    else if (holder?.kind === "area" || holder?.kind === "place") e.at = spread(world, holder, id);
  };
  // People first, so things can be held by them.
  const known = new Map(people.map(p => [p.id, p]));
  for (const [id, where] of Object.entries(spec.people)) {
    if (id === "player") {
      entities.player = { id: "player", name: player.name, kind: "person", parent: root, tags: [], states: [], notes: [], player: true };
      place("player", where);
      continue;
    }
    const p = known.get(id);
    if (!p) continue; // not in this scene tonight
    entities[id] = { id, name: p.name, kind: "person", parent: root, tags: [], states: [], notes: where.note ? [{ text: where.note, turn: 0, by: "author" }] : [], cast: id, ...(p.description ? { description: p.description } : {}) };
    place(id, where);
  }
  // Present people the spec didn't place stand in the first area.
  for (const p of people) if (!entities[p.id]) {
    entities[p.id] = { id: p.id, name: p.name, kind: "person", parent: root, tags: [], states: [], notes: [], cast: p.id };
    place(p.id, { in: spec.areas[0]?.id ?? root });
  }
  for (const t of spec.things) {
    const kind = t.kind ?? (t.size === "tiny" || t.size === "small" ? "item" : "object");
    if (kind === "person" || kind === "creature") {
      entities[t.id] = { id: t.id, name: t.name, kind, parent: null, tags: t.tags ?? [], states: t.states ?? [], notes: [], ...(t.description ? { description: t.description } : {}) };
      continue;
    }
    const material = t.material ?? "wood";
    const size = t.size ?? (kind === "item" ? "tiny" : "medium");
    const stats = objectStats(material, size);
    const tags = [...new Set([...(t.tags ?? []), ...(BURNS.has(material) ? ["flammable"] : [])])];
    entities[t.id] = {
      id: t.id, name: t.name, kind, parent: null, size, material, tags, states: t.states ?? [], notes: [],
      ac: t.ac ?? stats.ac, hp: { current: t.hp ?? stats.hp, max: t.hp ?? stats.hp },
      ...(t.description ? { description: t.description } : {}),
    };
  }
  // Things may sit in or on other things: place them once everything exists.
  for (const t of spec.things) place(t.id, { in: t.in, ...(t.at ? { at: t.at } : {}) });
  return world;
}

/** A spot in an area for something the spec didn't place: spread around its middle, deterministically. */
function spread(world: SceneWorld, area: Entity, id: string): Point {
  const r = area.rect ?? { x: 0, y: 0, w: 10, h: 10 };
  const random = rng([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7));
  for (let i = 0; i < 20; i++) {
    const p = { x: Math.round(r.x + r.w * (0.2 + 0.6 * random())), y: Math.round(r.y + r.h * (0.2 + 0.6 * random())) };
    if (!Object.values(world.entities).some(e => e.at && e.parent === area.id && Math.hypot(e.at.x - p.x, e.at.y - p.y) < 3)) return p;
  }
  return { x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) };
}

// ---------------------------------------------------------------------------------------------
// Space.

export function positionOf(world: SceneWorld, id: string): Point | undefined {
  for (let e = world.entities[id], guard = 0; e && guard < 12; e = e.parent ? world.entities[e.parent] : undefined, guard++) {
    if (e.at) return e.at;
    if (e.rect) return { x: e.rect.x + e.rect.w / 2, y: e.rect.y + e.rect.h / 2 };
  }
  return undefined;
}

/** The area something is in (following holders up the tree). */
export function areaOf(world: SceneWorld, id: string): Entity | undefined {
  for (let e = world.entities[id], guard = 0; e && guard < 12; e = e.parent ? world.entities[e.parent] : undefined, guard++) {
    if (e.kind === "area" || e.kind === "place") return e;
  }
  return undefined;
}

/** The smallest area containing a point. */
export function areaAt(world: SceneWorld, p: Point): Entity {
  const inside = Object.values(world.entities).filter(e => e.kind === "area" && e.rect && p.x >= e.rect.x && p.x <= e.rect.x + e.rect.w && p.y >= e.rect.y && p.y <= e.rect.y + e.rect.h);
  return inside.sort((a, b) => a.rect!.w * a.rect!.h - b.rect!.w * b.rect!.h)[0] ?? world.entities[world.root]!;
}

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function feetBetween(world: SceneWorld, a: string, b: string): number | undefined {
  const pa = positionOf(world, a), pb = positionOf(world, b);
  return pa && pb ? Math.round(distance(pa, pb)) : undefined;
}

const present = (e: Entity) => !e.states.includes("gone");
const isThing = (e: Entity) => e.kind === "object" || e.kind === "item" || e.kind === "feature";
const isBeing = (e: Entity) => e.kind === "person" || e.kind === "creature";

/** Everything within `feet` of a point or an entity (not the place or its areas). */
export function within(world: SceneWorld, of: Point | string, feet: number, filter: (e: Entity) => boolean = () => true): Entity[] {
  const centre = typeof of === "string" ? positionOf(world, of) : of;
  if (!centre) return [];
  return Object.values(world.entities).filter(e => e.kind !== "place" && e.kind !== "area" && present(e) && filter(e))
    .map(e => ({ e, d: distance(positionOf(world, e.id)!, centre) })).filter(x => x.d <= feet).sort((a, b) => a.d - b.d).map(x => x.e);
}

export function nearest(world: SceneWorld, to: string, filter: (e: Entity) => boolean): Entity | undefined {
  const p = positionOf(world, to);
  if (!p) return undefined;
  return Object.values(world.entities).filter(e => e.id !== to && e.kind !== "place" && e.kind !== "area" && present(e) && filter(e))
    .sort((a, b) => distance(positionOf(world, a.id)!, p) - distance(positionOf(world, b.id)!, p))[0];
}

/** A free spot about `feet` from a target, inside its area, not on top of anything else. */
export function spotNear(world: SceneWorld, target: string, feet = 5, away?: Point): Point {
  const centre = positionOf(world, target) ?? { x: 0, y: 0 };
  const area = areaOf(world, target);
  const r = area?.rect;
  const angles = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);
  // "Behind" something: on the far side from whatever it's between them and.
  if (away) angles.sort((a, b) => sideScore(centre, away, b) - sideScore(centre, away, a));
  for (const ring of [feet, feet + 5, feet + 10]) for (const a of angles) {
    const p = { x: Math.round(centre.x + ring * Math.cos(a)), y: Math.round(centre.y + ring * Math.sin(a)) };
    if (r && (p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h)) continue;
    if (Object.values(world.entities).some(e => e.at && e.id !== target && present(e) && distance(e.at, p) < 2.5)) continue;
    return p;
  }
  return { x: centre.x + feet, y: centre.y };
}
const sideScore = (centre: Point, away: Point, angle: number) => (Math.cos(angle) * (centre.x - away.x) + Math.sin(angle) * (centre.y - away.y));

/**
 * Who and what a spell's area catches: a sphere or cube around a point, a cone or line from the
 * caster towards it. (No walls or cover yet: the map will add those.)
 */
export function caughtIn(world: SceneWorld, shape: string, size: number, origin: Point, aim: Point): Entity[] {
  const all = Object.values(world.entities).filter(e => e.kind !== "place" && e.kind !== "area" && present(e) && !heldBy(world, e));
  const dir = { x: aim.x - origin.x, y: aim.y - origin.y };
  const len = Math.hypot(dir.x, dir.y) || 1;
  const unit = { x: dir.x / len, y: dir.y / len };
  return all.filter(e => {
    const p = positionOf(world, e.id)!;
    const v = { x: p.x - origin.x, y: p.y - origin.y };
    const along = v.x * unit.x + v.y * unit.y;
    const across = Math.abs(v.x * unit.y - v.y * unit.x);
    switch (shape) {
      case "sphere": case "cylinder": return distance(p, aim) <= size;
      case "cube": return Math.abs(p.x - aim.x) <= size / 2 && Math.abs(p.y - aim.y) <= size / 2;
      case "cone": return along > 0 && along <= size && across <= along / 2;
      case "line": return along > 0 && along <= size && across <= 2.5;
      default: return distance(p, aim) <= size;
    }
  });
}

/** The person or container holding a thing, if it's carried or inside something. */
export function heldBy(world: SceneWorld, e: Entity): Entity | undefined {
  const parent = e.parent ? world.entities[e.parent] : undefined;
  return parent && parent.kind !== "area" && parent.kind !== "place" ? parent : undefined;
}

// ---------------------------------------------------------------------------------------------
// Selectors and operations: the language the stage manager (and later, scripts) write in.

/**
 * A selector names one entity ("hobb", "the gin jar", "player") or a group:
 * "all <filters>", with filters kind:object, tag:flammable, state:burning, in:bar, held:player,
 * name:jar, within:10:fireside-table. ("all tag:flammable within:20:hearth" is everything that burns
 * within twenty feet of the hearth.)
 */
export function select(world: SceneWorld, selector: string): Entity[] {
  const s = selector.trim();
  if (!s) return [];
  const all = Object.values(world.entities).filter(present);
  if (!/^all\b/i.test(s)) {
    const key = s.toLowerCase().replace(/^the /, "");
    const exact = world.entities[s] ?? all.find(e => e.id.toLowerCase() === key) ?? all.find(e => e.name.toLowerCase().replace(/^the /, "") === key);
    if (exact) return [exact];
    const loose = all.filter(e => e.kind !== "place" && e.name.toLowerCase().includes(key));
    if (loose.length) return [loose.sort((a, b) => a.name.length - b.name.length)[0]!];
    const best = byWords(all.filter(e => e.kind !== "place"), s);
    return best ? [best] : [];
  }
  let picked = all.filter(e => e.kind !== "place" && e.kind !== "area");
  for (const term of s.replace(/^all\s*/i, "").split(/\s+/).filter(Boolean)) {
    const [k, ...rest] = term.split(":");
    const v = rest.join(":").toLowerCase();
    if (k === "kind") picked = picked.filter(e => e.kind === v);
    else if (k === "tag") picked = picked.filter(e => e.tags.includes(v));
    else if (k === "state") picked = picked.filter(e => e.states.includes(v));
    else if (k === "in") picked = picked.filter(e => areaOf(world, e.id)?.id === v || e.parent === v);
    else if (k === "held") picked = picked.filter(e => e.parent === v);
    else if (k === "name") picked = picked.filter(e => e.name.toLowerCase().includes(v));
    else if (k === "within") {
      const [feet, ...of] = rest;
      const target = select(world, of.join(":"))[0];
      const ids = new Set(target ? within(world, target.id, Number(feet)).map(e => e.id) : []);
      picked = picked.filter(e => ids.has(e.id));
    }
  }
  return picked;
}

const STOP_WORDS = new Set(["the", "a", "an", "of", "and", "with", "his", "her", "their", "its", "s", "by", "to", "in", "on", "at"]);
const wordsOf = (t: string) => t.toLowerCase().replace(/[’']s\b/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(w => w && !STOP_WORDS.has(w));

/**
 * A model's way of naming things: no article or possessive, words in any order ("granary yard
 * doors" is "the granary's yard doors"). Only a clear winner counts: a guess would put things in
 * the wrong place, and a selector that matches nothing is reported back as a problem.
 */
function byWords(candidates: Entity[], text: string): Entity | undefined {
  const want = wordsOf(text);
  if (!want.length) return undefined;
  const scored = candidates.map(e => {
    const have = new Set([...wordsOf(e.name), ...wordsOf(e.id.replace(/-/g, " "))]);
    const hits = want.filter(w => have.has(w) || [...have].some(h => h.length > 3 && w.length > 3 && (h.startsWith(w) || w.startsWith(h)))).length;
    return { e, score: hits / want.length, size: have.size };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.size - b.size);
  const [best, next] = scored;
  return best && best.score >= 0.6 && !(next && next.score === best.score && next.size === best.size) ? best.e : undefined;
}

const PLACE_WORDS: Record<string, string> = { near: "near", by: "near", at: "near", beside: "beside", next: "beside", behind: "behind", under: "under", beneath: "under", on: "on", onto: "on", in: "in", into: "in", inside: "in", between: "near" };
/** "beside moll", "behind the bar", "between cob and the gate": a where written into "to" instead of "how". */
function placeIn(world: SceneWorld, to: string, how: string): { to: string; how: string } {
  if (select(world, to).length) return { to, how };
  const m = /^(near|by|at|beside|next to|behind|under|beneath|on|onto|in|into|inside|between)\s+(.+)$/i.exec(to.trim());
  if (!m) return { to, how };
  const target = m[1]!.toLowerCase() === "between" ? m[2]!.split(/\s+and\s+/i)[0]! : m[2]!;
  return { to: target, how: how || PLACE_WORDS[m[1]!.toLowerCase().split(" ")[0]!]! };
}

export interface WorldOp {
  op: "move" | "place" | "give" | "drop" | "create" | "state" | "note" | "remove" | "destroy";
  /** What it acts on: a selector. */
  what: string;
  /** Where or to whom: a selector (an area, a person, a thing to be near). */
  to: string;
  /** For place: near, behind, beside, under, on, in. */
  how: string;
  /** For create: its name and kind. */
  name: string;
  kind: string;
  /** A note, a description, where someone went, what's left of something. */
  text: string;
  add: string[];
  remove: string[];
}

const slug = (name: string) => name.toLowerCase().replace(/^(a|an|the) /, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/** Apply operations; returns what changed, in plain words, and what couldn't be done. */
export function applyOps(world: SceneWorld, ops: WorldOp[], turn: number, by: WorldEvent["by"] = "stage"): { changes: string[]; problems: string[] } {
  const changes: string[] = [];
  const problems: string[] = [];
  const log = (text: string) => { changes.push(text); world.log.push({ turn, text, by }); };
  const one = (sel: string, what: string) => {
    const e = select(world, sel)[0];
    if (!e) problems.push(`${what}: nothing matches "${sel}"`);
    return e;
  };
  for (const op of ops) {
    try {
      if (op.op === "create") {
        const near = op.to ? one(op.to, "create near") : undefined;
        const base = slug(op.name) || "thing";
        let id = base;
        for (let i = 2; world.entities[id]; i++) id = `${base}-${i}`;
        const kind = (["person", "creature", "object", "item", "feature"].includes(op.kind) ? op.kind : "object") as EntityKind;
        const material: Material = kind === "person" || kind === "creature" ? "flesh" : "wood";
        const size: Size = kind === "item" ? "tiny" : "medium";
        const stats = objectStats(material, size);
        const e: Entity = { id, name: op.name, kind, parent: world.root, tags: [], states: [...(op.add ?? [])], notes: op.text ? [{ text: op.text, turn, by }] : [], created: turn,
          ...(isThing({ kind } as Entity) ? { ac: stats.ac, hp: { current: stats.hp, max: stats.hp }, size, material } : {}) };
        world.entities[id] = e;
        if (near && (op.how === "in" || (near.kind !== "area" && near.kind !== "place" && kind === "item" && isBeing(near)))) { e.parent = near.id; }
        else if (near?.kind === "area") { e.parent = near.id; e.at = spread(world, near, id); }
        else if (near) { e.at = spotNear(world, near.id, 5); e.parent = areaAt(world, e.at).id; }
        else { e.at = spread(world, world.entities[world.root]!, id); e.parent = areaAt(world, e.at).id; }
        log(`${op.name} ${kind === "person" || kind === "creature" ? "arrives" : "is here"}${near ? ` (by ${near.name})` : ""}`);
        continue;
      }
      const targets = select(world, op.what);
      if (!targets.length) { problems.push(`${op.op}: nothing matches "${op.what}"`); continue; }
      for (const e of targets) {
        if (op.op === "move" || op.op === "place") {
          const where = placeIn(world, op.to, op.how);
          const dest = one(where.to, op.op);
          if (!dest) continue;
          // Where they started, and where they were hiding, no longer holds once they move.
          e.notes = e.notes.filter(n => n.by !== "author" && !/^(behind|under|on|in|beside) /i.test(n.text));
          const how = where.how || "near";
          // Saying where someone already is isn't a move: "Kell is in the doorway" mustn't scatter her
          // to a random spot in it, nor "by the bar" shuffle someone already at the bar.
          if (!heldBy(world, e) && ((dest.kind === "area" || dest.kind === "place") ? areaOf(world, e.id)?.id === dest.id : how === "near" && (feetBetween(world, e.id, dest.id) ?? Infinity) <= 5)) continue;
          if (dest.kind === "area" || dest.kind === "place") { e.parent = dest.id; e.at = spread(world, dest, e.id); log(`${e.name} moves to ${dest.name}`); }
          else if (how === "in" || how === "on" || how === "under") {
            if (how === "in") { e.parent = dest.id; delete e.at; }
            else { e.at = { ...(positionOf(world, dest.id)!) }; e.parent = areaOf(world, dest.id)?.id ?? world.root; }
            log(`${e.name} is ${how} ${dest.name}`);
            if (how === "under") note(e, `under ${dest.name}`, turn, by);
          } else {
            const threat = how === "behind" ? positionOf(world, "player") : undefined;
            e.at = spotNear(world, dest.id, 5, how === "behind" && e.id !== "player" ? threat : undefined);
            e.parent = areaAt(world, e.at).id;
            log(`${e.name} is ${how} ${dest.name}`);
            if (how === "behind") { note(e, `behind ${dest.name}`, turn, by); note(dest, `${e.name} is behind it`, turn, by); }
          }
        } else if (op.op === "give") {
          const to = one(op.to, "give");
          if (!to) continue;
          e.parent = to.id; delete e.at;
          log(`${to.name} now has ${e.name}`);
        } else if (op.op === "drop") {
          const near = op.to ? one(op.to, "drop") : heldBy(world, e);
          const spot = near ? spotNear(world, near.id, 3) : positionOf(world, e.id)!;
          e.at = spot; e.parent = areaAt(world, spot).id;
          log(`${e.name} is on the floor${near ? ` by ${near.name}` : ""}`);
        } else if (op.op === "state") {
          const added = (op.add ?? []).filter(s => s && !e.states.includes(s));
          const removed = (op.remove ?? []).filter(s => e.states.includes(s));
          e.states = [...e.states.filter(s => !removed.includes(s)), ...added];
          if (added.length || removed.length) log(`${e.name}: ${[...added.map(s => `now ${s}`), ...removed.map(s => `no longer ${s}`)].join(", ")}`);
          if (op.text) note(e, op.text, turn, by);
        } else if (op.op === "note") {
          if (!op.text) continue;
          note(e, op.text, turn, by);
          const also = op.to ? one(op.to, "note") : undefined;
          if (also) note(also, op.text, turn, by);
          log(`note on ${e.name}${also ? ` and ${also.name}` : ""}: ${op.text}`);
        } else if (op.op === "remove") {
          e.states = [...e.states.filter(s => s !== "gone"), "gone"];
          if (op.text) note(e, op.text, turn, by);
          log(`${e.name} leaves${op.text ? ` (${op.text})` : ""}`);
        } else if (op.op === "destroy") {
          destroy(world, e, turn, by, op.text);
          changes.push(`${e.name} is destroyed`);
        }
      }
    } catch (error) {
      problems.push(`${op.op}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { changes, problems };
}

function descendants(world: SceneWorld, id: string): Entity[] {
  const kids = Object.values(world.entities).filter(e => e.parent === id);
  return kids.flatMap(k => [k, ...descendants(world, k.id)]);
}

function note(e: Entity, text: string, turn: number, by: Note["by"]): void {
  if (e.notes.some(n => n.text === text)) return;
  e.notes = [...e.notes, { text, turn, by }].slice(-6);
}

function destroy(world: SceneWorld, e: Entity, turn: number, by: WorldEvent["by"], remains?: string): void {
  // A charred heap is no longer a door that's closed and barred, nor a lantern that's lit.
  e.states = [...e.states.filter(s => !["damaged", "burning", "open", "closed", "locked", "barred", "lit"].includes(s)), "destroyed"];
  if (e.hp) e.hp.current = 0;
  if (remains) note(e, remains, turn, by);
  // What it held falls out where it stood; what hung from it falls.
  for (const child of Object.values(world.entities).filter(c => c.parent === e.id)) {
    child.at = spotNear(world, e.id, 3);
    child.parent = areaAt(world, child.at).id;
    // Anything hanging from it, or from what it held, comes down with it.
    for (const down of [child, ...descendants(world, child.id)]) if (down.states.includes("hanging")) {
      down.states = [...down.states.filter(st => st !== "hanging"), "fallen"];
      world.log.push({ turn, text: `${down.name} falls`, by });
    }
  }
  world.log.push({ turn, text: `${e.name} is destroyed${remains ? ` (${remains})` : ""}`, by });
}

// ---------------------------------------------------------------------------------------------
// The rules on things: deterministic.

const IMMUNE = new Set(["poison", "psychic"]);
/** What a material shrugs off (beyond poison and psychic, which no thing feels). */
const MATERIAL_IMMUNE: Partial<Record<Material, string[]>> = {
  stone: ["fire", "cold", "lightning", "necrotic", "radiant"], iron: ["fire", "cold", "necrotic", "radiant"], steel: ["fire", "cold", "necrotic", "radiant"],
  brass: ["fire", "cold", "necrotic", "radiant"], silver: ["fire", "cold", "necrotic", "radiant"], liquid: ["bludgeoning", "piercing", "slashing", "force", "thunder", "lightning", "necrotic", "radiant", "acid"],
};

/** Damage to a thing: hit points, then damaged (half) and destroyed (none); fire sets what burns alight. */
export function damageThing(world: SceneWorld, e: Entity, amount: number, type: string, turn: number): string[] {
  if (!e.hp || e.states.includes("destroyed")) return [];
  if (IMMUNE.has(type) || e.tags.includes("fire") && type === "fire" || (e.material && MATERIAL_IMMUNE[e.material]?.includes(type))) return [`${capital(e.name)}: unharmed by the ${type}`];
  const lines: string[] = [];
  e.hp.current = Math.max(0, e.hp.current - amount);
  if (e.hp.current === 0) {
    const burnt = type === "fire" && e.tags.includes("flammable");
    destroy(world, e, turn, "rules", burnt ? "burned to a charred heap" : type === "thunder" || type === "force" ? "smashed to pieces" : "wrecked");
    // A burned-out wreck keeps burning a while, and can still set its neighbours alight.
    if (burnt && !heldBy(world, e)) e.states.push("burning");
    if (e.tags.includes("spirits")) { if (!e.states.includes("burning")) e.states.push("burning"); lines.push(`${capital(e.name)} breaks, and the spirits in it go up in flames`); }
    lines.push(`${capital(e.name)} takes ${amount} ${type} damage and is destroyed`);
    return lines;
  }
  if (e.hp.current * 2 <= e.hp.max && !e.states.includes("damaged")) e.states.push("damaged");
  lines.push(`${capital(e.name)} takes ${amount} ${type} damage (${e.states.includes("damaged") ? "badly damaged" : "scorched or dented"})`);
  if (type === "fire" && e.tags.includes("flammable") && !e.states.includes("wet") && !e.states.includes("burning") && !heldBy(world, e)) {
    e.states.push("burning");
    lines.push(`${capital(e.name)} catches fire`);
    world.log.push({ turn, text: `${e.name} catches fire`, by: "rules" });
  }
  if (type === "cold" && e.material === "liquid") e.states.push("frozen");
  return lines;
}

/**
 * Story time passes (a turn is about a minute): what's burning burns (1d10 fire), sets light to
 * flammable things within five feet, and burning in a dusty area sets the dust off.
 */
export function tick(world: SceneWorld, turn: number, seed: number): string[] {
  const lines: string[] = [];
  const random = rng(seed);
  const d = (n: number, sides: number) => Array.from({ length: n }, () => 1 + Math.floor(random() * sides)).reduce((a, b) => a + b, 0);
  const burning = Object.values(world.entities).filter(e => e.states.includes("burning"));
  for (const e of burning) {
    // A wreck that has burned for a turn goes out (smouldering): it can't burn twice.
    if (e.states.includes("destroyed")) {
      if (e.states.includes("smouldering")) { e.states = e.states.filter(s => s !== "burning"); continue; }
      e.states.push("smouldering");
    }
    const area = areaOf(world, e.id);
    if (area?.states.includes("dusty") && !area.states.includes("exploded")) {
      area.states = [...area.states.filter(s => s !== "dusty"), "exploded", "burning"];
      lines.push(`The dust in ${area.name} goes up: an explosion`);
      world.log.push({ turn, text: `the dust in ${area.name} exploded`, by: "rules" });
      for (const t of Object.values(world.entities).filter(x => isThing(x) && areaOf(world, x.id)?.id === area.id)) lines.push(...damageThing(world, t, d(4, 6), "fire", turn));
    }
    lines.push(...damageThing(world, e, d(1, 10), "fire", turn));
    for (const n of within(world, e.id, 5, x => isThing(x) && x.tags.includes("flammable") && !x.states.includes("burning") && !x.states.includes("wet") && !x.states.includes("destroyed") && !heldBy(world, x))) {
      n.states.push("burning");
      lines.push(`The fire spreads to ${n.name}`);
      world.log.push({ turn, text: `fire spread to ${n.name}`, by: "rules" });
    }
  }
  return lines;
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// ---------------------------------------------------------------------------------------------
// What the GM sees: the player's surroundings in full, the rest of the place a level down.

function describeEntity(world: SceneWorld, e: Entity, from?: Point, depth = 0): string {
  const feet = from && positionOf(world, e.id) ? Math.round(distance(from, positionOf(world, e.id)!)) : undefined;
  const bits = [
    e.states.filter(s => s !== "gone").length ? e.states.filter(s => s !== "gone").join(", ") : "",
    feet !== undefined && depth === 0 && e.id !== "player" ? `${feet} ft away` : "",
  ].filter(Boolean);
  const held = Object.values(world.entities).filter(c => c.parent === e.id && present(c));
  const line = `${"  ".repeat(depth)}- ${e.name} [${e.id}]${bits.length ? ` (${bits.join("; ")})` : ""}${e.notes.length ? `: ${e.notes.slice(-2).map(n => n.text).join("; ")}` : ""}`;
  return [line, ...held.map(c => describeEntity(world, c, from, depth + 1))].join("\n");
}

/**
 * The world as the GM reads it before a reply: where the player is, everything around them, the
 * rest of the place in outline, and what has changed lately. Keep to it: it's updated after every reply.
 */
export function worldView(world: SceneWorld, options: { full?: boolean } = {}): string {
  const me = world.entities.player;
  const here = me ? areaOf(world, "player") : undefined;
  const from = me ? positionOf(world, "player") : undefined;
  const areas = Object.values(world.entities).filter(e => e.kind === "area");
  const contents = (area: Entity) => Object.values(world.entities).filter(e => e.parent === area.id && present(e) && e.id !== "player");
  const lines = [`${world.entities[world.root]!.name}${here ? `: the player is in ${here.name}` : ""}.`];
  const carried = me ? Object.values(world.entities).filter(e => e.parent === "player" && present(e)) : [];
  if (carried.length) lines.push(`The player carries: ${carried.map(e => `${e.name} [${e.id}]`).join(", ")}.`);
  // The player is listed nowhere else: their spot, states (hidden, prone...) and notes go here.
  if (me && from) {
    const by = Object.values(world.entities).filter(e => e.id !== "player" && e.at && present(e) && e.kind !== "area" && distance(e.at, from) <= 6).map(e => e.name).slice(0, 3);
    const states = me.states.filter(s => s !== "gone");
    if (by.length || states.length || me.notes.length) lines.push(`The player${by.length ? ` is by ${by.join(", ")}` : ""}${states.length ? ` (${states.join(", ")})` : ""}${me.notes.length ? `: ${me.notes.slice(-2).map(n => n.text).join("; ").replace(/\.$/, "")}` : ""}.`);
  }
  for (const area of areas) {
    const inside = contents(area);
    const near = from && area.rect ? Math.round(Math.max(0, Math.hypot(Math.max(area.rect.x - from.x, 0, from.x - area.rect.x - area.rect.w), Math.max(area.rect.y - from.y, 0, from.y - area.rect.y - area.rect.h)))) : 0;
    const open = options.full || area.id === here?.id || near <= 10;
    const changed = inside.filter(e => e.states.length || e.notes.some(n => n.by !== "author"));
    if (open) {
      lines.push(`\n${area.name} [${area.id}]${area.states.length ? ` (${area.states.join(", ")})` : ""}${area.id === here?.id ? " (the player is here)" : ` (${near} ft away)`}:`);
      lines.push(...inside.map(e => describeEntity(world, e, from)));
    } else {
      const people = inside.filter(isBeing).map(e => e.name);
      lines.push(`\n${area.name} [${area.id}] (${near} ft away): ${[...people, `${inside.length - people.length} things`].join(", ")}${changed.length ? `; changed: ${changed.map(e => `${e.name} (${[...e.states, ...e.notes.filter(n => n.by !== "author").map(n => n.text)].join(", ")})`).join("; ")}` : ""}`);
    }
  }
  const recent = world.log.slice(-6);
  if (recent.length) lines.push(`\nLately: ${recent.map(l => l.text).join("; ")}.`);
  return lines.join("\n");
}

/** A top-down sketch of the place for the terminal: 1 character = 2.5 feet. */
export function asciiMap(world: SceneWorld): string {
  const root = world.entities[world.root]!;
  const scale = 2.5;
  const w = Math.ceil(root.rect!.w / scale), h = Math.ceil(root.rect!.h / (scale * 2));
  const grid = Array.from({ length: h + 1 }, () => Array.from({ length: w + 1 }, () => " "));
  const put = (p: Point, ch: string) => { const x = Math.round(p.x / scale), y = Math.round(p.y / (scale * 2)); if (grid[y]?.[x] !== undefined) grid[y]![x] = ch; };
  for (const a of Object.values(world.entities).filter(e => e.kind === "area" && e.rect)) {
    const r = a.rect!;
    for (let x = r.x; x <= r.x + r.w; x += scale) { put({ x, y: r.y }, "·"); put({ x, y: r.y + r.h }, "·"); }
    for (let y = r.y; y <= r.y + r.h; y += scale * 2) { put({ x: r.x, y }, "·"); put({ x: r.x + r.w, y }, "·"); }
  }
  const legend: string[] = [];
  const glyphs = "abcdefghijklmnopqrstuvwxyz0123456789";
  let i = 0;
  // Things first, then people, then the player on top.
  const order = (x: Entity) => (x.player ? 2 : isBeing(x) ? 1 : 0);
  for (const e of Object.values(world.entities).filter(x => x.at && present(x) && x.kind !== "area").sort((a, b) => order(a) - order(b))) {
    const ch = e.id === "player" ? "@" : isBeing(e) ? glyphs[i++ % glyphs.length]!.toUpperCase() : e.states.includes("burning") ? "*" : e.states.includes("destroyed") ? "x" : glyphs[i++ % glyphs.length]!;
    put(e.at!, ch);
    legend.push(`${ch} ${e.name}${e.states.length ? ` (${e.states.join(", ")})` : ""}`);
  }
  return `${root.name}\n${grid.map(r => r.join("")).join("\n")}\n\n${legend.join("\n")}`;
}

/** People who have come on stage since the world was built (an entrance beat, called in by play) join it at the way in. */
export function joinWorld(world: SceneWorld, people: Array<{ id: string; name: string }>, turn: number): string[] {
  const joined: string[] = [];
  for (const p of people) {
    if (world.entities[p.id]) continue;
    const way = Object.values(world.entities).find(e => e.tags.includes("door") && present(e) && areaOf(world, e.id)?.id === areaOf(world, "player")?.id)
      ?? Object.values(world.entities).find(e => e.tags.includes("door") && present(e));
    const at = way ? spotNear(world, way.id, 5) : spotNear(world, "player", 10);
    world.entities[p.id] = { id: p.id, name: p.name, kind: "person", parent: areaAt(world, at).id, at, tags: [], states: [], notes: [], cast: p.id, created: turn };
    world.log.push({ turn, text: `${p.name} arrives`, by: "rules" });
    joined.push(p.name);
  }
  return joined;
}
