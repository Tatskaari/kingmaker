import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Play scripted sessions through the real scene CLI with the stage-manager trace on, to grow the
 * eval's raw material. Each script is a scene, a character and the player's turns; every turn is a
 * separate `scene say` process, exactly as a blind QA player would drive it.
 *
 *   KM_RUNS_DIR=runs/world node --no-warnings evals/world/play.ts evals/world/scripts.json [script-id ...]
 *
 * Traces land in <KM_RUNS_DIR>/sessions/<id>/stage-trace.jsonl.
 */

interface Script { id: string; scene: string; as: string; level?: number; seed?: number; turns: string[] }

const root = resolve(import.meta.dirname, "..", "..");
const runs = process.env.KM_RUNS_DIR ?? join(root, "runs", "world");
const [file, ...only] = process.argv.slice(2);
if (!file) throw new Error("Usage: play.ts <scripts.json> [script-id ...]");
const scripts = (JSON.parse(readFileSync(file, "utf8")) as Script[]).filter(s => !only.length || only.includes(s.id));

function cli(args: string[], id: string): string {
  const env = { ...process.env, KM_RUNS_DIR: runs, KM_STAGE_TRACE: join(runs, "sessions", id, "stage-trace.jsonl") };
  const run = spawnSync(process.execPath, ["--no-warnings", "--import", join(root, "evals/world/trace.ts"), join(root, "src/cli/scene.ts"), ...args], { cwd: root, env, encoding: "utf8", maxBuffer: 16 << 20 });
  if (run.status !== 0) throw new Error(`scene ${args[0]} failed: ${run.stderr.slice(0, 2000)}`);
  return run.stdout;
}

for (const s of scripts) {
  console.log(`\n=== ${s.id} (${s.scene})`);
  console.log(cli(["start", s.scene, "--session", s.id, "--as", s.as, "--level", String(s.level ?? 5), ...(s.seed ? ["--seed", String(s.seed)] : [])], s.id));
  for (const turn of s.turns) {
    console.log(`> ${turn}`);
    const out = cli(["say", s.id, turn], s.id);
    console.log(out);
    if (/The story is over|The End/.test(out)) break;
  }
}
