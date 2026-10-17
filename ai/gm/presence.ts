// Copied from the prototype's src/runtime/engine.ts:230-248 at 44c6d4a (settlePresence): it reads a TurnView (gm/view.ts) for the session, and returns who's absent rather than setting it on the session. The prototype ran it as the next scene opened; v2 runs it in the boundary (story-design §4.4), once the new chapter's hand-off is in the view's history and the verdict's adjustments are on it, so the next place is built without them.

import type { Decider } from "../llm/decide.ts";
import type { Scene } from "../../shared/scene/types.ts";
import type { TurnView } from "./view.ts";

/**
 * Who from earlier scenes is actually here? A recurring character's card can't know whether the
 * last scene ended with them taken in or fled; the hand-off does, and so does the boundary's word on
 * what's true now (its adjustments: "Cob will not be at the Rat tonight", and he was, at .83, read
 * from the hand-off alone). Only confident "not here" counts. Nobody's asked about (none absent)
 * when there's no hand-off, or it and the adjustments name none of the scene's people.
 */
export async function settlePresence(scene: Scene, state: Pick<TurnView, "history" | "adjustments">, decider: Decider): Promise<string[]> {
  const handoff = state.history.at(-1)?.summary;
  if (!handoff) return [];
  const now = state.adjustments ?? [];
  const told = [handoff, ...now].join("\n");
  const recurring = scene.cast.filter(c => told.includes(c.name.split(" ").at(-1)!) || told.includes(c.name.split(" ")[0]!));
  if (!recurring.length) return [];
  const decision = await decider.decide({ previous_scene: handoff, ...(now.length ? { true_now: now } : {}), new_scene: `${scene.title}: ${scene.setting}` }, Object.fromEntries(recurring.map(c => [c.id, {
    instructions: `A new scene is starting right after the previous one ended as described${now.length ? " (true_now is what's true by the time it starts, and it has the last word on who is where)" : ""}. Going by what happened (not by what this scene's prep assumes), can ${c.name} be here at the start of the new scene, or does what happened rule it out (taken into custody, fled, left far behind, dead, staying away)?`,
    criteria: { here: `${c.name} can be here (or nothing rules it out).`, not_here: `What happened rules out ${c.name} being here.` },
  }])), "director.presence");
  return recurring.filter(c => decision.answers[c.id]?.choice === "not_here" && (decision.answers[c.id]?.probabilities?.not_here ?? 1) >= 0.8).map(c => c.id);
}
