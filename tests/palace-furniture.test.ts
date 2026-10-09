import assert from "node:assert/strict";
import test from "node:test";
import { courtPath, courtRoomAt } from "../apps/web/src/court-navigation.js";
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
    for (const [key, owner] of palaceLayout.owners) if (owner === room.id && !blocked.has(key)) {
      // The delivery queue outside the wedged cart is deliberately cut off.
      if (room.id === "entrance_hall" && Number(key.split(",")[1]) > 37) continue;
      assert.ok(reached.has(key), `${room.id}: stranded ${key}`);
    }
    for (const fixture of world.fixtures.filter(f => f.roomId === room.id && f.interactionSpot)) {
      if (fixture.id.startsWith("furn_delivery_")) {
        assert.ok(courtPath({ x: 61, y: 48 }, fixture.interactionSpot!, world.doors, world.fixtures), fixture.id);
        continue;
      }
      assert.ok(reached.has(`${fixture.interactionSpot!.x},${fixture.interactionSpot!.y}`), fixture.id);
    }
  }
});

test("the gift-tree cart blocks the service entrance while both sides can be examined from inside", () => {
  const world = load().world!;
  const carts = world.fixtures.filter(f => f.id === "furn_cart_left" || f.id === "furn_cart_right");
  assert.equal(carts.length, 2);
  const inside = { x: 61, y: 35 }, outside = { x: 61, y: 40 };
  assert.equal(courtPath(inside, outside, world.doors, world.fixtures), undefined);
  for (const cart of carts) assert.ok(courtPath(inside, cart.interactionSpot!, world.doors, world.fixtures));
  assert.ok(courtPath(inside, outside, world.doors, world.fixtures.filter(f => !carts.includes(f))));
});

test("the opening scene puts Rowan beside the cart and servants with the delayed goods outside", () => {
  const world = load().world!;
  const cart = world.fixtures.find(f => f.id === "furn_cart_left")!.position!;
  const rowan = world.actors.find(actor => actor.characterId === "rowan")!;
  assert.equal(rowan.roomId, "entrance_hall");
  assert.equal(Math.abs(rowan.position!.x - cart.x) + Math.abs(rowan.position!.y - cart.y), 1);
  const servants = world.actors.filter(actor => actor.characterId.startsWith("court-servant-"));
  const deliveries = world.fixtures.filter(f => f.id.startsWith("furn_delivery_"));
  assert.equal(servants.length, 2); assert.equal(deliveries.length, 2);
  for (const servant of servants) {
    assert.ok(servant.position!.y > cart.y);
    assert.ok(deliveries.some(f => Math.abs(f.position!.x - servant.position!.x) + Math.abs(f.position!.y - servant.position!.y) === 1));
    assert.equal(courtPath(rowan.position!, servant.position!, world.doors, world.fixtures), undefined);
  }
  assert.equal(world.actors.find(actor => actor.characterId === "oswin")!.roomId, "great_hall");
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
