import { parseName, singular } from "../../look/names.ts";
import { castOf } from "../looks.ts";
import { CORNERS, DOOR_STATES, FLOORS, GROUNDS, RELATIONS, SIDES, SURROUNDINGS, THING_KINDS, WALLS, type CastMember, type PersonPlan, type PlacePlan, type ThingPlan } from "./plan.ts";

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
/** One of the values, or what a near miss means ("boards-over-water" is planks-over-water, "wood" is timber). */
const loose = <T extends string>(values: readonly T[], value: unknown, fallback: T, near: Array<[RegExp, T]>): T => {
  const v = String(value ?? "").toLowerCase().trim();
  if ((values as readonly string[]).includes(v)) return v as T;
  return near.find(([re]) => re.test(v))?.[1] ?? fallback;
};
const NEAR_GROUND: Array<[RegExp, (typeof GROUNDS)[number]]> = [
  [/over.?water|piles|pier|jetty|boardwalk|pontoon|stilts|gangway/, "planks-over-water"], [/boat|barge|skiff|ship|wherry|lighter|punt/, "boat"],
  [/water|river|sea|harbou?r|canal|pond|lake|stream|dock/, "water"], [/stair|step/, "steps"], [/plank|board|deck|wood|timber/, "boards"],
  [/cobble|stone|pav|flag|street|road|sett|square/, "cobbles"], [/grass|lawn|turf|meadow|green|garden/, "grass"], [/dirt|mud|earth|yard|soil|gravel|sand|track/, "dirt"],
];
const NEAR_WALLS: Array<[RegExp, (typeof WALLS)[number]]> = [
  [/tar/, "tarred-timber"], [/bank|turf|earth|burrow|cave/, "earth-bank"], [/marble|ashlar|dressed|fine|palace/, "fine-stone"], [/brick/, "brick"],
  [/plaster|wattle|daub|white/, "plaster"], [/wood|timber|plank|board|log/, "timber"], [/stone|rubble|granite|flint/, "stone"],
];
const NEAR_SURROUNDINGS: Array<[RegExp, (typeof SURROUNDINGS)[number]]> = [[/bank|earth|hill|turf|cliff/, "earth-bank"], [/water|river|sea|harbou?r|canal|lake/, "water"], [/building|house|street|town|shop|lane|terrace/, "buildings"]];
const NEAR_FLOOR: Array<[RegExp, (typeof FLOORS)[number]]> = [[/board|plank|wood|timber/, "boards"], [/flag|stone|cobble|slate/, "flagstones"], [/earth|dirt|mud|straw|rush/, "earth"], [/carpet|rug/, "carpet"], [/tile|marble|mosaic/, "tiles"]];
const clamp = (n: unknown, lo: number, hi: number, fallback: number) => { const v = Number(n); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback; };

/** Names of terrain the map already draws: a thing called this is the ground itself, not furniture. */
export const TERRAIN_NAMES = /\b(river|harbou?r|sea|canal|water(?!\s*butt)|steps|stairs?|staircase|walls?|windows?|floor|ceiling|roof|sky|bank|quay|wharf|street|lane|square|yard)\b/i;

