import { palaceLayout } from "./palace-layout.js";
import { create } from "@bufbuild/protobuf";
import { autotileDungeon } from "./dungeon-autotile.js";
import {
  WorldMapSchema,
  type Tile,
  type TileLayer,
  type WorldMap,
} from "../../../packages/contracts/src/index.js";

const WIDTH = palaceLayout.width;
const HEIGHT = palaceLayout.height;
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
const rooms = palaceLayout.rooms;
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
  at(x + 46, y).layers.push(layer(FLOOR_DETAIL));
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
    imagePath: "./assets/caerwyn-pencil.png",
    tileWidth: 64,
    tileHeight: 64,
    columns: 12,
    tileCount: 132,
  }],
  tiles: tiles as Tile[],
  rooms,
});
