import { renderPrompt } from "../../prompts/src/index.js";
import { disclosedContext } from "./disclosed-context.js";
import { create } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, TranscriptRole } from "../../contracts/src/index.js";
import { characterEntry } from "../../lore/src/active-goal.js";
import { activityGoal, intentContext } from "../../lore/src/activity.js";
import { reviewDocumentEvidence } from "./document-review.js";
import type { ResolutionStrategy } from "./resolution.js";
import type { RuntimeServices } from "./services.js";

async function speak(characterId: string, partnerId: string, instruction: string, evidence: unknown, signal: AbortSignal, services: RuntimeServices) {
  const response = await services.ai.responses({ model: "openai/gpt-6-luna", api: "responses",
    messages: await disclosedContext("exchange", [{ role: "user", content: JSON.stringify({ instruction, evidence }) }], services, characterId, signal, { participantIds: [characterId, partnerId] }),
  }, signal, { characterId, purpose: "dialogue" });
  signal.throwIfAborted();
  if (response.tool_calls?.length || !response.content?.trim()) throw new Error("Expected character speech.");
  return create(TranscriptMessageSchema, { role: TranscriptRole.CHARACTER, speakerId: characterId, text: response.content });
}

/** Decisions use character-visible evidence; resolution writes through the shared docs service. */
export const documentResolutionStrategy: ResolutionStrategy = {
  async classify(context, signal, services) {
    if (context.kind !== "world_event") return {};
    const goal = activityGoal(services.scenario.read(), context.characterId);
    const messages = await disclosedContext("attention", [{ role: "user", content: JSON.stringify({
      task: renderPrompt("document-resolution-attention-context"),
      goal, perception: context.perception,
    }) }], services, context.characterId, signal);
    const result = await services.ai.decisions({ messages, goal, perception: context.perception }, {
      reaction: { type: "choice", instructions: renderPrompt("document-resolution-attention"),
        criteria: { process: renderPrompt("document-resolution-process"), ignore: renderPrompt("document-resolution-ignore") } },
    }, signal);
    const choice = result.reaction?.choice;
    if (choice !== "process" && choice !== "ignore") throw new Error("Invalid event reaction classification.");
    return { react: choice === "process" };
  },
  async resolve(context, labels, signal, services) {
    signal.throwIfAborted();
    if (context.kind === "world_event" && labels.react === false) return { summary: "No reaction." };
    if (context.kind === "npc_exchange") {
      if (context.characterId === context.targetId) throw new Error("An exchange needs two different participants.");
      const participants = [context.characterId, context.targetId];
      // Each speaker gets only their own context and what the other actually said.
      const opening = await speak(context.characterId, context.targetId, renderPrompt("document-resolution-open-exchange"),
        { target: context.targetId, goal: context.goal }, signal, services);
      const response = await speak(context.targetId, context.characterId, renderPrompt("document-resolution-reply-exchange"),
        { speaker: context.characterId, words: opening.text }, signal, services);
      const transcript = [opening, response];
      for (const characterId of participants) {
        await reviewDocumentEvidence({ characterId, participants, transcript }, labels, signal, services,
          renderPrompt("document-resolution-review-exchange"));
      }
      return { summary: transcript.map(turn => `${turn.speakerId}: ${turn.text}`).join("\n") };
    }
    const purpose = context.kind === "wait_ended"
      ? renderPrompt("document-resolution-review-wait")
      : context.kind === "world_event"
      ? renderPrompt("document-resolution-review-event")
      : renderPrompt("document-resolution-review-action");
    const text = context.kind === "world_event" ? context.perception : JSON.stringify(context);
    return reviewDocumentEvidence({ characterId: context.characterId, participants: [context.characterId],
      transcript: [create(TranscriptMessageSchema, { role: TranscriptRole.GAME_MASTER, speakerId: "observation", text })],
    }, labels, signal, services, purpose);
  },
};
