import { compilePlan, sketch, type PlacePlan } from "../../map/generate/index.ts";
import type { DoorPlan, OutsidePlan, PersonPlan, RoomPlan, ThingPlan } from "../../map/generate/plan.ts";
import { isStructure } from "../../map/tiles.ts";
import type { Tile2, TileMap } from "../../types.ts";
import type { Exhibit, Wing } from "../model.ts";

/**
 * Mother Tallow's chandlery: a place compiled from a plan written by hand (the shape the fast model
 * writes them in), with no model, by src/game/map/generate: the compiler lays it out on 5-ft tiles,
 * furnishes it, and the game uses it like a hand-drawn place. Reached from the Town Annexe.
 */

export const CHANDLERY_ID = "zoo-chandlery";
/** Where its way out lands in the annexe (wings/index.ts joins the two). */
export const ANNEXE_DOOR = { x: 48, y: 15 };

const thing = (id: string, name: string, rest: Partial<ThingPlan>): ThingPlan => ({
  id, name, kind: "object", size: "medium", material: "wood", tags: [], states: [], description: "", in: "", relation: "centre",
  wall: "none", corner: "none", target: "", target2: "", tiles: 1, ...rest,
});
const room = (id: string, name: string, rest: Partial<RoomPlan>): RoomPlan => ({ id, name, description: "", where: "main", width: 0, depth: 0, floor: "same", ...rest });
const outside = (id: string, name: string, rest: Partial<OutsidePlan>): OutsidePlan => ({ id, name, description: "", side: "south", depth: 10, ground: "cobbles", ...rest });
const door = (id: string, name: string, rest: Partial<DoorPlan>): DoorPlan => ({ id, name, description: "", from: "", to: "", wall: "any", states: ["closed"], ...rest });
const person = (id: string, name: string, rest: Partial<PersonPlan>): PersonPlan => ({ id, name, in: "", relation: "near", target: "", note: "", ...rest });

/** The plan, as the model would write it for "a chandler's shop on the wharves". */
export const CHANDLERY_PLAN: PlacePlan = {
  name: "Mother Tallow's chandlery",
  description: "A chandler's on the wharves: candles, rope, lamp oil and tar in a low brick shop, a store at the back that smells of all four, and the wharf in front.",
  width: 40, depth: 30, storeys: 1, walls: "brick", floor: "boards", surroundings: "buildings",
  outside: [outside("wharf", "the wharf in front", { side: "south", depth: 10, ground: "boards", description: "Wet boards, coiled rope, and the river beyond." })],
  rooms: [
    room("shop", "the shop", { description: "Candles in bundles from the beams, rope by the fathom, and a counter worn to a dip in the middle." }),
    room("store", "the store", { where: "north-east", width: 15, depth: 10, floor: "flagstones", description: "Barrels of lamp oil and tar, stacked to the ceiling." }),
  ],
  doors: [
    door("shop-door", "the shop door", { from: "shop", to: "wharf", wall: "south", states: ["open"] }),
    door("store-door", "the store door", { from: "shop", to: "store", states: ["closed", "locked"] }),
  ],
  windows: [{ room: "shop", wall: "south", count: 2 }],
  things: [
    thing("counter", "the counter", { kind: "feature", size: "large", in: "shop", relation: "against", wall: "north", tiles: 3, tags: ["furniture"], description: "Worn to a dip in the middle by a century of elbows." }),
    thing("candles", "bundles of candles hung from the beams", { size: "small", material: "wood", in: "shop", relation: "overhead", tags: ["light"] }),
    thing("rope", "coils of rope", { size: "medium", material: "rope", in: "shop", relation: "corner", corner: "north-west" }),
    thing("till", "the till", { kind: "item", size: "small", material: "iron", in: "shop", relation: "on", target: "counter", tags: ["container"] }),
    thing("lamp", "a lamp on the counter", { kind: "item", size: "small", material: "iron", in: "shop", relation: "on", target: "counter", tags: ["light"], states: ["lit"] }),
    thing("oil-barrels", "barrels of lamp oil", { size: "large", in: "store", relation: "against", wall: "north", tags: ["container", "oil"] }),
    thing("tar-barrels", "barrels of tar", { size: "large", in: "store", relation: "corner", corner: "north-east" }),
    thing("cat", "the shop cat", { kind: "creature", size: "tiny", material: "flesh", in: "shop", relation: "on", target: "counter" }),
    thing("bollard", "a bollard", { kind: "feature", size: "small", material: "iron", in: "wharf", relation: "near", target: "shop-door" }),
  ],
  people: [person("tallow", "Mother Tallow", { in: "shop", relation: "behind", target: "counter" })],
  start: "wharf",
};

