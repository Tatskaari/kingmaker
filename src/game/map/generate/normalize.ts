import { CORNERS, DOOR_STATES, FLOORS, GROUNDS, RELATIONS, SIDES, SURROUNDINGS, THING_KINDS, WALLS, type PlacePlan, type ThingPlan } from "./plan.ts";

/**
 * Cleaning a model's plan before it's laid out: ids made safe and unique, references resolved
 * (by id, else by name), exactly one main room, doors that join a room to something, relations with
 * what they need. What had to be guessed is a problem for the model to fix in a repair round; the
 * plan still compiles, so there's always a map to look at.
 */

export interface Problem {
  /** What kind of check failed. */
  check: "plan" | "fit" | "reach" | "access" | "overlap" | "door" | "relation" | "hidden" | "world";
  /** An id in the plan it's about. */
  subject: string;
  message: string;
  /** Errors fail validation; warnings are reported and don't. */
  severity: "error" | "warning";
}

export const slugId = (s: string) => s.toLowerCase().replace(/^(a|an|the) /, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "x";
const words = (s: string) => s.toLowerCase().replace(/^(a|an|the) /, "").split(/[^a-z0-9]+/).filter(w => w.length > 2);

const pick = <T extends string>(values: readonly T[], value: unknown, fallback: T): T => ((values as readonly string[]).includes(value as string) ? value as T : fallback);
const clamp = (n: unknown, lo: number, hi: number, fallback: number) => { const v = Number(n); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback; };

/** Names of terrain the map already draws: a thing called this is the ground itself, not furniture. */
export const TERRAIN_NAMES = /\b(river|harbou?r|sea|canal|water(?!\s*butt)|steps|stairs?|staircase|walls?|windows?|floor|ceiling|roof|sky|bank|quay|wharf|street|lane|square|yard)\b/i;

export function normalizePlan(raw: PlacePlan): { plan: PlacePlan; problems: Problem[] } {
  const problems: Problem[] = [];
  const problem = (check: Problem["check"], subject: string, message: string, severity: Problem["severity"] = "error") => problems.push({ check, subject, message, severity });
  const plan: PlacePlan = structuredClone(raw);
  plan.name = String(plan.name || "the place");
  plan.description = String(plan.description || "");
  plan.width = clamp(plan.width, 15, 150, 40);
  plan.depth = clamp(plan.depth, 15, 150, 40);
  plan.storeys = Math.round(clamp(plan.storeys, 1, 3, 1));
  plan.walls = pick(WALLS, plan.walls, "timber");
  plan.floor = pick(FLOORS, plan.floor, "boards");
  plan.surroundings = pick(SURROUNDINGS, plan.surroundings, "open");
  for (const key of ["outside", "rooms", "doors", "windows", "things", "people"] as const) if (!Array.isArray(plan[key])) (plan as unknown as Record<string, unknown[]>)[key] = [];

  // Ids: safe and unique across everything, so a reference can only mean one thing.
  const taken = new Set<string>();
  const renamed = new Map<string, string>();
  const claim = (id: string, name: string) => {
    const base = slugId(id || name);
    let unique = base;
    for (let i = 2; taken.has(unique); i++) unique = `${base}-${i}`;
    taken.add(unique);
    if (id && !renamed.has(id)) renamed.set(id, unique);
    return unique;
  };
  for (const o of plan.outside) o.id = claim(o.id, o.name);
  for (const r of plan.rooms) r.id = claim(r.id, r.name);
  for (const d of plan.doors) d.id = claim(d.id, d.name);
  for (const t of plan.things) t.id = claim(t.id, t.name);
  for (const p of plan.people) p.id = claim(p.id, p.name);

  const rooms = new Set(plan.rooms.map(r => r.id));
  const outside = new Set(plan.outside.map(o => o.id));
  const doors = new Set(plan.doors.map(d => d.id));
  const things = new Set(plan.things.map(t => t.id));
  const people = new Set(plan.people.map(p => p.id));
  const named = [...plan.rooms, ...plan.outside, ...plan.doors, ...plan.things, ...plan.people].map(e => ({ id: e.id, words: new Set([...words(e.name), ...words(e.id)]) }));
  /** A reference: the id as written, renamed, or the best match by name among the allowed kinds. */
  const resolve = (ref: string, allowed: Set<string>[]): string | undefined => {
    if (!ref) return undefined;
    const ok = (id: string) => allowed.some(s => s.has(id));
    for (const id of [ref, renamed.get(ref), slugId(ref)]) if (id && ok(id)) return id;
    const want = words(ref);
    if (!want.length) return undefined;
    const scored = named.filter(e => ok(e.id)).map(e => ({ id: e.id, hits: want.filter(w => e.words.has(w)).length })).filter(x => x.hits > 0).sort((a, b) => b.hits - a.hits);
    return scored[0] && scored[0].hits / want.length >= 0.5 && scored[1]?.hits !== scored[0].hits ? scored[0].id : undefined;
  };

  // Outside: at least one, so there's a street to arrive by.
  for (const o of plan.outside) {
    o.side = pick(SIDES, o.side, "south");
    o.ground = pick(GROUNDS, o.ground, "cobbles");
    o.depth = clamp(o.depth, 5, 40, 10);
    o.name = String(o.name || o.id); o.description = String(o.description || "");
  }
  if (!plan.outside.some(o => o.ground !== "boat" && o.ground !== "water")) {
    const id = claim("street", "the street");
    plan.outside.unshift({ id, name: "the street", description: "", side: "south", depth: 10, ground: "cobbles" });
    outside.add(id);
    problem("plan", id, "There's no street, quay or yard outside to arrive by: one was added on the south side.", "warning");
  }

  // Rooms: exactly one main.
  if (!plan.rooms.length) {
    const id = claim("main-room", "the main room");
    plan.rooms.push({ id, name: plan.name, description: plan.description, where: "main", width: 0, depth: 0, floor: "same" });
    rooms.add(id);
    problem("plan", id, "The plan has no rooms: the whole building was made one room.");
  }
  for (const r of plan.rooms) {
    r.where = pick(["main", ...SIDES, ...CORNERS] as const, r.where, "north");
    r.floor = pick([...FLOORS, "same"] as const, r.floor, "same");
    r.width = clamp(r.width, 10, 150, 15); r.depth = clamp(r.depth, 10, 150, 15); // the layout makes it 15 at least
    r.name = String(r.name || r.id); r.description = String(r.description || "");
  }
  const mains = plan.rooms.filter(r => r.where === "main");
  if (!mains.length) {
    const biggest = [...plan.rooms].sort((a, b) => b.width * b.depth - a.width * a.depth)[0]!;
    biggest.where = "main";
    if (plan.rooms.length > 1) problem("plan", biggest.id, `No room is "main": ${biggest.name} was made the main room.`);
  }
  if (mains.length > 1) {
    // A second main room goes where there's a free side: the one with fewest rooms, away from the street.
    const street = plan.outside[0]!.side;
    for (const extra of mains.slice(1)) {
      const used = (s: string) => plan.rooms.filter(r => r.where === s || r.where.includes(s)).length;
      const side = [...SIDES].filter(s => s !== street).sort((a, b) => used(a) - used(b))[0]!;
      extra.where = side;
      problem("plan", extra.id, `Only one room can be "main" (it takes the space the others leave): ${extra.name} was put on the ${side} side. Give it a side or corner and a size.`);
    }
  }

  // Doors: from a room, to a room or the outside.
  plan.doors = plan.doors.filter(d => {
    let from = resolve(d.from, [rooms, outside]), to = resolve(d.to, [rooms, outside]);
    if (from && to && outside.has(from) && rooms.has(to)) [from, to] = [to, from];
    if (!from || !to || from === to || !rooms.has(from)) {
      problem("door", d.id, `The door ${d.name} must join a room to another room or to an outside area (it says from "${d.from}" to "${d.to}"): it was left out.`);
      return false;
    }
    d.from = from; d.to = to;
    d.wall = pick([...SIDES, "any"] as const, d.wall, "any");
    d.states = (Array.isArray(d.states) ? d.states : []).filter(s => (DOOR_STATES as readonly string[]).includes(s));
    if (!d.states.length) d.states = ["closed"];
    d.name = String(d.name || d.id); d.description = String(d.description || "");
    return true;
  });

  plan.windows = plan.windows.filter(w => {
    const room = resolve(w.room, [rooms]);
    if (!room) { problem("plan", w.room, `A window is in "${w.room}", which isn't a room: it was left out.`, "warning"); return false; }
    w.room = room; w.wall = pick(SIDES, w.wall, "south"); w.count = Math.round(clamp(w.count, 1, 4, 1));
    return true;
  });

  // Things: where they are, and what their relation needs.
  const mainId = plan.rooms.find(r => r.where === "main")!.id;
  const anything = [things, doors, people];
  const heldIn = new Map<string, string>();
  for (const t of plan.things) {
    t.name = String(t.name || t.id); t.description = String(t.description || "");
    t.kind = pick(THING_KINDS, t.kind, "object");
    t.relation = pick(RELATIONS, t.relation, "centre");
    t.wall = pick([...SIDES, "none"] as const, t.wall, "none");
    t.corner = pick([...CORNERS, "none"] as const, t.corner, "none");
    t.tags = Array.isArray(t.tags) ? t.tags.map(String) : [];
    t.states = Array.isArray(t.states) ? t.states.map(String) : [];
    t.tiles = Math.round(clamp(t.tiles, 1, 8, 1));
    const area = resolve(t.in, [rooms, outside]);
    if (area) { t.in = area; continue; }
    // "In" a thing or a person: it's on or in them, wherever they are.
    const holder = resolve(t.in, [things, people]);
    if (holder && holder !== t.id) { heldIn.set(t.id, holder); t.target = holder; if (!["on", "in", "under"].includes(t.relation)) t.relation = "on"; }
    else problem("plan", t.id, `${t.name} is in "${t.in}", which isn't a room or outside area: it was put in the main room.`);
    t.in = mainId;
  }
  const areaOfId = (id: string, seen = 0): string => {
    const holder = heldIn.get(id);
    if (holder && seen < 8) return areaOfId(holder, seen + 1);
    return plan.things.find(x => x.id === id)?.in ?? plan.people.find(p => p.id === id)?.in ?? mainId;
  };
  for (const t of plan.things) {
    if (heldIn.has(t.id)) t.in = resolve(areaOfId(t.id), [rooms, outside]) ?? mainId;
    fixRelation(t, resolve(t.target, anything), resolve(t.target2, anything), problem);
  }
  // Things held by things that are themselves held, or that hold each other, are put down.
  for (const t of plan.things) if (["on", "in", "under"].includes(t.relation) && t.target === t.id) { t.relation = "centre"; t.target = ""; }
  for (const t of plan.things) {
    // The plan's doors are the doors: a thing tagged "door" (a grille in one, a wicket) would be
    // pulled onto a door's square by the map and drawn as the door itself.
    t.tags = t.tags.filter(tag => tag !== "door");
    // Something dead in a jar is an object now; a live creature on something stands beside it (the map
    // draws beings wherever they are, so one "in" a jar on a shelf would be drawn on the shelf).
    if ((t.kind === "creature" || t.kind === "crowd") && ["on", "in", "under"].includes(t.relation)) {
      if (t.states.some(st => /dead|stuffed|pickled|preserved|drowned/.test(st)) || t.kind === "creature" && (t.size === "tiny" || t.size === "small") && plan.things.find(x => x.id === t.target)?.tags.includes("container")) t.kind = "item";
      else t.relation = "near";
    }
  }

  for (const p of plan.people) {
    p.name = String(p.name || p.id); p.note = String(p.note || "");
    p.relation = pick(RELATIONS, p.relation, "near");
    if (["on", "in", "under", "overhead"].includes(p.relation)) p.relation = "near";
    const area = resolve(p.in, [rooms, outside]);
    if (!area) problem("plan", p.id, `${p.name} is in "${p.in}", which isn't a room or outside area: they were put in the main room.`, "warning");
    p.in = area ?? mainId;
    const target = resolve(p.target, anything);
    p.target = target && target !== p.id ? target : "";
    if (!p.target && ["near", "beside", "behind", "between", "by-door"].includes(p.relation)) p.relation = "centre";
  }

  const start = resolve(plan.start, [rooms, outside]);
  plan.start = start ?? plan.outside.find(o => o.ground !== "water" && o.ground !== "boat")!.id;
  return { plan, problems };
}

function fixRelation(t: ThingPlan, target: string | undefined, target2: string | undefined, problem: (check: Problem["check"], subject: string, message: string, severity?: Problem["severity"]) => void): void {
  t.target = target && target !== t.id ? target : "";
  t.target2 = target2 && target2 !== t.id ? target2 : "";
  switch (t.relation) {
    case "near": case "beside": case "behind": case "by-door": case "on": case "in": case "under":
      if (!t.target) {
        if (t.relation === "on" || t.relation === "in" || t.relation === "under") problem("relation", t.id, `${t.name} is ${t.relation} something that isn't in the plan: it was put in the middle of the room.`);
        t.relation = "centre";
      }
      break;
    case "between":
      if (!t.target || !t.target2) { t.relation = t.target || t.target2 ? "near" : "centre"; t.target ||= t.target2; }
      break;
    case "corner":
      if (t.corner === "none" && t.wall !== "none") t.relation = "against";
      break;
  }
}
