import { Timestamp } from "spacetimedb";
import { schema, t, table } from "spacetimedb/server";

/**
 * Every table of the module, and its env (v0-design §3.1, v1-design §3.1, v5-design §3.1,
 * full-gm-design §4.2, world-bridge-design §3.3, story-design §4.1, map-design §3.1, town-design §3.1). Columns are the
 * TypeScript names; SQL, HTTP and subscription queries use snake_case (sceneId is scene_id). Ids are
 * u64 (bigint); an autoInc id is inserted as 0n. Every row belongs to one game, but a creation's,
 * which belongs to an identity until the game is made, and a map's (map_def), which belongs to its
 * campaign version. Public tables are subscribed to by clients; private ones are the module's (and
 * the owner's, through SQL); the public ones are the client's contract (client/module_bindings). A
 * column added after V0 goes at its table's end with a default, so a database keeps its rows across
 * the publish (spacetime.md §4.10).
 */

// ---------------------------------------------------------------------------------------------
// Games and players.

export const game = table({ name: "game", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  /**
   * The game's id in every AI request, key and folder, never one another game had: a ready-made
   * game's is unique by construction (games/create.ts gameUid: g<id>-<time>-<database>-<uuid's first
   * block>); a made character's game takes its creation's (games/create.ts newUid: the transaction's
   * time, then tx.uuid()'s randomness).
   */
  uid: t.string().unique(),
  campaign: t.string(),
  campaignVersion: t.string(),
  title: t.string(),
  /** morning, afternoon, evening, night, next-morning: the time of the scene the story is at (the boundary moves it on). */
  time: t.string(),
  day: t.u32(),
  hostId: t.u64(),
  /** playing; ended (the last scene's ending went nowhere: The End). */
  status: t.string(),
  createdAt: t.timestamp(),
  /** The scene the story is heading for (its key): the lead, waiting on the map, which walking there or Go on opens (map-design §3.3, story-design §4.1). */
  leadScene: t.option(t.string()).default(undefined),
  /** What the boundary said of the lead, in second-person fiction, when it said something. */
  leadText: t.option(t.string()).default(undefined),
  /** A boundary in flight, between a scene's end and the next scene waiting: moving, waiting (to try again: onwardNote says why), failed (carry_on). None otherwise. */
  onward: t.option(t.string()).default(undefined),
  /** The boundary's note while it waits, or why it failed. */
  onwardNote: t.option(t.string()).default(undefined),
});

export const player = table({ name: "player", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  identity: t.identity().index("btree"),
  gameId: t.u64().index("btree"),
  name: t.string(),
  concept: t.string(),
  /** host, spectator. */
  role: t.string(),
  characterId: t.option(t.u64()),
  placeId: t.option(t.u64()),
  sceneId: t.option(t.u64()),
  online: t.bool(),
  /** Whether lines to say are suggested to them over the box (/suggestions): their own setting. */
  suggestions: t.bool().default(true),
  /** When they last played it (made it, began it, continued it, said a line in it): the title's "(5 min ago)". */
  lastPlayedAt: t.timestamp().default(new Timestamp(0n)),
});

/** The game a connection is playing now: read through my_seat. */
export const seat = table({ name: "seat" }, {
  identity: t.identity().primaryKey(),
  playerId: t.u64(),
});

const SlotRow = t.object("SlotRow", { level: t.u32(), max: t.u32(), used: t.u32() });
const SpellRef = t.object("SpellRef", { id: t.string(), name: t.string(), level: t.u32() });
const WeaponRef = t.object("WeaponRef", { id: t.string(), name: t.string() });
/** target: self, creature. */
const FeatureRef = t.object("FeatureRef", { id: t.string(), name: t.string(), target: t.string() });

/**
 * The player's character as the rules engine made it (v1-design §3.6), what the GM's brief, the side
 * panel and the sheet screen read: shared/rules sheetRows writes every column but the keys and
 * pockets (types.ts SheetRows), after creation and whenever the engine changes the character;
 * pockets is refreshed from the world without the engine.
 */
export const sheet = table({ name: "sheet", public: true }, {
  playerId: t.u64().primaryKey(),
  gameId: t.u64().index("btree"),
  /** "elf ranger 3 (Hunter), criminal background" */
  build: t.string(),
  /** JSON: Record<Skill, number>, all 18. */
  skills: t.string(),
  /** "HP 28/28, spell slots 1st 3/3" */
  statusLine: t.string(),
  level: t.u32().default(0),
  hp: t.i32().default(0),
  maxHp: t.i32().default(0),
  ac: t.i32().default(0),
  slots: t.array(SlotRow).default([]),
  conditions: t.array(t.string()).default([]),
  /** Cantrips and prepared spells. */
  spells: t.array(SpellRef).default([]),
  weapons: t.array(WeaponRef).default([]),
  /** Class features with uses they can use in a scene. */
  features: t.array(FeatureRef).default([]),
  /** JSON: shared/rules SheetData without purse and carrying (about 19 KB for a wizard); "" before V1. */
  data: t.string().default(""),
  /** JSON: shared/rules Pockets, the purse and what else they carry; "" before V1. */
  pockets: t.string().default(""),
  /** JSON: the Backstory they wrote at creation, if they wrote one. */
  backstory: t.option(t.string()).default(undefined),
  /**
   * JSON: shared/rules SpellFacts[], what the rules say of each spell in `spells` (its range, its
   * effects' kinds, whether it fills an area): where the scene's menu offers it. "" until the rules
   * have worked them out (before the world bridge): the menu offers every spell, by its name.
   */
  spellFacts: t.string().default(""),
  /**
   * JSON: shared/rules/aim.ts Catalogue, what the player can do outside a fight, by kind, and why not
   * where they can't (town-design §3.3): the map's action menu, which the client draws and aims from
   * and the simulation checks by. sheetRows writes it with the engine; "" before the menu.
   */
  actions: t.string().default(""),
});

