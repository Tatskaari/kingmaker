import { disclosedContext } from "../../../packages/conversation/src/disclosed-context.js";
import type { RuntimeServices } from "../../../packages/conversation/src/services.js";
import { create } from "@bufbuild/protobuf";
import { CharacterSchema, ScenarioSchema } from "../../../packages/contracts/src/index.js";
import { type WorldState } from "../../../packages/contracts/src/v2.js";
import { activeGoal, characterEntry } from "../../../packages/lore/src/active-goal.js";
import { actionCriteria, runAction, type ActionResult } from "../../../packages/conversation/src/action.js";
import { runConversationReview, type ConversationReviewContext } from "../../../packages/conversation/src/review.js";
import type { ConversationRuntime } from "../../../packages/conversation/src/runtime.js";
import { jevRequest } from "../../../packages/providers/src/jev.js";
import { characterCourtObservation } from "./court-agent.js";
import { ROOM_COURT_INSTRUCTIONS } from "./court-instructions.js";
import { renderJevRoomView } from "./jev-room-view.js";

export interface WorldActionPlan extends ActionResult {
  characterId: string;
  revision: number;
  goal: string;
}

/** Read-only adapter to the existing palace mechanics, not a v1 save or migration. */
async function worldActionContext(world: WorldState, characterId: string, history: readonly string[], services: RuntimeServices, signal: AbortSignal) {
  const entry = characterEntry(services.scenario.info(), characterId);
  const goal = activeGoal(world.docs[entry]!);
  if (!goal) return;
  if (!world.map) throw new Error("Action planning requires a physical map.");
  const lore = await services.lore.forCharacter(characterId, signal);
  const characters = world.characters.map(path => {
    const id = /\/Characters\/([^/]+)\/character\.md$/.exec(path)?.[1];
    if (!id) throw new Error(`Invalid character entrypoint: ${path}`);
    return create(CharacterSchema, { id, name: id, inventory: world.docs[path]?.characterProperties?.inventory,
      currentGoal: id === characterId ? goal : "" });
  });
  // The retained palace map identifies the player actor as "player".
  if (world.player) characters.push(create(CharacterSchema, { id: "player", name: "player",
    inventory: world.docs[world.player]?.characterProperties?.inventory }));
  const visible = services.map.observe(characterId);
  const scenario = create(ScenarioSchema, { world: visible.map, characters,
    playerCharacterId: world.player ? "player" : "" });
  const observation = { ...characterCourtObservation(scenario, characterId), actions: [...visible.actions] };
  const state = [
    `Who you are: ${characterId}`,
    `Current execution task:\n${goal}`,
    `World state:\n${renderJevRoomView(scenario, observation)}`,
    `Action log (completed actions, oldest first):\n${history.join("\n") || "None yet."}`,
  ].join("\n\n");
  const messages = await disclosedContext(lore, [{ role: "system", content: ROOM_COURT_INSTRUCTIONS },
    { role: "user", content: state }], services, characterId, signal);
  const expanded = messages.map(message => message.content).join("\n\n");
  return { characterId, goal, revision: visible.map.revision, actions: observation.actions,
    request: jevRequest(expanded, ROOM_COURT_INSTRUCTIONS, actionCriteria(observation.actions)) };
}

/** Idle characters do not call Jev. Hosts execute commands and call again after completion. */
export async function planWorldAction<Turn, Review>(characterId: string, runtime: ConversationRuntime<Turn, Review>,
  signal: AbortSignal = new AbortController().signal, history: readonly string[] = []): Promise<WorldActionPlan | undefined> {
  signal.throwIfAborted();
  const world = runtime.services.scenario.snapshot();
  if (history.length >= 24) throw new Error("NPC action limit reached.");
  const context = await worldActionContext(world, characterId, history, runtime.services, signal);
  signal.throwIfAborted();
  if (!context) return;
  const result = await runAction(context, runtime, signal);
  const plan = { ...result, characterId, goal: context.goal, revision: context.revision };
  signal.throwIfAborted();
  return plan;
}

/** A successful review publishes intent before action classification can begin. */
export async function reviewAndPlanWorldAction<Turn, Review>(context: ConversationReviewContext,
  runtime: ConversationRuntime<Turn, Review>, signal: AbortSignal = new AbortController().signal) {
  const review = await runConversationReview(context, runtime, signal);
  const plan = await planWorldAction(context.characterId, runtime, signal);
  return { review, plan };
}
