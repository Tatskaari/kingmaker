import type { ConversationReviewContext } from "./review.js";
import type { ChatCompletionRequest, OpenRouterMessage } from "../../providers/src/openrouter.js";
import { InvalidModelJsonError, parseModelObject } from "../../providers/src/structured-output.js";
import { DocumentConflictError } from "../../lore/src/services.js";
import type { RuntimeServices } from "./services.js";
import { GameMasterTools, gameMasterTools, InvalidReviewError } from "./gm-tools.js";

export { GAME_MASTER_PROMPT } from "./agent-setup.js";

/** All GM entrypoints use the same tool definitions, execution and conflict handling. */
export async function runGameMaster(request: ChatCompletionRequest, services: RuntimeServices, signal: AbortSignal,
  options: { characterId?: string; review?: boolean; systemPrompt?: string; activityOrigin?: Readonly<ConversationReviewContext>; prepare?: (messages: OpenRouterMessage[]) => Promise<OpenRouterMessage[]> } = {}) {
  const messages = await services.agents.prepare({ agent: "game_master", ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}), ...(options.characterId ? { characterId: options.characterId } : {}), messages: request.messages }, signal);
  const tools = request.tools ?? gameMasterTools;
  const session = new GameMasterTools(services, options.characterId, options.activityOrigin);
  if (options.review) await session.begin();
  let corrections = 0;
  for (let turn = 0; turn < 16; turn++) {
    signal.throwIfAborted();
    const response = await services.ai.responses({ ...request, tools,
      messages: options.prepare ? await options.prepare(messages) : messages,
    }, signal, { ...(options.characterId ? { characterId: options.characterId } : {}), ...(!options.review ? { purpose: "gm_consultation" as const } : {}) });
    signal.throwIfAborted();
    if (!response.tool_calls?.length) {
      try {
        await session.commit();
      } catch (error) {
        if (!(error instanceof DocumentConflictError)) throw error;
        messages.push(response, { role: "system", content: JSON.stringify(await session.conflict(error)) });
        continue;
      }
      signal.throwIfAborted();
      return response;
    }
    messages.push(response);
    for (const call of response.tool_calls) {
      try {
        const definition = tools.find(tool => tool.function.name === call.function.name);
        if (!definition) throw new InvalidReviewError(`Tool unavailable in this review: ${call.function.name}`);
        const input = parseModelObject(call.function.arguments, "Game master tool");
        const schema = definition.function.parameters as { additionalProperties?: boolean; properties?: Record<string, unknown> };
        if (call.function.name === "set_activity" && schema.additionalProperties === false
          && Object.keys(input).some(key => !Object.hasOwn(schema.properties ?? {}, key))) {
          throw new InvalidReviewError("Unexpected tool argument in this review.");
        }
        const result = await session.call(call.function.name, input, { response, toolCallId: call.id });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
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