/** The game's only randomness after its creation (shared/dice.ts rollFrom). */
export const dice = table({ name: "dice" }, {
  gameId: t.u64().primaryKey(),
  seed: t.u32(),
  rolls: t.u32(),
});

/** Who owns the database: init records the publisher. */
export const admin = table({ name: "admin" }, {
  identity: t.identity().primaryKey(),
  /** owner. */
  role: t.string(),
});

// ---------------------------------------------------------------------------------------------
// Scenes and turns.

export const scene = table({ name: "scene", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  gameId: t.u64().index("btree"),
  sceneKey: t.string(),
  title: t.string(),
  hook: t.string(),
  /** scene; talk, a word with a companion between scenes (town-design §3.6), played on the town's own place. */
  kind: t.string(),
  /** The place it's played in: a waiting scene's is built as it becomes the lead, with no one playing in it yet (story-design §4.3; the map unit's buildLead). */
  placeId: t.u64(),
  /**
   * waiting (handed on by the boundary, not yet opened: the lead), opening, live, closing (its
   * ending's wind-down to play), ending (a reply closed it: its settle ends it), fighting (it reached
   * its combat exit: the fight's stand-in is next, then it picks up), ended.
   */
  status: t.string(),
  /** The player who has the lead. */
  controllerId: t.u64(),
  /** The turn in flight: the scene's lease. */
  turnId: t.option(t.u64()),
  /** The last turn's n. */
  turns: t.u32(),
  exitKey: t.option(t.string()),
  rev: t.u32(),
  openedAt: t.timestamp(),
  endedAt: t.option(t.timestamp()),
  /** Its time of day, from its scene.json (morning, afternoon, evening, night, next-morning). */
  time: t.option(t.string()).default(undefined),
});

/** A roll as shared/dice.ts's RollResult has it (critical null and no advantage are empty options). */
const Roll = t.object("Roll", {
  skill: t.string(), dc: t.i32(), die: t.i32(), modifier: t.i32(), total: t.i32(), success: t.bool(),
  critical: t.option(t.string()), advantage: t.option(t.string()),
});
const PathStep = t.object("PathStep", {
  turn: t.u32(), from: t.string(), to: t.string(), via: t.string(), roll: t.option(Roll),
  /** pre, post, repair. */
  source: t.string(),
  known: t.option(t.u32()),
});
const OpenedNote = t.object("OpenedNote", { path: t.string(), title: t.string(), scope: t.string(), turn: t.u32() });
const EndingLead = t.object("EndingLead", { exitId: t.string(), count: t.u32(), probability: t.f64() });
const PendingExit = t.object("PendingExit", { exitId: t.string(), turn: t.u32(), via: t.string(), extended: t.bool(), waits: t.option(t.string()) });
const ExitAt = t.object("ExitAt", { exitId: t.string(), turn: t.u32() });
/** The co-GM's steering for one of the cast, from the turn it reviewed. */
const Whisper = t.object("Whisper", { to: t.string(), note: t.string(), turn: t.u32() });
/** Something the story still owes the player (shared/gm/state.ts OwedRow): its things by entity key, outermost first, and who holds them. */
const OwedRow = t.object("OwedRow", {
  from: t.string(), id: t.string(), hinted: t.bool(), things: t.array(t.string()), holders: t.array(t.string()), where: t.option(t.string()),
});
/** A considered turn's ruling, as shared/gm/consider.ts's RulingRecord has it (no dc or no roll: an empty option). */
const RulingRow = t.object("RulingRow", {
  turn: t.u32(), act: t.string(),
  /** A cast id, or world. */
  target: t.string(),
  skill: t.string(),
  /** roll, yes, no. */
  kind: t.string(),
  dc: t.option(t.i32()), why: t.string(), roll: t.option(Roll),
  /** success, failure. */
  went: t.string(),
  changed: t.string(), costUsd: t.f64(), latencyMs: t.f64(),
});
/** What the last reply left hanging over the player, as shared/rules's Threat has it: kind attack (by), or hazard (hazard, severity: glancing, serious), the other kind's fields empty. */
const Threat = t.object("Threat", { kind: t.string(), by: t.option(t.string()), hazard: t.option(t.string()), severity: t.option(t.string()), turn: t.u32() });
/** A fight the player's violence started, as shared/rules's Brawl has it: who goes for the player, who's with them, who fled. */
const Brawl = t.object("Brawl", { turn: t.u32(), cause: t.string(), against: t.array(t.string()), allies: t.array(t.string()), fled: t.array(t.string()) });
/** A staged secret's holder (shared/gm/state.ts GmState.guard): how far they've opened up (surface, tell, stirred, torn, settled) and the turn they got there. */
const Guard = t.object("Guard", { cast: t.string(), stage: t.string(), turn: t.u32() });
/** The one thing a companion might open up about in a talk (shared/gm/state.ts Confide). */
const Confide = t.object("Confide", { note: t.string(), topic: t.string(), what: t.string(), memory: t.string() });
/** A talk's own (shared/gm/state.ts TalkState, its `with` the companion): with whom, where and when, and what they might tell. */
const TalkRow = t.object("TalkRow", { companion: t.string(), where: t.string(), confide: t.option(Confide) });
/** A person's conversation role as the two-part GM's co-GM keeps it (shared/gm/state.ts TwoPartRole), by their cast id. */
const TwoPartRole = t.object("TwoPartRole", { cast: t.string(), status: t.string(), mentalState: t.string(), conversationRole: t.string() });
/** The co-GM's note for a turn (the turn it's for: -1 for the roles the opening gives everyone present, before it). */
const TwoPartNote = t.object("TwoPartNote", { turn: t.i32(), text: t.string() });
/** The two-part GM's own (shared/gm/state.ts TwoPartState): the roles, the notes, the stage it moved to since the last reply, and a wind-down held once. */
const TwoPart = t.object("TwoPart", { roles: t.array(TwoPartRole), notes: t.array(TwoPartNote), moved: t.option(t.string()), held: t.bool() });

