import type { AnalysisEvent } from "../../packages/conversation/src/attention.js";
import type { ConversationInput } from "../../packages/conversation/src/conversation.js";

export type MessageAnalysis = AnalysisEvent & { messageIndex: number };

export function formatAnalysis(event: AnalysisEvent): string {
  if (event.kind === "error") return `Analysis error: ${event.error}`;
  if (event.kind === "roll") {
    const roll = event.result;
    return `Roll · ${roll.skill ?? "check"}: d20 ${roll.natural} ${roll.modifier >= 0 ? "+" : "−"} ${Math.abs(roll.modifier)} = ${roll.total}; ${roll.difficulty}, DC ${roll.dc ?? "unknown"}; ${roll.success ? "success" : "failure"} (${roll.outcome})`;
  }
  return Object.entries(event.decisions).map(([label, decision]) => {
    const probabilities = Object.entries(decision.probabilities).map(([choice, value]) => `${choice} ${(value * 100).toFixed(1)}%`).join(", ");
    return `${event.source} · ${label}: ${decision.choice} [${probabilities}]${decision.confidence === undefined ? "" : `; confidence ${(decision.confidence * 100).toFixed(1)}%`}`;
  }).join("\n");
}

export function formatConversation(transcript: ConversationInput["transcript"], characterId: string, analysis: readonly MessageAnalysis[]): string {
  return transcript.map((message, index) => {
    const labels = analysis.filter(event => event.messageIndex === index).map(formatAnalysis).filter(Boolean);
    return `${message.speakerId === "player" ? "You" : characterId}: ${message.text}${labels.length ? `\n${labels.map(label => `  ${label.replaceAll("\n", "\n  ")}`).join("\n")}` : ""}`;
  }).join("\n\n");
}
