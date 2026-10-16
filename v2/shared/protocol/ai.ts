import type { Asked, Backstory, LoreIssue, Who } from "../creation/types.ts";
import type { RollResult } from "../dice.ts";
import type { Ruling, RulingOutcome, Verdict } from "../gm/consider.ts";
import type { RepairResult } from "../gm/repair.ts";
import type { GmState, OpenedNote, OwedRow, ScenePatch, SceneStatus } from "../gm/state.ts";
import type { Mark, MarkKind, Markup, Speech } from "../markup.ts";
import type { Act, BuildOption, FeatureRef, Mechanic, Offer, OwnPicks, Reaction, SpellRef, SrdLists, ThreatRead, WeaponRef } from "../rules/types.ts";
import type { Skill, Transition } from "../scene/types.ts";
import type { PlaceRows } from "../world/rows.ts";
import type { WorldOp } from "../world/scene-world.ts";
import type { CreationStep, Step } from "./keys.ts";

/**
 * The AI service's HTTP API: what the simulation POSTs for each step of a think, and what comes
 * back (v0-design §5.1-5.2, gm-port §13; the notes and the suggested lines, v5-design §3.6;
 * character creation's two, v1-design §3.7; a considered turn's ruling, and the memory reviews and
 * the co-GM after a turn, full-gm-design §4.1; the rules' act in a turn and the reactions to it,
 * world-bridge-design §3.1; the boundary between scenes and a fight's aftermath, story-design §4.2).
 * Every request carries its working set, read in the transaction that queued it, and its
 * idempotency key; every answer is data the simulation commits.
 */

export type Endpoint =
  | "/v1/scenes/open" | "/v1/turns/decide" | "/v1/turns/reactions" | "/v1/turns/consider" | "/v1/turns/reply" | "/v1/turns/settle" | "/v1/turns/notes" | "/v1/turns/suggest"
  | "/v1/turns/remember" | "/v1/turns/repair" | "/v1/scenes/boundary"
  | "/v1/characters" | "/v1/backstories";

/**
 * Each step's endpoint, and how long the simulation waits for it (under the procedures' 180 s cap).
 * The reactions are one decider call (about 0.3 s), waited for as long as the decision; the ruling's
 * review is cut off at 12 s (KM_CONSIDER_DEADLINE_MS), then the plain check is asked for; a memory
 * review's or the co-GM's tool loops can take a minute and more; a boundary's three calls at once,
 * then presence, about 10 to 20 s on real models.
 */
export const STEP_ENDPOINT: Record<Step | CreationStep, Endpoint> = {
  open: "/v1/scenes/open", decide: "/v1/turns/decide", reactions: "/v1/turns/reactions", consider: "/v1/turns/consider", reply: "/v1/turns/reply", settle: "/v1/turns/settle",
  notes: "/v1/turns/notes", suggest: "/v1/turns/suggest", remember: "/v1/turns/remember", repair: "/v1/turns/repair", boundary: "/v1/scenes/boundary",
  offer: "/v1/characters", pick: "/v1/characters", own: "/v1/characters",
  draft: "/v1/backstories", work: "/v1/backstories", check: "/v1/backstories", traits: "/v1/backstories",
};
export const STEP_TIMEOUT_MS: Record<Step | CreationStep, number> = {
  open: 60_000, decide: 20_000, reactions: 20_000, consider: 20_000, reply: 60_000, settle: 60_000, notes: 30_000, suggest: 30_000, remember: 170_000, repair: 170_000, boundary: 120_000,
  offer: 60_000, pick: 60_000, own: 30_000, draft: 60_000, work: 60_000, check: 60_000, traits: 60_000,
};

/** The headers on a think's POST (and the answer's, when it was kept from before). Lower case, as HTTP/2 and fetch's Headers have them. */
export const HEADERS = {
  /** Equal to the body's `key`. */
  idempotencyKey: "idempotency-key",
  /** The dispatch's attempt (1, 2, …): the stream's attempt. */
  attempt: "x-km-attempt",
  /** "1" on an answer served from the store, no model called. */
  replayed: "x-km-replayed",
} as const;

/** What every request carries: which game and content, and the key that makes a retry safe. */
export interface AiRequestBase {
  /** <game uid>:s<scene>:t<n>:<step>, or a creation's <uid>:c<rev>:<step>; also the Idempotency-Key header. */
  key: string;
  /** id: game.uid (a creation's uid, which the game made from it takes). */
  game: { id: string; campaign: string; version: string };
}

