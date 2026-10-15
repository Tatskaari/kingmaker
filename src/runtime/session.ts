import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RollResult } from "./dice.ts";
import type { Beat, Essential, Skill, Transition } from "./scene.ts";
import type { Operation } from "../world/dsl.ts";
import { untangle, type Entity, type SceneWorld } from "../world/scene-world.ts";

export type EntryKind = "player" | "narration" | "dialogue" | "roll" | "system";
export interface Entry { turn: number; speaker: string; kind: EntryKind; text: string; scene?: string }

export interface PlayerCharacter {
  name: string;
  concept: string;
  modifiers: Partial<Record<Skill, number>>;
  /** Their D&D build in a line ("human rogue 3 (thief), criminal background"), when the rules engine made the sheet. */
  build?: string;
  /** Their own backstory, from character creation (src/lore/backstory.ts): the sheet shows it, and the GM knows it. */
  backstory?: Backstory;
}

/**
 * The player's backstory, written (or drafted, or worked in from their notes) at character
 * creation and checked against the world's lore: the whole of it, and what it says of them. It
 * changes no mechanics (the background chosen with the build does that).
 */
export interface Backstory {
  /** The whole of it, in the player's words (with any lore fix they accepted). */
  text: string;
  /** Who they are, in a sentence or two (in the third person): what every GM brief says of them. */
  summary: string;
  personality: string[];
  ideals: string[];
  bonds: string[];
  flaws: string[];
}

/** D&D mechanics (src/rules/dnd.ts): the engine's campaign, and who in the story it has given stats. */
export interface RulesState {
  /** The engine campaign, event log and state (serializeCampaign). */
  campaign: string;
  /** Engine id of the player character. */
  pc: string;
  /** Story characters the rules have touched: cast id -> engine id and the weapon they fight with. */
  npcs: Record<string, { id: string; weapon: string }>;
  /** Cast id -> what the player calls them, for people whose names they haven't heard (the dice name them so). */
  aliases?: Record<string, string>;
  /** The build's preferences, in order, for choices that come later (level-ups). */
  prefer?: string[];
  /** Kept up to date by the rules, so a turn's decision needn't load the engine. */
  spells?: Array<{ id: string; name: string; level: number }>;
  weapons?: Array<{ id: string; name: string }>;
  /** Class features the player can use in a scene (Second Wind, Rage...), with whether they take a target. */
  features?: Array<{ id: string; name: string; target: "self" | "creature" }>;
  /** "HP 13/24, spell slots 1st 2/4": the player's state for the GM's brief. */
  status?: string;
  /** A spell with a listed duration is running: story time passing can end it. */
  timed?: boolean;
  /** The player's gear (engine item instances), mirrored into scene worlds as things they carry. */
  gear?: Array<{ id: string; name: string; kind: "weapon" | "armor" | "shield" | "item"; slot?: "mainHand" | "offHand" | "armor" | "shield" }>;
  /** Gear the story has parted them from (given away, dropped, left behind): off the sheet until they get it back. */
  gone?: string[];
}

/** Something the last reply left hanging over the player, resolved by the rules at the start of their next turn. */
export type Threat =
  | { kind: "attack"; by: string; turn: number }
  | { kind: "hazard"; hazard: string; severity: "glancing" | "serious"; turn: number };

export interface TurnMetric {
  turn: number;
  /** Time spent in a blocking co-GM review before anything else (0 otherwise). */
  repairMs?: number;
  /** Stall mode: time until the follow-up (resolving) text started, when there was one. */
  followUpMs?: number | null;
  /** Time until text that answers the player started (follow-up after a holding beat, else first text). */
  resolvingTextMs?: number | null;
  /** A considered turn: how long the GM's review took (its call, from the decision to the ruling). */
  considerMs?: number;
  preDecisionMs: number;
  firstTextMs: number | null;
  replyMs: number;
  postDecisionMs: number;
  costUsd: number;
  calls: number;
}

/** Changes made to the scene's prep during play (the co-GM's, a talk's, the boundary's), kept separate from authored data. */
export interface ScenePatch {
  turn: number;
  /** Improvised beat bridging back to the authored ones. */
  beat?: Beat;
  /** Extra transition on an existing beat (e.g. letting the player's approach count). */
  transition?: { beat: string; transition: Transition };
  /** What someone is keeping back now, in place of their card's secrets (a talk's one thing to open up about). */
  cast?: { id: string; secrets: string[] };
  /** A route ruled out (a considered ruling's outcome): gone from that beat ("*": from anywhere) for the rest of the scene. */
  close?: { beat: string; id: string };
  /**
   * An essential the boundary brought over from an earlier scene, where the player missed it (its
   * `missed` says which): this scene's own prep for it, or the boundary's placing of it here.
   */
  essential?: Essential;
  why: string;
}

/**
 * A considered turn's ruling (src/runtime/consider.ts): what the player attempted that no route
 * settled, whether it was rolled and at what, and what each outcome changed. The scene's own, kept
 * for the record and for the next ruling (the same push again gets the same answer).
 */
