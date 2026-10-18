import type { Asked, Backstory, LoreIssue, Who } from "../creation/types.ts";
import type { Confide, GmState, OwedRow, ScenePatch, TalkRecord, TwoPartRole } from "../gm/state.ts";
import type { Band } from "../gm/two-part.ts";
import type { CombatOutcome, CombatState, CombatVerb, Side } from "../gm/combat.ts";
import type { Markup } from "../markup.ts";
import type { Act, BuildOption, FeatureRef, Mechanic, Offer, OwnPicks, Reaction, SpellRef, SrdLists, WeaponRef } from "../rules/types.ts";
import type { RouteOutcome } from "../scene/beats.ts";
import type { Skill } from "../scene/types.ts";
import type { PlaceRows } from "../world/rows.ts";
import type { WorldOp } from "../world/scene-world.ts";
import type { CreationStep, Step } from "./keys.ts";

/**
 * The AI service's HTTP API: what the simulation POSTs for each step of a think, and what comes
 * back (v0-design §5.1-5.2, gm-port §13; the suggested lines, v5-design §3.6;
 * character creation's two, v1-design §3.7; the memory reviews after a turn, full-gm-design §4.1; the rules' act in a turn (what a line asks
 * of them, read before the reply) and the reactions to it, world-bridge-design §3.1; the boundary between scenes and a fight's aftermath, story-design §4.2;
 * a talk with a companion, the menu's act played as a turn, and the looks of what the story makes,
 * town-design §3.6-3.8).
 * Every request carries its working set, read in the transaction that queued it, and its
 * idempotency key; every answer is data the simulation commits.
 */

export type Endpoint =
  | "/v1/scenes/open" | "/v1/turns/act" | "/v1/turns/reactions" | "/v1/turns/reply" | "/v1/turns/settle" | "/v1/turns/suggest"
  | "/v1/turns/remember" | "/v1/scenes/boundary" | "/v1/looks" | "/v1/turns/combat"
  | "/v1/characters" | "/v1/backstories";

/**
 * Each step's endpoint, and how long the simulation waits for it (under the procedures' 180 s cap).
 * The act is two decider calls at most and the reactions one (about 0.3 s each), each waited for
 * 20 s; a memory review's tool loop can take a minute and more; a boundary's three calls at once,
 * then presence, about 10 to 20 s on real models; the looks of what a turn made, one small call.
 */
export const STEP_ENDPOINT: Record<Step | CreationStep, Endpoint> = {
  open: "/v1/scenes/open", act: "/v1/turns/act", reactions: "/v1/turns/reactions", reply: "/v1/turns/reply", settle: "/v1/turns/settle",
  suggest: "/v1/turns/suggest", remember: "/v1/turns/remember", boundary: "/v1/scenes/boundary", look: "/v1/looks", combat: "/v1/turns/combat",
  offer: "/v1/characters", pick: "/v1/characters", own: "/v1/characters",
  draft: "/v1/backstories", work: "/v1/backstories", check: "/v1/backstories", traits: "/v1/backstories",
};
export const STEP_TIMEOUT_MS: Record<Step | CreationStep, number> = {
  open: 60_000, act: 20_000, reactions: 20_000, reply: 60_000, settle: 60_000, suggest: 30_000, remember: 170_000, boundary: 120_000, look: 30_000, combat: 60_000,
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
}
/**
 * ops: an aftermath's, what the stage manager says it did to the world (at most 16, by game key),
 * applied through the gate. talk: a talk's prep, to keep. check: the two-part GM's opening called
 * one (the simulation rolls it and writes the outcome that came up, as a reply's).
 */
export interface OpenResponse { present: string[]; entries: Reply[]; ops?: WorldOp[]; talk?: TalkPrep; check?: SpokenCheck; usage: Usage }

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
 * patches (the one thing they might tell on their card, and the talk's discovery `told` filled with
 * it, or dropped with nothing to tell); what they'd tell, for the record once it's out; and the
 * opening choices, two to four lines. (The note disclosure kept out of the talk, the deepest of their
 * story before its time, went with disclosure: the facts say it isn't this talk's.)
 */
export interface TalkPrep {
  established: string[];
  patches: ScenePatch[];
  confide?: Confide;
  suggestions: string[];
}

/**
 * What the turn's commits before the reply did (the rules first, the player's act, read from their
 * line or the map's, and the reactions to it): the reply builds its directives from it. (The move the
 * old pipeline's decide commit took, the ending it held for the player's answer and a considered
 * turn's ruling went with them.)
 */
