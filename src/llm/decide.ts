import { apiKey, fetchWithRetry, logCall, recordCost, respondJson, LUNA, type Effort } from "./openrouter.ts";

/**
 * A "decision mode" call: choose one named criterion per question.
 * Jev (TypeSafe, OpenRouter Decisions API) and Luna (structured output) implement the same shape
 * so the scene runtime can swap them and evals can compare accuracy and latency.
 */
export interface ChoiceQuestion { instructions: string; criteria: Record<string, string> }
export interface ChoiceAnswer { choice: string; probabilities: Record<string, number>; confidence?: number }
export interface Decision { answers: Record<string, ChoiceAnswer>; latencyMs: number; costUsd: number; decider: string }

export interface Decider {
  readonly name: string;
  decide(state: unknown, questions: Record<string, ChoiceQuestion>, operation: string): Promise<Decision>;
}

export const JEV_MODEL = "typesafe/jev-1.13";

export class JevDecider implements Decider {
  readonly name = "jev";
  async decide(state: unknown, questions: Record<string, ChoiceQuestion>, operation: string): Promise<Decision> {
    const key = apiKey();
    const request = {
      model: JEV_MODEL,
      state,
      questions: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, { type: "choice", instructions: q.instructions, criteria: q.criteria }])),
    };
    const started = performance.now();
    const response = await fetchWithRetry("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Kingmaker V2 PoC" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(60_000),
    }, operation);
    const latencyMs = performance.now() - started;
    const body = await response.json() as { answers?: Record<string, ChoiceAnswer & { type?: string }>; usage?: { cost?: number }; error?: { message?: string } };
    if (!response.ok || !body.answers) {
      logCall({ provider: "jev", operation, request, error: body.error?.message ?? `HTTP ${response.status}` });
      throw new Error(`Jev ${operation} failed: ${body.error?.message ?? `HTTP ${response.status}`}`);
    }
    const answers: Record<string, ChoiceAnswer> = {};
    for (const [id, q] of Object.entries(questions)) {
      const answer = body.answers[id];
      if (!answer || !Object.hasOwn(q.criteria, answer.choice)) throw new Error(`Jev ${operation}: invalid answer for ${id}`);
      answers[id] = { choice: answer.choice, probabilities: answer.probabilities, ...(answer.confidence === undefined ? {} : { confidence: answer.confidence }) };
    }
    const costUsd = body.usage?.cost ?? 0;
    recordCost("jev", operation, JEV_MODEL, costUsd, latencyMs);
    logCall({ provider: "jev", operation, request, answers, latencyMs: Math.round(latencyMs), costUsd });
    return { answers, latencyMs, costUsd, decider: this.name };
  }
}

/** Luna as a decision mode: strict JSON schema restricted to the criteria ids. */
export class LunaDecider implements Decider {
  readonly name: string;
  private readonly effort: Effort;
  private readonly model: string;
  constructor(effort: Effort = "none", model = LUNA) {
    this.effort = effort;
    this.model = model;
    this.name = `luna-${effort}`;
  }
  async decide(state: unknown, questions: Record<string, ChoiceQuestion>, operation: string): Promise<Decision> {
    const ids = Object.keys(questions);
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ids,
      properties: Object.fromEntries(ids.map(id => [id, { type: "string", enum: Object.keys(questions[id]!.criteria) }])),
    };
    const rendered = ids.map(id => {
      const q = questions[id]!;
      return `## Question "${id}"\n${q.instructions}\nOptions:\n${Object.entries(q.criteria).map(([key, text]) => `- ${key}: ${text}`).join("\n")}`;
    }).join("\n\n");
    const result = await respondJson<Record<string, string>>({
      model: this.model,
      effort: this.effort,
      operation,
      instructions: "You are a precise classifier. Read the state, then answer every question by choosing exactly one option id. Answer with JSON only.",
      input: [{ role: "user", content: `# State\n${typeof state === "string" ? state : JSON.stringify(state, null, 1)}\n\n# Questions\n${rendered}` }],
      json: { name: "decision", schema },
    });
    const answers: Record<string, ChoiceAnswer> = {};
    for (const id of ids) {
      const choice = result[id];
      if (typeof choice !== "string" || !Object.hasOwn(questions[id]!.criteria, choice)) throw new Error(`Luna ${operation}: invalid answer for ${id}`);
      answers[id] = { choice, probabilities: Object.fromEntries(Object.keys(questions[id]!.criteria).map(key => [key, key === choice ? 1 : 0])) };
    }
    return { answers, latencyMs: result._meta.latencyMs, costUsd: result._meta.costUsd, decider: this.name };
  }
}

export function deciderFor(name: string): Decider {
  if (name === "jev") return new JevDecider();
  if (name.startsWith("luna")) return new LunaDecider((name.split("-")[1] as Effort | undefined) ?? "none");
  throw new Error(`Unknown decider ${name}`);
}
