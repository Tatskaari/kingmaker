import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { test, type TestContext } from "node:test";
import { Identity, Timestamp } from "spacetimedb";
import { CLIENT_TABLES, PROTOCOL, type ClientTable, type Row, type ToClient, type ToServer } from "../../shared/protocol/port.ts";
import { YARD } from "../check/fixture.ts";
import { CAERWYN_MAPS } from "../check/map.ts";
import { yardPlaceRows, YARD_PLACE, YARD_SCENE } from "../check/place.ts";
import { DbConnection } from "../module_bindings/index.ts";
import { describe as titleLine } from "../title/model.ts";
import { Connection } from "./connection.ts";
import { portLink } from "./port.ts";
import { Replica } from "./replica.ts";

/**
 * The port link (browser-design §4.1): the Replica over a MessagePort draws what the Connection
 * draws over SpacetimeDB, fed the same rows (the SDK stood in for as connection.test.ts stands it
 * in; the port's rows through a real MessageChannel, so a real structured clone, revived); a
 * transaction is in whole before it's told, and a move's rows before its answer; a refusal is kept
 * for the status line; cut off, every move is refused in the server's words. And nothing the port
 * link or the Replica loads is the bindings': only connection.ts loads the SDK's connection.
 */

const at = Timestamp.fromDate(new Date(Date.UTC(2026, 9, 16, 9)));
const CAMPAIGN = "caerwyn@0.1.0";

/** Rows by their tables' SQL names, as a server holds them. */
type Tables = Partial<Record<ClientTable, Row[]>>;

/**
 * The yard a few turns in as the tables hold its rows (check/place.ts's yardPlaceRows, with the
 * columns the views filter by): Pell Marrow's seat in his game's scene, the place with its world, on
 * the town's map (the walker's explore row, the campaign's maps), his saved game and the campaign.
 */
function yardTables(): Tables {
  const r = yardPlaceRows();
  const world = r.place!;
  const game = r.game.id, scene = r.scene.id, me = r.me;
  return {
    my_seat: [{ playerId: me, gameId: game, placeId: undefined, sceneId: scene, role: "host" }],
    my_names: r.names.map(n => ({ ...n })),
    my_games: [{ gameId: game, name: YARD.player.name, time: "morning", where: "in The Hanged Clerk", hook: YARD.hook!, begun: true, lastPlayedAt: at }],
    my_creation: [],
    campaign: [{ id: CAMPAIGN, key: "caerwyn", version: "0.1.0", title: "Caerwyn", json: "{}", builds: "", looks: "", installedAt: at }],
    game: [{ id: game, uid: "g", campaign: "caerwyn", campaignVersion: "0.1.0", title: "", time: r.game.time, day: 1, hostId: me, status: "playing", createdAt: at, leadScene: YARD_SCENE, leadText: undefined, onward: undefined, onwardNote: undefined }],
    scene: [{ ...r.scene, gameId: game, sceneKey: YARD_SCENE, kind: "scene", placeId: YARD_PLACE, exitKey: undefined, rev: 1, openedAt: at, endedAt: undefined, time: undefined }],
    player: r.players.map(p => ({ ...p, identity: new Identity(0xabcn + p.id), gameId: game, concept: "", characterId: undefined, placeId: undefined, sceneId: scene, online: true, lastPlayedAt: at })),
    sheet: r.sheets.map(s => ({ ...s, gameId: game, build: "", level: 3, data: "", pockets: "" })),
    transcript: r.transcript.map((t, i) => ({ ...t, id: BigInt(500 + i), gameId: game, sceneId: scene, at })),
    turn: r.turns.map(t => ({ ...t, gameId: game, sceneId: scene, playerId: me, startedAt: at, firstTextAt: undefined, endedAt: undefined, costMicros: 4100n })),
    on_stage: r.onStage.map(s => ({ ...s, sceneId: scene })),
    look: r.looks.map(l => ({ ...l, placeId: YARD_PLACE, role: "cast", glyph: "☻" })),
    place: [{ ...world.place, gameId: game, sceneId: scene, mapKey: "caerwyn", region: "granary-yard", origin: { x: 40, y: 9 }, active: true }],
    entity: world.entity, position: world.position, area: world.area, material: world.material, health: world.health, stack: world.stack,
    surface: world.surface, creature: world.creature, player_character: world.playerCharacter, gear: world.gear, narrative: world.narrative,
    world_log: world.worldLog.map((l, i) => ({ ...l, id: BigInt(800 + i) })),
    explore: [{ playerId: me, gameId: game, map: "caerwyn", at: { x: 42, y: 9 }, facing: { x: 0, y: 1 }, steps: 0, hidden: false, scene: YARD_SCENE, followers: [], quips: 0, lastQuip: undefined, styles: [], acts: 2, said: "", log: ["You come into the yard."] }],
    map_def: CAERWYN_MAPS.map(m => ({ id: `${CAMPAIGN}/${m.id}`, campaignId: CAMPAIGN, key: m.id, json: JSON.stringify(m) })),
  };
}

