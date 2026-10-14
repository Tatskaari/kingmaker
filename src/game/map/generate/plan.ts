import { respondJson, type Effort, type RespondResult } from "../../../llm/openrouter.ts";
import type { Material, Size } from "../../../world/scene-world.ts";

/**
 * The semantic plan of a place: what a model writes instead of a grid. Models draw character grids
 * badly (rows drift, walls gap, doors land oddly), so the model says what the place is (a footprint
 * in feet, rooms by side and size, doors and windows by wall, furniture by relation, in the scene
 * world's vocabulary) and a deterministic compiler (compile.ts) lays it out on 5-ft tiles.
 *
 * Directions are the model's compass. The compiler turns the plan to face the camera (the viewer
 * stands to the south-west), so the street ends up in front of the building; the model doesn't
 * need to know about the camera.
 */

export const SIDES = ["north", "east", "south", "west"] as const;
export const CORNERS = ["north-east", "south-east", "south-west", "north-west"] as const;
export type Side = typeof SIDES[number];
export type Corner = typeof CORNERS[number];

export const WALLS = ["stone", "brick", "timber", "tarred-timber", "plaster", "earth-bank", "fine-stone"] as const;
export const FLOORS = ["boards", "flagstones", "earth", "carpet", "tiles"] as const;
export const GROUNDS = ["cobbles", "boards", "planks-over-water", "dirt", "grass", "steps", "water", "boat"] as const;
export const SURROUNDINGS = ["open", "buildings", "earth-bank", "water"] as const;
export const RELATIONS = ["against", "corner", "centre", "near", "beside", "behind", "between", "by-door", "on", "in", "under", "overhead"] as const;
export const THING_KINDS = ["feature", "object", "item", "creature", "crowd"] as const;
export const DOOR_STATES = ["open", "closed", "locked", "barred", "bolted"] as const;
const SIZES: Size[] = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
const MATERIALS: Material[] = ["cloth", "paper", "rope", "glass", "ice", "crystal", "wood", "bone", "leather", "stone", "iron", "steel", "brass", "silver", "flesh", "liquid"];

export type WallKind = typeof WALLS[number];
export type FloorKind = typeof FLOORS[number];
export type Ground = typeof GROUNDS[number];
export type Surroundings = typeof SURROUNDINGS[number];
export type Relation = typeof RELATIONS[number];
export type DoorState = typeof DOOR_STATES[number];

export interface RoomPlan {
  id: string;
  name: string;
  description: string;
  /** "main" takes the space the others leave; the others sit on a side or in a corner of the building. */
  where: "main" | Side | Corner;
  /** Feet, west to east and north to south (inside). Ignored for the main room. */
  width: number;
  depth: number;
  floor: FloorKind | "same";
}

export interface OutsidePlan {
  id: string;
  name: string;
  description: string;
  side: Side;
  /** Feet out from the building (or, for a boat, its beam). */
  depth: number;
  ground: Ground;
}

export interface DoorPlan {
  id: string;
  name: string;
  description: string;
  /** Rooms or outside areas: a door joins the two through the wall between them. */
  from: string;
  to: string;
  /** For a door to outside: the side of the building. Between rooms: the side of `from` it's on. */
  wall: Side | "any";
  states: DoorState[];
}

export interface WindowPlan { room: string; wall: Side; count: number }

export interface ThingPlan {
  id: string;
  name: string;
  kind: typeof THING_KINDS[number];
  size: Size;
  material: Material;
  tags: string[];
  states: string[];
  description: string;
  /** The room or outside area it's in. */
  in: string;
  relation: Relation;
  /** For against (and corner, as one of its two walls): which wall. */
  wall: Side | "none";
  corner: Corner | "none";
  /** For near, beside, behind, by-door, on, in, under: what it's placed by; between: one end. */
  target: string;
  /** For between: the other end. */
  target2: string;
  /** Squares it covers along its length: a bar, a counter, shelves, pews. 1 for most things. */
  tiles: number;
}

export interface PersonPlan {
  id: string;
  name: string;
  in: string;
  relation: Relation;
  target: string;
  /** Where they are and what they're doing ("behind the bar, within reach of Manners"). */
  note: string;
}

