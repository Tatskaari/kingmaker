import { readFileSync } from "node:fs";
import { join } from "node:path";

/** npm run -s compare -- <eval dir> [<eval dir> ...]: per-approach aggregates side by side. */
const dirs = process.argv.slice(2);
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const f = (x: number, d = 2) => Number.isFinite(x) ? x.toFixed(d) : "-";

interface Row { approach?: string; decider?: string; ok: boolean; scores?: Record<string, number>; criterion?: { pass: boolean }; mechanical?: { pass: boolean }; progress?: number; exit?: string; turns?: number; tangents?: Array<{ handled: string }>; correct?: boolean; latencyMs?: number; firstTextMs?: number | null; avgFirstTextMs?: number }

for (const dir of dirs) {
  const rows = JSON.parse(readFileSync(join(dir, "results.json"), "utf8")) as Row[];
  console.log(`\n## ${dir}`);
  const byApproach = new Map<string, Row[]>();
  for (const r of rows) if (r.approach) byApproach.set(r.approach, [...(byApproach.get(r.approach) ?? []), r]);
  if (byApproach.size) {
    console.log("| approach | n | progress | criterion | mechanical | intent | consistency | characters | steering | craft | badly/total tangents | ended | first text ms |");
    console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const [a, rs] of byApproach) {
      const ok = rs.filter(r => r.ok);
      const tangents = ok.flatMap(r => r.tangents ?? []);
      const dims = ["intent", "consistency", "characters", "steering", "craft"].map(d => f(mean(ok.map(r => r.scores?.[d] ?? NaN).filter(Number.isFinite))));
      console.log(`| ${a} | ${ok.length}/${rs.length} | ${f(mean(ok.map(r => r.progress ?? NaN).filter(Number.isFinite)))} | ${ok.filter(r => r.criterion?.pass).length}/${ok.length} | ${ok.some(r => r.mechanical) ? `${ok.filter(r => r.mechanical?.pass).length}/${ok.length}` : "-"} | ${dims.join(" | ")} | ${tangents.length ? `${tangents.filter(t => t.handled === "badly").length}/${tangents.length}` : "-"} | ${ok.some(r => r.exit !== undefined) ? `${ok.filter(r => r.exit && r.exit !== "none").length}/${ok.length}` : "-"} | ${f(mean(ok.map(r => r.avgFirstTextMs ?? r.firstTextMs ?? NaN).filter(Number.isFinite)), 0)} |`);
    }
  }
  const byDecider = new Map<string, Row[]>();
  for (const r of rows) if (r.decider) byDecider.set(r.decider, [...(byDecider.get(r.decider) ?? []), r]);
  if (byDecider.size) {
    console.log("| decider | accuracy | latency ms |\n|---|---|---|");
    for (const [d, rs] of byDecider) console.log(`| ${d} | ${f(100 * mean(rs.map(r => r.correct ? 1 : 0)), 0)}% | ${f(mean(rs.filter(r => r.ok).map(r => r.latencyMs!)), 0)} |`);
  }
}
