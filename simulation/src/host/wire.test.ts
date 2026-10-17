import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT_VIEWS, OWNER_MOVES, PLAYER_MOVES, PUBLIC_TABLES, type ClientView } from "../../../shared/protocol/port.ts";
import { TABLES } from "../tables.ts";
import { memoryHost, type Caller } from "./memory.ts";
import { caerwynArgs, identity, scriptedAi } from "./testing.ts";

/**
 * Where the wire (shared/protocol/port.ts) meets the memory host, as the page's server worker joins
 * them (browser-design §3, §4.2): the tables that cross are tables.ts's public ones, by their SQL
 * names, with the same accessors and primary keys; each view's key on the wire is a column of the
 * rows view(identity) makes; and each move on the wire is a Caller's, made by its name, with none
 * among them that a player mustn't make.
 */

/** Every move on the wire, as the memory host's Caller names them: a move that isn't a Caller's doesn't type check. */
const WIRE_MOVES: ReadonlyArray<keyof Caller> = [...PLAYER_MOVES, ...OWNER_MOVES];

const snakeCase = (accessor: string) => accessor.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);

test("the wire's public tables are tables.ts's, each by its SQL name with the same accessor and primary key", () => {
  const meta = TABLES as unknown as Record<string, { primaryKey: string; public?: true }>;
  const kept = Object.entries(meta).filter(([, table]) => table.public).map(([accessor, table]) => `${snakeCase(accessor)}: ${accessor} by ${table.primaryKey}`);
  const wire = Object.entries(PUBLIC_TABLES).map(([sql, table]) => `${sql}: ${table.accessor} by ${table.key}`);

  assert.deepEqual(wire.sort(), kept.sort());
});

test("each move on the wire is a Caller's, and installCampaign, dispatchWaiting and streamReply aren't on it", () => {
  const host = memoryHost({ ai: async () => { throw new Error("no POST in this test"); } });
  const caller = host.as(identity(1));

  assert.deepEqual(WIRE_MOVES.filter(name => typeof caller[name] !== "function"), []);
  assert.deepEqual(["installCampaign", "dispatchWaiting", "streamReply"].filter(name => (WIRE_MOVES as readonly string[]).includes(name)), []);
});

test("each view's key on the wire is a column of the rows view(identity) makes: the seat, the names on stage, the games and the character being made", async () => {
  const script = scriptedAi();
  const host = memoryHost({ ai: script.ai });
  host.as(host.owner).installCampaign(caerwynArgs());
  const [wren, tamsin] = [identity(1), identity(2)];
  host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "ranger" });
  host.as(tamsin).startCreation({ campaign: "caerwyn", name: "Tamsin Vell", concept: "a disgraced palace auditor", how: "three" });
  await host.drain();

  const made: Record<ClientView, unknown> = {
    my_seat: host.view(wren).mySeat(), my_names: host.view(wren).myNames(), my_games: host.view(wren).myGames(), my_creation: host.view(tamsin).myCreation(),
  };
  for (const [view, rows] of Object.entries(made) as Array<[ClientView, unknown]>) {
    const list = [rows].flat().filter(row => row !== undefined) as Array<Record<string, unknown>>;
    assert.ok(list.length, `${view} made a row`);
    assert.deepEqual(list.filter(row => row[CLIENT_VIEWS[view].key] === undefined), [], `${view}'s rows have its key, ${CLIENT_VIEWS[view].key}`);
  }
});
