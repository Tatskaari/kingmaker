import { creationSteps } from "../creation/steps.ts";
import type { JobPlan } from "../jobs.ts";
import { crossBoundary } from "../story/boundary.ts";
import type { Move } from "./move.ts";
import { inventLook } from "./looks.ts";
import { openScene } from "./open-scene.ts";
import { remember } from "./remember.ts";
import { repair } from "./repair.ts";
import { say } from "./say.ts";
import { suggest } from "./suggest.ts";

/**
 * The moves a job can be for, by the name its row keeps (job.move): finishJob commits an answer with
 * the move that queued it, and asks its owner whether the answer is still wanted. Looked up when
 * called, never at load, since the moves import the job loop that imports this. Append-only.
 */
export function moveNamed(name: string): Move<unknown, JobPlan> {
  const moves = [say, openScene, suggest, creationSteps, remember, repair, crossBoundary, inventLook] as Array<Move<unknown, JobPlan>>;
  const move = moves.find(m => m.name === name);
  if (!move) throw new Error(`no move called ${name}`);
  return move;
}
