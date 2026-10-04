import { analyzeAttention, type AnalysisEvent } from "./attention.js";
import type { ConversationStrategy } from "./phases.js";
import type { DndCharacter } from "../../contracts/src/index.js";
import { skillModifier } from "../../core/src/ability-checks.js";
import { checkStrategy, type CheckLabels } from "./check-strategy.js";
import { checkMechanics, type CheckPlan } from "./checks.js";
import type { LlmTurn } from "./conversation.js";
import type { DisclosureRound, DisclosureSession } from "./disclosure.js";
import { ConversationRuntime } from "./runtime.js";
import type { AiService, CharacterMechanics, PresentationService, RuntimeServices } from "./services.js";

export interface ManualRoll extends CheckPlan { modifier: number }
export type RequestRoll = (check: ManualRoll, signal: AbortSignal) => Promise<number>;

/** Finish disclosure before classifying checks; resolve checks once per player turn. */
export function cliStrategy(disclosure: DisclosureSession, ai: AiService, build: DndCharacter | undefined,
  playerTurn: string, requestRoll: RequestRoll, trace: (round: DisclosureRound) => void, debug: (turn: LlmTurn) => void, presentation: Partial<PresentationService> = {}, character: Partial<CharacterMechanics> = {}, gm?: { services: Partial<RuntimeServices>; characterId: string }, report: (event: AnalysisEvent) => void = () => {}) {
  const documents = disclosure.strategy(trace);
  const runtime = new ConversationRuntime<CheckLabels>({ services: {
    ...gm?.services,
    ai: { ...ai, decisions: async (...args) => {
      const decisions = await ai.decisions(...args);
      report({ kind: "labels", subject: "player", source: args[3] ?? "checks", decisions });
      return decisions;
    }, responses: async (request, signal) => {
      const started = Date.now();
      try {
        const response = await ai.responses(request, signal, { purpose: "gm_consultation" });
        debug({ request, response, durationMs: Date.now() - started });
        return response;
      } catch (error) { debug({ request, error: String(error) }); throw error; }
    } },
    character: { rollCheck: checkMechanics(build, (check, signal) => requestRoll({ ...check, modifier: skillModifier(build, check.skill) }, signal)), ...character },
    presentation: { ...presentation, showRoll: async (result, signal) => {
      report({ kind: "roll", subject: "player", result });
      await presentation.showRoll?.(result, signal);
    } },
  } });
  const checks = checkStrategy(runtime, { playerTurn, playerId: "player", ...(gm ? { characterId: gm.characterId } : {}) });
  return {
    analyze: async (context, reply, signal) => {
      try {
        const decisions = await analyzeAttention(ai, context.request.messages, reply, signal);
        report({ kind: "labels", subject: "character", source: "attention", decisions });
      } catch (error) {
        signal.throwIfAborted();
        // A diagnostic failure must not discard an otherwise valid character reply.
        report({ kind: "error", subject: "character", error: String(error) });
      }
    },
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
  } satisfies ConversationStrategy<{ docs: DisclosureRound; checks: CheckLabels | undefined }>;
}
