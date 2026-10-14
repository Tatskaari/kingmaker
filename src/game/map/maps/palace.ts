import { buildMap, T, type MapDef } from "../tiles.ts";

/**
 * Up the palace's back stairs: the long gallery (portraits propped along it for the Assembly) and,
 * off it, the King's dressing room: wardrobes, mirrors, a fire, tall windows on the roaring city,
 * and a tea tray. Small, warm and cluttered. The dressing room is kings-morning's place; its world
 * (src/game/map/worlds/dressing-room.ts) has its (0, 0) feet at tile (1, 1), the gallery's corner.
 */

const GRID = `
PPPPP
PaaaPPpPpPpPpP
PqaaPffffffffP
PaaaPffffffffp
Paaa+ffffffffP
PqaaPffffffffP
PaaaPffffffffp
PaaaPffffffffP
PqaaPPPPPPPPPP
PaaaP
PvvvP
PPQPP
`;

export const palace: MapDef = buildMap({
  id: "palace",
  name: "The Palace",
  grid: GRID,
  legend: {
    P: T("wall", { style: "gilt", height: 4 }), p: T("window", { style: "gilt", height: 4 }),
    "+": T("door", { style: "gilt", height: 4 }), Q: T("door", { style: "gilt", height: 4 }),
    a: T("floor", { style: "carpet", roof: "palace", roofHeight: 4 }),
    q: T("floor", { style: "carpet", roof: "palace", roofHeight: 4 }, { name: "a portrait", glyph: "▯", color: "#c9a94a", blocks: true, text: "A portrait of a previous king, propped against the wall for the Assembly. He looks as if he'd have signed things." }),
    f: T("floor", { style: "carpet", roof: "palace", roofHeight: 4 }),
    v: T("stairs"),
  },
  regions: [
    { id: "dressing-room", name: "the King's dressing room", rect: { x: 5, y: 2, w: 8, h: 6 }, sceneId: "kings-morning", worldOrigin: { x: 1, y: 1 }, trigger: "enter", label: "Go in to the King",
      shut: "A footman with a face like a closed door says the King is not receiving.",
      description: "A warm, cluttered room off the long gallery, all wardrobes, mirrors and a fire, with the city roaring awake through the tall windows." },
    { id: "long-gallery", name: "the long gallery", rect: { x: 1, y: 1, w: 3, h: 9 }, description: "The long gallery, with portraits of previous kings propped along it for the Assembly, all looking as if they'd have signed things." },
    { id: "back-stairs", name: "the back stairs", rect: { x: 1, y: 10, w: 3, h: 1 }, description: "The back stairs, worn by three hundred years of trays." },
  ],
  exits: [{ at: { x: 2, y: 11 }, to: { map: "caerwyn", at: { x: 11, y: 13 } }, label: "Down to the palace gate" }],
});
