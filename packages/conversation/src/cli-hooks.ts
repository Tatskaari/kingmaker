import type { DndCharacter } from "../../contracts/src/index.js";
import { skillModifier } from "../../core/src/ability-checks.js";
import { checkHooks, type CheckLabels } from "./check-hooks.js";
import type { CheckPlan } from "./checks.js";
import type { LlmTurn } from "./conversation.js";
import type { DisclosureRound, DisclosureSession } from "./disclosure.js";
import { ConversationRuntime } from "./runtime.js";
import type { AiService, PresentationService } from "./services.js";

export interface ManualRoll extends CheckPlan { modifier: number }
export type RequestRoll = (check: ManualRoll, signal: AbortSignal) => Promise<number>;

/** Finish disclosure before classifying checks; resolve checks once per player turn. */
export function cliHooks(disclosure: DisclosureSession, ai: AiService, build: DndCharacter | undefined,
  playerTurn: string, requestRoll: RequestRoll, trace: (round: DisclosureRound) => void, debug: (turn: LlmTurn) => void, presentation: Partial<PresentationService> = {}) {
  const documents = disclosure.hooks(trace);
  const runtime = new ConversationRuntime<CheckLabels>({ services: {
    ai: { ...ai, responses: async (request, signal) => {
      const started = Date.now();
      try {
        const response = await ai.responses(request, signal, { purpose: "gm_consultation" });
        debug({ request, response, durationMs: Date.now() - started });
        return response;
      } catch (error) { debug({ request, error: String(error) }); throw error; }
    } },
    presentation: { showRoll: async () => {}, ...presentation },
  } });
  const checks = checkHooks(runtime, { playerTurn, playerId: "player", build,
    roll: (check, signal) => requestRoll({ ...check, modifier: skillModifier(build, check.skill) }, signal) });
  return {
    classify: async (...args: Parameters<typeof documents.classify>) => {
      const docs = await documents.classify(...args);
      const expanding = docs.candidates.some(link => (docs.answers?.[link.id]?.probabilities[link.id] ?? 0) > disclosure.threshold);
      return { docs, checks: expanding || args[0].completed.has("checks") ? undefined : await checks.classify(...args) };
    },
    resolve: async (context: Parameters<typeof documents.resolve>[0], labels: { docs: DisclosureRound; checks: CheckLabels | undefined }, signal: AbortSignal) => {
      const result = await documents.resolve(context, labels.docs, signal);
      if (!result.reclassify && labels.checks) await checks.resolve(context, labels.checks, signal);
      return result;
    },
  };
}
