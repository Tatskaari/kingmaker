import { analyzeAttention, type AnalysisEvent } from "./attention.js";
import type { ConversationStrategy } from "./phases.js";
import type { DndCharacter } from "../../contracts/src/index.js";
import { skillModifier } from "../../core/src/ability-checks.js";
import { checkStrategy } from "./check-strategy.js";
import { checkMechanics, type CheckPlan } from "./checks.js";
import type { LlmTurn } from "./conversation.js";
import type { DisclosureRound, DisclosureSession } from "./disclosure.js";
import { ConversationRuntime } from "./runtime.js";
import type { AiService, CharacterMechanics, PresentationService, RuntimeServices } from "./services.js";

export interface ManualRoll extends CheckPlan { modifier: number }
export type RequestRoll = (check: ManualRoll, signal: AbortSignal) => Promise<number>;

/** Finish disclosure before classifying checks; resolve checks once per player turn. */
export function conversationStrategy(disclosure: DisclosureSession, ai: AiService, build: DndCharacter | undefined,
  playerTurn: string, requestRoll: RequestRoll, trace: (round: DisclosureRound) => void, debug: (turn: LlmTurn) => void, presentation: Partial<PresentationService> = {}, character: Partial<CharacterMechanics> = {}, gm?: { services: Partial<RuntimeServices>; characterId: string }, report: (event: AnalysisEvent) => void = () => {}, response?: ConversationStrategy) {
  const runtime = new ConversationRuntime({ services: {
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
    respond: async ({ request, maxPasses }, signal, services) => {
      const context = await disclosure.prepare(request, signal, trace, maxPasses);
      const labels = await checks.classify(context, signal);
      signal.throwIfAborted();
      await checks.resolve(context, labels, signal);
      signal.throwIfAborted();
      return (response ?? attentionResponseStrategy(report)).respond({ request: context.request, maxPasses }, signal, { ...services, ai });
    },
  } satisfies ConversationStrategy;
}

/** Shared response boundary after disclosure and dice have already been resolved. */
export function attentionResponseStrategy(report: (event: AnalysisEvent) => void = () => {}): ConversationStrategy {
  return { respond: async ({ request }, signal, services) => {
      const reply = await services.character.respond(request, signal);
      signal.throwIfAborted();
      if (reply.role === "assistant" && reply.content?.trim() && !reply.tool_calls?.length) {
        try {
          const decisions = await analyzeAttention(services.ai, request.messages, reply, signal);
          report({ kind: "labels", subject: "character", source: "attention", decisions });
        } catch (error) {
          signal.throwIfAborted();
          // A diagnostic failure must not discard an otherwise valid character reply.
          report({ kind: "error", subject: "character", error: String(error) });
        }
      }
      return reply;
  } };
}
