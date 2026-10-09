import { renderPrompt } from "../../prompts/src/index.js";
import type { CharacterMechanics, Difficulty, RollResult } from "./services.js";
import type { DndCharacter } from "../../contracts/src/index.js";
import { degreeGuidance, resolveDiceCheck, rollD20, skillModifier, type CheckSkill, type CheckDegree } from "../../core/src/ability-checks.js";
import type { ChatCompletionRequest, OpenRouterMessage } from "../../providers/src/openrouter.js";
import { parseModelObject } from "../../providers/src/structured-output.js";
const REASONING_MODEL = { model: "openai/gpt-6-luna", api: "responses", reasoning: { effort: "none" } } as const;

export const PLAYER_INSIGHT_PREFIX = "# Player insight\n";

export interface ConversationRoll {
  skill: CheckSkill;
  difficulty: Difficulty;
  dc: number;
  modifier: number;
  roll: number;
  total: number;
  margin: number;
  degree: CheckDegree;
  success: boolean;
}
export type PresentRoll = (result: ConversationRoll, signal: AbortSignal) => Promise<void>;
export interface CheckPlan { skill: CheckSkill; difficulty: Difficulty }
export const difficultyDcs = { very_easy: 5, easy: 10, normal: 15, hard: 20, very_hard: 25 } as const;
export function resolvePlannedCheck(plan: CheckPlan, modifier: number, roll: number): ConversationRoll {
  // Effective DCs enforce the categorical endpoints regardless of modifiers.
  const dc = plan.difficulty === "trivial" ? modifier + 2
    : plan.difficulty === "impossible" ? modifier + 20 : difficultyDcs[plan.difficulty];
  if (dc === undefined) throw new Error("Invalid check difficulty");
  return { ...plan, modifier, roll, dc, ...resolveDiceCheck(roll, dc, modifier) };
}
/** Default dice mechanics; hosts may replace this operation independently of narration. */
export function checkMechanics(build: DndCharacter | undefined,
  roll: (check: CheckPlan, signal: AbortSignal) => number | Promise<number> = () => rollD20()): CharacterMechanics["rollCheck"] {
  return async (request, signal) => {
    signal.throwIfAborted();
    const natural = await roll(request, signal);
    signal.throwIfAborted();
    const result = resolvePlannedCheck(request, skillModifier(build, request.skill), natural);
    return { ...request, natural, modifier: result.modifier, total: result.total,
      dc: result.dc, success: result.success, outcome: result.degree };
  };
}

export const ROLL_GUIDANCE = renderPrompt("checks-roll_guidance", { value1: JSON.stringify(degreeGuidance) });

export async function adjudicateConversationChecks(options: {
  plan: CheckPlan[]; messages: readonly OpenRouterMessage[]; build: DndCharacter | undefined;
  complete: (request: ChatCompletionRequest, signal: AbortSignal) => Promise<OpenRouterMessage>;
  observation?: (text: string) => void;
  present: PresentRoll; roll?: (check: CheckPlan, signal: AbortSignal) => number | Promise<number>; signal?: AbortSignal;
}): Promise<string | undefined> {
  if (!options.plan.length) return undefined;
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  signal.throwIfAborted();
  const results: Readonly<ConversationRoll>[] = [];
  for (const check of options.plan) {
    signal.throwIfAborted();
    const natural = await (options.roll ? options.roll(check, signal) : rollD20());
    signal.throwIfAborted();
    results.push(Object.freeze(resolvePlannedCheck(check, skillModifier(options.build, check.skill), natural)));
  }
  return adjudicateResolvedChecks({ ...options, results, signal });
}

/** Narrate and present authoritative outcomes without performing mechanics. */
export async function adjudicateResolvedChecks<Result extends RollResult | ConversationRoll>(options: {
  observation?: (text: string) => void;
  results: readonly Result[]; messages: readonly OpenRouterMessage[];
  complete: (request: ChatCompletionRequest, signal: AbortSignal) => Promise<OpenRouterMessage>;
  present: (result: Result, signal: AbortSignal) => Promise<void>; signal: AbortSignal;
}): Promise<string | undefined> {
  if (!options.results.length) return undefined;
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  signal.throwIfAborted();
  const results = options.results;
  const insight = results.some(result => result.skill === "insight");
  const complete = async (request: ChatCompletionRequest) => {
    signal.throwIfAborted();
    const result = await options.complete(request, signal);
    signal.throwIfAborted();
    return result;
  };
  const prepareRuling = async () => {
    const ruling = parseModelObject((await complete({ ...REASONING_MODEL, messages: [
      { role: "system", content: renderPrompt("checks-adjudicate", { ROLL_GUIDANCE: ROLL_GUIDANCE }) },
      { role: "user", content: JSON.stringify({ dialogue: options.messages, resolvedChecks: results }) },
    ], response_format: { type: "json_schema", json_schema: { name: "conversation_roll_ruling", strict: true, schema: {
      type: "object", additionalProperties: false, required: insight ? ["direction", "observation"] : ["direction"], properties: { direction: { type: "string", maxLength: 3000 },
        ...(insight ? { observation: { type: "string", minLength: 1, maxLength: 1500 } } : {}), },
    } } } })).content, "GM roll ruling");
    if (typeof ruling.direction !== "string" || !ruling.direction.trim()) throw new Error("The GM returned no direction for the roll.");
    if (insight && (typeof ruling.observation !== "string" || !ruling.observation.trim())) throw new Error("The GM returned no insight observation.");
    return { observation: insight ? (ruling.observation as string).trim() : undefined, direction: renderPrompt("checks-ruling", { ROLL_GUIDANCE: ROLL_GUIDANCE, results: JSON.stringify(results), direction: ruling.direction.trim() }) };
  };
  try {
    const [, ruling] = await Promise.all([
      (async () => { for (const result of results) { signal.throwIfAborted(); await options.present(result, signal); signal.throwIfAborted(); } })(),
      prepareRuling(),
    ]);
    signal.throwIfAborted();
    if (ruling.observation) options.observation?.(ruling.observation);
    return ruling.direction;
  } catch (error) { controller.abort(error); throw error; }
}
