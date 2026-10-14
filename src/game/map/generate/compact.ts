import type { Material, Size } from "../../../world/scene-world.ts";
import { CORNERS, DOOR_STATES, FLOORS, GROUNDS, RELATIONS, SIDES, SURROUNDINGS, THING_KINDS, WALLS, type DoorPlan, type OutsidePlan, type PersonPlan, type PlacePlan, type RoomPlan, type ThingPlan, type WindowPlan } from "./plan.ts";

/**
 * The plan, tersely: the same plan as plan.ts's, with every entry a list of its fields
 * (["bar", "the skiff-hull bar", "feature large wood", "taproom", "against north", "4"]) in a
 * strict JSON object whose sections come in the order a place is built (the building, the outside,
 * the rooms, the doors, the windows, then the things and the people). Field names and empty fields
 * were most of the old plan's tokens; this is about half as long, so about half as long to write.
 *
 * Models leave fields out (a thing's length, its tags) rather than writing them empty, so after the
 * fields that every entry has, the rest are read by what they look like: a number is a length, a
 * sentence a description, words that are states (lit, hanging, asleep) states, other words tags.
 *
 * The sections arrive in order while the model streams, so a caller can lay the building out from
 * the rooms before the things have arrived (partialPlan).
 */

/** An entry: its fields, in order. (A string with the fields between bars is read too.) */
export type Entry = string[] | string;

export interface CompactPlan {
  place: Entry;
  outside: Entry[];
  rooms: Entry[];
  doors: Entry[];
  windows: Entry[];
  things: Entry[];
  people: Entry[];
  start: string;
}

const SIZES: Size[] = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
const MATERIALS: Material[] = ["cloth", "paper", "rope", "glass", "ice", "crystal", "wood", "bone", "leather", "stone", "iron", "steel", "brass", "silver", "flesh", "liquid"];
/** Words that are a thing's state, not what it's for (anything else in its words is a tag). */
const STATE_WORDS = new Set(["lit", "unlit", "hanging", "open", "closed", "shut", "locked", "barred", "bolted", "asleep", "sleeping", "snoring", "burning", "smouldering", "broken", "wet", "slick", "dead", "hidden", "overturned", "empty", "full", "spilled", "scorched", "frozen", "drunk", "stuck", "rotten", "bloodied", "oiled", "dusty", "damaged", "steaming", "simmering", "boiling", "leaking", "creaking", "swinging", "stacked", "piled"]);

const entries = (description: string) => ({ type: "array", items: { type: "array", items: { type: "string" } }, description });

export const COMPACT_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["place", "outside", "rooms", "doors", "windows", "things", "people", "start"],
  properties: {
    place: { type: "array", items: { type: "string" }, description: "name, what it's like, width x depth in feet, storeys, walls, floor, around" },
    outside: entries("id, name, side, depth in feet, ground"),
    rooms: entries("id, name, where, width x depth in feet, floor"),
    doors: entries("id, name, from > to, wall, state"),
    windows: entries("room, wall, count"),
    things: entries("id, name, kind size material, in, where, then if any: length, tags, states, description"),
    people: entries("id, name, in, where, what they're doing"),
    start: { type: "string", description: "The room or outside area the player starts in." },
  },
};

