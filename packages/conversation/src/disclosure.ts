import type { CharacterSources } from "./conversation.js";
import type { AiService, LoreService } from "./services.js";
import type { ConversationContext, ConversationStrategy } from "./phases.js";
import { DisclosureTraversal, type DisclosureRound } from "./progressive-disclosure.js";
export type { DisclosureRound, EvaluateLinks } from "./progressive-disclosure.js";

/** Conversation adapter; the traversal itself has no conversation dependency. */
export class DisclosureSession {
  private readonly traversal: DisclosureTraversal;
  constructor(lore: LoreService, ai: AiService, readonly threshold = 0.7, maxCharacters = 120_000) {
    this.traversal = new DisclosureTraversal(lore, ai, threshold, maxCharacters);
  }
  get sources(): CharacterSources { return this.traversal.sources; }
  async prepare(request: ConversationContext["request"], signal: AbortSignal, trace: (round: DisclosureRound) => void,
    maxPasses: number): Promise<ConversationContext> {
    const context: ConversationContext = { request, pass: 1, completed: new Set() };
    const rounds = this.traversal.rounds(trace);
    for (; context.pass <= maxPasses; context.pass++) {
      signal.throwIfAborted();
      const labels = await rounds.classify(context.request.messages, context.pass, signal);
      signal.throwIfAborted();
      const offset = 1 + this.sources.length;
      const messages = await rounds.resolve(context.request.messages, labels, signal);
      signal.throwIfAborted();
      context.request.messages.splice(offset, 0, ...messages);
      if (!messages.length) return context;
    }
    throw new Error("Conversation round limit reached; no dialogue generated.");
  }
  strategy(trace: (round: DisclosureRound) => void): ConversationStrategy {
    return { respond: async ({ request, maxPasses }, signal, services) => {
      const context = await this.prepare(request, signal, trace, maxPasses);
      return services.character.respond(context.request, signal);
    } };
  }
}

export function disclosureDetails(event: DisclosureRound): string {
  const probabilities = event.candidates.map(link => {
    const answer = event.answers?.[link.id];
    return `- ${link.path}\n${link.summary ? `  Summary: ${link.summary}\n` : ""}  ${link.id}: ${answer ? answer.probabilities[link.id] : "pending"}; choice: ${answer?.choice ?? "pending"}; ${event.opened.some(document => document.path === link.path) ? "OPENED" : "not opened"}`;
  }).join("\n");
  return `# Jev turn ${event.turn}, round ${event.round}\nStatus: ${event.status}\nOpen probability must exceed: ${event.threshold}\nDuration: ${event.durationMs ?? "pending"} ms\n${event.error ?? ""}\n\n## Link decisions\n${probabilities || "No unopened links."}\n\n## Already opened\n${event.openedBefore.join("\n")}\n\n## Returned decisions\n${JSON.stringify(event.answers ?? {}, null, 2)}\n\n## Questions\n${JSON.stringify(event.request?.questions ?? {}, null, 2)}\n\n## Exact input context\n${event.request?.state ?? "No model call."}`;
}
