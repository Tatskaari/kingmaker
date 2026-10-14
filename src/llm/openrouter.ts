import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Every model call in the PoC goes through here so latency and cost are always visible. */

export type Effort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
export interface Message { role: "system" | "user" | "assistant" | "developer"; content: string }

export interface RespondRequest {
  model?: string;
  /** System-level framing; sent as Responses `instructions`. */
  instructions?: string;
  input: Message[];
  effort?: Effort;
  maxOutputTokens?: number;
  /** Ask for JSON matching this schema (strict). */
  json?: { name: string; schema: Record<string, unknown> };
  /** Called with the accumulated visible text as it streams. */
  onText?: (text: string) => void;
  /** Short label for logs, e.g. "gm.turn" or "repair". */
  operation: string;
  signal?: AbortSignal;
  /** Internal: set on the single retry after a multi-phase reply. */
  noPhaseRetry?: boolean;
}

export interface RespondResult {
  text: string;
  costUsd: number;
  latencyMs: number;
  firstTextMs: number | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export const LUNA = "openai/gpt-6-luna";
export const SOL = "openai/gpt-6-sol";

/** OPENROUTER_API_KEY, falling back to the dev key file so detached/background runs still work. */
export function apiKey(): string {
  let key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    try { key = readFileSync(join(homedir(), "secrets", "kingmaker-dev-openrouter.txt"), "utf8").trim(); } catch { /* fall through */ }
    if (key) process.env.OPENROUTER_API_KEY = key;
  }
  if (!key) throw new Error("OPENROUTER_API_KEY is not set (and ~/secrets/kingmaker-dev-openrouter.txt is missing)");
  return key;
}

let logFile: string | undefined = process.env.KM_CALL_LOG;
/** Point model-call logging at a JSONL file (per session or eval run). */
export function setCallLog(path: string | undefined): void {
  logFile = path;
  if (path) mkdirSync(dirname(path), { recursive: true });
}

const ledger = process.env.KM_COST_LEDGER ?? "runs/cost-ledger.jsonl";
let spent = 0;
export const sessionSpend = () => spent;

export function logCall(entry: Record<string, unknown>): void {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n";
  if (logFile) appendFileSync(logFile, line);
}

export function recordCost(provider: string, operation: string, model: string, costUsd: number, latencyMs: number): void {
  spent += costUsd;
  try {
    mkdirSync(dirname(ledger), { recursive: true });
    appendFileSync(ledger, JSON.stringify({ at: new Date().toISOString(), provider, operation, model, costUsd, latencyMs }) + "\n");
  } catch { /* the ledger is best effort */ }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function fetchWithRetry(url: string, init: RequestInit, label: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (attempt >= 4 || init.signal?.aborted) throw error;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await response.body?.cancel();
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * 2 ** attempt;
      process.stderr.write(`[${label}] HTTP ${response.status}, retrying in ${Math.round(delay / 1000)}s\n`);
      await sleep(delay);
      continue;
    }
    return response;
  }
}

async function* sse(response: Response): AsyncGenerator<string> {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let index: number;
    while ((index = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
      if (data) yield data;
    }
  }
}

interface OutputItem { type?: string; phase?: string | null; content?: Array<{ type: string; text?: string; refusal?: string }> }
interface ResponseBody {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: OutputItem[];
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number; output_tokens_details?: { reasoning_tokens?: number } };
  error?: { message?: string } | null;
}

function finalText(body: ResponseBody): string {
  const output = body.output ?? [];
  const hasFinal = output.some(item => item.type === "message" && item.phase === "final_answer");
  const parts: string[] = [];
  for (const item of output) {
    if (item.type !== "message") continue;
    if (hasFinal ? item.phase !== "final_answer" : item.phase != null) continue;
    for (const part of item.content ?? []) {
      if (part.type === "refusal") throw new Error(`Model refused: ${part.refusal}`);
      if (part.type === "output_text" && part.text) parts.push(part.text);
    }
  }
  return parts.join("\n");
}

