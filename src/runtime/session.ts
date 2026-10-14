import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RollResult } from "./dice.ts";
import type { Beat, Skill, Transition } from "./scene.ts";
import type { Operation } from "../world/dsl.ts";
import type { Entity, SceneWorld } from "../world/scene-world.ts";

export type EntryKind = "player" | "narration" | "dialogue" | "roll" | "system";
export interface Entry { turn: number; speaker: string; kind: EntryKind; text: string; scene?: string }

export interface PlayerCharacter {
  name: string;
  concept: string;
  modifiers: Partial<Record<Skill, number>>;
  /** Their D&D build in a line ("human rogue 3 (thief), criminal background"), when the rules engine made the sheet. */
  build?: string;
}

/** D&D mechanics (src/rules/dnd.ts): the engine's campaign, and who in the story it has given stats. */
export interface RulesState {
  /** The engine campaign, event log and state (serializeCampaign). */
  campaign: string;
  /** Engine id of the player character. */
  pc: string;
  /** Story characters the rules have touched: cast id -> engine id and the weapon they fight with. */
  npcs: Record<string, { id: string; weapon: string }>;
  /** The build's preferences, in order, for choices that come later (level-ups). */
  prefer?: string[];
  /** Kept up to date by the rules, so a turn's decision needn't load the engine. */
  spells?: Array<{ id: string; name: string; level: number }>;
  weapons?: Array<{ id: string; name: string }>;
  /** "HP 13/24, spell slots 1st 2/4": the player's state for the GM's brief. */
  status?: string;
  /** A spell with a listed duration is running: story time passing can end it. */
  timed?: boolean;
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
  preDecisionMs: number;
  firstTextMs: number | null;
  replyMs: number;
  postDecisionMs: number;
  costUsd: number;
  calls: number;
}

/** Changes the background repair agent made to the scene graph, kept separate from authored data. */
export interface ScenePatch {
  turn: number;
  /** Improvised beat bridging back to the authored ones. */
  beat?: Beat;
  /** Extra transition on an existing beat (e.g. letting the player's approach count). */
  transition?: { beat: string; transition: Transition };
  why: string;
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
  /** Essentials the decider chose to bring to the player through another carrier. */
  decidedRelocations?: Array<{ essential: string; carrier: string; turn: number }>;
  /** Essentials the player has come across (judged after each reply). */
  landed?: string[];
  /** Essentials a reply has already pointed towards: a nudge is given once, not repeated. */
  hinted?: string[];
  /** Staged secrets: how far each secret-holder has opened up (never goes back). */
  guard?: Record<string, { stage: "surface" | "tell" | "stirred" | "torn" | "settled"; turn: number }>;
  /** Docs-service memory: notes Jev has opened for this scene (indexes are always in). */
  memory?: { opened: Array<{ path: string; title: string; scope: string; turn: number }> };
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
  /** Where this scene's prep no longer matches the story (written at the scene boundary): these override it. */
  adjustments?: string[];
  /** The scene's world: where everything and everyone is, and in what state (scenes with a world spec). */
  world?: SceneWorld;
  /** What the player carried out of the last scene's world, to carry into the next. */
  carried?: Entity[];
  /** Scene chain: previous scenes' exits in this session. */
  history: Array<{ sceneId: string; exitId: string; summary: string; lastMoments?: string[]; skipped?: Array<{ sceneId: string; why: string }> }>;
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
  return JSON.parse(readFileSync(file, "utf8")) as SessionState;
}

export function newSessionId(sceneId: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  return `${sceneId}-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}
