import type { AiService } from "../../packages/conversation/src/services.js";
import type { JevChoice, JevQuestions } from "../../packages/providers/src/jev.js";

export interface CliDecisionCall {
  id: string;
  purpose: string;
  status: "pending" | "completed" | "failed";
  request: { state: unknown; questions: JevQuestions };
  answers?: Record<string, JevChoice>;
  error?: string;
  durationMs?: number;
}

/** Report the whole call, including negative results and failures, to the inspector. */
export function traceCliDecisions(ai: AiService, report: (call: CliDecisionCall) => void): AiService {
  return { ...ai, decisions: async (state, questions, signal, purpose, info) => {
    const started = Date.now();
    const call: CliDecisionCall = { id: `decision-${crypto.randomUUID()}`, purpose: purpose ?? "classification",
      status: "pending", request: structuredClone({ state, questions }) };
    report(call);
    try {
      const answers = await ai.decisions(state, questions, signal, purpose, info);
      report({ ...call, status: "completed", answers, durationMs: Date.now() - started });
      return answers;
    } catch (error) {
      report({ ...call, status: "failed", error: String(error), durationMs: Date.now() - started });
      throw error;
    }
  } };
}

export function decisionCallLabel(call: CliDecisionCall): string {
  const purpose = call.purpose === "conversation_attention" ? "attention" : call.purpose.replaceAll("_", " ");
  return `Jev ${purpose} · ${call.status}`;
}
