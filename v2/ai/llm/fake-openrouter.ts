/**
 * A stand-in for OpenRouter, for tests that play real turns with no network (src/report/report.test.ts):
 * the game's own calls, through its own code, answered here.
 *
 * - The Decisions API (the decider, disclosure): every question gets its quietest choice (none,
 *   not_yet, on_track, in_character...), or its first; or the choice `choices` names for it.
 * - The Responses API: JSON made to fit the schema asked for (the stage manager's operations, the
 *   quick co-GM), or one of `byName`'s by the schema's name; the lines a scene or a talk suggests
 *   (asked for in instructions that begin "You suggest what the player might": v2/ai/prompts/suggest.md,
 *   src/runtime/talk.ts) from `suggestions`, in turn, none unless it's given; otherwise the GM's
 *   next line from `replies`, streamed as OpenRouter streams it.
 *
 * - `stall`: structured calls (by the schema's name) that never answer, until the caller gives up.
 * - `capped`: structured calls that run to their token cap (status incomplete), billed at the cost given.
 * - `phased`: structured calls answered in two phases, as Luna sometimes does: a "commentary" message
 *   of junk, then the answer as a "final_answer".
 *
 * Anything else asked of it is refused, so a test can't reach the real thing by accident.
 */

const QUIET = ["none", "not_yet", "on_track", "in_character", "covered", "harmless", "here", "no"];

export interface FakeOpenRouter {
  /** What was asked of it, by endpoint, in order. */
  asked: string[];
  /** What was sent, in order (the requests' bodies). */
  sent: Request[];
  /** Put the real fetch back. */
  restore(): void;
}

/** `odds`: how sure the decider is of a question's choice (0.97 otherwise), the rest shared among the others. */
export function fakeOpenRouter(options: { replies?: string[]; byName?: Record<string, unknown>; choices?: Record<string, string>; odds?: Record<string, number>; suggestions?: string | string[]; stall?: string[]; capped?: Record<string, number>; phased?: string[] } = {}): FakeOpenRouter {
  const real = globalThis.fetch;
  const replies = options.replies ?? ["The GM nods. “Go on.”"];
  const suggestions = [options.suggestions ?? ""].flat();
  let next = 0, suggested = 0;
  const asked: string[] = [];
  const sent: Request[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = (init?.body ? JSON.parse(String(init.body)) : {}) as Request;
    asked.push(new URL(url).pathname);
    sent.push(body);
    if (url === "https://openrouter.ai/api/alpha/decisions") return json({ answers: answer(body.questions ?? {}, options.choices, options.odds), usage: { cost: 0.0001 } });
    if (url !== "https://openrouter.ai/api/v1/responses") return json({ error: { message: `the fake OpenRouter doesn't answer ${url}` } }, 404);
    const format = body.text?.format;
    if (format && options.stall?.includes(format.name)) return stalled(init?.signal);
    if (format && options.capped?.[format.name] !== undefined) return capped(options.capped[format.name]!);
    const text = format?.type === "json_schema" ? JSON.stringify(options.byName?.[format.name] ?? fit(format.schema))
      : body.instructions?.startsWith("You suggest what the player might") ? suggestions[suggested++ % suggestions.length]!
      : replies[next++ % replies.length]!;
    if (format && options.phased?.includes(format.name)) return phased(`${text.slice(0, 40)}"} \n\n the response is not valid json`, text);
    return body.stream ? sse(text) : json(completed(text));
  };
  return { asked, sent, restore: () => { globalThis.fetch = real; } };
}

export interface Request {
  questions?: Record<string, { criteria: Record<string, string> }>;
  text?: { format?: { type: string; name: string; schema: Schema } };
  instructions?: string;
  stream?: boolean;
  max_output_tokens?: number;
  input?: Array<{ role: string; content: string }>;
}

/** A call that never answers: it fails only when the caller gives up on it (its signal). */
function stalled(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    const give = () => reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    if (signal?.aborted) give();
    else signal?.addEventListener("abort", give, { once: true });
  });
}

/** A reply that ran to its token cap: junk, then incomplete, billed all the same. */
function capped(cost: number): Response {
  const response = { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "message", content: [{ type: "output_text", text: "{\"act\":\"..." }] }], usage: { input_tokens: 12000, output_tokens: 1000, cost } };
  const events = [{ type: "response.output_text.delta", delta: "{\"act\":\"..." }, { type: "response.incomplete", response }];
  return new Response(`${events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
}
interface Schema { type?: string | string[]; enum?: unknown[]; const?: unknown; properties?: Record<string, Schema>; required?: string[]; anyOf?: Schema[] }

function answer(questions: NonNullable<Request["questions"]>, choices: Record<string, string> = {}, odds: Record<string, number> = {}): Record<string, { choice: string; probabilities: Record<string, number>; confidence: number }> {
  return Object.fromEntries(Object.entries(questions).map(([id, q]) => {
    const keys = Object.keys(q.criteria);
    const choice = choices[id] && keys.includes(choices[id]) ? choices[id] : QUIET.find(k => keys.includes(k)) ?? keys[0]!;
    const sure = odds[id] ?? 0.97;
    const probabilities = Object.fromEntries(keys.map(k => [k, k === choice ? sure : (1 - sure) / Math.max(1, keys.length - 1)]));
    return [id, { choice, probabilities, confidence: 0.95 }];
  }));
}

/** The least JSON that fits a schema: each required field, empty. */
function fit(schema: Schema): unknown {
  if (schema.enum) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  if (schema.anyOf) return fit(schema.anyOf[0]!);
  const type = Array.isArray(schema.type) ? schema.type.find(t => t !== "null") ?? schema.type[0] : schema.type;
  switch (type) {
    case "object": return Object.fromEntries((schema.required ?? Object.keys(schema.properties ?? {})).map(k => [k, fit(schema.properties?.[k] ?? {})]));
    case "array": return [];
    case "string": return "";
    case "integer": case "number": return 0;
    case "boolean": return false;
    default: return null;
  }
}

const completed = (text: string) => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 120, output_tokens: 30, cost: 0.0002 } });

/** A reply in two phases: junk as commentary, then the answer as the final answer, both streamed. */
function phased(junk: string, text: string): Response {
  const response = { status: "completed", output: [
    { type: "message", phase: "commentary", content: [{ type: "output_text", text: junk }] },
    { type: "message", phase: "final_answer", content: [{ type: "output_text", text }] },
  ], usage: { input_tokens: 120, output_tokens: 60, cost: 0.0003 } };
  const events = [{ type: "response.output_text.delta", delta: junk }, { type: "response.output_text.delta", delta: text }, { type: "response.completed", response }];
  return new Response(`${events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function sse(text: string): Response {
  const events = [{ type: "response.output_text.delta", delta: text }, { type: "response.completed", response: completed(text) }];
  return new Response(`${events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
