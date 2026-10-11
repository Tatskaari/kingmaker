import assert from "node:assert/strict";
import test from "node:test";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { loadPlayableWorld } from "./fixtures.js";
import { fixtureActions } from "../packages/core/src/fixtures.js";
import { inventoryOwners } from "../packages/core/src/inventory.js";
import { helloWorld } from "../packages/conversation/src/tree-scripts/hello-world.js";
import { authoriseCartSmash } from "../packages/conversation/src/tree-scripts/cart-actions.js";

const signal = () => new AbortController().signal;
function actions(game: WorldGameRuntime) {
  const state = game.world().simulation!;
  return fixtureActions(state.map!.fixtures, inventoryOwners(Object.values(state.runtimeCharacters), state.map), "player")
    .filter(action => action.verb === "smash");
}

test("quest start adds illegal actions once; permission survives repeated setup and save/resume", async () => {
  const game = new WorldGameRuntime(loadPlayableWorld(), "");
  try {
    const fixtures = game.world().simulation!.map!.fixtures;
    const cart = fixtures.find(fixture => fixture.id === "furn_cart_left")!;
    const ownership = cart.ownerCharacterId, inventory = cart.inventory;
    assert.deepEqual(actions(game), []);
    await helloWorld(game.services, signal());
    assert.equal(actions(game).length, 2);
    assert.ok(actions(game).every(action => action.legality === "illegal"));
    await authoriseCartSmash(game.services, signal());
    await helloWorld(game.services, signal());
    assert.equal(actions(game).length, 2);
    assert.ok(actions(game).every(action => action.legality === "normal"));
    const changed = game.world().simulation!.map!.fixtures.find(fixture => fixture.id === cart.id)!;
    assert.equal(changed.ownerCharacterId, ownership);
    assert.deepEqual(changed.inventory, inventory);
    assert.equal(cart.actions.length, 0, "previous fixture state was not mutated");
    game.restore(game.snapshot());
    assert.ok(actions(game).every(action => action.legality === "normal"));
  } finally { game.movement.dispose(); }
});

test("Holt's spoken blessing updates action legality and the actual smash event", async () => {
  const world = loadPlayableWorld(), fixture = world.simulation!.map!.fixtures.find(f => f.id === "furn_cart_left")!;
  world.simulation!.map!.actors.find(actor => actor.characterId === "player")!.position = { ...fixture.interactionSpot! };
  let permission = false;
  const game = new WorldGameRuntime(world, "", undefined, undefined, undefined, {
    services: { random: { integer: () => 20 }, disclosure: { disclose: async () => [] }, ai: {
      decisions: async (input, questions) => {
        const { node, conversation } = input as { node: string; conversation: { speaker: string; text: string }[] };
        const last = conversation.at(-1)!;
        const selected = node === "raging" ? "pillows-raised"
          : node === "interrupted" && last.speaker === "holt" ? "lead-from-interruption"
          : node === "options" && last.speaker === "player" && last.text.includes("smash") ? "smash-offered"
          : node === "reluctant" && last.speaker === "holt" && last.text.includes("permission") ? "blessing-given" : "";
        return Object.fromEntries(Object.keys(questions).map(id => [id, { choice: id === selected ? "hit" : "miss", probabilities: {} }]));
      },
    } }, strategies: { conversation: { respond: async () => ({ role: "assistant", content: permission
      ? "Reluctantly, you have my permission to smash the cart." : "The pillows are probably blocked by the cart. Do not smash it; Nine Furrows will be furious." }) } },
  });
  try {
    await game.checkedTalkToCharacter("holt", "Where are the pillows?");
    assert.ok(actions(game).every(action => action.legality === "illegal"));
    await game.checkedTalkToCharacter("holt", "I could smash it.");
    assert.ok(actions(game).every(action => action.legality === "illegal"));
    permission = true;
    await game.checkedTalkToCharacter("holt", "It will free the entrance. Please authorise it.");
    assert.equal(game.services.quests.read("conversation-holt-cart").currentStageId, "authorised");
    assert.equal(actions(game).length, 2);
    assert.ok(actions(game).every(action => action.legality === "normal"));
    const result = await game.executeAction({ command: { kind: "fixture", id: "smash_furn_cart_left" } });
    assert.equal(result.roll!.success, true);
    assert.equal(result.worldEvent!.details!.legality, "normal");
    assert.deepEqual(actions(game), []);
    await helloWorld(game.services, signal());
    assert.deepEqual(actions(game), [], "quest setup must not restore a destroyed cart's action");
  } finally { game.movement.dispose(); }
});
