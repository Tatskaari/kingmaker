import { test } from "node:test";
import assert from "node:assert/strict";
import { Identity, ScheduleAt, Timestamp } from "spacetimedb";
import type { ReplyResponse } from "../../../shared/protocol/ai.ts";
import { requeueRunning } from "../jobs.ts";
import { TABLES, type TableName } from "../tables.ts";
import { keyOf, memoryHost, type AiPost, type ChangeSet, type MemoryHost, type Restore, type Row } from "./memory.ts";
import { all, caerwynArgs, DEFAULTS, held, identity, sceneNow, scriptedAi, tick } from "./testing.ts";

/**
 * The memory host for real play (browser-design §4.2): each commit's net change told as SpacetimeDB
 * tells a subscriber; a previous run's rows restored, its counters carried on; the jobs run as
 * SpacetimeDB's scheduler runs them, the POSTs overlapping; a real clock, a log and the service's
 * identity injected.
 */

const unused: AiPost = async () => { throw new Error("no POST in this test"); };

test("onCommit is told each commit's net change as SpacetimeDB reports it: an insert, an update of a key there before and after, a delete with the row as it was; a row inserted and deleted, or put back as it was, is no change", () => {
  const told: ChangeSet[] = [];
  const host = memoryHost({ ai: unused, onCommit: changes => told.push(changes) });
  assert.deepEqual(told.splice(0).flatMap(c => c.changes.map(x => `${x.table} ${x.op}`)), ["admin insert", "reaper insert"], "init's commit, as the host is made");

  const [ann, bo, cy] = [identity(1), identity(2), identity(3)];
  host.transact(tx => {
    tx.db.seat.insert({ identity: ann, playerId: 1n });
    tx.db.seat.identity.update({ identity: ann, playerId: 2n });
    tx.db.seat.insert({ identity: bo, playerId: 3n });
  });
  host.transact(tx => {
    tx.db.seat.identity.update({ identity: ann, playerId: 4n });
    tx.db.seat.identity.delete(bo);
    tx.db.seat.insert({ identity: cy, playerId: 5n });
    tx.db.seat.identity.delete(cy);
  });
  host.transact(tx => {
    tx.db.seat.identity.delete(ann);
    tx.db.seat.insert({ identity: ann, playerId: 4n });
  });
  host.transact(tx => tx.db.seat.count());
  assert.throws(() => host.transact(tx => {
    tx.db.seat.insert({ identity: cy, playerId: 6n });
    throw new Error("a bug");
  }), /a bug/);

  assert.deepEqual(told, [
    { changes: [{ table: "seat", key: keyOf(ann), op: "insert", row: { identity: ann, playerId: 2n } }, { table: "seat", key: keyOf(bo), op: "insert", row: { identity: bo, playerId: 3n } }], sequences: {} },
    { changes: [{ table: "seat", key: keyOf(ann), op: "update", row: { identity: ann, playerId: 4n }, old: { identity: ann, playerId: 2n } }, { table: "seat", key: keyOf(bo), op: "delete", row: { identity: bo, playerId: 3n } }], sequences: {} },
  ], "the deleted and put back as it was, the transaction that wrote nothing, and the one that threw tell nothing");
});

test("a commit tells the next id of each autoInc table it inserted into, even when the row it inserted is gone again (its id is never given twice)", () => {
  const told: ChangeSet[] = [];
  const host = memoryHost({ ai: unused, onCommit: changes => told.push(changes) });
  told.splice(0);
  const heard = { id: 0n, gameId: 1n, playerId: 1n, entityKey: "kell" };

  host.transact(tx => tx.db.heard.insert(heard));
  host.transact(tx => tx.db.heard.id.delete(tx.db.heard.insert(heard).id));

  assert.deepEqual(told.map(c => [c.changes.map(x => `${x.op} ${String(x.row.id)}`), c.sequences]), [[["insert 1"], { heard: 2n }], [[], { heard: 3n }]]);
});

