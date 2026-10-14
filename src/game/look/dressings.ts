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

/** The King's dressing room on the morning of the Assembly: carpet, panelling, tall windows full of sun. */
export const kingsRoomDressing: Dressing = {
  ground: { "gallery-door": "boards", dressing: "carpet", hearth: "boards", windows: "boards" },
  walls: [
    { from: [0, 0], to: [35.5, 0], style: "palace" },
    { from: [0, 0], to: [0, 27.5], style: "palace" },
    { from: [35.5, 0], to: [35.5, 27.5], style: "palace" },
    { from: [0, 27.5], to: [35.5, 27.5], style: "palace" },
  ],
  windows: [{ at: [19, 27.5], radius: 16 }, { at: [29, 27.5], radius: 16 }],
  indoor: ["gallery-door", "dressing", "hearth", "windows"],
  hide: ["windows-glass"],
};
