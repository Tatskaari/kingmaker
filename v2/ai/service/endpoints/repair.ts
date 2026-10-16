import type { RepairRequest, RepairResponse } from "../../../shared/protocol/ai.ts";
import type { AiContext } from "../context.ts";
import { canned } from "./canned.ts";

/**
 * POST /v1/turns/repair (full-gm-design §4.1): the background co-GM's review of a turn once it's over
 * (the prototype's repairJob, jobs.ts:94-105): runRepair on the request's view, its turn the one
 * reviewed. A stub until the AI service's package builds it: it answers as the canned GM does (on
 * track, nothing to steer).
 */
export function repair(req: RepairRequest, ctx: AiContext): Promise<RepairResponse> {
  return canned.repair(req, ctx);
}
