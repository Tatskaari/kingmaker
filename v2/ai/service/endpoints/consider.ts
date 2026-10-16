import type { ConsiderRequest, ConsiderResponse } from "../../../shared/protocol/ai.ts";
import type { AiContext } from "../context.ts";
import { canned } from "./canned.ts";

/**
 * POST /v1/turns/consider (full-gm-design §4.1): the GM's ruling on an act the decider flagged,
 * before the reply. The review (the prototype's consider.ts, copied to gm/consider.ts) runs with its
 * watchdog at ctx.considerDeadlineMs; with a ruling, its verdict, its refusal for a no and its route
 * come back; without one, the plain check to roll instead, from director.freeform. A 200 either way.
 * A stub until the AI service's package builds it: it answers as the canned GM does (no ruling, and
 * no check to roll).
 */
export function consider(req: ConsiderRequest, ctx: AiContext): Promise<ConsiderResponse> {
  return canned.consider(req, ctx);
}
