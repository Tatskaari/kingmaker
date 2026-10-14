import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { stageManage as stageManageReal } from "../../src/world/stage.ts";
import type { SceneWorld } from "../../src/world/scene-world.ts";

export * from "../../src/world/stage.ts";

/** One stage-manager call as it happened in play (see trace.ts). */
export interface StageTrace {
  at: string;
  turn: number;
  player: { name: string };
  playerTurn: string;
  reply: string;
  /** The world exactly as the stage manager read it (after this turn's rules and fire). */
  worldBefore: SceneWorld;
  worldAfter: SceneWorld;
  changes: string[];
  problems: string[];
  costUsd: number;
  latencyMs: number;
}

export async function stageManage(world: SceneWorld, player: { name: string }, playerTurn: string, reply: string, turn: number): Promise<{ changes: string[]; problems: string[]; costUsd: number }> {
  const before = structuredClone(world);
  const started = performance.now();
  const result = await stageManageReal(world, player, playerTurn, reply, turn);
  const file = process.env.KM_STAGE_TRACE;
  if (file) {
    const trace: StageTrace = { at: new Date().toISOString(), turn, player: { name: player.name }, playerTurn, reply, worldBefore: before, worldAfter: structuredClone(world), changes: result.changes, problems: result.problems, costUsd: result.costUsd, latencyMs: Math.round(performance.now() - started) };
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(trace) + "\n");
  }
  return result;
}
