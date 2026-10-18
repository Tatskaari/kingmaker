import assert from "node:assert/strict";
import { test } from "node:test";
import { CLIENT_TABLES, type ToClient } from "../../shared/protocol/port.ts";
import { memoryHost, type ChangeSet } from "../../simulation/src/host/memory.ts";
import { all, caerwynArgs, identity, scriptedAi } from "../../simulation/src/host/testing.ts";
import { pushTo, type Push } from "./push.ts";

/**
 * What a client is pushed (browser-design §3): a snapshot of everything it may see, its own views
 * made for it, then a tx for each commit with the net change for each primary key, by the tables'
 * SQL names, and its views' changes by their keys; never a private table's row, and nothing for a
 * commit with nothing in it for the client. The town's (town-design §3.1) cross in the map's own
 * rows; its clock's, its talks' records and its invented looks' rows never.
 */

/** A memory host with the hanged clerk installed (starting on the map, as the dev pack does, with `map`), each commit told to its push as the page host tells it, and the commits kept. */
function pushed(options: { map?: boolean } = {}) {
  const script = scriptedAi();
  const commits: ChangeSet[] = [];
  let push: Push | undefined;
  const host = memoryHost({ ai: script.ai, seed: 7, onCommit: commit => { commits.push(commit); push?.commit(commit); } });
  host.as(host.owner).installCampaign(caerwynArgs(options));
  push = pushTo(host);
  return { host, push, commits };
}

type Tx = ToClient & { kind: "tx" };
const txsIn = (sent: ToClient[]) => sent.filter((message): message is Tx => message.kind === "tx");
const named = (tx: Tx) => tx.changes.map(change => `${change.table} ${change.op}`);
const snapshotOf = (sent: ToClient[]) => (sent[0] as ToClient & { kind: "snapshot" }).tables;

test("a client's snapshot is every row of the public tables, by their SQL names, and its own views; no private table's", () => {
  const { host, push } = pushed();
  const wren = identity(1);
  host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "ranger" });
  const sent: ToClient[] = [], other: ToClient[] = [];
  push.join(wren, message => sent.push(message));
  push.join(identity(2), message => other.push(message));

  const tables = snapshotOf(sent);
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(tables).sort(), Object.keys(CLIENT_TABLES).sort());
  assert.equal(tables.map_def.length, all(host.db.mapDef).length);
  assert.equal(tables.player_character.length, all(host.db.playerCharacter).length);
  assert.deepEqual(tables.my_seat.map(row => row.playerId), [all(host.db.player)[0]!.id]);
  assert.equal(tables.my_games.length, 1);
  const theirs = snapshotOf(other);
  assert.deepEqual([theirs.my_seat, theirs.my_names, theirs.my_games, theirs.my_creation], [[], [], [], []], "another caller's views are its own");
});

test("each commit is one tx: its net change for each key by the tables' SQL names, then the views' by their keys; no private row, and nothing for a commit with nothing in it for the client", async () => {
  const { host, push, commits } = pushed();
  const wren = identity(1), tamsin = identity(2);
  const sent: ToClient[] = [], watcher: ToClient[] = [];
  push.join(wren, message => sent.push(message));
  push.join(tamsin, message => watcher.push(message));

  host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "ranger" });
  const made = txsIn(sent)[0]!;
  assert.ok(["game insert", "player insert", "sheet insert", "turn insert"].every(change => named(made).includes(change)), named(made).join(", "));
  const views = named(made).filter(change => change.startsWith("my_"));
  assert.deepEqual([views[0], views.at(-1), views.length > 2], ["my_seat insert", "my_games insert", true], "the seat, the names on stage and the game");
  assert.deepEqual(named(made).slice(-views.length), views, "the views after the tables");
  assert.deepEqual(named(txsIn(watcher)[0]!).filter(change => change.startsWith("my_")), [], "another caller's views don't move");

  const before = commits.length;
  await host.drain();
  host.as(wren).say({ text: "Sergeant, who found him?" });
  await host.drain();
  const txs = txsIn(sent);
  assert.ok(txs.length - 1 < commits.length - before, `fewer txs (${txs.length - 1}) than commits (${commits.length - before}): a job's claim is private`);
  assert.deepEqual([...new Set(txs.flatMap(named).map(change => change.split(" ")[0]!))].filter(table => !(table in CLIENT_TABLES)), [], "only the client's tables cross");
  const replaced = txs.find(tx => named(tx).includes("scene_suggestion delete"))!;
  assert.deepEqual(named(replaced).filter(change => change.startsWith("scene_suggestion")).sort(), [...Array(4).fill("scene_suggestion delete"), ...Array(4).fill("scene_suggestion insert")], "the opening's lines deleted as the reply's go in, in one tx");
  assert.ok(txs.some(tx => named(tx).includes("turn update")), "a turn's row updated in place");
});

test("the town crosses in the map's own rows: a Fire Bolt's words on the explore row and the door alight in the place's town, then the clock's rounds; the clock's own row never", () => {
  const { host, push } = pushed({ map: true });
  const wren = identity(1);
  host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "wizard" });
  host.advance(1000);
  const sent: ToClient[] = [];
  push.join(wren, message => sent.push(message));
  assert.match(String(snapshotOf(sent).sheet[0]!.actions), /"Fire Bolt"/, "the sheet's catalogue, for the menu");

  assert.equal(host.as(wren).walk({ to: { x: 22, y: 8 } }), undefined);
  assert.equal(host.as(wren).cast({ spell: "fire-bolt", at: { x: 25, y: 6 } }), undefined);
  const cast = txsIn(sent).at(-1)!;
  const changed = (tx: Tx, table: string) => tx.changes.find(change => change.table === table && change.op === "update")?.row;
  assert.match(String(changed(cast, "explore")?.said), /catches fire/);
  assert.match(String(changed(cast, "place")?.town), /"burning"/);

  host.advance(12_000);
  host.tickPlaces();
  const ticked = txsIn(sent).at(-1)!;
  assert.notEqual(ticked, cast, "the clock's rounds are a tx of their own");
  assert.ok((changed(ticked, "place")?.round as number) > (changed(cast, "place")?.round as number), "two rounds on");
  assert.equal(all(host.db.placeTick).length, 1, "the clock's row is there");
  const crossed = new Set(txsIn(sent).flatMap(tx => tx.changes.map(change => change.table as string)));
  assert.deepEqual(["place_tick", "talk_record", "look_invention"].filter(table => crossed.has(table) || table in snapshotOf(sent)), []);
});
