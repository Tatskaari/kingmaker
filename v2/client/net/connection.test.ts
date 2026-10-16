import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { DbConnection } from "../module_bindings/index.ts";
import { CLOSED, Connection, TURNED_AWAY } from "./connection.ts";

/**
 * The connection's word on a reconnect, from the SDK's own callbacks: while the SDK tries again
 * (a next attempt), the status line says so; once it has stopped for good (no next attempt: a
 * server that turns the session away with a 401 or 403, one signed by other keys on the port), it
 * says what to do, the box stays shut, and a move is refused with the same words rather than sent
 * to an SDK that would answer "out of reach" each time. The SDK here is a stand-in: the builder's
 * callbacks are kept, the seat's subscriptions applied by hand, and the rows a seat in a live scene.
 */

type Callback = (...args: unknown[]) => void;

/** The SDK stood in for, with Wren seated in game 3's live scene: the builder's callbacks, and each reducer called. */
function standIn(t: TestContext) {
  const on: Record<string, Callback> = {};
  const applied: Callback[] = [];
  const called: string[] = [];
  const rows = (all: unknown[] = []) => ({ iter: () => all, onInsert() {}, onDelete() {}, onUpdate() {} });
  const db = {
    mySeat: rows([{ playerId: 1n, gameId: 3n, sceneId: 7n, placeId: 9n }]),
    myNames: rows(), player: rows(), sheet: rows(), transcript: rows(), replyDraft: rows(), turn: rows(), onStage: rows(), look: rows(), sceneSuggestion: rows(),
    myGames: rows(), myCreation: rows(), campaign: rows(),
    // The place's world (the world bridge): watched, and none of it in yet.
    place: { ...rows(), id: { find: () => undefined } },
    entity: rows(), position: rows(), area: rows(), material: rows(), health: rows(), stack: rows(), surface: rows(), creature: rows(),
    playerCharacter: rows(), gear: rows(), narrative: rows(), worldLog: rows(),
    // The map's (map-design §3.6): watched, and none of it in (the game isn't on a map).
    mapDef: rows(), explore: { ...rows(), playerId: { find: () => undefined } },
    game: { ...rows(), id: { find: (id: bigint) => (id === 3n ? { id: 3n, time: "morning" } : undefined) } },
    scene: { ...rows(), id: { find: (id: bigint) => (id === 7n ? { id: 7n, title: "The Hanged Clerk", hook: "", status: "live", controllerId: 1n, turnId: undefined, placeId: 9n } : undefined) } },
  };
  const subscription = () => {
    const builder = {
      onApplied(cb: Callback) { applied.push(cb); return builder; },
      onError() { return builder; },
      subscribe() { return { isActive: () => true, unsubscribe() {} }; },
    };
    return builder;
  };
  const sdk = {
    db, subscriptionBuilder: subscription, disconnect() {},
    reducers: new Proxy({}, { get: (_, name) => async () => { called.push(String(name)); } }),
  };
  const builder: Record<string, unknown> = {};
  for (const name of ["withUri", "withDatabaseName", "withToken", "withAutomaticReconnect"]) builder[name] = () => builder;
  for (const name of ["onConnect", "onConnectError", "onDisconnect", "onAutomaticReconnect"]) builder[name] = (cb: Callback) => { on[name] = cb; return builder; };
  builder.build = () => sdk;
  t.mock.method(DbConnection, "builder", () => builder);
  return { on, applied, called, sdk };
}

/** Connected and seated, as connect() leaves it. */
async function seated(t: TestContext) {
  const stand = standIn(t);
  const connection = new Connection({ url: "ws://127.0.0.1:3300", db: "kingmaker" });
  stand.on.onConnect!(stand.sdk, { toHexString: () => "c200aa" }, "a.jwt.token");
  stand.applied[0]!();
  await connection.ready;
  return { connection, ...stand };
}

/** The connection's listeners hear of a change once a tick. */
const tick = () => new Promise(resolve => setImmediate(resolve));

test("while the SDK tries again the status line says so; once it has stopped for good, what to do, the box shut and a line refused with those words", async t => {
  const { connection, on, called, sdk } = await seated(t);
  assert.equal(connection.view()?.mayType, true);

  on.onDisconnect!(sdk, new Error("WebSocket closed (code 1006)"), 1, 1000);
  await tick();
  assert.equal(connection.view()?.note, "(Lost the game's server: reconnecting…)");
  on.onConnectError!(sdk, new Error("Failed to connect"), 2, 2000);
  await tick();
  assert.deepEqual([connection.view()?.note, connection.view()?.cutOff], ["(The game's server is out of reach: trying again (attempt 2)…)", undefined]);

  // The server on the port now has other keys: it answers the session's token with a 401, and the SDK stops.
  on.onConnectError!(sdk, new Error("401 Unauthorized"));
  await tick();
  const view = connection.view()!;
  assert.deepEqual([view.note, view.cutOff, view.mayType], [TURNED_AWAY, true, false]);

  assert.deepEqual(await connection.say("Kell, are you there?"), { code: "error", text: TURNED_AWAY });
  assert.deepEqual(await connection.retryTurn(5n), { code: "error", text: TURNED_AWAY });
  assert.deepEqual(await connection.setSuggestions(false), { code: "error", text: TURNED_AWAY });
  assert.deepEqual(called, [], "nothing sent to the SDK");
  assert.equal(connection.view()?.refusal, TURNED_AWAY);
});

test("a connection the server closes and the SDK won't open again says what to do; one the client closes is no trouble", async t => {
  const closed = await seated(t);
  closed.on.onDisconnect!(closed.sdk, new Error("WebSocket closed (code 1008)"));
  await tick();
  assert.deepEqual([closed.connection.view()?.note, closed.connection.view()?.cutOff], [CLOSED, true]);
  assert.deepEqual(await closed.connection.say("Hello?"), { code: "error", text: CLOSED });

  const quitting = await seated(t);
  quitting.connection.close();
  quitting.on.onDisconnect!(quitting.sdk, undefined);
  await tick();
  assert.deepEqual([quitting.connection.view()?.note, quitting.connection.view()?.cutOff], [undefined, undefined]);
});