export const COMPACT_INSTRUCTIONS = [
  "You plan places for a comic fantasy RPG (Pratchett, Monty Python) played on an isometric tile map of 5-ft squares. A game master has described a place; you write its plan, and a program builds the map from it. You never draw it.",
  "Every entry is a list of its fields, in the order given. Ids are lowercase-with-hyphens and unique across everything; every reference is an id.",
  "- place: [name, what it's like in a sentence, width x depth in feet with the outside walls, storeys, walls, floor, around]. Most buildings are 30x25 to 80x60 feet. walls: stone, brick, timber, tarred-timber, plaster, earth-bank (dug into a bank), fine-stone. floor: boards, flagstones, earth, carpet, tiles. around, what's on the sides with no outside area: open, buildings, earth-bank or water.",
  "- outside: [id, name, side, depth in feet, ground]: the street, quay, yard, landing or river beside the building, nearest first on each side. ground: cobbles, boards, planks-over-water (a walk on piles), dirt, grass, steps, water, boat (a moored boat, after its water on the same side; its depth is its beam). The street door opens onto one of them; the program joins them up round the building.",
  "- rooms: [id, name, where, width x depth in feet, floor], the ground floor only. where: main for exactly one (the biggest, usually where the street door opens; it takes what the others leave, so give it no size), else the side or corner it's on: north, east, south, west, north-east, south-east, south-west, north-west (at least 15x15 feet). Leave floor off for the building's. Part of a room (a fireside, the bar) isn't a room.",
  "- doors: [id, name, from > to, wall, state]. Every room needs one, and a door joins a room to the room or outside area on the other side of its wall: a room and the outside on that room's side of the building, or two rooms side by side. wall: for a door to outside, the building's side it's on; between rooms, the side of the from room, or \"\". state: open, closed, locked, barred or bolted.",
  "- windows: [room, wall, count], on the room's outside walls.",
  "- things: [id, name, kind size material, in, where, then only if it has them: length, tags, states, description]: the furniture, fixtures and notable things, 6 to 20, each name with its article. kind: feature (built in: a hearth, a bar, a sign), object (furniture, big movables), item (small things), creature (an animal), crowd (a group of people: the regulars). size: tiny, small, medium, large, huge, gargantuan (a mug, a chair, a table, a cart, a stack of sacks, a river). material: cloth, paper, rope, glass, wood, bone, leather, stone, iron, steel, brass, silver, flesh, liquid. in: a room or outside area. where: against north (a wall), corner north-east, centre, near bar, beside bar, behind bar, between bar front-door, by-door front-door, on bar, in desk, under table, overhead (hung from the beams); a thing it's on, in, near or beside must be in the plan. length: squares along a bar, counter, shelves, pews or workbench (3 to 6). tags: furniture cover container light fire hearth sign water evidence. states: lit hanging open closed locked asleep. description: a short sentence.",
  "- people: [id, name, in, where, what they're doing]: the named people the description puts here, placed like things. A crowd is a thing.",
  "- start: the room or outside area the player starts in, by its door.",
  "Example entries: [\"taproom\", \"the taproom\", \"main\"], [\"front-door\", \"the door\", \"taproom > landing\", \"south\", \"closed\"], [\"bar\", \"the skiff-hull bar\", \"feature large wood\", \"taproom\", \"against north\", \"4\", \"furniture cover\", \"An upturned skiff for a counter.\"], [\"gin-jar\", \"a jar of gin with a drowned rat in it\", \"item small glass\", \"taproom\", \"on bar\"], [\"traps\", \"eel traps\", \"object medium rope\", \"taproom\", \"overhead\", \"hanging\"], [\"nan\", \"Nan Quill\", \"taproom\", \"behind bar\", \"wiping a tankard, cudgel to hand\"].",
].join("\n");

// ---------------------------------------------------------------------------------------------
// Reading it.

const fields = (entry: unknown): string[] => (Array.isArray(entry) ? entry.map(x => String(x ?? "").trim()) : String(entry ?? "").split("|").map(s => s.trim()));
const words = (s: string | undefined) => (s ?? "").toLowerCase().split(/[\s,;]+/).filter(Boolean);
const feet = (s: string | undefined): [number, number] => {
  const ns = (s ?? "").match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
  return [ns[0] ?? 0, ns[1] ?? ns[0] ?? 0];
};
const oneOf = <T extends string>(values: readonly T[], s: string | undefined): T | undefined => {
  const w = (s ?? "").toLowerCase().trim();
  return (values as readonly string[]).includes(w) ? w as T : undefined;
};
/** A sentence, not a few words: a description or what someone's doing. */
const sentence = (s: string) => s.split(/\s+/).length >= 5 || /[.!?]$/.test(s) || /^[A-Z][a-z]+ [a-z]/.test(s) && s.split(/\s+/).length >= 3;

export function readPlace(c: Partial<CompactPlan>): PlacePlan {
  const p = fields(c.place);
  const [width, depth] = feet(p[2]);
  const areas = new Set([...(c.outside ?? []), ...(c.rooms ?? [])].map(e => fields(e)[0] ?? ""));
  return {
    name: p[0] ?? "", description: p[1] ?? "", width, depth, storeys: Number(p[3]) || 1,
    walls: oneOf(WALLS, p[4]) ?? (p[4] as PlacePlan["walls"]), floor: oneOf(FLOORS, p[5]) ?? (p[5] as PlacePlan["floor"]), surroundings: oneOf(SURROUNDINGS, p[6]) ?? (p[6] as PlacePlan["surroundings"]),
    outside: (c.outside ?? []).map(readOutside),
    rooms: (c.rooms ?? []).map(readRoom),
    doors: (c.doors ?? []).map(readDoor),
    windows: (c.windows ?? []).map(readWindow),
    things: (c.things ?? []).map(e => readThing(e, areas)),
    people: (c.people ?? []).map(readPerson),
    start: String(c.start ?? ""),
  };
}

