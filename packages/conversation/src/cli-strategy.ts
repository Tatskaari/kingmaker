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
export function cliStrategy(disclosure: DisclosureSession, ai: AiService, build: DndCharacter | undefined,
  playerTurn: string, requestRoll: RequestRoll, trace: (round: DisclosureRound) => void, debug: (turn: LlmTurn) => void, presentation: Partial<PresentationService> = {}, character: Partial<CharacterMechanics> = {}, gm?: { services: Partial<RuntimeServices>; characterId: string }, report: (event: AnalysisEvent) => void = () => {}) {
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
      const labels = await checks.classify(structuredClone(context), signal);
      signal.throwIfAborted();
      await checks.resolve(context, labels, signal);
      signal.throwIfAborted();
      const reply = await services.character.respond(context.request, signal);
      signal.throwIfAborted();
      if (reply.role === "assistant" && reply.content?.trim() && !reply.tool_calls?.length) {
        try {
          const decisions = await analyzeAttention(ai, structuredClone(context.request.messages), structuredClone(reply), signal);
          report({ kind: "labels", subject: "character", source: "attention", decisions });
        } catch (error) {
          signal.throwIfAborted();
          // A diagnostic failure must not discard an otherwise valid character reply.
          report({ kind: "error", subject: "character", error: String(error) });
        }
      }
      return reply;
    },
  } satisfies ConversationStrategy;
}
