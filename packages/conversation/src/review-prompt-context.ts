import { renderPrompt } from "../../prompts/src/index.js";
import type { ConversationReviewContext } from "./review.js";
import type { RuntimeServices } from "./services.js";

/** Read live GM state when the queued review starts; never widen character context. */
export function reviewPromptContext(context: Readonly<ConversationReviewContext>, services: RuntimeServices) {
  const world = services.scenario.read();
  const treeDocuments = Object.entries(world.docs).filter(([path]) => path.startsWith("Conversations/"));
  const treeIds = new Set(treeDocuments.map(([, doc]) => doc.frontmatter?.id));
  const state = (id: string) => {
    const value = world.quests[id];
    return value ? { quest: value.quest, currentStageId: value.currentStageId, revision: value.revision, active: value.active } : null;
  };
  const activeQuests = Object.entries(world.quests).filter(([id, value]) => value.active && !treeIds.has(id))
    .map(([id]) => ({ ...state(id), documents: Object.entries(world.docs)
      .filter(([path, doc]) => path.includes("/Quests/") && doc.frontmatter?.id === id)
      .map(([path]) => path) }));
  const activeConversationTrees = treeDocuments.filter(([path]) => path === `Conversations/${context.characterId}.md`)
    .map(([path, document]) => ({ path, document, state: state(String(document.frontmatter?.id)) }));
  return {
    youAreTheGameMaster: renderPrompt("gm-prompt-gm_base_prompt"),
    transcript: JSON.stringify(context.transcript, null, 2),
    activeQuests: JSON.stringify(activeQuests, null, 2),
    activeConversationTrees: JSON.stringify(activeConversationTrees, null, 2),
  };
}
