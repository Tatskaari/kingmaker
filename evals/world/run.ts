import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setCallLog } from "../../src/llm/openrouter.ts";
import type { SceneWorld } from "../../src/world/scene-world.ts";
import { loadCases } from "./cases.ts";
import { kindOf, met, scoreCase, summarise, type CaseScore } from "./score.ts";
import { SYSTEMS, type System } from "./systems.ts";
import type { WorldCase } from "./types.ts";

/**
 * The stage-manager eval: every system on every case, scored against the labels.
 *
 *   node --no-warnings evals/world/run.ts [--systems current,ops,tools] [--samples 2] [--cases id,...] [--concurrency 6]
 *   node --no-warnings evals/world/run.ts --rescore runs/evals/world-<stamp>        (after changing labels)
 *   node --no-warnings evals/world/run.ts --report runs/evals/world-<stamp> [--system ops]   (read the failures)
 *
 * Results go to runs/evals/world-<stamp>/ (results.json, summary.md). The numbers are a flag, not a
 * target: read the failures before believing them.
 */

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

interface Result {
  system: string; case: string; sample: number;
  world?: SceneWorld;
  score?: CaseScore;
  error?: string;
  trace?: unknown; problems?: string[];
  costUsd: number; latencyMs: number; calls: number; inputTokens?: number; outputTokens?: number;
}

async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) await work(items[next++]!); }));
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : 0; };

const KIND_GROUP = { move: "positions", held: "hand-overs", drop: "hand-overs", state: "states", create: "arrivals", gone: "exits" } as const;
const FALSE_GROUP: Record<string, string> = { "spurious-move": "positions", "wrong-place": "positions", "spurious-transfer": "hand-overs", "spurious-state": "states", "contradicts-rules": "states", "over-creation": "arrivals", duplicate: "arrivals", "spurious-exit": "exits", "wrong-id": "wrong ids" };

/** Recall by kind of change (positions, hand-overs, states, arrivals, exits), and false changes by kind. */
function byKind(cases: WorldCase[], results: Result[]): Record<string, { hit: number; of: number; false: number }> {
  const out: Record<string, { hit: number; of: number; false: number }> = {};
  const at = (k: string) => (out[k] ??= { hit: 0, of: 0, false: 0 });
  for (const r of results) {
    if (!r.score || !r.world) continue;
    const c = cases.find(x => x.id === r.case)!;
    for (const x of c.expect) {
      const group = KIND_GROUP[kindOf(x) as keyof typeof KIND_GROUP];
      if (!group) continue;
      at(group).of++;
      if (met(x, c.world, r.world)) at(group).hit++;
    }
    for (const f of r.score.failures) if (!f.detail.startsWith("missed") && FALSE_GROUP[f.class]) at(FALSE_GROUP[f.class]!).false++;
  }
  return out;
}

