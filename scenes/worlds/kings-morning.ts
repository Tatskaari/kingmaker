import type { WorldSpec } from "../../src/world/scene-world.ts";

/**
 * The King's dressing room on the morning of the Assembly (feet; x runs east from the door to the
 * long gallery, y south towards the tall windows over the courtyard).
 */
export const kingsMorningWorld: WorldSpec = {
  name: "The King's dressing room",
  description: "A warm, cluttered room off the long gallery: wardrobes, mirrors, a fire, a tea tray, and tall windows full of bunting and noise.",
  size: { w: 36, h: 28 },
  areas: [
    { id: "gallery-door", name: "by the door to the long gallery", rect: { x: 0, y: 0, w: 10, h: 10 }, description: "Where the Marshal stands with his watch; beyond the door, the long gallery and whoever is waiting in it." },
    { id: "dressing", name: "the middle of the room", rect: { x: 10, y: 0, w: 26, h: 14 }, description: "Where the King is being pinned into his robes." },
    { id: "hearth", name: "by the fire", rect: { x: 0, y: 10, w: 14, h: 18 }, description: "The fire, two armchairs and the tea tray." },
    { id: "windows", name: "by the windows", rect: { x: 14, y: 14, w: 22, h: 14 }, description: "Tall windows over the courtyard, where the procession is forming up." },
  ],
  things: [
    { id: "gallery-door-door", name: "the door to the long gallery", kind: "feature", in: "gallery-door", at: [2, 4], size: "large", material: "wood", tags: ["door"], states: ["closed"] },
    { id: "wardrobes", name: "the wardrobes", kind: "feature", in: "dressing", at: [32, 3], size: "huge", material: "wood", tags: ["container", "cover"], description: "Three of them, full of robes for occasions, some of which have never occurred." },
    { id: "mirror", name: "the long mirror", kind: "feature", in: "dressing", at: [24, 2], size: "large", material: "glass" },
    { id: "robes", name: "the procession robes", kind: "object", in: "dressing", at: [20, 7], size: "medium", material: "cloth", description: "Purple and ermine, a great deal of both, currently being pinned onto the King." },
    { id: "fire", name: "the fire", kind: "feature", in: "hearth", at: [3, 20], size: "large", material: "stone", tags: ["fire", "hearth", "light"], states: ["lit"] },
    { id: "armchairs", name: "the two armchairs", in: "hearth", at: [8, 18], size: "large", material: "wood", tags: ["furniture", "cover"] },
    { id: "tea-tray", name: "the tea tray", kind: "item", in: "hearth", at: [10, 22], size: "small", material: "silver", description: "A pot, a milk jug, a sugar bowl, four cups (warmed) and a plate of shortbread nobody is allowed to touch before the procession." },
    { id: "windows-glass", name: "the tall windows", kind: "feature", in: "windows", at: [26, 27], size: "huge", material: "glass", description: "Over the courtyard: bands, banners, the delegations forming up, and the Purveyor's grain cart in garlands." },
  ],
  people: {
    player: { in: "gallery-door", at: [6, 6] },
    kell: { in: "gallery-door", at: [7, 8], note: "at the investigator's shoulder, notebook under her arm" },
    holt: { in: "gallery-door", at: [3, 7], note: "by the door, pocket watch open" },
    king: { in: "dressing", at: [20, 6], note: "half into his robes, a teacup in one hand" },
  },
};
