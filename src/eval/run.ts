import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deciderFor } from "../llm/decide.ts";
import { respond, setCallLog } from "../llm/openrouter.ts";
import { sceneById } from "../../scenes/index.ts";
import { approachById } from "../runtime/approaches.ts";
import { effectiveScene, prompt, scriptTranscript } from "../runtime/brief.ts";
import { decideAfter, decideBefore } from "../runtime/director.ts";
import { chainScene, openScene, playerTurn } from "../runtime/engine.ts";
import { applyRepair, expireNotes, runRepair, shouldRepair } from "../runtime/repair.ts";
import type { SessionState } from "../runtime/session.ts";
import { buildFixture } from "./fixtures.ts";
import { DIMENSIONS, judgeTrajectory, judgeTurn, judgeWorldUpdate, type Dimension } from "./judge.ts";
import { describeOperations, scribe } from "../world/scribe.ts";
import { CASES } from "./cases/index.ts";
import type { DecisionCase, EvalCase, OpeningCase, ReplyCase, TrajectoryCase } from "./types.ts";

/**
 * npm run eval -- [--suite reply|decision|trajectory] [--case a,b] [--tag t] [--approach gm,actors]
 *                 [--decider jev,luna-none] [--samples 3] [--concurrency 8] [--label note]
 */

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i === -1 ? undefined : args[i + 1]; };
const list = (name: string) => opt(name)?.split(",").map(s => s.trim()).filter(Boolean);

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
const label = opt("label");
const outDir = join("runs", "evals", `${stamp}${label ? `-${label}` : ""}`);
mkdirSync(outDir, { recursive: true });
process.env.KM_RUNS_DIR = outDir;
setCallLog(join(outDir, "calls.jsonl"));

const samples = Number(opt("samples") ?? 3);
const concurrency = Number(opt("concurrency") ?? 8);
const suites = list("suite");
const caseIds = list("case");
const tags = list("tag");
const approachFilter = list("approach");
const deciders = list("decider") ?? ["jev", "luna-none"];

/** Scene endings found in recorded sessions: each snapshot taken at an exit turn. */
function sceneEndings(dirs: string[]): Array<{ path: string; state: SessionState }> {
  const found: Array<{ path: string; state: SessionState }> = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/-turn-\d+\.json$/.test(entry.name) && path.includes("snapshots")) {
        const state = JSON.parse(readFileSync(path, "utf8")) as SessionState;
        if (state.ended) found.push({ path, state });
      }
    }
  };
  for (const dir of dirs) walk(dir);
  return found;
}

const selected = CASES.filter(c => (!suites || suites.includes(c.kind)) && (!caseIds || caseIds.some(id => c.id === id || c.id.startsWith(id)))
  && (!tags || tags.some(t => c.tags?.includes(t))));
const worldSuite = suites?.includes("world");
if (!selected.length && !worldSuite) { console.error("No cases selected."); process.exit(1); }

async function pool<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) { const i = next++; results[i] = await tasks[i]!(); }
  }));
  return results;
}

const clone = <T>(x: T): T => structuredClone(x);
const DEFAULT_APPROACHES = ["gm", "actors"];

interface ReplyRun {
  case: string; approach: string; sample: number; ok: boolean; error?: string;
  mechanical?: { pass: boolean; notes: string[] };
  scores?: Record<Dimension, number>; reasons?: Record<Dimension, string>; criterion?: { pass: boolean; reason: string };
  reply?: string; firstTextMs?: number | null; preDecisionMs?: number; costUsd?: number;
}

