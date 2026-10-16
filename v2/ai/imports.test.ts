import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

/**
 * The one rule (README.md): v2/ai imports only node: built-ins, its own files and v2/shared (the
 * protocol, the scene graph and the world it shares with the simulation), so the prototype and v2
 * can share it. Never the prototype: the prototype reaches in (src/llm, src/lore,
 * src/runtime/brief.ts), nothing here reaches out, and the prototype's type check wouldn't notice
 * if something did. v2/shared keeps to itself in turn (v2/shared/imports.test.ts).
 */

const ROOT = import.meta.dirname;
const SHARED = resolve(ROOT, "..", "shared");

/**
 * Every way a file names a module, the name in the second group: an import or export with a from
 * (over lines, and spaced or not), an import for its side effects, and a call to import or require,
 * in code or a type, with the name in any quotes. Comments are read as code, so an example in one
 * keeps to the rule too.
 */
const NAMED = [
  /\b(?:import|export)\b[^;]*?\bfrom\s*(["'`])(.*?)\1/g,
  /\bimport\s*(["'`])(.*?)\1/g,
  /\b(?:import|require)\s*\(\s*(["'`])(.*?)\1/g,
];

/** Never allowed, since where they lead can't be read here: an import of a name made as it runs, and the require functions node:module makes. */
const UNCHECKED = /\bimport\s*\(\s*(?![\s"'`])|\bcreateRequire\b/g;

/** A node: built-in, or a file of this folder's own or of v2/shared, by a name written out in full. */
const allowed = (file: string, name: string) => {
  if (name.startsWith("node:")) return true;
  if (!name.startsWith(".") || name.includes("${")) return false;
  const target = resolve(dirname(join(ROOT, file)), name);
  return target.startsWith(ROOT + sep) || target.startsWith(SHARED + sep);
};

test("v2/ai imports nothing but node:, itself and v2/shared", () => {
  const files = readdirSync(ROOT, { recursive: true, encoding: "utf8" }).filter(f => /\.[cm]?[jt]sx?$/.test(f));
  const outside: string[] = [];
  for (const file of files) {
    const source = readFileSync(join(ROOT, file), "utf8");
    for (const pattern of NAMED) for (const m of source.matchAll(pattern)) if (!allowed(file, m[2]!)) outside.push(`${file}: ${m[2]}`);
    for (const m of source.matchAll(UNCHECKED)) outside.push(`${file}: ${m[0]}…`);
  }
  assert.ok(files.length > 10, "the scan found the folder's code");
  assert.deepEqual(outside, []);
});
