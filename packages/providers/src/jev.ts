/** OpenRouter Decisions API; criteria keys are the only permissible results. */
export interface JevChoice { choice: string; probabilities: Record<string, number>; confidence?: number }
export type JevInstructions = string | Record<string, unknown>;
export const jevRequest = (state: unknown, instructions: JevInstructions, criteria: Record<string, string>) =>
  ({ model: "typesafe/jev-1.13", state, questions: { next: { type: "choice", instructions, criteria } } });
export type Choose = (state: unknown, instructions: JevInstructions, criteria: Record<string, string>, signal: AbortSignal) => Promise<JevChoice>;
export class JevClient {
  constructor(private readonly apiKey: string, private readonly http: typeof fetch = (input, init) => globalThis.fetch(input, init),
    private readonly onRequest?: (request: ReturnType<typeof jevRequest>) => void) {}
  async choose(state: unknown, instructions: JevInstructions, criteria: Record<string, string>, signal: AbortSignal): Promise<JevChoice> {
    if (!this.apiKey.trim()) throw new Error("Enter your OpenRouter key first.");
    const request = jevRequest(state, instructions, criteria);
    this.onRequest?.(request);
    const response = await this.http("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey.trim()}`, "Content-Type": "application/json", "X-Title": "Kingmaker Palace" },
      body: JSON.stringify(request),
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    if (!response.ok) {
      let detail = "";
      try {
        const error = await response.json() as { error?: { message?: unknown } };
        if (typeof error.error?.message === "string") {
          detail = error.error.message.split(this.apiKey.trim()).join("[redacted]")
            .replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted]").slice(0, 240);
        }
      } catch { /* Non-JSON errors still show HTTP status. */ }
      let help = response.status === 402 ? "OpenRouter credits or the key's spending limit need attention."
        : response.status === 429 ? "OpenRouter rate limit reached. Wait before retrying." : "The Decisions request was rejected.";
      if (response.status === 401) {
        help = "OpenRouter rejected authentication. Re-enter a valid OpenRouter API key.";
        try {
          const auth = await this.http("https://openrouter.ai/api/v1/key", {
            headers: { Authorization: `Bearer ${this.apiKey.trim()}` },
            signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
          });
          if (auth.ok) help = "Your key authenticates with OpenRouter, but the Decisions endpoint rejected it. Check Decisions API access with OpenRouter.";
          else if (auth.status === 401) help = "OpenRouter also rejected this key on its key-validation endpoint. Replace it with a valid OpenRouter API key (not a TypeSafe or OpenAI key).";
        } catch { /* Keep the original authentication failure. */ }
      }
      throw new Error(`Jev returned HTTP ${response.status}. ${help}${detail ? ` Provider: ${detail}` : ""}`);
    }
    let body: { answers?: { next?: Partial<JevChoice> & { type?: string } } };
    try { body = await response.json() as typeof body; }
    catch { throw new Error(`Jev returned an unreadable response (HTTP ${response.status}). No action was taken. Please try again.`); }
    if (!body || typeof body !== "object") throw new Error("Jev returned an invalid response. No action was taken.");
    const answer = body.answers?.next;
    if (answer?.type !== "choice" || typeof answer.choice !== "string" || !Object.hasOwn(criteria, answer.choice)
      || !answer.probabilities || typeof answer.probabilities !== "object"
      || Object.keys(criteria).some(id => typeof answer.probabilities?.[id] !== "number"
        || !Number.isFinite(answer.probabilities[id]) || answer.probabilities[id]! < 0 || answer.probabilities[id]! > 1)
      || (answer.confidence !== undefined && (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1))) {
      throw new Error("Jev returned an invalid or unavailable choice. No action was taken.");
    }
    return { choice: answer.choice, probabilities: answer.probabilities,
      ...(answer.confidence === undefined ? {} : { confidence: answer.confidence }) };
  }
}
