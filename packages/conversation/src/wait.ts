import { renderPrompt } from "../../prompts/src/index.js";
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
  const world = services.scenario.read(), intent = characterIntent(world, id);
  if (intent.activity || !intent.wait) return;
  const character = await services.docs.read(intent.entry), wait = await services.docs.read(intent.wait);
  const doc = intentDocument(world, id, intent.wait), targets: DocumentSnapshot[] = [];
  const criteria: Record<string, string> = {
    continue: renderPrompt("wait-continue"),
    stop_waiting: renderPrompt("wait-stop"),
  };
  for (const path of waitActivities(doc)) {
    const activity = activityDefinition(intentDocument(world, id, path));
    targets.push(await services.docs.read(path));
    criteria[`set_activity:${path}`] = renderPrompt("wait-activate", { activity: JSON.stringify(activity) });
  }
  const observation = waitObservation(services, id);
  const messages = await disclosedContext("wait", [{ role: "user", content: JSON.stringify({
    wait: { path: wait.path, instructions: doc.body, properties: doc.frontmatter },
    elapsedSeconds, observation: JSON.parse(observation),
  }) }], services, id, signal);
  const result = await services.ai.decisions({ messages }, { waiting: { type: "choice",
    instructions: renderPrompt("wait-instructions"), criteria } }, signal);
  signal.throwIfAborted();
  const choice = result.waiting?.choice;
  if (!choice || !Object.hasOwn(criteria, choice)) throw new Error("Jev returned an unavailable wait choice.");
  return { choice, character, wait, targets, observation, intent };
}
