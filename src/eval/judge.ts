import { respondJson, LUNA, type Effort } from "../llm/openrouter.ts";
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

// Luna at high reasoning: agreed with Sol on 32/40 pass/fail verdicts at ~1/15 of the cost
// (docs/LOG.md). Set KM_JUDGE_MODEL=openai/gpt-6-sol KM_JUDGE_EFFORT=medium for a second opinion.
const JUDGE_MODEL = process.env.KM_JUDGE_MODEL ?? LUNA;
const JUDGE_EFFORT = (process.env.KM_JUDGE_EFFORT ?? "high") as Effort;

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

/** A judged note on a marked phrase (src/runtime/markup.ts). */
export interface NoteVerdict { kind: string; phrase: string; note: string; leaks: boolean; accurate: boolean; fits: boolean; reason: string }

const notesSchema = {
  type: "object", additionalProperties: false, required: ["notes"],
  properties: {
    notes: { type: "array", items: { type: "object", additionalProperties: false, required: ["index", "reason", "leaks", "accurate", "fits"], properties: {
      index: { type: "integer" }, reason: { type: "string" },
      leaks: { type: "boolean", description: "The note tells the player something they don't know and their character wouldn't: a secret, what someone is keeping back, what the scene means them to find, a GM-only fact, a name they haven't heard." },
      accurate: { type: "boolean", description: "The note is true to the prep and to what happened in the scene." },
      fits: { type: "boolean", description: "Its kind fits: why is a reason someone acts as they do; know is something the character would know and a newcomer wouldn't; you is one of the player's own past acts." },
    } } },
  },
};

/**
 * The notes on a reply's marked phrases (what the player reads when they click one), checked
 * against the prep: does any tell the player what they don't know? Undefined when there are none.
 * The judge sees the prep and, beside it, what the player knows (`known`: the public lore and the
 * player's own past, src/runtime/notes.ts), since a `know` note explains from the world's common
 * knowledge, which the player hasn't been told in play.
 */
export async function judgeNotes(scene: Scene, before: SessionState, produced: Entry[], knowledge: string, known?: string): Promise<{ notes: NoteVerdict[]; costUsd: number } | undefined> {
  const marks = produced.flatMap(e => (e.marked?.marks ?? []).map(m => ({ kind: m.kind, phrase: e.text.slice(m.start, m.end), note: m.note })));
  if (!marks.length) return undefined;
  const result = await respondJson<{ notes: Array<{ index: number; reason: string; leaks: boolean; accurate: boolean; fits: boolean }> }>({
    operation: "judge.notes", model: JUDGE_MODEL, effort: JUDGE_EFFORT,
    instructions: `You check the notes an AI game master attached to phrases of its reply. On the player's screen a marked phrase can be clicked to read its note, so a note may hold only what the player's character knows or would know: their own past, what they've seen or been told in play, and what anyone in their world knows. It must never tell them anything from the GM's prep that they haven't learned: people's secrets, what someone is keeping back, what the scene means them to find, GM-only notes, or a name they haven't heard.${known ? " What anyone in their world knows is written out for you under \"What the player knows\" (the public lore), with the player's own past: a note that says what's there doesn't leak, even if the player hasn't been told it in play, but one that puts things together into what the prep keeps for the player to find does." : ""} Judge each note on its own.`,
    input: [
      { role: "developer", content: `${sceneBrief(scene, before)}\n\n${knowledge}${known ? `\n\n## What the player knows\n${known}` : ""}` },
      { role: "user", content: [
        `## The scene so far\n${scriptTranscript(scene, before, before.transcript.filter(e => (e.scene ?? before.sceneId) === before.sceneId)) || "(nothing yet)"}`,
        `## The player's latest turn\n${produced.find(e => e.kind === "player")?.text ?? "(none)"}`,
        `## The reply\n${scriptTranscript(scene, before, produced.filter(e => e.kind !== "player"))}`,
        `## Its notes\n${marks.map((m, i) => `${i}. ${m.kind}, on "${m.phrase}": ${m.note}`).join("\n")}`,
      ].join("\n\n") },
    ],
    json: { name: "notes_verdict", schema: notesSchema },
  });
  return {
    notes: marks.map((m, i) => {
      const v = result.notes.find(n => n.index === i);
      return { ...m, leaks: v?.leaks ?? false, accurate: v?.accurate ?? true, fits: v?.fits ?? true, reason: v?.reason ?? "" };
    }),
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
