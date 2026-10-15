import { apiKey, fetchWithRetry, logCall, recordCost, LUNA, type Effort, type Message } from "./openrouter.ts";

/**
 * A tool-using agent on the OpenRouter Responses API (V1's runGameMaster loop): stateless
 * (store: false), with the model's raw output items replayed each round so reasoning carries
 * over, and tool results sent back as function_call_output items. Used by background reviews only.
 */

export interface ToolDef { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolCall { name: string; args: Record<string, unknown>; result: unknown }

interface OutputItem { type?: string; phase?: string | null; call_id?: string; name?: string; arguments?: string; content?: Array<{ type: string; text?: string }> }

export class InvalidToolArguments extends Error {}

export async function runTools(request: {
  operation: string; instructions: string; input: Message[]; tools: ToolDef[];
  model?: string; effort?: Effort; maxTurns?: number;
}, call: (name: string, args: Record<string, unknown>) => Promise<unknown>): Promise<{ text: string; calls: ToolCall[]; costUsd: number; latencyMs: number }> {
  const model = request.model ?? LUNA;
  const items: Array<Record<string, unknown>> = request.input.map(m => ({ role: m.role, content: m.content }));
  const calls: ToolCall[] = [];
  let costUsd = 0, corrections = 0;
  const started = performance.now();
  for (let turn = 0; turn < (request.maxTurns ?? 12); turn++) {
    const body = {
      model, instructions: request.instructions, input: items, store: false, include: ["reasoning.encrypted_content"],
      reasoning: { effort: request.effort ?? "medium" },
      tools: request.tools.map(t => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false })),
    };
    const response = await fetchWithRetry("https://openrouter.ai/api/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json", "X-Title": "Kingmaker V2 PoC" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    }, request.operation);
    const json = await response.json() as { status?: string; output?: OutputItem[]; usage?: { cost?: number }; error?: { message?: string }; incomplete_details?: { reason?: string } };
    if (!response.ok || json.status !== "completed") {
      logCall({ provider: "openrouter", operation: request.operation, model, error: json.error?.message ?? `status ${json.status} ${json.incomplete_details?.reason ?? ""}` });
      throw new Error(`${request.operation}: ${json.error?.message ?? json.status ?? `HTTP ${response.status}`}`);
    }
    const cost = json.usage?.cost ?? 0;
    costUsd += cost;
    recordCost("openrouter", request.operation, model, cost, performance.now() - started);
    const output = json.output ?? [];
    items.push(...output as Array<Record<string, unknown>>);
    const pending = output.filter(o => o.type === "function_call");
    if (!pending.length) {
      const text = output.filter(o => o.type === "message").flatMap(o => o.content ?? []).filter(p => p.type === "output_text").map(p => p.text ?? "").join("\n").trim();
      logCall({ provider: "openrouter", operation: request.operation, model, effort: body.reasoning.effort, request: { instructions: request.instructions.slice(0, 400), input: request.input }, calls, text, latencyMs: Math.round(performance.now() - started), costUsd });
      return { text, calls, costUsd, latencyMs: performance.now() - started };
    }
    for (const fc of pending) {
      let result: unknown;
      try {
        const args = JSON.parse(fc.arguments || "{}") as Record<string, unknown>;
        if (!request.tools.some(t => t.name === fc.name)) throw new InvalidToolArguments(`Tool unavailable in this review: ${fc.name}`);
        result = await call(fc.name!, args);
        calls.push({ name: fc.name!, args, result });
      } catch (error) {
        if (!(error instanceof InvalidToolArguments || error instanceof SyntaxError) || corrections++ >= 2) throw error;
        result = { ok: false, error: "invalid_tool_arguments", instruction: error.message };
      }
      items.push({ type: "function_call_output", call_id: fc.call_id, output: JSON.stringify(result) });
    }
  }
  throw new Error(`${request.operation}: tool limit reached; review incomplete`);
}
