import { buildMap, T, type MapDef } from "../tiles.ts";

/**
 * The Drowned Rat, dug into the bank halfway down the river stairs, 5 ft to a tile. It lines up
 * with scenes/worlds/drowned-rat.ts: the world's (0, 0) feet is tile (2, 3), so the landing outside
 * is row 3 (the world's stairs area), the north wall and the door are row 4, the long low room is
 * rows 5-10 (doorway, the skiff-hull bar on row 6, the floor, the fireside in the east, the scullery
 * behind the bar) and the slop hatch opens through the east wall onto the river.
 *
 * The room has a turf roof (it's a burrow): from the landing it's a mound with a door in it; step
 * inside and the roof lifts.
 */

const GRID = `
,,,,,,,,,,,,,~ww
vvKKKKKKKKKKK~ww
vv_________vv~ww
vvs________vv~ww
K##+#########~ww
K#ffffffffffh~ww
K#ffuuuuufff#~ww
K#ffffffffff#~ww
K#ffffffffff#~ww
K#ffffffffff#~ww
K#ffffffffff#~ww
K############~ww
KKKKKKKKKKKKK~ww
`;

export const drownedRat: MapDef = buildMap({
  id: "drowned-rat",
  name: "The Drowned Rat",
  grid: GRID,
  legend: {
    ",": T("grass"), "~": T("water"), w: T("deep-water"), v: T("stairs"), _: T("floor", { style: "flags" }),
    s: T("floor", { style: "flags" }, { name: "a porter asleep on the steps", glyph: "z", color: "#9a9080", kind: "person", blocks: true, text: "A porter asleep on the steps, sleeping off the last Assembly, by the look of him." }),
    K: T("wall", { style: "bank", height: 2 }),
    "#": T("wall", { style: "timber", height: 2 }),
    "+": T("door", { style: "timber", height: 2 }),
    h: T("door", { style: "timber", height: 2, blocks: true }),
    f: T("floor", { style: "flags", roof: "bank", roofHeight: 2 }),
    u: T("fence", { style: "hull", height: 1 }),
  },
  regions: [
    { id: "drowned-rat", name: "the Drowned Rat", rect: { x: 2, y: 5, w: 10, h: 6 }, sceneId: "drowned-rat", worldOrigin: { x: 2, y: 3 }, trigger: "enter", label: "Step down into the Drowned Rat",
      shut: "The door is shut. A board nailed to it says: OPENS AT DUSK. NO CREDIT. NO WATCH. N. QUILL.",
      description: "One long, low, smoky room under a ceiling hung with eel traps and old oars, a blue driftwood fire in the corner, and a great many big men with a great many bandages." },
    { id: "rat-bar", name: "the skiff-hull bar", rect: { x: 4, y: 5, w: 5, h: 2 }, description: "An upturned skiff for a counter, and on the shelf behind it, in a jar of gin, the original drowned rat." },
    { id: "rat-fireside", name: "the fireside corner", rect: { x: 8, y: 7, w: 4, h: 4 }, description: "The blue driftwood fire, the champion's chair, an old bargewoman's card table and, back to the wall, the biggest man in the room." },
    { id: "rat-scullery", name: "the scullery", rect: { x: 9, y: 5, w: 3, h: 2 }, description: "Pots, steam and eel stew, permanently, and the slop hatch over the river." },
    { id: "rat-landing", name: "the landing on the river stairs", rect: { x: 2, y: 2, w: 10, h: 2 }, description: "A landing halfway down the river stairs, wet and green, the river slapping below. Three steps down to the Rat's door." },
  ],
  exits: [
    ...[{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }].map(at => ({ at, to: { map: "caerwyn", at: { x: 24, y: 34 } }, label: "Up the river stairs" })),
    ...[{ x: 12, y: 2 }, { x: 12, y: 3 }].map(at => ({ at, to: { map: "caerwyn", at: { x: 24, y: 36 } }, label: "Down to the wharves" })),
  ],
});
