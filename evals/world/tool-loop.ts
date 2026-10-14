import { apiKey, fetchWithRetry, logCall, recordCost, LUNA, type Effort, type Message } from "../../src/llm/openrouter.ts";
import type { ToolCall, ToolDef } from "../../src/llm/tools.ts";

/**
 * src/llm/tools.ts's runTools, counting model rounds and their latency (the eval needs both: a
 * tool loop's latency is its rounds, end to end). Same request shape, same replay of output items.
 */
export async function runToolsCounted(request: {
  operation: string; instructions: string; input: Message[]; tools: ToolDef[]; model?: string; effort?: Effort; maxTurns?: number;
}, call: (name: string, args: Record<string, unknown>) => Promise<unknown>): Promise<{ text: string; calls: ToolCall[]; costUsd: number; latencyMs: number; rounds: number; roundMs: number[]; inputTokens: number; outputTokens: number }> {
  const model = request.model ?? LUNA;
  const items: Array<Record<string, unknown>> = request.input.map(m => ({ role: m.role, content: m.content }));
  const calls: ToolCall[] = [];
  const roundMs: number[] = [];
  let costUsd = 0, inputTokens = 0, outputTokens = 0;
  const started = performance.now();
  for (let turn = 0; turn < (request.maxTurns ?? 8); turn++) {
    const body = {
      model, instructions: request.instructions, input: items, store: false, include: ["reasoning.encrypted_content"],
      reasoning: { effort: request.effort ?? "none" },
      tools: request.tools.map(t => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false })),
    };
    const roundStarted = performance.now();
    const response = await fetchWithRetry("https://openrouter.ai/api/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json", "X-Title": "Kingmaker V2 PoC" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
    }, request.operation);
    const json = await response.json() as { status?: string; output?: Array<{ type?: string; call_id?: string; name?: string; arguments?: string; content?: Array<{ type: string; text?: string }> }>; usage?: { cost?: number; input_tokens?: number; output_tokens?: number }; error?: { message?: string } };
    roundMs.push(performance.now() - roundStarted);
    if (!response.ok || json.status !== "completed") throw new Error(`${request.operation}: ${json.error?.message ?? json.status ?? `HTTP ${response.status}`}`);
    costUsd += json.usage?.cost ?? 0;
    inputTokens += json.usage?.input_tokens ?? 0;
    outputTokens += json.usage?.output_tokens ?? 0;
    recordCost("openrouter", request.operation, model, json.usage?.cost ?? 0, roundMs.at(-1)!);
    const output = json.output ?? [];
    items.push(...output as Array<Record<string, unknown>>);
    const pending = output.filter(o => o.type === "function_call");
    if (!pending.length) {
      const text = output.filter(o => o.type === "message").flatMap(o => o.content ?? []).filter(p => p.type === "output_text").map(p => p.text ?? "").join("\n").trim();
      logCall({ provider: "openrouter", operation: request.operation, model, calls, text, latencyMs: Math.round(performance.now() - started), costUsd });
      return { text, calls, costUsd, latencyMs: performance.now() - started, rounds: roundMs.length, roundMs, inputTokens, outputTokens };
    }
    for (const fc of pending) {
      let result: unknown;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(fc.arguments || "{}") as Record<string, unknown>; result = await call(fc.name!, args); }
      catch (error) { result = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
      calls.push({ name: fc.name!, args, result });
      items.push({ type: "function_call_output", call_id: fc.call_id, output: JSON.stringify(result) });
    }
  }
  return { text: "", calls, costUsd, latencyMs: performance.now() - started, rounds: roundMs.length, roundMs, inputTokens, outputTokens };
}
