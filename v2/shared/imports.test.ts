import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

/**
 * The rule for v2/shared (v0-design §2.2): its code runs in the SpacetimeDB module, under Node and
 * in the AI service, so it imports nothing outside v2/shared (no node:, no packages) and keeps the
 * simulation deterministic (no clock, no Math.random). Its tests run under Node, so they may import
 * node: built-ins too. The module's type check (ES2021, no Node types) catches the rest.
 */

const ROOT = import.meta.dirname;
const files = readdirSync(ROOT, { recursive: true, encoding: "utf8" }).filter(f => /\.(ts|tsx|mts|js|mjs)$/.test(f));
const isTest = (file: string) => /\.test\.ts$/.test(file);
const IMPORT = /(?:^|\s)(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|^import\s*["']([^"']+)["']/gm;

test("v2/shared imports nothing outside v2/shared (its tests: node: built-ins too)", () => {
  const outside: string[] = [];
  for (const file of files) {
    for (const m of readFileSync(join(ROOT, file), "utf8").matchAll(IMPORT)) {
      const spec = (m[1] ?? m[2] ?? m[3])!;
      if (isTest(file) && spec.startsWith("node:")) continue;
      if (!spec.startsWith(".") || !resolve(dirname(join(ROOT, file)), spec).startsWith(ROOT + sep)) outside.push(`${file}: ${spec}`);
    }
  }
  assert.ok(files.length > 10, "the scan found the folder's code");
  assert.deepEqual(outside, []);
});

test("v2/shared's code reads no clock and no outside randomness", () => {
  const banned = /\bMath\.random\b|\bDate\.now\b|\bnew Date\b|\bperformance\.now\b|\bstructuredClone\b|\bprocess\./;
  const found = files.filter(f => !isTest(f)).flatMap(file => readFileSync(join(ROOT, file), "utf8").split("\n")
    .map((line, i) => ({ line: line.replace(/\/\/.*$/, ""), at: `${file}:${i + 1}` }))
    .filter(({ line }) => banned.test(line)).map(({ at, line }) => `${at}: ${line.trim()}`));
  assert.deepEqual(found, []);
});
