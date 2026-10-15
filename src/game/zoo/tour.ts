/**
 * The zoo's tour, headless: every wing, every sign read, every exhibit set off, every scene played
 * to an ending and every fight fought to its end, with pictures of what the screen showed and a
 * report of what each exhibit played against what it should (src/game/zoo/touring.ts).
 *
 *   node --no-warnings src/game/zoo/tour.ts                 offline: the GM is silent, scenes take their endings at once
 *   node --no-warnings src/game/zoo/tour.ts --live          the scenes' lines said to the real GM first
 *   node --no-warnings src/game/zoo/tour.ts --only fire,arena --no-png --out runs/zoo-tour/mine --seed 3
 *
 * Offline it sets OPENROUTER_API_KEY=offline (so no model is asked); --live leaves the key to the
 * game, which reads OPENROUTER_API_KEY or ~/secrets/kingmaker-dev-openrouter.txt (it's never
 * printed). Glyphs are ASCII and the look layer's model is off unless set otherwise. Saves go to
 * runs/zoo-tour/<stamp>/sessions; the pictures and report.txt / report.json beside them. Exits 1
 * on any failure.
 */
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => { const i = args.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`)); if (i < 0) return undefined; const a = args[i]!; return a.includes("=") ? a.slice(a.indexOf("=") + 1) : args[i + 1]; };

if (flag("help")) {
  console.log("usage: node --no-warnings src/game/zoo/tour.ts [--live] [--only wing,wing] [--no-png] [--out dir] [--seed n]");
  process.exit(0);
}

const live = flag("live");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
const out = resolve(value("out") ?? join("runs", "zoo-tour", stamp));
process.env.KM_GLYPHS ??= "ascii";
process.env.KM_LOOK_MODEL ??= "off";
process.env.KM_RUNS_DIR ??= join(out, "runs");
if (!live) process.env.OPENROUTER_API_KEY = "offline";

const { runTour } = await import("./touring.ts");
const only = value("only")?.split(",").map(s => s.trim()).filter(Boolean);
const report = await runTour({ out, live, png: !flag("no-png"), seed: Number(value("seed") ?? 1), ...(only ? { only } : {}), log: line => console.log(line) });
console.log(`\n${report.exhibits.length} exhibits, ${report.exhibits.reduce((n, x) => n + x.steps.length, 0)} steps, ${report.seen} of ${report.total} exhibits seen, in ${Math.round(report.ms / 1000)} s.`);
console.log(`Report: ${join(out, "report.txt")}`);
if (report.failures.length) {
  console.log(`FAIL (${report.failures.length}):`);
  for (const f of report.failures) console.log(`  ${f}`);
  process.exit(1);
}
console.log("PASS");
process.exit(0);
