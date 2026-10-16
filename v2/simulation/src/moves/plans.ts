import type { Decision, Outcome } from "../../../shared/protocol/ai.ts";

/**
 * The plans a move keeps in its job row between thinks (v0-design §4.3, §6.1): plain JSON, ids as
 * strings, enough for the next step's request and the commit after it.
 */

/** The scene's and the place's revs when a plan was made. A record, not a guard: the scene's lease is the guard, and a line queued while a turn settles moves the scene's rev on legitimately. */
export interface Seen { scene: number; place: number }

/** The opening's plan: one think, POST /v1/scenes/open. */
export interface OpenPlan { step: "open"; game: string; scene: string; turn: string; seen: Seen }

/** A say turn's plan: decide, then reply, then settle (or, on the wind-down, decide and reply). */
export interface SayPlan {
  step: "decide" | "reply" | "settle";
  game: string; scene: string; turn: string; n: number; player: string;
  input: string;
  /** Who was on stage as the player spoke (presentCast): whyItWaits' arrivals. */
  onStage: string[];
  /** settledFacts(gm) at the turn's start: the stage manager's `settled`. */
  settledBefore: string[];
  /** gm.closing was set when the turn started: this is the wind-down. */
  windDown: boolean;
  decision?: Decision;
  outcome?: Outcome;
  /** The reply's plain text, for settle. */
  reply?: string;
  /** This turn's dice lines. */
  lines: string[];
  seen: Seen;
}
