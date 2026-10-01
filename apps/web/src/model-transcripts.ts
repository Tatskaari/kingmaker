import { gameLogger } from "../../../packages/observability/src/logging.js";

const log = gameLogger("models");

export type ModelCallKind = "npc_request" | "npc_resolution" | "game_master" | "dialogue" | "dialogue_flavour" | "gm_consultation" | "conversation_review" | "conversation_check" | "world_event" | "event_decision" | "jev" | "outcome_review";
export interface ModelTranscript {
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
  startedAt: string;
  completedAt?: string;
  status: "pending" | "success" | "error";
  calls: ModelTranscript[];
  context?: unknown;
  error?: string;
}

/** Debug history is deliberately separate from game snapshots and rollback. */
export class ModelTranscripts {
  #entries: ModelTranscript[] = [];
  #runs: Record<string, ModelTranscriptRun> = {};
  #sequence = 0;
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
  runs(): Record<string, ModelTranscriptRun> { return structuredClone(this.#runs); }
  start(kind: string, subject: string, characterId = subject, context?: unknown): string {
    const safeSubject = encodeURIComponent(subject || characterId || "unknown");
    const key = `${kind}/${safeSubject}/${crypto.randomUUID()}`;
    this.#runs[key] = { kind, characterId, startedAt: new Date().toISOString(), status: "pending", calls: [], ...(context === undefined ? {} : { context: this.#clean(context) }) };
    return key;
  }
  finish(key: string, context?: unknown): void {
    const run = this.#runs[key];
    if (!run) return;
    run.status = "success"; run.completedAt = new Date().toISOString();
    if (context !== undefined) run.context = this.#clean(context);
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
  async record<T>(kind: ModelCallKind, characterId: string, request: unknown, call: () => Promise<T>, runKey?: string, subject = characterId): Promise<T> {
    const ownRun = !runKey;
    runKey ||= this.start(kind, subject, characterId);
    const started = Date.now();
    const entry: ModelTranscript = { id: ++this.#sequence, kind, characterId, startedAt: new Date(started).toISOString(), status: "pending", request: this.#clean(request) };
    const fields = { runKey, callId: entry.id, kind, characterId };
    log.debug("Model call started", { ...fields, request: entry.request });
    this.#entries.push(entry);
    this.#runs[runKey]?.calls.push(entry);
    if (this.#entries.length > 50) this.#entries.shift();
    this.changed();
    try {
      const response = await call();
      entry.response = this.#clean(response); entry.status = "success";
      log.debug("Model call completed", { ...fields, durationMs: Date.now() - started, response: entry.response });
      if (ownRun) this.finish(runKey);
      return response;
    } catch (error) {
      entry.error = String(this.#clean(error instanceof Error ? error.message : String(error)));
      entry.status = "error";
      log.error("Model call failed", { ...fields, durationMs: Date.now() - started, error: entry.error });
      if (ownRun) this.fail(runKey, error);
      throw error;
    } finally { entry.durationMs = Date.now() - started; this.changed(); }
  }
}