/** A scene's request: the base, and who's playing (creation has nobody yet). */
export interface AiRequest extends AiRequestBase {
  /** The scene's controller. */
  player: { id: string; name: string };
}

export interface Usage { calls: number; costUsd: number; byOperation: Record<string, { calls: number; costUsd: number; ms: number }> }
/** A transcript entry. scene: the scene's key, on an entry of an earlier scene (Story.earlier), as the prototype's entries have it. */
export interface Entry { turn: number; speaker: string; kind: "player" | "narration" | "dialogue" | "roll" | "system"; text: string; markup?: Markup; scene?: string }
/**
 * A player's sheet as the GM is told it; backstory: theirs from character creation, when they wrote
 * one (the brief and the player's doc read it). The spells ready, the weapons carried and the class
 * features with uses are the sheet row's own columns (world-bridge-design §3.1): what the decider
 * offers the rules' act (director.ts's RulesOptions).
 */
export interface SheetRow {
  name: string; concept: string; build?: string; skills: Partial<Record<Skill, number>>; status?: string; backstory?: Backstory;
  spells?: SpellRef[];
  weapons?: WeaponRef[];
  features?: Array<FeatureRef & { target: "self" | "creature" }>;
}
/**
 * The story so far, beside the scene: the time of day, the day, the flags its endings set; and
 * (story-design §4.2) the scenes played before this one, oldest first, as the prototype's session's
 * `history`, and every entry of theirs, in order, each with its scene's key (without markup), as the
 * prototype's transcript holds the whole story. Both are absent (none) in a request built before
 * the story unit, and in a game's first scene.
 */
export interface Story { time: string; day: number; flags: Record<string, string>; history?: Chapter[]; earlier?: Entry[] }

/**
 * A scene played, as the prototype's session's history has it (src/runtime/session.ts:337-345):
 * its key and the exit it ended by, the hand-off, its last moments, the scenes the boundary skipped
 * and why, what moved in the fronts, the notebook's lines its ending wrote, and the facts settled in it.
 */
export interface Chapter {
  sceneId: string; exitId: string; summary: string;
  lastMoments?: string[]; skipped?: Array<{ sceneId: string; why: string }>; fronts?: string[]; journal?: string[]; facts?: string[];
}
/**
 * A GM's entry. markup: who says each line, by game key where it resolves, and no marks (their notes
 * are written after, from what the player knows). drafted: the marks the GM made as it wrote.
 */
export interface Reply { speaker: "gm"; kind: "narration"; text: string; markup?: Markup; drafted?: Drafted[] }
/** A mark the GM made as it wrote: where, and what kind. Its own note is never kept (the prototype's notes.ts:23). */
export interface Drafted { start: number; end: number; kind: MarkKind }
/**
 * A line the player might say or do next (the prototype's session.ts:192), as they'd type it:
 * something to say, a deed in brackets, a risky try in brackets that would call for a roll, or a way
 * to leave.
 */
export interface Suggestion { kind: "say" | "do" | "try" | "leave"; text: string }

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

/** The scene's working set with no line in it: what a job beside a turn reads (an opening has no line). */
export type SceneContext = Omit<TurnContext, "line">;

/**
 * POST /v1/scenes/open: a scene's opening; or, with `aftermath`, the scene picking up after a fight
 * (story-design §4.4: the prototype's resumeAfterFight), told from the fight's summary in place of
 * the opening, on a turn of its own, the scene's transcript and world as the fight left them.
 */
export interface OpenRequest extends AiRequest {
  scene: { id: string; key: string; kind: "scene" };
  pc: string; gm: GmState; world: PlaceRows; party: SheetRow[]; story: Story;
  /** The opening's turn (turn 0; an aftermath's own), for stream_reply. */
  stream: { turn: string };
  /** The scene picks up after a fight: how it went. */
  aftermath?: { summary: string };
  /** An aftermath's: the scene's transcript so far (an opening has none). */
  transcript?: Entry[];
}
/** ops: an aftermath's, what the stage manager says it did to the world (at most 16, by game key), applied through the gate. */
export interface OpenResponse { present: string[]; entries: Reply[]; opened: OpenedNote[]; ops?: WorldOp[]; usage: Usage }

