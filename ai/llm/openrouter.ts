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
  /** Whose call this is, when it's kept apart from the process's other calls (the AI service's requests). */
  calls?: CallContext;
  /**
   * What's there will do: a reply that runs out of tokens is taken as far as it got, and one in two
   * phases is taken by its final answer, rather than asked for again (a list read a line at a time,
   * whose good lines come first: the suggested lines).
   */
  asFarAsItGot?: boolean;
}

export interface RespondResult {
  text: string;
  costUsd: number;
  latencyMs: number;
  firstTextMs: number | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Out of tokens, and taken as far as it got (asFarAsItGot): its last line may be cut off. */
  cutShort?: boolean;
}

/**
 * One request's model calls, kept apart from every other request's: how they go out, the key they
 * carry, where each is logged and what it cost. The AI service makes one per request, since it plays
 * many games in one process and the call log, the spend and the ledger are otherwise the process's.
 * Each part, when given, replaces the process's own (and touches no module state); without a context
 * a call goes as it always has: the global fetch, apiKey(), logCall and recordCost.
 */
export interface CallContext {
  /** OpenRouter, or a stand-in for it (fakeFetch). */
  fetch?: typeof fetch;
  apiKey?: string;
  /** Each call as it starts (`started`), then in full with its answer, retry or failure: the game's call log. */
  log?(entry: Record<string, unknown>): void;
  /** What each call cost: the request's usage, and the ledger. */
  cost?(line: { provider: string; operation: string; model: string; costUsd: number; latencyMs: number }): void;
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

/**
 * No model to be had: no key, or one that isn't an OpenRouter key at all (the offline runs' "offline",
 * the web server's --offline). Whatever would ask a model can say so at once rather than wait on a
 * refusal (a key OpenRouter turns down still has to be asked to find out).
 */
export function modelOffline(): boolean {
  try { return !/^sk-or-/.test(apiKey()); } catch { return true; }
}

/** The process's environment, or none where there's no process (a browser's worker, which only ever calls with a context). */
const env = (): Record<string, string | undefined> => globalThis.process?.env ?? {};

let logFile: string | undefined = env().KM_CALL_LOG;
/** Point model-call logging at a JSONL file (per session or eval run). */
export function setCallLog(path: string | undefined): void {
  logFile = path;
  if (path) mkdirSync(dirname(path), { recursive: true });
}

const ledger = env().KM_COST_LEDGER ?? "runs/cost-ledger.jsonl";
/** The cost ledger: every call's cost, across games and evals (a report keeps its game's lines). */
export const costLedger = () => ledger;
let spent = 0;
export const sessionSpend = () => spent;

/** The game a call log is a session's (runs/sessions/<id>/calls.jsonl): its ledger lines name it. */
const sessionOfLog = (path: string | undefined) => (path ? /(?:^|[\\/])sessions[\\/]([^\\/]+)[\\/]calls\.jsonl$/.exec(path)?.[1] : undefined);

/** A call, a retry or a failure in the call log: the request's own (`calls`), or the process's. */
export function logCall(entry: Record<string, unknown>, calls?: CallContext): void {
  if (calls?.log) return calls.log(entry);
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n";
  if (logFile) appendFileSync(logFile, line);
}

/** What a call cost: to the request's own count (`calls`), or the process's spend and the cost ledger. */
export function recordCost(provider: string, operation: string, model: string, costUsd: number, latencyMs: number, calls?: CallContext): void {
  if (calls?.cost) return calls.cost({ provider, operation, model, costUsd, latencyMs });
  spent += costUsd;
  const session = sessionOfLog(logFile);
  try {
    mkdirSync(dirname(ledger), { recursive: true });
    appendFileSync(ledger, JSON.stringify({ at: new Date().toISOString(), provider, operation, model, costUsd, latencyMs, ...(session ? { session } : {}) }) + "\n");
  } catch { /* the ledger is best effort */ }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * OpenRouter turned the call's key down (HTTP 401): asking again won't mend it, so nothing does. The
 * AI service tells the player so (key_refused), rather than failing the turn as the model's.
 */
export class KeyRefused extends Error {}

export async function fetchWithRetry(url: string, init: RequestInit, label: string, calls?: CallContext): Promise<Response> {
  const send = calls?.fetch ?? fetch;
  // A request's own log hears a call as it goes out too, so a call cut off (its process killed) is still counted.
  calls?.log?.({ operation: label, started: new URL(url).pathname });
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await send(url, init);
    } catch (error) {
      if (attempt >= 4 || init.signal?.aborted) throw error;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await response.body?.cancel();
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * 2 ** attempt;
      // Retries are routine: logged with the calls, never printed into play.
      logCall({ operation: label, retry: attempt + 1, status: response.status, delayMs: delay }, calls);
      if (env().KM_DEBUG) globalThis.process?.stderr?.write(`[${label}] HTTP ${response.status}, retrying in ${Math.round(delay / 1000)}s\n`);
      await sleep(delay);
      continue;
    }
    if (response.status === 401) throw await keyRefused(response, label, calls);
    return response;
  }
}

