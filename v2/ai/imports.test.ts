import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

/**
 * The one rule (README.md): v2/ai imports nothing outside v2/ai, only node: built-ins and its own
 * files, so the prototype and v2 can share it. The prototype reaches in (src/llm, src/lore,
 * src/runtime/brief.ts); nothing here reaches out, and the prototype's type check wouldn't notice
 * if something did.
 */

const ROOT = import.meta.dirname;

test("v2/ai imports nothing outside v2/ai", () => {
  const files = readdirSync(ROOT, { recursive: true, encoding: "utf8" }).filter(f => /\.(ts|tsx|mts|js|mjs)$/.test(f));
  const outside: string[] = [];
  for (const file of files) {
    const source = readFileSync(join(ROOT, file), "utf8");
    for (const m of source.matchAll(/(?:^|\s)(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|^import\s*["']([^"']+)["']/gm)) {
      const spec = (m[1] ?? m[2] ?? m[3])!;
      if (spec.startsWith("node:")) continue;
      if (!spec.startsWith(".") || !resolve(dirname(join(ROOT, file)), spec).startsWith(ROOT + sep)) outside.push(`${file}: ${spec}`);
    }
  }
  assert.ok(files.length > 10, "the scan found the folder's code");
  assert.deepEqual(outside, []);
});