export interface Check { skill: Skill; dc: number; reason?: string }
export interface Decision {
  /** A route and its check, the skill already the player's means. */
  route?: { id: string; phase: "attempt" | "cue"; check?: Check; theirs?: boolean };
  /** An outcome route the turn simply achieves (== route.id: it ends the scene now). */
  plain?: string;
  sameAgain?: { route: string; answer?: string };
  earned: boolean; daft: boolean; outOfCharacter: boolean;
  limit?: string; answering?: boolean; remembered?: string[];
  /**
   * Considered rolls (the prototype's PreDecision.considered): the player is attempting something a
   * roll should settle that none of the scene's routes does, so the GM rules on it before replying
   * (POST /v1/turns/consider). Nothing was rolled or moved for it. `routes`: the routes with a roll
   * the decider leant towards, nearest first; `means`: the method, when it's sure; `earned`: how far
   * it thought the player had already met the person's terms, when it half thought so.
   */
  considered?: { probability: number; routes: Array<{ id: string; p: number }>; means?: Skill; earned?: number };
  /** The player is pursuing a way through the scene that none of its routes covers: the co-GM reviews the turn (unless a ruling answers it). */
  offGraph?: boolean;
  /**
   * The plain route was read with an attempt's confidence: it's the prep's own answer to the turn (a
   * bribe gets haggling, trust needs no roll), so no ruling of the GM's overrides it, whatever
   * off_graph says.
   */
  byPrep?: boolean;
  /**
   * What the player is doing that the D&D rules resolve, and with what (world-bridge-design §3.1): a
   * spell, a blow, a grab or a shove, a jump, a class feature, a rest. The decide commit resolves it
   * on the scene's world. A route's check the act held back (director.ts:938) comes back as `route`
   * only when the player is also doing what the check is for.
   */
  mechanic?: Mechanic;
}
/** landed: [] in V0 (no world clock). */
export interface DecideRequest extends AiRequest { turn: TurnContext; landed: string[] }
export interface DecideResponse { decision: Decision; opened: OpenedNote[]; usage: Usage }

/** What the decide commit did: the reply builds its directives from it. */
export interface Outcome {
  /** This turn's dice lines. */
  lines: string[];
  /**
   * The rules' directives from before the player acted (world-bridge-design §3.4: a timed spell
   * running out, fire's tick, coming round, a blow left hanging): first in the reply.
   */
  directives: string[];
  move?: { route: string; phase: "attempt" | "cue"; from: string; to: string; roll?: RollResult; exit?: string; chosen: boolean };
  taken?: { ended?: string; closing?: string; pendingExit?: string };
  held?: "ooc" | "brink" | "closes";
  pending?: { exit: string };
  wasStuck: boolean;
  closes?: string;
  windDown?: { exit: string };
  /**
   * A considered turn's ruling, as the consider commit played it (Decision.considered is the
   * decider's read that asked for it): the ruling and its verdict, its route, how it went (with its
   * roll, when the verdict was one), where it took the scene from and to, the ending it reached, and
   * whether that's the player's choice.
   */
  ruled?: { ruling: Ruling; verdict: Verdict; route: Transition; went: "success" | "failure"; roll?: RollResult; from: string; to: string; exit?: string; chosen: boolean };
  /** A considered turn with no ruling (the review failed, or ran past its deadline): the plain check rolled instead, and its dice line's reason. */
  freeform?: { skill: Skill; dc: number; roll: RollResult; reason: string };
  /**
   * The rules' act's directive (what they decided, for the GM to narrate) and the reactions' to it,
   * in that order (world-bridge-design §3.2): after the move's lines, before a ruling's.
   */
  acts?: string[];
  /** The player's violence started a fight this turn: the move's closing lines are dropped, and the reply ends on the fight breaking out. */
  brawl?: boolean;
}
export interface ReplyRequest extends AiRequest { turn: TurnContext; decision: Decision; outcome: Outcome; stream: { turn: string } }
export interface ReplyResponse { entries: Reply[]; gm: { offered?: string; repeated: string | null }; firstTextMs: number | null; usage: Usage }

