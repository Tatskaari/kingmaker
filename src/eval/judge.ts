import { respondJson, SOL, type Effort } from "../llm/openrouter.ts";
import { prompt, sceneBrief, scriptTranscript } from "../runtime/brief.ts";
import type { Scene } from "../runtime/scene.ts";
import type { Entry, SessionState } from "../runtime/session.ts";

export const DIMENSIONS = ["intent", "consistency", "characters", "steering", "craft"] as const;
export type Dimension = typeof DIMENSIONS[number];

export interface Verdict {
  scores: Record<Dimension, number>;
  reasons: Record<Dimension, string>;
  criterion: { pass: boolean; reason: string };
  costUsd: number;
}

const JUDGE_MODEL = process.env.KM_JUDGE_MODEL ?? SOL;
const JUDGE_EFFORT = (process.env.KM_JUDGE_EFFORT ?? "medium") as Effort;

const schema = {
  type: "object", additionalProperties: false,
  required: [...DIMENSIONS.flatMap(d => [`${d}_reason`, d]), "criterion_reason", "criterion_pass"],
  properties: {
    ...Object.fromEntries(DIMENSIONS.flatMap(d => [[`${d}_reason`, { type: "string" }], [d, { type: "integer", minimum: 1, maximum: 5 }]])),
    criterion_reason: { type: "string" },
    criterion_pass: { type: "boolean" },
  },
};

/** Judge the entries produced by one turn (or a whole scene) against the standard dimensions plus a case criterion. */
export async function judgeTurn(scene: Scene, before: SessionState, produced: Entry[], criterion: string, label = "judge.turn"): Promise<Verdict> {
  const playerTurn = produced.find(e => e.kind === "player");
  const after = produced.filter(e => e.kind !== "player");
  const render = (entries: Entry[]) => scriptTranscript(scene, before, entries);
  const result = await respondJson<Record<string, string | number | boolean>>({
    operation: label, model: JUDGE_MODEL, effort: JUDGE_EFFORT,
    instructions: prompt("judge"),
    input: [
      { role: "developer", content: sceneBrief(scene, before) },
      { role: "user", content: [
        `## The scene so far\n${render(before.transcript.filter(e => (e.scene ?? before.sceneId) === before.sceneId)) || "(nothing yet)"}`,
        `## The player's latest turn\n${playerTurn?.text ?? "(none)"}`,
        `## What came back\n${render(after)}`,
        `## Case-specific criterion\n${criterion}`,
      ].join("\n\n") },
    ],
    json: { name: "verdict", schema },
  });
  return {
    scores: Object.fromEntries(DIMENSIONS.map(d => [d, Number(result[d])])) as Record<Dimension, number>,
    reasons: Object.fromEntries(DIMENSIONS.map(d => [d, String(result[`${d}_reason`])])) as Record<Dimension, string>,
    criterion: { pass: Boolean(result.criterion_pass), reason: String(result.criterion_reason) },
    costUsd: result._meta.costUsd,
  };
}

const trajectorySchema = {
  type: "object", additionalProperties: false,
  required: ["summary", "tangents", ...DIMENSIONS.flatMap(d => [`${d}_reason`, d]), "progress_reason", "progress", "criterion_reason", "criterion_pass", "worst_moment"],
  properties: {
    summary: { type: "string" },
    tangents: { type: "array", items: { type: "object", additionalProperties: false, required: ["turn", "what", "handled"], properties: { turn: { type: "integer" }, what: { type: "string" }, handled: { type: "string", enum: ["well", "ok", "badly"] } } } },
    ...Object.fromEntries(DIMENSIONS.flatMap(d => [[`${d}_reason`, { type: "string" }], [d, { type: "integer", minimum: 1, maximum: 5 }]])),
    progress_reason: { type: "string" },
    progress: { type: "integer", minimum: 1, maximum: 5, description: "Did the scene find its way to a satisfying ending (or toward one) without forcing it?" },
    criterion_reason: { type: "string" },
    criterion_pass: { type: "boolean" },
    worst_moment: { type: "string", description: "The single weakest GM moment and where the failure started." },
  },
};

export interface TrajectoryVerdict extends Verdict {
  summary: string;
  tangents: Array<{ turn: number; what: string; handled: "well" | "ok" | "badly" }>;
  progress: number;
  worstMoment: string;
}

