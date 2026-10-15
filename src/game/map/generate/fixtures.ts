import type { DoorPlan, OutsidePlan, PersonPlan, PlacePlan, RoomPlan, ThingPlan } from "./plan.ts";

/**
 * Plans written by hand, in the shape the model writes them: for tests, and as examples of the
 * format. A tavern dug into a river bank (like the Rat), a warehouse on a wharf with a barge
 * (like the Heron), and a plan with the mistakes models make.
 */

const thing = (id: string, name: string, rest: Partial<ThingPlan>): ThingPlan => ({
  id, name, kind: "object", size: "medium", material: "wood", tags: [], states: [], description: "", in: "", relation: "centre",
  wall: "none", corner: "none", target: "", target2: "", tiles: 1, ...rest,
});
const room = (id: string, name: string, rest: Partial<RoomPlan>): RoomPlan => ({ id, name, description: "", where: "main", width: 0, depth: 0, floor: "same", ...rest });
const outside = (id: string, name: string, rest: Partial<OutsidePlan>): OutsidePlan => ({ id, name, description: "", side: "south", depth: 10, ground: "cobbles", ...rest });
const door = (id: string, name: string, rest: Partial<DoorPlan>): DoorPlan => ({ id, name, description: "", from: "", to: "", wall: "any", states: ["closed"], ...rest });
const person = (id: string, name: string, rest: Partial<PersonPlan>): PersonPlan => ({ id, name, in: "", relation: "near", target: "", note: "", ...rest });

/** One long low room in a river bank, a scullery behind, the landing and the river in front. */
export const TAVERN: PlacePlan = {
  name: "The Drowned Rat",
  description: "A dockside dive dug into the bank: one long, low, smoky room, a scullery at the back, and a single door onto the river stairs.",
  width: 55, depth: 40, storeys: 1, walls: "earth-bank", floor: "flagstones", surroundings: "earth-bank",
  outside: [
    outside("landing", "the landing on the river stairs", { side: "south", depth: 10, ground: "steps", description: "Wet green steps, and the landing halfway down them." }),
    outside("river", "the river", { side: "south", depth: 20, ground: "water", description: "High, fast, black and cold." }),
  ],
  rooms: [
    room("taproom", "the taproom", { description: "Tables, benches, eel traps overhead, and a great many big men with bandages." }),
    room("scullery", "the scullery", { where: "north-east", width: 15, depth: 15, floor: "flagstones", description: "Pots, steam and eel stew." }),
  ],
  doors: [
    door("front-door", "the door", { from: "taproom", to: "landing", wall: "south", states: ["closed"] }),
    door("scullery-door", "the scullery door", { from: "taproom", to: "scullery", states: ["open"] }),
  ],
  windows: [],
  things: [
    thing("bar", "the skiff-hull bar", { kind: "feature", size: "large", in: "taproom", relation: "against", wall: "north", tiles: 4, tags: ["furniture", "cover"], description: "An upturned skiff for a counter." }),
    thing("gin-jar", "the jar of gin with the drowned rat in it", { kind: "item", size: "small", material: "glass", in: "taproom", relation: "on", target: "bar" }),
    thing("fire", "the blue driftwood fire", { kind: "feature", size: "large", material: "stone", in: "taproom", relation: "corner", corner: "south-east", tags: ["fire", "hearth", "light"], states: ["lit"] }),
    thing("chair", "the champion's chair", { size: "medium", in: "taproom", relation: "beside", target: "fire", tags: ["furniture"] }),
    thing("card-table", "the card table by the fire", { size: "medium", in: "taproom", relation: "near", target: "fire", tags: ["furniture", "cover"] }),
    thing("cards", "a pack of cards", { kind: "item", size: "tiny", material: "paper", in: "taproom", relation: "on", target: "card-table" }),
    thing("long-table", "the long table", { size: "large", in: "taproom", relation: "between", target: "bar", target2: "front-door", tags: ["furniture"] }),
    thing("rules-board", "the rules board", { kind: "feature", size: "medium", in: "taproom", relation: "by-door", target: "front-door", tags: ["sign"] }),
    thing("eel-traps", "the eel traps and old oars", { size: "large", in: "taproom", relation: "overhead", tags: ["overhead"] }),
    thing("regulars", "the regulars", { kind: "crowd", size: "large", in: "taproom", relation: "near", target: "long-table" }),
    thing("pots", "the stew pots", { size: "medium", material: "iron", in: "scullery", relation: "against", wall: "east", tags: ["container"] }),
    thing("river", "the river", { kind: "feature", size: "gargantuan", material: "liquid", in: "river", relation: "centre", tags: ["water"] }),
  ],
  people: [
    person("nan-quill", "Nan Quill", { in: "taproom", relation: "behind", target: "bar", note: "behind the bar" }),
    person("hobb", "Big Hobb Mallory", { in: "taproom", relation: "near", target: "card-table", note: "back to the wall" }),
    person("cob", "Cob", { in: "scullery", relation: "near", target: "pots" }),
  ],
  start: "landing",
};