export interface Outcome {
  /** This turn's dice lines. */
  lines: string[];
  /**
   * The rules' directives from before the player acted (world-bridge-design §3.4: a timed spell
   * running out, fire's tick, coming round, a blow left hanging): first in the reply.
   */
  directives: string[];
  /** The scene is winding down: this reply closes it on this ending. */
  windDown?: { exit: string };
  /**
   * The rules' act's directive (what they decided, for the GM to narrate) and the reactions' to it,
   * in that order (world-bridge-design §3.2): after the rules first's.
   */
  acts?: string[];
  /** The player's violence started a fight this turn (parked for combat: a scene's reactions start none, the scene's routes and the co-GM do); no reply reads it. */
  brawl?: boolean;
}

/**
 * POST /v1/turns/act (world-bridge-design §3.1): what the rules resolve of the player's line, asked
 * before the reply only of a line that might be an act (shared/rules/acting.ts mightAct: a spell, a
 * blow, a shot or a throw, a class feature). turn: the turn's working set, its line the player's.
 */
export interface ActRequest extends AiRequest { turn: TurnContext }
/** The act the rules resolve, with its details (which spell at whom, which blow at what, where from); none when the line isn't one. */
export interface ActResponse { mechanic?: Mechanic; usage: Usage }

/**
 * What the rules resolved of the player's act this turn (a line's, or the map's), for the co-GM to
 * play its fallout: the act's dice lines as the player saw them, and how each witness took it (the
 * reactions step's, by cast or world id) when it was violence someone saw.
 */
export interface TurnAct { lines: string[]; reactions?: Record<string, Reaction> }
/**
 * The two-part GM's reply (docs/two-part-design.md): the outcome's directives (the rules' from before
 * the player acted, and the map's act's) leading the mouthpiece's, and on the wind-down
 * (outcome.windDown) its closing, which may wait once (the bookkeeping's twoPart.held not yet set).
 */
export interface ReplyRequest extends AiRequest { turn: TurnContext; outcome: Outcome; stream: { turn: string } }
/**
 * offered: the stage whose pressure this reply was offered. A two-part reply's check: the one its
 * mouthpiece called, with each of its five outcomes as the screen would have it (the simulation rolls
 * it and writes the dice line and the one that came up); closes: a closing that may wait once says
 * whether it closed (false: it waits).
 */
export interface ReplyResponse { entries: Reply[]; gm: { offered?: string }; firstTextMs: number | null; check?: SpokenCheck; closes?: boolean; initiative?: Initiative; usage: Usage }

/**
 * The mouthpiece's roll_for_initiative (docs/combat-gm.md): a fight breaks out at the end of this
 * reply, with these of the cast against the player and these beside them (the player is always in it).
 * `on`: with a check, the outcomes that start it (toll1-1018: a Deception failed badly and its outcome
 * ended on "Roll for initiative!", but nothing started); none, whatever comes up.
 */
export interface Initiative { foes: string[]; allies: string[]; why: string; on?: Band[] }

/** What someone does on their turn in a fight: perform_action's verb, at whom, what with (move_towards is a move, `away` backing off), and the narration up to the attempt. */
export interface CombatAction { action: CombatVerb; target?: string; spell?: string; weapon?: string; feature?: string; skill?: Skill; dc?: number; away?: boolean; narration: string }

/** An action taken this turn: what was asked, the dice lines, what the rules decided (or why they refused it). */
export interface CombatDone { act: CombatAction; lines: string[]; result: string; refused?: boolean }

/** Someone in the fight as the GM sees them: who, which side, how they stand, whether they're out of it, their weapon's reach and their speed, and how far they are from each of the others (in the place's world, feet). */
export interface CombatFighter { id: string; name: string; called?: string; side: Side; initiative: number; hurt: string; hp?: number; max?: number; ac: number; down: boolean; out?: string; reach: { melee: boolean; feet: number; speed: number }; feet: Record<string, number> }

/**
 * The fight as the combat step sees it: its state, everyone in it, whose turn it is, what's been
 * done this turn and with what result, and, once the rules say it's over, how.
 */
export interface CombatView { state: CombatState; fighters: CombatFighter[]; whose: string; done: CombatDone[]; over?: { outcome: CombatOutcome; why: string } }

/** POST /v1/turns/combat: the fight's next tool call, on whoever's turn it is (the player's line in `turn`, on theirs). */
export interface CombatRequest extends AiRequest { turn: TurnContext; combat: CombatView }

/** The GM's next move in the fight: an action to resolve, the end of the turn, or the end of the fight, each with its narration. */
export type CombatMove =
  | { kind: "act"; act: CombatAction }
  | { kind: "end_turn"; narration: string }
  | { kind: "end_combat"; outcome: CombatOutcome; narration: string };