/**
 * The GM's bookkeeping for a scene, a column a field of shared/gm/state.ts's GmState (gmToRow and
 * gmFromRow map the two): V0's, then the co-GM's and the rulings (full-gm-design §4.2), then what the
 * rules in a scene leave hanging and who's away (world-bridge-design §3.3), then what the boundary
 * handed on (story-design §4.1), then a talk's staged secrets and its own (town-design §3.1), then the
 * nodes the scene has reached and the two-part GM's own (M2: docs/two-part-design.md), each with a
 * default, so a scene from before them reads as one with none yet; the world bridge's before the
 * story's, as they stack, so a database of either migrates. `entered` has no column yet.
 */
export const gmState = table({ name: "gm_state" }, {
  sceneId: t.u64().primaryKey(),
  beat: t.string(),
  turnsInBeat: t.u32(),
  path: t.array(PathStep),
  /** The facts settled, as their sentences. */
  established: t.array(t.string()),
  landed: t.array(t.string()),
  hinted: t.array(t.string()),
  /** The newest 24. */
  opened: t.array(OpenedNote),
  endingLead: t.option(EndingLead),
  pendingExit: t.option(PendingExit),
  closing: t.option(ExitAt),
  ended: t.option(ExitAt),
  /** on_track, drifting, stuck, uncovered. */
  sceneStatus: t.option(t.string()),
  oocTurns: t.array(t.u32()),
  pressureOffered: t.array(t.string()),
  repeated: t.option(t.string()),
  /** The co-GM's: details improvised in play that must stay true. */
  canon: t.array(t.string()).default([]),
  /** JSON: ScenePatch[], the scene's prep as play changed it (the co-GM's routes and bridging beats, the ways of trying a ruling shut). */
  patches: t.string().default("[]"),
  /** The co-GM's notes to the GM, and the turn it wrote them on: they lapse two turns on. */
  notes: t.option(t.string()).default(undefined),
  notesTurn: t.option(t.u32()).default(undefined),
  /** For the next reply: they lapse a turn on. */
  whispers: t.array(Whisper).default([]),
  /** The turn the co-GM last reviewed (its result merged). */
  lastRepairTurn: t.option(t.u32()).default(undefined),
  /** The last turn off the graph with nothing ruled on it. */
  offGraphTurn: t.option(t.u32()).default(undefined),
  /** The GM's rulings on considered acts, in the order made. */
  rulings: t.array(RulingRow).default([]),
  /** A blow or a danger the last reply left hanging over the player: it lands as their next turn starts, which takes it off. */
  threat: t.option(Threat).default(undefined),
  /** The turn a hold caught the player: it stands with no more saving throws until they break free, or the reply lets them go. */
  held: t.option(t.u32()).default(undefined),
  /** A fight the player's violence started in the scene. */
  brawl: t.option(Brawl).default(undefined),
  /** Cast who are away: those who fled the player's violence or ran for help (off the stage for good), and those from earlier scenes that what happened keeps away (the boundary's presence). */
  absent: t.array(t.string()).default([]),
  /** The boundary's: where the scene's prep no longer matches the story. */
  adjustments: t.array(t.string()).default([]),
  /** The boundary's: the opening, rewritten for where the story is. */
  opening: t.option(t.string()).default(undefined),
  /** The boundary's: how the story led the player here. */
  lead: t.option(t.string()).default(undefined),
  /** What the story still owes the player from scenes already over. */
  owed: t.array(OwedRow).default([]),
  /** The combat exits already fought (the stand-in's). */
  fought: t.array(t.string()).default([]),
  /** Staged secrets (a talk stages them): how far each of the cast who keeps something back has come towards giving it up. Never back. */
  guard: t.array(Guard).default([]),
  /** Notes disclosure keeps out of the scene: a talk's, the deepest of the companion's story before its time. */
  withheld: t.array(t.string()).default([]),
  /** A talk's own: none in a scene of the story. */
  talk: t.option(TalkRow).default(undefined),
  /** The nodes the scene has reached, in order, its start first (shared/scene/beats.ts). None in a scene from before M2: its beat stands for them. */
  reached: t.array(t.string()).default([]),
  /** The two-part GM's: each person's role, the co-GM's notes by turn, the stage it moved to, a wind-down held once. None in a scene from before M2: nothing yet. */
  twoPart: t.option(TwoPart).default(undefined),
});

/**
 * The background co-GM's reviews (full-gm-design §4.2), one a turn reviewed: its answer waits here
 * until the next turn's start merges it into gm_state (mergedTurn), and stays as the record, as the
 * prototype's repair-NNN.json files did. An ended scene's is never merged.
 */
export const coGmResult = table({ name: "co_gm_result" }, {
  id: t.u64().primaryKey().autoInc(),
  sceneId: t.u64().index("btree"),
  /** The turn it reviewed. */
  turn: t.u32(),
  /** JSON: shared/gm/repair.ts's RepairResult. */
  review: t.string(),
  /** The turn whose start merged it; none while it waits. */
  mergedTurn: t.option(t.u32()),
  /** Why its move of the tracker was refused, when it was. */
  note: t.option(t.string()),
  at: t.timestamp(),
});

