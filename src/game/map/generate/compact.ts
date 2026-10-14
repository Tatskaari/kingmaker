import type { Material, Size } from "../../../world/scene-world.ts";
import { CORNERS, DOOR_STATES, FLOORS, GROUNDS, RELATIONS, SIDES, SURROUNDINGS, THING_KINDS, WALLS, type DoorPlan, type OutsidePlan, type PersonPlan, type PlacePlan, type RoomPlan, type ThingPlan, type WindowPlan } from "./plan.ts";

/**
 * The plan, tersely: the same plan as plan.ts's, with every entry one line of fields between bars
 * ("bar | the skiff-hull bar | feature large wood | taproom | against north | 4"), in a strict JSON
 * object whose sections come in the order a place is built (the building, the outside, the rooms,
 * the doors, the windows, then the things and the people). Field names and empty fields were most of
 * the old plan's tokens; this is about half as long, so half as long to write.
 *
 * The sections arrive in order while the model streams, so a caller can lay the building out from
 * the rooms before the things have arrived (partialPlan).
 */

export interface CompactPlan {
  place: string;
  outside: string[];
  rooms: string[];
  doors: string[];
  windows: string[];
  things: string[];
  people: string[];
  start: string;
}

const SIZES: Size[] = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
const MATERIALS: Material[] = ["cloth", "paper", "rope", "glass", "ice", "crystal", "wood", "bone", "leather", "stone", "iron", "steel", "brass", "silver", "flesh", "liquid"];

const lines = (description: string) => ({ type: "array", items: { type: "string" }, description });

export const COMPACT_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["place", "outside", "rooms", "doors", "windows", "things", "people", "start"],
  properties: {
    place: { type: "string", description: "name | what it's like | width x depth in feet | storeys | walls | floor | around" },
    outside: lines("id | name | side | depth in feet | ground"),
    rooms: lines("id | name | where | width x depth in feet | floor"),
    doors: lines("id | name | from > to | wall | state"),
    windows: lines("room | wall | count"),
    things: lines("id | name | kind size material | in | where | length | tags | states | description"),
    people: lines("id | name | in | where | what they're doing"),
    start: { type: "string", description: "The room or outside area the player starts in." },
  },
};

export const COMPACT_INSTRUCTIONS = [
  "You plan places for a comic fantasy RPG (Pratchett, Monty Python) played on an isometric tile map of 5-ft squares. A game master has described a place; you write its plan, and a program builds the map from it. You never draw it.",
  "Every entry is one line of fields separated by \" | \", in the order given. Leave a field empty when it doesn't apply, and leave trailing empty fields off. Ids are lowercase-with-hyphens and unique across everything; every reference is an id.",
  "- place: \"name | what it's like, in a sentence | width x depth in feet, outside walls included | storeys | walls | floor | around\". Most buildings are 30x25 to 80x60. walls: stone, brick, timber, tarred-timber, plaster, earth-bank (dug into a bank), fine-stone. floor: boards, flagstones, earth, carpet, tiles. around, what's on the sides with no outside area: open, buildings, earth-bank, water.",
  "- outside: \"id | name | side | depth in feet | ground\": the street, quay, yard, landing or river beside the building, nearest first on each side. ground: cobbles, boards, planks-over-water (a walk on piles), dirt, grass, steps, water, boat (a moored boat, after its water on the same side; its depth is its beam). The street door opens onto one of them.",
  "- rooms: \"id | name | where | width x depth in feet | floor\", ground floor only. where: main for exactly one (the biggest, usually where the street door opens; it takes what the others leave, so no size), else the side or corner it's on: north, east, south, west, north-east, south-east, south-west, north-west (at least 15x15). floor empty: the building's. Part of a room (a fireside, the bar) isn't a room.",
  "- doors: \"id | name | from > to | wall | state\". Every room needs one. A door joins two things that touch: a room and the outside on the room's side of the building, or two rooms side by side. wall: for a door to outside, the building's side it's on; between rooms, the side of the from room, or empty. state: open, closed, locked, barred or bolted.",
  "- windows: \"room | wall | count\", on the room's outside walls.",
  "- things: \"id | name | kind size material | in | where | length | tags | states | description\": the furniture, fixtures and notable things, 6 to 20. name with its article. kind: feature (built in: a hearth, a bar, a sign), object (furniture, big movables), item (small things), creature (an animal), crowd (a group of people: the regulars). size: tiny, small, medium, large, huge, gargantuan (a mug, a chair, a table, a cart, a stack of sacks, a river). material: cloth, paper, rope, glass, wood, bone, leather, stone, iron, steel, brass, silver, flesh, liquid. in: a room or outside area. where: against north (a wall), corner north-east, centre, near bar, beside bar, behind bar, between bar front-door, by-door front-door, on bar, in desk, under table, overhead (hung from the beams). length: squares along a bar, counter, shelves, pews or workbench (3 to 6), else empty. tags and states: words with spaces between (tags: furniture cover container light fire hearth sign water evidence; states: lit hanging open closed locked asleep). description: a short sentence, or empty.",
  "- people: \"id | name | in | where | what they're doing\": the named people the description puts here, placed like things. A crowd is a thing.",
  "- start: the room or outside area the player starts in, by its door.",
  "Example of entries: \"taproom | the taproom | main\", \"front-door | the door | taproom > landing | south | closed\", \"bar | the skiff-hull bar | feature large wood | taproom | against north | 4 | furniture cover | | An upturned skiff for a counter.\", \"gin-jar | a jar of gin with a drowned rat in it | item small glass | taproom | on bar\", \"traps | eel traps | object medium rope | taproom | overhead\", \"nan | Nan Quill | taproom | behind bar | wiping a tankard, cudgel to hand\".",
].join("\n");

