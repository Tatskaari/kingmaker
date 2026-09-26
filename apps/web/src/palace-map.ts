import { create } from "@bufbuild/protobuf";
import {
  WorldMapSchema,
  type Tile,
  type TileLayer,
  type WorldMap,
} from "../../../packages/contracts/src/index.js";

const WIDTH = 32;
const HEIGHT = 22;
const TILE_SIZE = 16;
const FLOOR = 48;
const FLOOR_VARIANT = 49;
const FLOOR_DETAIL = 42;
const WALL_TOP_LEFT = 1;
const WALL_TOP = 2;
const WALL_TOP_RIGHT = 3;
const WALL_LEFT = 13;
const WALL_RIGHT = 15;
const WALL_BOTTOM_LEFT = 25;
const WALL_BOTTOM = 26;
const WALL_BOTTOM_RIGHT = 27;
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

floorRegion(3, 2, 5, 5);   // Merlin's Chamber
floorRegion(13, 1, 6, 4);  // Royal Bedchamber
floorRegion(24, 2, 5, 5);  // Lancelot's Chamber
floorRegion(8, 6, 16, 2);  // North Corridor
floorRegion(15, 5, 2, 1);  // Royal doorway
floorRegion(15, 8, 2, 1);  // Great Hall doorway
floorRegion(10, 9, 12, 7); // Great Hall
floorRegion(3, 13, 6, 7);  // Embassy Guest Chamber
floorRegion(9, 13, 1, 1);  // Guest doorway
floorRegion(12, 17, 8, 4); // Entrance Hall
floorRegion(15, 16, 2, 1); // Great Hall doorway
floorRegion(15, 21, 2, 1); // Palace entrance
floorRegion(23, 13, 6, 7); // Treasury
floorRegion(22, 13, 1, 1); // Treasury doorway

function wallTile(x: number, y: number): number | undefined {
  const above = isWalkable(x, y - 1);
  const below = isWalkable(x, y + 1);
  const left = isWalkable(x - 1, y);
  const right = isWalkable(x + 1, y);
  if ((below && right) || (!below && !right && isWalkable(x + 1, y + 1))) return WALL_TOP_LEFT;
  if ((below && left) || (!below && !left && isWalkable(x - 1, y + 1))) return WALL_TOP_RIGHT;
  if ((above && right) || (!above && !right && isWalkable(x + 1, y - 1))) return WALL_BOTTOM_LEFT;
  if ((above && left) || (!above && !left && isWalkable(x - 1, y - 1))) return WALL_BOTTOM_RIGHT;
  if (below) return WALL_TOP;
  if (above) return WALL_BOTTOM;
  if (right) return WALL_LEFT;
  if (left) return WALL_RIGHT;
  return undefined;
}

for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    if (isWalkable(x, y)) {
      at(x, y).layers.push(layer((x * 17 + y * 31) % 11 === 0 ? FLOOR_VARIANT : FLOOR));
      continue;
    }
    const tileId = wallTile(x, y);
    if (tileId !== undefined) at(x, y).layers.push(layer(tileId, true));
  }
}

// Decorative paving demonstrates a second bounded layer on a floor tile.
for (const [x, y] of [[13, 11], [18, 11], [13, 14], [18, 14]] as const) {
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
  rooms: [
    { id: "merlin_chamber", name: "Merlin's Chamber", regions: [{ x: 3, y: 2, width: 5, height: 5 }] },
    { id: "royal_bedchamber", name: "Royal Bedchamber", regions: [{ x: 13, y: 1, width: 6, height: 4 }] },
    { id: "lancelot_chamber", name: "Lancelot's Chamber", regions: [{ x: 24, y: 2, width: 5, height: 5 }] },
    { id: "north_corridor", name: "North Corridor", regions: [{ x: 8, y: 6, width: 16, height: 2 }, { x: 15, y: 5, width: 2, height: 1 }, { x: 15, y: 8, width: 2, height: 1 }] },
    { id: "great_hall", name: "Great Hall", regions: [{ x: 10, y: 9, width: 12, height: 7 }, { x: 9, y: 13, width: 1, height: 1 }, { x: 15, y: 16, width: 2, height: 1 }, { x: 22, y: 13, width: 1, height: 1 }] },
    { id: "guest_chamber", name: "Embassy Guest Chamber", regions: [{ x: 3, y: 13, width: 6, height: 7 }] },
    { id: "entrance_hall", name: "Entrance Hall", regions: [{ x: 12, y: 17, width: 8, height: 4 }, { x: 15, y: 21, width: 2, height: 1 }] },
    { id: "treasury", name: "Treasury", regions: [{ x: 23, y: 13, width: 6, height: 7 }] },
  ],
});
