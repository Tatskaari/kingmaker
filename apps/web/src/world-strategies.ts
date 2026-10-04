import { setupWorldAgent } from "./agent-setup.js";
import { documentReviewStrategy } from "../../../packages/conversation/src/document-review.js";
import { documentResolutionStrategy } from "../../../packages/conversation/src/document-resolution.js";
import { mapActionStrategy } from "../../../packages/conversation/src/action-execution.js";
import { jevActionStrategy } from "../../../packages/conversation/src/action.js";

/** One default policy set shared by the game and eval baselines. */
export const defaultWorldStrategies = {
  setup: { prepare: setupWorldAgent },
  review: documentReviewStrategy,
  actionExecution: mapActionStrategy,
  action: jevActionStrategy,
  resolution: documentResolutionStrategy,
};
