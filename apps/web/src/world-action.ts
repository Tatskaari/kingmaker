import { clone, create, toJson } from "@bufbuild/protobuf";
import { CharacterSchema, ScenarioSchema, WorldStateSchema as MapSchema } from "../../../packages/contracts/src/index.js";
import { WorldStateSchema, type WorldState } from "../../../packages/contracts/src/v2.js";
import { activeGoal, characterEntry } from "../../../packages/lore/src/active-goal.js";
import { createScenarioServices } from "../../../packages/lore/src/services.js";
import { actionCriteria, runAction, type ActionResult } from "../../../packages/conversation/src/action.js";
import { documentLore } from "../../../packages/conversation/src/document-lore.js";
import { runConversationReview, type ConversationReviewContext } from "../../../packages/conversation/src/review.js";
import type { ConversationRuntime } from "../../../packages/conversation/src/runtime.js";
import { jevRequest } from "../../../packages/providers/src/jev.js";
import { courtAgentObservation } from "./court-agent.js";
import { ROOM_COURT_INSTRUCTIONS } from "./court-instructions.js";
import { renderJevRoomView } from "./jev-room-view.js";

export interface WorldActionPlan extends ActionResult {
  characterId: string;
  goal: string;
  /** Guards the reviewed documents and physical state, including terminal judgments. */
  expectedWorldSha: string;
}
async function worldSha(world: WorldState): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(toJson(WorldStateSchema, world)));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Use inside the game's serialized commit before executing or recording a terminal result. */
export async function assertWorldActionCurrent(world: WorldState, plan: WorldActionPlan): Promise<void> {
  if (await worldSha(world) !== plan.expectedWorldSha) throw new Error("World changed; replan the action.");
}

/** Read-only adapter to the existing palace mechanics, not a v1 save or migration. */
async function worldActionContext(world: WorldState, characterId: string, history: readonly string[]) {
  const services = createScenarioServices(world);
  const entry = characterEntry(services.scenario.info(), characterId);
  const goal = activeGoal(world.docs[entry]!);
  if (!goal) return;
  if (!world.map) throw new Error("Action planning requires a physical map.");
  const lore = await documentLore(services.scenario, characterId);
  const characters = world.characters.map(path => {
    const id = /\/Characters\/([^/]+)\/character\.md$/.exec(path)?.[1];
    if (!id) throw new Error(`Invalid character entrypoint: ${path}`);
    return create(CharacterSchema, { id, name: id, inventory: world.docs[path]?.characterProperties?.inventory,
      currentGoal: id === characterId ? goal : "" });
  });
  // The retained palace map identifies the player actor as "player".
  if (world.player) characters.push(create(CharacterSchema, { id: "player", name: "player",
    inventory: world.docs[world.player]?.characterProperties?.inventory }));
  const scenario = create(ScenarioSchema, { world: clone(MapSchema, world.map), characters,
    playerCharacterId: world.player ? "player" : "" });
  const observation = courtAgentObservation(scenario, characterId);
  const state = [
    `Who you are: ${characterId}`,
    ...lore.initial.map(doc => `# Lore: ${doc.path}\n${doc.markdown}`),
    `Current execution task:\n${goal}`,
    `World state:\n${renderJevRoomView(scenario, observation)}`,
    `Action log (completed actions, oldest first):\n${history.join("\n") || "None yet."}`,
  ].join("\n\n");
  return { characterId, goal, actions: observation.actions,
    request: jevRequest(state, ROOM_COURT_INSTRUCTIONS, actionCriteria(observation.actions)) };
}

/** Idle characters do not call Jev. Hosts execute commands and call again after completion. */
export async function planWorldAction<Turn, Review>(characterId: string, runtime: ConversationRuntime<Turn, Review>,
  signal: AbortSignal = new AbortController().signal, history: readonly string[] = []): Promise<WorldActionPlan | undefined> {
  signal.throwIfAborted();
  const world = runtime.services.scenario.snapshot();
  const context = await worldActionContext(world, characterId, history);
  signal.throwIfAborted();
  if (!context) return;
  if (history.length >= 24) throw new Error("NPC action limit reached.");
  const expectedWorldSha = await worldSha(world);
  const result = await runAction(context, runtime, signal);
  const plan = { ...result, characterId, goal: context.goal, expectedWorldSha };
  await assertWorldActionCurrent(runtime.services.scenario.snapshot(), plan);
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
