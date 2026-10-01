import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { RoomBuilder } from "../apps/web/src/room-builder.js";
import { FurnitureBuilder } from "../apps/web/src/furniture-builder.js";

function builder() {
  const layout = new RoomBuilder(10, 10);
  layout.room({ id: "bedroom", name: "Bedroom", residents: ["mara"], regions: [{ x: 1, y: 1, width: 6, height: 6 }] });
  const scenario = create(ScenarioSchema, { world: { doors: [{ tiles: [{ x: 3, y: 6 }], interactionSpots: [{ x: 3, y: 5 }] }] } });
  return new FurnitureBuilder(layout, scenario, [{ x: 4, y: 4 }]);
}
const chest = { id: "chest", name: "Travel chest", sprite: 90,
  items: [{ id: "letter", name: "Family letter", details: "News from home." }] };

test("furniture inherits the resident and creates concealed inspectable contents", () => {
  const b = builder(); b.add("bedroom", 0, 0, chest);
  const fixture = b.fixtures[0]!;
  assert.equal(fixture.ownerCharacterId, "mara");
  assert.deepEqual({ x: fixture.position!.x, y: fixture.position!.y }, { x: 1, y: 1 });
  assert.equal(fixture.container, true);
  assert.equal(fixture.inventory!.items[0]!.concealed, true);
  assert.equal(fixture.inventory!.items[0]!.details, "News from home.");
});

test("furniture refuses doors, waypoints, overlap, blocked approaches and duplicate items", () => {
  const b = builder();
  for (const [x, y] of [[2, 5], [2, 4], [3, 3], [9, 9]]) assert.throws(() => b.add("bedroom", x!, y!, chest), /reserved floor/);
  b.add("bedroom", 0, 0, chest);
  assert.throws(() => b.add("bedroom", 0, 0, { ...chest, id: "other" }), /reserved floor/);
  assert.throws(() => b.add("bedroom", 0, 1, { ...chest, id: "other" }), /reserved floor/);
  assert.throws(() => b.add("bedroom", 2, 0, { ...chest, id: "other" }), /Duplicate/);
  assert.throws(() => b.add("bedroom", 2, 0, { id: "bad", name: "Bad", sprite: 90, approach: { x: 5, y: 5 } }), /No clear/);
  assert.equal(b.fixtures.length, 1);
});
