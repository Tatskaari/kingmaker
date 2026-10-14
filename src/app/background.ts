import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { approachById } from "../runtime/approaches.ts";
import { shouldRepair } from "../runtime/repair.ts";
import { sessionDir, type SessionState } from "../runtime/session.ts";

/**
 * Background work between turns, exactly as the scene CLI does it (src/cli/scene.ts): the co-GM
 * reviews the scene and the docs-service memory reviews the turn, each in a detached process that
 * reads the saved session and writes its own files, which the next turn picks up. Never waited on.
 * (Proposal: move spawnRepair/spawnRemember out of the CLI into src/runtime so both share them.)
 */

const CLI = fileURLToPath(new URL("../cli/scene.ts", import.meta.url));

function detached(args: string[]): void {
  try {
    const child = spawn(process.execPath, ["--no-warnings", CLI, ...args], { detached: true, stdio: "ignore", env: process.env });
    child.unref();
  } catch { /* background work is best effort */ }
}

export function afterTurn(state: SessionState): void {
  const approach = approachById(state.approach);
  if (approach.memory) {
    writeFileSync(join(sessionDir(state.id), `remember-${state.turn}.lock`), String(state.turn));
    detached(["remember", state.id, "--turn", String(state.turn), "--scene", state.sceneId]);
  }
  if (!state.ended && ["background", "stall", "quick-block"].includes(approach.repair) && shouldRepair(state)) {
    writeFileSync(join(sessionDir(state.id), "repair.lock"), String(state.turn));
    detached(["repair", state.id, "--turn", String(state.turn)]);
  }
}
