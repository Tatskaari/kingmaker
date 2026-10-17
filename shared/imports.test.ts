import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

/**
 * The rule for shared/ (v0-design §2.2): its code runs in the SpacetimeDB module, under Node and
 * in the AI service, so it imports nothing outside shared/ (no node:, no packages) and keeps the
 * simulation deterministic (no clock, no Math.random). Its tests run under Node, so they may import
 * node: built-ins too. The module's type check (ES2021, no Node types) catches the rest.
 *
 * The rules engine is its hosts' to load (v1-design §3.6): shared/rules imports its typings from
 * vendor/ as types only, and is handed the engine; only a test loads the bundle itself (after the
 * shim, as the hosts do). The shim is the one file that touches the clock and the platform's crypto:
 * it pins both for the engine, and leaves the platform's where nothing is pinned (the AI service).
 */

const ROOT = import.meta.dirname;
const VENDOR = resolve(ROOT, "..", "vendor");
/** Where a file may read the platform's clock and randomness: the shim, which pins them for the engine. */
const SHIM = join("rules", "shim.ts");
const files = readdirSync(ROOT, { recursive: true, encoding: "utf8" }).filter(f => /\.(ts|tsx|mts|js|mjs)$/.test(f));
const isTest = (file: string) => /\.test\.ts$/.test(file);
const IMPORT = /(?:^|\s)(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|^import\s*["']([^"']+)["']/gm;
const TYPE_ONLY = /^\s*(?:import|export)\s+type\s/;

test("shared/ imports nothing outside shared/ but the engine's typings, as types (its tests: node: built-ins and the engine too)", () => {
  const outside: string[] = [];
  for (const file of files) {
    for (const m of readFileSync(join(ROOT, file), "utf8").matchAll(IMPORT)) {
      const spec = (m[1] ?? m[2] ?? m[3])!;
      if (isTest(file) && spec.startsWith("node:")) continue;
      const target = spec.startsWith(".") ? resolve(dirname(join(ROOT, file)), spec) : undefined;
      if (target?.startsWith(ROOT + sep)) continue;
      if (target?.startsWith(VENDOR + sep) && (TYPE_ONLY.test(m[0]) || isTest(file))) continue;
      outside.push(`${file}: ${spec}`);
    }
  }
  assert.ok(files.length > 10, "the scan found the folder's code");
  assert.deepEqual(outside, []);
});

test("shared/'s code reads no clock and no outside randomness (but the shim, which pins them)", () => {
  const banned = /\bMath\.random\b|\bDate\.now\b|\bnew Date\b|\bperformance\.now\b|\bstructuredClone\b|\bprocess\./;
  const found = files.filter(f => !isTest(f) && f !== SHIM).flatMap(file => readFileSync(join(ROOT, file), "utf8").split("\n")
    .map((line, i) => ({ line: line.replace(/\/\/.*$/, ""), at: `${file}:${i + 1}` }))
    .filter(({ line }) => banned.test(line)).map(({ at, line }) => `${at}: ${line.trim()}`));
  assert.deepEqual(found, []);
});
