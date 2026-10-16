import type { RollResult } from "../dice.ts";
import type { GmState, OpenedNote, SceneStatus } from "../gm/state.ts";
import type { Markup } from "../markup.ts";
import type { Skill } from "../scene/types.ts";
import type { PlaceRows } from "../world/rows.ts";
import type { WorldOp } from "../world/scene-world.ts";
import type { Step } from "./keys.ts";

/**
 * The AI service's HTTP API: what the simulation POSTs for each step of a think, and what comes
 * back (v0-design §5.1-5.2, gm-port §13). Every request carries its working set, read in the
 * transaction that queued it, and its idempotency key; every answer is data the simulation commits.
 */

export type Endpoint = "/v1/scenes/open" | "/v1/turns/decide" | "/v1/turns/reply" | "/v1/turns/settle";

/** Each step's endpoint, and how long the simulation waits for it (under the procedures' 180 s cap). */
export const STEP_ENDPOINT: Record<Step, Endpoint> = { open: "/v1/scenes/open", decide: "/v1/turns/decide", reply: "/v1/turns/reply", settle: "/v1/turns/settle" };
export const STEP_TIMEOUT_MS: Record<Step, number> = { open: 60_000, decide: 20_000, reply: 60_000, settle: 60_000 };

/** The headers on a think's POST (and the answer's, when it was kept from before). Lower case, as HTTP/2 and fetch's Headers have them. */
export const HEADERS = {
  /** Equal to the body's `key`. */
  idempotencyKey: "idempotency-key",
  /** The dispatch's attempt (1, 2, …): the stream's attempt. */
  attempt: "x-km-attempt",
  /** "1" on an answer served from the store, no model called. */
  replayed: "x-km-replayed",
} as const;

/** Every request: which game and content, who's playing, and the key that makes a retry safe. */
export interface AiRequest {
  /** <game uid>:s<scene>:t<n>:<step>, also the Idempotency-Key header. */
  key: string;
  /** id: game.uid. */
  game: { id: string; campaign: string; version: string };
  /** The scene's controller. */
  player: { id: string; name: string };
}

export interface Usage { calls: number; costUsd: number; byOperation: Record<string, { calls: number; costUsd: number; ms: number }> }
export interface Entry { turn: number; speaker: string; kind: "player" | "narration" | "dialogue" | "roll" | "system"; text: string; markup?: Markup }
export interface SheetRow { name: string; concept: string; build?: string; skills: Partial<Record<Skill, number>>; status?: string }
export interface Story { time: string; day: number; flags: Record<string, string> }
/** markup: speech with cast keys where they resolve. */
export interface Reply { speaker: "gm"; kind: "narration"; text: string; markup?: Markup }

/** A turn's working set, read in the transaction that queued the think: everything the GM may need. */
export interface TurnContext {
  scene: { id: string; key: string; kind: "scene"; turn: number };
  /** The controller's character's key ("pc:1"): the world's "player". */
  pc: string;
  gm: GmState;
  /** The scene's, with this turn's line and dice lines. */
  transcript: Entry[];
  /** speaker "player:<id>". */
  line: { speaker: string; text: string };
  /** The place's rows, ids as strings, the log's last six. */
  world: PlaceRows;
  /** V0: the controller's sheet only. */
  party: SheetRow[];
  /** Advisory: the service runs presentCast itself. */
  present: Array<{ key: string; name: string; called?: string }>;
  story: Story;
}

export interface OpenRequest extends AiRequest {
  scene: { id: string; key: string; kind: "scene" };
  pc: string; gm: GmState; world: PlaceRows; party: SheetRow[]; story: Story;
  /** The opening's turn (turn 0), for stream_reply. */
  stream: { turn: string };
}
export interface OpenResponse { present: string[]; entries: Reply[]; opened: OpenedNote[]; usage: Usage }

