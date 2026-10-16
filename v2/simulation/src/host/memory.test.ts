import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "spacetimedb";
import { memoryHost } from "./memory.ts";
import { identity } from "./testing.ts";

/** The memory host's tables behave as SpacetimeDB's do where the moves rely on it (v0-design §4.5). */

const newHost = () => memoryHost({ ai: async () => ({ status: 200, body: "{}" }) });
const at = new Timestamp(0n);

test("autoInc ids from 0n; find by key gives null when there's none; rows handed out are copies", () => {
  const host = newHost();
  const first = host.transact(tx => tx.db.game.insert({ id: 0n, uid: "a", campaign: "c", campaignVersion: "1", title: "t", time: "morning", day: 1, hostId: 0n, status: "playing", createdAt: at }));
  const second = host.transact(tx => tx.db.game.insert({ ...first, id: 0n, uid: "b" }));

  assert.deepEqual([first.id, second.id], [1n, 2n]);
  assert.equal(host.db.game.id.find(9n), null);
  assert.equal(host.db.game.uid.find("b")?.id, 2n);
  const copy = host.db.game.id.find(1n)!;
  copy.title = "changed";
  assert.equal(host.db.game.id.find(1n)!.title, "t");
});

test("a throw rolls back every write of its transaction", () => {
  const host = newHost();
  assert.throws(() => host.transact(tx => {
    tx.db.seat.insert({ identity: identity(1), playerId: 1n });
    tx.db.admin.identity.delete(host.owner);
    throw new Error("a bug");
  }), /a bug/);

  assert.equal(host.db.seat.count(), 0n);
  assert.ok(host.db.admin.identity.find(host.owner), "init's owner row is back");
});

test("primary keys and unique columns refuse a second row; indexes filter by a value, or by a prefix of their columns", () => {
  const host = newHost();
  const row = { id: 0n, gameId: 1n, placeId: 1n, ord: 1, key: "kell", parentId: undefined, name: "Kell", called: undefined, kind: "person", prefab: undefined, createdTurn: undefined, gone: false };
  host.transact(tx => { tx.db.entity.insert(row); tx.db.entity.insert({ ...row, key: "cob", ord: 2 }); tx.db.entity.insert({ ...row, gameId: 2n, ord: 3 }); });

  assert.throws(() => host.transact(tx => tx.db.seat.insert({ identity: host.owner, playerId: 1n }) && tx.db.seat.insert({ identity: host.owner, playerId: 2n })), /unique violation/);
  assert.deepEqual([...host.db.entity.byGameKey.filter([1n, "kell"])].map(e => e.id), [1n]);
  assert.deepEqual([...host.db.entity.byGameKey.filter(1n)].map(e => e.key), ["kell", "cob"]);
  assert.deepEqual([...host.db.entity.placeId.filter(1n)].length, 3);
  assert.equal(host.transact(tx => tx.db.entity.placeId.delete(1n)), 3);
});

test("writes outside a transaction, and one transaction inside another, are refused", () => {
  const host = newHost();
  assert.throws(() => host.db.admin.insert({ identity: identity(1), role: "owner" }), /outside a transaction/);
  assert.throws(() => host.transact(() => host.transact(() => 1)), /doesn't nest/);
  assert.throws(() => (host.db as unknown as Record<string, unknown>).nosuch, /no table nosuch/);
});
