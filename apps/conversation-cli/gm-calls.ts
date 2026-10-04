import type { AiService } from "../../packages/conversation/src/services.js";
import type { LlmTurn } from "../../packages/conversation/src/conversation.js";

export interface CliGmCall extends LlmTurn {
  id: string;
  purpose: "roll ruling" | "approval" | "review" | "consultation";
  status: "pending" | "completed" | "failed";
}

/** Character generation has its own trace; capture every shared GM response call here. */
export function traceCliGmCalls(ai: AiService, report: (call: CliGmCall) => void,
  nextId: () => string = () => `gm-${crypto.randomUUID()}`): AiService {
  return { ...ai, responses: async (request, signal, info) => {
    const schema = request.response_format?.json_schema as { name?: string } | undefined;
    const purpose = schema?.name === "conversation_roll_ruling" ? "roll ruling"
      : schema?.name === "conversation_approval" ? "approval"
      : request.tools?.some(tool => tool.function.name === "commit_review") ? "review" : "consultation";
    const started = Date.now();
    const call: CliGmCall = { id: nextId(), purpose, status: "pending", request: structuredClone(request) };
    report(call);
    try {
      const response = await ai.responses(request, signal, info);
      report({ ...call, status: "completed", response: structuredClone(response), durationMs: Date.now() - started });
      return response;
    } catch (error) {
      report({ ...call, status: "failed", error: String(error), durationMs: Date.now() - started });
      throw error;
    }
  } };
}
export const gmCallLabel = (call: CliGmCall) => `GM ${call.purpose} · ${call.status}`;
