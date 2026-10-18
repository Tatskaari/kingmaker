// Copied from the prototype's src/runtime/jobs.ts:45-57 at 44c6d4a (repairJob), as an endpoint: the saved session is the request's working set (reviewedSource), the scene is the campaign's as authored (runRepair applies the patches), the call goes through the request's call context, the effort is the v2 approach's (no repairEffort: medium), and the review is answered rather than written to repair-NNN.json (the simulation keeps it in a co_gm_result row). No lock file: the simulation's job row is the lock.

import { runRepair } from "../../gm/repair.ts";
import type { RepairRequest, RepairResponse } from "../../../shared/protocol/ai.ts";
import type { Handler } from "../context.ts";
import { reviewedSource } from "./reviewed.ts";
import { sceneAndView } from "./turn.ts";

/**
 * POST /v1/turns/repair (full-gm-design §4.1): the background co-GM's review of a turn once it's
 * over (gm/repair.ts): how the scene is going, notes for the GM and whispers to the cast for the next
 * replies, canon to keep, routes and a bridging beat for where play went, and a forward move of the
 * tracker, its turn the one reviewed. It waits in a co_gm_result row until the next turn's start
 * merges it. A model that fails is a 500 (the simulation's job tries again, then gives up with a log
 * line, as the prototype's job ended with no file).
 */
export const repair: Handler<RepairRequest, RepairResponse> = async (req, ctx) => {
  const { view } = sceneAndView(ctx, req.turn.scene.key, reviewedSource(req));
  const review = await runRepair(ctx.campaign.scene(req.turn.scene.key), view, { effort: "medium", calls: ctx.calls });
  review.turn = req.reviewed;
  return { review, usage: ctx.usage() };
};
