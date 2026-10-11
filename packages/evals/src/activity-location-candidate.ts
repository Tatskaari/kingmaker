import { setupWorldAgent } from "../../../apps/web/src/agent-setup.js";
import { activityNpcLocations } from "../../conversation/src/activity-navigation.js";
import { renderPrompt } from "../../prompts/src/index.js";
import { renderPrompt as renderEvalPrompt } from "./prompts.js";
import type { ReviewVariant } from "./review-experiment.js";

/** Temporary comparison changes only the focused activity-review prompt. */
export const activityLocationCandidate: ReviewVariant = { name: "npc-locations", strategies: { setup: {
  prepare: (context, signal, services) => setupWorldAgent({ ...context,
    messages: context.messages.map(message => message.content === renderPrompt("review-activity") && context.characterId
      ? { ...message, content: `${message.content}\n\n${renderEvalPrompt("activity-location-candidate", {
        npc_locations: activityNpcLocations(services.scenario.read(), context.characterId),
      })}` } : message),
  }, signal, services),
} } };
