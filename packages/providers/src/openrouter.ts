import { logDecision } from "./decision-logging.js";
import { recoverRateLimit } from "./rate-limit.js";

export type OpenRouterRole = "system" | "user" | "assistant" | "tool";

export interface OpenRouterToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenRouterMessage {
  role: OpenRouterRole;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenRouterToolCall[];
  /** Responses output items preserve tool-call and encrypted reasoning continuity. */
  responseItems?: Record<string, unknown>[];
}

export interface OpenRouterTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  model: string;
  api?: "responses";
  reasoning?: { effort: "none" | "low" | "medium" | "high" };
  messages: readonly OpenRouterMessage[];
  tools?: readonly OpenRouterTool[];
  response_format?: Record<string, unknown>;
  temperature?: number;
  max_tokens?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: OpenRouterMessage }>;
  error?: { message?: string };
}

export class ProviderResponseError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

export class OpenRouterClient {
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs = 60_000,
    private readonly httpReferer = "http://localhost:4317",
    private readonly onWarning: (message: string) => void = () => {},
  ) {}

  async complete(request: ChatCompletionRequest, signal?: AbortSignal): Promise<OpenRouterMessage> {
    return logDecision(request.api === "responses" ? "openrouter.responses" : "openrouter.chat", request, this.apiKey,
      () => this.#complete(request, signal));
  }

  async #complete(request: ChatCompletionRequest, signal?: AbortSignal): Promise<OpenRouterMessage> {
    let combined: AbortSignal;
    const useResponses = request.api === "responses";
    const response = await recoverRateLimit(() => {
      const timeout = AbortSignal.timeout(this.timeoutMs);
      combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      return fetch(useResponses ? "https://openrouter.ai/api/v1/responses" : "https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": this.httpReferer,
        "X-Title": "Kingmaker",
      },
      body: JSON.stringify(useResponses ? responsesRequest(request) : request),
      signal: combined,
      });
    }, signal, (delay, retry) => this.onWarning(`OpenRouter rate limit (429), ${request.model}: retry ${retry}/5 in ${Math.ceil(delay / 1000)}s. This request will resume automatically.`));
    let body: ChatCompletionResponse & ResponsesResult;
    try { body = await response.json() as ChatCompletionResponse & ResponsesResult; }
    catch (error) {
      if (combined!.aborted) throw error;
      throw new ProviderResponseError(`OpenRouter returned an unreadable response (HTTP ${response.status}). Please try again.`, response.ok || [502, 503, 504].includes(response.status));
    }
    if (!response.ok) {
      const detail = typeof body?.error?.message === "string" ? body.error.message : "The request failed.";
      throw new ProviderResponseError(`OpenRouter returned HTTP ${response.status}: ${detail}`, [502, 503, 504].includes(response.status));
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ProviderResponseError("OpenRouter returned an invalid response. Please try again.", true);
    if (useResponses) return responsesMessage(body);
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error("OpenRouter returned no assistant message");
    return message;
  }
}

interface ResponsesResult {
  status?: string;
  incomplete_details?: { reason?: string };
  output?: Array<Record<string, unknown>>;
}

function responsesRequest(request: ChatCompletionRequest) {
  const input: Record<string, unknown>[] = [];
  for (const message of request.messages) {
    if (message.role === "assistant" && message.responseItems?.length) {
      input.push(...message.responseItems);
      continue;
    }
    if (message.role === "tool") {
      input.push({ type: "function_call_output", call_id: message.tool_call_id, output: message.content ?? "" });
      continue;
    }
    if (message.content) input.push({ role: message.role, content: message.content });
    for (const call of message.tool_calls ?? []) input.push({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments });
  }
  const format = request.response_format;
  return {
    model: request.model, input, store: false, include: ["reasoning.encrypted_content"],
    ...(request.reasoning ? { reasoning: request.reasoning } : {}),
    ...(request.max_tokens === undefined ? {} : { max_output_tokens: request.max_tokens }),
    ...(request.tools ? { tools: request.tools.map(tool => ({ type: tool.type, ...tool.function, strict: false })) } : {}),
    ...(format ? { text: { format: format.type === "json_schema" ? { type: "json_schema", ...format.json_schema as Record<string, unknown> } : format } } : {}),
  };
}

function responsesMessage(body: ResponsesResult): OpenRouterMessage {
  if (body.status !== "completed") throw new Error(`OpenRouter response ${body.status ?? "missing status"}: ${body.incomplete_details?.reason ?? "did not complete"}`);
  const output = body.output ?? [];
  const text: string[] = [], calls: OpenRouterToolCall[] = [];
  for (const item of output) {
    if (item.type === "message" && Array.isArray(item.content)) for (const part of item.content as Array<{ type: string; text?: string; refusal?: string }>) {
      if (part.type === "refusal") throw new Error(part.refusal || "Model refused this request.");
      if (part.type === "output_text" && part.text) text.push(part.text);
    }
    if (item.type === "function_call") {
      if (typeof item.call_id !== "string" || typeof item.name !== "string" || typeof item.arguments !== "string") throw new Error("OpenRouter returned a malformed tool call.");
      calls.push({ id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments } });
    }
  }
  if (!text.length && !calls.length) throw new Error("OpenRouter returned no assistant message");
  return { role: "assistant", content: text.join("\n") || null, responseItems: output, ...(calls.length ? { tool_calls: calls } : {}) };
}
