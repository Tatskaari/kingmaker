import type { ChatCompletionRequest, OpenRouterMessage } from "../../providers/src/openrouter.js";
import type { ConversationRuntime } from "./runtime.js";

export interface ConversationContext {
  request: Omit<ChatCompletionRequest, "messages"> & { messages: OpenRouterMessage[] };
  pass: number;
  /** Resolvers can record effects that must not run again on a later pass. */
  completed: Set<string>;
}
export interface ConversationStrategy<Labels = Record<string, never>> {
  classify(context: Readonly<ConversationContext>, signal: AbortSignal): Promise<Labels>;
  resolve(context: ConversationContext, labels: Readonly<Labels>, signal: AbortSignal): Promise<{ reclassify: boolean }>;
}

/** All hosts share this loop; classifiers decide and resolvers alone perform effects. */
export async function runConversation<Labels>(request: ChatCompletionRequest, runtime: ConversationRuntime<Labels>,
  signal: AbortSignal = new AbortController().signal,
  onRespond: (request: ChatCompletionRequest) => void = () => {}): Promise<OpenRouterMessage> {
  const context: ConversationContext = { request: { ...structuredClone(request), messages: structuredClone([...request.messages]) }, pass: 1, completed: new Set() };
  for (; context.pass <= runtime.maxPasses; context.pass++) {
    signal.throwIfAborted();
    // Classifiers receive a detached view, so accidental writes cannot change the turn.
    const labels = await runtime.strategies.conversation.classify(structuredClone(context), signal);
    signal.throwIfAborted();
    const result = await runtime.strategies.conversation.resolve(context, labels, signal);
    signal.throwIfAborted();
    if (result.reclassify) continue;
    onRespond(context.request);
    const reply = await runtime.services.character.respond(context.request, signal);
    signal.throwIfAborted();
    return reply;
  }
  throw new Error("Conversation round limit reached; no dialogue generated.");
}