export function normalizePlan(raw: PlacePlan, cast: CastMember[] = []): { plan: PlacePlan; problems: Problem[] } {
  const problems: Problem[] = [];
  const problem = (check: Problem["check"], subject: string, message: string, severity: Problem["severity"] = "error") => problems.push({ check, subject, message, severity });
  const plan: PlacePlan = structuredClone(raw);
  plan.name = String(plan.name || "the place");
  plan.description = String(plan.description || "");
  plan.width = clamp(plan.width, 15, 150, 40);
  plan.depth = clamp(plan.depth, 15, 150, 40);
  plan.storeys = Math.round(clamp(plan.storeys, 1, 3, 1));
  plan.walls = loose(WALLS, plan.walls, "timber", NEAR_WALLS);
  plan.floor = loose(FLOORS, plan.floor, "boards", NEAR_FLOOR);
  plan.surroundings = loose(SURROUNDINGS, plan.surroundings, "open", NEAR_SURROUNDINGS);
  for (const key of ["outside", "rooms", "doors", "windows", "things", "people"] as const) if (!Array.isArray(plan[key])) (plan as unknown as Record<string, unknown[]>)[key] = [];
  for (const p of plan.people) { p.id = String(p.id || ""); p.name = String(p.name || p.id); }

  // Ids: safe and unique across everything, so a reference can only mean one thing. The scene's
  // cast keep their own ids (Dilly Sparrow is dilly, however the plan wrote her), claimed first.
  const taken = new Set<string>();
  const renamed = new Map<string, string>();
  const claim = (id: string, name: string, avoid?: (id: string) => boolean) => {
    const base = slugId(id || name);
    let unique = base;
    // A letter, not a number: the cast table reads "crake-2" as one of the Crakes.
    for (let i = 0; taken.has(unique) || avoid?.(unique); i++) unique = `${base}-${"bcdefghijklmnopqrstuvwxyz"[i % 25]}${i >= 25 ? i : ""}`;
    taken.add(unique);
    if (id && !renamed.has(id)) renamed.set(id, unique);
    return unique;
  };
  const castOfPerson = matchCast(plan.people, cast);
  for (const [p, c] of castOfPerson) {
    if (p.id !== c.id) renamed.set(p.id, c.id);
    p.id = c.id;
    taken.add(c.id);
  }
  plan.people = plan.people.filter(p => castOfPerson.has(p) || !cast.some(c => c.id === p.id) || (problem("plan", p.id, `${p.name} is a second ${p.id}: left out.`, "warning"), false));
  for (const o of plan.outside) o.id = claim(o.id, o.name);
  for (const r of plan.rooms) r.id = claim(r.id, r.name);
  for (const d of plan.doors) d.id = claim(d.id, d.name);
  for (const t of plan.things) t.id = claim(t.id, t.name);
  // Anyone else gets an id of their own: not one the game's cast table already gives to someone else
  // (a porter called "kell" would be drawn as Sergeant Kell).
  const elsewhere = (id: string, name: string) => { const known = castOf(id); return !!known && !sameName(known.name, name); };
  for (const p of plan.people) if (!castOfPerson.has(p)) p.id = claim(p.id, p.name, id => elsewhere(id, p.name));

  const rooms = new Set(plan.rooms.map(r => r.id));
  const outside = new Set(plan.outside.map(o => o.id));
  const doors = new Set(plan.doors.map(d => d.id));
  const things = new Set(plan.things.map(t => t.id));
  const people = new Set(plan.people.map(p => p.id));
  const named = [...plan.rooms, ...plan.outside, ...plan.doors, ...plan.things, ...plan.people].map(e => ({ id: e.id, words: new Set([...words(e.name), ...words(e.id)]), head: parseName(e.name).head, parts: new Set(e.id.split("-")) }));
  /** A reference: the id as written, renamed, or the best match by name among the allowed kinds. */
  const resolve = (ref: string, allowed: Set<string>[]): string | undefined => {
    if (!ref) return undefined;
    const ok = (id: string) => allowed.some(s => s.has(id));
    for (const id of [ref, renamed.get(ref), slugId(ref)]) if (id && ok(id)) return id;
    const want = words(ref);
    if (!want.length) return undefined;
    // Most words in common; a tie goes to what it is (its head noun: "the bar" is the skiff-hull bar, not the shelf behind the bar), then to its id.
    const scored = named.filter(e => ok(e.id)).map(e => ({ id: e.id, hits: want.filter(w => e.words.has(w)).length + (want.includes(e.head) ? 0.5 : 0) + (want.some(w => e.parts.has(w)) ? 0.25 : 0) })).filter(x => x.hits >= 1).sort((a, b) => b.hits - a.hits);
    return scored[0] && Math.floor(scored[0].hits) / want.length >= 0.5 && scored[1]?.hits !== scored[0].hits ? scored[0].id : undefined;
  };

  // Outside: at least one, so there's a street to arrive by.
  for (const o of plan.outside) {
    o.side = pick(SIDES, o.side, "south");
    o.ground = loose(GROUNDS, o.ground, "cobbles", NEAR_GROUND);
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
    r.floor = r.floor === "same" || !r.floor ? "same" : loose(FLOORS, r.floor, plan.floor, NEAR_FLOOR);
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
    // Two outside areas (the stairs up to the quay): the layout joins the outside up anyway.
    if (from && to && outside.has(from) && outside.has(to)) {
      problem("door", d.id, `${d.name} joins two outside areas: they're joined by a way round the building instead.`, "warning");
      return false;
    }
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
    // On, in or under a door (a grille in the river door): it's by the door, as the door itself is drawn.
    if (["on", "in", "under"].includes(t.relation) && doors.has(t.target)) t.relation = "by-door";
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

  // The cast the plan left out stand by what their line mentions (Nan by the bar, Cob by the pots),
  // else at the door the player comes in by: placed like everyone else, not dropped in the middle.
  for (const c of cast) {
    if (plan.people.some(p => p.id === c.id)) continue;
    // What a thing is (its head noun: "a brazier for cold hands" is a brazier), in their line.
    const want = significant(`${c.name} ${c.who ?? ""}`);
    const score = (name: string) => (want.has(parseName(name).head) ? 1 : 0);
    const thing = plan.things.filter(t => t.kind !== "item" && t.relation !== "overhead" && !["on", "in", "under"].includes(t.relation)).map(t => ({ t, s: score(t.name) })).sort((a, b) => b.s - a.s)[0];
    const entrance = plan.doors.find(d => d.to === plan.start || d.from === plan.start) ?? plan.doors.find(d => outside.has(d.to));
    const person: PersonPlan = thing && thing.s > 0
      ? { id: c.id, name: c.name, in: thing.t.in, relation: "near", target: thing.t.id, note: "" }
      : entrance
        ? { id: c.id, name: c.name, in: rooms.has(plan.start) || outside.has(plan.start) ? plan.start : entrance.to, relation: "by-door", target: entrance.id, note: "" }
        : { id: c.id, name: c.name, in: plan.start, relation: "centre", target: "", note: "" };
    plan.people.push(person);
    problem("plan", c.id, `${c.name} (${c.id}) isn't among the people: put ${person.relation === "near" ? `near ${plan.things.find(t => t.id === person.target)?.name}` : person.relation === "by-door" ? "by the door" : "in the middle"}. Put them where the description has them, with the id ${c.id}.`, "warning");
  }
  return { plan, problems };
}

const TITLE_WORDS = new Set(["the", "and", "mister", "master", "mistress", "missus", "mrs", "miss", "sergeant", "corporal", "captain", "marshal", "sir", "lady", "lord", "dame", "old", "young", "big", "little"]);
const STOP_WORDS = new Set([...TITLE_WORDS, "with", "her", "his", "their", "she", "him", "them", "who", "that", "this", "for", "from", "into", "onto", "over", "under", "behind", "beside", "near", "about", "all", "one", "two", "very", "good", "man", "woman", "boy", "girl", "back", "out", "off", "its", "has", "had", "was", "are", "not", "but", "any", "than", "then", "too", "keeps", "kept", "like", "what", "when", "where"]);
/** A name's words that say who someone is (titles and articles aside). */
const nameWords = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !TITLE_WORDS.has(w));
/** Words worth matching a line about someone against a thing's name: nouns, mostly, singular. */
const significant = (s: string) => new Set(s.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 2 && !STOP_WORDS.has(w)).map(singular));
/** Two names for one person: every word of the shorter is in the longer ("Duchess", "Duchess the dog"). */
export function sameName(a: string, b: string): boolean {
  const wa = nameWords(a), wb = new Set(nameWords(b));
  return wa.length > 0 && wa.every(w => wb.has(w)) || nameWords(b).length > 0 && nameWords(b).every(w => new Set(wa).has(w));
}

