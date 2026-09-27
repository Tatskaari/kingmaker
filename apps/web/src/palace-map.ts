import { create } from "@bufbuild/protobuf";
import { autotileDungeon } from "./dungeon-autotile.js";
import {
  WorldMapSchema,
  type Tile,
  type TileLayer,
  type WorldMap,
} from "../../../packages/contracts/src/index.js";

const WIDTH = 78;
const HEIGHT = 49;
const TILE_SIZE = 16;
const BACKGROUND = 0;
const FLOOR = 48;
const FLOOR_VARIANT = 49;
const FLOOR_DETAIL = 42;
const tiles: Array<{ layers: TileLayer[] }> = Array.from(
  { length: WIDTH * HEIGHT },
  () => ({ layers: [] }),
);
const walkable = Array.from({ length: WIDTH * HEIGHT }, () => false);

function layer(tileId: number, solid = false): TileLayer {
  return {
    $typeName: "kingmaker.v1.TileLayer",
    tilesetId: "tiny-dungeon",
    tileId,
    bounds: {
      $typeName: "kingmaker.v1.PixelBounds",
      x: 0,
      y: 0,
      width: TILE_SIZE,
      height: TILE_SIZE,
    },
    solid,
    interactable: false,
    properties: {},
  };
}

function at(x: number, y: number): { layers: TileLayer[] } {
  return tiles[y * WIDTH + x]!;
}

function isWalkable(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT && walkable[y * WIDTH + x]!;
}

function floorRegion(x: number, y: number, width: number, height: number): void {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      walkable[row * WIDTH + column] = true;
    }
  }
}

