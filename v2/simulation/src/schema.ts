import { Timestamp } from "spacetimedb";
import { schema, t, table } from "spacetimedb/server";

/**
 * Every table of the module, and its env (v0-design §3.1, v1-design §3.1, v5-design §3.1). Columns
 * are the TypeScript names; SQL, HTTP and subscription queries use snake_case (sceneId is scene_id).
 * Ids are u64 (bigint); an autoInc id is inserted as 0n. Every row belongs to one game, but a
 * creation's, which belongs to an identity until the game is made. Public tables are subscribed to by
 * clients; private ones are the module's (and the owner's, through SQL); the public ones are the
 * client's contract (client/module_bindings). A column added after V0 goes at its table's end with a
 * default, so a database keeps its rows across the publish (spacetime.md §4.10).
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
  /** morning, afternoon, evening, night. */
  time: t.string(),
  day: t.u32(),
  hostId: t.u64(),
  /** playing. */
  status: t.string(),
  createdAt: t.timestamp(),
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
  /** scene. */
  kind: t.string(),
  placeId: t.u64(),
  /** opening, live, closing (its ending's wind-down to play), ending (a reply closed it: its settle ends it), ended. */
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

/**
 * The GM's bookkeeping for a scene, a column a field of shared/gm/state.ts's GmState (gmToRow and
 * gmFromRow map the two). Only the fields V0 uses: a later vertical adds its own.
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
  /** queued, deciding, replying, settling, noting (all in but its reply's notes), done, failed. */
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
// The world (content-world B2): a component holds only a field that moves out of the prototype's
// Entity unchanged; every word stays in `narrative`. Each component row is keyed by entityId, with
// placeId copied in so a client can subscribe to one place.

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

/** How the cast looks on screen (looks.json). */
export const look = table({ name: "look", public: true }, {
  entityId: t.u64().primaryKey(), placeId: t.u64().index("btree"),
  role: t.string(), glyph: t.string(), fg: t.string(),
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
  /** say, openScene, creation; and beside a turn, notes and suggest (one row a turn and move). */
  move: t.string(),
  /** open, decide, reply, settle, notes, suggest; a creation's offer, pick, own, draft, work, check, traits. */
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
  /** scene.json whole: structure and its short logic text; no Markdown. */
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
    scene, gmState, onStage, turn, transcript, replyDraft, sceneSuggestion, heard,
    place, entity, position, area, material, health, stack, surface, creature, playerCharacter, gear, narrative, gmNote, worldLog, look,
    job, jobDispatch, reaper,
    campaign, sceneDef, placeDef,
    creation, rulesState,
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
