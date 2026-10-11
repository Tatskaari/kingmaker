import { create } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, TranscriptRole } from "../../contracts/src/index.js";
import type { RuntimeServices } from "./services.js";
import { reviewDocumentEvidence } from "./document-review.js";
import { reviewPromptContext } from "./review-prompt-context.js";
import { renderPrompt } from "../../prompts/src/index.js";
import { gameMasterTools } from "./gm-tools.js";

/** Reuse plot review with authoritative milestone evidence and saved, author-owned instructions. */
export async function reviewMilestone(characterId: string, instructions: string, services: RuntimeServices, signal: AbortSignal) {
  const context = { characterId, participants: [characterId], transcript: [create(TranscriptMessageSchema, {
    role: TranscriptRole.GAME_MASTER, speakerId: "GM", text: instructions,
  })] };
  return reviewDocumentEvidence(context, { plot_progress: { choice: "flagged" } }, signal, services,
    renderPrompt("review-plot-progress", reviewPromptContext(context, services)) + "\n\n" + instructions,
    { systemPrompt: renderPrompt("review-system"), tools: gameMasterTools.filter(tool =>
      ["query_documents", "list_documents", "read_document", "replace_document", "insert_document"].includes(tool.function.name)) });
}