/**
 * The plan's people who are the scene's cast, by id or by name ("Dilly Sparrow", id dilly-sparrow,
 * is dilly; "Hep Grist" is Hepzibah Grist, hep): best matches first, each cast member once.
 */
export function matchCast(people: PersonPlan[], cast: CastMember[]): Map<PersonPlan, CastMember> {
  const pairs: Array<{ p: PersonPlan; c: CastMember; s: number }> = [];
  for (const p of people) {
    const words = nameWords(p.name);
    for (const c of cast) {
      if (p.id === c.id) { pairs.push({ p, c, s: 100 }); continue; }
      const theirs = new Set([...nameWords(c.name), ...nameWords(c.id.replace(/-/g, " ")), c.id]);
      const hits = new Set([...words, ...nameWords(p.id.replace(/-/g, " "))].filter(w => theirs.has(w))).size;
      const s = hits / Math.max(1, words.length);
      if (hits >= 1 && s >= 0.5) pairs.push({ p, c, s });
    }
  }
  const out = new Map<PersonPlan, CastMember>();
  const used = new Set<string>();
  for (const { p, c } of pairs.sort((a, b) => b.s - a.s)) {
    if (out.has(p) || used.has(c.id)) continue;
    out.set(p, c);
    used.add(c.id);
  }
  return out;
}

function fixRelation(t: ThingPlan, target: string | undefined, target2: string | undefined, problem: (check: Problem["check"], subject: string, message: string, severity?: Problem["severity"]) => void): void {
  t.target = target && target !== t.id ? target : "";
  t.target2 = target2 && target2 !== t.id ? target2 : "";
  switch (t.relation) {
    case "near": case "beside": case "behind": case "by-door": case "on": case "in": case "under":
      if (!t.target) {
        if (t.relation === "on" || t.relation === "in" || t.relation === "under") problem("relation", t.id, `${t.name} is ${t.relation} something that isn't in the plan: it was put in the middle of the room.`, "warning");
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
