import assert from "node:assert/strict";
import test from "node:test";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { courtPath } from "../apps/web/src/court-navigation.js";
import { loadPlayableWorld } from "./fixtures.js";
import { cartStrengthCheck } from "../packages/core/src/cart.js";
import { interactWithFixture } from "../packages/core/src/simulation-fixtures.js";

function fixture(natural: number, side = "left") {
  const world = loadPlayableWorld(), map = world.simulation!.map!;
  const target = map.fixtures.find(f => f.id === `furn_cart_${side}`)!;
  const player = map.actors.find(a => a.characterId === "player")!;
  player.position = { ...target.interactionSpot! }; player.roomId = "entrance_hall";
  world.simulation!.runtimeCharacters.player!.dnd!.abilityScores!.strength = 14;
  let rolls = 0;
  const game = new WorldGameRuntime(world, "", undefined, undefined, undefined,
    { services: { random: { integer: () => { rolls++; return natural; } } } });
  return { game, rolls: () => rolls, id: `smash_furn_cart_${side}` };
}

test("a failed cart Strength check leaves the blockage and offers another attempt", async () => {
  const { game, rolls, id } = fixture(12);
  const before = game.world().simulation!.map!.fixtures;
  const result = await game.executeAction({ command: { kind: "fixture", id } });
  assert.equal(rolls(), 1); assert.equal(result.roll?.modifier, 2);
  assert.equal(result.roll?.total, 14); assert.equal(result.roll?.success, false);
  assert.deepEqual(game.world().simulation!.map!.fixtures, before);
  assert.match(result.message!, /still blocked/);
  assert.equal(result.worldEvent!.details!.strengthCheck && (result.worldEvent!.details!.strengthCheck as { success: boolean }).success, false);
  assert.ok(game.map.observe("player").actions.some(a => a.id === id));
});

for (const side of ["left", "right"]) test(`smashing from the ${side} clears a lane, preserves the tree and survives save/load`, async () => {
  const { game, rolls, id } = fixture(13, side);
  const result = await game.executeAction({ command: { kind: "fixture", id } });
  assert.equal(rolls(), 1); assert.equal(result.roll?.success, true);
  assert.equal(result.roll?.total, 15); assert.match(result.worldEvent!.summary, /smash.*opening a way/);
  const map = game.world().simulation!.map!;
  assert.ok(!map.fixtures.some(f => ["furn_cart_left", "furn_cart_right"].includes(f.id)));
  assert.ok(map.fixtures.some(f => f.id === "furn_gift_tree" && f.ownerCharacterId === "rowan"));
  assert.ok(courtPath({ x: 61, y: 35 }, { x: 61, y: 40 }, map.doors, map.fixtures));
  assert.ok(map.fixtures.find(f => f.id === "furn_delivery_cushions")!.inventory!.items.length);
  assert.ok(!game.map.observe("player").actions.some(a => a.id.startsWith("smash_")));
  await assert.rejects(game.executeAction({ command: { kind: "fixture", id } }), /no longer available/);
  assert.equal(rolls(), 1, "stale requests cannot reroll");
  game.restore(game.snapshot());
  assert.ok(game.world().simulation!.map!.fixtures.some(f => f.id === "furn_gift_tree"));
});

test("cart rolls require a valid approach and cannot bypass the roll at the simulation boundary", async () => {
  const { game, rolls, id } = fixture(20);
  for (const natural of [undefined, 0, 21, 1.5, NaN]) {
    assert.throws(() => game.services.mechanics.executeMove(interactWithFixture, "player", id, Date.now(), natural), /Invalid simulation move/);
  }
  const actor = game.world().simulation!.map!.actors.find(a => a.characterId === "player")!;
  await game.movePlayer({ x: actor.position!.x, y: actor.position!.y - 1 });
  await assert.rejects(game.executeAction({ command: { kind: "fixture", id } }), /interaction spot/);
  assert.equal(rolls(), 0);
  assert.ok(game.world().simulation!.map!.fixtures.some(f => f.id === "furn_cart_left"));
});

test("cart checks retain the standard natural-one and natural-twenty outcomes", () => {
  assert.equal(cartStrengthCheck(undefined, 1).success, false);
  assert.equal(cartStrengthCheck(undefined, 20).success, true);
});
