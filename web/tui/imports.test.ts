import assert from "node:assert/strict";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { test } from "node:test";

/**
 * web/tui's rule (browser-design §5): the JS OpenTUI the page draws with imports only itself and its
 * packages (React and its reconciler, Yoga, xterm's Unicode 11 widths, and the fonts module the build
 * makes), never client/ (whose imports of OpenTUI a bundle points here) or the prototype, and
 * nothing of Node's, since it runs in a browser's worker. And it finds React where the client finds
 * it, in the repo's node_modules, so a bundle of the two holds one React: with two, the screens die on their
 * first hook.
 */

const ROOT = import.meta.dirname;
const V2 = resolve(ROOT, "..", "..");
const PACKAGES = /^(?:react(?:\/|$)|react-reconciler(?:\/|$)|yoga-layout(?:\/|$)|@xterm\/addon-unicode11$|virtual:opentui-fonts$)/;
const IMPORT = /(?:^|\s)(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|^import\s*["']([^"']+)["']/gm;
const files = readdirSync(ROOT).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"));

test("web/tui imports itself and its packages: never client/, the prototype or Node", () => {
  const outside: string[] = [];
  for (const file of files) {
    for (const m of readFileSync(join(ROOT, file), "utf8").matchAll(IMPORT)) {
      const spec = (m[1] ?? m[2] ?? m[3])!;
      if (PACKAGES.test(spec)) continue;
      if (spec.startsWith(".") && dirname(resolve(ROOT, spec)) === ROOT) continue;
      outside.push(`${file}: ${spec}`);
    }
  }
  assert.ok(files.length >= 16, "the scan found the stand-in's code");
  assert.deepEqual(outside, []);
});

test("web/tui finds React, and its reconciler finds React and the scheduler, where the client finds React: one copy each, in the repo's node_modules", () => {
  const fromTui = createRequire(join(ROOT, "react.ts"));
  const fromClient = createRequire(join(V2, "client", "app.tsx"));
  const reconciler = fromTui.resolve("react-reconciler");
  const modules = realpathSync(join(V2, "node_modules")) + sep;
  for (const found of [fromTui.resolve("react"), reconciler, createRequire(reconciler).resolve("scheduler")]) assert.ok(found.startsWith(modules), found);
  assert.equal(fromTui.resolve("react"), fromClient.resolve("react"));
  assert.equal(createRequire(reconciler).resolve("react"), fromClient.resolve("react"));
});