// ---------------------------------------------------------------------------------------------
// Reading it.

const fields = (line: unknown) => String(line ?? "").split("|").map(s => s.trim());
const words = (s: string | undefined) => (s ?? "").toLowerCase().split(/[\s,;]+/).filter(Boolean);
const feet = (s: string | undefined): [number, number] => {
  const ns = (s ?? "").match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
  return [ns[0] ?? 0, ns[1] ?? ns[0] ?? 0];
};
const oneOf = <T extends string>(values: readonly T[], s: string | undefined): T | undefined => {
  const w = (s ?? "").toLowerCase().trim();
  return (values as readonly string[]).includes(w) ? w as T : undefined;
};
/** The rest of a line, bars and all (a description with a bar in it). */
const rest = (f: string[], from: number) => f.slice(from).join(" | ").trim();

export function readPlace(c: Partial<CompactPlan>): PlacePlan {
  const p = fields(c.place);
  const [width, depth] = feet(p[2]);
  return {
    name: p[0] ?? "", description: p[1] ?? "", width, depth, storeys: Number(p[3]) || 1,
    walls: oneOf(WALLS, p[4]) ?? (p[4] as PlacePlan["walls"]), floor: oneOf(FLOORS, p[5]) ?? (p[5] as PlacePlan["floor"]), surroundings: oneOf(SURROUNDINGS, p[6]) ?? (p[6] as PlacePlan["surroundings"]),
    outside: (c.outside ?? []).map(readOutside),
    rooms: (c.rooms ?? []).map(readRoom),
    doors: (c.doors ?? []).map(readDoor),
    windows: (c.windows ?? []).map(readWindow),
    things: (c.things ?? []).map(readThing),
    people: (c.people ?? []).map(readPerson),
    start: String(c.start ?? ""),
  };
}

function readOutside(line: string): OutsidePlan {
  const f = fields(line);
  return { id: f[0] ?? "", name: f[1] ?? f[0] ?? "", description: "", side: (oneOf(SIDES, f[2]) ?? f[2]) as OutsidePlan["side"], depth: feet(f[3])[0], ground: (oneOf(GROUNDS, f[4]) ?? f[4]) as OutsidePlan["ground"] };
}