/** Every client table in a snapshot, as a server sends it: the ones the fixture leaves out, empty. */
function snapshotOf(tables: Tables): Record<ClientTable, Row[]> {
  return Object.fromEntries(Object.keys(CLIENT_TABLES).map(name => [name, tables[name as ClientTable] ?? []])) as Record<ClientTable, Row[]>;
}

type Post = (message: ToClient) => void;

/**
 * A server stood in for on the port's other end: connected and the snapshot on connect, and each
 * move to `onMove`, which posts what the move does and its answer. What it heard, in order.
 */
function serverOn(port: MessagePort, tables: Tables, onMove: (move: ToServer & { kind: "move" | "call" }, post: Post) => void = (move, post) => post({ kind: "answer", id: move.id })): ToServer[] {
  const heard: ToServer[] = [];
  const post: Post = message => port.postMessage(message);
  port.onmessage = event => {
    const message = event.data as ToServer;
    heard.push(message);
    if (message.kind === "connect") { post({ kind: "connected", identity: "c200aa" }); post({ kind: "snapshot", tables: snapshotOf(tables) }); }
    if (message.kind === "move" || message.kind === "call") onMove(message, post);
  };
  return heard;
}

/** The SDK stood in for (connection.test.ts's way), holding `tables`: each table iterable and found by its key, the builder's callbacks kept. */
async function connectionOver(t: TestContext, tables: Tables): Promise<Connection> {
  const on: Record<string, (...args: unknown[]) => void> = {};
  const applied: Array<() => void> = [];
  const db: Record<string, unknown> = {};
  for (const [name, { accessor, key }] of Object.entries(CLIENT_TABLES)) {
    const rows = tables[name as ClientTable] ?? [];
    db[accessor] = { iter: () => rows, onInsert() {}, onDelete() {}, onUpdate() {}, [key]: { find: (value: unknown) => rows.find(r => r[key] === value) } };
  }
  const subscriptionBuilder = () => {
    const builder = { onApplied(cb: () => void) { applied.push(cb); return builder; }, onError() { return builder; }, subscribe() { return { isActive: () => true, unsubscribe() {} }; } };
    return builder;
  };
  const sdk = { db, subscriptionBuilder, disconnect() {}, reducers: new Proxy({}, { get: () => async () => {} }) };
  const builder: Record<string, unknown> = { build: () => sdk };
  for (const name of ["withUri", "withDatabaseName", "withToken", "withAutomaticReconnect"]) builder[name] = () => builder;
  for (const name of ["onConnect", "onConnectError", "onDisconnect", "onAutomaticReconnect"]) builder[name] = (cb: (...args: unknown[]) => void) => { on[name] = cb; return builder; };
  t.mock.method(DbConnection, "builder", () => builder);

  const connection = new Connection({ url: "ws://127.0.0.1:3300", db: "kingmaker" });
  on.onConnect!(sdk, { toHexString: () => "c200aa" }, "a.jwt.token");
  applied[0]!(); // the caller's own views: the seat's set follows
  applied[1]!(); // the seat's set
  await connection.ready;
  return connection;
}

/** The Replica over a port to a server stood in for, once the snapshot is in. The ports close after the test, however it ends. */
async function replicaOver(t: TestContext, tables: Tables, onMove?: Parameters<typeof serverOn>[2]) {
  const { port1, port2 } = channel(t);
  const heard = serverOn(port2, tables, onMove);
  const replica = new Replica(portLink(port1, { session: "default" }));
  await replica.ready;
  return { replica, heard, server: port2 };
}

