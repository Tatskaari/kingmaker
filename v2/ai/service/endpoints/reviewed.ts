import { turnSource, type ViewSource } from "../../gm/view.ts";
import type { SceneContext } from "../../../shared/protocol/ai.ts";

/**
 * What the thinks after a turn read (the memory reviews and the co-GM, full-gm-design §4.1): the
 * scene as the reviewed turn left it, which is how the prototype's jobs found it (jobs.ts: the turn's
 * snapshot, or the session saved after it). The view's turn is the one reviewed, and the transcript
 * runs to its end: a line the player queued meanwhile, already on the transcript the simulation
 * sends, is left out (the simulation cuts it too).
 */
export function reviewedSource(req: { game: { id: string }; turn: SceneContext; reviewed: number }): ViewSource {
  const source = turnSource(req);
  return { ...source, scene: { ...source.scene, turn: req.reviewed }, transcript: source.transcript.filter(e => e.turn <= req.reviewed) };
}
