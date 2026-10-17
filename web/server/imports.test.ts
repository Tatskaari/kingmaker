import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { test } from "node:test";

/**
 * web/server's rule (browser-design §5): the page host's parts import only themselves, shared/, the
 * simulation (simulation/src), the AI service (ai/) and the SDK's classes (spacetimedb), so they
 * bundle into the server worker as they are. Never client/ (the client worker's), hosts/ (the
 * composition roots compose these parts, not the other way round), the prototype, or anything of
 * Node's, since they run in a browser's worker. Their tests may import what they like.
 */

const ROOT = import.meta.dirname;
const V2 = resolve(ROOT, "..", "..");
const INSIDE = ["web/server", "shared", "simulation/src", "ai"].map(dir => join(V2, dir) + sep);
const PACKAGES = /^spacetimedb$/;
const IMPORT = /(?:^|\s)(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|^import\s*["']([^"']+)["']/gm;
const files = readdirSync(ROOT).filter(file => file.endsWith(".ts") && !file.endsWith(".test.ts"));

test("web/server imports itself, shared/, the simulation, the AI service and the SDK's classes: never client/, hosts/, the prototype or Node", () => {
  const outside: string[] = [];
  for (const file of files) {
    for (const match of readFileSync(join(ROOT, file), "utf8").matchAll(IMPORT)) {
      const name = (match[1] ?? match[2] ?? match[3])!;
      if (PACKAGES.test(name)) continue;
      const path = name.startsWith(".") ? resolve(ROOT, name) : "";
      if (!INSIDE.some(dir => path.startsWith(dir))) outside.push(`${file}: ${name}`);
    }
  }
  assert.ok(files.length >= 13, "the scan found the page host's parts");
  assert.deepEqual(outside, []);
});
