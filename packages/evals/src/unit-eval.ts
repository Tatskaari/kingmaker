import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { create, fromJson, fromJsonString, toJson, type JsonValue } from "@bufbuild/protobuf";
import { CharacterSchema, DialogueRequestSchema, NoteSchema, ScenarioSchema } from "../../contracts/src/index.js";
import { FullContextBuilder } from "../../core/src/context.js";
import { dialogueEarshotPrompt } from "../../../apps/web/src/earshot.js";
import jsonPatch, { type Operation } from "fast-json-patch";
import type { ChatCompletionRequest, OpenRouterMessage, OpenRouterTool } from "../../providers/src/openrouter.js";
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
  /** Frozen issue-report request, including the original generation settings and tools. */
  request?: ChatCompletionRequest;
}

export interface EvalComparison {
  name: string;
  transcript: EvalTranscript;
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
  within_earshot: string[];
  patch?: Operation[];
}

interface CharacterPromptContext {
  character: JsonValue;
  notes: JsonValue[];
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
  generate(model: string, messages: readonly OpenRouterMessage[], tools: readonly OpenRouterTool[], request?: ChatCompletionRequest): Promise<OpenRouterMessage>;
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
  if (!Array.isArray(fixture.within_earshot) || !fixture.within_earshot.every(item => typeof item === "string" && item.trim())) {
    throw new Error("within_earshot must be an array of character ids.");
  }
  if (fixture.patch !== undefined && !Array.isArray(fixture.patch)) {
    throw new Error("patch must be a JSON Patch array.");
  }
  for (const operation of fixture.patch ?? []) {
    if (!operation || typeof operation !== "object" || !["add", "remove", "replace", "move", "copy", "test"].includes(operation.op)) {
      throw new Error("patch contains an invalid JSON Patch operation.");
    }
  }
  return fixture as CharacterPromptFixture;
}

function loadCharacterFixture(file: string): CharacterPromptFixture {
  const fixturePath = resolve(file);
  return validateCharacterFixture(JSON.parse(readFileSync(fixturePath, "utf8")));
}

function renderCharacterPrompt(file: string, applyContextPatch: boolean): OpenRouterMessage[] {
  const fixturePath = resolve(file);
  const fixture = loadCharacterFixture(fixturePath);
  const scenarioPath = resolve(fixturePath, "..", fixture.scenario);
  const scenario = fromJsonString(ScenarioSchema, readFileSync(scenarioPath, "utf8"));
  const characterIndex = scenario.characters.findIndex(character => character.id === fixture.character);
  if (characterIndex < 0) {
    throw new Error(`Cannot render unknown character ${fixture.character}.`);
  }
  if (applyContextPatch) {
    const character = scenario.characters[characterIndex]!;
    const context: CharacterPromptContext = {
      character: toJson(CharacterSchema, character),
      notes: scenario.notes.map(note => toJson(NoteSchema, note)),
    };
    const patched = jsonPatch.applyPatch(
      context as unknown as Record<string, JsonValue>,
      fixture.patch ?? [],
      true,
      false,
    ).newDocument as unknown as CharacterPromptContext;
    if (!patched.character || !Array.isArray(patched.notes)) throw new Error("patch must preserve character and notes.");
    const patchedCharacter = fromJson(CharacterSchema, patched.character);
    if (patchedCharacter.id !== fixture.character) throw new Error("patch cannot change the character id.");
    scenario.characters[characterIndex] = patchedCharacter;
    scenario.notes = patched.notes.map(note => fromJson(NoteSchema, note));
  }
  const request = create(DialogueRequestSchema, { characterId: fixture.character, scenario, transcript: [] });
  return [
    {
      role: "system",
      content: dialogueEarshotPrompt(
        scenario,
        fixture.character,
        [fixture.character, scenario.playerCharacterId ?? "player"],
        { withinEarshot: fixture.within_earshot },
      ),
    },
    ...new FullContextBuilder().build(request),
  ];
}

export function validateTranscript(value: unknown, transcriptPath: string, applyContextPatch = false): EvalTranscript {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Transcript must be an object.");
  if ("request" in value) {
    const request = value.request as ChatCompletionRequest;
    if (!request || typeof request !== "object") throw new Error("Captured request must be an object.");
    requireText(request.model, "captured model");
    if (!Array.isArray(request.messages) || !request.messages.length || request.messages.some(message =>
      !message || !["system", "user", "assistant", "tool"].includes(message.role)
      || (typeof message.content !== "string" && message.content !== null))) {
      throw new Error("Captured request must contain valid messages.");
    }
    return { messages: request.messages, request };
  }
  const transcript = value as { transcript?: unknown };
  if (!Array.isArray(transcript.transcript) || !transcript.transcript.length) throw new Error("Transcript must contain transcript steps.");
  const messages: OpenRouterMessage[] = [];
  for (const rawStep of transcript.transcript) {
    if (!rawStep || typeof rawStep !== "object" || Array.isArray(rawStep)) throw new Error("Transcript contains an invalid step.");
    const step = rawStep as Partial<EvalTranscriptStep>;
    if (step.type === "character_conversation_sys_prompt") {
      requireText(step.character, "character fixture");
      messages.push(...renderCharacterPrompt(resolve(transcriptPath, "..", step.character), applyContextPatch));
    } else if (step.type === "user_message" || step.type === "assistant_message") {
      requireText(step.value, `${step.type} value`);
      messages.push({ role: step.type === "user_message" ? "user" : "assistant", content: step.value });
    } else {
      throw new Error("Transcript contains an unknown step type.");
    }
  }
  return { messages };
}

function transcriptHasContextPatch(value: unknown, transcriptPath: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const steps = (value as { transcript?: unknown }).transcript;
  if (!Array.isArray(steps)) return false;
  return steps.some(rawStep => {
    if (!rawStep || typeof rawStep !== "object" || Array.isArray(rawStep)) return false;
    const step = rawStep as Partial<CharacterConversationPromptStep>;
    if (step.type !== "character_conversation_sys_prompt" || typeof step.character !== "string") return false;
    const fixture = loadCharacterFixture(resolve(transcriptPath, "..", step.character));
    return !!fixture.patch?.length;
  });
}

export function loadEvalScenario(file: string): { scenario: UnitEvalScenario; transcript: EvalTranscript; comparison?: EvalComparison } {
  const scenarioPath = resolve(file);
  const scenario = validateScenario(JSON.parse(readFileSync(scenarioPath, "utf8")));
  const transcriptPath = resolve(scenarioPath, "..", scenario.transcript);
  const transcriptSource = JSON.parse(readFileSync(transcriptPath, "utf8")) as unknown;
  const transcript = validateTranscript(transcriptSource, transcriptPath);
  if (transcript.request && transcript.request.model !== scenario.model) {
    throw new Error("Scenario model must match the captured request model.");
  }
  if (!transcriptHasContextPatch(transcriptSource, transcriptPath)) return { scenario, transcript };
  return {
    scenario,
    transcript,
    comparison: {
      name: "patched",
      transcript: validateTranscript(transcriptSource, transcriptPath, true),
    },
  };
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
  const response = captureResponse(await io.generate(scenario.model, transcript.messages,
    transcript.request?.tools ?? tools, transcript.request));
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
