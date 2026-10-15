import type { WorldSpec } from "../../src/world/scene-world.ts";

/**
 * The King's dressing room and the long gallery outside it, for kings-morning (feet; x east, y
 * south from the gallery's north end). It lines up with src/game/map/maps/palace.ts at 5 ft to a
 * tile, (0, 0) at tile (1, 1). Optional: attach it with `world: dressingRoomWorld` if the King's
 * morning should have a world (it's a talking scene, so the map works without one).
 */
export const dressingRoomWorld: WorldSpec = {
  name: "The King's dressing room",
  description: "A warm, cluttered room off the long gallery, all wardrobes, mirrors and a fire, where King Aldren is being got into his procession robes; through the tall windows the city is roaring awake.",
  size: { w: 65, h: 50 },
  areas: [
    { id: "gallery", name: "the long gallery", rect: { x: 0, y: 0, w: 15, h: 50 }, description: "Portraits of previous kings propped along it for the Assembly; the back stairs at its south end." },
    { id: "dressing-room", name: "the dressing room", rect: { x: 20, y: 5, w: 40, h: 30 }, description: "Wardrobes, mirrors, a fire, the procession robes, a tea tray, and tall windows onto the courtyard where the delegations are forming up." },
  ],
  things: [
    { id: "door", name: "the dressing-room door", kind: "feature", in: "dressing-room", at: [17, 17], size: "large", material: "wood", tags: ["door"], states: ["open"] },
    { id: "wardrobe-ermine", name: "a wardrobe full of ermine", in: "dressing-room", at: [22, 7], size: "large", material: "wood", tags: ["furniture", "container"] },
    { id: "wardrobe-purple", name: "a wardrobe full of purple", in: "dressing-room", at: [32, 7], size: "large", material: "wood", tags: ["furniture", "container"] },
    { id: "mirror", name: "a long mirror", in: "dressing-room", at: [42, 7], size: "medium", material: "glass", description: "In which the King is trying not to look." },
    { id: "windows", name: "the tall windows", kind: "feature", in: "dressing-room", at: [37, 2], size: "huge", material: "glass", description: "Onto the courtyard and the city: bells, a band tuning up, bunting, the delegations forming up under their banners, and the Purveyor's grain cart, garlanded, waiting to walk fourth." },
    { id: "fire", name: "the fire", kind: "feature", in: "dressing-room", at: [57, 17], size: "large", material: "stone", tags: ["fire", "hearth", "light"], states: ["lit"] },
    { id: "robes", name: "the procession robes", in: "dressing-room", at: [32, 22], size: "medium", material: "cloth", description: "Purple and ermine, a great deal of both, with the King half into them." },
    { id: "side-table", name: "a side table", in: "dressing-room", at: [52, 27], size: "medium", material: "wood", tags: ["furniture"] },
    { id: "tea-tray", name: "the tea tray", kind: "item", in: "side-table", size: "small", material: "silver", description: "A pot, cups warmed, milk, sugar. The King takes his tea very seriously." },
    { id: "screen", name: "a dressing screen", in: "dressing-room", at: [57, 32], size: "medium", material: "wood", tags: ["cover"] },
    { id: "valets", name: "the valets", kind: "person", in: "dressing-room", at: [42, 22], description: "Two valets with pins in their mouths, who have seen everything and will say nothing." },
  ],
  people: {
    player: { in: "dressing-room", at: [22, 17] },
    king: { in: "dressing-room", at: [37, 17], note: "half into his robes, a teacup in his hand" },
    holt: { in: "dressing-room", at: [22, 12], note: "by the door, pocket watch open in his palm" },
    kell: { in: "dressing-room", at: [22, 27], note: "at the investigator's side" },
    sallow: { in: "gallery", at: [7, 17], note: "in the gallery, come to walk with the Purveyor's party" },
  },
};