export interface Check { skill: Skill; dc: number; reason?: string }
export interface Decision {
  /** A route and its check, the skill already the player's means. */
  route?: { id: string; phase: "attempt" | "cue"; check?: Check; theirs?: boolean };
  /** An outcome route the turn simply achieves (== route.id: it ends the scene now). */
  plain?: string;
  sameAgain?: { route: string; answer?: string };
  earned: boolean; daft: boolean; outOfCharacter: boolean;
  limit?: string; answering?: boolean; remembered?: string[];
}
/** landed: [] in V0 (no world clock). */
export interface DecideRequest extends AiRequest { turn: TurnContext; landed: string[] }
export interface DecideResponse { decision: Decision; opened: OpenedNote[]; usage: Usage }

/** What the decide commit did: the reply builds its directives from it. */
export interface Outcome {
  /** This turn's dice lines. */
  lines: string[];
  /** The rules' lines: [] in V0. */
  directives: string[];
  move?: { route: string; phase: "attempt" | "cue"; from: string; to: string; roll?: RollResult; exit?: string; chosen: boolean };
  taken?: { ended?: string; closing?: string; pendingExit?: string };
  held?: "ooc" | "brink" | "closes";
  pending?: { exit: string };
  wasStuck: boolean;
  closes?: string;
  windDown?: { exit: string };
}
export interface ReplyRequest extends AiRequest { turn: TurnContext; decision: Decision; outcome: Outcome; stream: { turn: string } }
export interface ReplyResponse { entries: Reply[]; gm: { offered?: string; repeated: string | null }; firstTextMs: number | null; usage: Usage }

/** reply: plain text. */
export interface SettleRequest extends AiRequest { turn: TurnContext; reply: string; lines: string[]; settled: string[] }
export interface After {
  outcome?: { route: string; check?: Check };
  ending?: { exitId: string; probability: number };
  status?: SceneStatus;
  landed: string[]; hinted: string[]; unanswered: boolean; theirs: boolean;
}
/** ops: at most 16, by game key; after absent when the reply closed the scene. */
export interface SettleResponse { ops: WorldOp[]; after?: After; usage: Usage }

export type AiErrorCode = "bad_request" | "unauthorised" | "other_campaign" | "key_reused" | "model_failed" | "not_ready";
export interface AiError { error: { code: AiErrorCode; message: string } }

/** GET /v1/health (no bearer needed; `?deep=1` also calls service_ping as the service). */
export interface Health {
  ok: boolean;
  model: "openrouter" | "fake";
  gm: "pipeline" | "canned";
  /** Installed campaign versions: "caerwyn@0.1.0". */
  campaigns: string[];
  /** The request's bearer, if it sent one. */
  token: "accepted" | "refused" | "absent";
  /** With ?deep=1: "ok", or why service_ping failed. */
  stdb?: string;
}

/** PUT /v1/campaigns/{campaign}/{version}: the whole campaign folder, by path ("scenes/hanged-clerk/setting.md"). */
export interface CampaignPut { files: Record<string, string> }
/** How many files it stored, and the scenes it loaded with their words. */
export interface CampaignPutAnswer { campaign: string; version: string; files: number; scenes: string[] }

/**
 * stream_reply's arguments, as the AI service POSTs them to `/v1/database/<db>/call/stream_reply`:
 * named by their TypeScript names, a u64 as a number, the markup as JSON in SpacetimeDB's option.
 */
export interface StreamReplyArgs { turnId: number; attempt: number; seq: number; speaker: string; text: string; markup: { some: string } | { none: [] }; done: boolean }

export function streamReplyArgs(post: { turn: string; attempt: number; seq: number; speaker: string; text: string; markup?: Markup; done: boolean }): StreamReplyArgs {
  return {
    turnId: Number(post.turn), attempt: post.attempt, seq: post.seq, speaker: post.speaker, text: post.text,
    markup: post.markup ? { some: JSON.stringify(post.markup) } : { none: [] }, done: post.done,
  };
}