function readRoom(line: string): RoomPlan {
  const f = fields(line);
  const [width, depth] = feet(f[3]);
  const where = (f[2] ?? "").toLowerCase().replace(/\s+/g, "-");
  return { id: f[0] ?? "", name: f[1] ?? f[0] ?? "", description: "", where: where as RoomPlan["where"], width, depth, floor: (oneOf(FLOORS, f[4]) ?? "same") as RoomPlan["floor"] };
}

function readDoor(line: string): DoorPlan {
  const f = fields(line);
  const [from, to] = (f[2] ?? "").split(/\s*(?:>|->|→|\bto\b)\s*/).map(s => s.trim());
  const states = words(f[4]).filter(w => (DOOR_STATES as readonly string[]).includes(w)) as DoorPlan["states"];
  return { id: f[0] ?? "", name: f[1] ?? f[0] ?? "", description: "", from: from ?? "", to: to ?? "", wall: (oneOf(SIDES, f[3]) ?? "any") as DoorPlan["wall"], states };
}

function readWindow(line: string): WindowPlan {
  const f = fields(line);
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
  const a = args.map(x => x.replace(/^the-?/, ""));
  if (out.relation === "against") out.wall = (oneOf(SIDES, a[0]) ?? "none") as ThingPlan["wall"];
  else if (out.relation === "corner") out.corner = (oneOf(CORNERS, a.join("-")) ?? oneOf(CORNERS, a[0]) ?? "none") as ThingPlan["corner"];
  else { out.target = a[0] ?? ""; out.target2 = a[1] ?? ""; }
  return out;
}

function readThing(line: string): ThingPlan {
  const f = fields(line);
  const what = words(f[2]);
  return {
    id: f[0] ?? "", name: f[1] ?? f[0] ?? "",
    kind: (THING_KINDS.find(k => what.includes(k)) ?? "object") as ThingPlan["kind"],
    size: SIZES.find(s => what.includes(s)) ?? "medium",
    material: MATERIALS.find(m => what.includes(m)) ?? "wood",
    in: f[3] ?? "",
    ...readWhere(f[4]),
    tiles: Number(f[5]) || 1,
    tags: words(f[6]), states: words(f[7]),
    description: rest(f, 8),
  };
}

function readPerson(line: string): PersonPlan {
  const f = fields(line);
  const where = readWhere(f[3]);
  return { id: f[0] ?? "", name: f[1] ?? f[0] ?? "", in: f[2] ?? "", relation: where.relation, target: where.target, note: rest(f, 4) };
}

// ---------------------------------------------------------------------------------------------
// Writing it (a repair round sends the model its plan as the compiler understood it).

const bar = (...fs: Array<string | number | undefined>) => {
  const out = fs.map(x => (x === undefined ? "" : String(x)));
  while (out.length && !out.at(-1)) out.pop();
  return out.join(" | ");
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
    place: bar(plan.name, plan.description, `${Math.round(plan.width)}x${Math.round(plan.depth)}`, plan.storeys, plan.walls, plan.floor, plan.surroundings),
    outside: plan.outside.map(o => bar(o.id, o.name, o.side, Math.round(o.depth), o.ground)),
    rooms: plan.rooms.map(r => (r.where === "main" ? bar(r.id, r.name, "main", "", r.floor === "same" ? "" : r.floor) : bar(r.id, r.name, r.where, `${Math.round(r.width)}x${Math.round(r.depth)}`, r.floor === "same" ? "" : r.floor))),
    doors: plan.doors.map(d => bar(d.id, d.name, `${d.from} > ${d.to}`, d.wall === "any" ? "" : d.wall, d.states.join(" "))),
    windows: plan.windows.map(w => bar(w.room, w.wall, w.count)),
    things: plan.things.map(t => bar(t.id, t.name, `${t.kind} ${t.size} ${t.material}`, t.in, whereOf(t), t.tiles > 1 ? t.tiles : "", t.tags.join(" "), t.states.join(" "), t.description)),
    people: plan.people.map(p => bar(p.id, p.name, p.in, whereOf({ relation: p.relation, wall: "none", corner: "none", target: p.target, target2: "" }), p.note)),
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
