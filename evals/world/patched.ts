import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyOps, type WorldOp } from "../../src/world/scene-world.ts";
import { loadCases } from "./cases.ts";
import { applyOpsV2, type WorldOpV2 } from "./language.ts";
import { scoreCase } from "./score.ts";

/**
 * What the small world-module patches alone would do for today's stage manager: its recorded
 * operations (from the eval's call log) applied as they are, and through the patches (a forgiving
 * selector, and saying where someone already is isn't a move). No new model calls.
 *
 *   node --no-warnings evals/world/patched.ts runs/evals/world-main runs/evals/world-all
 */
const [from, into] = process.argv.slice(2);
if (!from || !into) throw new Error("Usage: patched.ts <run dir with calls.jsonl> <results dir to add to>");
const calls = readFileSync(join(from, "calls.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l) as { operation: string; text?: string; request?: { input?: Array<{ content: string }> } })
  .filter(l => l.operation === "world.stage" && l.text);
const data = JSON.parse(readFileSync(join(into, "results.json"), "utf8")) as { results: Array<Record<string, unknown>> };
data.results = data.results.filter(r => r.system !== "current (replayed)" && r.system !== "current+patches");
const cases = loadCases();
const seen = new Map<string, number>();
for (const call of calls) {
  const input = call.request?.input?.[0]?.content ?? "";
  const c = cases.find(x => input.includes(`Player: ${x.playerTurn}\n\nGM: ${x.reply.slice(0, 200)}`));
  if (!c) continue;
  const sample = seen.get(c.id) ?? 0;
  seen.set(c.id, sample + 1);
  let ops: WorldOp[] = [];
  try { ops = (JSON.parse(call.text!) as { ops: WorldOp[] }).ops.slice(0, 12); } catch { continue; }
  const plain = structuredClone(c.world);
  const a = applyOps(plain, ops, c.turn, "stage");
  data.results.push({ system: "current (replayed)", case: c.id, sample, world: plain, score: scoreCase(c, plain, a.problems), trace: ops, problems: a.problems, costUsd: 0, latencyMs: 0, calls: 1 });
  const patched = structuredClone(c.world);
  const b = applyOpsV2(patched, ops.map(op => ({ ...op, feet: 0 }) as WorldOpV2), c.turn, "stage", { resolve: true });
  data.results.push({ system: "current+patches", case: c.id, sample, world: patched, score: scoreCase(c, patched, b.problems), trace: ops, problems: b.problems, costUsd: 0, latencyMs: 0, calls: 1 });
}
writeFileSync(join(into, "results.json"), JSON.stringify(data, null, 1));
console.log(`Replayed ${[...seen.values()].reduce((a, b) => a + b, 0)} recorded stage-manager calls over ${seen.size} cases into ${into}: rescore to see them.`);
