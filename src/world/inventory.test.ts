import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorld, applyOps } from "./scene-world.ts";
import { inventory, InventoryConflictError, InventoryError, startingPurse } from "./inventory.ts";
import { drownedRatWorld } from "../../scenes/worlds/drowned-rat.ts";

const rat = () => buildWorld("drowned-rat", drownedRatWorld, [{ id: "nan-quill", name: "Nan Quill" }, { id: "hobb", name: "Big Hobb Mallory" }, { id: "kell", name: "Sergeant Agnes Kell" }], { name: "Odo" });

test("a purse, and paying part of a stack", () => {
  const world = rat();
  const inv = inventory(world, 1);
  for (const coin of startingPurse()) inv.add("player", coin);
  const pennies = inv.read("player").items.find(i => i.name === "pennies")!;
  assert.equal(pennies.quantity, 12);
  const paid = inv.transfer("player", "nan-quill", pennies.id, { quantity: 2 });
  assert.equal(inv.read("player").items.find(i => i.name === "pennies")!.quantity, 10);
  assert.equal(world.entities[paid]!.quantity, 2);
  // More of the same joins the stack she already has.
  inv.transfer("player", "nan-quill", pennies.id, { quantity: 3 });
  assert.equal(inv.read("nan-quill").items.filter(i => i.name === "pennies").length, 1);
  assert.equal(inv.read("nan-quill").items.find(i => i.name === "pennies")!.quantity, 5);
});

test("you can only give what you have", () => {
  const world = rat();
  const inv = inventory(world, 1);
  // Manners hangs behind the bar (the bar area has it), not on Hobb.
  assert.throws(() => inv.transfer("hobb", "player", "manners"), InventoryError);
  assert.throws(() => inv.transfer("player", "kell", "no-such-thing"), InventoryError);
  assert.throws(() => inv.transfer("player", "rules-board", "manners"), InventoryError); // a sign can't hold things
  // Nan picks it up, then hands it over: two valid transfers.
  inv.transfer("bar", "nan-quill", "manners");
  inv.transfer("nan-quill", "player", "manners");
  assert.equal(world.entities.manners!.parent, "player");
});

test("commit rearranges only what the owners hold, and only against fresh versions", () => {
  const world = rat();
  const inv = inventory(world, 1);
  const coin = inv.add("player", { name: "a heron penny" });
  const mine = inv.read("player"), hers = inv.read("kell");
  // Swap: the penny goes to Kell.
  inv.commit([{ ownerId: "player", expectedVersion: mine.version, items: [] }, { ownerId: "kell", expectedVersion: hers.version, items: [coin] }]);
  assert.equal(world.entities[coin]!.parent, "kell");
  // A stale version is refused, and so is conjuring an item out of nowhere.
  assert.throws(() => inv.commit([{ ownerId: "player", expectedVersion: mine.version, items: [coin] }, { ownerId: "kell", expectedVersion: inv.read("kell").version, items: [] }]), InventoryConflictError);
  assert.throws(() => inv.commit([{ ownerId: "player", expectedVersion: inv.read("player").version, items: ["manners"] }]), InventoryError);
});

test("the stage manager's give goes through the service (and fails safely)", () => {
  const world = rat();
  inventory(world, 1).add("player", { name: "pennies", quantity: 12 });
  const ok = applyOps(world, [{ op: "give", what: "pennies", to: "nan-quill", how: "", name: "", kind: "", text: "", add: [], remove: [], quantity: 2 }], 2);
  assert.equal(ok.problems.length, 0);
  assert.equal(inventory(world, 2).read("player").items.find(i => i.name === "pennies")!.quantity, 10);
  const bad = applyOps(world, [{ op: "give", what: "manners", to: "player", how: "", name: "", kind: "", text: "", add: [], remove: [] }], 3);
  // Manners was on the bar's hooks, so "give" moves it from the bar to the player: valid. A thing no one has can't be given.
  assert.equal(bad.problems.length, 0);
  const none = applyOps(world, [{ op: "give", what: "the king's crown", to: "player", how: "", name: "", kind: "", text: "", add: [], remove: [] }], 4);
  assert.equal(none.problems.length, 1);
});

test("what's inside someone's own things can change hands (the page sewn into the boots Cob wears)", async () => {
  const { hangedClerkWorld } = await import("../../scenes/worlds/hanged-clerk.ts");
  const world = buildWorld("hanged-clerk", hangedClerkWorld, [{ id: "cob", name: "Cob" }, { id: "kell", name: "Sergeant Agnes Kell" }], { name: "Kren" });
  assert.equal(world.entities["ledger-page"]!.parent, "boots");
  const blank = { to: "", how: "", name: "", kind: "", text: "", add: [], remove: [] };
  const done = applyOps(world, [{ ...blank, op: "give", what: "ledger-page", to: "player" }], 12, "stage");
  assert.deepEqual(done.problems, []);
  assert.equal(world.entities["ledger-page"]!.parent, "player");
  // Something inside another owner's things still isn't theirs to give.
  assert.throws(() => inventory(world, 13).transfer("kell", "player", "boots"), InventoryError);
});