export interface RulingRecord {
  turn: number;
  /** What the player attempted, as the GM saw it. */
  act: string;
  /** Who they were working on (a cast id), or "world" for a feat. */
  target: string;
  skill: Skill;
  /** "roll", or no roll: "yes" (it works) or "no" (not like this). */
  kind: "roll" | "yes" | "no";
  dc?: number;
  /** Why there was no roll, or what set the DC (the judgements, in a few words). */
  why: string;
  roll?: RollResult;
  /** How it went: the outcome that was played. */
  went: "success" | "failure";
  /** What the played outcome changed: where it went, the facts, what came out, routes opened and closed. */
  changed: string;
  costUsd: number;
  latencyMs: number;
}

/**
 * What the story still owes the player: an essential of a scene already over that the rest of the
 * story needs (`later`), which they didn't come across there. It goes from boundary to boundary
 * until they do (src/runtime/owed.ts).
 */
export interface Owed {
  /** The scene it was placed in, and its id there ("hanged-clerk", "page"). */
  from: string;
  id: string;
  /** The essential as that scene wrote it. */
  essential: Essential;
  /** The player has had a sign of it already (a reply pointed towards it): nobody points at it again. */
  hinted?: boolean;
  /**
   * The things it's in, as the last world they were in left them, when someone has them: each
   * with what's inside it, the outermost held by its holder (`parent`, a cast id). They go with
   * their holder into each next scene's world (the page is still in the boot, on Cob's feet).
   */
  things?: Entity[];
  /** Who has its things now (cast ids, or "player"). */
  holders?: string[];
  /** Where it is now, in a few words, for the boundary ("a folded page sewn into the left boot's lining, in Prout's good black boots, with Cob"). */
  where?: string;
}

/** How far someone has opened up about what they're keeping back (staged secrets): it never goes back. */
export type Stage = "surface" | "tell" | "stirred" | "torn" | "settled";

/** A companion's talks with the player between scenes (src/runtime/talk.ts), kept for the whole story. */
export interface TalkRecord {
  /** How many times the player has stopped for a word with them. */
  count: number;
  /** What they've told the player of themselves: each note of their lore once, in the order told. */
  told: Array<{ note: string; topic: string; turn: number }>;
  /** How far they'd come with things not yet told, carried to the next talk that turns to them. */
  stages?: Record<string, Stage>;
}

/**
 * A line the player might say or do next in a scene (src/runtime/suggest.ts), as they'd type it:
 * something to say, a deed in brackets, a risky try in brackets that would call for a roll, or a way
 * to leave.
 */
export interface Suggestion { kind: "say" | "do" | "try" | "leave"; text: string }

/** A talk in progress: the scene the story is heading for is put aside until it's over. */
export interface TalkState {
  /** The companion's cast id. */
  with: string;
  /** Where and when, as the map has it. */
  where: string;
  /** The waiting scene's own state (everything a session doesn't keep across scenes), put back afterwards. */
  waiting: Partial<SessionState>;
  /** The one thing they might open up about this time: a note of their lore, what it is, and how they'd remember telling it. */
  confide?: { note: string; topic: string; what: string; memory: string };
  /** What the player might say next: the talk's dialogue choices. */
  suggestions: string[];
}

export type SceneStatus = "on_track" | "drifting" | "stuck" | "uncovered";

export interface RepairResult {
  /** Turn the repair agent analysed. */
  turn: number;
  assessment: string;
  status: "on_track" | "drifting" | "stuck";
  notes: string;
  /** Per-character steering for the next exchange or two. */
  whispers?: Array<{ to: string; note: string }>;
  /** Essentials the co-GM moved because play went elsewhere. */
  relocations?: Array<{ essential: string; technique: string; to: string; how: string }>;
  canon: string[];
  patches: ScenePatch[];
  moveTo?: string;
  costUsd: number;
  latencyMs: number;
}

