import type { SuggestRequest, SuggestResponse } from "../../../shared/protocol/ai.ts";
import type { Handler } from "../context.ts";

/**
 * POST /v1/turns/suggest (v5-design §3.6): the lines to offer after a reply. Until suggest.ts is
 * ported, none: what the prototype lands when the model fails (suggest.ts:91).
 */
export const suggest: Handler<SuggestRequest, SuggestResponse> = async (_req, ctx) => ({ lines: [], dropped: [], usage: ctx.usage() });
