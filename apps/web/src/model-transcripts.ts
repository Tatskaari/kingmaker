import type { AiSpan } from "../../../packages/conversation/src/ai-tracing.js";
import type { DocumentUpdate } from "../../../packages/conversation/src/services.js";
import { gameLogger } from "../../../packages/observability/src/logging.js";

const log = gameLogger("models");

export type ModelCallKind = "conversation_tree" | "conversation_attention" | "skill_check" | "skill_difficulty" | "prog_disc" | "conversation_expression" | "npc_request" | "npc_resolution" | "game_master" | "dialogue" | "dialogue_flavour" | "gm_consultation" | "conversation_review" | "conversation_check" | "world_event" | "event_decision" | "jev" | "outcome_review";
export const modelCallLabels: Record<ModelCallKind, string> = {
  conversation_attention: "Jev conversation attention",
  conversation_tree: "Jev conversation tree",
  skill_check: "Jev skill check",
  skill_difficulty: "Jev skill difficulty",
  prog_disc: "Jev progressive disclosure",
  npc_request: "NPC request interpretation",
  npc_resolution: "character review (NPC action)",
  game_master: "character creation",
  dialogue: "dialogue generation",
  dialogue_flavour: "dialogue flavour",
  gm_consultation: "GM consultation",
  conversation_review: "character review (conversation)",
  conversation_check: "conversation classification",
  conversation_expression: "conversation expression classification",
  world_event: "character review (world event)",
  event_decision: "event relevance check",
  jev: "NPC action selection",
  outcome_review: "character review (outcome)",
};
export interface ModelTranscript extends AiSpan {
  id: number;
  kind: ModelCallKind;
  characterId: string;
  startedAt: string;
  durationMs?: number;
  status: "pending" | "success" | "error";
  request: unknown;
  response?: unknown;
  error?: string;
}

export interface ModelTranscriptRun {
  kind: string;
  characterId: string;
  participantIds: string[];
  conversationId: string;
  startedAt: string;
  completedAt?: string;
  status: "pending" | "success" | "error" | "stopped";
  calls: ModelTranscript[];
  context?: unknown;
  error?: string;
}

export interface DocumentWrite extends Omit<DocumentUpdate, "response"> {
  updatedAt: string;
  call: ModelTranscript;
}

