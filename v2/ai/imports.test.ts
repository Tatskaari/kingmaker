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

/** A node: built-in, or one of this folder's own files by a name written out in full. */
const allowed = (file: string, name: string) =>
  name.startsWith("node:") || (name.startsWith(".") && !name.includes("${") && resolve(dirname(join(ROOT, file)), name).startsWith(ROOT + sep));

test("v2/ai imports nothing outside v2/ai", () => {
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
