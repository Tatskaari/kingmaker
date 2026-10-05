import { palaceLayout } from "./palace-layout.js";
import { create } from "@bufbuild/protobuf";
import {
  WorldMapSchema,
  type Tile,
  type TileLayer,
  type WorldMap,
} from "../../../packages/contracts/src/index.js";

const WIDTH = palaceLayout.width;
const HEIGHT = palaceLayout.height;
const TILE_SIZE = 16;
const tiles: Array<{ layers: TileLayer[] }> = Array.from(
  { length: WIDTH * HEIGHT },
  () => ({ layers: [] }),
);
const walkable = Array.from({ length: WIDTH * HEIGHT }, () => false);

function layer(tileId: number, solid = false): TileLayer {
  return {
    $typeName: "kingmaker.v1.TileLayer",
    tilesetId: "palace-illustration-a",
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

// Artwork is registered to this grid; floor ownership still defines collision.
// Painted walls and furniture never change the authored navigation geometry.
const rooms = palaceLayout.rooms;
for (const room of rooms) {
  for (const region of room.regions) floorRegion(region.x, region.y, region.width, region.height);
}

// Treat the complete illustration as a row-major atlas of 16px tiles so the
// existing bounded-layer renderer and hit testing use the same coordinates.
for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    at(x, y).layers.push(layer(y * WIDTH + x, !isWalkable(x, y)));
  }
}

export const palaceMap: WorldMap = create(WorldMapSchema, {
  id: "caerwyn-palace",
  name: "Palace of Caerwyn",
  width: WIDTH,
  height: HEIGHT,
  tileWidth: TILE_SIZE,
  tileHeight: TILE_SIZE,
  tilesets: [{
    id: "palace-illustration-a",
    imagePath: "./assets/palace-illustration-a.png",
    tileWidth: TILE_SIZE,
    tileHeight: TILE_SIZE,
    columns: WIDTH,
    tileCount: WIDTH * HEIGHT,
  }, {
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
