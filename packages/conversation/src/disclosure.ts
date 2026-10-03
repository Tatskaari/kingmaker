import type { CharacterSources } from "./conversation.js";
import type { AiService, LoreService } from "./services.js";
import type { ConversationHooks } from "./phases.js";
import { DisclosureTraversal, type DisclosureRound } from "./progressive-disclosure.js";
export type { DisclosureRound, EvaluateLinks } from "./progressive-disclosure.js";

/** Conversation adapter; the traversal itself has no conversation dependency. */
export class DisclosureSession {
  private readonly traversal: DisclosureTraversal;
  constructor(lore: LoreService, ai: AiService, readonly threshold = 0.7, maxCharacters = 120_000) {
    this.traversal = new DisclosureTraversal(lore, ai, threshold, maxCharacters);
  }
  get sources(): CharacterSources { return this.traversal.sources; }
  hooks(trace: (round: DisclosureRound) => void): ConversationHooks<DisclosureRound> {
    const rounds = this.traversal.rounds(trace);
    return {
      classify: (context, signal) => rounds.classify(context.request.messages, context.pass, signal),
      resolve: async (context, labels, signal) => {
        const offset = 1 + this.sources.length;
        const messages = await rounds.resolve(context.request.messages, labels, signal);
        context.request.messages.splice(offset, 0, ...messages);
        return { reclassify: messages.length > 0 };
      },
    };
  }
}

export function disclosureDetails(event: DisclosureRound): string {
  const probabilities = event.candidates.map(link => {
    const answer = event.answers?.[link.id];
    return `- ${link.path}\n${link.summary ? `  Summary: ${link.summary}\n` : ""}  ${link.id}: ${answer ? answer.probabilities[link.id] : "pending"}; choice: ${answer?.choice ?? "pending"}; ${event.opened.some(document => document.path === link.path) ? "OPENED" : "not opened"}`;
  }).join("\n");
  return `# Jev turn ${event.turn}, round ${event.round}\nStatus: ${event.status}\nOpen probability must exceed: ${event.threshold}\nDuration: ${event.durationMs ?? "pending"} ms\n${event.error ?? ""}\n\n## Link decisions\n${probabilities || "No unopened links."}\n\n## Already opened\n${event.openedBefore.join("\n")}\n\n## Returned decisions\n${JSON.stringify(event.answers ?? {}, null, 2)}\n\n## Questions\n${JSON.stringify(event.request?.questions ?? {}, null, 2)}\n\n## Exact input context\n${event.request?.state ?? "No model call."}`;
}
