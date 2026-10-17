import type { Identity } from "spacetimedb";
import { refusal } from "../../../shared/protocol/refusals.ts";
import { actorOf, Refused, type Actor, type TxCtx } from "../context.ts";
import { failedJobOf, retryJob } from "../jobs.ts";
import { playerRow, sceneRow, updateTurn, type JobRow, type TurnRow } from "../rows.ts";
import type { Phase } from "../turns.ts";

/**
 * retry_turn (v0-design §3.3): the controller carries on after the GM lost the thread. The turn's
 * failed job goes back to queued from its first attempt, with the same key and the request it
 * stored, so an answer the AI service kept is served again; the turn shows the step it's on.
 */
export function retryTurnReducer(tx: TxCtx, sender: Identity, { turn: turnId }: { turn: bigint }): void {
  const { turn, job } = retryable(tx, actorOf(tx, sender), turnId);

  retryJob(tx, job);

  updateTurn(tx, turn.id, { phase: PHASE_OF[job.step] ?? "deciding", error: undefined, note: undefined });
}

/** The phase a turn shows while its job's step thinks. */
const PHASE_OF: Record<string, Phase> = { open: "replying", decide: "deciding", consider: "considering", reply: "replying", settle: "settling" };

/** The turn and its failed job, when the caller leads its scene and it's the failed turn holding the scene's lease. */
function retryable(tx: TxCtx, actor: Actor, turnId: bigint): { turn: TurnRow; job: JobRow } {
  if (actor.id === undefined) throw new Refused(refusal("not_in_game"));
  const turn = tx.db.turn.id.find(turnId);
  if (!turn) throw new Refused(refusal("unknown", { what: "turn" }));

  const scene = sceneRow(tx, turn.sceneId);
  if (scene.controllerId !== actor.id) throw new Refused(refusal("not_controller", { name: playerRow(tx, scene.controllerId).name }));

  const job = turn.phase === "failed" && scene.turnId === turn.id ? failedJobOf(tx, turn.id) : undefined;
  if (!job) throw new Refused(refusal("not_failed"));
  return { turn, job };
}
