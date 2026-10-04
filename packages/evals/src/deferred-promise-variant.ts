import { GAME_MASTER_PROMPT } from "../../conversation/src/agent-setup.js";
import { defaultWorldStrategies } from "../../../apps/web/src/world-strategies.js";
import type { ReviewVariant } from "./review-experiment.js";

const immediateCommitments = `2. If an NPC committed to an immediate action, set their activity to achieve it. Honour a successful ruling by arranging its remaining actions, without recording them as already completed. Consider whether an action is realistically actionable in the world before setting it here. Consider making edits to the world state to make things actionable, e.g. giving a character an item or updating an inventory, if it helps tell a "fun and surprising story". Also consider whether the agreement is immediate or something they would do "at some point". Record the "at some point" agreements and encourage the character to bring these up in future conversations: "Oh hi, <name>. When are we going to <x>".`;
const candidatePrompt = GAME_MASTER_PROMPT.replace(/^2\. .*$/m, immediateCommitments);

/** User-authored framing: distinguish immediate actions from lasting promises. */
export const deferredPromiseVariant: ReviewVariant = {
  name: "deferred-promises",
  strategies: { setup: { async prepare(context, signal, services) {
    const messages = await defaultWorldStrategies.setup.prepare(context, signal, services);
    if (context.agent !== "game_master") return messages;
    return messages.map(message => message.role === "system" && message.content === GAME_MASTER_PROMPT
      ? { ...message, content: candidatePrompt } : message);
  } } },
};