async function runReply(c: ReplyCase, approach: string, sample: number): Promise<ReplyRun> {
  const id = `${c.id}--${approach}--${sample}`;
  try {
    const scene = sceneById(c.scene);
    const state = buildFixture(c.scene, c.setup, { id, approach, seed: 1000 + sample * 7 });
    if (approachById(approach).repair !== "off") {
      const repair = await runRepair(scene, state, { effort: approachById(approach).repairEffort ?? "medium" });
      applyRepair(scene, state, repair);
    }
    const before = clone(state);
    const result = await playerTurn(state, c.input);
    const notes: string[] = [];
    let pass = true;
    const moves = state.path.filter(p => p.turn === state.turn);
    if (c.expect?.transition) {
      const taken = moves.map(m => m.via);
      const ok = c.expect.transition.includes("none") ? taken.length === 0 || taken.every(t => c.expect!.transition!.includes(t)) : taken.some(t => c.expect!.transition!.includes(t));
      if (!ok) { pass = false; notes.push(`transition: took [${taken.join(", ") || "none"}], expected ${c.expect.transition.join("|")}`); }
    }
    if (c.expect?.roll) {
      const rolled = moves.find(m => m.roll)?.roll?.skill ?? "none";
      if (rolled !== c.expect.roll) { pass = false; notes.push(`roll: ${rolled}, expected ${c.expect.roll}`); }
    }
    if (c.expect?.exit) {
      const exit = state.ended?.exitId ?? "none";
      const ok = c.expect.exit === "none" ? exit === "none" : c.expect.exit.includes(exit);
      if (!ok) { pass = false; notes.push(`exit: ${exit}, expected ${Array.isArray(c.expect.exit) ? c.expect.exit.join("|") : c.expect.exit}`); }
    }
    const verdict = await judgeTurn(effectiveScene(scene, before.patches), before, result.entries, c.criterion);
    return {
      case: c.id, approach, sample, ok: true, mechanical: { pass, notes }, scores: verdict.scores, reasons: verdict.reasons, criterion: verdict.criterion,
      reply: scriptTranscript(scene, state, result.entries.filter(e => e.kind !== "player")),
      firstTextMs: result.metric.firstTextMs, preDecisionMs: result.metric.preDecisionMs, costUsd: result.metric.costUsd + verdict.costUsd,
    };
  } catch (error) {
    return { case: c.id, approach, sample, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

interface DecisionRun { case: string; decider: string; sample: number; ok: boolean; choice?: string; correct?: boolean; latencyMs?: number; error?: string; probabilities?: Record<string, number>; detail?: string }

async function runDecision(c: DecisionCase, decider: string, sample: number): Promise<DecisionRun> {
  try {
    const scene = sceneById(c.scene);
    const state = buildFixture(c.scene, c.setup, { id: `${c.id}--${decider}--${sample}`, approach: "gm", seed: 1 });
    state.transcript.push({ turn: state.turn + 1, scene: scene.id, speaker: "player", kind: "player", text: c.input });
    const d = deciderFor(decider);
    const started = performance.now();
    let choice = "none";
    let probabilities: Record<string, number> | undefined;
    let detail: string | undefined;
    if (c.phase === "before") {
      const pre = await decideBefore(d, scene, state, c.input, { speaker: false, ...(c.pressure ? { pressure: true } : {}) });
      const pressure = pre.pressure ? `pressure:${pre.pressure.ruling}:${pre.pressure.target}` : undefined;
      choice = pre.move?.transition.id ?? pressure ?? (pre.freeform ? `freeform:${pre.freeform.skill}` : pre.plain ? "plain" : "none");
      if (pre.pressure) detail = `${pre.pressure.skill} ${pre.pressure.stakes}/${pre.pressure.approach}/${pre.pressure.disposition}${pre.pressure.dc ? ` DC ${pre.pressure.dc}` : ""}${pre.pressure.why ? ` (${pre.pressure.why})` : ""}`;
      probabilities = { ...pre.decision?.answers.attempt?.probabilities, ...pre.decision?.answers.cue?.probabilities };
    } else {
      const post = await decideAfter(d, scene, state, c.input, c.reply ?? "");
      choice = post.move?.transition.id ?? "none";
      probabilities = post.decision?.answers.outcome?.probabilities;
    }
    // "none" means no roll and no move: something that simply happens counts too.
    const correct = c.expect.includes(choice) || (choice === "plain" && c.expect.includes("none")) || c.expect.some(e => e.endsWith("*") && choice.startsWith(e.slice(0, -1)));
    return { case: c.id, decider, sample, ok: true, choice, correct, latencyMs: performance.now() - started, ...(probabilities ? { probabilities } : {}), ...(detail ? { detail } : {}) };
  } catch (error) {
    return { case: c.id, decider, sample, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

interface TrajectoryRun {
  case: string; approach: string; sample: number; ok: boolean; error?: string; turns?: number; exit?: string;
  targetHit?: boolean; patches?: number; improvisedRoutesTaken?: number; relocations?: number; essentialsLanded?: string; withinBudget?: string; firstTextP50?: number | null; firstTextP90?: number | null;
  followUpTurns?: number; followUpP50?: number | null; blockingRepairP50?: number | null; backgroundRepairP50?: number | null; backgroundRepairP90?: number | null;
  scores?: Record<Dimension, number>; progress?: number; criterion?: { pass: boolean; reason: string };
  tangents?: Array<{ turn: number; what: string; handled: string }>; summary?: string; worstMoment?: string;
  avgFirstTextMs?: number; costUsd?: number; session?: string;
}

async function simulatePlayer(c: TrajectoryCase, state: SessionState): Promise<string> {
  const scene = sceneById(state.sceneId);
  const transcript = state.transcript.filter(e => (e.scene ?? state.sceneId) === state.sceneId)
    .map(e => e.kind === "player" ? `You: ${e.text}` : scriptTranscript(scene, state, [e])).join("\n\n");
  const result = await respond({
    operation: "player.sim", effort: "low",
    instructions: prompt("player-sim", { character: `${state.player.name}: ${state.player.concept}`, persona: c.persona }),
    input: [{ role: "user", content: `${state.history.length ? `Earlier: ${state.history.map(h => h.summary).join(" ")}\n\n` : ""}${scene.hook}\n\n${transcript}\n\nYour turn.` }],
  });
  return result.text.trim().replace(/^You:\s*/i, "");
}

async function runTrajectory(c: TrajectoryCase, approach: string, sample: number): Promise<TrajectoryRun> {
  const id = `${c.id}--${approach}--${sample}`;
  try {
    const scene = sceneById(c.scene);
    const state = buildFixture(c.scene, { transcript: [], ...(c.character ? { player: c.character } : {}) }, { id, approach, seed: 5000 + sample * 13 });
    state.turnsInBeat = 0;
    await openScene(state);
    let cost = 0;
    // Blocking and stall modes repair inside the turn; background runs between turns.
    const repairOn = ["background", "stall", "quick-block"].includes(approachById(approach).repair);
    const repairLatencies: number[] = [];
    while (!state.ended && state.turn < c.maxTurns) {
      const input = await simulatePlayer(c, state);
      const result = await playerTurn(state, input);
      cost += result.metric.costUsd;
      if (repairOn && !state.ended && shouldRepair(state)) {
        const repair = await runRepair(scene, state, { effort: approachById(approach).repairEffort ?? "medium" });
        applyRepair(scene, state, repair);
        cost += repair.costUsd;
        repairLatencies.push(repair.latencyMs);
      }
    }
    const verdict = await judgeTrajectory(effectiveScene(scene, state.patches), state, c.criterion);
    const first = state.metrics.map(m => m.firstTextMs ?? m.replyMs);
    const pct = (xs: number[], p: number) => xs.length ? Math.round([...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!) : null;
    const followUps = state.metrics.map(m => m.followUpMs).filter((x): x is number => typeof x === "number");
    const resolving = state.metrics.map(m => m.resolvingTextMs ?? m.followUpMs ?? m.firstTextMs ?? m.replyMs).filter((x): x is number => typeof x === "number");
    const blocking = state.metrics.map(m => m.repairMs ?? 0).filter(x => x > 0);
    const improvIds = new Set(state.patches.flatMap(p => [p.transition?.transition.id, p.beat?.id]).filter(Boolean));
    const essentials = effectiveScene(scene, state.patches).essentials ?? [];
    const repairStats = {
      targetHit: c.targetExits ? c.targetExits.includes(state.ended?.exitId ?? "none") : undefined,
      relocations: state.repairs.reduce((a, r) => a + ((r as { relocations?: unknown[] }).relocations?.length ?? 0), 0) + (state.decidedRelocations?.length ?? 0),
      essentialsLanded: essentials.length ? `${(state.landed ?? []).length}/${essentials.length}` : undefined,
      patches: state.patches.length,
      improvisedRoutesTaken: state.path.filter(p => improvIds.has(p.via) || improvIds.has(p.to)).length,
      firstTextP50: pct(first, 0.5), firstTextP90: pct(first, 0.9),
      withinBudget: resolving.length ? `${resolving.filter(x => x <= 5000).length}/${resolving.length}` : undefined,
      followUpTurns: followUps.length, followUpP50: pct(followUps, 0.5),
      blockingRepairP50: pct(blocking, 0.5), backgroundRepairP50: pct(repairLatencies, 0.5), backgroundRepairP90: pct(repairLatencies, 0.9),
    };
    return {
      ...repairStats,
      case: c.id, approach, sample, ok: true, turns: state.turn, exit: state.ended?.exitId ?? "none",
      scores: verdict.scores, progress: verdict.progress, criterion: verdict.criterion, tangents: verdict.tangents,
      summary: verdict.summary, worstMoment: verdict.worstMoment, session: id,
      avgFirstTextMs: Math.round(first.reduce((a, b) => a + b, 0) / Math.max(1, first.length)), costUsd: cost + verdict.costUsd,
    };
  } catch (error) {
    return { case: c.id, approach, sample, ok: false, error: error instanceof Error ? error.stack ?? error.message : String(error) };
  }
}

async function runOpening(c: OpeningCase, approach: string, sample: number): Promise<ReplyRun> {
  const id = `${c.id}--${approach}--${sample}`;
  try {
    const state = buildFixture(c.scene, c.setup, { id, approach, seed: 3000 + sample * 11 });
    if (!state.ended) throw new Error("opening fixture must be a snapshot of a scene's final turn");
    const chained = await chainScene(state);
    if (!chained) throw new Error("exit has no next scene");
    const before = clone(chained);
    const started = performance.now();
    const entries = await openScene(chained);
    const next = sceneById(chained.sceneId);
    const verdict = await judgeTurn(next, before, entries, c.criterion, "judge.opening");
    return { case: c.id, approach, sample, ok: true, mechanical: { pass: true, notes: [] }, scores: verdict.scores, reasons: verdict.reasons, criterion: verdict.criterion,
      reply: scriptTranscript(next, chained, entries), firstTextMs: performance.now() - started, costUsd: verdict.costUsd };
  } catch (error) {
    return { case: c.id, approach, sample, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const approachesFor = (c: { approaches?: string[] }) => (approachFilter ?? c.approaches ?? DEFAULT_APPROACHES).filter(a => !c.approaches || !approachFilter || c.approaches.includes(a) || approachFilter.includes(a));

const tasks: Array<() => Promise<ReplyRun | DecisionRun | TrajectoryRun | WorldRun>> = [];
for (const c of selected as EvalCase[]) {
  for (let s = 0; s < samples; s++) {
    if (c.kind === "reply") for (const a of approachesFor(c)) tasks.push(() => runReply(c, a, s));
    if (c.kind === "decision") for (const d of deciders) tasks.push(() => runDecision(c, d, s));
    if (c.kind === "trajectory") for (const a of approachesFor(c)) tasks.push(() => runTrajectory(c, a, s));
    if (c.kind === "opening") for (const a of approachesFor(c)) tasks.push(() => runOpening(c, a, s));
  }
}
interface WorldRun { case: string; ok: boolean; error?: string; exit?: string; compiled?: boolean; attempts?: number; warnings?: string[]; operations?: number; unsupported?: string[]; scores?: Record<string, number>; missing?: string[]; wrong?: string[]; costUsd?: number; latencyMs?: number }
if (worldSuite) {
  const dirs = list("from") ?? ["runs/sessions"];
  const endings = sceneEndings(dirs).filter(e => !caseIds || caseIds.some(id => e.path.includes(id)));
  const limit = Number(opt("limit") ?? 12);
  for (const ending of endings.slice(0, limit)) {
    tasks.push(async (): Promise<WorldRun> => {
      const name = ending.path.replace(/^.*sessions\//, "");
      try {
        const scene = sceneById(ending.state.sceneId);
        const authored = ending.state.ended!.operations;
        const mode = (opt("mode") ?? "append") as "append" | "reconcile";
        const result = await scribe(scene, ending.state, authored, { mode });
        const changes = mode === "append"
          ? `### Authored ending script\n${describeOperations(authored)}\n\n### Scribe update\n${describeOperations(result.check.operations)}`
          : `### Final update (the scribe reconciled the author's defaults)\n${describeOperations(result.check.operations)}`;
        const verdict = await judgeWorldUpdate(scene, ending.state, changes);
        return {
          case: name, ok: true, exit: ending.state.ended!.exitId, compiled: result.check.ok, attempts: result.attempts, warnings: result.check.warnings,
          operations: result.check.operations.length, unsupported: result.check.operations.filter(o => o.op === "unsupported").map(o => String(o.args.description)),
          scores: verdict.scores, missing: verdict.missing, wrong: verdict.wrong, costUsd: result.costUsd + verdict.costUsd, latencyMs: result.latencyMs,
        };
      } catch (error) {
        return { case: name, ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
  }
  console.log(`World suite: ${endings.length} scene endings found${endings.length > limit ? `, using ${limit}` : ""}`);
}
console.log(`Running ${tasks.length} tasks (${selected.length} cases, ${samples} samples) -> ${outDir}`);
const started = performance.now();
const results = await pool(tasks, concurrency);
writeFileSync(join(outDir, "results.json"), JSON.stringify(results, null, 1));

const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const fmt = (x: number, digits = 2) => Number.isFinite(x) ? x.toFixed(digits) : "-";
const lines: string[] = [`# Eval run ${stamp}${label ? ` (${label})` : ""}`, "", `${tasks.length} tasks in ${Math.round((performance.now() - started) / 1000)}s`, ""];

const replies = results.filter((r): r is ReplyRun => "approach" in r && !("turns" in r) && ["reply", "opening"].includes(selected.find(c => c.id === r.case)?.kind ?? ""));
if (replies.length) {
  lines.push("## Reply cases", "", `| case | approach | n | criterion | mechanical | ${DIMENSIONS.join(" | ")} | first text ms |`, `|---|---|---|---|---|${DIMENSIONS.map(() => "---").join("|")}|---|`);
  const groups = new Map<string, ReplyRun[]>();
  for (const r of replies) groups.set(`${r.case}|${r.approach}`, [...(groups.get(`${r.case}|${r.approach}`) ?? []), r]);
  for (const [key, runs] of groups) {
    const [cid, a] = key.split("|");
    const ok = runs.filter(r => r.ok);
    lines.push(`| ${cid} | ${a} | ${ok.length}/${runs.length} | ${ok.filter(r => r.criterion?.pass).length}/${ok.length} | ${ok.filter(r => r.mechanical?.pass).length}/${ok.length} | ${DIMENSIONS.map(d => fmt(mean(ok.map(r => r.scores![d]))), 1).join(" | ")} | ${fmt(mean(ok.map(r => r.firstTextMs ?? NaN)), 0)} |`);
  }
  lines.push("", "### By approach", "", `| approach | criterion pass | mechanical pass | ${DIMENSIONS.join(" | ")} |`, `|---|---|---|${DIMENSIONS.map(() => "---").join("|")}|`);
  for (const a of [...new Set(replies.map(r => r.approach))]) {
    const ok = replies.filter(r => r.approach === a && r.ok);
    lines.push(`| ${a} | ${fmt(100 * mean(ok.map(r => r.criterion?.pass ? 1 : 0)), 0)}% | ${fmt(100 * mean(ok.map(r => r.mechanical?.pass ? 1 : 0)), 0)}% | ${DIMENSIONS.map(d => fmt(mean(ok.map(r => r.scores![d])))).join(" | ")} |`);
  }
  const failures = replies.filter(r => !r.ok || !r.criterion?.pass || !r.mechanical?.pass);
  if (failures.length) {
    lines.push("", "### Failures", "");
    for (const f of failures) lines.push(`- **${f.case} / ${f.approach} #${f.sample}**: ${f.error ?? [f.criterion?.pass ? "" : `criterion: ${f.criterion?.reason}`, ...(f.mechanical?.notes ?? [])].filter(Boolean).join("; ")}`);
  }
}

const decisions = results.filter((r): r is DecisionRun => "decider" in r);
if (decisions.length) {
  lines.push("", "## Decision cases", "", `| case | ${deciders.join(" | ")} |`, `|---|${deciders.map(() => "---").join("|")}|`);
  for (const cid of [...new Set(decisions.map(r => r.case))]) {
    lines.push(`| ${cid} | ${deciders.map(d => { const rs = decisions.filter(r => r.case === cid && r.decider === d); return `${rs.filter(r => r.correct).length}/${rs.length} (${[...new Set(rs.map(r => r.choice ?? "error"))].join(",")})`; }).join(" | ")} |`);
  }
  lines.push(`| **accuracy** | ${deciders.map(d => { const rs = decisions.filter(r => r.decider === d); return `${fmt(100 * mean(rs.map(r => r.correct ? 1 : 0)), 0)}%`; }).join(" | ")} |`);
  lines.push(`| **mean latency ms** | ${deciders.map(d => fmt(mean(decisions.filter(r => r.decider === d && r.ok).map(r => r.latencyMs!)), 0)).join(" | ")} |`);
}

const trajectories = results.filter((r): r is TrajectoryRun => "turns" in r || (selected.find(c => c.id === (r as TrajectoryRun).case)?.kind === "trajectory"));
if (trajectories.length) {
  lines.push("", "## Trajectories", "", `| case | approach | n | ended | exits | turns | progress | criterion | ${DIMENSIONS.join(" | ")} | tangents well/ok/badly | first text ms |`, `|---|---|---|---|---|---|---|---|${DIMENSIONS.map(() => "---").join("|")}|---|---|`);
  const groups = new Map<string, TrajectoryRun[]>();
  for (const r of trajectories) groups.set(`${r.case}|${r.approach}`, [...(groups.get(`${r.case}|${r.approach}`) ?? []), r]);
  for (const [key, runs] of groups) {
    const [cid, a] = key.split("|");
    const ok = runs.filter(r => r.ok);
    const t = ok.flatMap(r => r.tangents ?? []);
    lines.push(`| ${cid} | ${a} | ${ok.length}/${runs.length} | ${ok.filter(r => r.exit !== "none").length}/${ok.length} | ${ok.map(r => r.exit).join(",")} | ${fmt(mean(ok.map(r => r.turns!)), 1)} | ${fmt(mean(ok.map(r => r.progress!)), 1)} | ${ok.filter(r => r.criterion?.pass).length}/${ok.length} | ${DIMENSIONS.map(d => fmt(mean(ok.map(r => r.scores![d])), 1)).join(" | ")} | ${t.filter(x => x.handled === "well").length}/${t.filter(x => x.handled === "ok").length}/${t.filter(x => x.handled === "badly").length} | ${fmt(mean(ok.map(r => r.avgFirstTextMs!)), 0)} |`);
  }
  if (trajectories.some(r => r.targetHit !== undefined || r.patches)) {
    lines.push("", "### Repair and latency", "", "| case | approach | n | target ending | co-GM patches | improvised routes taken | relocations | essentials landed | first text p50 / p90 ms | follow-up p50 ms (turns) | co-GM ms (blocking / background p50) |", "|---|---|---|---|---|---|---|---|---|---|---|");
    const groups2 = new Map<string, TrajectoryRun[]>();
    for (const r of trajectories) groups2.set(`${r.case}|${r.approach}`, [...(groups2.get(`${r.case}|${r.approach}`) ?? []), r]);
    for (const [key, runs] of groups2) {
      const [cid, a] = key.split("|");
      const ok = runs.filter(r => r.ok);
      const m = (xs: Array<number | null | undefined>) => { const v = xs.filter((x): x is number => typeof x === "number"); return v.length ? Math.round(mean(v)) : "-"; };
      lines.push(`| ${cid} | ${a} | ${ok.length} | ${ok.some(r => r.targetHit !== undefined) ? `${ok.filter(r => r.targetHit).length}/${ok.length}` : "-"} | ${fmt(mean(ok.map(r => r.patches ?? 0)), 1)} | ${fmt(mean(ok.map(r => r.improvisedRoutesTaken ?? 0)), 1)} | ${fmt(mean(ok.map(r => r.relocations ?? 0)), 1)} | ${ok.map(r => r.essentialsLanded ?? "-").join(",")} | ${m(ok.map(r => r.firstTextP50))} / ${m(ok.map(r => r.firstTextP90))} | ${m(ok.map(r => r.followUpP50))} (${fmt(mean(ok.map(r => r.followUpTurns ?? 0)), 1)}) | ${m(ok.map(r => r.blockingRepairP50))} / ${m(ok.map(r => r.backgroundRepairP50))} |`);
    }
  }
  lines.push("", "### Weakest moments", "");
  for (const r of trajectories) lines.push(`- **${r.case} / ${r.approach} #${r.sample}** (${r.session ?? ""}): ${r.error ?? r.worstMoment}`);
}

const worlds = results.filter((r): r is WorldRun => "compiled" in r || (worldSuite === true && !("approach" in r) && !("decider" in r)));
if (worlds.length) {
  lines.push("", "## World updates (Phase 2 scribe)", "", "| ending | exit | compiled | attempts | ops | warnings | coverage | fidelity | bounded | restraint | unsupported |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const w of worlds) lines.push(w.ok ? `| ${w.case} | ${w.exit} | ${w.compiled} | ${w.attempts} | ${w.operations} | ${w.warnings?.length} | ${w.scores!.coverage} | ${w.scores!.fidelity} | ${w.scores!.bounded} | ${w.scores!.restraint} | ${(w.unsupported ?? []).join("; ")} |` : `| ${w.case} | error: ${w.error} |`);
  const ok = worlds.filter(w => w.ok);
  lines.push(`| **mean** | | ${ok.filter(w => w.compiled).length}/${ok.length} | ${fmt(mean(ok.map(w => w.attempts!)), 1)} | ${fmt(mean(ok.map(w => w.operations!)), 1)} | | ${["coverage", "fidelity", "bounded", "restraint"].map(k => fmt(mean(ok.map(w => w.scores![k]!)), 2)).join(" | ")} | |`);
  lines.push("", "### Missing / wrong", "");
  for (const w of ok) if (w.missing?.length || w.wrong?.length) lines.push(`- **${w.case}**: missing: ${w.missing!.join("; ") || "-"} | wrong: ${w.wrong!.join("; ") || "-"}`);
}

const cost = results.reduce((a, r) => a + ((r as { costUsd?: number }).costUsd ?? 0), 0);
lines.push("", `Approximate model cost (game + judge): $${cost.toFixed(4)}`);
writeFileSync(join(outDir, "summary.md"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
