import { renderPrompt } from "../../prompts/src/index.js";
import type { CharacterSources, LoreDocument } from "./conversation.js";
import type { LoreLink } from "./lore.js";
import type { AiService, LoreService } from "./services.js";
import type { OpenRouterMessage } from "../../providers/src/openrouter.js";
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

export interface DisclosureOptions {
  threshold?: number;
  maxCharacters?: number;
  maxPasses?: number;
}

/** Task-independent retrieval. The supplied document source owns permissions. */
export class ProgressiveDisclosure {
  constructor(private readonly ai: Pick<AiService, "decisions">, private readonly options: DisclosureOptions = {}) {}

  /** Context includes initial document bodies. Return only newly opened system messages. */
  async disclose(docs: LoreService, context: readonly OpenRouterMessage[], signal: AbortSignal,
    options: { trace?: (round: DisclosureRound) => void; characterId?: string } = {}): Promise<OpenRouterMessage[]> {
    const maxPasses = this.options.maxPasses ?? 16;
    if (!Number.isSafeInteger(maxPasses) || maxPasses < 1) throw new Error("Disclosure round limit must be positive.");
    const ai: Pick<AiService, "decisions"> = { decisions: (state, questions, cancellation, purpose, info) =>
      this.ai.decisions(state, questions, cancellation, purpose, { ...info, ...(options.characterId ? { characterId: options.characterId } : {}) }) };
    const traversal = new DisclosureTraversal(docs, ai, this.options.threshold, this.options.maxCharacters);
    const strategies = traversal.rounds(options.trace ?? (() => {})), messages = [...context], additions: OpenRouterMessage[] = [];
    for (let pass = 1; pass <= maxPasses; pass++) {
      const labels = await strategies.classify(messages, pass, signal);
      const opened = await strategies.resolve(messages, labels, signal);
      messages.push(...opened); additions.push(...opened);
      if (!opened.length) return additions;
    }
    throw new Error("Disclosure round limit reached; disclosure incomplete.");
  }
}

/** Opened notes persist for this conversation, but rejected links are reconsidered each round/turn. */
export class DisclosureTraversal {
  #opened: Map<string, LoreDocument>;
  #ids = new Map<string, string>();
  #turn = 0;
  constructor(private readonly lore: LoreService, private readonly ai: Pick<AiService, "decisions">,
    readonly threshold = 0.7, private readonly maxCharacters = 120_000) {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("Threshold must be between 0 and 1.");
    this.#opened = new Map(lore.initial.map(document => [document.path, document]));
  }
  get sources(): CharacterSources { return [...this.#opened.values()]; }
  rounds(trace: (round: DisclosureRound) => void) {
    const turn = ++this.#turn;
    const fail = (event: DisclosureRound, error: unknown): never => {
      trace({ ...event, status: "error", error: error instanceof Error ? error.message : String(error) });
      throw error;
    };
    return {
      classify: async (messages: readonly OpenRouterMessage[], pass: number, signal: AbortSignal) => {
        let event: DisclosureRound = { turn, round: pass, threshold: this.threshold,
          candidates: [], openedBefore: this.sources.map(document => document.path), opened: [], status: "pending" };
        try {
          signal.throwIfAborted();
          // Initial context and notes opened on earlier passes are already available.
          // Enforce this here too, independently of the lore adapter's filtering.
          event.candidates = this.lore.links(this.sources).filter(link => !this.#opened.has(link.path)).map(link => {
            if (!this.#ids.has(link.path)) this.#ids.set(link.path, `open_${this.#ids.size + 1}`);
            return { ...link, id: this.#ids.get(link.path)! };
          });
          const state = messages.map(message => `# ${message.role.toUpperCase()}\n${message.content ?? ""}`).join("\n\n");
          if (state.length > this.maxCharacters) throw new Error("Disclosure context limit reached; disclosure incomplete.");
          if (!event.candidates.length) return event;
          const questions: JevQuestions = Object.fromEntries(event.candidates.map(link => [link.id, {
            type: "choice", instructions: renderPrompt("progressive-disclosure-1"),
            criteria: { [link.id]: renderPrompt("progressive-disclosure-2", { value1: link.summary ? `Document summary: ${JSON.stringify(link.summary)}\n\n` : "", value2: link.path, value3: link.from }), skip: renderPrompt("progressive-disclosure-3") },
          }]));
          if (state.length + JSON.stringify(questions).length > this.maxCharacters) throw new Error("Disclosure context limit reached; disclosure incomplete.");
          event.request = jevEvaluationRequest(state, questions);
          trace(event);
          const started = Date.now();
          const answers = await this.ai.decisions(state, questions, signal, "prog_disc", {
            disclosure: { threshold: this.threshold, candidates: event.candidates },
          });
          signal.throwIfAborted();
          event = { ...event, answers, durationMs: Date.now() - started };
          for (const candidate of event.candidates) {
            const answer = answers[candidate.id], probability = answer?.probabilities[candidate.id];
            if (!answer || ![candidate.id, "skip"].includes(answer.choice) || probability === undefined
              || !Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error(`Invalid Jev probability for ${candidate.path}`);
          }
          return event;
        } catch (error) { return fail(event, error); }
      },
      resolve: async (messages: readonly OpenRouterMessage[], event: DisclosureRound, signal: AbortSignal) => {
        try {
          const opened = await Promise.all(event.candidates
            .filter(link => event.answers![link.id]!.probabilities[link.id]! > this.threshold)
            .map(link => this.lore.open(link, signal)));
          signal.throwIfAborted();
          const additions = opened.map(document => ({ role: "system" as const, content: renderPrompt("progressive-disclosure-4", { value1: document.path, value2: document.markdown }) }));
          const expanded = [...messages];
          expanded.push(...additions);
          if (expanded.map(message => `# ${message.role.toUpperCase()}\n${message.content ?? ""}`).join("\n\n").length > this.maxCharacters) {
            throw new Error("Disclosure context limit reached; disclosure incomplete.");
          }
          for (const document of opened) this.#opened.set(document.path, document);
          trace({ ...event, opened, status: opened.length ? "opened" : event.candidates.length ? "sufficient" : "no_links" });
          return additions;
        } catch (error) { return fail(event, error); }
      },
    };
  }
}