/** reply: plain text. */
export interface SettleRequest extends AiRequest { turn: TurnContext; reply: string; lines: string[]; settled: string[] }
export interface After {
  /**
   * An outcome route the reply achieved, with its check for the simulation to roll. `exit`: the
   * authored ending an improvised outcome gives way to, read at 0.2 or more (the prototype's
   * director.ts:1330-1333).
   */
  outcome?: { route: string; check?: Check; exit?: string };
  ending?: { exitId: string; probability: number };
  status?: SceneStatus;
  landed: string[]; hinted: string[]; unanswered: boolean; theirs: boolean;
  /**
   * The player has left the scene's place altogether: an ending of their own. Asked when the
   * character is the rules engine's, read at 0.7 (director.ts:1280-1283, :1350).
   */
  left?: boolean;
  /**
   * What the reply left hanging over the player, read at 0.6 when the character is the rules
   * engine's (director.ts:1284-1295, :1343-1349): someone's blow, or a danger with its severity. The
   * settle commit keeps it in gm_state, and it lands as the next turn starts.
   */
  threat?: ThreatRead;
  /** The threat question's raw choice ("attack:kell", "hazard:grab_or_shove", "none"): a hold the reply no longer has them in lets them go (threats.ts holdAfterReply). */
  threatRead?: string;
}
/** ops: at most 16, by game key; after absent when the reply closed the scene. */
export interface SettleResponse { ops: WorldOp[]; after?: After; usage: Usage }

/**
 * POST /v1/turns/consider (full-gm-design §4.1): the GM's ruling on an act the decider flagged
 * (Decision.considered, or a plan off the graph), before the reply. turn: the turn's working set as
 * the decide commit left it; read: the decider's read; pending: the ending held for the player's
 * answer, which the decide commit took off the bookkeeping.
 */
export interface ConsiderRequest extends AiRequest { turn: TurnContext; read?: Decision["considered"]; pending?: GmState["pendingExit"] }
/**
 * The ruling, its verdict, its route, and for a no without dice the refusal it plays; or, with no
 * ruling (the review failed, or ran past its deadline: `error`), the plain check to roll instead
 * when the decider wanted a roll (`fallback`, with its dice line's reason). ms: how long the review
 * took. A 200 either way.
 */
export interface ConsiderResponse {
  ruling?: Ruling; verdict?: Verdict; route?: Transition; refusal?: RulingOutcome;
  fallback?: { skill: Skill; dc: number; reason: string };
  error?: string; ms: number; usage: Usage;
}

/**
 * POST /v1/turns/reactions (world-bridge-design §3.1): everyone who saw the player's violence reacts,
 * each by their own lights, before the GM says a word (the prototype's decideReactions). turn: the
 * turn's working set as the decide commit left it (the world after the act); act: what the rules
 * decided it did (scene-acts.ts violence).
 */
export interface ReactionsRequest extends AiRequest { turn: TurnContext; act: Act }
/**
 * Each witness's reaction, by the world's local id (which both sides rebuild alike: keysFor), and
 * the GM's direction for them (reactionDirective). No reactions, no directive and no model call when
 * nobody saw it.
 */
export interface ReactionsResponse { reactions: Record<string, Reaction>; directive?: string; usage: Usage }

/**
 * POST /v1/turns/remember (full-gm-design §4.1): the memory reviews of a turn once it's over (the
 * attention filter, then the memories and lore agents it fires), written into the game's docs.
 * turn: the scene up to and including the reviewed turn; reviewed: its number.
 */
export interface RememberRequest extends AiRequest { turn: SceneContext; reviewed: number }
/** What the attention filter flagged, and each review it fired: what it changed, or why it failed. */
export interface RememberResponse { flags: string[]; reviews: ReviewRecord[]; usage: Usage }
/** A memory review's record, as v2/ai/docs/reviews.ts makes it (its shape written out here: shared imports nothing of the AI service's). */
export interface ReviewRecord { kind: "memories" | "lore"; summary: string; changes: string[]; costUsd: number; latencyMs: number; error?: string }

/** POST /v1/turns/repair (full-gm-design §4.1): the background co-GM's review of a turn once it's over. turn and reviewed as remember's. */
export interface RepairRequest extends AiRequest { turn: SceneContext; reviewed: number }
/** The review (its turn the one reviewed): it waits in a co_gm_result row until the next turn's start merges it. */
export interface RepairResponse { review: RepairResult; usage: Usage }

/**
 * POST /v1/turns/notes: the notes on a reply's marks, written from what the player knows, placed on
 * its words, linked and carded. turn: the transcript up to and including the reply.
 */