/** A tall tarred warehouse: the wharf on the west, a plank walk and the river to the south, a barge in it. */
export const WAREHOUSE: PlacePlan = {
  name: "The Heron",
  description: "A tall, tarred timber warehouse half on the wharf and half on piles over the river.",
  width: 60, depth: 50, storeys: 3, walls: "tarred-timber", floor: "boards", surroundings: "water",
  outside: [
    outside("wharf", "the wharf", { side: "west", depth: 25, ground: "boards", description: "The end of the wharf, where the lamps give out." }),
    outside("walk", "the plank walk", { side: "south", depth: 5, ground: "planks-over-water", description: "Slippery planks on the piles." }),
    outside("river", "the river", { side: "south", depth: 25, ground: "water" }),
    outside("barge", "the barge Patience", { side: "south", depth: 15, ground: "boat", description: "Broad and low, hatches open." }),
  ],
  rooms: [
    room("floor", "the re-sacking floor", { description: "One long floor lit by lanterns and thick with grain dust." }),
    room("counting-box", "the counting-box", { where: "north-east", width: 15, depth: 15, floor: "boards" }),
  ],
  doors: [
    door("land-door", "the land door", { from: "floor", to: "wharf", wall: "west", states: ["closed", "barred"] }),
    door("river-door", "the river door", { from: "floor", to: "walk", wall: "south", states: ["closed", "bolted"] }),
    door("box-door", "the counting-box door", { from: "floor", to: "counting-box", states: ["open"] }),
  ],
  windows: [{ room: "counting-box", wall: "north", count: 1 }],
  things: [
    thing("wheat-sacks", "the palace's wheat-ear sacks", { size: "huge", material: "cloth", in: "floor", relation: "against", wall: "north", tags: ["evidence", "cover"] }),
    thing("heron-sacks", "the heron sacks", { size: "huge", material: "cloth", in: "floor", relation: "against", wall: "south", tags: ["cover"] }),
    thing("trestles", "the trestles", { size: "large", in: "floor", relation: "between", target: "wheat-sacks", target2: "heron-sacks", tags: ["furniture", "cover"] }),
    thing("brazier", "a brazier for cold hands", { size: "medium", material: "iron", in: "floor", relation: "near", target: "land-door", tags: ["fire", "light"], states: ["lit"] }),
    thing("lantern", "a lantern hung from the beams", { size: "small", material: "iron", in: "floor", relation: "overhead", tags: ["light"], states: ["lit"] }),
    thing("chute", "the chute", { kind: "feature", size: "large", in: "floor", relation: "by-door", target: "river-door" }),
    thing("desk", "the clerk's desk", { size: "medium", in: "counting-box", relation: "against", wall: "north", tags: ["furniture"] }),
    thing("true-book", "the Heron's true book", { kind: "item", size: "small", material: "leather", in: "counting-box", relation: "on", target: "desk", tags: ["evidence"] }),
    thing("sentry-box", "the watchman's sentry box", { size: "large", in: "wharf", relation: "near", target: "land-door" }),
    thing("hatches", "the Patience's open hatches", { kind: "feature", size: "large", in: "barge", relation: "centre", states: ["open"] }),
    thing("gang", "the re-sacking gang", { kind: "crowd", size: "large", in: "floor", relation: "near", target: "trestles" }),
  ],
  people: [
    person("scrope", "Mister Scrope", { in: "counting-box", relation: "beside", target: "desk" }),
    person("saul", "Saul Tench", { in: "wharf", relation: "beside", target: "sentry-box" }),
    person("hep", "Hep Grist", { in: "floor", relation: "near", target: "trestles" }),
  ],
  start: "wharf",
};

/**
 * The mistakes models make: two main rooms, a back room with a door to the street though it's on
 * the far side of the building, a thing on something that isn't there, references by name.
 */
export const MUDDLED: PlacePlan = {
  name: "The Muddle",
  description: "A shop that was planned in a hurry.",
  width: 40, depth: 40, storeys: 1, walls: "brick", floor: "boards", surroundings: "open",
  outside: [outside("street", "the street", { side: "south" })],
  rooms: [
    room("shop", "the shop", {}),
    room("workshop", "the workshop", {}),
    room("store", "the store", { where: "north", width: 20, depth: 10 }),
  ],
  doors: [
    door("street-door", "the street door", { from: "shop", to: "street", wall: "south" }),
    door("store-door", "the store's back door", { from: "store", to: "street", wall: "north" }),
  ],
  windows: [],
  things: [
    thing("counter", "the counter", { kind: "feature", size: "large", in: "the shop", relation: "against", wall: "north", tiles: 3 }),
    thing("till", "the till", { kind: "item", size: "small", in: "shop", relation: "on", target: "the cash desk" }),
  ],
  people: [],
  start: "street",
};

/** The muddle as a model would repair it: one main room, the store's door into the shop. */
export const MUDDLED_FIXED: PlacePlan = {
  ...MUDDLED,
  rooms: [room("shop", "the shop", {}), room("workshop", "the workshop", { where: "west", width: 15, depth: 20 }), room("store", "the store", { where: "north-east", width: 15, depth: 15 })],
  doors: [
    door("street-door", "the street door", { from: "shop", to: "street", wall: "south" }),
    door("store-door", "the store door", { from: "shop", to: "store" }),
    door("workshop-door", "the workshop door", { from: "shop", to: "workshop" }),
  ],
  things: [
    thing("counter", "the counter", { kind: "feature", size: "large", in: "shop", relation: "against", wall: "north", tiles: 3 }),
    thing("till", "the till", { kind: "item", size: "small", in: "shop", relation: "on", target: "counter" }),
  ],
};
