import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/**
 * The module's rules (v0-design §2.2): its code imports v2/shared, v2/vendor (the rules engine, its
 * pack and the SRD's spells: v1-design §3.6), spacetimedb and itself; only index.ts and schema.ts
 * load spacetimedb/server at run time (every other file takes it as types, so the memory host loads
 * them in Node); and it reads no clock and no outside randomness (time is tx.now, randomness the
 * dice row or tx.seed()). The memory host and the tests run under Node and may use it.
 */

const SRC = import.meta.dirname;
const SHARED = resolve(SRC, "..", "..", "shared");
const VENDOR = resolve(SRC, "..", "..", "vendor");
const files = readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter(f => /\.ts$/.test(f));
const moduleCode = files.filter(f => !/\.test\.ts$/.test(f) && !f.startsWith(`host${sep}`));
const IMPORT = /^\s*(import|export)(\s+type)?\s[^;]*?\sfrom\s*["']([^"']+)["']/gm;

test("the module imports shared, vendor, spacetimedb and itself; only index.ts and schema.ts load spacetimedb/server at run time", () => {
  const wrong: string[] = [];
  for (const file of moduleCode) {
    for (const [, , typeOnly, spec] of readFileSync(join(SRC, file), "utf8").matchAll(IMPORT)) {
      const target = spec!.startsWith(".") ? resolve(dirname(join(SRC, file)), spec!) : undefined;
      const local = !!target && (target.startsWith(SRC + sep) || target.startsWith(SHARED + sep) || target.startsWith(VENDOR + sep));
      const server = spec === "spacetimedb/server" && (typeOnly || file === "index.ts" || file === "schema.ts");
      if (!local && spec !== "spacetimedb" && !server) wrong.push(`${file}: ${spec}`);
      if (target?.startsWith(join(SRC, "host") + sep)) wrong.push(`${file}: ${spec} (the memory host is Node's)`);
    }
  }
  assert.ok(moduleCode.length > 20, "the scan found the module's code");
  assert.deepEqual(wrong, []);
});

test("the module's code reads no clock and no outside randomness", () => {
  const banned = /\bMath\.random\b|\bDate\b|\bperformance\.now\b|\bprocess\./;
  const found = moduleCode.flatMap(file => readFileSync(join(SRC, file), "utf8").split("\n")
    .map((line, i) => ({ line: line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, ""), at: `${relative(SRC, join(SRC, file))}:${i + 1}` }))
    .filter(({ line }) => banned.test(line)).map(({ at, line }) => `${at}: ${line.trim()}`));
  assert.deepEqual(found, []);
});
