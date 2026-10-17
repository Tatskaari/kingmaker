import type { Asked, Backstory, LoreIssue, Who } from "../creation/types.ts";
import type { RollResult } from "../dice.ts";
import type { Ruling, RulingOutcome, Verdict } from "../gm/consider.ts";
import type { RepairResult } from "../gm/repair.ts";
import type { Confide, GmState, GuardStage, OpenedNote, OwedRow, ScenePatch, SceneStatus, TalkRecord, TwoPartRole } from "../gm/state.ts";
import type { Band } from "../gm/two-part.ts";
import type { Markup } from "../markup.ts";
import type { Act, BuildOption, FeatureRef, Mechanic, Offer, OwnPicks, Reaction, SpellRef, SrdLists, ThreatRead, WeaponRef } from "../rules/types.ts";
import type { RouteOutcome } from "../scene/beats.ts";
import type { Skill, Transition } from "../scene/types.ts";
import type { PlaceRows } from "../world/rows.ts";
import type { WorldOp } from "../world/scene-world.ts";
import type { CreationStep, Step } from "./keys.ts";

/**
 * The AI service's HTTP API: what the simulation POSTs for each step of a think, and what comes
 * back (v0-design §5.1-5.2, gm-port §13; the suggested lines, v5-design §3.6;
 * character creation's two, v1-design §3.7; a considered turn's ruling, and the memory reviews and
 * the co-GM after a turn, full-gm-design §4.1; the rules' act in a turn and the reactions to it,
 * world-bridge-design §3.1; the boundary between scenes and a fight's aftermath, story-design §4.2;
 * a talk with a companion, the menu's act played as a turn, and the looks of what the story makes,
 * town-design §3.6-3.8).
 * Every request carries its working set, read in the transaction that queued it, and its
 * idempotency key; every answer is data the simulation commits.
 */

export type Endpoint =
  | "/v1/scenes/open" | "/v1/turns/decide" | "/v1/turns/reactions" | "/v1/turns/consider" | "/v1/turns/reply" | "/v1/turns/settle" | "/v1/turns/suggest"
  | "/v1/turns/remember" | "/v1/turns/repair" | "/v1/scenes/boundary" | "/v1/looks"
  | "/v1/characters" | "/v1/backstories";

/**
 * Each step's endpoint, and how long the simulation waits for it (under the procedures' 180 s cap).
 * The reactions are one decider call (about 0.3 s), waited for as long as the decision; the ruling's
 * review is cut off at 12 s (KM_CONSIDER_DEADLINE_MS), then the plain check is asked for; a memory
 * review's or the co-GM's tool loops can take a minute and more; a boundary's three calls at once,
 * then presence, about 10 to 20 s on real models; the looks of what a turn made, one small call.
 */
