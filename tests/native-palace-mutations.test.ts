import assert from "node:assert/strict";
import test from "node:test";
import { WorldHost } from "../apps/web/src/world-host.js";
import { PalaceMechanics } from "../apps/web/src/palace-mechanics.js";
import { loadPlayableWorld, assignActivity } from "./fixtures.js";

test("taking an item creates the document inventory and preserves prose and stats", () => {
  const world = loadPlayableWorld(), doc = world.docs[world.player!]!;
  const fixture = world.map!.fixtures.find(item => item.id === "palace_corvin_drawers")!;
  fixture.open = true;
  world.map!.actors.find(actor => actor.characterId === "player")!.position = fixture.interactionSpot;
  delete doc.characterProperties!.inventory;
  const host = new WorldHost(world);
  const result = host.interactFixtureWithEvent("take_palace_royal_key");
  assert.match(result.message, /Picked up/);
  const current = host.world(), player = current.docs[current.player!]!;
  assert.ok(player.characterProperties!.inventory!.items.some(item => item.id === "palace_royal_key"));
  assert.ok(!current.map!.fixtures.find(item => item.id === fixture.id)!.inventory!.items.some(item => item.id === "palace_royal_key"));
  assert.deepEqual(player.characterProperties!.dnd, doc.characterProperties!.dnd);
  assert.deepEqual(player.frontmatter, doc.frontmatter);
  assert.equal(player.body, doc.body);
  const before = host.snapshot();
  assert.throws(() => host.interactFixtureWithEvent("take_palace_royal_key"), /no longer available/);
  assert.deepEqual(host.snapshot(), before);
});

test("NPC mechanics use document goals and inventory without loading narrative prose", () => {
  const world = loadPlayableWorld(), entry = world.characters.find(path => path.includes("/rowan/"))!;
  const document = world.docs[entry]!;
  assignActivity(world, "rowan", "Inspect the key.");
  const fixture = world.map!.fixtures.find(item => item.id === "palace_corvin_drawers")!;
  fixture.open = true;
  const actor = world.map!.actors.find(actor => actor.characterId === "rowan")!;
  actor.position = fixture.interactionSpot; actor.roomId = fixture.roomId;
  for (const doc of world.characters.map(path => world.docs[path]!)) Object.defineProperty(doc, "body", { get() { throw new Error("Unexpected prose read"); } });
  const mechanics = new PalaceMechanics(world, { conversations: {}, npcActivities: {
    rowan: { status: "active", goal: "Inspect the key.", history: [] },
  } });
  assert.throws(() => mechanics.stepNpcAction("rowan", "take_palace_royal_key", "Old goal"), /changed; replan/);
  const result = mechanics.stepNpcAction("rowan", "take_palace_royal_key", "Inspect the key.");
  assert.equal(result.done, true);
  assert.ok(mechanics.snapshot().properties[entry]!.inventory!.items.some(item => item.id === "palace_royal_key"));
  assert.deepEqual(mechanics.snapshot().npcActivities.rowan!.actionIds, ["take_palace_royal_key"]);
  mechanics.finishNpcRun("rowan", "complete", "Done.");
  assert.equal(mechanics.snapshot().npcActivities.rowan!.reviewPending, true);
});
