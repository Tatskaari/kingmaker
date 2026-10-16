import type { CallContext } from "../llm/openrouter.ts";
import type {
  AiErrorCode, BackstoriesRequest, BackstoriesResponse, CharactersRequest, CharactersResponse, ConsiderRequest, ConsiderResponse, DecideRequest, DecideResponse,
  NotesRequest, NotesResponse, OpenRequest, OpenResponse, RememberRequest, RememberResponse, RepairRequest, RepairResponse, ReplyRequest, ReplyResponse,
  SettleRequest, SettleResponse, SuggestRequest, SuggestResponse, Usage,
} from "../../shared/protocol/ai.ts";
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
  /** How long a considered turn's review may take before the plain check is rolled instead (KM_CONSIDER_DEADLINE_MS): the server's config, 12 s; absent in a test's context, 12 s too (config.ts CONSIDER_DEADLINE_MS). */
  considerDeadlineMs?: number;
}

export type Handler<Req, Res> = (req: Req, ctx: AiContext) => Promise<Res>;

/**
 * The thinks: the opening, a turn's own (decide, consider on a turn the GM rules on, reply, settle),
 * the two beside a turn once its reply is in (the notes on its marks, the lines suggested after it:
 * v5-design §3.6), the two in the background once it's over (the memory reviews and the co-GM:
 * full-gm-design §4.1); and character creation's two (v1-design §3.7), each serving several steps.
 * The pipeline's (endpoints/*.ts), or the canned ones (KM_AI_GM=canned: no model at all).
 */
export interface Endpoints {
  open: Handler<OpenRequest, OpenResponse>;
  decide: Handler<DecideRequest, DecideResponse>;
  /** The GM's ruling on an act the decider flagged, before the reply: cut off at the deadline, then the plain check to roll instead. */
  consider: Handler<ConsiderRequest, ConsiderResponse>;
  reply: Handler<ReplyRequest, ReplyResponse>;
  settle: Handler<SettleRequest, SettleResponse>;
  notes: Handler<NotesRequest, NotesResponse>;
  suggest: Handler<SuggestRequest, SuggestResponse>;
  /** The memory reviews of a turn once it's over: notes written into the game's docs, a line in memory-reviews.jsonl. */
  remember: Handler<RememberRequest, RememberResponse>;
  /** The background co-GM's review of a turn once it's over. */
  repair: Handler<RepairRequest, RepairResponse>;
  /** The builds: three offered (offer), the model's one (pick), the player's own made legal (own). */
  characters: Handler<CharactersRequest, CharactersResponse>;
  /** The backstory: a draft, notes worked in, the lore check, and what it says of them (traits). */
  backstories: Handler<BackstoriesRequest, BackstoriesResponse>;
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