/** Who's on a scene's stage: no one and nothing is on two at once. */
export const onStage = table({ name: "on_stage", public: true }, {
  entityId: t.u64().primaryKey(),
  sceneId: t.u64().index("btree"),
  /** controller, cast. */
  role: t.string(),
});

export const turn = table({ name: "turn", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  gameId: t.u64(),
  sceneId: t.u64().index("btree"),
  /** 0 is the opening. */
  n: t.u32(),
  playerId: t.u64(),
  /** queued, deciding, considering (the GM rules on the act before replying), replying, settling, noting (all in but its reply's notes), done, failed. */
  phase: t.string(),
  /** While it waits on the AI service. */
  note: t.option(t.string()),
  /** The player's words when it failed. */
  error: t.option(t.string()),
  startedAt: t.timestamp(),
  firstTextAt: t.option(t.timestamp()),
  endedAt: t.option(t.timestamp()),
  calls: t.u32(),
  costMicros: t.u64(),
  /** Its reply's notes: none (nothing to note), writing, written, lost (the job gave up). */
  notes: t.string().default("none"),
  /** The lines suggested after its reply: none, coming, landed, dropped (overtaken, ended or turned off), lost. */
  suggest: t.string().default("none"),
  /** How often its lines have been asked for: the latest ask's key is suggest, suggest-2, … */
  suggestAsks: t.u32().default(0),
  /**
   * JSON: shared/rules Mechanic, what the rules resolve this turn, chosen already (town-design §3.4:
   * the map's action menu's act at a waiting scene, played as its first turn): its decide request's
   * `forced`. None for a line the player typed.
   */
  mechanic: t.option(t.string()).default(undefined),
});

export const transcript = table({ name: "transcript", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  gameId: t.u64(),
  sceneId: t.u64().index("btree"),
  turn: t.u32(),
  /** Per scene, from 1. */
  seq: t.u32(),
  /** player:<id>, gm, dice, system. */
  speaker: t.string(),
  /** player, narration, dialogue, roll, system. */
  kind: t.string(),
  text: t.string(),
  /** JSON: shared/markup.ts's Markup. */
  markup: t.option(t.string()),
  at: t.timestamp(),
});

/** The reply as it's written: all of it so far, replaced by each stream_reply. */
export const replyDraft = table({ name: "reply_draft", public: true }, {
  turnId: t.u64().primaryKey(),
  sceneId: t.u64().index("btree"),
  speaker: t.string(),
  text: t.string(),
  /** JSON: shared/markup.ts's Markup. */
  markup: t.option(t.string()),
  attempt: t.u32(),
  seq: t.u32(),
  done: t.bool(),
});

/**
 * The lines suggested to a scene's controller after a reply: one set a scene, replaced when a new
 * one lands. The client shows the latest turn's to the controller only.
 */
export const sceneSuggestion = table({ name: "scene_suggestion", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  gameId: t.u64(),
  sceneId: t.u64().index("btree"),
  /** The controller they're for. */
  playerId: t.u64(),
  /** The turn whose reply they follow (0: the opening). */
  turn: t.u32(),
  /** Its place in the set, from 1 (say_1 in the headless client). */
  ord: t.u32(),
  /** say, do, try, leave. */
  kind: t.string(),
  text: t.string(),
});

/** Whose names each player has heard: read through my_names. */
export const heard = table({ name: "heard" }, {
  id: t.u64().primaryKey().autoInc(),
  gameId: t.u64(),
  playerId: t.u64().index("btree"),
  entityKey: t.string(),
});

// ---------------------------------------------------------------------------------------------
// The story between scenes (story-design §4.1): what a scene's ending wrote, and the boundary's
// record of it. Public, read by game: the notebook, the quests and The End are drawn from them.

/** A scene the boundary skipped (the prototype's history's skipped): its key, and why. */
const Skipped = t.object("Skipped", { sceneKey: t.string(), why: t.string() });

/**
 * A scene played to its end (the prototype's session.history entry): written as it ends, and
 * completed by the boundary after it (the hand-off, its last moments, what it skipped, what moved in
 * the fronts, and what it cost). The last scene's has no hand-off.
 */
export const chapter = table({ name: "chapter", public: true }, {
  /** The ended scene. */
  sceneId: t.u64().primaryKey(),
  gameId: t.u64().index("btree"),
  /** Per game, from 1, in the order played. */
  seq: t.u32(),
  sceneKey: t.string(),
  title: t.string(),
  exitKey: t.string(),
  /** The exit's title: "Murder by persons unknown". */
  ending: t.string(),
  /** The hand-off: "Previous scene, \"The Hanged Clerk\", ended: …"; "" until the boundary. */
  summary: t.string(),
  lastMoments: t.array(t.string()),
  /** The facts settled in play there. */
  facts: t.array(t.string()),
  /** What moved in the world's fronts at its boundary. */
  fronts: t.array(t.string()),
  skipped: t.array(Skipped),
  /** The boundary's model calls and what they cost. */
  calls: t.u32(),
  costMicros: t.u64(),
  at: t.timestamp(),
});

/** One of the story's quests, as the endings have written it (`quest` effects): by key, unique in its game. */
export const quest = table({ name: "quest", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  gameId: t.u64().index("btree"),
  /** hanged-clerk, purveyors-man, heron-ledger. */
  key: t.string(),
  title: t.string(),
  /** active, complete, failed. */
  status: t.string(),
  /** The stage it last advanced to. */
  stage: t.option(t.string()),
  /** Each change's words, oldest first. */
  notes: t.array(t.string()),
  updatedAt: t.timestamp(),
});

