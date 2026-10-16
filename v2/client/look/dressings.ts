// Copied from the prototype's src/game/look/dressings.ts at 44c6d4a, whole, unchanged.
import type { Dressing } from "./stage.ts";

/**
 * Set dressing for the authored scene worlds (scenes/worlds/*.ts): what the floors are, where the
 * walls and windows run, where the water is. The worlds say what's in a place; these say what it's
 * built of. (On the map, the tile maps say this instead.)
 */

/** The Drowned Rat: a burrow in the bank, the river at the foot of the stairs, one smoky room. */
export const drownedRatDressing: Dressing = {
  ground: { stairs: "steps", doorway: "flags", bar: "boards", floor: "boards", fireside: "flags", scullery: "flags" },
  patches: [
    // The world's areas leave a strip between the bar and the floor: it's floor.
    { ground: "boards", rect: { x: 12, y: 19, w: 20, h: 4 }, ragged: 0 },
    { ground: "river", rect: { x: 33, y: -2, w: 17, h: 12 }, flow: { x: 0.9, y: 1.3 }, ragged: 0.5 },
    { ground: "grass", rect: { x: -2, y: -2, w: 20, h: 3 }, ragged: 0.6 },
    { surface: "water", circle: { x: 22, y: 7, r: 3 } },
    { surface: "slops", circle: { x: 44, y: 15, r: 2.5 } },
  ],
  walls: [
    { from: [0, 10], to: [47.5, 10], style: "bank" },
    { from: [0, 10], to: [0, 39.5], style: "bank" },
    { from: [47.5, 10], to: [47.5, 39.5], style: "bank" },
    { from: [0, 39.5], to: [47.5, 39.5], style: "bank" },
    { from: [32, 10], to: [32, 16], style: "timber" },
    { from: [37.5, 22], to: [47.5, 22], style: "timber" },
  ],
  indoor: ["doorway", "bar", "floor", "fireside", "scullery"],
  wind: { dir: 0.2, strength: 0.4 },
  hide: ["river", "river-steps"],
  haze: [{ area: "floor", kind: "smoke", density: 0.32 }, { area: "fireside", kind: "smoke", density: 0.26 }, { area: "bar", kind: "smoke", density: 0.2 }],
};

/** The yard behind the King's Granary: the lane and its elm, the yard's cobbles after rain, the loft. */
export const granaryYardDressing: Dressing = {
  ground: { lane: "cobbles", yard: "cobbles", loft: "loft" },
  patches: [
    { ground: "cobbles", rect: { x: 40, y: -1, w: 13, h: 9 } },
    { ground: "grass", rect: { x: -2, y: -2, w: 44, h: 3.2 }, ragged: 0.7 },
    { ground: "dirt", rect: { x: 2, y: 3, w: 30, h: 3 }, ragged: 0.8 },
    { surface: "water", circle: { x: 20, y: 28, r: 4.2 } },
    { surface: "water", circle: { x: 8, y: 19, r: 2.8 } },
    { surface: "water", circle: { x: 27, y: 35.5, r: 3.4 } },
    { surface: "water", circle: { x: 14, y: 33, r: 2.2 } },
    { surface: "water", circle: { x: 21, y: 4.5, r: 2.4 } },
    { surface: "mud", circle: { x: 5, y: 37, r: 2.6 } },
    { surface: "straw", circle: { x: 46, y: 34, r: 4 } },
  ],
  walls: [
    { from: [0, 8], to: [37, 8], style: "stone" },
    { from: [37, 8], to: [37, 39.5], style: "stone" },
    { from: [37, 8], to: [51.5, 8], style: "timber" },
    { from: [51.5, 8], to: [51.5, 39.5], style: "timber" },
    { from: [37, 39.5], to: [51.5, 39.5], style: "timber" },
  ],
  indoor: ["loft"],
  windows: [{ at: [44, 8], radius: 9, glass: false }],
  wind: { dir: 0.35, strength: 0.55 },
  hide: ["yard-wall", "granary-wall"],
};

