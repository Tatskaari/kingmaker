import { activityDefinition, characterIntent, intentDocument, waitActivities } from "../../lore/src/activity.js";
import type { DocumentSnapshot } from "../../lore/src/services.js";
import type { RuntimeServices } from "./services.js";
import { disclosedContext } from "./disclosed-context.js";

export interface WaitDecision {
  choice: string; character: DocumentSnapshot; wait: DocumentSnapshot; targets: DocumentSnapshot[];
  observation: string; intent: ReturnType<typeof characterIntent>;
}
/** Deliberately excludes remote actors, their documents and unobserved world events. */
export function waitObservation(services: RuntimeServices, id: string): string {
  const { map } = services.map.observe(id), actor = map.actors.find(actor => actor.characterId === id);
  if (!actor?.position) throw new Error("Waiting character is not placed.");
  return JSON.stringify({ room: map.rooms.find(room => room.id === actor.roomId)?.name, roomId: actor.roomId,
    position: actor.position,
    visibleCharacters: map.actors.filter(other => other.characterId !== id && other.roomId === actor.roomId)
      .map(other => ({ id: other.characterId, position: other.position, awake: other.awake })),
    doors: map.doors.filter(door => door.roomIds.includes(actor.roomId)).map(door => ({ id: door.id, open: door.open })),
  });
}
export async function decideWait(id: string, elapsedSeconds: number, services: RuntimeServices, signal: AbortSignal): Promise<WaitDecision | undefined> {
  const world = services.scenario.snapshot(), intent = characterIntent(world, id);
  if (intent.activity || !intent.wait) return;
  const character = await services.docs.read(intent.entry), wait = await services.docs.read(intent.wait);
  const doc = intentDocument(world, id, intent.wait), targets: DocumentSnapshot[] = [];
  const criteria: Record<string, string> = {
    continue: "The awaited condition is NOT satisfied and waiting still makes sense. Remain asleep until the next check. This never means resume the undertaking.",
    stop_waiting: "The awaited condition IS satisfied but no offered activity fits, or waiting no longer makes sense. Clear the wait and ask the LLM for the next action. Seeing the awaited person here satisfies a wait for their arrival.",
  };
  for (const path of waitActivities(doc)) {
    const activity = activityDefinition(intentDocument(world, id, path));
    targets.push(await services.docs.read(path));
    criteria[`set_activity:${path}`] = `Begin this activity when the wait's instructions warrant it: ${JSON.stringify(activity)}`;
  }
  const observation = waitObservation(services, id);
  const messages = await disclosedContext("wait", [{ role: "user", content: JSON.stringify({
    wait: { path: wait.path, instructions: doc.body, properties: doc.frontmatter },
    elapsedSeconds, observation: JSON.parse(observation),
  }) }], services, id, signal);
  const result = await services.ai.decisions({ messages }, { waiting: { type: "choice",
    instructions: "Apply this wait's instructions to the character's CURRENT observations and elapsed time. Current observations override historical statements in the wait and notes: a person visible here now has arrived even if older text says they have not. On a satisfied trigger, choose a matching set_activity option; if none is offered, choose stop_waiting. Choose only an offered option. Continue if its condition is unmet. Never infer a remote person's location, unseen events, or a promise's fulfilment. Passing a 15-second interval alone is not a reason to end a conditional wait.", criteria } }, signal);
  signal.throwIfAborted();
  const choice = result.waiting?.choice;
  if (!choice || !Object.hasOwn(criteria, choice)) throw new Error("Jev returned an unavailable wait choice.");
  return { choice, character, wait, targets, observation, intent };
}
