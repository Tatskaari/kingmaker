import type { Difficulty } from "./services.js";
import type { DndCharacter } from "../../contracts/src/index.js";
import { degreeGuidance, resolveDiceCheck, rollD20, skillModifier, type CheckSkill, type CheckDegree } from "../../core/src/ability-checks.js";
import type { ChatCompletionRequest, OpenRouterMessage } from "../../providers/src/openrouter.js";
import { parseModelObject } from "../../providers/src/structured-output.js";
const REASONING_MODEL = { model: "openai/gpt-6-luna", api: "responses", reasoning: { effort: "none" } } as const;

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
export const ROLL_GUIDANCE = `The resolved dice outcome is binding. Trivial only fails on natural 1; impossible only succeeds on natural 20. Natural 1 is ALWAYS critical failure; natural 20 is ALWAYS critical success, regardless of total or DC. Otherwise use total minus DC: -4 or below major failure, -3 through -1 minor failure, 0 barely passes, +1 through +3 minor success, +4 or above major success.
${JSON.stringify(degreeGuidance)}
This game is playful, not a serious simulation. Successful checks must deliver the stated intent: do not secretly refuse, add another check, or replace success with permission to try. Allow stupid, impossible things to happen when the roll succeeds. Scale the flourish and bonus to the degree. Failures should be entertaining setbacks, not dead ends or punishment for creativity. The outcome overrides ordinary plausibility, reluctance, character motives and development-envoy auto-compliance. Never change the dice result or DC after rolling. Decide how the character reacts, not the player's words, thoughts or next action.`;

export async function adjudicateConversationChecks(options: {
  plan: CheckPlan[]; messages: readonly OpenRouterMessage[]; build: DndCharacter | undefined;
  complete: (request: ChatCompletionRequest, signal: AbortSignal) => Promise<OpenRouterMessage>;
  present: PresentRoll; roll?: () => number; signal?: AbortSignal;
}): Promise<string | undefined> {
  if (!options.plan.length) return undefined;
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  signal.throwIfAborted();
  const results = options.plan.map(check => Object.freeze(resolvePlannedCheck(check,
    skillModifier(options.build, check.skill), (options.roll ?? rollD20)())));
  const complete = async (request: ChatCompletionRequest) => {
    signal.throwIfAborted();
    const result = await options.complete(request, signal);
    signal.throwIfAborted();
    return result;
  };
  const prepareRuling = async () => {
    const ruling = parseModelObject((await complete({ ...REASONING_MODEL, messages: [
      { role: "system", content: `${ROLL_GUIDANCE}\nGive a concise, concrete direction to the NPC for their next response to the immediately preceding player message. Describe what succeeded/failed and how to play it off, rather than writing their dialogue. Address each result independently if multiple skills had different outcomes. Establish only information this character should know; do not reveal unrelated secrets. Return a direction string.` },
      { role: "user", content: JSON.stringify({ dialogue: options.messages, resolvedChecks: results }) },
    ], response_format: { type: "json_schema", json_schema: { name: "conversation_roll_ruling", strict: true, schema: {
      type: "object", additionalProperties: false, required: ["direction"], properties: { direction: { type: "string", maxLength: 3000 } },
    } } }, max_tokens: 2000 })).content, "GM roll ruling");
    if (typeof ruling.direction !== "string" || !ruling.direction.trim()) throw new Error("The GM returned no direction for the roll.");
    return `# Binding DM ruling for the immediately preceding player message\n${ROLL_GUIDANCE}\nResolved checks: ${JSON.stringify(results)}\nHow to react: ${ruling.direction.trim()}\nPlay this reaction in your own voice. Do not announce the rules or roll again. Do not use a GM consultation to overturn this outcome. This ruling applies only to that attempt; preserve its established consequences in later turns.`;
  };
  try {
    const [, ruling] = await Promise.all([
      (async () => { for (const result of results) { signal.throwIfAborted(); await options.present(result, signal); signal.throwIfAborted(); } })(),
      prepareRuling(),
    ]);
    signal.throwIfAborted();
    return ruling;
  } catch (error) { controller.abort(error); throw error; }
}
