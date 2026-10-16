import type { Ruling, Verdict } from "../../../shared/gm/consider.ts";
import type { GmState } from "../../../shared/gm/state.ts";
import type { Decision, Drafted, Outcome } from "../../../shared/protocol/ai.ts";
import type { Transition } from "../../../shared/scene/types.ts";

/**
 * The plans a move keeps in its job row between thinks (v0-design §4.3, §6.1): plain JSON, ids as
 * strings, enough for the next step's request and the commit after it.
 */

/** The scene's and the place's revs when a plan was made. A record, not a guard: the scene's lease is the guard, and a line queued while a turn settles moves the scene's rev on legitimately. */
export interface Seen { scene: number; place: number }

/**
 * The opening's plan: one think, POST /v1/scenes/open. With `aftermath` (story-design §4.3), the
 * scene picking up after a fight on a turn of its own: the think is told how the fight went, and its
 * commit applies what the stage manager says the aftermath did.
 */
export interface OpenPlan { step: "open"; game: string; scene: string; turn: string; seen: Seen; aftermath?: { summary: string } }

/**
 * A say turn's plan: decide, then reply, then settle (or, on the wind-down, decide and reply). A turn
 * the GM rules on (full-gm-design §4.2) has consider between decide and reply.
 */
export interface SayPlan {
  step: "decide" | "consider" | "reply" | "settle";
  game: string; scene: string; turn: string; n: number; player: string;
  input: string;
  /** Who was on stage as the player spoke (presentCast): whyItWaits' arrivals. */
  onStage: string[];
  /** settledFacts(gm) at the turn's start: the stage manager's `settled`. */
  settledBefore: string[];
  /** gm.closing was set when the turn started: this is the wind-down. */
  windDown: boolean;
  decision?: Decision;
  /**
   * A considered turn's: the ending held for the player's answer, which the decide commit took off
   * the bookkeeping (consider's `pending`, and the held ending the consider commit decides).
   */
  pendingExit?: GmState["pendingExit"];
  /** A considered turn's, from the consider answer: the GM's ruling, its verdict and its route. */
  ruling?: Ruling;
  verdict?: Verdict;
  route?: Transition;
  /** What the ruling's outcome not played would have brought out: it doesn't land this turn, whatever the reply let slip (landRuling, at the settle). */
  withheld?: string[];
  outcome?: Outcome;
  /** The reply's plain text, for settle. */
  reply?: string;
  /** This turn's dice lines. */
  lines: string[];
  seen: Seen;
}

/**
 * The notes on a reply's marks (v5-design §3.4): one think, POST /v1/turns/notes. `seq` is the
 * reply's transcript row; `drafted`, the marks the GM made as it wrote, which the row never keeps
 * (only their notes, once written, reach it), so the request is built from the plan.
 */
export interface NotesPlan { step: "notes"; game: string; scene: string; turn: string; n: number; seq: number; drafted: Drafted[] }

/** A turn's suggested lines (v5-design §3.4): one think, POST /v1/turns/suggest, for its k-th ask (from 1). */
export interface SuggestPlan { step: "suggest"; game: string; scene: string; turn: string; n: number; ask: number }

/**
 * The memory reviews of a turn once it's over (full-gm-design §4.2): one think in the background,
 * POST /v1/turns/remember. `n` is the turn reviewed: the request's transcript is cut there.
 */
export interface RememberPlan { step: "remember"; game: string; scene: string; turn: string; n: number }

/**
 * The background co-GM's review of a turn once it's over (full-gm-design §4.2): one think, POST
 * /v1/turns/repair, its answer a co_gm_result row the next turn's start merges. `n` as remember's.
 */
export interface RepairPlan { step: "repair"; game: string; scene: string; turn: string; n: number }

/**
 * A scene's boundary once it has ended (story-design §4.3): one think, POST /v1/scenes/boundary,
 * keyed by the scene's last turn (`n`), its job the scene's and the game's with no turn. `exit`: the
 * exit it ended by; `candidates`: candidatesOf's scene keys, in order. Its commit leaves the scene
 * the answer chose waiting, with what was handed on, or opens it at once (a summons).
 */
export interface BoundaryPlan { step: "boundary"; game: string; scene: string; n: number; exit: string; candidates: string[] }
