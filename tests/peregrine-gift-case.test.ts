import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { InventorySchema } from "../packages/contracts/src/index.js";
import { giftInventoryScore, peregrineGiftCase } from "../packages/evals/src/peregrine-gift-case.js";

test("Peregrine gift fixture leaves ownership for review to establish", () => {
  const world = peregrineGiftCase.loadWorld([]);
  assert.equal(peregrineGiftCase.transcript.length, 6);
  assert.equal(giftInventoryScore(world).score, 0);
  assert.equal(world.simulation!.runtimeCharacters.peregrine!.activity, undefined);
  assert.ok(world.docs[world.player!], "player document exists even if inventory is initially absent");
  world.docs[world.player!]!.body += "\nPeregrine gave me a wooden bird.";
  assert.equal(giftInventoryScore(world).score, 0, "a prose-only gift must not pass");
  assert.doesNotMatch(peregrineGiftCase.loadWorld([]).docs[world.player!]!.body, /gave me a wooden bird/);
});

test("gift scoring requires one player-owned bird and rejects duplicate possession", () => {
  const world = peregrineGiftCase.loadWorld([]);
  const bird = create(InventorySchema, { items: [{ id: "gift-bird", name: "Carved wooden bird", quantity: 1,
    details: "Wings picked out in faded blue lacquer." }] }).items[0]!;
  const properties = world.docs[world.player!]!.characterProperties!;
  const playerItems = (properties.inventory ??= create(InventorySchema)).items;
  playerItems.push(bird);
  assert.equal(giftInventoryScore(world).score, 1);
  bird.quantity = undefined;
  assert.equal(giftInventoryScore(world).score, 1, "unspecified quantity represents one item");
  bird.quantity = 2;
  assert.equal(giftInventoryScore(world).score, 0);
  bird.quantity = 1;
  world.docs[world.simulation!.runtimeCharacters.peregrine!.document]!.characterProperties!.inventory!.items.push(bird);
  assert.equal(giftInventoryScore(world).score, 0);
});
