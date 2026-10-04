import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { RuntimeCharacterSchema } from "../packages/contracts/src/v2.js";
import { WorldHost } from "../apps/web/src/world-host.js";
import { loadPlayableWorld } from "./fixtures.js";

test("fixture transfers update live document inventories without replacing unrelated properties", () => {
  const source = loadPlayableWorld();
  source.runtimeCharacters.player = create(RuntimeCharacterSchema, { id: "player", characterId: "player", document: source.player! });
  const fixture = source.map!.fixtures.find(item => item.id === "palace_corvin_drawers")!;
  fixture.open = true;
  const actor = source.map!.actors.find(actor => actor.characterId === "player")!;
  actor.position = fixture.interactionSpot; actor.roomId = fixture.roomId;
  delete source.docs[source.player!]!.characterProperties!.inventory;
  const host = new WorldHost(source), world = host.world();
  const doc = world.docs[world.player!]!, properties = doc.characterProperties!;
  host.interactFixtureWithEvent("take_palace_royal_key");
  assert.strictEqual(host.world(), world);
  assert.strictEqual(host.world().docs[world.player!], doc);
  assert.strictEqual(doc.characterProperties, properties);
  assert.ok(properties.inventory!.items.some(item => item.id === "palace_royal_key"));
  assert.ok(!world.map!.fixtures.find(item => item.id === fixture.id)!.inventory!.items.some(item => item.id === "palace_royal_key"));
  const before = host.snapshot();
  assert.throws(() => host.interactFixtureWithEvent("take_palace_royal_key"), /no longer available/);
  assert.deepEqual(host.snapshot(), before);
});