// Floor regions are the single source for both room overlays and geometry.
// Three solid rows between floors leave room for a bottom edge, cap and face;
// two solid columns leave room for both facing vertical wall edges.
const rooms = [
  { id: "corvin_chamber", name: "Corvin's Chamber", regions: [{ x: 3, y: 3, width: 5, height: 5 }] },
  { id: "royal_bedchamber", name: "Royal Bedchamber", regions: [{ x: 13, y: 3, width: 6, height: 5 }] },
  { id: "garran_chamber", name: "Garran's Chamber", regions: [{ x: 24, y: 3, width: 5, height: 5 }] },
  { id: "north_corridor", name: "North Corridor", regions: [
    { x: 3, y: 11, width: 26, height: 3 },
    { x: 5, y: 8, width: 2, height: 3 },
    { x: 15, y: 8, width: 2, height: 3 },
    { x: 25, y: 8, width: 2, height: 3 },
    { x: 15, y: 14, width: 2, height: 3 },
  ] },
  { id: "great_hall", name: "Great Hall", regions: [
    { x: 10, y: 17, width: 12, height: 13 },
    { x: 8, y: 22, width: 2, height: 2 },
    { x: 22, y: 22, width: 2, height: 2 },
    { x: 15, y: 30, width: 2, height: 3 },
  ] },
  { id: "guest_chamber", name: "Nobles' Parlour", regions: [{ x: 2, y: 20, width: 6, height: 9 }] },
  { id: "entrance_hall", name: "Entrance Hall", regions: [
    { x: 12, y: 33, width: 8, height: 4 },
    { x: 15, y: 37, width: 2, height: 12 },
  ] },
  { id: "treasury", name: "Treasury", regions: [{ x: 24, y: 20, width: 6, height: 9 }] },
  { id: "palace_back_hall", name: "Palace Back Hall", regions: [
    { x: 29, y: 11, width: 6, height: 3 },
    { x: 32, y: 14, width: 3, height: 31 },
    { x: 35, y: 12, width: 2, height: 2 },
    { x: 35, y: 27, width: 2, height: 2 },
    { x: 35, y: 42, width: 2, height: 2 },
  ] },
  { id: "ironmark_salon", name: "Ironmark Salon", regions: [{ x: 37, y: 7, width: 9, height: 9 }] },
  { id: "ironmark_back_hall", name: "Ironmark Back Hall", regions: [
    { x: 46, y: 12, width: 29, height: 2 },
    { x: 52, y: 10, width: 2, height: 2 },
    { x: 62, y: 10, width: 2, height: 2 },
    { x: 72, y: 10, width: 2, height: 2 },
  ] },
  { id: "mara_chamber", name: "Mara's Chamber", regions: [{ x: 50, y: 5, width: 7, height: 5 }] },
  { id: "hadrik_chamber", name: "Hadrik's Chamber", regions: [{ x: 60, y: 5, width: 7, height: 5 }] },
  { id: "tessa_chamber", name: "Tessa's Chamber", regions: [{ x: 70, y: 5, width: 7, height: 5 }] },
  { id: "greenweald_solar", name: "Greenweald Solar", regions: [{ x: 37, y: 22, width: 9, height: 9 }] },
  { id: "greenweald_back_hall", name: "Greenweald Back Hall", regions: [
    { x: 46, y: 27, width: 29, height: 2 },
    { x: 52, y: 25, width: 2, height: 2 },
    { x: 62, y: 25, width: 2, height: 2 },
    { x: 72, y: 25, width: 2, height: 2 },
  ] },
  { id: "elinor_chamber", name: "Elinor's Chamber", regions: [{ x: 50, y: 20, width: 7, height: 5 }] },
  { id: "oswin_chamber", name: "Oswin's Chamber", regions: [{ x: 60, y: 20, width: 7, height: 5 }] },
  { id: "rowan_chamber", name: "Rowan's Chamber", regions: [{ x: 70, y: 20, width: 7, height: 5 }] },
  { id: "saltmere_drawing_room", name: "Saltmere Drawing Room", regions: [{ x: 37, y: 37, width: 9, height: 9 }] },
  { id: "saltmere_back_hall", name: "Saltmere Back Hall", regions: [
    { x: 46, y: 42, width: 29, height: 2 },
    { x: 52, y: 40, width: 2, height: 2 },
    { x: 62, y: 40, width: 2, height: 2 },
    { x: 72, y: 40, width: 2, height: 2 },
  ] },
  { id: "lucan_chamber", name: "Lucan's Chamber", regions: [{ x: 50, y: 35, width: 7, height: 5 }] },
  { id: "sabine_chamber", name: "Sabine's Chamber", regions: [{ x: 60, y: 35, width: 7, height: 5 }] },
  { id: "rook_chamber", name: "Rook's Chamber", regions: [{ x: 70, y: 35, width: 7, height: 5 }] },
];
for (const room of rooms) {
  for (const region of room.regions) floorRegion(region.x, region.y, region.width, region.height);
}

const scenery = autotileDungeon(walkable, WIDTH, HEIGHT);
for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    const solid = !isWalkable(x, y);
    at(x, y).layers.push(layer(BACKGROUND, solid));
    const tileId = scenery[y * WIDTH + x]!;
    const sprite = tileId === FLOOR && (x * 17 + y * 31) % 11 === 0 ? FLOOR_VARIANT : tileId;
    if (sprite !== BACKGROUND) at(x, y).layers.push(layer(sprite, solid));
  }
}

// Decorative paving demonstrates a second bounded layer on a floor tile.
for (const [x, y] of [[13, 19], [18, 19], [13, 22], [18, 22], [13, 25], [18, 25], [13, 28], [18, 28]] as const) {
  at(x, y).layers.push(layer(FLOOR_DETAIL));
}

export const palaceMap: WorldMap = create(WorldMapSchema, {
  id: "caerwyn-palace",
  name: "Palace of Caerwyn",
  width: WIDTH,
  height: HEIGHT,
  tileWidth: TILE_SIZE,
  tileHeight: TILE_SIZE,
  tilesets: [{
    id: "tiny-dungeon",
    imagePath: "./assets/kenney-tiny-dungeon.png",
    tileWidth: TILE_SIZE,
    tileHeight: TILE_SIZE,
    columns: 12,
    tileCount: 132,
  }],
  tiles: tiles as Tile[],
  rooms,
});