/** A story flag an ending set (`flag` effects): by name, unique in its game; the requests' story.flags. */
export const flag = table({ name: "flag", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  gameId: t.u64().index("btree"),
  name: t.string(),
  value: t.string(),
  /** The scene whose ending set it. */
  sceneId: t.u64(),
});

/** A line in the investigator's notebook (`journal` effects, and the fight's stand-in), by the scene it's about. */
export const journal = table({ name: "journal", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  gameId: t.u64().index("btree"),
  sceneId: t.u64(),
  /** Per game, from 1. */
  seq: t.u32(),
  text: t.string(),
  at: t.timestamp(),
});

/** How one of the cast stands towards a player (`attitude` effects): one row a cast member and player. */
export const attitude = table({ name: "attitude", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  gameId: t.u64().index("btree"),
  castKey: t.string(),
  playerId: t.u64(),
  /** hostile, unfriendly, wary, neutral, friendly, devoted. */
  attitude: t.string(),
  reason: t.string(),
  at: t.timestamp(),
});

/** Someone of the cast walking with a player between scenes (`follow` effects: Kell, after the granary). */
export const follower = table({ name: "follower", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  gameId: t.u64().index("btree"),
  castKey: t.string(),
  name: t.string(),
  /** The player they walk with: the scene's controller. */
  leaderId: t.u64(),
  /** The scene whose ending set them walking (its key). */
  sinceScene: t.string(),
});

const TalkTold = t.object("TalkTold", { note: t.string(), topic: t.string(), turn: t.u32() });
const TalkStage = t.object("TalkStage", { note: t.string(), stage: t.string() });

/**
 * A companion's talks with the player between scenes, kept for the whole story (town-design §3.6;
 * shared/gm/state.ts TalkRecord): how many, what they've told of themselves (each note of their lore
 * once, in the order told), and how far they'd come with what's not yet told. One a companion and game.
 */
export const talkRecord = table({ name: "talk_record" }, {
  id: t.u64().primaryKey().autoInc(),
  gameId: t.u64().index("btree"),
  castKey: t.string(),
  count: t.u32(),
  told: t.array(TalkTold),
  stages: t.array(TalkStage),
});

// ---------------------------------------------------------------------------------------------
// The world (content-world B2): a component holds only a field that moves out of the prototype's
// Entity unchanged; every word stays in `narrative`. Each component row is keyed by entityId, with
// placeId copied in so a client can subscribe to one place.

/** A tile on a map, 5 ft a side: x runs east, y south (the prototype's Tile2; the map unit's, for walk's `to`). */
export const Tile2 = t.object("Tile2", { x: t.i32(), y: t.i32() });

export const place = table({ name: "place", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  gameId: t.u64().index("btree"),
  /** granary-yard. */
  key: t.string(),
  name: t.string(),
  rootId: t.u64(),
  sizeW: t.f64(),
  sizeH: t.f64(),
  round: t.u32(),
  rev: t.u32(),
  sceneId: t.option(t.u64()),
  /** The map it's on (its key: caerwyn), for a place on a map (map-design §3.3). */
  mapKey: t.option(t.string()).default(undefined),
  /** The map region it fills there (a scene's place: granary-yard). */
  region: t.option(t.string()).default(undefined),
  /** Where its world's (0, 0) feet sits on its map, in tiles (5 ft a tile): (0, 0) for a map's own place. */
  origin: t.option(Tile2).default(undefined),
  /** It's on its map now: drawn there, and walked into. */
  active: t.bool().default(false),
  /**
   * JSON: shared/map/reconcile.ts TownChanges, what the rules did to a map's own things and people
   * outside scenes (town-design §3.1: a Fire Bolt at a door, the people who ran), as the prototype's
   * overlay keeps it; "" for none. Only a map's own place (map:<key>) has any.
   */
  town: t.string().default(""),
  /** When its clock last ticked a round (tick_place: town-design §3.5); none before the first. */
  tickedAt: t.option(t.timestamp()).default(undefined),
});

/** A key is unique in its game: by a check in the write path (byGameKey finds it). */
export const entity = table({ name: "entity", public: true, indexes: [{ accessor: "byGameKey", algorithm: "btree", columns: ["gameId", "key"] }] }, {
  id: t.u64().primaryKey().autoInc(),
  gameId: t.u64(),
  placeId: t.u64().index("btree"),
  /** Insertion order: the renderers' order. */
  ord: t.u32(),
  /** kell, pc:1, granary-yard/elm. */
  key: t.string(),
  parentId: t.option(t.u64()),
  name: t.string(),
  called: t.option(t.string()),
  /** place, area, feature, object, item, person, creature, surface. */
  kind: t.string(),
  prefab: t.option(t.string()),
  createdTurn: t.option(t.u32()),
  gone: t.bool(),
});

