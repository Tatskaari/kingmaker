import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setCallLog } from "../llm/openrouter.ts";
import { rememberTurn } from "../lore/remember.ts";
import { reviewTurn } from "../lore/reviews.ts";
import { sceneById } from "../../scenes/index.ts";
import { approachById } from "./approaches.ts";
import { effectiveScene } from "./brief.ts";
import { runRepair, writeRepair } from "./repair.ts";
import { loadSession, sessionDir, type SessionState } from "./session.ts";

/**
 * The background work between turns (background.ts starts it), as the scene CLI's `remember` and
 * `repair` commands do it: in a detached process of their own in a terminal, in the game's own
 * process in the browser. Each reads the saved session and writes its own files, which the next
 * turn picks up, and clears its lock file when it's done, whatever happens.
 *
 * A job in a process of its own points the call log at its session's; in the game's process
 * (`ownLog: false`) the game's log already is, and a job mustn't move it (the call log is the
 * process's, and the player may have gone on to another game by the time the job gets going).
 */

interface JobOptions { ownLog?: boolean }

export const rememberLock = (id: string, turn: number) => join(sessionDir(id), `remember-${turn}.lock`);
export const repairLock = (id: string) => join(sessionDir(id), "repair.lock");

/** The memory review of a turn, as the turn stood (its snapshot): by now the session may have moved on to the next scene. */
export async function rememberJob(id: string, turn: number, sceneId: string | undefined, { ownLog = true }: JobOptions = {}): Promise<void> {
  try {
    const snapshot = join(sessionDir(id), "snapshots", `${sceneId}-turn-${String(turn).padStart(3, "0")}.json`);
    const state = sceneId && existsSync(snapshot) ? JSON.parse(readFileSync(snapshot, "utf8")) as SessionState : loadSession(id);
    if (ownLog) setCallLog(join(sessionDir(id), "calls.jsonl"));
    const scene = effectiveScene(sceneById(state.sceneId), state.patches);
    if (approachById(state.approach).memory === "lite") await rememberTurn(scene, state, turn);
    else {
      const result = await reviewTurn(scene, state, turn);
      appendFileSync(join(sessionDir(id), "memory-reviews.jsonl"), JSON.stringify({ turn, at: new Date().toISOString(), ...result }) + "\n");
    }
  } finally {
    rmSync(rememberLock(id, turn), { force: true });
  }
}

/** The co-GM's review of the scene so far. */
export async function repairJob(id: string, turn: number, { ownLog = true }: JobOptions = {}): Promise<void> {
  if (ownLog) setCallLog(join(sessionDir(id), "calls.jsonl"));
  try {
    const state = loadSession(id);
    const scene = sceneById(state.sceneId);
    const result = await runRepair(scene, state, { effort: approachById(state.approach).repairEffort ?? "medium" });
    result.turn = Number.isFinite(turn) ? turn : state.turn;
    writeRepair(state, result);
  } finally {
    rmSync(repairLock(id), { force: true });
  }
}
