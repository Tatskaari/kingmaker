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

export class OpenRouterClient {
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs = 60_000,
  ) {}

  async complete(request: ChatCompletionRequest, signal?: AbortSignal): Promise<OpenRouterMessage> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:4317",
        "X-Title": "Kingmaker",
      },
      body: JSON.stringify(request),
      signal: combined,
    });
    const body = await response.json() as ChatCompletionResponse;
    if (!response.ok) {
      throw new Error(body.error?.message || `OpenRouter returned HTTP ${response.status}`);
    }
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error("OpenRouter returned no assistant message");
    return message;
  }
}
