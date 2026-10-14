import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RollResult } from "./dice.ts";
import type { Beat, Skill, Transition } from "./scene.ts";
import type { Operation } from "../world/dsl.ts";

export type EntryKind = "player" | "narration" | "dialogue" | "roll" | "system";
export interface Entry { turn: number; speaker: string; kind: EntryKind; text: string; scene?: string }

export interface PlayerCharacter { name: string; concept: string; modifiers: Partial<Record<Skill, number>> }

export interface TurnMetric {
  turn: number;
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

export interface RepairResult {
  /** Turn the repair agent analysed. */
  turn: number;
  assessment: string;
  status: "on_track" | "drifting" | "stuck";
  notes: string;
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
  patches: ScenePatch[];
  repairs: Array<Omit<RepairResult, "patches" | "canon"> & { patches: number; canon: number }>;
  transcript: Entry[];
  metrics: TurnMetric[];
  ended?: { exitId: string; turn: number; operations: Operation[]; warnings: string[] };
  /** An ending the player didn't choose is coming; they get one last chance to respond. */
  pendingExit?: { exitId: string; turn: number; via: string; extended: boolean };
  /** The story reached an ending; the next player turn is the wind-down, then the scene closes. */
  closing?: { exitId: string; turn: number };
  /** Scene chain: previous scenes' exits in this session. */
  history: Array<{ sceneId: string; exitId: string; summary: string }>;
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
