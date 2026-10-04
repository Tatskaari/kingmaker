import type { OpenRouterMessage } from "../../providers/src/openrouter.js";
import type { RuntimeServices } from "./services.js";
import { intentContext } from "../../lore/src/activity.js";
import { characterEntry } from "../../lore/src/active-goal.js";
import { parseModelObject } from "../../providers/src/structured-output.js";
import { classifyConversationReview, type ConversationReviewHooks, type ConversationReviewContext, type ReviewLabels } from "./review.js";
import { runGameMaster } from "./game-master.js";

export const documentReviewHooks: ConversationReviewHooks = {
  classify: classifyConversationReview,
  resolve: (context, labels, signal, services) => reviewDocumentEvidence(context, labels, signal, services),
};

/** GM reviews can edit the world; memories must still respect each NPC's knowledge. */
export async function reviewDocumentEvidence(context: Readonly<ConversationReviewContext>, labels: Readonly<ReviewLabels>,
  signal: AbortSignal, services: RuntimeServices, purpose = "Review the recent conversation between the player and the NPC.") {
  signal.throwIfAborted();
  const path = characterEntry(services.scenario.info(), context.characterId);
  if (!context.participants.includes(context.characterId)) throw new Error("Review character must be a participant.");
  const before = await services.docs.read(path), world = services.scenario.snapshot();
  const actor = world.map?.actors.find(actor => actor.characterId === context.characterId);
  let opened: OpenRouterMessage[] | undefined;
  const reply = await runGameMaster({ model: "openai/gpt-6-luna", api: "responses", reasoning: { effort: "low" }, max_tokens: 4000,
    messages: [{ role: "system", content: purpose }, { role: "user", content: JSON.stringify({
      characterId: context.characterId, participants: context.participants, document: before,
      intent: intentContext(world, context.characterId), transcript: context.transcript, labels,
      physicalState: actor ? { characterId: actor.characterId, roomId: actor.roomId,
        roomName: world.map?.rooms.find(room => room.id === actor.roomId)?.name, position: actor.position } : null,
      scenarioDocument: services.scenario.info().scenario,
    }) }],
  }, services, signal, { characterId: context.characterId, requireCommit: true, prepare: async messages => {
    const lore = await services.lore.forCharacter(context.characterId, signal);
    const current = await services.docs.read(path);
    const initial: OpenRouterMessage[] = lore.initial.map(doc => ({ role: "user", content: `# Character evidence: ${doc.path}\n${doc.path === path ? current.document.body : doc.markdown}` }));
    const [system, task, ...evidence] = messages;
    opened ??= await services.disclosure.disclose(lore, [system!, task!, ...initial, ...evidence], signal, { characterId: context.characterId });
    signal.throwIfAborted();
    return [system!, task!, ...initial, ...opened.map(doc => ({ role: "user" as const, content: doc.content })), ...evidence];
  } });
  return { summary: parseModelObject(reply.content, "Game master review").summary as string };
}
