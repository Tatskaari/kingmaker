import type { NotesRequest, NotesResponse } from "../../../shared/protocol/ai.ts";
import type { Handler } from "../context.ts";

/**
 * POST /v1/turns/notes (v5-design §3.6): the notes on a reply's marks. Until the notes are ported, no
 * notes: what the prototype answers when the model fails (notes.ts:342).
 */
export const notes: Handler<NotesRequest, NotesResponse> = async (_req, ctx) => ({ marks: [], usage: ctx.usage() });