/** The move, and its narration as the screen has it (who says each line). */
export interface CombatResponse { move: CombatMove; entries: Reply[]; usage: Usage }

/** A check the two-part GM's mouthpiece called: its skill and DC, and its five outcomes (shared/gm/two-part.ts BANDS), each the next words of the reply. */
export interface SpokenCheck { skill: Skill; dc: number; outcomes: Record<Band, Reply> }

/** A turn's check as the simulation rolled it: the co-GM takes a route the dice decide on how it went. */
export interface TurnCheck { skill: string; dc: number; total: number; success: boolean; band: Band }

/**
 * What the two-part GM's co-GM did after a reply (its tools' calls): the roles it set, the latest
 * for each person by cast id; the moves it made, in order, each taken at once with beats.ts's
 * takeRoute on a copy of the bookkeeping (the simulation takes them again on its rows, the
 * authority); and every call it made with what it was told. `owed`: the leads whose move was refused
 * because nobody had said the name they need, so the name is owed (beats.ts oweName, which the
 * simulation takes on its rows): none when there were none. `error`: why it failed (nothing set or
 * moved then).
 */
export interface CoGmAnswer {
  roles: Record<string, TwoPartRole>;
  moves: Array<{ route: string; outcome: RouteOutcome; why: string }>;
  owed?: string[];
  log: Array<{ name: string; args: Record<string, unknown>; result: string }>;
  error?: string;
}

/**
 * reply: plain text. talk: a talk's turn, and whether its next lines are asked for (the controller's
 * setting). The stage manager and the two-part GM's co-GM side by side, the co-GM told how this
 * turn's check went (`check`, when the mouthpiece called one) and what the rules resolved of the
 * player's act (`act`, when there was one).
 */
export interface SettleRequest extends AiRequest { turn: TurnContext; reply: string; lines: string[]; settled: string[]; talk?: { suggest: boolean }; check?: TurnCheck; act?: TurnAct }
/**
 * ops: at most 16, by game key (none in a talk, which has no world). talk: a talk's next lines
 * (talk.suggest, beside the co-GM), none when they weren't asked for or the talk ended. coGm: the
 * co-GM's roles and moves.
 */
export interface SettleResponse { ops: WorldOp[]; talk?: { suggestions: string[] }; coGm?: CoGmAnswer; usage: Usage }

/**
 * POST /v1/turns/reactions (world-bridge-design §3.1): everyone who saw the player's violence reacts,
 * each by their own lights, before the GM says a word (the prototype's decideReactions). turn: the
 * turn's working set as the act left it (the world after it); act: what the rules decided it did
 * (scene-acts.ts violence).
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
 * attention filter, then the reviews it fires: the GM's notes on the people present, and the lore),
 * written into the game's docs. turn: the scene up to and including the reviewed turn; reviewed: its
 * number.
 */
export interface RememberRequest extends AiRequest { turn: SceneContext; reviewed: number }
/** What the attention filter flagged, and each review it fired: what it changed, or why it failed. */
export interface RememberResponse { flags: string[]; reviews: ReviewRecord[]; usage: Usage }
/** A memory review's record, as ai/docs/reviews.ts makes it (its shape written out here: shared imports nothing of the AI service's). */
export interface ReviewRecord { kind: "notes" | "lore"; summary: string; changes: string[]; costUsd: number; latencyMs: number; error?: string }

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
 * The game's docs (the GM's notes on the people, from the ending and the time between, the played
 * scene, the fronts) are written by then, once per key.
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

/**
 * A game's own, as the AI service keeps them (V16: problem reports, M5), by the game's uid: its model
 * calls and memory reviews (GET /v1/games/{game}/calls), and its copy of the lore, every doc it wrote,
 * the GM's notes on each person among them (GET /v1/games/{game}/docs; PUT the same to give a game
 * restored from a report its docs). Each answer has every key the service holds taken out.
 */
export const gamePath = (game: string, what: "calls" | "docs") => `/v1/games/${encodeURIComponent(game)}/${what}`;

/** How many of a game's calls, and of its memory reviews, a GET gives: the latest, when there are more (a call's line carries its whole prompt). */
export const GAME_LINES = 300;

/** GET /v1/games/{game}/calls: the latest GAME_LINES lines of each log, oldest first, and how many each has in all. */
export interface GameCalls { game: string; calls: Array<Record<string, unknown>>; reviews: Array<Record<string, unknown>>; total: { calls: number; reviews: number } }

/** GET /v1/games/{game}/docs, and PUT's body: every doc of the game's copy of the lore, by its path ("Cast/Kell/notes.md"). */
export interface GameDocs { game: string; docs: Array<{ path: string; text: string }> }

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