/** A MessageChannel whose ports close after the test, however it ends: an open port would keep a failed test's process alive. */
function channel(t: TestContext): MessageChannel {
  const ports = new MessageChannel();
  t.after(() => { ports.port1.close(); ports.port2.close(); });
  return ports;
}

/** The Replica's listeners hear of a change once a tick; a port's message comes a turn of the event loop later. */
const tick = () => new Promise(resolve => setImmediate(resolve));

/** Long enough on a busy machine; a wait that never ends fails rather than hangs. */
const PATIENCE = { timeout: 20_000 };

test("a generated companion talk resolves music through its campaign's authored template", PATIENCE, async t => {
  const tables = yardTables();
  tables.scene![0] = { ...tables.scene![0]!, kind: "talk", sceneKey: "talk-kell-2", time: "evening" };
  tables.campaign![0] = { ...tables.campaign![0]!, json: JSON.stringify({ talk: "companion-conversation" }) };
  const { replica } = await replicaOver(t, tables);
  assert.equal(replica.view()?.sceneKey, "companion-conversation");
  assert.equal(replica.view()?.musicTime, "evening");
  assert.equal(replica.view()?.talk, true);
});

test("the Replica over a port draws the yard as the Connection over the SDK does: the scene and its place, the home rows (the saved game's time revived, so the title says it), the map", PATIENCE, async t => {
  const tables = yardTables();
  const connection = await connectionOver(t, tables);
  const { replica, heard } = await replicaOver(t, tables);

  assert.deepEqual(heard[0], { kind: "connect", protocol: PROTOCOL, session: "default" });
  assert.deepEqual(replica.view(), connection.view());
  assert.ok(replica.view()!.entries.length > 3 && replica.view()!.place, "the yard's lines and its place are drawn");
  assert.deepEqual(replica.home(), connection.home());
  assert.ok(replica.home().games[0]!.lastPlayedAt instanceof Timestamp, "the saved game's time is a Timestamp again");
  assert.ok((replica.home().player as unknown as { identity: unknown }).identity instanceof Identity, "and the player's identity an Identity");
  assert.equal(titleLine(replica.home().games[0]!, at.toDate().getTime() + 300_000), "Pell Marrow: Morning, in The Hanged Clerk (5 min ago)");
  assert.deepEqual(replica.explore(), connection.explore());
  assert.equal(replica.explore()?.ex.map, "caerwyn", "the map is drawn");

  replica.close();
  await tick();
  assert.deepEqual(heard.at(-1), { kind: "disconnect" });
  connection.close();
});

test("a transaction is in whole before it's told, and a move's rows come before its answer; a refusal is kept for the status line", PATIENCE, async t => {
  const tables = yardTables();
  const said = (text: string, id: bigint): Row => ({ id, gameId: 1n, sceneId: 7n, seq: 99, turn: 9, speaker: "player:1", kind: "player", text, markup: undefined, at });
  const { replica } = await replicaOver(t, tables, (move, post) => {
    const { text } = move.args as { text: string };
    if (text === "And the rope?") return post({ kind: "answer", id: move.id, rejection: { code: "turn_in_flight", text: "(The GM is still answering: wait for the reply.)" } });
    post({ kind: "tx", changes: [{ table: "turn", op: "insert", row: { ...tables.turn![0]!, id: 109n, n: 9, phase: "queued" } }, { table: "transcript", op: "insert", row: said(text, 900n) }] });
    post({ kind: "answer", id: move.id });
  });
  const told: string[] = [];
  replica.onEvent((table, op) => told.push(`${table} ${op}: the line ${replica.rows()!.transcript.some(r => r.text === "Who cut him down?") ? "in" : "not in"}`));

  assert.equal(await replica.say("Who cut him down?"), undefined);
  assert.equal(replica.view()!.entries.at(-1)!.text, "Who cut him down?", "the line was in when the move was answered");
  assert.deepEqual(told, ["turn insert: the line in", "transcript insert: the line in"]);

  const refused = await replica.say("And the rope?");
  assert.equal(refused?.code, "turn_in_flight");
  await tick();
  assert.equal(replica.view()!.refusal, refused!.text);
  assert.equal(replica.home().refusal, refused!.text);
});

