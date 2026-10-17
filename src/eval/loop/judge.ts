/**
 * The GM loop's judge: one reply, by the rubric (evals/loop/rubric.md) and the case's criterion.
 * Luna at high reasoning by default (KM_JUDGE_MODEL and KM_JUDGE_EFFORT for another).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sceneById } from "../../../scenes/index.ts";
import { LUNA, respondJson, type Effort } from "../../llm/openrouter.ts";
import type { SessionState } from "../../runtime/session.ts";
import type { Finding, LoopCase } from "./fixture.ts";
import { locate, PENALTY } from "./html.ts";
import { LOOP_DIR, RUBRIC } from "./paths.ts";
import { rubricChecks, truthOf, turnsOf, turnText } from "./review.ts";

export interface Judgement {
  findings: Array<Omit<Finding, "turn" | "better"> & { quoted: boolean }>;
  criterion: { pass: boolean; reason: string };
  /** The case fails on a finding under one of its checks at its severity or more, or the criterion. */
  pass: boolean;
  penalty: number;
  costUsd: number;
  model: string;
}

export async function judgeReply(c: LoopCase, before: SessionState, reply: string): Promise<Judgement> {
  const checks = rubricChecks();
  const model = process.env.KM_JUDGE_MODEL ?? LUNA;
  const effort = (process.env.KM_JUDGE_EFFORT ?? "high") as Effort;
  const scene = sceneById(before.sceneId);
  const history = [...turnsOf(before)].sort((a, b) => a[0] - b[0]).map(([n, es]) => `## Turn ${n}\n\n${turnText(before, es)}`).join("\n\n");
  const result = await respondJson<{ findings: Array<{ check: string; severity: number; quote: string; why: string }>; criterion_reason: string; criterion_pass: boolean }>({
    operation: "loop.judge", model, effort,
    // A call that never answers would leave the run waiting on nothing: give it four minutes.
    signal: AbortSignal.timeout(Number(process.env.KM_JUDGE_TIMEOUT_MS ?? 240_000)),
    instructions: readFileSync(join(LOOP_DIR, "judge.md"), "utf8").replace("{{rubric}}", readFileSync(RUBRIC, "utf8")),
    input: [
      { role: "developer", content: `# The truth behind the screen (the player never saw this)\n\n${truthOf(before)}` },
      { role: "user", content: [
        `# What the player was told before the scene began\n\n${scene.hook}\n\nTheir character: ${before.player.name}: ${before.player.concept}.`,
        `# The scene so far, as the player saw it\n\n${history || "(nothing yet)"}`,
        `# The player's turn (turn ${c.turn})\n\n${c.input}`,
        `# The GM's reply\n\n${reply}`,
        `# The criterion: what a good reply does here\n\n${c.criterion}`,
      ].join("\n\n") },
    ],
    json: { name: "judgement", schema: {
      type: "object", additionalProperties: false, required: ["findings", "criterion_reason", "criterion_pass"],
      properties: {
        findings: { type: "array", items: { type: "object", additionalProperties: false, required: ["check", "severity", "quote", "why"], properties: {
          check: { type: "string", enum: checks }, severity: { type: "integer", minimum: 1, maximum: 5 }, quote: { type: "string" }, why: { type: "string" },
        } } },
        criterion_reason: { type: "string" },
        criterion_pass: { type: "boolean" },
      },
    } },
  });
  const findings = result.findings.map(f => ({ ...f, quoted: !!locate(reply, f.quote) }));
  const failing = findings.some(f => c.checks.includes(f.check) && f.severity >= c.failAt);
  return {
    findings,
    criterion: { pass: result.criterion_pass, reason: result.criterion_reason },
    pass: result.criterion_pass && !failing,
    penalty: findings.reduce((a, f) => a + (PENALTY[f.severity] ?? 0), 0),
    costUsd: result._meta.costUsd,
    model: `${model} (${effort})`,
  };
}