function readOutside(entry: Entry): OutsidePlan {
  const f = fields(entry);
  return { id: f[0] ?? "", name: f[1] ?? f[0] ?? "", description: "", side: (oneOf(SIDES, f[2]) ?? f[2]) as OutsidePlan["side"], depth: feet(f[3])[0], ground: (oneOf(GROUNDS, f[4]) ?? f[4]) as OutsidePlan["ground"] };
}

function readRoom(entry: Entry): RoomPlan {
  const f = fields(entry);
  const [width, depth] = feet(f[3]);
  const where = (f[2] ?? "").toLowerCase().replace(/\s+/g, "-");
  return { id: f[0] ?? "", name: f[1] ?? f[0] ?? "", description: "", where: where as RoomPlan["where"], width, depth, floor: (oneOf(FLOORS, f[4]) ?? "same") as RoomPlan["floor"] };
}

function readDoor(entry: Entry): DoorPlan {
  const f = fields(entry);
  const [from, to] = (f[2] ?? "").split(/\s*(?:>|->|→|\bto\b)\s*/).map(s => s.trim());
  const states = f.slice(3).flatMap(words).filter(w => (DOOR_STATES as readonly string[]).includes(w)) as DoorPlan["states"];
  const wall = f.slice(3).map(x => oneOf(SIDES, x)).find(Boolean);
  return { id: f[0] ?? "", name: f[1] ?? f[0] ?? "", description: "", from: from ?? "", to: to ?? "", wall: (wall ?? "any") as DoorPlan["wall"], states };
}

function readWindow(entry: Entry): WindowPlan {
  const f = fields(entry);
  return { room: f[0] ?? "", wall: (oneOf(SIDES, f[1]) ?? f[1]) as WindowPlan["wall"], count: Number(f[2]) || 1 };
}

/** What other words for a relation mean. */
const NEAR_RELATION: Record<string, string> = {
  center: "centre", middle: "centre", next: "beside", close: "near", by: "near", at: "near", along: "against", hung: "overhead", hanging: "overhead",
  above: "overhead", ceiling: "overhead", inside: "in", within: "in", atop: "on", upon: "on", beneath: "under", below: "under", "by-the-door": "by-door", door: "by-door",
};

/** "against north", "corner north-east", "near bar", "between bar front-door", "overhead". */
function readWhere(s: string | undefined): Pick<ThingPlan, "relation" | "wall" | "corner" | "target" | "target2"> {
  const w = (s ?? "").trim().split(/\s+/).filter(Boolean);
  let relation = (w[0] ?? "centre").toLowerCase();
  let args = w.slice(1);
  if (relation === "by" && args[0]?.toLowerCase() === "door") { relation = "by-door"; args = args.slice(1); }
  if ((relation === "next" || relation === "close") && args[0]?.toLowerCase() === "to") args = args.slice(1);
  if (relation === "in" && args[0]?.toLowerCase() === "corner") { relation = "corner"; args = args.slice(1); }
  relation = NEAR_RELATION[relation] ?? relation;
  const out = { relation: (oneOf(RELATIONS, relation) ?? relation) as ThingPlan["relation"], wall: "none" as ThingPlan["wall"], corner: "none" as ThingPlan["corner"], target: "", target2: "" };
  const a = args.map(x => x.replace(/^the-?/, "")).filter(x => !/^(the|a|an|and|of)$/i.test(x));
  if (out.relation === "against") out.wall = (oneOf(SIDES, a[0]) ?? "none") as ThingPlan["wall"];
  else if (out.relation === "corner") out.corner = (oneOf(CORNERS, a.join("-")) ?? oneOf(CORNERS, a[0]) ?? "none") as ThingPlan["corner"];
  else { out.target = a[0] ?? ""; out.target2 = a[1] ?? ""; }
  return out;
}

const looksLikeWhat = (s: string | undefined) => words(s).some(w => (THING_KINDS as readonly string[]).includes(w) || (SIZES as string[]).includes(w) || (MATERIALS as string[]).includes(w));
const looksLikeWhere = (s: string | undefined) => { const w = words(s)[0] ?? ""; return (RELATIONS as readonly string[]).includes(w) || w in NEAR_RELATION; };

