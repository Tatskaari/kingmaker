/**
 * A stand-in for OpenRouter, for tests that play real turns with no network (src/report/report.test.ts):
 * the game's own calls, through its own code, answered here.
 *
 * - The Decisions API (the decider, disclosure): every question gets its quietest choice (none,
 *   not_yet, on_track, in_character...), or its first; or the choice `choices` names for it.
 * - The Responses API: JSON made to fit the schema asked for (the stage manager's operations, the
 *   quick co-GM), or one of `byName`'s by the schema's name; otherwise the GM's next line from
 *   `replies`, streamed as OpenRouter streams it.
 *
 * Anything else asked of it is refused, so a test can't reach the real thing by accident.
 */

const QUIET = ["none", "not_yet", "on_track", "in_character", "covered", "harmless", "here", "no"];

export interface FakeOpenRouter {
  /** What was asked of it, by endpoint, in order. */
  asked: string[];
  /** Put the real fetch back. */
  restore(): void;
}

export function fakeOpenRouter(options: { replies?: string[]; byName?: Record<string, unknown>; choices?: Record<string, string> } = {}): FakeOpenRouter {
  const real = globalThis.fetch;
  const replies = options.replies ?? ["The GM nods. “Go on.”"];
  let next = 0;
  const asked: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = (init?.body ? JSON.parse(String(init.body)) : {}) as Request;
    asked.push(new URL(url).pathname);
    if (url === "https://openrouter.ai/api/alpha/decisions") return json({ answers: answer(body.questions ?? {}, options.choices), usage: { cost: 0.0001 } });
    if (url !== "https://openrouter.ai/api/v1/responses") return json({ error: { message: `the fake OpenRouter doesn't answer ${url}` } }, 404);
    const format = body.text?.format;
    const text = format?.type === "json_schema" ? JSON.stringify(options.byName?.[format.name] ?? fit(format.schema)) : replies[next++ % replies.length]!;
    return body.stream ? sse(text) : json(completed(text));
  };
  return { asked, restore: () => { globalThis.fetch = real; } };
}

interface Request {
  questions?: Record<string, { criteria: Record<string, string> }>;
  text?: { format?: { type: string; name: string; schema: Schema } };
  stream?: boolean;
}
interface Schema { type?: string | string[]; enum?: unknown[]; const?: unknown; properties?: Record<string, Schema>; required?: string[]; anyOf?: Schema[] }

function answer(questions: NonNullable<Request["questions"]>, choices: Record<string, string> = {}): Record<string, { choice: string; probabilities: Record<string, number>; confidence: number }> {
  return Object.fromEntries(Object.entries(questions).map(([id, q]) => {
    const keys = Object.keys(q.criteria);
    const choice = choices[id] && keys.includes(choices[id]) ? choices[id] : QUIET.find(k => keys.includes(k)) ?? keys[0]!;
    const probabilities = Object.fromEntries(keys.map(k => [k, k === choice ? 0.97 : 0.03 / Math.max(1, keys.length - 1)]));
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

function sse(text: string): Response {
  const events = [{ type: "response.output_text.delta", delta: text }, { type: "response.completed", response: completed(text) }];
  return new Response(`${events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