/** A 401 as the call's error, and in the call log as any failed call is. */
async function keyRefused(response: Response, label: string, calls?: CallContext): Promise<KeyRefused> {
  const detail = (await response.text()).slice(0, 400);
  logCall({ operation: label, status: 401, error: `HTTP 401: ${detail}` }, calls);
  return new KeyRefused(`OpenRouter ${label} HTTP 401: ${detail}`);
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

/** A text, as JSON once any fence is taken off (the way respondJson reads it). */
const unfenced = (text: string) => text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1");

/**
 * What calls that failed had already cost, carried on the error they ended in: a reply that ran to
 * its token cap is billed all the same, and the turn that made it counts it.
 */
export function costOf(error: unknown): number {
  const cost = (error as { costUsd?: unknown } | undefined)?.costUsd;
  return typeof cost === "number" ? cost : 0;
}

function costing(error: unknown, costUsd: number): Error {
  const e = error instanceof Error ? error : new Error(String(error));
  if (costUsd > 0) Object.assign(e, { costUsd: costOf(e) + costUsd });
  return e;
}

/** The one retry after a try that failed, with what that try cost in its result (or its error). */
async function retried(request: RespondRequest, spent: number): Promise<RespondResult> {
  try {
    const result = await respond({ ...request, noPhaseRetry: true });
    return spent ? { ...result, costUsd: result.costUsd + spent } : result;
  } catch (error) {
    throw costing(error, spent);
  }
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
    headers: { Authorization: `Bearer ${request.calls?.apiKey ?? apiKey()}`, "Content-Type": "application/json", "X-Title": "Kingmaker V2 PoC" },
    body: JSON.stringify(body),
    signal: request.signal ?? AbortSignal.timeout(180_000),
  }, request.operation, request.calls);
  if (!response.ok) {
    const detail = await response.text();
    logCall({ provider: "openrouter", operation: request.operation, model, request: body, error: `HTTP ${response.status}: ${detail.slice(0, 800)}` }, request.calls);
    // Moderation occasionally flags harmless fantasy violence; one retry usually clears it.
    if (/flagged|moderation/i.test(detail) && !request.noPhaseRetry) return respond({ ...request, noPhaseRetry: true });
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
      const spent = event.response?.usage?.cost ?? 0;
      logCall({ provider: "openrouter", operation: request.operation, model, request: body, error: message, ...(spent ? { costUsd: spent } : {}) }, request.calls);
      if (spent) recordCost("openrouter", request.operation, model, spent, performance.now() - started, request.calls);
      if (!request.noPhaseRetry) return retried(request, spent);
      throw costing(new Error(`OpenRouter ${request.operation} failed: ${message}`), spent);
    }
  }
  const latencyMs = performance.now() - started;
  if (!final) {
    if (!request.noPhaseRetry) {
      logCall({ provider: "openrouter", operation: request.operation, model, warning: "stream ended early, retrying" }, request.calls);
      return respond({ ...request, noPhaseRetry: true });
    }
    throw new Error(`OpenRouter ${request.operation}: stream ended without a final response`);
  }
  // Out of tokens, a reply taken as far as it got (asFarAsItGot) is the text streamed so far.
  const cutShort = final.status === "incomplete" && final.incomplete_details?.reason === "max_output_tokens" && request.asFarAsItGot === true && !!streamed.trim();
  if (final.status !== "completed" && !cutShort) {
    // Billed all the same (a reply that ran to its token cap is a long one): in the ledger, and the caller's count.
    const spent = final.usage?.cost ?? 0;
    logCall({ provider: "openrouter", operation: request.operation, model, request: body, error: `status ${final.status}`, details: final.incomplete_details, partial: streamed.slice(0, 4000), usage: final.usage, latencyMs: Math.round(latencyMs), costUsd: spent }, request.calls);
    recordCost("openrouter", request.operation, model, spent, latencyMs, request.calls);
    if (!request.noPhaseRetry) return retried(request, spent);
    throw costing(new Error(`OpenRouter ${request.operation}: response ${final.status} (${final.incomplete_details?.reason ?? "unknown"})`), spent);
  }
  const phases = (final.output ?? []).filter(item => item.type === "message").map(item => item.phase ?? "none");
  // Luna without reasoning occasionally splits a reply into a "commentary" message plus a
  // final_answer that critiques it. Neither is reliable, so try once more. (A caller with a deadline
  // could take a usable final answer instead, finalAnswer: the GM's review on a considered turn,
  // which went with the old pipeline.)
  if (phases.length > 1 && !request.noPhaseRetry && !request.asFarAsItGot) {
    logCall({ provider: "openrouter", operation: request.operation, model, warning: "multi-phase output, retrying", phases, output: final.output }, request.calls);
    recordCost("openrouter", request.operation, model, final.usage?.cost ?? 0, latencyMs, request.calls);
    return retried(request, final.usage?.cost ?? 0);
  }
  const text = cutShort ? streamed : finalText(final) || streamed;
  const usage = final.usage ?? {};
  const result: RespondResult = {
    text,
    costUsd: usage.cost ?? 0,
    latencyMs,
    firstTextMs,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
    ...(cutShort ? { cutShort } : {}),
  };
  recordCost("openrouter", request.operation, model, result.costUsd, latencyMs, request.calls);
  logCall({ provider: "openrouter", operation: request.operation, model, effort: body.reasoning.effort, request: { instructions: request.instructions, input: request.input, json: request.json?.name },
    text, latencyMs: Math.round(latencyMs), firstTextMs: firstTextMs && Math.round(firstTextMs), costUsd: result.costUsd,
    tokens: { in: result.inputTokens, out: result.outputTokens, reasoning: result.reasoningTokens },
    ...(cutShort ? { note: "out of tokens: taken as far as it got" } : phases.length > 1 ? { note: "in two phases: taken by its final answer" } : {}) }, request.calls);
  return result;
}

/**
 * A structured model call, as respondJson makes one, or a stand-in for one: what character creation
 * asks of the model goes through one of these, so the checks can answer for it.
 */
export type Ask = <T>(request: RespondRequest & { json: { name: string; schema: Record<string, unknown> } }) => Promise<T>;

/** JSON-schema structured output; parses and returns the object. */
export async function respondJson<T>(request: RespondRequest & { json: { name: string; schema: Record<string, unknown> } }): Promise<T & { _meta: RespondResult }> {
  const result = await respond(request);
  const source = unfenced(result.text);
  let value: T;
  try { value = JSON.parse(source) as T; }
  catch { throw new Error(`${request.operation} returned unreadable JSON: ${source.slice(0, 300)}`); }
  return Object.assign(value as object, { _meta: result }) as T & { _meta: RespondResult };
}