export const position = table({ name: "position", public: true }, {
  entityId: t.u64().primaryKey(), placeId: t.u64().index("btree"),
  x: t.f64(), y: t.f64(),
});
export const area = table({ name: "area", public: true }, {
  entityId: t.u64().primaryKey(), placeId: t.u64().index("btree"),
  x: t.f64(), y: t.f64(), w: t.f64(), h: t.f64(),
});
export const material = table({ name: "material", public: true }, {
  entityId: t.u64().primaryKey(), placeId: t.u64().index("btree"),
  material: t.option(t.string()), size: t.option(t.string()),
});
export const health = table({ name: "health", public: true }, {
  entityId: t.u64().primaryKey(), placeId: t.u64().index("btree"),
  hp: t.i32(), maxHp: t.i32(), ac: t.option(t.i32()),
});
export const stack = table({ name: "stack", public: true }, {
  entityId: t.u64().primaryKey(), placeId: t.u64().index("btree"),
  quantity: t.i32(),
});
export const surface = table({ name: "surface", public: true }, {
  entityId: t.u64().primaryKey(), placeId: t.u64().index("btree"),
  radiusFt: t.option(t.f64()), roundsLeft: t.option(t.i32()),
});
export const creature = table({ name: "creature", public: true }, {
  entityId: t.u64().primaryKey(), placeId: t.u64().index("btree"),
  castKey: t.option(t.string()), statblock: t.option(t.string()), weapon: t.option(t.string()),
});
export const playerCharacter = table({ name: "player_character", public: true }, {
  entityId: t.u64().primaryKey(), placeId: t.u64().index("btree"),
  playerId: t.u64(),
});
export const gear = table({ name: "gear", public: true }, {
  entityId: t.u64().primaryKey(), placeId: t.u64().index("btree"),
  engineItem: t.string(),
});

const WorldNote = t.object("WorldNote", { text: t.string(), turn: t.u32(), by: t.string() });
/** Every tag and state word, in the prototype's order, and the last six notes. */
export const narrative = table({ name: "narrative", public: true }, {
  entityId: t.u64().primaryKey(), placeId: t.u64().index("btree"),
  states: t.array(t.string()), tags: t.array(t.string()), notes: t.array(WorldNote),
});

/** The GM's own description, never shown on a glance. */
export const gmNote = table({ name: "gm_note" }, {
  entityId: t.u64().primaryKey(), placeId: t.u64().index("btree"),
  description: t.string(),
});

/** Append-only: the GM's "Lately". */
export const worldLog = table({ name: "world_log", public: true }, {
  id: t.u64().primaryKey().autoInc(),
  placeId: t.u64().index("btree"),
  seq: t.u32(),
  round: t.u32(),
  text: t.string(),
  /** author, rules, stage. */
  by: t.string(),
  cause: t.option(t.string()),
});

/**
 * A look invented for a thing the rules don't recognise (town-design §3.7: the look layer's
 * Invention): a glyph, a Nerd Font icon's name, a palette colour's name, how it moves, whether it
 * gives off light, is a being, is many, and what it's made of.
 */
const InventedLook = t.object("InventedLook", {
  glyph: t.string(), nerd: t.option(t.string()), color: t.string(), motion: t.string(), light: t.bool(), being: t.bool(), group: t.bool(), material: t.option(t.string()),
});

/** How the cast looks on screen (looks.json); and how a thing the story made looks (role invented, fg its colour's name, its invention). */
export const look = table({ name: "look", public: true }, {
  entityId: t.u64().primaryKey(), placeId: t.u64().index("btree"),
  role: t.string(), glyph: t.string(), fg: t.string(),
  /** An invented look (look.invent): none for the cast's. */
  invention: t.option(InventedLook).default(undefined),
});

/** The looks invented so far, by the thing's name (lower case): one costs once per name (the prototype's look cache). */
export const lookInvention = table({ name: "look_invention" }, {
  key: t.string().primaryKey(),
  name: t.string(),
  kind: t.option(t.string()),
  look: InventedLook,
  at: t.timestamp(),
});

// ---------------------------------------------------------------------------------------------
// Jobs (v0-design §3.5): one row per move in flight, holding its plan and its next request.

export const job = table({ name: "job" }, {
  id: t.u64().primaryKey().autoInc(),
  /** The current step's idempotency key. */
  key: t.string().unique(),
  /** The game, scene and turn a turn's job is for; none for a creation's (its plan names the creation). An option can't take an index, so the job loop reads a turn's jobs from the whole table (jobs.ts jobOf). */
  gameId: t.option(t.u64()),
  sceneId: t.option(t.u64()),
  turnId: t.option(t.u64()),
  /** say, openScene, creation; beside a turn, notes and suggest; after it, remember and repair (one row a turn and move); after a scene, crossBoundary (its scene's, with no turn). */
  move: t.string(),
  /** open, decide, reactions, consider, reply, settle, notes, suggest, remember, repair, boundary; a creation's offer, pick, own, draft, work, check, traits. */
  step: t.string(),
  endpoint: t.string(),
  timeoutMs: t.u32(),
  /** JSON: the POST body. */
  request: t.string(),
  /** JSON: the move's plan. */
  plan: t.string(),
  /** queued, running, waiting, failed. */
  state: t.string().index("btree"),
  attempts: t.u32(),
  deadline: t.option(t.timestamp()),
  retryAt: t.option(t.timestamp()),
  failingSince: t.option(t.timestamp()),
  error: t.option(t.string()),
  updatedAt: t.timestamp(),
});

/** A job to run now: the schedule table that runs run_job (its row is gone as the procedure starts). */
export const jobDispatch = table({ name: "job_dispatch" }, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
  jobId: t.u64(),
});

/** The reaper's interval (2 s, inserted by init): the schedule table that runs reap_jobs. */
export const reaper = table({ name: "reaper" }, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
});

// ---------------------------------------------------------------------------------------------
// The campaign's simulation half, installed by version (install_campaign).

export const campaign = table({ name: "campaign", public: true }, {
  /** caerwyn@0.1.0 */
  id: t.string().primaryKey(),
  key: t.string(),
  version: t.string(),
  title: t.string(),
  /** campaign.json */
  json: t.string(),
  /** builds.json */
  builds: t.string(),
  /** looks.json */
  looks: t.string(),
  installedAt: t.timestamp(),
});

