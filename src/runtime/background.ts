import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sceneById } from "../../scenes/index.ts";
import { sceneApproach } from "./approaches.ts";
import { shouldRepair } from "./repair.ts";
import { sessionDir, type SessionState } from "./session.ts";

/**
 * Background work between turns, exactly as the scene CLI does it (src/cli/scene.ts): the co-GM
 * reviews the scene and the docs-service memory reviews the turn, each in a detached process that
 * reads the saved session and writes its own files, which the next turn picks up. Never waited on.
 * Shared by the scene CLI, the playable game (src/game/play.ts) and the app.
 */

const CLI = fileURLToPath(new URL("../cli/scene.ts", import.meta.url));

function detached(args: string[]): void {
  try {
    const child = spawn(process.execPath, ["--no-warnings", CLI, ...args], { detached: true, stdio: "ignore", env: process.env });
    child.unref();
  } catch { /* background work is best effort */ }
}

export function afterTurn(state: SessionState): void {
  // As the scene runs it: a talk with a companion has no co-GM.
  const approach = sceneApproach(state, sceneById(state.sceneId));
  if (approach.memory) {
    writeFileSync(join(sessionDir(state.id), `remember-${state.turn}.lock`), String(state.turn));
    detached(["remember", state.id, "--turn", String(state.turn), "--scene", state.sceneId]);
  }
  if (!state.ended && ["background", "stall", "quick-block"].includes(approach.repair) && shouldRepair(state)) {
    writeFileSync(join(sessionDir(state.id), "repair.lock"), String(state.turn));
    detached(["repair", state.id, "--turn", String(state.turn)]);
  }
}
