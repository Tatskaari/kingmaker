import assert from "node:assert/strict";
import test from "node:test";
import { drawPalaceInteriors } from "../apps/web/src/palace-artwork.js";
import { palaceMap } from "../apps/web/src/palace-map.js";
import type { CanvasMapRenderer } from "../apps/web/src/map-renderer.js";

test("all delegation reception rooms receive wood and their own rug, including the drawing room", () => {
  const painted: { sprite: number; x: number; y: number }[] = [];
  const renderer = { drawSprite: (_atlas: string, sprite: number, x: number, y: number) => painted.push({ sprite, x, y }) };
  drawPalaceInteriors(renderer as unknown as CanvasMapRenderer, palaceMap);
  for (const [id, rug] of [["ironmark_salon", 3], ["greenweald_solar", 4], ["saltmere_drawing_room", 5]] as const) {
    const r = palaceMap.rooms.find(room => room.id === id)!.regions[0]!;
    assert.ok(painted.some(p => p.sprite === 0 && p.x === r.x && p.y === r.y), `${id} has timber flooring`);
    assert.ok(painted.some(p => p.sprite === rug && p.x === r.x + 1 && p.y === r.y + 1), `${id} has its delegation rug`);
  }
});