export const sceneDef = table({ name: "scene_def" }, {
  /** caerwyn@0.1.0/hanged-clerk */
  id: t.string().primaryKey(),
  campaignId: t.string().index("btree"),
  key: t.string(),
  title: t.string(),
  hook: t.string(),
  /** The scene's .kmscene file whole (shared/scene/document.ts SceneDocument): its structure and its words. */
  json: t.string(),
});

export const placeDef = table({ name: "place_def" }, {
  /** caerwyn@0.1.0/granary-yard */
  id: t.string().primaryKey(),
  campaignId: t.string().index("btree"),
  key: t.string(),
  /** places/<key>.json */
  json: t.string(),
});

/** A campaign version's map (maps/<key>.json), which the client and the simulation both build (shared/map mapOf). Public: the map is what anyone sees. */
export const mapDef = table({ name: "map_def", public: true }, {
  /** caerwyn@0.1.0/caerwyn */
  id: t.string().primaryKey(),
  campaignId: t.string().index("btree"),
  key: t.string(),
  /** maps/<key>.json whole */
  json: t.string(),
});

// ---------------------------------------------------------------------------------------------
// The maps between scenes (map-design §3.1).

/** Someone walking with the player on the map (the prototype's Follower: Kell, after the granary; MapFollower, as the story's follower table has the name Follower). */
const MapFollower = t.object("MapFollower", { id: t.string(), name: t.string(), glyph: t.string(), color: t.string(), map: t.string(), at: Tile2 });
/** The menu's keep (shared/map/menu.ts Rested, Spotted, Lifted): `time` the story's time of day it was at. */
const Rested = t.object("Rested", { time: t.string(), short: t.bool(), long: t.bool() });
const Spotted = t.object("Spotted", { time: t.string(), at: Tile2, by: t.string() });
const Lifted = t.object("Lifted", { time: t.string(), who: t.array(t.string()) });
/** One side of a fight on the map (shared/map/types.ts CombatantSetup). side: player, ally, enemy, neutral. */
const Combatant = t.object("Combatant", {
  id: t.string(), name: t.string(), side: t.string(), statblock: t.option(t.string()), weapon: t.option(t.string()), at: Tile2,
  castId: t.option(t.string()), role: t.option(t.string()), glyph: t.option(t.string()),
});
/** A fight on the map as menu.ts's townFight sets it out (shared/map/types.ts TownFight): its map by key, who's in it, its dice's seed, where it is in words. */
const TownFight = t.object("TownFight", { map: t.string(), combatants: t.array(Combatant), seed: t.u32(), place: t.option(t.string()) });

/**
 * Where a player is on the maps between scenes: the prototype's ExploreState
 * (src/game/map/explore.ts:22) but the story, which is the game's, and what the last move said.
 * One row a player who walks (the host); public, so a spectator draws the host's map from it.
 */
export const explore = table({ name: "explore", public: true }, {
  playerId: t.u64().primaryKey(),
  gameId: t.u64().index("btree"),
  /** The map they're on (its key: caerwyn). */
  map: t.string(),
  at: Tile2,
  /** The way they last stepped: what's in front of them for interact. */
  facing: Tile2,
  steps: t.u32(),
  /** Out of sight after a Stealth check (V10's), until they show themselves. */
  hidden: t.bool(),
  /** The scene they're in, opened from here (its key), while it's played. */
  scene: t.option(t.string()),
  /** Who walks with them. */
  followers: t.array(MapFollower),
  /** The house lines' memory (quips.ts QuipMemory): how many said, the last one, the kinds of wall walked into. */
  quips: t.u32(),
  lastQuip: t.option(t.string()),
  styles: t.array(t.string()),
  /** Bumped by every move made on the map: a client shows `said` when it moves on. */
  acts: t.u32(),
  /** What the last move said, "" for nothing. */
  said: t.string(),
  /** The last five things said, newest last (the prototype's town log: observe's "Recently"). */
  log: t.array(t.string()),
  // The action menu's keep (town-design §3.1; the prototype's menu.ts Ctx.keep), each by the story's
  // time of day: a new time forgets it.
  /** When they last rested: the time of day, and whether short or long. */
  rested: t.option(Rested).default(undefined),
  /** Where they were seen trying to hide, and by whom. */
  spotted: t.option(Spotted).default(undefined),
  /** Whose pockets they've tried. */
  lifted: t.option(Lifted).default(undefined),
  /** A fight that broke out on the map (the people about came at them): recorded for V12, fought by the stand-in until then. */
  fight: t.option(TownFight).default(undefined),
});

/** The schedule table that runs tick_place for a map's own place while its game's host is in it (town-design §3.5): a 6 s interval. */
export const placeTick = table({ name: "place_tick" }, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
  placeId: t.u64(),
});

// ---------------------------------------------------------------------------------------------
// Character creation and the rules engine (v1-design §3.1, §3.5).

/**
 * A character being made, one per identity, read through my_creation: from the concept to the game
 * made from it, which `begin` sets off in (and deletes this row). Each move bumps `rev` (but
 * setBackstory), and a creation step's answer lands only while `rev` is still the one it was asked
 * at. JSON columns hold shared/rules and shared/creation types.
 */
