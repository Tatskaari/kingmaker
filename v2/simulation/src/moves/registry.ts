import type { JobPlan } from "../jobs.ts";
import type { Move } from "./move.ts";
import { openScene } from "./open-scene.ts";
import { say } from "./say.ts";

/**
 * The moves a job can be for, by the name its row keeps (job.move): finishJob commits an answer with
 * the move that queued it. Looked up when called, never at load, since the moves import the job loop
 * that imports this.
 */
export function moveNamed(name: string): Move<unknown, JobPlan> {
  const moves = [say, openScene] as Array<Move<unknown, JobPlan>>;
  const move = moves.find(m => m.name === name);
  if (!move) throw new Error(`no move called ${name}`);
  return move;
}
