import type { ChatCompletionRequest, OpenRouterMessage } from "../../providers/src/openrouter.js";
import { InvalidModelJsonError, parseModelObject } from "../../providers/src/structured-output.js";
import { DocumentConflictError } from "../../lore/src/services.js";
import type { RuntimeServices } from "./services.js";
import { GameMasterTools, gameMasterTools, InvalidReviewError } from "./gm-tools.js";

export { GAME_MASTER_PROMPT } from "./agent-setup.js";

/** All GM entrypoints use the same tool definitions, execution and conflict handling. */
export async function runGameMaster(request: ChatCompletionRequest, services: RuntimeServices, signal: AbortSignal,
  options: { characterId?: string; requireCommit?: boolean; prepare?: (messages: OpenRouterMessage[]) => Promise<OpenRouterMessage[]> } = {}) {
  const messages = await services.agents.prepare({ agent: "game_master", ...(options.characterId ? { characterId: options.characterId } : {}), messages: request.messages }, signal);
  const session = new GameMasterTools(services, options.characterId);
  if (options.requireCommit) await session.begin();
  let corrections = 0;
  for (let turn = 0; turn < 16; turn++) {
    signal.throwIfAborted();
    const response = await services.ai.responses({ ...request, tools: gameMasterTools,
      messages: options.prepare ? await options.prepare(messages) : messages,
    }, signal, { ...(options.characterId ? { characterId: options.characterId } : {}), ...(!options.requireCommit ? { purpose: "gm_consultation" as const } : {}) });
    signal.throwIfAborted();
    if (!response.tool_calls?.length) {
      if (options.requireCommit || session.pending) {
        const instruction = "Document review must call a tool and finish with commit_review. No review was committed. Reconcile any conflict using the latest documents, restage discarded activities, then call commit_review.";
        if (corrections++ >= 2) throw new Error(instruction);
        messages.push(response, { role: "system", content: instruction });
        continue;
      }
      return response;
    }
    messages.push(response);
    for (const [index, call] of response.tool_calls.entries()) {
      if (call.function.name === "commit_review" && index !== response.tool_calls.length - 1) throw new Error("commit_review must be the final tool call.");
      try {
        const input = parseModelObject(call.function.arguments, "Game master tool");
        const result = await session.call(call.function.name, input, { response, toolCallId: call.id });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        if (call.function.name === "commit_review" && options.requireCommit) return { role: "assistant" as const, content: JSON.stringify(result) };
      } catch (error) {
        if (error instanceof DocumentConflictError) {
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(await session.conflict(error)) });
        } else if ((error instanceof InvalidReviewError || error instanceof InvalidModelJsonError) && corrections++ < 2) {
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: false,
            error: "invalid_tool_arguments", instruction: error.message }) });
        } else throw error;
      }
    }
  }
  throw new Error("Game master tool limit reached; review incomplete.");
}
