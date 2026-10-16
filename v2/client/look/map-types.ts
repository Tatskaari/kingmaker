// New: the members of the prototype's src/game/map/render.ts:88-103 (DoorPick) and :115-164 (Picks) at 44c6d4a that lamps.ts and overlay.ts read, as types: their map halves (mapLamps, mapDoors) are copied whole, and v2 has no map renderer to call them yet (V2's).
import type { DoorLook } from "./door-art.ts";
import type { LampPick } from "./lamps.ts";
import type { MapActor, Tile2 } from "../ui/types.ts";

/** A door the map's renderer drew in a wall's face (src/game/map/render.ts's DoorPick). */
export interface DoorPick {
  at: Tile2;
  /** Its tile's centre cell (as drawn, the shake and all), and how many rows its wall stands. */
  sc: number;
  sr: number;
  height: number;
  /** The wall's face it opens through: south (to the right of its tile on screen) or west (to the left). */
  face: "south" | "west";
  look: DoorLook;
  /** The light on its tile, and the least of it built things keep (as its wall's cells are lit). */
  light: { r: number; g: number; b: number };
  floor: number;
  wall: Array<{ x: number; y: number; ch: string; fg: string; bg: string }>;
  /** The cells of its foot (door-art.ts footCells) where the tile in front shows bare ground: its sill may run down into them. */
  foot: Array<{ x: number; y: number }>;
}

/** What a frame of the map drew where (src/game/map/render.ts's Picks class), as the look layer reads it. */
export interface Picks {
  w: number;
  h: number;
  /** The map the frame was of. */
  map: string;
  /** The doors drawn in walls' faces (when asked for). */
  doors?: DoorPick[];
  /** By cell: 1 where something was drawn over the map after it was painted (when asked for). */
  over?: Uint8Array;
  /** What it drew up posts, for the lamps' pictures, when the doors are asked for. */
  lamps?: LampPick[];
  /** The tile drawn at a viewport cell and who or what is drawn there; undefined where nothing of the map is. */
  at(sx: number, sy: number): { at: Tile2; actor?: MapActor } | undefined;
}
