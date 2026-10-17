import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { test } from "node:test";

/**
 * The client's rule (README.md): it imports shared/, its packages and the bindings, never the
 * rules engine (v1-design §3.10: it reads what the engine made from the rows), the AI service, the
 * simulation's code or the prototype. Nor shared/rules's pin.ts or shim.ts: the shim defines a global
 * `window`, which the SpacetimeDB SDK takes for a browser's (it reconnects through
 * window.addEventListener), so shared/rules/index.ts, which the client loads for sheetText and
 * cardText, keeps it out (shared/rules/index.test.ts), and so does the client.
 */

const ROOT = import.meta.dirname;
const V2 = resolve(ROOT, "..");
const SHARED = join(V2, "shared");
const BANNED = [join(SHARED, "rules", "pin.ts"), join(SHARED, "rules", "shim.ts")];
const PACKAGES = /^(?:node:|spacetimedb(?:\/|$)|react(?:\/|$)|@opentui\/)/;
const IMPORT = /(?:^|\s)(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|^import\s*["']([^"']+)["']/gm;
const files = readdirSync(ROOT, { recursive: true, encoding: "utf8" }).filter(f => /\.(ts|tsx)$/.test(f) && !f.startsWith(`module_bindings${sep}`));

test("client/ imports itself, shared/ (not the engine's shim), its packages and the bindings: never the engine, the AI service, the simulation or the prototype", () => {
  const outside: string[] = [];
  for (const file of files) {
    for (const m of readFileSync(join(ROOT, file), "utf8").matchAll(IMPORT)) {
      const spec = (m[1] ?? m[2] ?? m[3])!;
      if (PACKAGES.test(spec)) continue;
      const target = spec.startsWith(".") ? resolve(dirname(join(ROOT, file)), spec) : undefined;
      if (target && (target.startsWith(ROOT + sep) || (target.startsWith(SHARED + sep) && !BANNED.includes(target)))) continue;
      outside.push(`${file}: ${spec}`);
    }
  }
  assert.ok(files.length > 30, "the scan found the folder's code");
  assert.deepEqual(outside, []);
});

test("the client's code loads without the engine's shim: no global window for the SDK to take for a browser's", async () => {
  await import("./net/connection.ts");
  await import("./headless.ts");
  await import("./app/model.ts");
  await import("./demo.ts");
  assert.equal("window" in globalThis, false);
});
