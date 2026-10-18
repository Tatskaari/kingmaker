import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryStores } from "../../ai/service/memory-stores.ts";
import { memoryHost, type MemoryHost } from "../../simulation/src/host/memory.ts";
import { caerwynArgs, identity, scriptedAi } from "../../simulation/src/host/testing.ts";
import { keyOf } from "../../simulation/src/host/memory.ts";
import { TABLES, type TableName } from "../../simulation/src/tables.ts";
import { KEEP_LINES } from "./ai-store.ts";
import { memoryDatabase, metaOf, type Database, type Write } from "./database.ts";
import { DATA_VERSION, openStorage } from "./sim-store.ts";
import { writeBehind } from "./write-behind.ts";

/**
 * What the page host keeps (browser-design §5), on the database in memory (the one a browser that
 * keeps nothing plays on, and the contract test's): the writes go in a moment after they're made,
 * one transaction a flush; a write that fails goes with the next; the simulation's commits come back
 * as the rows a restore carries on from; sessions and the database's identity are kept; an older
 * build's records are cleared; and the AI service's answer goes in before its put returns, with the
 * docs its think wrote, while its logs are capped and its spend kept as today's.
 */

/** The database in memory, each write it was given seen, and the next `failing` writes refused, as a full disk refuses them. */
function watched() {
  const database = memoryDatabase();
  const writes: Write[][] = [];
  let failing = 0;
  const seen: Database = {
    ...database,
    async write(batch) {
      if (failing > 0) {
        failing--;
        throw new Error("the quota is exceeded");
      }
      writes.push(batch);
      await database.write(batch);
    },
  };
  return { database: seen, writes, fail: (n = 1) => { failing = n; } };
}

const quiet = { failed() {}, keptAgain() {} };
/** A turn of the event loop: the writes' promises settle. */
const settled = () => new Promise(resolve => setImmediate(resolve));

test("writes go in a moment after they're made, as one transaction: 150 ms after the last, and within a second of the first while they keep coming", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { database, writes } = watched();
  const queue = writeBehind(database, quiet);

  queue.put("meta", "a", 1);
  t.mock.timers.tick(100);
  queue.put("meta", "b", 2);
  t.mock.timers.tick(100);
  await settled();
  assert.equal(writes.length, 0, "put off by the second write");
  t.mock.timers.tick(50);
  await settled();
  assert.deepEqual(writes.map(batch => batch.map(write => write.key)), [["a", "b"]]);

  for (let n = 0; n < 20; n++) {
    queue.put("meta", `every 100 ms ${n}`, n);
    t.mock.timers.tick(100);
    await settled();
  }
  assert.deepEqual(writes.slice(1).map(batch => batch.length), [10, 10], "two seconds of writes every 100 ms: one transaction a second");
});

test("a write that fails goes in with the next (a newer write to the same record winning), and the page hears the game isn't kept, then that it is again", async () => {
  const { database, writes, fail } = watched();
  const heard: string[] = [];
  const queue = writeBehind(database, { failed: error => heard.push(`failed: ${(error as Error).message}`), keptAgain: () => heard.push("kept again") });

  fail();
  queue.put("meta", "a", 1);
  queue.put("meta", "b", 1);
  await queue.flush();
  queue.put("meta", "b", 2);
  await queue.flush();

  assert.deepEqual(heard, ["failed: the quota is exceeded", "kept again"]);
  assert.deepEqual(writes, [[{ store: "meta", key: "a", value: 1 }, { store: "meta", key: "b", value: 2 }]]);
  assert.deepEqual(Object.fromEntries(metaOf(await database.read())), { a: 1, b: 2 });
});

test("closed, the queue writes what it had and takes nothing after: another tab has the game", async () => {
  const { database, writes } = watched();
  const queue = writeBehind(database, quiet);
  queue.put("meta", "before", 1);
  await queue.close();
  queue.put("meta", "after", 2);
  await queue.flush();

  assert.deepEqual(writes.map(batch => batch.map(write => write.key)), [["before"]]);
});

/** Every row of every table, by its key, as a test compares two hosts. */
function rowsOf(host: MemoryHost): Record<string, Record<string, unknown>> {
  const db = host.db as unknown as Record<string, { iter(): Iterable<Record<string, unknown>> }>;
  return Object.fromEntries(Object.entries(TABLES).map(([table, meta]) => [table, Object.fromEntries([...db[table]!.iter()].map(row => [keyOf(row[meta.primaryKey]), row]))]));
}

test("the simulation's commits, kept and read back: a restore of them is the same rows, revived, and its ids carry on", async () => {
  const database = memoryDatabase();
  const first = await openStorage(database, () => {});
  const script = scriptedAi();
  const host = memoryHost({ ai: script.ai, seed: 7, onCommit: first.sim.write, database: first.sim.database });
  const wren = identity(1);
  host.as(host.owner).installCampaign(caerwynArgs());
  host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "ranger" });
  await host.drain();
  host.as(wren).say({ text: "Sergeant, who found him?" });
  await host.drain();
  await first.flush();

  const second = await openStorage(database, () => {});
  const again = memoryHost({ ai: script.ai, seed: 7, restore: second.sim.restore!, database: second.sim.database });
  assert.deepEqual(rowsOf(again), rowsOf(host), "every table's rows, public and private, Identities and Timestamps as their classes");
  assert.ok(second.sim.database.isEqual(first.sim.database), "the database's identity is kept");

  const before = [...host.db.transcript.iter()].map(line => line.id);
  assert.equal(again.as(wren).say({ text: "And the rope?" }), undefined);
  const said = [...again.db.transcript.iter()].find(line => line.text === "And the rope?")!;
  assert.ok(before.every(id => id < said.id), "the transcript's ids carry on past the kept ones");
});

