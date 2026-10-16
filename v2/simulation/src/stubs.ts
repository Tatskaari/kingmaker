import type { Identity } from "spacetimedb";
import type { Infer, ViewCtx } from "spacetimedb/server";
import { refusal } from "../../shared/protocol/refusals.ts";
import type { InstallArgs } from "../../shared/scene/files.ts";
import type { AiOutcome, Claim } from "./ai-call.ts";
import { Refused, type Schema, type TxCtx } from "./context.ts";
import type { NameView, SeatView } from "./schema.ts";

/**
 * Package A's stand-ins for package B's bodies, with the signatures index.ts calls them by. Each
 * move refuses "not_built" until B writes it; B replaces the files that re-export these
 * (moves/new-game.ts, moves/join-game.ts, moves/say.ts, moves/retry-turn.ts, jobs.ts, stream.ts,
 * install.ts, views.ts) and deletes this one. What can't refuse doesn't: the views answer as if
 * nobody had a seat (nobody can, until new_game is built), and the reaper, which init starts, has no
 * jobs to reap.
 */

const notBuilt = (): never => {
  throw new Refused(refusal("not_built"));
};

// The client's moves.
export const newGameReducer = (_tx: TxCtx, _sender: Identity, _args: { campaign: string; name: string; concept: string; build: string }): void => notBuilt();
export const joinGameReducer = (_tx: TxCtx, _sender: Identity, _args: { game: bigint }): void => notBuilt();
export const sayReducer = (_tx: TxCtx, _sender: Identity, _args: { text: string }): void => notBuilt();
export const retryTurnReducer = (_tx: TxCtx, _sender: Identity, _args: { turn: bigint }): void => notBuilt();

// The AI service's and the owner's.
export const streamReplyReducer = (_tx: TxCtx, _sender: Identity, _args: { turnId: bigint; attempt: number; seq: number; speaker: string; text: string; markup?: string; done: boolean }): void => notBuilt();
export const installCampaignReducer = (_tx: TxCtx, _sender: Identity, _args: InstallArgs): void => notBuilt();

// The job loop (run_job and reap_jobs).
export const claimJob = (_tx: TxCtx, _jobId: bigint): Claim | undefined => notBuilt();
export const finishJob = (_tx: TxCtx, _claim: Claim, _outcome: AiOutcome): void => notBuilt();
export const failJob = (_tx: TxCtx, _claim: Claim, _reason: string): void => notBuilt();
export const reapJobs = (_tx: TxCtx): void => undefined;

// The views.
export const mySeatView = (_ctx: ViewCtx<Schema>): Infer<typeof SeatView> | undefined => undefined;
export const myNamesView = (_ctx: ViewCtx<Schema>): Array<Infer<typeof NameView>> => [];