export interface SessionState {
  id: string;
  sceneId: string;
  approach: string;
  seed: number;
  rollCount: number;
  player: PlayerCharacter;
  turn: number;
  beat: string;
  turnsInBeat: number;
  /** Transitions taken, in order. */
  path: Array<{ turn: number; from: string; to: string; via: string; roll?: RollResult; source: "pre" | "post" | "repair" }>;
  established: string[];
  canon: string[];
  notes: string | null;
  notesTurn: number | null;
  whispers?: Array<{ to: string; note: string; turn: number }>;
  /** The ending the story has been leaning towards, and for how many replies in a row. */
  endingLead?: { exitId: string; count: number; probability: number };
  /** Turn on which the decider last judged the player off the graph (gates the co-GM). */
  offGraphTurn?: number;
  /** Stall-mode co-GM results that missed the deadline (they land next turn). */
  lateRepairs?: number;
  /** Speculative replies kept vs discarded (gm-fast). */
  speculation?: { used: number; discarded: number };
  /** A sentence the last reply repeated word for word: the next reply is told not to (a reply already on screen isn't rewritten). */
  repeated?: string;
  /** Essentials the decider chose to bring to the player through another carrier. */
  decidedRelocations?: Array<{ essential: string; carrier: string; turn: number }>;
  /** Essentials the player has come across (judged after each reply). */
  landed?: string[];
  /** Essentials a reply has already pointed towards: a nudge is given once, not repeated. */
  hinted?: string[];
  /** Staged secrets: how far each secret-holder has opened up (never goes back). */
  guard?: Record<string, { stage: Stage; turn: number }>;
  /** Docs-service memory: notes Jev has opened for this scene (indexes are always in). */
  memory?: {
    opened: Array<{ path: string; title: string; scope: string; turn: number }>;
    /** Notes kept out of this scene however relevant (a talk keeps back what isn't theirs to tell yet). */
    withheld?: string[];
  };
  /** Beats whose pressure has already been offered to the GM (it fires once). */
  pressureOffered?: string[];
  /** Characters brought on stage early by play (before their authored entrance beat). */
  entered?: string[];
  /** Recurring characters the hand-off rules out of this scene (taken in, fled, left behind). */
  absent?: string[];
  /** Cheap per-turn status from the after-reply decision; gates the repair agent. */
  sceneStatus?: SceneStatus;
  lastRepairTurn?: number;
  patches: ScenePatch[];
  /** Considered turns' rulings in this scene, in order. */
  rulings?: RulingRecord[];
  repairs: Array<Omit<RepairResult, "patches" | "canon" | "whispers" | "relocations"> & { patches: number; canon: number; whispers: number; relocations?: Array<{ essential: string; technique: string; to: string; how: string }> }>;
  transcript: Entry[];
  metrics: TurnMetric[];
  ended?: { exitId: string; turn: number; operations: Operation[]; warnings: string[] };
  /** An ending the player didn't choose is coming; they get one last chance to respond. */
  pendingExit?: { exitId: string; turn: number; via: string; extended: boolean };
  /** The story reached an ending; the next player turn is the wind-down, then the scene closes. */
  closing?: { exitId: string; turn: number };
  /** D&D mechanics, when the session has a rules-engine character sheet. */
  rules?: RulesState;
  /** A blow or a danger the last reply left hanging over the player (rules sessions). */
  threat?: Threat;
  /**
   * A fight the player's violence started in the scene (decided reactions: some fight, some flee):
   * who goes for the player and who's with them. The game plays it out on the map; elsewhere the
   * first of them swings at the player next turn.
   */
  brawl?: { turn: number; cause: string; against: string[]; allies: string[]; fled: string[] };
  /** Where this scene's prep no longer matches the story (written at the scene boundary): these override it. */
  adjustments?: string[];
  /** The scene's opening rewritten at the boundary to start where the story actually is. */
  opening?: string;
  /** How the player comes to know where the story goes next, in the fiction (for a game with a map to walk). */
  lead?: string;
  /** Combat exits already fought (the scene resumed after the fight on the map). */
  fought?: string[];
  /** The scene's world: where everything and everyone is, and in what state (scenes with a world spec). */
  world?: SceneWorld;
  /** What the player carried out of the last scene's world, to carry into the next. */
  carried?: Entity[];
  /**
   * What the player might say or do next, made after a GM reply (src/runtime/suggest.ts): for that
   * scene and turn only, so a line said since, or a scene moved on from, leaves them behind. `ms`:
   * from the reply to their coming; `costUsd`: the call's.
   */
  suggestions?: { scene: string; turn: number; lines: Suggestion[]; ms?: number; costUsd?: number };
  /** What the story still owes the player from scenes already over (kept across scenes, and a talk's). */
  owed?: Owed[];
  /** A word with a companion between scenes, in progress (the scene the story is heading for waits). */
  talk?: TalkState;
  /** Each companion's talks with the player so far, by cast id. */
  talks?: Record<string, TalkRecord>;
  /** Scene chain: previous scenes' exits in this session. */
  history: Array<{
    sceneId: string; exitId: string; summary: string; lastMoments?: string[]; skipped?: Array<{ sceneId: string; why: string }>;
    /** What moved in the world's fronts at this boundary (ticked and struck steps, new bills). */
    fronts?: string[];
  }>;
}

export const runsDir = () => process.env.KM_RUNS_DIR ?? "runs";
export const sessionDir = (id: string) => join(runsDir(), "sessions", id);

export function saveSession(state: SessionState): void {
  const dir = sessionDir(state.id);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `state.json.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(state, null, 1));
  renameSync(tmp, join(dir, "state.json"));
}

/** Per-turn snapshots so any moment of a QA run can become an eval fixture. */
export function snapshotSession(state: SessionState): void {
  const dir = join(sessionDir(state.id), "snapshots");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${state.sceneId}-turn-${String(state.turn).padStart(3, "0")}.json`), JSON.stringify(state, null, 1));
}

export function loadSession(id: string): SessionState {
  const file = join(sessionDir(id), "state.json");
  if (!existsSync(file)) throw new Error(`No session ${id} (looked in ${file})`);
  const state = JSON.parse(readFileSync(file, "utf8")) as SessionState;
  // A world saved with something inside itself (before the world refused it) is put right, or every
  // turn after it would fail going round the loop, and so would every retry from this save.
  if (state.world) untangle(state.world);
  return state;
}

export function newSessionId(sceneId: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  return `${sceneId}-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}