export interface PlacePlan {
  name: string;
  description: string;
  /** Feet, outside walls included: west to east, north to south. */
  width: number;
  depth: number;
  storeys: number;
  walls: WallKind;
  floor: FloorKind;
  surroundings: Surroundings;
  outside: OutsidePlan[];
  rooms: RoomPlan[];
  doors: DoorPlan[];
  windows: WindowPlan[];
  things: ThingPlan[];
  people: PersonPlan[];
  /** The room or outside area the player starts in (by the entrance). */
  start: string;
}

// ---------------------------------------------------------------------------------------------
// The model.

const str = (description?: string) => ({ type: "string", ...(description ? { description } : {}) });
const num = (description: string) => ({ type: "number", description });
const oneOf = (values: readonly string[], description?: string) => ({ type: "string", enum: [...values], ...(description ? { description } : {}) });
const list = (items: Record<string, unknown>, description?: string) => ({ type: "array", items, ...(description ? { description } : {}) });
const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });

export const PLAN_SCHEMA = object({
  name: str("The place's name, as people say it (The Drowned Rat)."),
  description: str("One or two sentences: what it's like."),
  width: num("Feet, west to east, outside walls included (most buildings 25 to 80)."),
  depth: num("Feet, north to south, outside walls included."),
  storeys: num("1 to 3. Only the ground floor is mapped."),
  walls: oneOf(WALLS, "What the outside walls are (and the roof's look): earth-bank for a place dug into a bank."),
  floor: oneOf(FLOORS, "The main floor."),
  surroundings: oneOf(SURROUNDINGS, "What's on the sides with no outside area: open ground, neighbouring buildings, an earth bank, water."),
  outside: list(object({
    id: str(), name: str(), description: str(),
    side: oneOf(SIDES),
    depth: num("Feet out from the building, 5 to 30 (a boat: its beam, 10 to 20)."),
    ground: oneOf(GROUNDS, "planks-over-water: a walk on piles; water: a river or harbour; boat: a moored boat, in the water on its side, listed after the water."),
  }), "The street, quay, yard, landing, river beside the building, nearest the building first on each side."),
  rooms: list(object({
    id: str(), name: str(), description: str(),
    where: oneOf(["main", ...SIDES, ...CORNERS], "main: the biggest room, which takes the space the others leave (exactly one). The others: the side or corner of the building they're on."),
    width: num("Feet west to east, at least 15 (ignored for the main room)."),
    depth: num("Feet north to south, at least 15 (ignored for the main room)."),
    floor: oneOf([...FLOORS, "same"]),
  }), "Ground-floor rooms only; upstairs isn't mapped (a stair up is a thing)."),
  doors: list(object({
    id: str(), name: str(), description: str(),
    from: str("A room id."), to: str("A room or outside area id: the room on the other side of the wall, or the outside the door opens onto."),
    wall: oneOf([...SIDES, "any"], "For a door to outside, the building's side it's on (the side that outside area is on). Between rooms, the side of the from room, or any."),
    states: list(oneOf(DOOR_STATES)),
  }), "Every room needs one. A door can only join things that touch: a room and the outside on the room's side of the building, or two rooms next to each other."),
  windows: list(object({ room: str(), wall: oneOf(SIDES, "An outside wall of that room."), count: num("1 to 4.") })),
  things: list(object({
    id: str(), name: str("With its article: the skiff-hull bar, a lantern hung from the beams."),
    kind: oneOf(THING_KINDS, "feature: built in (a hearth, a bar, a sign, a hatch); object: furniture and big movables; item: small things; creature: an animal; crowd: a group of people (the regulars)."),
    size: oneOf(SIZES), material: oneOf(MATERIALS),
    tags: list(str(), "furniture, cover, container, light, fire, hearth, sign, water, evidence, weapon, liquid..."),
    states: list(str(), "lit, hanging, open, closed, locked, asleep, slick..."),
    description: str("One short sentence, or empty."),
    in: str("The room or outside area id."),
    relation: oneOf(RELATIONS, "against: a wall (wall); corner: a corner (corner); centre: the middle; near / beside / behind / by-door: a thing or door (target); between: two things or doors (target, target2); on / in / under: another thing (target), not on the floor; overhead: hung from the ceiling."),
    wall: oneOf([...SIDES, "none"]), corner: oneOf([...CORNERS, "none"]),
    target: str("A thing, door or person id, or empty."), target2: str("For between, or empty."),
    tiles: num("Squares (5 ft) along its length: 3 to 6 for a bar, counter, shelves, pews, a workbench; 1 for everything else."),
  }), "Furniture, fixtures and notable things, 6 to 20, placed by relation."),
  people: list(object({
    id: str(), name: str(), in: str("Room or outside area id."), relation: oneOf(RELATIONS), target: str("A thing id, or empty."), note: str(),
  }), "Named people the description puts here, placed like things. Crowds are things."),
  start: str("The room or outside area the player starts in, by its door."),
});

