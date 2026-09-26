export type ModelCallKind = "game_master" | "dialogue" | "conversation_review" | "jev" | "outcome_review";
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

/** Debug history is deliberately separate from game snapshots and rollback. */
export class ModelTranscripts {
  #entries: ModelTranscript[] = [];
  #sequence = 0;
  constructor(private readonly apiKey: string, private readonly changed: () => void = () => {}) {}
  #clean(value: unknown): unknown {
    let json = JSON.stringify(value) ?? "null";
    if (this.apiKey) json = json.split(JSON.stringify(this.apiKey).slice(1, -1)).join("[redacted]");
    return JSON.parse(json.replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted]"));
  }
  recent(): ModelTranscript[] { return structuredClone([...this.#entries].reverse()); }
  async record<T>(kind: ModelCallKind, characterId: string, request: unknown, call: () => Promise<T>): Promise<T> {
    const started = Date.now();
    const entry: ModelTranscript = { id: ++this.#sequence, kind, characterId, startedAt: new Date(started).toISOString(), status: "pending", request: this.#clean(request) };
    this.#entries.push(entry);
    if (this.#entries.length > 50) this.#entries.shift();
    this.changed();
    try {
      const response = await call();
      entry.response = this.#clean(response); entry.status = "success";
      return response;
    } catch (error) {
      entry.error = String(this.#clean(error instanceof Error ? error.message : String(error)));
      entry.status = "error"; throw error;
    } finally { entry.durationMs = Date.now() - started; this.changed(); }
  }
}
