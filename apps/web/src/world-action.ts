import { renderPrompt } from "../../../packages/prompts/src/index.js";
import { disclosedContext } from "../../../packages/conversation/src/disclosed-context.js";
import type { RuntimeServices } from "../../../packages/conversation/src/services.js";
import { characterDocuments } from "../../../packages/lore/src/character-id.js";
import { inventoryOwners } from "../../../packages/core/src/inventory.js";
import { worldForCharacter } from "../../../packages/core/src/physical-view.js";
import { type WorldState } from "../../../packages/contracts/src/v2.js";

import { activityGoal, intentContext } from "../../../packages/lore/src/activity.js";
import { actionCriteria, runAction, type ActionResult } from "../../../packages/conversation/src/action.js";
import { runConversationReview, type ConversationReviewContext } from "../../../packages/conversation/src/review.js";
import type { ConversationRuntime } from "../../../packages/conversation/src/runtime.js";
import { jevRequest } from "../../../packages/providers/src/jev.js";
import { physicalCharacterObservation } from "./physical-observation.js";
import { renderJevRoomView } from "./jev-room-view.js";

export interface PlanningFeedback { error: string; instruction: string }

export interface WorldActionPlan extends ActionResult {
  characterId: string;
  revision: number;
  goal: string;
}

/** Format the supplied physical observation alongside independently disclosed character lore. */
async function worldActionContext(world: WorldState, characterId: string, history: readonly string[], services: RuntimeServices, signal: AbortSignal, feedback?: PlanningFeedback) {
  const goal = activityGoal(world, characterId);
  if (!goal) return;
  if (!world.simulation!.map) throw new Error("Action planning requires a physical map.");
  // Preserve stable-ID labels in planner context; narrative names come through disclosure.
  const characters = characterDocuments(world).map(({ id, document }) => ({ id, name: id,
    inventory: document.characterProperties?.inventory }));
  const visible = services.map.observe(characterId);
  const known = worldForCharacter(visible.map, inventoryOwners(characters, visible.map), characterId);
  const observation = physicalCharacterObservation(known, characterId, goal, visible.actions);
  const state = renderPrompt("planner-context", {
    characterId, feedback: feedback ? JSON.stringify(feedback) : "",
    intent: intentContext(world, characterId), goal,
    observedMap: renderJevRoomView(visible.map, characters, observation),
    history: history.join("\n") || "None yet.",
  });
  const instructions = renderPrompt("world-action-instructions");
  const messages = await disclosedContext("planner", [{ role: "system", content: instructions },
    { role: "user", content: state }], services, characterId, signal);
  const expanded = messages.map(message => message.content).join("\n\n");
  return { characterId, goal, revision: visible.map.revision, actions: observation.actions,
    request: jevRequest(expanded, instructions, { ...actionCriteria(observation.actions),
      complete: renderPrompt("world-action-complete"),
      wait: renderPrompt("world-action-wait"),
    }) };
}

/** Idle characters do not call Jev. Hosts execute commands and call again after completion. */
export async function planWorldAction<Review>(characterId: string, runtime: ConversationRuntime<Review>,
  signal: AbortSignal = new AbortController().signal, history: readonly string[] = [], feedback?: PlanningFeedback): Promise<WorldActionPlan | undefined> {
  signal.throwIfAborted();
  const world = runtime.services.scenario.snapshot();
  if (history.length >= 24) throw new Error("NPC action limit reached.");
  const context = await worldActionContext(world, characterId, history, runtime.services, signal, feedback);
  signal.throwIfAborted();
  if (!context) return;
  const result = await runAction(context, runtime, signal);
  const plan = { ...result, characterId, goal: context.goal, revision: context.revision };
  signal.throwIfAborted();
  return plan;
}

/** A successful review publishes intent before action classification can begin. */
export async function reviewAndPlanWorldAction<Review>(context: ConversationReviewContext,
  runtime: ConversationRuntime<Review>, signal: AbortSignal = new AbortController().signal) {
  const review = await runConversationReview(context, runtime, signal);
  const plan = await planWorldAction(context.characterId, runtime, signal);
  return { review, plan };
}
