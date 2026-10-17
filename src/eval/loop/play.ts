/**
 * Blind play: a tester plays a round's game through the scene harness (src/cli/scene.ts), as
 * the game it is on would be played, and sees only what a player sees. The arm's variant goes in
 * the environment; the markup lines under each reply (who says what, the notes) are left out.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionState } from "../../runtime/session.ts";
import { LOOP_DIR, ROOT } from "./paths.ts";
import { gameDir, loadRound, loadVariant, personas, roundDir, roundRuns, variantEnv, type Round } from "./round.ts";

const SCENE = join(ROOT, "src", "cli", "scene.ts");

function game(round: Round, id: string) {
  const g = round.games[id];
  if (!g) throw new Error(`No game ${id} in round ${round.name} (games: ${Object.keys(round.games).join(", ")}).`);
  const variant = loadVariant(round.arms[g.arm]!);
  const persona = personas().find(p => p.id === g.persona)!;
  return { ...g, variant, persona };
}

function scene(round: Round, id: string, args: string[]): string {
  const g = game(round, id);
  const result = spawnSync(process.execPath, ["--no-warnings", SCENE, ...args], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...variantEnv(g.variant), KM_RUNS_DIR: roundRuns(round.name), KM_SCENE_ONLY: "1" },
  });
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return out.split("\n").filter(line => !line.trimStart().startsWith("⟨")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const turnOf = (round: Round, id: string): SessionState | undefined => {
  const file = join(gameDir(round.name, id), "state.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as SessionState : undefined;
};

export function start(roundName: string, id: string): string {
  const round = loadRound(roundName);
  if (turnOf(round, id)) return `Game ${id} has already started. Go on with: npm run -s loop -- say ${roundName} ${id} "<what you say or do>"`;
  const g = game(round, id);
  return scene(round, id, ["start", round.scene, "--approach", g.variant.approach ?? "v2", "--level", String(round.level), "--session", id, "--as", g.persona.as]);
}

export function say(roundName: string, id: string, text: string): string {
  const round = loadRound(roundName);
  const before = turnOf(round, id);
  if (!before) return `Game ${id} hasn't started: npm run -s loop -- start ${roundName} ${id}`;
  if (before.ended) return "— The scene is over. — Write your notes now.";
  if (before.turn >= round.maxTurns) return `That was your last turn (the round's limit is ${round.maxTurns}). Write your notes now.`;
  const out = scene(round, id, ["say", id, text]);
  const after = turnOf(round, id)!;
  const left = round.maxTurns - after.turn;
  const tail = after.ended ? "" : left <= 0 ? `\n\n(That was your last turn. Write your notes now.)` : `\n\n(Turn ${after.turn} of ${round.maxTurns}.)`;
  return out + tail;
}

export function view(roundName: string, id: string, what: "transcript" | "sheet" | "map"): string {
  return scene(loadRound(roundName), id, [what, id]);
}

/** What a tester is told: their character, how to play them, the commands, and nothing about the build. */
export function brief(roundName: string, id: string): string {
  const round = loadRound(roundName);
  const g = game(round, id);
  const template = readFileSync(join(LOOP_DIR, "tester.md"), "utf8");
  const fill: Record<string, string> = {
    round: roundName, game: id, as: g.persona.as, style: g.persona.style, maxTurns: String(round.maxTurns),
    goal: g.goal ? `\n## Your goal\n\n${g.goal}\n` : "",
    notes: join(roundDir(roundName), "notes", `${id}.md`),
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => fill[k] ?? "");
}
