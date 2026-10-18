import { apiKey, fetchWithRetry, logCall, recordCost, respondJson, LUNA, type CallContext, type Effort } from "./openrouter.ts";

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

/** Luna's own decision mode, served on the same Decisions endpoint and schema as Jev. */
export const LUNA_DECISIONS_MODEL = "openai/gpt-6-luna-decisions";

export class JevDecider implements Decider {
  readonly name: string;
  private readonly model: string;
  /** Whose calls these are, when they're kept apart from the process's (the AI service's requests). */
  private readonly calls: CallContext | undefined;
  constructor(model = JEV_MODEL, name = "jev", calls?: CallContext) {
    this.model = model;
    this.name = name;
    this.calls = calls;
  }
  async decide(state: unknown, questions: Record<string, ChoiceQuestion>, operation: string): Promise<Decision> {
    // A question with one option has one answer (the Decisions API wants at least two: a fighter's
    // only class feature, the one person in reach of a grab): answered here, and only the rest asked.
    const settled = Object.fromEntries(Object.entries(questions).filter(([, q]) => Object.keys(q.criteria).length === 1)
      .map(([id, q]) => [id, { choice: Object.keys(q.criteria)[0]!, probabilities: { [Object.keys(q.criteria)[0]!]: 1 } }])) as Record<string, ChoiceAnswer>;
    const asked = Object.fromEntries(Object.entries(questions).filter(([id]) => !settled[id]));
    if (!Object.keys(asked).length) return { answers: settled, latencyMs: 0, costUsd: 0, decider: this.name };
    if (Object.keys(settled).length) return this.decide(state, asked, operation).then(d => ({ ...d, answers: { ...settled, ...d.answers } }));
    const key = this.calls?.apiKey ?? apiKey();
    const request = {
      model: this.model,
      state,
      questions: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, { type: "choice", instructions: q.instructions, criteria: q.criteria }])),
    };
    const started = performance.now();
    const response = await fetchWithRetry("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Kingmaker V2 PoC" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(60_000),
    }, operation, this.calls);
    const latencyMs = performance.now() - started;
    const body = await response.json() as { answers?: Record<string, ChoiceAnswer & { type?: string }>; usage?: { cost?: number }; error?: { message?: string } };
    if (!response.ok || !body.answers) {
      logCall({ provider: this.name, operation, request, error: body.error?.message ?? `HTTP ${response.status}` }, this.calls);
      throw new Error(`${this.name} ${operation} failed: ${body.error?.message ?? `HTTP ${response.status}`}`);
    }
    const answers: Record<string, ChoiceAnswer> = {};
    for (const [id, q] of Object.entries(questions)) {
      const answer = body.answers[id];
      if (!answer || !Object.hasOwn(q.criteria, answer.choice)) throw new Error(`${this.name} ${operation}: invalid answer for ${id}`);
      answers[id] = { choice: answer.choice, probabilities: answer.probabilities, ...(answer.confidence === undefined ? {} : { confidence: answer.confidence }) };
    }
    const costUsd = body.usage?.cost ?? 0;
    recordCost(this.name, operation, this.model, costUsd, latencyMs, this.calls);
    logCall({ provider: this.name, operation, request, answers, latencyMs: Math.round(latencyMs), costUsd }, this.calls);
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

/**
 * Jev first (fast); any answer below the confidence threshold is re-asked of Luna.
 * Most turns stay at Jev latency; only ambiguous judgements pay for the slower model.
 */
export class CascadeDecider implements Decider {
  readonly name: string;
  private readonly fast = new JevDecider();
  private readonly slow: LunaDecider;
  private readonly threshold: number;
  constructor(threshold = 0.8, effort: Effort = "none") {
    this.threshold = threshold;
    this.slow = new LunaDecider(effort);
    this.name = `cascade-${threshold}`;
  }
  async decide(state: unknown, questions: Record<string, ChoiceQuestion>, operation: string): Promise<Decision> {
    const first = await this.fast.decide(state, questions, operation);
    const unsure = Object.keys(questions).filter(id => (first.answers[id]?.confidence ?? 1) < this.threshold);
    if (!unsure.length) return { ...first, decider: this.name };
    const second = await this.slow.decide(state, Object.fromEntries(unsure.map(id => [id, questions[id]!])), `${operation}.escalated`);
    return {
      answers: { ...first.answers, ...second.answers },
      latencyMs: first.latencyMs + second.latencyMs,
      costUsd: first.costUsd + second.costUsd,
      decider: `${this.name}(escalated:${unsure.join(",")})`,
    };
  }
}

export function deciderFor(name: string): Decider {
  if (name === "jev") return new JevDecider();
  if (name === "luna-decisions") return new JevDecider(LUNA_DECISIONS_MODEL, "luna-decisions");
  if (name.startsWith("cascade")) return new CascadeDecider(Number(name.split("-")[1] ?? 0.8) || 0.8);
  if (name.startsWith("luna")) return new LunaDecider((name.split("-")[1] as Effort | undefined) ?? "none");
  throw new Error(`Unknown decider ${name}`);
}
