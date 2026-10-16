import type { CallContext } from "../llm/openrouter.ts";
import type { AiErrorCode, DecideRequest, DecideResponse, NotesRequest, NotesResponse, OpenRequest, OpenResponse, ReplyRequest, ReplyResponse, SettleRequest, SettleResponse, SuggestRequest, SuggestResponse, Usage } from "../../shared/protocol/ai.ts";
import type { Campaign } from "./campaigns.ts";
import type { StreamSink } from "./stream.ts";

/**
 * What an endpoint is handed besides its request (v0-design §5.3): the campaign version the game
 * plays, this request's model calls, a way to stream a reply as it's written, and the dispatch's
 * attempt. Nothing in it outlives the request.
 */
export interface AiContext {
  /** The request's campaign version: each scene with its words. */
  campaign: Campaign;
  /** This request's model transport, call log and costs. */
  calls: CallContext;
  /** What the calls have cost so far: the answer's usage. */
  usage(): Usage;
  /** The reply as it's written, to a turn's draft (open and reply only). */
  stream(turn: string): StreamSink;
  /** X-Km-Attempt: the dispatch's number, the stream's attempt. */
  attempt: number;
}

export type Handler<Req, Res> = (req: Req, ctx: AiContext) => Promise<Res>;

/**
 * The thinks: the opening, a turn's three, and the two beside a turn once its reply is in (the notes
 * on its marks, the lines suggested after it). The pipeline's (endpoints/*.ts) or the canned ones
 * (KM_AI_GM=canned).
 */
export interface Endpoints {
  open: Handler<OpenRequest, OpenResponse>;
  decide: Handler<DecideRequest, DecideResponse>;
  reply: Handler<ReplyRequest, ReplyResponse>;
  settle: Handler<SettleRequest, SettleResponse>;
  notes: Handler<NotesRequest, NotesResponse>;
  suggest: Handler<SuggestRequest, SuggestResponse>;
}

/** A request the service won't or can't answer, with its status and code ({ error: { code, message } }). */
export class Failure extends Error {
  readonly status: number;
  readonly code: AiErrorCode;
  constructor(status: number, code: AiErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
