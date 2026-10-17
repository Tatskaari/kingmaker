// Copied from the prototype's src/runtime/jobs.ts:28-43 at 44c6d4a (rememberJob, the v2 approach's branch: memory "docs"), as an endpoint: the turn's snapshot is the request's working set (reviewedSource), the call log and the costs are the request's (reviewTurn's `calls`, its attention filter a JevDecider through them), and memory-reviews.jsonl is appended through the stores (Stores.reviews) rather than in the session's folder. No lock file: the simulation's job row is the lock.

import { reviewTurn } from "../../docs/reviews.ts";
import { workingSet } from "../../gm/working-set.ts";
import { JEV_MODEL, JevDecider } from "../../llm/decide.ts";
import type { RememberRequest, RememberResponse } from "../../../shared/protocol/ai.ts";
import type { AiContext } from "../context.ts";
import { reviewedSource } from "./reviewed.ts";
import { sceneAndView } from "./turn.ts";

/**
 * POST /v1/turns/remember (full-gm-design §4.1): the memory reviews of a turn once it's over, as the
 * prototype's job runs them. The attention filter (Jev) reads the turn's exchange; nothing flagged,
 * nothing more is asked (one call). Each agent the flags fire (the memories, then the lore) is a Luna
 * tool loop at medium effort that writes into the game's copy of the lore: first-person notes under
 * each person's memories, linked from their index, which disclosure opens from the next turn on. What
 * was flagged and what each review changed are a line in memory-reviews.jsonl, and the answer.
 *
 * The attention filter failing is a 500, with nothing written yet (the simulation's job tries again
 * or gives up with a log line); an agent's own failure is its record's `error`, as the prototype's is.
 */
export async function remember(req: RememberRequest, ctx: AiContext): Promise<RememberResponse> {
  const { scene, view } = sceneAndView(ctx, req.turn.scene.key, reviewedSource(req));
  const result = await reviewTurn(workingSet(scene, view), req.reviewed, { decider: new JevDecider(JEV_MODEL, "jev", ctx.calls), effort: "medium", calls: ctx.calls });
  ctx.reviews?.append(req.game.id, { turn: req.reviewed, at: new Date().toISOString(), ...result });
  return { ...result, usage: ctx.usage() };
}