export const CHANDLERY = compilePlan(CHANDLERY_PLAN, { id: CHANDLERY_ID, sceneId: CHANDLERY_ID, seed: 7, exitTo: { map: "zoo-annexe", at: ANNEXE_DOOR, label: "Back to the Town Annexe" } });

/** Free floor near a tile, nearest first, for the wing's signs: not built on, not a door or a way out, nothing standing there. */
function freeNear(map: TileMap, from: Tile2, taken: Tile2[]): Tile2 {
  const busy = new Set([...taken, ...CHANDLERY.def.decor.map(d => d.at), ...map.exits.map(e => e.at)].map(t => `${t.x},${t.y}`));
  for (const t of Object.values(CHANDLERY.world.things)) if (t.at) busy.add(`${Math.floor(t.at[0] / 5)},${Math.floor(t.at[1] / 5)}`);
  for (let d = 1; d < 12; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
    const p = { x: from.x + dx, y: from.y + dy };
    const tile = map.tiles[p.y]?.[p.x];
    if (!tile || tile.blocks || isStructure(tile) || tile.terrain === "door" || tile.terrain === "water" || tile.terrain === "deep-water" || tile.terrain === "void" || busy.has(`${p.x},${p.y}`)) continue;
    taken.push(p);
    return p;
  }
  throw new Error("The chandlery has no room for its signs");
}

const start = CHANDLERY.site.entrance?.outside ?? CHANDLERY.furnished.start;
const taken: Tile2[] = [start];
const signAt = freeNear(CHANDLERY.map, start, taken);
const planAt = freeNear(CHANDLERY.map, start, taken);
const checksAt = freeNear(CHANDLERY.map, start, taken);

const exhibits: Exhibit[] = [
  {
    id: "compiled", title: "A place compiled from a plan", sign: signAt, shows: ["Places from a description (map generation)"],
    text: "Mother Tallow's chandlery was laid out by the map compiler from a plan written by hand, in the very shape the fast model writes one for \"a chandler's shop on the wharves\": rooms by side and size, doors by wall, furniture by relation (the counter against the north wall, the lamp on the counter, Mother Tallow behind it). No model was asked; the compiler is deterministic, and the game can't tell its places from drawn ones. With the model, src/game/map/generate/bench.ts writes the plan too.",
    triggers: [
      { id: "read-plan", label: "Read the plan", at: planAt, station: { name: "the plan, pinned to a post", glyph: "▤", color: "#d8cfa8" },
        run: () => ({ text: `The plan: ${CHANDLERY_PLAN.name}, ${CHANDLERY_PLAN.width} by ${CHANDLERY_PLAN.depth} feet, ${CHANDLERY_PLAN.walls} walls; rooms ${CHANDLERY_PLAN.rooms.map(r => `${r.name} (${r.where})`).join(", ")}; doors ${CHANDLERY_PLAN.doors.map(d => `${d.name} (${d.from} to ${d.to}, ${d.states.join(" and ")})`).join(", ")}; ${CHANDLERY_PLAN.things.length} things placed by relation; ${CHANDLERY_PLAN.people.map(p => `${p.name} ${p.relation} the ${p.target}`).join(", ")}.` }) },
      { id: "read-sketch", label: "Read the compiler's sketch and notes", at: planAt,
        run: () => ({ text: `The compiler's top-down sketch, and what it fixed by itself: ${CHANDLERY.notes.length ? CHANDLERY.notes.join("; ") : "nothing needed fixing"}. ${sketch(CHANDLERY).split("\n").length} rows, ${CHANDLERY.map.width} squares wide.` }) },
    ],
  },
  {
    id: "compiled-checks", title: "The compiler's checks", sign: checksAt, shows: ["Places from a description (map generation)"],
    text: "Before a compiled place is used, validators check it as the game will draw it: every room reachable, every door on a wall between the two places it joins, nothing standing in a doorway, people on their feet and not in the furniture, the camera able to frame it. What's wrong goes back to the model (at most twice) with the problems listed; a hand-written plan like this one has to pass the same checks. Its tests are in src/game/map/generate/generate.test.ts.",
    triggers: [],
  },
];

export const chandlery: Wing = {
  id: CHANDLERY_ID,
  name: "Mother Tallow's chandlery",
  about: "A place compiled from a hand-written plan by the map compiler, with no model: the game uses it like a drawn one.",
  entry: start,
  via: "zoo-annexe",
  compiled: CHANDLERY,
  cast: Object.fromEntries(CHANDLERY.cast.map(c => [c.id, { name: c.name }])),
  map: { grid: "", legend: {}, regions: [] },
  world: CHANDLERY.world,
  exhibits,
};
