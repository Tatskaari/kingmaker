import { renderPrompt } from "../../prompts/src/index.js";
import { presentationPath } from "../../lore/src/presentation.js";
import type { OpenRouterMessage } from "../../providers/src/openrouter.js";
import type { RuntimeServices } from "./services.js";
import { characterIntent, intentContext } from "../../lore/src/activity.js";
import { characterEntry } from "../../lore/src/active-goal.js";
import { classifyConversationReview, type ConversationReviewStrategy, type ConversationReviewContext, type ReviewLabels } from "./review.js";
import { runGameMaster } from "./game-master.js";

export const documentReviewStrategy: ConversationReviewStrategy = {
  classify: classifyConversationReview,
  resolve: (context, labels, signal, services) => reviewDocumentEvidence(context, labels, signal, services),
};

/** GM reviews can edit the world; memories must still respect each NPC's knowledge. */
export async function reviewDocumentEvidence(context: Readonly<ConversationReviewContext>, labels: Readonly<ReviewLabels>,
  signal: AbortSignal, services: RuntimeServices, purpose = renderPrompt("review-conversation")) {
  signal.throwIfAborted();
  const intent = characterIntent(services.scenario.read(), context.characterId), path = intent.entry;
  if (!context.participants.includes(context.characterId)) throw new Error("Review character must be a participant.");
  const before = await services.docs.read(path), world = services.scenario.read();
  const presentations = await Promise.all([...new Set(context.participants)].flatMap(id => {
    const entry = id === "player" ? world.player : world.simulation!.runtimeCharacters[id]?.document;
    const path = entry && presentationPath(entry);
    return path && world.docs[path] ? [services.docs.read(path)] : [];
  }));
  const actor = world.simulation!.map?.actors.find(actor => (actor.instanceId ?? actor.characterId) === intent.actorId);
  let opened: OpenRouterMessage[] | undefined;
  const reply = await runGameMaster({ model: "openai/gpt-6-luna", api: "responses", reasoning: { effort: "low" }, max_tokens: 4000,
    messages: [{ role: "system", content: purpose }, { role: "user", content: JSON.stringify({
      characterId: context.characterId, participants: context.participants, document: before, presentations,
      intent: intentContext(world, intent.actorId), transcript: context.transcript, labels,
      physicalState: actor ? { characterId: actor.characterId, roomId: actor.roomId,
        roomName: world.simulation!.map?.rooms.find(room => room.id === actor.roomId)?.name, position: actor.position } : null,
      scenarioDocument: services.scenario.info().scenario,
    }) }],
  }, services, signal, { characterId: intent.actorId, review: true,
    // Single-character reviews contain synthetic observations, not a conversation.
    ...(context.participants.length > 1 ? { activityOrigin: context } : {}), prepare: async messages => {
    const lore = await services.lore.forCharacter(intent.actorId, signal);
    const current = await services.docs.read(path);
    const initial: OpenRouterMessage[] = lore.initial.map(doc => ({ role: "user", content: `# Character evidence: ${doc.path}\n${doc.path === path ? current.document.body : doc.markdown}` }));
    const boundary = messages.findIndex(message => message.role !== "system");
    const head = messages.slice(0, boundary < 0 ? messages.length : boundary);
    const evidence = messages.slice(head.length);
    opened ??= await services.disclosure.disclose(lore, [...head, ...initial, ...evidence], signal, { characterId: context.characterId });
    signal.throwIfAborted();
    return [...head, ...initial, ...opened.map(doc => ({ role: "user" as const, content: doc.content })), ...evidence];
  } });
  return { summary: reply.content ?? "" };
}