export const STEP_ENDPOINT: Record<Step | CreationStep, Endpoint> = {
  open: "/v1/scenes/open", decide: "/v1/turns/decide", reactions: "/v1/turns/reactions", consider: "/v1/turns/consider", reply: "/v1/turns/reply", settle: "/v1/turns/settle",
  suggest: "/v1/turns/suggest", remember: "/v1/turns/remember", repair: "/v1/turns/repair", boundary: "/v1/scenes/boundary", look: "/v1/looks",
  offer: "/v1/characters", pick: "/v1/characters", own: "/v1/characters",
  draft: "/v1/backstories", work: "/v1/backstories", check: "/v1/backstories", traits: "/v1/backstories",
};
export const STEP_TIMEOUT_MS: Record<Step | CreationStep, number> = {
  open: 60_000, decide: 20_000, reactions: 20_000, consider: 20_000, reply: 60_000, settle: 60_000, suggest: 30_000, remember: 170_000, repair: 170_000, boundary: 120_000, look: 30_000,
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
 * the story unit, and in a game's first scene. And (town-design §3.8) what companions have told the
 * player of themselves in talks between scenes, by their cast ids (talk.ts's records): the GM's note
 * of what the player knows reads it, and a talk's prep and lines; absent while there have been none.
 */
export interface Story { time: string; day: number; flags: Record<string, string>; history?: Chapter[]; earlier?: Entry[]; talks?: Record<string, TalkRecord> }

/**
 * A scene played, as the prototype's session's history has it (src/runtime/session.ts:337-345):
 * its key and the exit it ended by, the hand-off, its last moments, the scenes the boundary skipped
 * and why, what moved in the fronts, the notebook's lines its ending wrote, and the facts settled in it.
 */
export interface Chapter {
  sceneId: string; exitId: string; summary: string;
  lastMoments?: string[]; skipped?: Array<{ sceneId: string; why: string }>; fronts?: string[]; journal?: string[]; facts?: string[];
}
/** A GM's entry. markup: who says each line, by game key where it resolves. */
export interface Reply { speaker: "gm"; kind: "narration"; text: string; markup?: Markup }
/**
 * A line the player might say or do next (the prototype's session.ts:192), as they'd type it:
 * something to say, a deed in brackets, a risky try in brackets that would call for a roll, or a way
 * to leave.
 */
export interface Suggestion { kind: "say" | "do" | "try" | "leave"; text: string }

/** A turn's working set, read in the transaction that queued the think: everything the GM may need. */
export interface TurnContext {
  /** kind: a scene of the story, or a talk with a companion between scenes (town-design §3.6). */
  scene: { id: string; key: string; kind: "scene" | "talk"; turn: number };
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
 * the opening, on a turn of its own, the scene's transcript and world as the fight left them. With
 * `talk`, a talk with a companion opens (town-design §3.6: talk.ts openTalk): their greeting, and
 * beside it the talk's prep (talk.sift, talk.plan), which the answer's `talk` brings back.
 */
export interface OpenRequest extends AiRequest {
  scene: { id: string; key: string; kind: "scene" | "talk" };
  pc: string; gm: GmState; world: PlaceRows; party: SheetRow[]; story: Story;
  /** The opening's turn (turn 0; an aftermath's own), for stream_reply. */
  stream: { turn: string };
  /** The scene picks up after a fight: how it went. */
  aftermath?: { summary: string };
  /** An aftermath's: the scene's transcript so far (an opening has none). */
  transcript?: Entry[];
  /** A talk's: with whom, where, their record, and what the prep reads besides the scene. */
  talk?: TalkOpen;
  /** A scene of the story played by the two-part GM (docs/two-part-design.md): its mouthpiece speaks the opening, the roles as the scene opens its note -1. */
  twoPart?: boolean;
}
/**
 * ops: an aftermath's, what the stage manager says it did to the world (at most 16, by game key),
 * applied through the gate. talk: a talk's prep, to keep. check: the two-part GM's opening called
 * one (the simulation rolls it and writes the outcome that came up, as a reply's).
 */
export interface OpenResponse { present: string[]; entries: Reply[]; opened: OpenedNote[]; ops?: WorldOp[]; talk?: TalkPrep; check?: SpokenCheck; usage: Usage }

/**
 * A talk's open (town-design §3.6; talk.ts startTalk, openTalk and plan): the companion's cast id;
 * where and when, as the map says it ("Granary Street in Caerwyn, evening"); their record with the
 * player, this talk counted; how the story led on to the waiting scene, as the player knows it (its
 * gm's `lead`, for the facts); every entry of their earlier talks with the player, each with its
 * scene's key (earlierTalks reads them); and whether lines to say are suggested (the controller's own
 * setting: off, the prep's suggestions are none).
 */
export interface TalkOpen { with: string; where: string; record: TalkRecord; lead?: string; earlier: Entry[]; suggest: boolean }

/**
 * What a talk's prep came to (talk.ts prepare), for the open's commit to keep: the facts the talk's
 * GM takes as given (where and when, how often they've talked, what they've told, what they may open
 * up about now, what waits for a later talk, what they knew in the story's scenes); the prep's
 * patches (the one thing they might tell, a secret on their card, and the route by which it comes out,
 * to the talk's `told` beat); how near the surface it starts (the companion's staged secret); what
 * they'd tell, for the record and the memory once it's out; the notes disclosure keeps out of this
 * talk (the deepest of their story, before its time); and the opening choices, two to four lines.
 */
export interface TalkPrep {
  established: string[];
  patches: ScenePatch[];
  guard?: { stage: GuardStage; turn: number };
  confide?: Confide;
  withheld: string[];
  suggestions: string[];
}

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
/**
 * landed: [] in V0 (no world clock). forced: what the rules resolve this turn, chosen already (the
 * map's action menu, town-design §3.4: an act at a waiting scene, played as its first turn): the
 * decider asks no mechanic question (the prototype's decideBefore `forced`, director.ts:793, 889-901).
 */
export interface DecideRequest extends AiRequest { turn: TurnContext; landed: string[]; forced?: Mechanic }
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
/**
 * decision: the decider's, for a talk (the old pipeline's). twoPart: a scene of the story, played by
 * the two-part GM (docs/two-part-design.md): no decision, the outcome's directives (the rules' from
 * before the player acted, and the map's act's) leading the mouthpiece's, and on the wind-down
 * (outcome.windDown) its closing, which may wait once (the bookkeeping's twoPart.held not yet set).
 */
export interface ReplyRequest extends AiRequest { turn: TurnContext; decision?: Decision; outcome: Outcome; stream: { turn: string }; twoPart?: boolean }
/**
 * offered: the stage whose pressure this reply was offered. A two-part reply's check: the one its
 * mouthpiece called, with each of its five outcomes as the screen would have it (the simulation rolls
 * it and writes the dice line and the one that came up); closes: a closing that may wait once says
 * whether it closed (false: it waits).
 */
export interface ReplyResponse { entries: Reply[]; gm: { offered?: string; repeated: string | null }; firstTextMs: number | null; check?: SpokenCheck; closes?: boolean; usage: Usage }

/** A check the two-part GM's mouthpiece called: its skill and DC, and its five outcomes (shared/gm/two-part.ts BANDS), each the next words of the reply. */
export interface SpokenCheck { skill: Skill; dc: number; outcomes: Record<Band, Reply> }

/** A turn's check as the simulation rolled it: the co-GM takes a route the dice decide on how it went. */
export interface TurnCheck { skill: string; dc: number; total: number; success: boolean; band: Band }

/**
 * What the two-part GM's co-GM did after a reply (its tools' calls): the roles it set, the latest
 * for each person by cast id; the moves it made, in order, each taken at once with beats.ts's
 * takeRoute on a copy of the bookkeeping (the simulation takes them again on its rows, the
 * authority); and every call it made with what it was told. `error`: why it failed (nothing set or
 * moved then).
 */
export interface CoGmAnswer {
  roles: Record<string, TwoPartRole>;
  moves: Array<{ route: string; outcome: RouteOutcome; why: string }>;
  log: Array<{ name: string; args: Record<string, unknown>; result: string }>;
  error?: string;
}

/**
 * reply: plain text. talk: a talk's turn, and whether its next lines are asked for (the controller's
 * setting). twoPart: a scene of the story, played by the two-part GM: the stage manager and its co-GM
 * side by side, the co-GM told how this turn's check went (`check`, when the mouthpiece called one).
 */
export interface SettleRequest extends AiRequest { turn: TurnContext; reply: string; lines: string[]; settled: string[]; talk?: { suggest: boolean }; twoPart?: boolean; check?: TurnCheck }
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
  /**
   * Staged secrets (town-design §3.6: director.ts:1263-1275), in a scene that stages them (a talk):
   * how far each of the cast present who keeps something back has come towards giving it up, judged
   * after the reply. The settle commit moves each one step at most, and never back.
   */
  guard?: Record<string, GuardStage>;
}
/**
 * ops: at most 16, by game key; after absent when the reply closed the scene (and in a two-part
 * scene, which has no read after the reply). talk: a talk's next lines (talk.suggest, beside the
 * after-reply decision), none when they weren't asked for or the talk ended. coGm: a two-part
 * scene's co-GM: its roles and moves.
 */
export interface SettleResponse { ops: WorldOp[]; after?: After; talk?: { suggestions: string[] }; coGm?: CoGmAnswer; usage: Usage }

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
/** A memory review's record, as ai/docs/reviews.ts makes it (its shape written out here: shared imports nothing of the AI service's). */
export interface ReviewRecord { kind: "memories" | "lore"; summary: string; changes: string[]; costUsd: number; latencyMs: number; error?: string }

/** POST /v1/turns/repair (full-gm-design §4.1): the background co-GM's review of a turn once it's over. turn and reviewed as remember's. */
export interface RepairRequest extends AiRequest { turn: SceneContext; reviewed: number }
/** The review (its turn the one reviewed): it waits in a co_gm_result row until the next turn's start merges it. */
export interface RepairResponse { review: RepairResult; usage: Usage }

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

/**
 * POST /v1/looks (town-design §3.7: src/game/look/invent.ts's model half, look.invent): how things the
 * story made look on the map, one call for a batch. `key` is each thing's own for the answer (the
 * simulation's: the name in lower case); kind: object, item, creature, person.
 */
export interface LooksRequest extends AiRequestBase { things: Array<{ key: string; name: string; kind?: string }> }
/** A look for each key answered (one the model left out has none: it's drawn with the look layer's guess). */
export interface LooksResponse { looks: Record<string, Invention>; usage: Usage }
/**
 * A look invented for a thing (invent.ts's Invention): a glyph from the look layer's menu, a Nerd Font
 * icon's name if one fits, a palette colour's name, how it moves (still, flutter, swarm, sway,
 * shimmer, flicker, pulse, drift, bob, drip), whether it gives off light, whether it's a creature or a
 * person, whether it's many, and what it's mostly made of.
 */
export interface Invention { glyph: string; nerd?: string; color: string; motion: string; light: boolean; being: boolean; group: boolean; material?: string }

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

/**
 * over_budget (402): today's spending is past the service's daily ceiling (KM_AI_DAILY_USD).
 * key_refused (403): OpenRouter turned the service's key down, and asking again won't mend it. The
 * message of either is words for the player.
 */
export type AiErrorCode = "bad_request" | "unauthorised" | "other_campaign" | "key_reused" | "model_failed" | "not_ready" | "over_budget" | "key_refused";
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

/** PUT /v1/campaigns/{campaign}/{version}: the whole campaign folder, by path ("scenes/hanged-clerk.kmscene"). */
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