function table(cases: WorldCase[], results: Result[]): string {
  const systems = [...new Set(results.map(r => r.system))];
  const lines = ["system | cases passed | precision | recall | F1 | notes found | extra notes | errors | cost/turn | latency p50 / p90 | model calls/turn", "---|---|---|---|---|---|---|---|---|---|---"];
  for (const s of systems) {
    const rs = results.filter(r => r.system === s);
    const sum = summarise(rs.filter(r => r.score).map(r => r.score!));
    const lat = rs.filter(r => !r.error).map(r => r.latencyMs);
    lines.push(`${s} | ${sum.passed}/${sum.cases} | ${pct(sum.precision)} (${sum.explained}/${sum.explained + sum.unexplained}) | ${pct(sum.recall)} (${sum.hits}/${sum.expected}) | ${pct(sum.f1)} | ${sum.notes.found}/${sum.notes.expected} | ${sum.notes.extra} | ${rs.filter(r => r.error).length} | $${(rs.reduce((a, r) => a + r.costUsd, 0) / Math.max(1, rs.length - rs.filter(r => r.error).length)).toFixed(5)} | ${(quantile(lat, 0.5) / 1000).toFixed(1)} s / ${(quantile(lat, 0.9) / 1000).toFixed(1)} s | ${(rs.reduce((a, r) => a + r.calls, 0) / rs.length).toFixed(1)}`);
  }
  lines.push("", "Failures by class (summed over samples):");
  for (const s of systems) {
    const sum = summarise(results.filter(r => r.system === s && r.score).map(r => r.score!));
    lines.push(`- ${s}: ${Object.entries(sum.failures).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
  }
  lines.push("", "By kind of change (expected changes made / expected; false changes):");
  for (const s of systems) {
    const k = byKind(cases, results.filter(r => r.system === s));
    lines.push(`- ${s}: ${Object.entries(k).map(([name, v]) => `${name} ${v.of ? `${v.hit}/${v.of}` : "-"}${v.false ? ` (+${v.false} false)` : ""}`).join("; ")}`);
  }
  return lines.join("\n");
}

function report(dir: string, system?: string, only?: string): void {
  const { results } = JSON.parse(readFileSync(join(dir, "results.json"), "utf8")) as { results: Result[] };
  for (const r of results.filter(x => (!system || x.system === system) && (!only || x.case === only))) {
    const fails = r.score?.failures ?? [];
    if (!fails.length && !r.error && !only) continue;
    console.log(`\n### ${r.system} · ${r.case} · sample ${r.sample}${r.error ? ` · ERROR ${r.error}` : ""}`);
    for (const f of fails) console.log(`- ${f.class}: ${f.detail}`);
    console.log(`  trace: ${JSON.stringify(r.trace).slice(0, 2500)}`);
  }
}

async function main(): Promise<void> {
  const reportDir = flag("report");
  if (reportDir) { report(reportDir, flag("system"), flag("case")); return; }
  const rescore = flag("rescore");
  if (rescore) {
    const data = JSON.parse(readFileSync(join(rescore, "results.json"), "utf8")) as { results: Result[] };
    const cases = loadCases();
    for (const r of data.results) {
      const c = cases.find(x => x.id === r.case);
      if (c && r.world) r.score = scoreCase(c, r.world, r.problems ?? []);
    }
    writeFileSync(join(rescore, "results.json"), JSON.stringify(data, null, 1));
    const summary = table(cases, data.results);
    writeFileSync(join(rescore, "summary.md"), summary + "\n");
    console.log(summary);
    return;
  }
  const names = (flag("systems") ?? "current,ops").split(",");
  const samples = Number(flag("samples") ?? 1);
  const cases = loadCases(flag("cases")?.split(","));
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const out = flag("out") ?? join("runs", "evals", `world-${stamp}`);
  mkdirSync(out, { recursive: true });
  setCallLog(join(out, "calls.jsonl"));
  const results: Result[] = [];
  for (const name of names) {
    const make = SYSTEMS[name];
    if (!make) throw new Error(`Unknown system ${name}. Known: ${Object.keys(SYSTEMS).join(", ")}`);
    const system: System = make();
    const jobs = cases.flatMap(c => Array.from({ length: samples }, (_, sample) => ({ c, sample })));
    await pool(jobs, Number(flag("concurrency") ?? 6), async ({ c, sample }) => {
      try {
        const run = await system.run(c);
        const score = scoreCase(c, run.world, run.problems);
        results.push({ system: name, case: c.id, sample, world: run.world, score, trace: run.trace, problems: run.problems, costUsd: run.costUsd, latencyMs: run.latencyMs, calls: run.calls, ...(run.inputTokens ? { inputTokens: run.inputTokens, outputTokens: run.outputTokens } : {}) });
        process.stderr.write(`${name} ${c.id}#${sample}: ${score.pass ? "pass" : score.failures.map(f => f.class).join(",")} (${Math.round(run.latencyMs)} ms)\n`);
      } catch (error) {
        results.push({ system: name, case: c.id, sample, error: error instanceof Error ? error.message : String(error), costUsd: 0, latencyMs: 0, calls: 0 });
        process.stderr.write(`${name} ${c.id}#${sample}: ERROR ${error instanceof Error ? error.message : String(error)}\n`);
      }
    });
  }
  writeFileSync(join(out, "results.json"), JSON.stringify({ cases: cases.map(c => c.id), results }, null, 1));
  const summary = table(cases, results);
  writeFileSync(join(out, "summary.md"), summary + "\n");
  console.log(`\n${summary}\n\nResults: ${out}`);
}

await main();
