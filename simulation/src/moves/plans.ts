import type { Outcome, SidesRequest, TurnAct, TurnCheck } from "../../../shared/protocol/ai.ts";
import type { Act, Mechanic } from "../../../shared/rules/types.ts";

/**
 * The plans a move keeps in its job row between thinks (v0-design §4.3, §6.1): plain JSON, ids as
 * strings, enough for the next step's request and the commit after it.
 */

/** The scene's and the place's revs when a plan was made. A record, not a guard: the scene's lease is the guard, and a line queued while a turn settles moves the scene's rev on legitimately. */
export interface Seen { scene: number; place: number }

/**
 * The opening's plan: one think, POST /v1/scenes/open. With `aftermath` (story-design §4.3), the
 * scene picking up after a fight on a turn of its own: the think is told how the fight went, and its
 * commit applies what the stage manager says the aftermath did. With `act` (town-design §3.4), the
 * map's action menu opened it: once the opening is in, the commit queues the act as turn 1, its
 * words the player's line and its mechanic the turn's (the say plan's `forced`). A talk's opening (§3.6)
 * is told its own in the request (`talk`), and keeps the answer's prep.
 */
export interface OpenPlan { step: "open"; game: string; scene: string; turn: string; seen: Seen; aftermath?: { summary: string }; act?: { text: string; mechanic: Mechanic } }

/**
 * A say turn's plan: the two-part GM's reply, then its settle (on the wind-down, the reply alone).
 * Before the reply, a line that might be an act the rules resolve is asked what it is (the act
 * step), and an act that was violence draws the reactions of everyone who saw it (the reactions
 * step: world-bridge-design §3.4). A reply that rolls for initiative (or a settle that takes the scene
 * into a fight) leaves the people it put on no side to the sides step (docs/combat-gm.md).
 */
export interface SayPlan {
  step: "act" | "reactions" | "reply" | "settle" | "sides";
  game: string; scene: string; turn: string; n: number; player: string;
  input: string;
  /** settledFacts(gm) at the turn's start: the stage manager's `settled`. */
  settledBefore: string[];
  /** gm.closing was set when the turn started: this is the wind-down. */
  windDown: boolean;
  /**
   * What the rules did as the turn started, before the player acted (world-bridge-design §3.4: a
   * timed spell running out, fire's tick, coming round, a blow left hanging): their directives, which
   * lead the reply (Outcome.directives), and whether the blow put the player down (what they meant to
   * do doesn't happen) or met their Shield (a Shield they cast this turn is already up).
   */
  rulesFirst?: { directives: string[]; down: boolean; shielded: boolean };
  /** Why the line was asked what the rules resolve of it (shared/rules/acting.ts mightAct: "casting: cast"): the act step's, for the log. */
  acting?: string;
  /** The act the rules resolved, when it was violence people react to (scene-acts.ts violence): the reactions step's request. */
  act?: Act;
  /** What the rules resolved of the player's act this turn, its dice lines and the reactions to it: the settle's, for the co-GM. */
  acted?: TurnAct;
  outcome?: Outcome;
  /** The reply's plain text, for settle. */
  reply?: string;
  /** This turn's dice lines. */
  lines: string[];
  seen: Seen;
  /** What the rules resolve this turn, chosen already (town-design §3.4: turn.mechanic, the map's act), resolved as the turn starts. */
  forced?: Mechanic;
  /** What the rules resolved this turn of the player's line, as the act step read it. */
  read?: Mechanic;
  /** The check the two-part GM's mouthpiece called this turn, as rolled, for the co-GM. */
  check?: TurnCheck;
  /** A fight breaking out (docs/combat-gm.md): who's on which side, and who's the GM's to place (the sides step's request). */
  sides?: SidesRequest["sides"];
}

/** A turn's suggested lines (v5-design §3.4): one think, POST /v1/turns/suggest, for its k-th ask (from 1). */
export interface SuggestPlan { step: "suggest"; game: string; scene: string; turn: string; n: number; ask: number }

/**
 * The memory reviews of a turn once it's over (full-gm-design §4.2): one think in the background,
 * POST /v1/turns/remember. `n` is the turn reviewed: the request's transcript is cut there.
 */
export interface RememberPlan { step: "remember"; game: string; scene: string; turn: string; n: number }

/**
 * A scene's boundary once it has ended (story-design §4.3): one think, POST /v1/scenes/boundary,
 * keyed by the scene's last turn (`n`), its job the scene's and the game's with no turn. `exit`: the
 * exit it ended by; `candidates`: candidatesOf's scene keys, in order. Its commit leaves the scene
 * the answer chose waiting, with what was handed on, or opens it at once (a summons).
 */
export interface BoundaryPlan { step: "boundary"; game: string; scene: string; n: number; exit: string; candidates: string[] }

/**
 * The looks of what the stage manager made in a turn (town-design §3.7): one think beside the turn,
 * POST /v1/looks, keyed by the turn (`n`). `things`: each new thing's entity id (as a string), the key
 * its look is asked for by (its name in lower case: look_invention's) and its name and kind. Its
 * commit writes look_invention by key and a look row for each thing still there.
 */
export interface LookPlan { step: "look"; game: string; scene: string; turn: string; n: number; things: Array<{ entityId: string; key: string; name: string; kind?: string }> }
