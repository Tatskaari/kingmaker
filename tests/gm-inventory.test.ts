import assert from "node:assert/strict";
import test from "node:test";
import { clone, create, toJsonString } from "@bufbuild/protobuf";
import { InventorySchema, ItemInstanceSchema } from "../packages/contracts/src/index.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { GameMasterTools } from "../packages/conversation/src/gm-tools.js";
import { loadPlayableWorld } from "./fixtures.js";

const bird = () => create(ItemInstanceSchema, { id: "gift-wooden-bird", name: "Wooden bird", details: "Faded blue lacquer", quantity: 1 });
test("GM inventory writes create one real gift and preserve unrelated properties", async () => {
  const backing = createScenarioServices(loadPlayableWorld());
  const actorId = "player";
  const documentBefore = await backing.docs.read(backing.scenario.info().player!);
  const sheet = backing.currentWorld().simulation!.runtimeCharacters.player!.dnd;
  const live = backing.currentWorld();
  const unchanged = live.docs[live.scenario];
  const before = await backing.inventory.read(actorId);
  const inventory = clone(InventorySchema, before.inventory ?? create(InventorySchema));
  inventory.items.push(bird());
  const runtime = new ConversationRuntime({ services: backing });
  const gm = new GameMasterTools(runtime.services, "peregrine");
  await gm.begin();
  await gm.call("update_inventories", { changes: [{ actorId, expectedSha: before.sha, inventoryJson: toJsonString(InventorySchema, inventory) }] });
  assert.equal(backing.currentWorld(), live);
  assert.equal(backing.currentWorld().docs[live.scenario], unchanged);
  const after = await backing.inventory.read(actorId);
  assert.equal(after.inventory!.items.filter(item => item.id === bird().id).length, 1);
  assert.strictEqual(backing.currentWorld().simulation!.runtimeCharacters.player!.dnd, sheet);
  assert.deepEqual(await backing.docs.read(documentBefore.path), documentBefore);
  await assert.rejects(backing.inventory.commit([{ actorId, expectedSha: before.sha, inventory }]), /changed/);
});

test("inventory trades commit both owners together and reject duplicate ownership without partial writes", async () => {
  const backing = createScenarioServices(loadPlayableWorld());
  const player = "player", giver = "peregrine";
  const before = await backing.inventory.read(giver);
  const inventory = clone(InventorySchema, before.inventory ?? create(InventorySchema));
  inventory.items.push(bird());
  await backing.inventory.commit([{ actorId: giver, expectedSha: before.sha, inventory }]);
  const source = await backing.inventory.read(giver), target = await backing.inventory.read(player);
  const received = clone(InventorySchema, target.inventory ?? create(InventorySchema)); received.items.push(bird());
  const untouched = backing.scenario.read();
  await assert.rejects(backing.inventory.commit([{ actorId: player, expectedSha: target.sha, inventory: received }]), /Invalid simulation move/);
  assert.deepEqual(backing.scenario.read(), untouched);
  inventory.items = inventory.items.filter(item => item.id !== bird().id);
  await backing.inventory.commit([{ actorId: giver, expectedSha: source.sha, inventory }, { actorId: player, expectedSha: target.sha, inventory: received }]);
  assert.equal((await backing.inventory.read(giver)).inventory!.items.some(item => item.id === bird().id), false);
  assert.equal((await backing.inventory.read(player)).inventory!.items.filter(item => item.id === bird().id).length, 1);
});

test("inventory versions ignore document edits and cover physical inventory mutations", async () => {
  const backing = createScenarioServices(loadPlayableWorld());
  const gm = new GameMasterTools(new ConversationRuntime({ services: backing }).services);
  const before = await backing.inventory.read("player");
  assert.deepEqual(await gm.call("read_inventory", { actorId: "player" }), before);
  const doc = await backing.docs.read(backing.scenario.info().player!);
  await backing.docs.replace(doc.path, doc.sha, doc.document.body, doc.document.body + "\nA new memory.");
  assert.equal((await backing.inventory.read("player")).sha, before.sha);
  const inventory = create(InventorySchema, { items: [bird()] });
  await backing.inventory.commit([{ actorId: "player", expectedSha: before.sha, inventory }]);
  const read = await backing.inventory.read("player");
  const changed = create(InventorySchema, { items: [{ ...bird(), quantity: 2 }] });
  await backing.inventory.commit([{ actorId: "player", expectedSha: read.sha, inventory: changed }]);
  const result = await gm.call("update_inventories", { changes: [{ actorId: "player", expectedSha: read.sha,
    inventoryJson: toJsonString(InventorySchema, inventory) }] });
  assert.equal((result as { error: string }).error, "inventory_conflict");
  assert.equal((await backing.inventory.read("player")).inventory!.items[0]!.quantity, 2);
});

test("GM inventories cannot duplicate items already held by a fixture", async () => {
  const backing = createScenarioServices(loadPlayableWorld());
  const before = await backing.inventory.read("player");
  const key = backing.currentWorld().simulation!.map!.fixtures.flatMap(fixture => fixture.inventory?.items ?? [])
    .find(item => item.id === "palace_royal_key")!;
  assert.ok(key);
  await assert.rejects(backing.inventory.commit([{ actorId: "player", expectedSha: before.sha,
    inventory: create(InventorySchema, { items: [key] }) }]), /Invalid simulation move/);
  assert.deepEqual(await backing.inventory.read("player"), before);
});

test("inventory service commands update versions and return detached reads", async () => {
  const backing = createScenarioServices(loadPlayableWorld());
  const before = await backing.inventory.read("player");
  await backing.inventory.addToInventory("player", bird());
  const added = await backing.inventory.read("player");
  assert.notEqual(added.sha, before.sha);
  added.inventory!.items.length = 0;
  assert.ok((await backing.inventory.read("player")).inventory!.items.some(item => item.id === bird().id));
  const room = backing.currentWorld().simulation!.map!.rooms[0]!.id;
  await backing.inventory.transferBetweenInventories("player", room, bird().id);
  assert.ok(!((await backing.inventory.read("player")).inventory?.items ?? []).some(item => item.id === bird().id));
  await backing.inventory.removeFromInventory(room, bird().id);
  assert.ok(!backing.currentWorld().simulation!.map!.rooms[0]!.inventory!.items.some(item => item.id === bird().id));
});
