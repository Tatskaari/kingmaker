import assert from "node:assert/strict";
import test from "node:test";
import { RoomBuilder } from "../apps/web/src/room-builder.js";

test("room claims reject corridor leaks without partially claiming tiles", () => {
  const layout = new RoomBuilder(20, 20);
  layout.room({ id: "bedroom", name: "Bedroom", residents: ["mara"], regions: [{ x: 5, y: 5, width: 5, height: 5 }] });
  assert.throws(() => layout.room({ id: "hall", name: "Hall", regions: [{ x: 1, y: 7, width: 6, height: 2 }] }), /hall overlaps bedroom at 5,7/);
  assert.equal(layout.owners.get("4,7"), undefined);
  assert.equal(layout.owners.get("5,7"), "bedroom");
  assert.throws(() => layout.room({ id: "outside", name: "Outside", regions: [{ x: 19, y: 0, width: 2, height: 1 }] }), /Invalid region/);
});

test("room generation derives access and reciprocal exits from floor ownership", () => {
  const layout = new RoomBuilder(20, 20);
  layout.room({ id: "bedroom", name: "Bedroom", residents: ["mara"], regions: [{ x: 5, y: 5, width: 5, height: 5 }] });
  layout.room({ id: "hall", name: "Hall", regions: [{ x: 3, y: 5, width: 2, height: 5 }] });
  layout.room({ id: "isolated", name: "Isolated", regions: [{ x: 12, y: 5, width: 2, height: 5 }] });
  assert.deepEqual(layout.worldRooms(), [
    { id: "bedroom", name: "Bedroom", private: true, allowedCharacterIds: ["mara"], exitRoomIds: ["hall"] },
    { id: "hall", name: "Hall", private: false, allowedCharacterIds: [], exitRoomIds: ["bedroom"] },
    { id: "isolated", name: "Isolated", private: false, allowedCharacterIds: [], exitRoomIds: [] },
  ]);
  assert.match(layout.svg(), /Bedroom — mara/);
});
