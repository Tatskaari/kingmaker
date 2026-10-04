import { renderPrompt } from "../../../packages/prompts/src/index.js";
import { participantPresentations, PRESENTATIONS_PREFIX } from "../../../packages/conversation/src/participant-presentation.js";
import { create } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, TranscriptRole, type TranscriptMessage } from "../../../packages/contracts/src/index.js";
import type { OpenRouterMessage } from "../../../packages/providers/src/openrouter.js";
import { setupAgent, type AgentSetupHook } from "../../../packages/conversation/src/agent-setup.js";
import { characterDocuments } from "../../../packages/lore/src/character-id.js";
import { courtCharactersWithinEarshot, EARSHOT_DESCRIPTIONS } from "./earshot.js";

const earshotPrefix = "# Current conversation earshot";
const latestEarshot = (messages: readonly OpenRouterMessage[]) => messages.findLast(message => message.role === "system" && message.content?.startsWith(earshotPrefix))?.content;

/** Persist a new context note only with a successful conversation turn. */
export function earshotNotes(messages: readonly OpenRouterMessage[], previous: readonly TranscriptMessage[] = []) {
  const content = latestEarshot(messages);
  const last = previous.findLast(turn => turn.role === TranscriptRole.GAME_MASTER && turn.speakerId === "earshot")?.text;
  return content && content !== last ? [create(TranscriptMessageSchema, { role: TranscriptRole.GAME_MASTER, speakerId: "earshot", text: content })] : [];
}

/** Record the initial audience, then only changes to listeners or hearing levels. */
export const setupWorldAgent: AgentSetupHook = async (context, signal, services) => {
  if (!context.characterId || (context.agent !== "character" && context.agent !== "exchange")) {
    return setupAgent(context, signal, services);
  }
  signal.throwIfAborted();
  const world = services.scenario.snapshot();
  context = { ...context, messages: [
    ...participantPresentations(world, context.characterId, context.participantIds ?? [context.characterId]),
    ...context.messages.filter(message => !(message.role === "system" && message.content?.startsWith(PRESENTATIONS_PREFIX))),
  ] };
  const { map } = services.map.observe(context.characterId!);
  const names = new Map(characterDocuments(world).map(({ id, document }) => [id,
    typeof document.frontmatter?.name === "string" ? document.frontmatter.name : id]));
  const characters = map.actors.map(actor => ({ id: actor.instanceId || actor.characterId,
    name: names.get(actor.instanceId || actor.characterId) ?? actor.characterId, position: actor.position }));
  const speaker = characters.find(character => character.id === context.characterId);
  if (!speaker?.position) return setupAgent(context, signal, services);
  const participants = new Set(context.participantIds ?? [context.characterId]);
  const listeners = courtCharactersWithinEarshot(speaker, characters.filter(character => !participants.has(character.id)), map.doors, map.fixtures);
  const groups = (Object.keys(EARSHOT_DESCRIPTIONS) as Array<keyof typeof EARSHOT_DESCRIPTIONS>).flatMap(level => {
    const nearby = listeners.filter(listener => listener.level === level).sort((a, b) => a.id.localeCompare(b.id));
    return nearby.length ? [`${level}: ${EARSHOT_DESCRIPTIONS[level]}\n${nearby.map(listener => `- ${listener.name} (${listener.id})`).join("\n")}`] : [];
  });
  const content = renderPrompt("agent-setup-content", { audience: groups.length ? groups.join("\n\n") : "No one else is within earshot." });
  if (latestEarshot(context.messages) === content) return setupAgent(context, signal, services);
  return setupAgent({ ...context, messages: [...context.messages.slice(0, -1), { role: "system", content }, ...context.messages.slice(-1)] }, signal, services);
};