test("cut off, every move is refused in the server's words: the one waiting, and every one after, unsent; before the snapshot, ready fails with them", PATIENCE, async t => {
  const words = "(The game stopped: reload the page.)";
  const { replica, heard, server } = await replicaOver(t, yardTables(), () => {});

  const waiting = replica.say("Hello?");
  await tick();
  server.postMessage({ kind: "status", cutOff: words } satisfies ToClient);
  assert.deepEqual(await waiting, { code: "error", text: words });
  await tick();
  assert.deepEqual([replica.view()!.cutOff, replica.view()!.mayType, replica.view()!.note], [true, false, words]);
  assert.deepEqual(await replica.say("Anyone?"), { code: "error", text: words });
  assert.equal(heard.filter(m => m.kind === "move").length, 1, "the move after the cut wasn't sent");

  const { port1, port2 } = channel(t);
  port2.onmessage = () => port2.postMessage({ kind: "status", cutOff: words } satisfies ToClient);
  await assert.rejects(new Replica(portLink(port1)).ready, { message: words });
});

test("a call is answered with its procedure's text (a report's game), or why not; cut off, it's refused unsent", PATIENCE, async t => {
  const { replica, heard, server } = await replicaOver(t, yardTables(), (call, post) => {
    if (call.kind !== "call") return;
    const { game } = call.args as { game: bigint };
    post(game === 1n ? { kind: "answer", id: call.id, value: '{"kind":"kingmaker-game","id":"1"}' } : { kind: "answer", id: call.id, rejection: { code: "error", text: "(No.)" } });
  });

  assert.equal(await replica.reportGame(1n), '{"kind":"kingmaker-game","id":"1"}');
  assert.deepEqual(await replica.reportGame(2n), { code: "error", text: "(No.)" });
  assert.deepEqual(heard.filter(m => m.kind === "call").map(m => m.kind === "call" && [m.name, m.args]), [["reportGame", { game: 1n }], ["reportGame", { game: 2n }]]);

  server.postMessage({ kind: "status", cutOff: "(Gone.)" } satisfies ToClient);
  await tick();
  assert.deepEqual(await replica.reportGame(1n), { code: "error", text: "(Gone.)" });
  assert.equal(heard.filter(m => m.kind === "call").length, 2);
});

test("nothing the port link or the Replica loads is the bindings' (only connection.ts loads the SDK's connection), and of the SDK only the port takes its classes", () => {
  const loaded = valueImports([join(import.meta.dirname, "port.ts"), join(import.meta.dirname, "replica.ts")]);
  const V2 = resolve(import.meta.dirname, "..", "..");

  assert.ok(loaded.files.length > 10, "the walk found the views' code");
  assert.deepEqual(loaded.files.filter(f => f.includes(`module_bindings${sep}`)), []);
  assert.deepEqual(loaded.packages.filter(p => p.spec.startsWith("spacetimedb")).map(p => `${relative(V2, p.from)}: ${p.names}`), ["client/net/port.ts: Identity, TimeDuration, Timestamp"]);
});

const IMPORT = /^(import|export)\s(?!type\s)([^;]*?)\sfrom\s*["']([^"']+)["']/gm;

/** The files `entries` load at run time, following their value imports (an `import type` is erased), and the packages they import, with what. */
function valueImports(entries: string[]): { files: string[]; packages: Array<{ from: string; spec: string; names: string }> } {
  const files = new Set<string>();
  const packages: Array<{ from: string; spec: string; names: string }> = [];
  const visit = (file: string): void => {
    if (files.has(file)) return;
    files.add(file);
    for (const [, , what, spec] of readFileSync(file, "utf8").matchAll(IMPORT)) {
      if (spec!.startsWith(".")) visit(resolve(dirname(file), spec!));
      else packages.push({ from: file, spec: spec!, names: what!.replace(/[{}\s]/g, "").split(",").sort().join(", ") });
    }
  };
  for (const entry of entries) visit(entry);
  return { files: [...files], packages };
}
