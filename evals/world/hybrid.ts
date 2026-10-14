import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCases } from "./cases.ts";
import { applyOpsV2, type WorldOpV2 } from "./language.ts";
import { scoreCase } from "./score.ts";

/**
 * The hybrid, assembled from recorded runs (no new model calls): the decider's answers for where
 * people are and who holds what, and an operations writer for everything else (states, arrivals,
 * notes, wreckage), run side by side. Latency is the slower of the two; cost is both.
 *
 *   node --no-warnings evals/world/hybrid.ts runs/evals/world-all decider-jev ops-low [ops ...]
 */
const [dir, decider, ...writers] = process.argv.slice(2);
if (!dir || !decider || !writers.length) throw new Error("Usage: hybrid.ts <results dir> <decider system> <ops system> [...]");
const file = join(dir, "results.json");
const data = JSON.parse(readFileSync(file, "utf8")) as { results: Array<Record<string, unknown> & { system: string; case: string; sample: number; trace: unknown; costUsd: number; latencyMs: number; calls: number }> };
const cases = loadCases();
const POSITIONAL = new Set(["move", "place", "give", "drop", "remove"]);
const opsOf = (trace: unknown) => { const t = trace as unknown[]; return ((Array.isArray(t?.[0]) ? t.at(-1) : t) ?? []) as WorldOpV2[]; };
for (const writer of writers) {
  const name = `${decider}+${writer}`;
  data.results = data.results.filter(r => r.system !== name);
  for (const d of data.results.filter(r => r.system === decider)) {
    const w = data.results.find(r => r.system === writer && r.case === d.case && r.sample === d.sample);
    const c = cases.find(x => x.id === d.case);
    if (!w || !c) continue;
    // The writer's own moves stand only where it puts something the decider can't: "away"/"toward" distances.
    const ops = [...opsOf(d.trace), ...opsOf(w.trace).filter(op => !POSITIONAL.has(op.op) || op.how === "away" || op.how === "toward")];
    const world = structuredClone(c.world);
    const applied = applyOpsV2(world, ops.slice(0, 24), c.turn);
    data.results.push({ system: name, case: d.case, sample: d.sample, world, score: scoreCase(c, world, applied.problems), trace: ops, problems: applied.problems, costUsd: d.costUsd + w.costUsd, latencyMs: Math.max(d.latencyMs, w.latencyMs), calls: 2 });
  }
}
writeFileSync(file, JSON.stringify(data, null, 1));
console.log(`Added ${writers.map(w => `${decider}+${w}`).join(", ")} to ${file}: rescore to see them.`);
