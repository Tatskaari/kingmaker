import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { OpenRouterMessage, OpenRouterTool } from "../../providers/src/openrouter.js";
import type { JevChoice } from "../../providers/src/jev.js";

export interface EvalCriterion {
  id: string;
  criterion: string;
  weight: number;
}

export interface UnitEvalScenario {
  name: string;
  description: string;
  model: string;
  transcript: string;
  threshold: number;
  repeats: number;
  rubric: EvalCriterion[];
}

export interface EvalTranscript {
  messages: OpenRouterMessage[];
}

export interface CriterionResult extends EvalCriterion {
  probability: number;
  choice: string;
}

export interface UnitEvalRun {
  response: OpenRouterMessage;
  criteria: CriterionResult[];
  score: number;
  passed: boolean;
}

export interface UnitEvalIO {
  generate(model: string, messages: readonly OpenRouterMessage[], tools: readonly OpenRouterTool[]): Promise<OpenRouterMessage>;
  judge(state: unknown, criterion: EvalCriterion): Promise<JevChoice>;
}

function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
}

export function validateScenario(value: unknown): UnitEvalScenario {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Eval scenario must be an object.");
  const scenario = value as Partial<UnitEvalScenario>;
  requireText(scenario.name, "name");
  requireText(scenario.description, "description");
  requireText(scenario.model, "model");
  requireText(scenario.transcript, "transcript");
  if (typeof scenario.threshold !== "number" || scenario.threshold < 0 || scenario.threshold > 1) throw new Error("threshold must be between 0 and 1.");
  if (!Number.isInteger(scenario.repeats) || scenario.repeats! < 1) throw new Error("repeats must be a positive integer.");
  if (!Array.isArray(scenario.rubric) || !scenario.rubric.length) throw new Error("rubric must contain at least one criterion.");
  const ids = new Set<string>();
  for (const item of scenario.rubric) {
    requireText(item.id, "criterion id");
    requireText(item.criterion, `criterion ${item.id}`);
    if (ids.has(item.id)) throw new Error(`Duplicate criterion id: ${item.id}`);
    if (typeof item.weight !== "number" || item.weight <= 0) throw new Error(`Criterion ${item.id} must have a positive weight.`);
    ids.add(item.id);
  }
  return scenario as UnitEvalScenario;
}

export function validateTranscript(value: unknown): EvalTranscript {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Transcript must be an object.");
  const transcript = value as Partial<EvalTranscript>;
  if (!Array.isArray(transcript.messages) || !transcript.messages.length) throw new Error("Transcript must contain messages.");
  for (const message of transcript.messages) {
    if (!message || !["system", "user", "assistant", "tool"].includes(message.role) || (message.content !== null && typeof message.content !== "string")) {
      throw new Error("Transcript contains an invalid message.");
    }
  }
  return transcript as EvalTranscript;
}

export function loadEvalScenario(file: string): { scenario: UnitEvalScenario; transcript: EvalTranscript } {
  const scenarioPath = resolve(file);
  const scenario = validateScenario(JSON.parse(readFileSync(scenarioPath, "utf8")));
  const transcriptPath = resolve(scenarioPath, "..", scenario.transcript);
  return { scenario, transcript: validateTranscript(JSON.parse(readFileSync(transcriptPath, "utf8"))) };
}

export function weightedScore(results: readonly CriterionResult[]): number {
  const weight = results.reduce((sum, result) => sum + result.weight, 0);
  if (!weight) throw new Error("The rubric must have a positive total weight.");
  return results.reduce((sum, result) => sum + result.probability * result.weight, 0) / weight;
}

/** Keep the model's authored response while dropping provider-only continuity metadata. */
export function captureResponse(response: OpenRouterMessage): OpenRouterMessage {
  return {
    role: response.role,
    content: response.content,
    ...(response.name === undefined ? {} : { name: response.name }),
    ...(response.tool_call_id === undefined ? {} : { tool_call_id: response.tool_call_id }),
    ...(response.tool_calls === undefined ? {} : { tool_calls: response.tool_calls }),
  };
}

export async function runUnitEval(
  scenario: UnitEvalScenario,
  transcript: EvalTranscript,
  tools: readonly OpenRouterTool[],
  io: UnitEvalIO,
): Promise<UnitEvalRun> {
  const response = captureResponse(await io.generate(scenario.model, transcript.messages, tools));
  const criteria = await Promise.all(scenario.rubric.map(async criterion => {
    const answer = await io.judge({
      scenario: { name: scenario.name, description: scenario.description },
      transcript: transcript.messages,
      response,
    }, criterion);
    return { ...criterion, choice: answer.choice, probability: answer.probabilities.meets ?? 0 };
  }));
  const score = weightedScore(criteria);
  return { response, criteria, score, passed: score >= scenario.threshold };
}