test("restore puts a previous run's rows in as they were given, in key order, filling a column added since with its default; each autoInc counter carries on from the higher of its saved value and the table's highest id, a table with no rows left too", () => {
  const when = new Timestamp(1_760_000_000_000_000n);
  const saved = (id: bigint, who: Identity): Row => ({ id, identity: who, gameId: 1n, name: "Wren", concept: "", role: "host", characterId: undefined, placeId: undefined, sceneId: undefined, online: false });
  const host = memoryHost({
    ai: unused,
    restore: {
      rows: { player: [saved(7n, identity(2)), { ...saved(3n, identity(1)), suggestions: false, lastPlayedAt: when }], heard: [{ id: 4n, gameId: 1n, playerId: 3n, entityKey: "kell" }] },
      sequences: { heard: 9n, player: 2n, flag: 5n },
    },
  });

  assert.deepEqual(all(host.db.player).map(p => p.id), [3n, 7n], "in key order");
  const three = [...host.db.player.identity.filter(identity(1))][0]!;
  assert.ok(three.identity instanceof Identity && three.lastPlayedAt instanceof Timestamp, "the Identity and the Timestamp as they were given");
  assert.deepEqual([three.id, three.suggestions, three.lastPlayedAt.microsSinceUnixEpoch], [3n, false, when.microsSinceUnixEpoch]);
  const seven = host.db.player.id.find(7n)!;
  assert.deepEqual([seven.suggestions, seven.lastPlayedAt.microsSinceUnixEpoch], [true, 0n], "saved before suggestions and lastPlayedAt were added: their defaults");

  const ids = host.transact(tx => [
    tx.db.heard.insert({ id: 0n, gameId: 1n, playerId: 3n, entityKey: "cob" }).id,
    tx.db.player.insert({ ...seven, id: 0n, identity: identity(3) }).id,
    tx.db.flag.insert({ id: 0n, gameId: 1n, name: "kell-trusts", value: "yes", sceneId: 1n }).id,
  ]);
  assert.deepEqual(ids, [9n, 8n, 5n], "heard from its saved counter; player past its highest id; flag, with no rows left, from its saved counter");
  assert.throws(() => memoryHost({ ai: unused, restore: { rows: { nosuch: [] } as Restore["rows"] } }), /no table nosuch/);
});

test("a host rebuilt from what its commits told has every row as it was, and plays on: requeueRunning dispatches the think that was running at once, as its next attempt", async () => {
  const kept = keeper();
  const script = scriptedAi();
  const host = memoryHost({ ai: script.ai, seed: 7, onCommit: kept.write });
  host.as(host.owner).installCampaign(caerwynArgs());
  const wren = identity(1);
  host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "ranger" });
  await host.drain();
  const slow = held<ReplyResponse>();
  script.then("reply", () => slow.promise);
  host.as(wren).say({ text: "Who found him?" });
  const cutOff = host.drain();
  await tick();

  const told: ChangeSet[] = [];
  const again = scriptedAi();
  const rebuilt = memoryHost({ ai: again.ai, seed: 8, restore: kept.restore(), onCommit: changes => told.push(changes) });
  assert.deepEqual(everyRow(rebuilt), everyRow(host));
  assert.deepEqual(told, [], "init found its owner and its reaper: nothing written");

  rebuilt.transact(requeueRunning);
  assert.match(rebuilt.logs.join("\n"), /\[restart\] job \d+ .+:t1:reply dispatched again \(attempt 2\)/);
  await rebuilt.drain();

  const scene = all(rebuilt.db.scene)[0]!;
  const lines = sceneNow(rebuilt, scene.id).lines.map(l => l.id);
  assert.deepEqual(sceneNow(rebuilt, scene.id).turns.map(t => t.phase), ["done", "done"]);
  assert.deepEqual(again.to("reply").map(d => d.attempt), ["2"]);
  assert.ok(lines.length > all(host.db.transcript).length && new Set(lines).size === lines.length, "the transcript's ids carried on");

  slow.settle(DEFAULTS.reply);
  await cutOff;
});

test("dispatchDue starts run_job for every dispatch due at once, as SpacetimeDB's scheduler does: the claims commit in order, the POSTs overlap with the claim's timeout, and each answer commits as it lands", async () => {
  const script = scriptedAi();
  const timeouts: Array<number | undefined> = [];
  const host = memoryHost({ ai: (endpoint, body, headers, options) => { timeouts.push(options?.timeoutMs); return script.ai(endpoint, body, headers); }, seed: 7 });
  host.as(host.owner).installCampaign(caerwynArgs());
  const [wren, bo] = [identity(1), identity(2)];
  host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "ranger" });
  host.as(bo).newGame({ campaign: "caerwyn", name: "Bo Fenn", concept: "a ferryman", build: "fighter" });
  await host.drain();
  const [wrens, bos] = all(host.db.scene);
  const first = held<ReplyResponse>(), second = held<ReplyResponse>();
  script.then("reply", () => first.promise, () => second.promise);
  timeouts.splice(0);

  host.as(wren).say({ text: "Who found him?" });
  host.as(bo).say({ text: "Where's the body?" });
  const runs = host.dispatchDue();

  assert.equal(runs.length, 2);
  assert.deepEqual(script.to("reply").map(d => sceneOf(d.key)), [wrens!.id, bos!.id], "both POSTed before either answered, in the order they were dispatched");
  assert.deepEqual(timeouts, [60_000, 60_000]);
  assert.deepEqual(all(host.db.job).map(j => [j.sceneId, j.state, j.attempts]), [[wrens!.id, "running", 1], [bos!.id, "running", 1]]);
  assert.deepEqual(all(host.db.jobDispatch), []);

  second.settle(DEFAULTS.reply);
  await runs[1];
  assert.deepEqual([phaseOf(host, wrens!.id), phaseOf(host, bos!.id)], ["replying", "settling"], "Bo's answer committed while Wren's POST is in flight");
  first.settle(DEFAULTS.reply);
  await Promise.all(runs);
  await host.drain();
  assert.deepEqual([phaseOf(host, wrens!.id), phaseOf(host, bos!.id)], ["done", "done"]);
});

