import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT_TABLES, CLIENT_VIEWS, keyOf, OWNER_MOVES, PLAYER_MOVES, PUBLIC_TABLES, revive, rowKey } from "./port.ts";

/**
 * The wire's own (browser-design §3): what structured clone does to the SDK's classes, undone with
 * the classes handed in (stand-ins here, with the SDK's field names: shared can't import the SDK,
 * and client/net/port.test.ts revives with the real ones); the keys rows are kept by; the tables
 * that cross.
 */

class Identity { __identity__: bigint; constructor(value: bigint) { this.__identity__ = value; } }
class Timestamp { __timestamp_micros_since_unix_epoch__: bigint; constructor(micros: bigint) { this.__timestamp_micros_since_unix_epoch__ = micros; } }
class TimeDuration { __time_duration_micros__: bigint; constructor(micros: bigint) { this.__time_duration_micros__ = micros; } }
const classes = { Identity, Timestamp, TimeDuration };

test("structured clone leaves the SDK's classes their fields; revive puts the classes back, anywhere in a row, and keeps the rest as it was", () => {
  const row = {
    id: 3n, name: "Pell Marrow", endedAt: undefined, identity: new Identity(0xabcn), at: new Timestamp(1_792_108_800_000_000n),
    scheduledAt: { tag: "Interval", value: new TimeDuration(2_000_000n) }, slots: [{ level: 1, at: new Timestamp(5n) }],
  };
  const cloned = structuredClone(row);
  assert.equal(cloned.at instanceof Timestamp, false, "the clone has the field, not the class");

  const back = revive(cloned, classes);

  assert.deepStrictEqual(back, row);
  assert.ok(back.identity instanceof Identity && back.at instanceof Timestamp && back.scheduledAt.value instanceof TimeDuration && back.slots[0]!.at instanceof Timestamp);
  assert.ok("endedAt" in back, "an option that's none stays, undefined, as the SDK's rows have it");
  const instance = new Timestamp(9n);
  assert.equal(revive({ at: instance }, classes).at, instance, "a class's instance is kept as it is");
  assert.deepStrictEqual(revive({ __identity__: "not a bigint" }, classes), { __identity__: "not a bigint" });
});

test("a row is keyed by its primary key: a u64, a string, or an identity, the same whether it's an Identity or a clone of one", () => {
  assert.equal(keyOf(7n), "7n");
  assert.equal(keyOf("caerwyn@0.1.0"), '"caerwyn@0.1.0"');
  assert.notEqual(keyOf(7n), keyOf("7"));
  assert.equal(keyOf(new Identity(0xabcn)), keyOf(structuredClone(new Identity(0xabcn))));
  assert.equal(rowKey("sheet", { playerId: 4n, gameId: 3n }), "4n");
  assert.equal(rowKey("my_creation", { identity: new Identity(0xabcn) }), keyOf(new Identity(0xabcn)));
  assert.throws(() => keyOf(undefined), /a u64, a string or an identity/);
});

test("the wire carries the caller's four views and the 34 public tables, each by its accessor in the bindings (the SQL name in camelCase), and no private table", () => {
  assert.deepEqual(Object.keys(CLIENT_VIEWS), ["my_seat", "my_names", "my_games", "my_creation"]);
  assert.equal(Object.keys(PUBLIC_TABLES).length, 34);
  const camel = (sql: string) => sql.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
  for (const [sql, { accessor }] of Object.entries(CLIENT_TABLES)) assert.equal(accessor, camel(sql), sql);
  for (const secret of ["gm_state", "gm_note", "heard", "job", "job_dispatch", "reaper", "dice", "rules_state", "seat", "scene_def", "place_def", "admin", "creation", "fight_rules", "fight_clock"]) {
    assert.equal(secret in CLIENT_TABLES, false, secret);
  }
  assert.equal(PLAYER_MOVES.some(move => (OWNER_MOVES as readonly string[]).includes(move)), false, "a move is the player's or the owner's");
});
