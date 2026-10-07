import assert from "node:assert/strict";
import test from "node:test";
import { courtRoomAt } from "../apps/web/src/court-navigation.js";
import { palaceLayout } from "../apps/web/src/palace-layout.js";
import { palaceNodes } from "../apps/web/src/palace-navigation.js";
import { inventoryOwners, locatedItems, validateInventories } from "../packages/core/src/inventory.js";
import { physicalFixture } from "./fixtures.js";

const load = physicalFixture;
test("furnished rooms keep every free tile and fixture approach reachable without crossing a closed door", () => {
  const scenario = load(), world = scenario.world!;
  const blocked = new Set([...world.fixtures.flatMap(f => f.position ? [`${f.position.x},${f.position.y}`] : []),
    ...world.doors.flatMap(d => d.tiles.map(p => `${p.x},${p.y}`))]);
  for (const room of palaceLayout.rooms) {
    const seed = palaceNodes.find(node => courtRoomAt(node)?.id === room.id)!;
    const pending = [`${seed.x},${seed.y}`], reached = new Set<string>();
    while (pending.length) {
      const key = pending.pop()!;
      if (reached.has(key) || blocked.has(key) || palaceLayout.owners.get(key) !== room.id) continue;
      reached.add(key);
      const [x, y] = key.split(",").map(Number) as [number, number];
      pending.push(`${x - 1},${y}`, `${x + 1},${y}`, `${x},${y - 1}`, `${x},${y + 1}`);
    }
    for (const [key, owner] of palaceLayout.owners) if (owner === room.id && !blocked.has(key)) assert.ok(reached.has(key), `${room.id}: stranded ${key}`);
    for (const fixture of world.fixtures.filter(f => f.roomId === room.id && f.interactionSpot)) {
      assert.ok(reached.has(`${fixture.interactionSpot!.x},${fixture.interactionSpot!.y}`), fixture.id);
    }
  }
});

test("bedrooms have beds and personal belongings while original evidence stays in place", () => {
  const scenario = load(), world = scenario.world!;
  validateInventories(inventoryOwners(scenario.characters, scenario.world));
  assert.equal(world.fixtures.filter(f => !f.id.startsWith("furn_")).length, 26);
  for (const id of ["mara", "hadrik", "tessa", "elinor", "oswin", "rowan", "lucan", "sabine", "rook"]) {
    const fixtures = world.fixtures.filter(f => f.roomId === `${id}_chamber`);
    assert.ok(fixtures.some(f => f.id === `furn_${id}_bed_head`));
    const resident = world.rooms.find(room => room.id === `${id}_chamber`)!.allowedCharacterIds[0];
    assert.ok(fixtures.every(f => f.ownerCharacterId === resident));
    assert.ok(fixtures.filter(f => f.container).length >= 2);
  }
  const items = locatedItems(inventoryOwners(scenario.characters, scenario.world));
  for (const [id, location] of [["palace_royal_key", "palace_corvin_drawers"], ["palace_royal_seal", "palace_coffer_03"],
    ["palace_silk_sash", "palace_royal_cabinet"], ["palace_account_book", "palace_treasury_shelf"]]) {
    assert.equal(items.find(item => item.id === id)?.locationId, location);
  }
  assert.ok(items.filter(item => item.id.startsWith("furn_")).every(item => item.details && item.concealed));
});
