import { conversationRequest, type CharacterSources, type ConversationInput, type LoreDocument } from "./conversation.js";
import type { CharacterLore, LoreLink } from "./lore.js";
import { jevEvaluationRequest, type JevChoice, type JevQuestions } from "../../providers/src/jev.js";

export type EvaluateLinks = (state: string, questions: JevQuestions, signal: AbortSignal) => Promise<Record<string, JevChoice>>;
export interface DisclosureRound {
  turn: number;
  round: number;
  threshold: number;
  candidates: (LoreLink & { id: string })[];
  openedBefore: string[];
  opened: LoreDocument[];
  status: "pending" | "opened" | "sufficient" | "no_links" | "error";
  request?: ReturnType<typeof jevEvaluationRequest>;
  answers?: Record<string, JevChoice>;
  durationMs?: number;
  error?: string;
}

/** Opened notes persist for this conversation, but rejected links are reconsidered each round/turn. */
export class DisclosureSession {
  #opened: Map<string, LoreDocument>;
  #ids = new Map<string, string>();
  #turn = 0;
  constructor(private readonly lore: CharacterLore, private readonly evaluate: EvaluateLinks,
    readonly threshold = 0.7, private readonly maxRounds = 16, private readonly maxCharacters = 120_000) {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("Threshold must be between 0 and 1.");
    this.#opened = new Map(lore.initial.map(document => [document.path, document]));
  }
  get sources(): CharacterSources { return [...this.#opened.values()]; }
  async disclose(input: ConversationInput, signal: AbortSignal, trace: (round: DisclosureRound) => void): Promise<CharacterSources> {
    const turn = ++this.#turn;
    for (let round = 1; ; round++) {
      const started = Date.now();
      let event: DisclosureRound = { turn, round, threshold: this.threshold, candidates: [],
        openedBefore: [...this.#opened.keys()], opened: [], status: "pending" };
      try {
        signal.throwIfAborted();
        event.candidates = this.lore.candidates(this.sources).map(link => {
          if (!this.#ids.has(link.path)) this.#ids.set(link.path, `open_${this.#ids.size + 1}`);
          return { ...link, id: this.#ids.get(link.path)! };
        });
        if (!event.candidates.length) { trace({ ...event, status: "no_links" }); return this.sources; }
        if (round > this.maxRounds) throw new Error("Disclosure round limit reached; no dialogue generated.");
        const state = conversationRequest({ ...input, sources: this.sources }).messages
          .map(message => `# ${message.role.toUpperCase()}\n${message.content ?? ""}`).join("\n\n");
        if (state.length > this.maxCharacters) throw new Error("Disclosure context limit reached; no dialogue generated.");
        const questions: JevQuestions = Object.fromEntries(event.candidates.map(link => [link.id, {
          type: "choice", instructions: "Judge this link independently. Is opening it relevant to answering the latest player message in character? Use the supplied context and the link's description there. Do not guess the unopened note's contents. Choose skip if current context is sufficient or the topic is unrelated.",
          criteria: { [link.id]: `Open ${link.path}, linked from ${link.from}, for information needed in the next reply.`, skip: "Do not open this note for the next reply." },
        }]));
        event.request = jevEvaluationRequest(state, questions);
        trace(event);
        const answers = await this.evaluate(state, questions, signal);
        signal.throwIfAborted();
        event = { ...event, answers };
        for (const candidate of event.candidates) {
          const answer = answers[candidate.id], probability = answer?.probabilities[candidate.id];
          if (!answer || ![candidate.id, "skip"].includes(answer.choice) || probability === undefined
            || !Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error(`Invalid Jev probability for ${candidate.path}`);
        }
        const opened = event.candidates.filter(link => answers[link.id]!.probabilities[link.id]! > this.threshold)
          .map(link => this.lore.read(link.path));
        if (state.length + opened.reduce((size, document) => size + document.markdown.length + document.path.length + 20, 0) > this.maxCharacters) {
          throw new Error("Disclosure context limit reached; no dialogue generated.");
        }
        for (const document of opened) this.#opened.set(document.path, document);
        trace({ ...event, opened, status: opened.length ? "opened" : "sufficient", durationMs: Date.now() - started });
        if (!opened.length) return this.sources;
      } catch (error) {
        trace({ ...event, status: "error", durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }
  }
}

export function disclosureDetails(event: DisclosureRound): string {
  const probabilities = event.candidates.map(link => {
    const answer = event.answers?.[link.id];
    return `- ${link.path}\n  ${link.id}: ${answer ? answer.probabilities[link.id] : "pending"}; choice: ${answer?.choice ?? "pending"}; ${event.opened.some(document => document.path === link.path) ? "OPENED" : "not opened"}`;
  }).join("\n");
  return `# Jev turn ${event.turn}, round ${event.round}\nStatus: ${event.status}\nOpen probability must exceed: ${event.threshold}\nDuration: ${event.durationMs ?? "pending"} ms\n${event.error ?? ""}\n\n## Link decisions\n${probabilities || "No unopened links."}\n\n## Already opened\n${event.openedBefore.join("\n")}\n\n## Returned decisions\n${JSON.stringify(event.answers ?? {}, null, 2)}\n\n## Questions\n${JSON.stringify(event.request?.questions ?? {}, null, 2)}\n\n## Exact input context\n${event.request?.state ?? "No model call."}`;
}
