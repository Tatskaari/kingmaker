import type { BoundaryRequest, BoundaryResponse } from "../../../shared/protocol/ai.ts";
import type { Handler } from "../context.ts";
import { canned } from "./canned.ts";

/**
 * POST /v1/scenes/boundary (story-design §4.4): the boundary after a scene ends, as the prototype's
 * chainScene crosses it. Until package C copies the prototype's boundary in (ai/gm/boundary.ts,
 * owed.ts, presence.ts), it answers as the canned GM does: the first scene the story could go to,
 * the fallback hand-off, nothing rewritten and no docs, so a stack crosses every boundary meanwhile.
 */
export const boundary: Handler<BoundaryRequest, BoundaryResponse> = (req, ctx) => canned.boundary(req, ctx);
