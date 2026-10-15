import { buildMap, T } from "../map/tiles.ts";
import type { MapActor, Tile2, TileMap } from "../types.ts";
import type { DoorLook } from "./door-art.ts";

/**
 * Every look a door has, on both faces of a wall, on a little map of its own: a plaster room 12 x 10
 * inside its walls, a door in each look on its south wall (y 12) and its west wall (x 1), two tiles
 * apart, seen from outside it, south-west (the camera: both front faces show; render it with
 * cutaway: false). For the doors' tests and pictures (src/game/look/doors.test.ts,
 * src/web/static/shoot.ts), as the ASCII-plus spike's door sheet had them.
 */

export const DOOR_LOOKS: Array<{ look: DoorLook; states: string[]; blocks?: boolean }> = [
  { look: "shut", states: ["closed"] },
  { look: "open", states: ["open"] },
  { look: "locked", states: ["closed", "locked"], blocks: true },
  { look: "barred", states: ["closed", "barred"], blocks: true },
  { look: "broken", states: ["destroyed"] },
];

export const DOOR_SHEET_CAMERA: Tile2 = { x: 6, y: 8 };

export function doorSheet(): { map: TileMap; doors: MapActor[]; at: (look: DoorLook, face: "south" | "west") => Tile2 } {
  const grid = Array.from({ length: 14 }, (_, y) => [...(y === 0 || y === 13 ? "................" : y === 1 || y === 12 ? ".##############." : ".#............#.")]);
  const along = [3, 5, 7, 9, 11];
  const at = (look: DoorLook, face: "south" | "west"): Tile2 => {
    const i = DOOR_LOOKS.findIndex(d => d.look === look);
    return face === "south" ? { x: along[i]!, y: 12 } : { x: 1, y: along[i]! };
  };
  for (const d of DOOR_LOOKS) for (const face of ["south", "west"] as const) { const p = at(d.look, face); grid[p.y]![p.x] = "+"; }
  const { map } = buildMap({
    id: "door-sheet", name: "The door sheet", grid: `\n${grid.map(r => r.join("")).join("\n")}\n`,
    legend: { ".": T("cobbles"), "#": T("wall", { style: "plaster", height: 3 }), "+": T("door", { style: "plaster", height: 3 }) },
    regions: [{ id: "sheet", name: "the sheet", rect: { x: 0, y: 0, w: 16, h: 14 }, description: "" }],
  });
  const doors: MapActor[] = DOOR_LOOKS.flatMap(d => (["south", "west"] as const).map(face => ({
    id: `door-${face}-${d.look}`, name: `a ${d.look} door`, kind: "object" as const, glyph: "+", map: "door-sheet", at: at(d.look, face), states: d.states, ...(d.blocks ? { blocks: true } : {}),
  })));
  return { map, doors, at };
}
