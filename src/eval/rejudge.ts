import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setCallLog } from "../llm/openrouter.ts";
import { sceneById } from "../../scenes/index.ts";
import { buildFixture } from "./fixtures.ts";
import { judgeTurn } from "./judge.ts";
import { CASES } from "./cases/index.ts";
import type { ReplyCase } from "./types.ts";
import type { Entry } from "../runtime/session.ts";

/**
 * Re-judge replies an earlier eval run already judged, with whatever judge KM_JUDGE_MODEL /
 * KM_JUDGE_EFFORT select, and report agreement with the original verdicts. Cheap: no GM calls.
 *   KM_JUDGE_MODEL=openai/gpt-6-luna KM_JUDGE_EFFORT=high node src/eval/rejudge.ts <eval dir> [limit]
 */
const dir = process.argv[2]!;
const limit = Number(process.argv[3] ?? 48);
setCallLog(join(dir, "rejudge-calls.jsonl"));
interface Row { case: string; approach: string; sample: number; ok: boolean; reply?: string; scores?: Record<string, number>; criterion?: { pass: boolean } }
const rows = (JSON.parse(readFileSync(join(dir, "results.json"), "utf8")) as Row[])
  .filter(r => r.ok && r.reply && !r.approach.includes("repair") && CASES.find(c => c.id === r.case)?.kind === "reply").slice(0, limit);
const out: Array<{ case: string; approach: string; original: Row; again: Awaited<ReturnType<typeof judgeTurn>> }> = [];
await Promise.all(rows.map(async (r, i) => {
  await new Promise(res => setTimeout(res, i * 150));
  const c = CASES.find(x => x.id === r.case) as ReplyCase;
  const scene = sceneById(c.scene);
  const before = buildFixture(c.scene, c.setup, { id: `rejudge-${i}`, approach: r.approach, seed: 1 });
  const produced: Entry[] = [
    { turn: before.turn + 1, scene: scene.id, speaker: "player", kind: "player", text: c.input },
    { turn: before.turn + 1, scene: scene.id, speaker: "gm", kind: "narration", text: r.reply! },
  ];
  try { out.push({ case: r.case, approach: r.approach, original: r, again: await judgeTurn(scene, before, produced, c.criterion, "judge.rejudge") }); }
  catch (error) { console.error(r.case, error instanceof Error ? error.message.slice(0, 160) : error); }
}));
const dims = ["intent", "consistency", "characters", "steering", "craft"];
const agree = out.filter(o => o.original.criterion!.pass === o.again.criterion.pass).length;
const pearson = (xs: number[], ys: number[]) => {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const cov = xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0);
  const vx = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0)), vy = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0));
  return vx && vy ? cov / (vx * vy) : NaN;
};
const orig = out.map(o => dims.reduce((a, d) => a + o.original.scores![d]!, 0) / dims.length);
const again = out.map(o => dims.reduce((a, d) => a + o.again.scores[d as keyof typeof o.again.scores], 0) / dims.length);
const cost = out.reduce((a, o) => a + o.again.costUsd, 0);
const summary = {
  judged: out.length, judge: process.env.KM_JUDGE_MODEL, effort: process.env.KM_JUDGE_EFFORT,
  criterionAgreement: `${agree}/${out.length}`, originalPass: out.filter(o => o.original.criterion!.pass).length, newPass: out.filter(o => o.again.criterion.pass).length,
  meanScoreOriginal: (orig.reduce((a, b) => a + b, 0) / orig.length).toFixed(2), meanScoreNew: (again.reduce((a, b) => a + b, 0) / again.length).toFixed(2),
  scoreCorrelation: pearson(orig, again).toFixed(2), costUsd: cost.toFixed(4),
  disagreements: out.filter(o => o.original.criterion!.pass !== o.again.criterion.pass).map(o => `${o.case}/${o.approach}: original ${o.original.criterion!.pass ? "pass" : "fail"}, new ${o.again.criterion.pass ? "pass" : "fail"}`),
};
writeFileSync(join(dir, `rejudge-${process.env.KM_JUDGE_MODEL?.replace(/\W+/g, "_")}-${process.env.KM_JUDGE_EFFORT}.json`), JSON.stringify({ summary, out }, null, 1));
console.log(JSON.stringify(summary, null, 1));
