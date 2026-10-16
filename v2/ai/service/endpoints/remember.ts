import type { RememberRequest, RememberResponse } from "../../../shared/protocol/ai.ts";
import type { AiContext } from "../context.ts";
import { canned } from "./canned.ts";

/**
 * POST /v1/turns/remember (full-gm-design §4.1): the memory reviews of a turn once it's over (the
 * prototype's rememberJob, jobs.ts:77-91): reviewTurn on the request's working set, the notes written
 * into the game's docs, the answer appended to memory-reviews.jsonl. A stub until the AI service's
 * package builds it: it answers as the canned GM does (nothing flagged, nothing reviewed).
 */
export function remember(req: RememberRequest, ctx: AiContext): Promise<RememberResponse> {
  return canned.remember(req, ctx);
}