/** Debug history is deliberately separate from game snapshots and rollback. */
export class ModelTranscripts {
  #entries: ModelTranscript[] = [];
  #runs: Record<string, ModelTranscriptRun> = {};
  #sequence = 0;
  #responses = new WeakMap<object, ModelTranscript>();
  #documentWrites: DocumentWrite[] = [];
  constructor(private readonly apiKey: string, private readonly changed: () => void = () => {}) {}
  #clean(value: unknown): unknown {
    let json = JSON.stringify(value) ?? "null";
    if (this.apiKey) json = json.split(JSON.stringify(this.apiKey).slice(1, -1)).join("[redacted]");
    return JSON.parse(json.replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted]"));
  }
  toolResult(call: { id: string; function: { name: string; arguments: string } }, result: unknown): void {
    log.debug("LLM tool result", { toolCallId: call.id, tool: call.function.name,
      arguments: this.#clean(call.function.arguments), result: this.#clean(result) });
  }
  recent(): ModelTranscript[] { return structuredClone([...this.#entries].reverse()); }
  latestDialogue(runKey: string | undefined, characterId: string): ModelTranscript | null {
    const call = runKey && this.#runs[runKey]?.calls.findLast(call => call.kind === "dialogue" && call.characterId === characterId);
    return call ? structuredClone(call) : null;
  }
  runs(): Record<string, ModelTranscriptRun> { return structuredClone(this.#runs); }
  /** Public activity only: never expose requests, dialogue or review contents on the map. */
  speechBubbles(): { characterId: string; participantIds: string[] }[] {
    return Object.values(this.#runs).filter(run => run.status === "pending").flatMap(run =>
      run.calls.filter(call => call.kind === "dialogue" && call.status === "pending")
        .map(call => ({ characterId: call.characterId, participantIds: [...call.participantIds] })));
  }
  documentWrites(): DocumentWrite[] { return structuredClone([...this.#documentWrites].reverse()); }
  clearDocumentWrites(): void { this.#documentWrites = []; }
  documentUpdated({ response, ...update }: DocumentUpdate): void {
    const call = this.#responses.get(response);
    if (!call || update.beforeSha === update.afterSha) return;
    // Keep the exact redacted call with its write even after ordinary runs expire.
    this.#documentWrites.push({ ...this.#clean(update) as typeof update, updatedAt: new Date().toISOString(), call });
    if (this.#documentWrites.length > 50) this.#documentWrites.shift();
    this.changed();
  }
  start(kind: string, subject: string, characterId = subject, context?: unknown, participantIds = [characterId]): string {
    const safeSubject = encodeURIComponent(subject || characterId || "unknown");
    const key = `${kind}/${safeSubject}/${crypto.randomUUID()}`;
    this.#runs[key] = { kind, characterId, participantIds, conversationId: key, startedAt: new Date().toISOString(), status: "pending", calls: [], ...(context === undefined ? {} : { context: this.#clean(context) }) };
    return key;
  }
  finish(key: string, context?: unknown): void {
    const run = this.#runs[key];
    if (!run) return;
    run.status = "success"; run.completedAt = new Date().toISOString();
    if (context !== undefined) run.context = this.#clean(context);
    this.#trimRuns(); this.changed();
  }
  stop(key: string): void {
    const run = this.#runs[key];
    if (!run) return;
    run.status = "stopped"; run.completedAt = new Date().toISOString();
    this.#trimRuns(); this.changed();
  }
  fail(key: string, error: unknown, context?: unknown): void {
    const run = this.#runs[key];
    if (!run) return;
    run.status = "error"; run.completedAt = new Date().toISOString();
    run.error = String(this.#clean(error instanceof Error ? error.message : String(error)));
    if (context !== undefined) run.context = this.#clean(context);
    this.#trimRuns(); this.changed();
  }
  async group<T>(kind: string, subject: string, characterId: string, work: (key: string) => Promise<T>, context?: unknown): Promise<T> {
    const key = this.start(kind, subject, characterId, context);
    try { const result = await work(key); this.finish(key); return result; }
    catch (error) { this.fail(key, error); throw error; }
  }
  #trimRuns(): void {
    const completed = Object.keys(this.#runs).filter(key => this.#runs[key]!.status !== "pending");
    while (completed.length > 50) delete this.#runs[completed.shift()!];
  }
  async record<T>(kind: ModelCallKind, characterId: string, request: unknown, call: () => Promise<T>, runKey?: string, subject = characterId, span?: AiSpan): Promise<T> {
    const ownRun = !runKey;
    runKey ||= this.start(kind, subject, characterId, undefined, span?.participantIds);
    const started = Date.now();
    const trace: AiSpan = span ?? { characterId, participantIds: [characterId], conversationId: runKey, turnId: crypto.randomUUID(), spanId: crypto.randomUUID(), operation: kind };
    const entry: ModelTranscript = { ...this.#clean(trace) as AiSpan, id: ++this.#sequence, kind, characterId, startedAt: new Date(started).toISOString(), status: "pending", request: this.#clean(request) };
    const callType = ["jev", "event_decision", "conversation_check", "conversation_tree"].includes(kind) ? "JEV" : "LLM";
    const operation = modelCallLabels[kind];
    const fields = { ...trace, runKey, callId: entry.id, kind, callType, operation };
    log.debug(`${callType}: ${operation} started`, { ...fields, request: entry.request });
    this.#entries.push(entry);
    this.#runs[runKey]?.calls.push(entry);
    if (this.#entries.length > 50) this.#entries.shift();
    this.changed();
    try {
      const response = await call();
      entry.response = this.#clean(response); entry.status = "success";
      if (response && typeof response === "object") this.#responses.set(response, entry);
      log.debug(`${callType}: ${operation} completed`, { ...fields, durationMs: Date.now() - started, response: entry.response });
      if (ownRun) this.finish(runKey);
      return response;
    } catch (error) {
      entry.error = String(this.#clean(error instanceof Error ? error.message : String(error)));
      entry.status = "error";
      log.error(`${callType}: ${operation} failed`, { ...fields, durationMs: Date.now() - started, error: entry.error });
      if (ownRun) this.fail(runKey, error);
      throw error;
    } finally { entry.durationMs = Date.now() - started; this.changed(); }
  }
}
