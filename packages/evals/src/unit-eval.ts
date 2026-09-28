import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { create, fromJson, fromJsonString, toJson, type JsonValue } from "@bufbuild/protobuf";
import { CharacterSchema, DialogueRequestSchema, NoteSchema, ScenarioSchema } from "../../contracts/src/index.js";
import { FullContextBuilder } from "../../core/src/context.js";
import { dialogueEarshotPrompt } from "../../../apps/web/src/earshot.js";
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
  toolset?: "resource-review" | "none";
  threshold: number;
  repeats: number;
  judge_repeats?: number;
  rubric: EvalCriterion[];
}

export interface EvalTranscript {
  messages: OpenRouterMessage[];
}

interface CharacterConversationPromptStep {
  type: "character_conversation_sys_prompt";
  character: string;
}

interface TranscriptMessageStep {
  type: "user_message" | "assistant_message";
  value: string;
}

type EvalTranscriptStep = CharacterConversationPromptStep | TranscriptMessageStep;

interface CharacterPromptFixture {
  scenario: string;
  character: string;
  room: string;
  within_earshot: string[];
  character_overrides?: Record<string, JsonValue>;
  notes?: JsonValue[];
}

export interface CriterionResult extends EvalCriterion {
  probability: number;
  choice: string;
  samples: number[];
}

export interface UnitEvalRun {
  response: OpenRouterMessage;
  criteria: CriterionResult[];
  score: number;
  passed: boolean;
}

export interface UnitEvalIO {
  generate(model: string, messages: readonly OpenRouterMessage[], tools: readonly OpenRouterTool[]): Promise<OpenRouterMessage>;
  judge(state: unknown, criteria: readonly EvalCriterion[]): Promise<Record<string, JevChoice>>;
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
  if (scenario.toolset !== undefined && !["resource-review", "none"].includes(scenario.toolset)) throw new Error("toolset must be resource-review or none.");
  if (typeof scenario.threshold !== "number" || scenario.threshold < 0 || scenario.threshold > 1) throw new Error("threshold must be between 0 and 1.");
  if (!Number.isInteger(scenario.repeats) || scenario.repeats! < 1) throw new Error("repeats must be a positive integer.");
  if (scenario.judge_repeats !== undefined && (!Number.isInteger(scenario.judge_repeats) || scenario.judge_repeats < 1)) throw new Error("judge_repeats must be a positive integer.");
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

function validateCharacterFixture(value: unknown): CharacterPromptFixture {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Character prompt fixture must be an object.");
  const fixture = value as Partial<CharacterPromptFixture>;
  requireText(fixture.scenario, "character scenario");
  requireText(fixture.character, "character id");
  requireText(fixture.room, "conversation room");
  if (!Array.isArray(fixture.within_earshot) || !fixture.within_earshot.every(item => typeof item === "string" && item.trim())) {
    throw new Error("within_earshot must be an array of character ids.");
  }
  if (fixture.character_overrides !== undefined
    && (!fixture.character_overrides || typeof fixture.character_overrides !== "object" || Array.isArray(fixture.character_overrides))) {
    throw new Error("character_overrides must be an object.");
  }
  if (fixture.character_overrides?.id !== undefined) throw new Error("character_overrides cannot change the character id.");
  if (fixture.notes !== undefined && !Array.isArray(fixture.notes)) throw new Error("character notes must be an array.");
  return fixture as CharacterPromptFixture;
}

function renderCharacterPrompt(file: string): OpenRouterMessage[] {
  const fixturePath = resolve(file);
  const fixture = validateCharacterFixture(JSON.parse(readFileSync(fixturePath, "utf8")));
  const scenarioPath = resolve(fixturePath, "..", fixture.scenario);
  const scenario = fromJsonString(ScenarioSchema, readFileSync(scenarioPath, "utf8"));
  const characterIndex = scenario.characters.findIndex(character => character.id === fixture.character);
  if (characterIndex < 0) {
    throw new Error(`Cannot render unknown character ${fixture.character}.`);
  }
  if (!scenario.world?.rooms.some(room => room.id === fixture.room)) throw new Error(`Cannot render unknown room ${fixture.room}.`);
  if (fixture.character_overrides) {
    const character = scenario.characters[characterIndex]!;
    scenario.characters[characterIndex] = fromJson(CharacterSchema, {
      ...toJson(CharacterSchema, character) as Record<string, JsonValue>,
      ...fixture.character_overrides,
    });
  }
  scenario.notes.push(...(fixture.notes ?? []).map(note => fromJson(NoteSchema, note)));
  const request = create(DialogueRequestSchema, { characterId: fixture.character, scenario, transcript: [] });
  return [
    {
      role: "system",
      content: dialogueEarshotPrompt(
        scenario,
        fixture.character,
        [fixture.character, scenario.playerCharacterId ?? "player"],
        { roomId: fixture.room, withinEarshot: fixture.within_earshot },
      ),
    },
    ...new FullContextBuilder().build(request),
  ];
}

export function validateTranscript(value: unknown, transcriptPath: string): EvalTranscript {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Transcript must be an object.");
  const transcript = value as { transcript?: unknown };
  if (!Array.isArray(transcript.transcript) || !transcript.transcript.length) throw new Error("Transcript must contain transcript steps.");
  const messages: OpenRouterMessage[] = [];
  for (const rawStep of transcript.transcript) {
    if (!rawStep || typeof rawStep !== "object" || Array.isArray(rawStep)) throw new Error("Transcript contains an invalid step.");
    const step = rawStep as Partial<EvalTranscriptStep>;
    if (step.type === "character_conversation_sys_prompt") {
      requireText(step.character, "character fixture");
      messages.push(...renderCharacterPrompt(resolve(transcriptPath, "..", step.character)));
    } else if (step.type === "user_message" || step.type === "assistant_message") {
      requireText(step.value, `${step.type} value`);
      messages.push({ role: step.type === "user_message" ? "user" : "assistant", content: step.value });
    } else {
      throw new Error("Transcript contains an unknown step type.");
    }
  }
  return { messages };
}

export function loadEvalScenario(file: string): { scenario: UnitEvalScenario; transcript: EvalTranscript } {
  const scenarioPath = resolve(file);
  const scenario = validateScenario(JSON.parse(readFileSync(scenarioPath, "utf8")));
  const transcriptPath = resolve(scenarioPath, "..", scenario.transcript);
  return { scenario, transcript: validateTranscript(JSON.parse(readFileSync(transcriptPath, "utf8")), transcriptPath) };
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
  const samples = await Promise.all(Array.from({ length: scenario.judge_repeats ?? 1 }, () => io.judge({
      scenario: { name: scenario.name, description: scenario.description },
      transcript: transcript.messages,
      response,
    }, scenario.rubric)));
  const criteria = scenario.rubric.map(criterion => {
    const probabilities = samples.map(sample => sample[criterion.id]?.probabilities.meets ?? 0);
    const probability = probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length;
    return { ...criterion, choice: probability >= 0.5 ? "meets" : "does_not_meet", probability, samples: probabilities };
  });
  const score = weightedScore(criteria);
  return { response, criteria, score, passed: score >= scenario.threshold };
}

export function runUnitEvalBatch(
  scenario: UnitEvalScenario,
  transcript: EvalTranscript,
  tools: readonly OpenRouterTool[],
  io: UnitEvalIO,
): Promise<UnitEvalRun[]> {
  return Promise.all(Array.from({ length: scenario.repeats }, () => runUnitEval(scenario, transcript, tools, io)));
}