/** Judge a whole played scene. */
export async function judgeTrajectory(scene: Scene, state: SessionState, criterion: string): Promise<TrajectoryVerdict> {
  const transcript = state.transcript.map(e => `(turn ${e.turn}) ${scriptTranscript(scene, state, [e])}`).join("\n\n");
  const result = await respondJson<Record<string, unknown>>({
    operation: "judge.trajectory", model: JUDGE_MODEL, effort: JUDGE_EFFORT,
    instructions: `${prompt("judge")}\n\nThis time you're reviewing a whole scene, not one reply. Also list the player's tangents (anything off the prep's path) and how each was handled, rate progress, and name the weakest moment and where that failure started.`,
    input: [
      { role: "developer", content: sceneBrief(scene, state) },
      { role: "user", content: `## Transcript\n${transcript}\n\n## How it ended\n${state.ended ? `Ended with: ${scene.exits.find(e => e.id === state.ended!.exitId)?.title}` : "Did not end within the turn limit."}\n\n## Case-specific criterion\n${criterion}` },
    ],
    json: { name: "scene_verdict", schema: trajectorySchema },
    maxOutputTokens: 8000,
  });
  return {
    scores: Object.fromEntries(DIMENSIONS.map(d => [d, Number(result[d])])) as Record<Dimension, number>,
    reasons: Object.fromEntries(DIMENSIONS.map(d => [d, String(result[`${d}_reason`])])) as Record<Dimension, string>,
    criterion: { pass: Boolean(result.criterion_pass), reason: String(result.criterion_reason) },
    costUsd: (result._meta as { costUsd: number }).costUsd,
    summary: String(result.summary),
    tangents: result.tangents as TrajectoryVerdict["tangents"],
    progress: Number(result.progress),
    worstMoment: String(result.worst_moment),
  };
}

const worldSchema = {
  type: "object", additionalProperties: false,
  required: ["missing", "wrong", "coverage_reason", "coverage", "fidelity_reason", "fidelity", "bounded_reason", "bounded", "restraint_reason", "restraint"],
  properties: {
    missing: { type: "array", items: { type: "string" }, description: "Lasting consequences of the story the update failed to record." },
    wrong: { type: "array", items: { type: "string" }, description: "Changes that contradict the story or record things that didn't happen." },
    coverage_reason: { type: "string" }, coverage: { type: "integer", minimum: 1, maximum: 5 },
    fidelity_reason: { type: "string" }, fidelity: { type: "integer", minimum: 1, maximum: 5 },
    bounded_reason: { type: "string" }, bounded: { type: "integer", minimum: 1, maximum: 5 },
    restraint_reason: { type: "string" }, restraint: { type: "integer", minimum: 1, maximum: 5 },
  },
};

export interface WorldVerdict { missing: string[]; wrong: string[]; scores: { coverage: number; fidelity: number; bounded: number; restraint: number }; reasons: Record<string, string>; costUsd: number }

/** Judge a world-update script's operations against the played scene. */
export async function judgeWorldUpdate(scene: Scene, state: SessionState, operations: string): Promise<WorldVerdict> {
  const result = await respondJson<Record<string, unknown>>({
    operation: "judge.world", model: JUDGE_MODEL, effort: JUDGE_EFFORT,
    instructions: "You review how a game world was updated after an improvised roleplaying scene. The update should make the world remember what happened: lasting physical traces, items that changed hands, changed relationships and knowledge, quest progress, where people went. Score 1-5: coverage (the lasting consequences a returning player would expect are captured), fidelity (every change matches what actually happened in the story; offers, threats and plans that didn't happen don't count), bounded (only uses what the world can represent, without inventing new capabilities or people; using the escape hatch for unsupported needs is fine), restraint (proportionate; no trivia or transient moments). List what's missing and what's wrong.",
    input: [
      { role: "developer", content: sceneBrief(scene, state) },
      { role: "user", content: `## The scene as played\n${scriptTranscript(scene, state)}\n\n## How it ended\n${scene.exits.find(e => e.id === state.ended?.exitId)?.title ?? "(unknown)"}\n\n## World changes made (authored ending script first, then the scribe's update)\n${operations}` },
    ],
    json: { name: "world_verdict", schema: worldSchema },
  });
  return {
    missing: result.missing as string[], wrong: result.wrong as string[],
    scores: { coverage: Number(result.coverage), fidelity: Number(result.fidelity), bounded: Number(result.bounded), restraint: Number(result.restraint) },
    reasons: { coverage: String(result.coverage_reason), fidelity: String(result.fidelity_reason), bounded: String(result.bounded_reason), restraint: String(result.restraint_reason) },
    costUsd: (result._meta as { costUsd: number }).costUsd,
  };
}
