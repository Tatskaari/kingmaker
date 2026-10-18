import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Timestamp } from "spacetimedb";
import { TABLES } from "./tables.ts";

/**
 * tables.ts is kept in step with schema.ts by hand (spacetimedb/server doesn't load in Node), so
 * this reads schema.ts's text: each table's SQL name is its accessor in snake_case (what a
 * subscription and the browser's wire name it by), its public tables are tables.ts's, and each
 * column's `.default(…)`, but an option's undefined, is tables.ts's default for it.
 */

const SCHEMA = readFileSync(join(import.meta.dirname, "schema.ts"), "utf8");

/** Each table schema.ts declares (`export const <accessor> = table({ name: "<sql>", … }, {`), and its columns' defaults as written, up to its `});`. */
const DECLARED = [...SCHEMA.matchAll(/^export const (\w+) = table\((\{.*\}), \{\n([\s\S]*?)\n\}\);$/gm)].map(([, accessor, options, columns]) => ({
  accessor: accessor!,
  sql: /name: "(\w+)"/.exec(options!)?.[1],
  public: /\bpublic: true\b/.test(options!),
  defaults: [...columns!.matchAll(/^\s*(\w+): t\..*\.default\((.*)\),$/gm)].map(([, column, value]) => ({ column: column!, value: value! })),
}));

const META = TABLES as unknown as Record<string, { public?: true; defaults?: Record<string, unknown> }>;
const snakeCase = (accessor: string) => accessor.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
/** A default as schema.ts writes it. */
const written = (value: unknown) => (value instanceof Timestamp ? `new Timestamp(${value.microsSinceUnixEpoch}n)` : JSON.stringify(value));

test("tables.ts has every table schema.ts declares, and each one's SQL name is its accessor in snake_case", () => {
  assert.deepEqual(DECLARED.map(t => t.accessor).sort(), Object.keys(TABLES).sort());
  assert.deepEqual(DECLARED.filter(t => t.sql !== snakeCase(t.accessor)).map(t => `${t.accessor}: ${t.sql}`), []);
});

test("tables.ts's public tables are schema.ts's", () => {
  const declared = DECLARED.filter(t => t.public).map(t => t.accessor);
  assert.deepEqual(Object.keys(META).filter(t => META[t]!.public).sort(), declared.sort());
});

test("tables.ts's defaults are schema.ts's, but the options' undefined", () => {
  const declared = DECLARED.flatMap(t => t.defaults.filter(d => d.value !== "undefined").map(d => `${t.accessor}.${d.column} = ${d.value}`));
  const kept = Object.entries(META).flatMap(([table, meta]) => Object.entries(meta.defaults ?? {}).map(([column, value]) => `${table}.${column} = ${written(value)}`));

  assert.deepEqual(kept.sort(), declared.sort());
  assert.equal(DECLARED.flatMap(t => t.defaults).length, SCHEMA.split(".default(").length - 1, "the scan found every default");
});

test("every table is a game's (games/tables.ts, which a report reads and a restore writes back) or isn't, with why, and not both; each id a game's table points by is one of its columns", async () => {
  const { GAME_TABLES, NOT_A_GAMES } = await import("./games/tables.ts");
  const games = GAME_TABLES.map(t => t.table);
  const not = Object.keys(NOT_A_GAMES);
  assert.deepEqual([...games, ...not].sort(), Object.keys(TABLES).sort(), "each table once, in one list or the other");
  assert.equal(new Set(games).size, games.length);

  const columns = (accessor: string) => {
    const block = new RegExp(`^export const ${accessor} = table\\(.*\\{\\n([\\s\\S]*?)\\n\\}\\);$`, "m").exec(SCHEMA)?.[1] ?? "";
    return [...block.matchAll(/\b(\w+): t\./g)].map(m => m[1]!);
  };
  for (const t of GAME_TABLES) {
    for (const column of Object.keys(t.refs ?? {})) assert.ok(columns(t.table).includes(column), `${t.table}.${column} isn't a column of it`);
    if (t.own) assert.equal((TABLES as Record<string, { autoInc?: boolean }>)[t.table]!.autoInc, true, `${t.table}'s own id is one the table gives (autoInc)`);
  }
});
