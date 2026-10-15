import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { importMeta, openTuiFonts, virtualModules } from "../../static/plugins.ts";

/**
 * Does the browser's renderer draw what OpenTUI draws? The same screens (scenarios.tsx: small trees
 * for one feature each, and the game's own screens in app-scenarios.tsx) are drawn by OpenTUI's
 * test renderer and by src/web/tui's, at the same size and the same frozen moment, and compared
 * cell for cell: the text, and each cell's colours and attributes.
 *
 *   node --no-warnings src/web/tui/compare/run.ts [--show] [--only name]
 */

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const OUT = join(ROOT, "runs", "tui-compare");
mkdirSync(OUT, { recursive: true });
const show = process.argv.includes("--show");
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
const harness = join(ROOT, "src/web/tui/compare/harness.tsx");
const env = { ...process.env, KM_RUNS_DIR: join(OUT, "runs"), KM_GLYPHS: process.env.KM_GLYPHS ?? "ascii", KM_LOOK_MODEL: "off", OPENROUTER_API_KEY: "offline", KM_COMPARE_ONLY: only ?? "" };

// OpenTUI's own, through tsx.
const realOut = join(OUT, "opentui.json");
const real = spawnSync(process.execPath, ["--experimental-ffi", "--no-warnings", "--import", "tsx", harness, realOut], { cwd: ROOT, env, encoding: "utf8" });
if (real.status !== 0) { console.error(real.stdout, real.stderr); process.exit(1); }

// This directory's, bundled with the browser build's aliases (but for Node).
const bundle = join(OUT, "harness.mjs");
await build({
  entryPoints: [harness],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: bundle,
  jsx: "automatic",
  jsxImportSource: "@opentui/react",
  alias: {
    "@opentui/core": join(ROOT, "src/web/tui/core.ts"),
    "@opentui/react/test-utils": join(ROOT, "src/web/tui/testing.ts"),
    "@opentui/react/jsx-runtime": "react/jsx-runtime",
    "@opentui/react/jsx-dev-runtime": "react/jsx-dev-runtime",
    "@opentui/react": join(ROOT, "src/web/tui/react.ts"),
  },
  plugins: [importMeta({ root: ROOT, virtualRoot: ROOT }), virtualModules({ "virtual:opentui-fonts": () => `export default ${JSON.stringify(openTuiFonts(ROOT))};` })],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: "warning",
});
const mineOut = join(OUT, "browser.json");
const mine = spawnSync(process.execPath, ["--no-warnings", bundle, mineOut], { cwd: ROOT, env, encoding: "utf8" });
if (mine.status !== 0) { console.error(mine.stdout, mine.stderr); process.exit(1); }

interface Captured { name: string; width: number; height: number; frame: string; styles: string[][]; error?: string }
const a = JSON.parse(readFileSync(realOut, "utf8")) as Captured[];
const b = JSON.parse(readFileSync(mineOut, "utf8")) as Captured[];

let failed = 0;
for (const r of a) {
  const m = b.find(x => x.name === r.name);
  if (!m) { console.log(`MISSING: ${r.name}`); failed++; continue; }
  if (r.error || m.error) { console.log(`ERROR: ${r.name}\n  opentui: ${r.error ?? "-"}\n  browser: ${m.error ?? "-"}`); failed++; continue; }
  const ra = r.frame.split("\n"), rb = m.frame.split("\n");
  const textDiffs: number[] = [];
  for (let y = 0; y < Math.max(ra.length, rb.length); y++) if (ra[y] !== rb[y]) textDiffs.push(y);
  let styleDiffs = 0;
  const firstStyle: string[] = [];
  for (let y = 0; y < Math.max(r.styles.length, m.styles.length); y++) {
    const sa = r.styles[y] ?? [], sb = m.styles[y] ?? [];
    for (let x = 0; x < Math.max(sa.length, sb.length); x++) {
      if (sa[x] !== sb[x]) {
        styleDiffs++;
        if (firstStyle.length < 6) firstStyle.push(`(${x},${y}) opentui ${sa[x]} browser ${sb[x]}`);
      }
    }
  }
  if (!textDiffs.length && !styleDiffs) { console.log(`ok: ${r.name} (${r.width}x${r.height})`); if (show) console.log(r.frame); continue; }
  failed++;
  console.log(`DIFF: ${r.name} (${r.width}x${r.height}): ${textDiffs.length} rows of text, ${styleDiffs} cells of colour`);
  for (const y of textDiffs.slice(0, 12)) console.log(`  row ${y}\n    opentui |${ra[y]}|\n    browser |${rb[y]}|`);
  for (const s of firstStyle) console.log(`  ${s}`);
  if (show) { console.log("--- opentui\n" + r.frame + "\n--- browser\n" + m.frame); }
}
console.log(failed ? `FAIL: ${failed} of ${a.length}` : `PASS: ${a.length} screens alike`);
process.exit(failed ? 1 : 0);