test("a run that throws is logged, never rejected; so is a throw from the commit listener, and the commit stands", async () => {
  const lines: string[] = [];
  const host = memoryHost({ ai: unused, log: line => lines.push(line) });

  host.transact(tx => {
    const job = tx.db.job.insert({
      id: 0n, key: "x:s1:t1:reply", gameId: undefined, sceneId: undefined, turnId: undefined, move: "nosuch", step: "reply", endpoint: "/v1/turns/reply", timeoutMs: 60_000,
      request: "{}", plan: "{}", state: "queued", attempts: 0, deadline: undefined, retryAt: undefined, failingSince: undefined, error: undefined, updatedAt: tx.now,
    });
    tx.db.jobDispatch.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(tx.now.microsSinceUnixEpoch), jobId: job.id });
  });
  await Promise.all(host.dispatchDue());
  assert.deepEqual(lines, ["[run_job] job 1 stopped: Error: no move called nosuch"], "its commit and its fail threw (a move nobody has)");

  const heard: string[] = [];
  const listened = memoryHost({ ai: unused, log: line => heard.push(line), onCommit: () => { throw new Error("a listener's bug"); } });
  listened.transact(tx => tx.db.seat.insert({ identity: identity(1), playerId: 1n }));
  assert.equal(listened.db.seat.count(), 1n);
  assert.deepEqual(heard, ["[onCommit] Error: a listener's bug", "[onCommit] Error: a listener's bug"], "init's commit, then the seat's");
});

test("an injected clock is each transaction's time, and advance() is refused; the log goes where it's told; the service is the identity given", () => {
  let time = new Timestamp(1_000_000n);
  const lines: string[] = [];
  const service = new Identity(0x5e7en);
  const host = memoryHost({ ai: unused, clock: () => time, log: line => lines.push(line), service });

  assert.equal(host.transact(tx => tx.now), time);
  time = new Timestamp(2_000_000n);
  assert.equal(host.transact(tx => { tx.log("the line"); return tx.now; }), time);
  assert.equal(host.now(), time);
  assert.throws(() => host.advance(1000), /injected clock/);
  assert.deepEqual([lines, host.logs], [["the line"], []]);

  assert.equal(host.service, service);
  assert.equal(host.streamReply({ turnId: 1n, attempt: 1, seq: 1, speaker: "gm", text: "", done: false }), undefined, "from the service: no turn to write, but not refused");
  assert.throws(() => memoryHost({ ai: unused, service, env: { AI_IDENTITY: "0x10ca1a1" } }), /isn't the service/);
});

// ---------------------------------------------------------------------------------------------

/** What a host that keeps rows does with each commit (a SimStore, in memory): each row's last state by table and key, and the counters. */
function keeper() {
  const rows = new Map<string, { table: TableName; row?: Row }>();
  const sequences: NonNullable<Restore["sequences"]> = {};
  return {
    write(changes: ChangeSet) {
      for (const c of changes.changes) rows.set(`${c.table} ${c.key}`, { table: c.table, row: c.op === "delete" ? undefined : c.row });
      Object.assign(sequences, changes.sequences);
    },
    restore(): Restore {
      const byTable: Restore["rows"] = {};
      for (const { table, row } of rows.values()) if (row) (byTable[table] ??= []).push(row);
      return { rows: byTable, sequences };
    },
  };
}

/** Every table's rows, each in its keys' order. */
const everyRow = (host: MemoryHost) => Object.fromEntries(Object.entries(TABLES).map(([table, meta]) => {
  const rows = [...(host.db as unknown as Record<string, { iter(): Iterable<Row> }>)[table]!.iter()];
  return [table, rows.sort((a, b) => (keyOf(a[meta.primaryKey]) < keyOf(b[meta.primaryKey]) ? -1 : 1))];
}));

/** The scene a turn's key is for (<game>:s<scene>:t<n>:<step>). */
const sceneOf = (key: string) => BigInt(/:s(\d+):/.exec(key)![1]!);

/** A scene's last turn's phase. */
const phaseOf = (host: MemoryHost, sceneId: bigint) => sceneNow(host, sceneId).turns.at(-1)!.phase;
