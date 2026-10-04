import { disclosedContext } from "./disclosed-context.js";
import { create } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, TranscriptRole } from "../../contracts/src/index.js";
import { characterEntry } from "../../lore/src/active-goal.js";
import { activityGoal, intentContext } from "../../lore/src/activity.js";
import { reviewDocumentEvidence } from "./document-review.js";
import type { ResolutionHooks } from "./resolution.js";
import type { RuntimeServices } from "./services.js";

async function speak(characterId: string, instruction: string, evidence: unknown, signal: AbortSignal, services: RuntimeServices) {
  const lore = await services.lore.forCharacter(characterId, signal);
  const response = await services.ai.responses({ model: "openai/gpt-6-luna", api: "responses", max_tokens: 1200,
    messages: await disclosedContext(lore, [{ role: "system", content: "Speak only this character's words and observable gestures. Respect their motives and permitted knowledge. Do not invent the other speaker's agreement or any physical outcome. Do not request GM consultation." },
      { role: "user", content: JSON.stringify({ instruction, evidence }) }], services, characterId, signal),
  }, signal, { characterId, purpose: "dialogue" });
  signal.throwIfAborted();
  if (response.tool_calls?.length || !response.content?.trim()) throw new Error("Expected character speech.");
  return create(TranscriptMessageSchema, { role: TranscriptRole.CHARACTER, speakerId: characterId, text: response.content });
}

/** Decisions use character-visible evidence; resolution writes through the shared docs service. */
export const documentResolutionHooks: ResolutionHooks = {
  async classify(context, signal, services) {
    if (context.kind !== "world_event") return {};
    const lore = await services.lore.forCharacter(context.characterId, signal);
    const path = characterEntry(services.scenario.info(), context.characterId);
    const goal = activityGoal(services.scenario.snapshot(), context.characterId);
    const messages = await disclosedContext(lore, [{ role: "user", content: JSON.stringify({
      task: "Decide whether this perceived event warrants attention based on your knowledge and motives. Do not infer unperceived details.",
      goal, perception: context.perception,
    }) }], services, context.characterId, signal);
    const result = await services.ai.decisions({ messages, goal, perception: context.perception }, {
      reaction: { type: "choice", instructions: "Does this perceived event warrant attention based on this character's knowledge and motives? Do not infer unperceived details.",
        criteria: { process: "Materially changes an objective or warrants an immediate reaction.", ignore: "Incidental, already known or irrelevant." } },
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
      const opening = await speak(context.characterId, "Initiate a brief exchange to advance your goal.",
        { target: context.targetId, goal: context.goal }, signal, services);
      const response = await speak(context.targetId, "Respond to the words spoken to you. You may refuse or negotiate.",
        { speaker: context.characterId, words: opening.text }, signal, services);
      const transcript = [opening, response];
      for (const characterId of participants) {
        await reviewDocumentEvidence({ characterId, participants, transcript }, labels, signal, services,
          "Review only this participant's knowledge of the exchange. The other participant's motives are private. Speech does not execute physical actions.");
      }
      return { summary: transcript.map(turn => `${turn.speakerId}: ${turn.text}`).join("\n") };
    }
    const purpose = context.kind === "world_event"
      ? "Review the perceived event, not a conversation. Record only the supplied perception, retaining its uncertainty. Consider whether it changes or reactivates work."
      : "Review the completed action attempt, not a conversation. Use actual actions and observations. A wait result means this task is blocked on another actor: clear that goal unless a different immediately executable task is warranted. Do not restart failed work without new evidence.";
    const text = context.kind === "world_event" ? context.perception : JSON.stringify(context);
    return reviewDocumentEvidence({ characterId: context.characterId, participants: [context.characterId],
      transcript: [create(TranscriptMessageSchema, { role: TranscriptRole.GAME_MASTER, speakerId: "observation", text })],
    }, labels, signal, services, purpose);
  },
};