function readThing(entry: Entry, areas: Set<string>): ThingPlan {
  let f = fields(entry);
  // Its kind, size and material left out: the room is where they'd be.
  if (!looksLikeWhat(f[2]) && (areas.has(f[2] ?? "") || looksLikeWhere(f[3]))) f = [f[0]!, f[1] ?? "", "", ...f.slice(2)];
  const what = words(f[2]);
  // After the five every thing has: a number is its length, a sentence its description, other words its tags and states.
  let tiles = 1;
  const tags: string[] = [], states: string[] = [], said: string[] = [];
  for (const x of f.slice(5)) {
    if (!x) continue;
    if (/^\d+(\s*(squares?|tiles?|long))?$/i.test(x)) { tiles = Number.parseInt(x, 10); continue; }
    if (said.length || sentence(x)) { said.push(x); continue; }
    for (const w of words(x)) (STATE_WORDS.has(w) ? states : tags).push(w);
  }
  return {
    id: f[0] ?? "", name: f[1] ?? f[0] ?? "",
    kind: (THING_KINDS.find(k => what.includes(k)) ?? "object") as ThingPlan["kind"],
    size: SIZES.find(s => what.includes(s)) ?? "medium",
    material: MATERIALS.find(m => what.includes(m)) ?? "wood",
    in: f[3] ?? "",
    ...readWhere(f[4]),
    tiles, tags, states, description: said.join(" "),
  };
}

function readPerson(entry: Entry): PersonPlan {
  const f = fields(entry);
  const where = readWhere(f[3]);
  return { id: f[0] ?? "", name: f[1] ?? f[0] ?? "", in: f[2] ?? "", relation: where.relation, target: where.target, note: f.slice(4).filter(Boolean).join(" ") };
}

// ---------------------------------------------------------------------------------------------
// Writing it (a repair round sends the model its plan as the compiler understood it).

const trim = (...fs: Array<string | number | undefined>) => {
  const out = fs.map(x => (x === undefined ? "" : String(x)));
  while (out.length && !out.at(-1)) out.pop();
  return out;
};

function whereOf(t: Pick<ThingPlan, "relation" | "wall" | "corner" | "target" | "target2">): string {
  switch (t.relation) {
    case "against": return t.wall !== "none" ? `against ${t.wall}` : "against";
    case "corner": return t.corner !== "none" ? `corner ${t.corner}` : "corner";
    case "centre": case "overhead": return t.relation;
    case "between": return `between ${t.target} ${t.target2}`.trim();
    default: return `${t.relation} ${t.target}`.trim();
  }
}

export function writePlace(plan: PlacePlan): CompactPlan {
  return {
    place: trim(plan.name, plan.description, `${Math.round(plan.width)}x${Math.round(plan.depth)}`, plan.storeys, plan.walls, plan.floor, plan.surroundings),
    outside: plan.outside.map(o => trim(o.id, o.name, o.side, Math.round(o.depth), o.ground)),
    rooms: plan.rooms.map(r => (r.where === "main" ? trim(r.id, r.name, "main", "", r.floor === "same" ? "" : r.floor) : trim(r.id, r.name, r.where, `${Math.round(r.width)}x${Math.round(r.depth)}`, r.floor === "same" ? "" : r.floor))),
    doors: plan.doors.map(d => trim(d.id, d.name, `${d.from} > ${d.to}`, d.wall === "any" ? "" : d.wall, d.states.join(" "))),
    windows: plan.windows.map(w => trim(w.room, w.wall, w.count)),
    things: plan.things.map(t => [...trim(t.id, t.name, `${t.kind} ${t.size} ${t.material}`, t.in, whereOf(t)), ...(t.tiles > 1 ? [String(t.tiles)] : []), ...(t.tags.length ? [t.tags.join(" ")] : []), ...(t.states.length ? [t.states.join(" ")] : []), ...(t.description ? [t.description] : [])]),
    people: plan.people.map(p => trim(p.id, p.name, p.in, whereOf({ relation: p.relation, wall: "none", corner: "none", target: p.target, target2: "" }), p.note)),
    start: plan.start,
  };
}

// ---------------------------------------------------------------------------------------------
// Reading it while it streams.

export type Stage = "structure" | "things" | "people";

/**
 * What has arrived of a streaming plan: the sections that are complete. "structure" when the things
 * have begun (the building, the outside, the rooms, the doors and the windows are all there),
 * "things" when the people have begun.
 */
export function partialPlan(text: string): { stage: Stage; plan: Partial<CompactPlan> } | undefined {
  for (const [key, stage] of [["people", "things"], ["things", "structure"]] as const) {
    const m = new RegExp(`,\\s*"${key}"\\s*:`).exec(text);
    if (!m) continue;
    try { return { stage, plan: JSON.parse(`${text.slice(0, m.index)}}`) as Partial<CompactPlan> }; } catch { /* not yet */ }
  }
  return undefined;
}
