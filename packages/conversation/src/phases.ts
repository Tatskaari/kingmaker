import type { ChatCompletionRequest, OpenRouterMessage } from "../../providers/src/openrouter.js";
import type { ConversationRuntime } from "./runtime.js";
import type { RuntimeServices } from "./services.js";

/** Internal state for the disclosure and check helpers. */
export interface ConversationContext {
  request: Omit<ChatCompletionRequest, "messages"> & { messages: OpenRouterMessage[] };
  pass: number;
  completed: Set<string>;
}
export interface ConversationStrategy {
  /** Own the complete turn, including any preparation, generation and review. */
  respond(context: { request: ConversationContext["request"]; maxPasses: number }, signal: AbortSignal,
    services: RuntimeServices): Promise<OpenRouterMessage>;
}

export const directConversationStrategy: ConversationStrategy = {
  respond: (context, signal, services) => services.character.respond(context.request, signal),
};

/** Hosts dispatch through the same swappable response hook. */
export async function runConversation(request: ChatCompletionRequest, runtime: ConversationRuntime,
  signal: AbortSignal = new AbortController().signal,
  onRespond: (request: ChatCompletionRequest) => void = () => {}): Promise<OpenRouterMessage> {
  signal.throwIfAborted();
  const services = { ...runtime.services, character: { ...runtime.services.character,
    respond: async (prepared: ChatCompletionRequest, cancellation: AbortSignal) => {
      cancellation.throwIfAborted();
      onRespond(prepared);
      const reply = await runtime.services.character.respond(prepared, cancellation);
      cancellation.throwIfAborted();
      return reply;
    },
  } };
  const reply = await runtime.strategies.conversation.respond({ request: { ...structuredClone(request), messages: structuredClone([...request.messages]) }, maxPasses: runtime.maxPasses }, signal, services);
  signal.throwIfAborted();
  return reply;
}