export const creation = table({ name: "creation" }, {
  identity: t.identity().primaryKey(),
  /** newUid (games/create.ts): the creation's id in requests and keys; the game made from it takes it as game.uid. */
  uid: t.string(),
  /** caerwyn, and its version, 0.1.0 (as game.campaign and campaignVersion). */
  campaign: t.string(),
  campaignVersion: t.string(),
  name: t.string(),
  concept: t.string(),
  /** three, model, own. */
  how: t.string(),
  /** concept, choose, custom, backstory, made. */
  step: t.string(),
  /** What the GM is working on: builds, pick, own, draft, work, check, traits. */
  busy: t.option(t.string()),
  rev: t.u32(),
  /** JSON: Offer, the three builds. */
  offer: t.option(t.string()),
  /** JSON: OwnBuild, the player's own picks, what they come to, and the lists. */
  own: t.option(t.string()),
  /** JSON: BuildOption, the build chosen. */
  chosen: t.option(t.string()),
  /** The backstory as the box last had it. */
  story: t.string(),
  /** Bumped when the story is replaced from outside (a draft taken, a fix accepted): the box starts again with it. */
  version: t.u32(),
  /** JSON: Proposal, a draft or the notes worked in, waiting to be taken or left. */
  proposal: t.option(t.string()),
  /** JSON: LoreIssue[], what the lore check found, shown one at a time. */
  issues: t.option(t.string()),
  /** The issue on show. */
  issue: t.u32(),
  /** JSON: LoreIssue, the one they chose to rewrite themselves. */
  rewriting: t.option(t.string()),
  /** The fixes taken are being checked once more: not a third time. */
  again: t.bool(),
  /** A word for the player on the creation screens. */
  note: t.option(t.string()),
  /** Why the backstory went in without the lore check: the sheet says so over it. */
  unchecked: t.option(t.string()),
  /** JSON: Backstory, what the finished backstory says of them. */
  backstory: t.option(t.string()),
  /** The game made from it, until `begin`. */
  gameId: t.option(t.u64()),
  /** The model calls its steps made, and what they cost. */
  calls: t.u32(),
  costMicros: t.u64(),
  updatedAt: t.timestamp(),
});

/** kind: weapon, armor, shield, item; slot: mainHand, offHand, armor, shield. */
const GearRow = t.object("GearRow", { id: t.string(), name: t.string(), kind: t.string(), slot: t.option(t.string()) });

/**
 * The rules engine's side of a player's character: its campaign, serialized, which is the engine's
 * event log (loading it replays the events; shared/rules caches the loaded campaign per isolate).
 */
export const rulesState = table({ name: "rules_state" }, {
  playerId: t.u64().primaryKey(),
  gameId: t.u64().index("btree"),
  /** The engine's id for the character. */
  pc: t.string(),
  /** serializeCampaign: the engine's event log. */
  campaign: t.string(),
  /** The build's preferences, in order, for choices that come later (V7's level-ups). */
  prefer: t.array(t.string()),
  /** The character's gear: engine item instances, mirrored into the world as things they carry. */
  gear: t.array(GearRow),
  /** Gear the story has parted them from: off the sheet until they get it back. */
  gone: t.array(t.string()),
  /**
   * JSON: Record<cast id, { id; weapon }>, the cast the rules have touched as the engine's characters
   * (its id for them, and the weapon instance they fight with), so someone hurt stays hurt from one
   * turn to the next. "{}": nobody yet.
   */
  npcs: t.string().default("{}"),
  /** A spell with a listed duration is running: story time passing can end it. */
  timed: t.bool().default(false),
  /** A barbarian's Rage: the minutes of story time it has left. */
  rage: t.option(t.u32()).default(undefined),
});

// ---------------------------------------------------------------------------------------------
// The views' rows: each with a primary key, so a change arrives as one onUpdate.

/** my_seat: the caller's seat, as its player row has it. */
export const SeatView = t.row("SeatView", {
  playerId: t.u64().primaryKey(),
  gameId: t.u64(),
  placeId: t.option(t.u64()),
  sceneId: t.option(t.u64()),
  role: t.string(),
});

/** my_names: the cast on the caller's scene's stage, by the names its controller has heard. */
export const NameView = t.row("NameView", {
  entityId: t.u64().primaryKey(),
  key: t.string(),
  name: t.string(),
});

/** my_games: one of the caller's games, as the title lists it (v1-design §3.2). */
export const GameSummary = t.row("GameSummary", {
  gameId: t.u64().primaryKey(),
  /** The character's. */
  name: t.string(),
  /** morning, afternoon, evening, night. */
  time: t.string(),
  /** "in The Hanged Clerk", "The Hanged Clerk, over", "heading for The Hanged Clerk". */
  where: t.string(),
  /** The scene's hook: where it is, or where it's heading. */
  hook: t.string(),
  /** Whether it has set off (begin), or is still the sheet. */
  begun: t.bool(),
  lastPlayedAt: t.timestamp(),
});

// ---------------------------------------------------------------------------------------------

const spacetimedb = schema(
  {
    game, player, seat, sheet, dice, admin,
    scene, gmState, onStage, turn, transcript, replyDraft, sceneSuggestion, heard, coGmResult,
    chapter, quest, flag, journal, attitude, follower,
    place, entity, position, area, material, health, stack, surface, creature, playerCharacter, gear, narrative, gmNote, worldLog, look,
    job, jobDispatch, reaper,
    campaign, sceneDef, placeDef, mapDef,
    creation, rulesState,
    explore,
    talkRecord, lookInvention, placeTick,
  },
  {
    /** Set at publish (`AI_URL=… spacetime publish …`, or --env-only). */
    env: {
      /** Where the AI service is: http://11.0.0.1:8787 locally (v0-design §1.5). */
      AI_URL: t.option(t.string()),
      /** The bearer the module sends it. */
      AI_TOKEN: t.option(t.string()),
      /** The AI service's identity (hex): the only caller of stream_reply and service_ping. */
      AI_IDENTITY: t.option(t.string()),
    },
  },
);
export default spacetimedb;