test("a session's identity is minted the first time and kept, and so is the database's own; a table this build hasn't got is dropped", async () => {
  const database = memoryDatabase();
  await database.write([{ store: "meta", key: "dataVersion", value: DATA_VERSION }, { store: "rows", key: ["oldTable", "1n"], value: { id: 1n } }]);
  const first = await openStorage(database, () => {});
  const tamsin = first.sim.session("tamsin");
  assert.ok(first.sim.session("tamsin").isEqual(tamsin));
  assert.ok(!first.sim.session("default").isEqual(tamsin), "each name its own");
  assert.equal(first.sim.restore?.rows["oldTable" as TableName], undefined);
  await first.flush();

  const second = await openStorage(database, () => {});
  assert.ok(second.sim.session("tamsin").isEqual(tamsin));
  assert.ok(second.sim.database.isEqual(first.sim.database));
  assert.deepEqual((await database.read()).rows, [], "the old table's rows deleted");
});

test("what an older build kept is cleared, not misread", async t => {
  const warned = t.mock.method(console, "warn", () => {});
  const database = memoryDatabase();
  await database.write([{ store: "meta", key: "dataVersion", value: DATA_VERSION - 1 }, { store: "rows", key: ["game", "1n"], value: { id: 1n } }, { store: "answers", key: "g:s1:t0:open", value: {} }]);
  const storage = await openStorage(database, () => {});
  await storage.flush();
  const kept = await database.read();

  assert.equal(storage.sim.restore, undefined, "a new database");
  assert.deepEqual([kept.rows, kept.answers], [[], []]);
  assert.equal(metaOf(kept).get("dataVersion"), DATA_VERSION);
  assert.match(String(warned.mock.calls[0]?.arguments[0]), /an older build's \(data version 0, this build's 1\)/);
});

test("an answer is kept before the AI service's put returns, in one write with the docs its think wrote; the next run's stores start from them", async () => {
  const { database, writes } = watched();
  const stores = memoryStores((await openStorage(database, () => {})).ai);
  stores.docs.overlay("g1").write("Cast/Sergeant Agnes Kell/memories/a.md", "She saw the investigator climb the hoist.");
  const answer = { requestHash: "h", status: 200 as const, body: "{\"usage\":{}}", at: new Date().toISOString() };
  await stores.answers.put("g1:s1:t1:remember", answer);

  assert.equal(writes.length, 1, "kept by the put itself, not a moment later");
  assert.deepEqual(writes[0]!.filter(write => write.store !== "meta").map(write => write.store), ["docs", "answers"]);
  const next = memoryStores((await openStorage(database, () => {})).ai);
  assert.deepEqual(await next.answers.get("g1:s1:t1:remember"), answer);
  assert.equal(next.docs.overlay("g1").read("Cast/Sergeant Agnes Kell/memories/a.md"), "She saw the investigator climb the hoist.");
});

test("each game's call log keeps its last lines and its memory reviews theirs; today's spend is kept as the ceiling reads it", async () => {
  const { database, writes } = watched();
  const storage = await openStorage(database, () => {});
  const stores = memoryStores(storage.ai);
  for (let n = 0; n < KEEP_LINES + 5; n++) stores.calls.append("g1", { n });
  stores.reviews.append("g1", { n: 0 });
  stores.calls.append("g2", { n: 0 });
  stores.ledger.append({ at: new Date().toISOString(), costUsd: 0.25 });
  stores.ledger.append({ at: new Date().toISOString(), costUsd: 0.5 });
  await storage.flush();

  const logs = new Map<string, unknown>();
  for (const { store, key, value } of writes.flat()) {
    if (store !== "logs") continue;
    if (value === undefined) logs.delete(JSON.stringify(key));
    else logs.set(JSON.stringify(key), value);
  }
  const lines = (game: string, log: string) => [...logs.keys()].filter(key => key.startsWith(JSON.stringify([game, log]).slice(0, -1)));
  assert.equal(lines("g1", "calls").length, KEEP_LINES);
  assert.ok(!logs.has(JSON.stringify(["g1", "calls", 4])) && logs.has(JSON.stringify(["g1", "calls", 5])), "the oldest gone first");
  assert.deepEqual([lines("g1", "reviews").length, lines("g2", "calls").length], [1, 1]);
  assert.equal(await memoryStores((await openStorage(database, () => {})).ai).ledger.spentToday(), 0.75);

  // Read back for a report of a problem (the AI service's GET /v1/games/{game}/calls), oldest first, a line handed in just now too.
  stores.calls.append("g2", { n: 1 });
  const kept = await stores.calls.read("g1");
  assert.deepEqual([kept.length, kept[0], kept.at(-1)], [KEEP_LINES, { n: 5 }, { n: KEEP_LINES + 4 }]);
  assert.deepEqual([await stores.calls.read("g2"), await stores.reviews.read("g1"), await stores.calls.read("g3")], [[{ n: 0 }, { n: 1 }], [{ n: 0 }], []]);
});