export interface NotesRequest extends AiRequest {
  turn: SceneContext;
  /** The reply's transcript seq, its words, who says each line (by game key) and the GM's marks. */
  reply: { seq: number; text: string; speech: Speech[]; drafted: Drafted[] };
}
/** People by game key; [] when there was nothing to note, or the model failed (a 200 all the same). */
export interface NotesResponse { marks: Mark[]; usage: Usage }

/** POST /v1/turns/suggest: the lines to offer after a reply. turn: the transcript up to and including the reply. */
export interface SuggestRequest extends AiRequest {
  turn: SceneContext;
  /** The scene's last set, in order: none of them again. */
  offered: string[];
}
/** The lines in the order shown, and what was screened out and why; none when the model failed (a 200 all the same). */
export interface SuggestResponse { lines: Suggestion[]; dropped: Array<{ text: string; why: string }>; usage: Usage }

/**
 * POST /v1/scenes/boundary (story-design §4.4): the boundary after a scene ends, as the prototype's
 * chainScene crosses it. turn: the ended scene's working set, its gm, transcript ("Scene ends: …"
 * last) and world as it ended, `afterwards` applied, and the story before it; exit: the exit it
 * ended by; candidates: the scenes the story could go to, in order (shared/scene/graph.ts
 * candidatesOf: the exit's next, interludes skipped, then where each overtaken one goes), six at most.
 */
export interface BoundaryRequest extends AiRequest { turn: SceneContext; exit: string; candidates: string[] }
/**
 * The boundary crossed: the hand-off ("Previous scene, \"The Hanged Clerk\", ended: …"), the ended
 * scene's last four moments, and the scene the story goes to, with what's handed on to it (the
 * scenes skipped and why, where its prep is out of date, its opening rewritten, the lead, the cast
 * absent, its prep's patches with what's owed brought over, the owed essentials already hinted at);
 * what the story still owes after it, its things by entity key; and what moved in the fronts.
 * The game's docs (the ending's memories, the time between, the played scene, the fronts) are
 * written by then, once per key.
 */
export interface BoundaryResponse {
  handOff: string;
  lastMoments: string[];
  next: {
    scene: string; skipped: Array<{ sceneId: string; why: string }>; adjustments: string[]; opening?: string; lead?: string;
    absent: string[]; patches: ScenePatch[]; hinted: string[];
  };
  owed: OwedRow[];
  fronts: string[];
  usage: Usage;
}

// ---------------------------------------------------------------------------------------------
// Character creation (v1-design §3.7): before there's a game, so no player and no scene.

/** What's asked of the builds: three to choose from, the model's one, or the player's own picks made legal. */
export type CharactersAsk = { kind: "three" } | { kind: "one" } | { kind: "own"; picks: OwnPicks };
/** POST /v1/characters: who they are, the level they start at, and what's asked. */
export interface CharactersRequest extends AiRequestBase { who: { name: string; concept: string }; level: number; ask: CharactersAsk }
/**
 * The answer: three's `offer`; one's or own's `option`, or, for own picks that aren't on the SRD's
 * lists, `refusal` (its words). An own answer brings the `lists` to pick from (a refusal always
 * does): the creation keeps them.
 */
export interface CharactersResponse { offer?: Offer; option?: BuildOption; refusal?: string; lists?: SrdLists; usage: Usage }

/** What's asked of the backstory: a draft, the player's notes worked in, the lore check, or what it says of them. */
export type BackstoryOp = "draft" | "work" | "check" | "traits";
/** POST /v1/backstories: who it's for (name, concept, the build's line), and the text (the box's; empty for a draft). */
export interface BackstoriesRequest extends AiRequestBase { op: BackstoryOp; who: Who; text: string }
/** The answer: draft's and work's `asked`, check's `checked`, traits' `backstory`. */
export interface BackstoriesResponse { asked?: Asked<string>; checked?: Asked<LoreIssue[]>; backstory?: Backstory; usage: Usage }

// ---------------------------------------------------------------------------------------------

/** over_budget (402): today's spending is past the service's daily ceiling (KM_AI_DAILY_USD). */
export type AiErrorCode = "bad_request" | "unauthorised" | "other_campaign" | "key_reused" | "model_failed" | "not_ready" | "over_budget";
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
  /** The daily ceiling in dollars (0: none) and what today's (UTC) calls have cost so far. */
  budget: { dailyUsd: number; spentToday: number };
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