/** OpenRouter Responses API with streaming; returns the final visible text. */
export async function respond(request: RespondRequest): Promise<RespondResult> {
  const model = request.model ?? LUNA;
  const body = {
    model,
    ...(request.instructions ? { instructions: request.instructions } : {}),
    input: request.input.map(message => ({ role: message.role, content: message.content })),
    reasoning: { effort: request.effort ?? "none" },
    store: false,
    stream: true,
    ...(request.maxOutputTokens ? { max_output_tokens: request.maxOutputTokens } : {}),
    ...(request.json ? { text: { format: { type: "json_schema", name: request.json.name, schema: request.json.schema, strict: true } } } : {}),
  };
  const started = performance.now();
  let firstTextMs: number | null = null;
  const response = await fetchWithRetry("https://openrouter.ai/api/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json", "X-Title": "Kingmaker V2 PoC" },
    body: JSON.stringify(body),
    signal: request.signal ?? AbortSignal.timeout(180_000),
  }, request.operation);
  if (!response.ok) {
    const detail = await response.text();
    logCall({ provider: "openrouter", operation: request.operation, model, request: body, error: `HTTP ${response.status}: ${detail.slice(0, 800)}` });
    throw new Error(`OpenRouter ${request.operation} HTTP ${response.status}: ${detail.slice(0, 400)}`);
  }
  let streamed = "";
  let final: ResponseBody | undefined;
  for await (const data of sse(response)) {
    if (data === "[DONE]") break;
    let event: { type?: string; delta?: string; response?: ResponseBody; error?: { message?: string } };
    try { event = JSON.parse(data); } catch { continue; }
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      if (firstTextMs === null) firstTextMs = performance.now() - started;
      streamed += event.delta;
      request.onText?.(streamed);
    } else if (event.type === "response.completed" || event.type === "response.incomplete") {
      final = event.response;
    } else if (event.type === "response.failed" || event.type === "error") {
      const message = event.error?.message ?? event.response?.error?.message ?? "generation failed";
      logCall({ provider: "openrouter", operation: request.operation, model, request: body, error: message });
      if (!request.noPhaseRetry) return respond({ ...request, noPhaseRetry: true });
      throw new Error(`OpenRouter ${request.operation} failed: ${message}`);
    }
  }
  const latencyMs = performance.now() - started;
  if (!final) {
    if (!request.noPhaseRetry) {
      logCall({ provider: "openrouter", operation: request.operation, model, warning: "stream ended early, retrying" });
      return respond({ ...request, noPhaseRetry: true });
    }
    throw new Error(`OpenRouter ${request.operation}: stream ended without a final response`);
  }
  if (final.status !== "completed") {
    logCall({ provider: "openrouter", operation: request.operation, model, request: body, error: `status ${final.status}`, details: final.incomplete_details });
    throw new Error(`OpenRouter ${request.operation}: response ${final.status} (${final.incomplete_details?.reason ?? "unknown"})`);
  }
  const phases = (final.output ?? []).filter(item => item.type === "message").map(item => item.phase ?? "none");
  // Luna without reasoning occasionally splits a reply into a "commentary" message plus a
  // final_answer that critiques it. Neither is reliable, so try once more.
  if (phases.length > 1 && !request.noPhaseRetry) {
    logCall({ provider: "openrouter", operation: request.operation, model, warning: "multi-phase output, retrying", phases, output: final.output });
    recordCost("openrouter", request.operation, model, final.usage?.cost ?? 0, latencyMs);
    return respond({ ...request, noPhaseRetry: true });
  }
  const text = finalText(final) || streamed;
  const usage = final.usage ?? {};
  const result: RespondResult = {
    text,
    costUsd: usage.cost ?? 0,
    latencyMs,
    firstTextMs,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
  };
  recordCost("openrouter", request.operation, model, result.costUsd, latencyMs);
  logCall({ provider: "openrouter", operation: request.operation, model, effort: body.reasoning.effort, request: { instructions: request.instructions, input: request.input, json: request.json?.name },
    text, latencyMs: Math.round(latencyMs), firstTextMs: firstTextMs && Math.round(firstTextMs), costUsd: result.costUsd,
    tokens: { in: result.inputTokens, out: result.outputTokens, reasoning: result.reasoningTokens } });
  return result;
}

/** JSON-schema structured output; parses and returns the object. */
export async function respondJson<T>(request: RespondRequest & { json: { name: string; schema: Record<string, unknown> } }): Promise<T & { _meta: RespondResult }> {
  const result = await respond(request);
  const source = result.text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1");
  let value: T;
  try { value = JSON.parse(source) as T; }
  catch { throw new Error(`${request.operation} returned unreadable JSON: ${source.slice(0, 300)}`); }
  return Object.assign(value as object, { _meta: result }) as T & { _meta: RespondResult };
}