export const PLAN_INSTRUCTIONS = [
  "You plan places for a comic fantasy RPG (Pratchett, Monty Python) played on an isometric tile map of 5-ft squares. A game master has described a place. You write its plan; a program lays it out and builds the map from the plan. You never draw it.",
  "The plan:",
  "- The building: its outside size in feet, storeys, what its walls are and its main floor.",
  "- Rooms on the ground floor. Exactly one is \"main\": usually the biggest, usually where the street door opens; it takes whatever space the others leave, so keep it at least half the building. Each other room is on a side or in a corner of the building, with its size in feet (15 ft each way at least). Don't make a room of something that's part of a room (a fireside, the bar, a corner): that's an area of furniture, not a room.",
  "- Outside: what's beside the building (the street, a quay, a yard, a landing, the river), each on a side, nearest first. The street door opens onto one of them. A moored boat is a separate outside area (ground boat) after its water, on the same side.",
  "- Doors: every room needs a way in, and every door joins two things that touch: a room and the outside on that room's side of the building, or two rooms side by side. So a room with a door to the street must be on the street's side of the building.",
  "- Windows, by room and outside wall.",
  "- Things: the furniture, fixtures and notable items (6 to 20), each placed by relation: against a wall (the bar along the north wall); in a corner (the fire in the north-east corner); centre; near, beside or behind another thing (stools near the bar, the keg beside the bar, the shelf behind the bar); between two things (tables between the bar and the door; a door id works as a target); by-door (just inside a door); on, in or under another thing (cards on the table, a ledger in the desk); overhead (eel traps hung from the beams). Long fixtures (a bar, a counter, shelves, pews, a workbench) give their length in squares.",
  "- People the description puts here, placed the same way. A crowd (the regulars, the gang) is a thing of kind crowd.",
  "Ids are lowercase-with-hyphens and unique across rooms, outside areas, doors, things and people; every reference must be one of them. Use the scene world's words: sizes tiny, small, medium, large, huge, gargantuan (a mug, a chair, a table, a cart, a stack of sacks, a river); tags such as furniture, cover, container, door, light, fire, hearth, sign, water, evidence; states such as lit, closed, locked, barred, hanging, open.",
].join("\n");

export interface PlanCall { plan: PlacePlan; meta: RespondResult }

export interface PlannerOptions { model?: string; effort?: Effort; signal?: AbortSignal }

/** A planner: the model by default; tests and offline runs pass their own. */
export type Planner = (request: { text: string; previous?: PlacePlan; problems?: string[] }) => Promise<PlanCall>;

/** The model writes a plan from a description; with a previous plan and problems, it repairs it. */
export function modelPlanner(options: PlannerOptions = {}): Planner {
  return async ({ text, previous, problems }) => {
    const input = previous && problems?.length
      ? [
        { role: "user" as const, content: `The place:\n${text}` },
        { role: "assistant" as const, content: JSON.stringify(previous) },
        { role: "user" as const, content: `The program laid out your plan and checked it. Fix these problems and return the whole plan again (keep what works):\n${problems.map(p => `- ${p}`).join("\n")}` },
      ]
      : [{ role: "user" as const, content: `The place:\n${text}` }];
    const result = await respondJson<PlacePlan>({
      operation: previous ? "map.plan.repair" : "map.plan",
      ...(options.model ? { model: options.model } : {}),
      effort: options.effort ?? "low",
      instructions: PLAN_INSTRUCTIONS,
      input,
      json: { name: "place_plan", schema: PLAN_SCHEMA },
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const { _meta, ...plan } = result;
    return { plan: plan as PlacePlan, meta: _meta };
  };
}
