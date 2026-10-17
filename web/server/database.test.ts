import assert from "node:assert/strict";
import { test } from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { Identity, Timestamp } from "spacetimedb";
import { memoryDatabase, metaOf, openIndexedDb, type Database, type Write } from "./database.ts";

/**
 * The page's database (browser-design §5), in IndexedDB (fake-indexeddb's, in Node) and in memory,
 * held to the same things: records kept as structured clones (the SDK's classes left only their
 * fields, for revive), read back by key, deleted and cleared, and a write that can't be kept keeping
 * none of it, as one transaction.
 */

const RECORDS: Write[] = [
  { store: "rows", key: ["player", "1n"], value: { id: 1n, identity: new Identity(0xabcn), lastPlayedAt: new Timestamp(5n), concept: undefined } },
  { store: "rows", key: ["player", "2n"], value: { id: 2n } },
  { store: "meta", key: "sequences", value: { player: 3n } },
  { store: "answers", key: "g1:s1:t0:open", value: { requestHash: "h", status: 200, body: "{}", at: "2026-10-17T09:00:00.000Z" } },
  { store: "docs", key: ["g1", "Cast/Sergeant Agnes Kell/memories/index.md"], value: "# Memories" },
  { store: "logs", key: ["g1", "calls", 0], value: { operation: "gm.reply" } },
];

for (const [kind, open] of [["IndexedDB", () => openIndexedDb("kingmaker-v2-web /kingmaker/pr-preview/pr-0/play/", new IDBFactory())], ["memory", async () => memoryDatabase()]] as const) {
  test(`${kind}: records kept as structured clones and read back by key (the logs never), deleted and cleared; a write that can't be kept keeps none of it`, async () => {
    const database: Database = await open();
    await database.write(RECORDS);
    await database.write([{ store: "rows", key: ["player", "2n"] }]);
    const read = await database.read();

    assert.deepEqual(read.rows, [[["player", "1n"], { id: 1n, identity: { __identity__: 0xabcn }, lastPlayedAt: { __timestamp_micros_since_unix_epoch__: 5n }, concept: undefined }]]);
    assert.deepEqual(Object.fromEntries(metaOf(read)), { sequences: { player: 3n } });
    assert.deepEqual(read.answers.map(([key]) => key), ["g1:s1:t0:open"]);
    assert.deepEqual(read.docs, [[["g1", "Cast/Sergeant Agnes Kell/memories/index.md"], "# Memories"]]);
    assert.equal("logs" in read, false);

    await assert.rejects(database.write([{ store: "meta", key: "kept", value: 1 }, { store: "meta", key: "not a clone", value: () => {} }]));
    assert.equal(metaOf(await database.read()).has("kept"), false, "the whole write refused");

    await database.clear();
    assert.deepEqual(Object.values(await database.read()).flat(), []);
  });
}
