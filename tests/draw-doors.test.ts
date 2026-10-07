import assert from "node:assert/strict";
import test from "node:test";
import { drawDoors } from "../apps/web/src/draw-doors.js";
import type { Point } from "../packages/core/src/navigation.js";

function drawing(tiles: Point[], open: boolean): unknown[][] {
  const calls: unknown[][] = [];
  const context = {
    save() {}, restore() {}, fillStyle: "",
    translate(x: number, y: number) { calls.push(["translate", x, y]); },
    rotate(angle: number) { calls.push(["rotate", angle]); },
    fillRect(x: number, y: number, width: number, height: number) {
      calls.push(["fillRect", this.fillStyle, x, y, width, height]);
    },
  } as CanvasRenderingContext2D;
  drawDoors(context, [{ tiles, open }]);
  return calls;
}

for (const open of [false, true]) {
  test(`${open ? "open" : "closed"} mirrored west bedroom doors align with their thresholds`, () => {
    for (const y of [11, 26]) for (const x of [24, 14, 4]) {
      const tiles = [{ x, y }, { x: x + 1, y }];
      const forward = drawing(tiles, open);
      assert.deepEqual(forward[0], ["translate", x * 16 + 8, y * 16 + 8]);
      assert.deepEqual(drawing([...tiles].reverse(), open), forward);
    }
  });

  test(`${open ? "open" : "closed"} vertical doors render identically in either tile order`, () => {
    const tiles = [{ x: 31, y: 13 }, { x: 31, y: 14 }];
    const forward = drawing(tiles, open);
    assert.deepEqual(forward.slice(0, 2), [["translate", 504, 216], ["rotate", Math.PI / 2]]);
    assert.deepEqual(drawing([...tiles].reverse(), open), forward);
  });
}
