import { logDecision } from "./decision-logging.js";
import { recoverRateLimit } from "./rate-limit.js";
import { serverSentData } from "./sse.js";

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

  async complete(request: ChatCompletionRequest, signal?: AbortSignal, operation = "chat completion"): Promise<OpenRouterMessage> {
    return logDecision(request.api === "responses" ? "openrouter.responses" : "openrouter.chat", request, this.apiKey,
      () => this.#complete(request, signal), operation);
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
      body: JSON.stringify({ ...(useResponses ? responsesRequest(request) : request), stream: true }),
      signal: combined,
      });
    }, signal, (delay, retry) => this.onWarning(`OpenRouter rate limit (429), ${request.model}: retry ${retry}/5 in ${Math.ceil(delay / 1000)}s. This request will resume automatically.`));
    let body: ChatCompletionResponse & ResponsesResult;
    try {
      body = response.ok && response.headers.get("content-type")?.includes("text/event-stream")
        ? await streamedResponse(response, useResponses, combined!)
        : await response.json() as ChatCompletionResponse & ResponsesResult;
    }
    catch (error) {
      if (combined!.aborted || error instanceof ProviderResponseError || error instanceof OutputTokenLimitError) throw error;
      throw new ProviderResponseError(`OpenRouter returned an unreadable response (HTTP ${response.status}). Please try again.`, response.ok || [502, 503, 504].includes(response.status));
    }
    if (!response.ok) {
      const detail = typeof body?.error?.message === "string" ? body.error.message : "The request failed.";
      throw new ProviderResponseError(`OpenRouter returned HTTP ${response.status}: ${detail}`, [502, 503, 504].includes(response.status));
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ProviderResponseError("OpenRouter returned an invalid response. Please try again.", true);
    if (useResponses) return responsesMessage(body);
    const message = body.choices?.[0]?.message;
    if (!message) throw new ProviderResponseError("OpenRouter returned no assistant message", true);
    return message;
  }
}

export class OutputTokenLimitError extends Error {
  constructor() { super("OpenRouter response incomplete: max_output_tokens"); }
}

interface ResponsesResult {
  status?: string;
  incomplete_details?: { reason?: string };
  output?: Array<Record<string, unknown>>;
}

interface StreamEvent {
  type?: string;
  error?: { message?: string; code?: string | number };
  message?: string;
  response?: ResponsesResult & { error?: { message?: string } };
  choices?: Array<{
    index?: number;
    finish_reason?: string | null;
    delta?: { content?: string | null; tool_calls?: Array<{
      index: number; id?: string; type?: string;
      function?: { name?: string; arguments?: string };
    }> };
  }>;
}

/** Buffer structured output until the protocol confirms it is complete. */
async function streamedResponse(response: Response, useResponses: boolean, signal: AbortSignal): Promise<ChatCompletionResponse & ResponsesResult> {
  let content = "", finished = false;
  const calls = new Map<number, OpenRouterToolCall>();
  for await (const data of serverSentData(response, signal)) {
    if (data === "[DONE]") {
      if (useResponses || !finished) break;
      const tool_calls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
      if (tool_calls.some(call => !call.id || !call.function.name || !call.function.arguments)) {
        throw new ProviderResponseError("OpenRouter returned a malformed streamed tool call.", true);
      }
      if (!content && !tool_calls.length) throw new ProviderResponseError("OpenRouter returned no assistant message", true);
      return { choices: [{ message: { role: "assistant", content: content || null, ...(tool_calls.length ? { tool_calls } : {}) } }] };
    }
    const event = JSON.parse(data) as StreamEvent;
    if (!event || typeof event !== "object") throw new ProviderResponseError("OpenRouter returned an invalid stream event.", true);
    if (event.error || event.type === "error" || event.type === "response.failed") {
      const detail = event.error?.message ?? event.response?.error?.message ?? event.message ?? "Generation failed.";
      const code = Number(event.error?.code);
      throw new ProviderResponseError(`OpenRouter stream failed: ${detail}`, ![400, 401, 402, 403, 404, 422].includes(code));
    }
    if (useResponses) {
      if (event.type === "response.completed" || event.type === "response.incomplete") {
        if (!event.response) throw new ProviderResponseError("OpenRouter stream omitted its final response.", true);
        // The terminal snapshot preserves phases, full tool arguments and encrypted reasoning.
        return event.response;
      }
      continue;
    }
    const choice = event.choices?.find(choice => choice.index === 0 || choice.index === undefined);
    if (!choice) continue; // Accounting frames may contain no choices.
    if (choice.finish_reason === "length") throw new OutputTokenLimitError();
    if (choice.finish_reason === "error") throw new ProviderResponseError("OpenRouter stream failed.", true);
    if (choice.finish_reason === "content_filter") throw new ProviderResponseError("OpenRouter response was blocked by a content filter.", false);
    if (choice.finish_reason) finished = true;
    content += choice.delta?.content ?? "";
    for (const delta of choice.delta?.tool_calls ?? []) {
      if (!Number.isInteger(delta.index) || delta.index < 0 || (delta.type && delta.type !== "function")) {
        throw new ProviderResponseError("OpenRouter returned a malformed streamed tool call.", true);
      }
      const call = calls.get(delta.index) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
      call.id += delta.id ?? "";
      call.function.name += delta.function?.name ?? "";
      call.function.arguments += delta.function?.arguments ?? "";
      calls.set(delta.index, call);
    }
  }
  throw new ProviderResponseError("OpenRouter stream ended before completion. Please try again.", true);
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
  if (body.status === "incomplete" && body.incomplete_details?.reason === "max_output_tokens") throw new OutputTokenLimitError();
  if (body.status !== "completed") throw new Error(`OpenRouter response ${body.status ?? "missing status"}: ${body.incomplete_details?.reason ?? "did not complete"}`);
  const output = body.output ?? [];
  const text: string[] = [], calls: OpenRouterToolCall[] = [];
  const hasFinalAnswer = output.some(item => item.type === "message" && item.phase === "final_answer");
  for (const item of output) {
    // Commentary is a separate phase, not part of the answer (or its JSON).
    // Keep raw items below for debugging and multi-turn protocol continuity.
    const isAnswer = hasFinalAnswer ? item.phase === "final_answer" : item.phase == null;
    if (item.type === "message" && isAnswer && Array.isArray(item.content)) for (const part of item.content as Array<{ type: string; text?: string; refusal?: string }>) {
      if (part.type === "refusal") throw new Error(part.refusal || "Model refused this request.");
      if (part.type === "output_text" && part.text) text.push(part.text);
    }
    if (item.type === "function_call") {
      if (typeof item.call_id !== "string" || typeof item.name !== "string" || typeof item.arguments !== "string") throw new Error("OpenRouter returned a malformed tool call.");
      calls.push({ id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments } });
    }
  }
  if (!text.length && !calls.length) {
    const phases = [...new Set(output.filter(item => item.type === "message")
      .map(item => typeof item.phase === "string" ? item.phase : "unphased"))];
    throw new ProviderResponseError(`OpenRouter returned no assistant message (${phases.length ? `message phases: ${phases.join(", ")}` : "no message or tool output"})`, true);
  }
  return { role: "assistant", content: text.join("\n") || null, responseItems: output, ...(calls.length ? { tool_calls: calls } : {}) };
}
