/**
 * Memory eval: does a character remember, in a later scene, what the player did earlier?
 * Each case plays scripted turns (memory reviews awaited after each, as the background child
 * would finish them), chains into the next scene (forcing an ending with "#end <exit>" if
 * needed), then asks probe questions. A judge compares each probe reply with what actually
 * happened. Compare approaches: hand-offs only (v2), V1's docs service (v2-memory), the lite one.
 *
 * node --no-warnings src/eval/memory-eval.ts [--case id,id] [--approach v2,v2-memory] [--samples 1]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sceneById } from "../../scenes/index.ts";
import { rememberTurn } from "../lore/remember.ts";
import { reviewTurn } from "../lore/reviews.ts";
import { respondJson, LUNA, setCallLog } from "../llm/openrouter.ts";
import { approachById } from "../runtime/approaches.ts";
import { effectiveScene, scriptTranscript } from "../runtime/brief.ts";
import { chainScene, createSession, forceEnding, openScene, playerTurn } from "../runtime/engine.ts";
import { sessionDir, type SessionState } from "../runtime/session.ts";
import { MEMORY_CASES, type MemoryCase } from "./cases/memory.ts";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const caseIds = flag("case")?.split(",");
const approaches = (flag("approach") ?? "v2,v2-memory").split(",");
const samples = Number(flag("samples") ?? 1);
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
const outDir = join("runs", "evals", `${stamp}-memory`);
mkdirSync(outDir, { recursive: true });

async function remember(state: SessionState): Promise<void> {
  const memory = approachById(state.approach).memory;
  const scene = effectiveScene(sceneById(state.sceneId), state.patches);
  if (memory === "docs") await reviewTurn(scene, state, state.turn).catch(() => undefined);
  if (memory === "lite") await rememberTurn(scene, state, state.turn).catch(() => undefined);
}

async function advance(state: SessionState): Promise<void> {
  if (!state.ended) return;
  const next = await chainScene(state);
  if (next) await openScene(next);
}

interface ProbeResult { say: string; expect: string; scene: string; reply: string; opened: string[]; firstTextMs: number | null; pass?: boolean; reason?: string }

async function judge(state: SessionState, probe: ProbeResult): Promise<{ pass: boolean; reason: string }> {
  const history = state.history.map(h => h.summary).join("\n\n");
  const transcript = state.transcript.filter(e => e.kind !== "system").map(e => `${e.kind === "player" ? "PLAYER" : e.kind === "roll" ? "DICE" : "GM"} [${e.scene ?? state.sceneId}]: ${e.text}`).join("\n");
  const result = await respondJson<{ pass: boolean; reason: string }>({
    operation: "judge.memory", model: LUNA, effort: "high",
    instructions: "You judge memory in a roleplaying game. The player asked something that depends on what happened earlier (often in an earlier scene). Judge only the final reply: does it get the earlier events right, for the person answering (they can only know what they saw or were told)? Pass if it meets the criterion without inventing or contradicting what happened. Fail if it forgets, gets it wrong, or gives someone knowledge they couldn't have.",
    input: [{ role: "user", content: `## Criterion\n${probe.expect}\n\n## What happened (the full story so far)\n${transcript}\n\n## Scene summaries\n${history}\n\n## The probe\nPLAYER: ${probe.say}\n\n## The reply to judge\n${probe.reply}` }],
    json: { name: "verdict", schema: { type: "object", additionalProperties: false, required: ["pass", "reason"], properties: { pass: { type: "boolean" }, reason: { type: "string" } } } },
  });
  return { pass: result.pass, reason: result.reason };
}

async function run(c: MemoryCase, approach: string, sample: number) {
  const id = `${c.id}--${approach}--${sample}`;
  const state = await createSession({ sceneId: c.scene, approach, id: `${stamp}-${id}` });
  setCallLog(join(sessionDir(state.id), "calls.jsonl"));
  await openScene(state);
  for (const say of c.turns) {
    if (say.startsWith("#end ")) { forceEnding(state, say.slice(5).trim()); await advance(state); continue; }
    if (state.ended) await advance(state);
    await playerTurn(state, say);
    await remember(state);
    await advance(state);
  }
  const probes: ProbeResult[] = [];
  for (const p of c.probes) {
    if (p.say.startsWith("#end ")) { if (!state.ended) forceEnding(state, p.say.slice(5).trim()); await advance(state); continue; }
    if (state.ended) await advance(state);
    const result = await playerTurn(state, p.say);
    const reply = scriptTranscript(sceneById(state.sceneId), state, result.entries.filter(e => e.kind !== "player"));
    const probe: ProbeResult = { say: p.say, expect: p.expect, scene: state.sceneId, reply, opened: (state.memory?.opened ?? []).filter(n => n.turn === state.turn).map(n => `${n.scope}: ${n.title}`), firstTextMs: result.metric.firstTextMs };
    Object.assign(probe, await judge(state, probe));
    probes.push(probe);
    await remember(state);
  }
  return { case: c.id, approach, sample, session: state.id, probes };
}

const cases = MEMORY_CASES.filter(c => !caseIds || caseIds.some(x => c.id.startsWith(x)));
const results = [];
for (const c of cases) for (const a of approaches) for (let s = 0; s < samples; s++) {
  const r = await run(c, a, s).catch(e => ({ case: c.id, approach: a, sample: s, error: String(e), probes: [] as ProbeResult[] }));
  results.push(r);
  writeFileSync(join(outDir, "results.json"), JSON.stringify(results, null, 1));
  for (const p of r.probes) console.log(`${c.id} ${a} #${s} ${p.pass ? "PASS" : "FAIL"} [${p.scene}] ${p.say.slice(0, 50)} | ${p.reason?.slice(0, 160)}`);
}
const lines = ["| case | approach | passed | first text ms |", "|---|---|---|---|"];
for (const c of cases) for (const a of approaches) {
  const rs = results.filter(r => r.case === c.id && r.approach === a).flatMap(r => r.probes);
  lines.push(`| ${c.id} | ${a} | ${rs.filter(p => p.pass).length}/${rs.length} | ${Math.round(rs.reduce((x, p) => x + (p.firstTextMs ?? 0), 0) / Math.max(1, rs.length))} |`);
}
writeFileSync(join(outDir, "summary.md"), lines.join("\n") + "\n");
console.log(`\n${lines.join("\n")}\n-> ${outDir}`);
