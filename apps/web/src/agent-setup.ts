import { setupAgent, type AgentSetupHook } from "../../../packages/conversation/src/agent-setup.js";
import { characterDocuments } from "../../../packages/lore/src/character-id.js";
import { courtCharactersWithinEarshot, EARSHOT_DESCRIPTIONS } from "./earshot.js";

/** Refresh the conversation's physical audience before disclosure or speech. */
export const setupWorldAgent: AgentSetupHook = async (context, signal, services) => {
  if (!context.characterId || (context.agent !== "character" && context.agent !== "exchange")) {
    return setupAgent(context, signal, services);
  }
  signal.throwIfAborted();
  const { map } = services.map.observe(context.characterId);
  const names = new Map(characterDocuments(services.scenario.snapshot()).map(({ id, document }) => [id,
    typeof document.frontmatter?.name === "string" ? document.frontmatter.name : id]));
  const characters = map.actors.map(actor => ({ id: actor.instanceId || actor.characterId,
    name: names.get(actor.instanceId || actor.characterId) ?? actor.characterId, position: actor.position }));
  const speaker = characters.find(character => character.id === context.characterId);
  if (!speaker?.position) return setupAgent(context, signal, services);
  const participants = new Set(context.participantIds ?? [context.characterId]);
  const listeners = courtCharactersWithinEarshot(speaker, characters.filter(character => !participants.has(character.id)), map.doors, map.fixtures);
  const groups = (Object.keys(EARSHOT_DESCRIPTIONS) as Array<keyof typeof EARSHOT_DESCRIPTIONS>).flatMap(level => {
    const nearby = listeners.filter(listener => listener.level === level);
    return nearby.length ? [`${level}: ${EARSHOT_DESCRIPTIONS[level]}\n${nearby.map(listener => `- ${listener.name} (${listener.id})`).join("\n")}`] : [];
  });
  const content = `# Current conversation earshot\n${groups.length ? groups.join("\n\n") : "No one else is within earshot."}\nTake this audience into account when choosing what to say aloud. This describes who may overhear, not proof they heard or learned anything.`;
  return setupAgent({ ...context, messages: [{ role: "system", content }, ...context.messages] }, signal, services);
};