/**
 * The Heron at the downriver end of the wharves: tarred timber walls round the long re-sacking floor
 * (its dust is the world's own: a dusty area hangs with it), the glass-sided counting-box in the
 * north-east corner, the wharf's boards, the plank walk on the piles, the barge Patience alongside,
 * and the river all round the south and east, running downriver. It lines up with the map
 * (src/game/map/maps/heron.ts), whose tile (2, 1) is the world's (0, 0).
 */
export const heronDressing: Dressing = {
  ground: { wharf: "boards", floor: "loft", "counting-box": "boards", "plank-walk": "boards", barge: "boards" },
  patches: [
    // The river down the east side, along the south, and at the wharf's end.
    { ground: "river", rect: { x: 90, y: -2, w: 17, h: 94 }, flow: { x: 1.4, y: 0.25 }, ragged: 0.3 },
    { ground: "river", rect: { x: -2, y: 65, w: 109, h: 27 }, flow: { x: 1.4, y: 0 }, ragged: 0.3 },
    { ground: "river", rect: { x: -2, y: 45, w: 27, h: 22 }, flow: { x: 1.4, y: 0 }, ragged: 0.4 },
    // The plank walk on the piles, round to the river door, and the barge's deck: over the water.
    { ground: "boards", rect: { x: 25, y: 45, w: 5, h: 25 }, ragged: 0 },
    { ground: "boards", rect: { x: 25, y: 65, w: 40, h: 5 }, ragged: 0 },
    { ground: "boards", rect: { x: 37, y: 72, w: 46, h: 11 }, ragged: 0 },
  ],
  walls: [
    { from: [32.5, 7.5], to: [87.5, 7.5], style: "timber" },
    { from: [32.5, 7.5], to: [32.5, 62.5], style: "timber" },
    { from: [87.5, 7.5], to: [87.5, 62.5], style: "timber" },
    { from: [32.5, 62.5], to: [87.5, 62.5], style: "timber" },
    // The counting-box: glass on the two sides that look down on the floor.
    { from: [67.5, 8], to: [67.5, 27.5], style: "glass" },
    { from: [67.5, 27.5], to: [87.5, 27.5], style: "glass" },
    // The Patience's hull.
    { from: [36, 71], to: [84, 71], style: "timber" },
    { from: [36, 84], to: [84, 84], style: "timber" },
    { from: [36, 71], to: [36, 84], style: "timber" },
    { from: [84, 71], to: [84, 84], style: "timber" },
  ],
  indoor: ["floor", "counting-box"],
  wind: { dir: 0.1, strength: 0.5 },
  hide: ["river"],
};

/** The King's dressing room and the long gallery, the morning of the Assembly: carpet, gilt, tall windows full of sun. */
export const kingsRoomDressing: Dressing = {
  ground: { gallery: "boards", "dressing-room": "carpet" },
  patches: [{ ground: "boards", rect: { x: 15, y: 0, w: 5, h: 50 }, ragged: 0 }],
  walls: [
    { from: [0, 0], to: [0, 49.5], style: "palace" },
    { from: [0, 0], to: [17.5, 0], style: "palace" },
    { from: [0, 49.5], to: [17.5, 49.5], style: "palace" },
    { from: [17.5, 0], to: [17.5, 49.5], style: "palace" },
    { from: [17.5, 5], to: [60, 5], style: "palace" },
    { from: [60, 5], to: [60, 35], style: "palace" },
    { from: [17.5, 35], to: [60, 35], style: "palace" },
  ],
  windows: [{ at: [31, 5], radius: 16 }, { at: [43, 5], radius: 16 }],
  indoor: ["gallery", "dressing-room"],
  hide: ["windows"],
};

/** The dressing for each scene's world, by scene id. */
export const DRESSINGS: Record<string, Dressing> = {
  "hanged-clerk": granaryYardDressing, "drowned-rat": drownedRatDressing, "heron-warehouse": heronDressing, "kings-morning": kingsRoomDressing,
};

/** A scene's dressing (a world nobody dressed is drawn with the stage's defaults: cobbles outside, boards in). */
export const dressingFor = (sceneId: string): Dressing => DRESSINGS[sceneId] ?? {};
