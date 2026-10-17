/**
 * A QA round: blind testers play one scene, each game on an arm (a variant of the GM) under a
 * neutral name, so neither the testers nor the reviewers can tell which build a game is on.
 *
 * <rounds>/<round>/
 *   round.json                 the scene, the arms (k1 → a variant), the games (g03 → arm, persona)
 *   runs/sessions/<game>/      each game's session: state, snapshots, calls.jsonl, docs
 *   notes/<game>.md            the tester's own notes (what felt off, as a player)
 *   reviews/<game>.pack.md     what a blind reviewer reads (loop review-pack)
 *   reviews/<game>.json        the reviewer's findings (checked by loop review-check)
 *   report/                    the report (loop report)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOOP_DIR, ROOT, VARIANTS_DIR, runsRoot } from "./paths.ts";

export interface Variant {
  name: string;
  description: string;
  approach: string;
  /** Extra environment for the game's processes (KM_* settings). */
  env: Record<string, string>;
  /** A folder of prompt files used in place of prompts/'s (KM_PROMPTS_DIR). */
  promptsDir?: string;
}

/** The game as it is: the approach the game plays, no overlay. */
export const BASELINE: Variant = { name: "baseline", description: "The game as it is on this commit: approach v2, prompts/ as checked in.", approach: "v2", env: {} };

/**
 * A variant: evals/loop/variants/<name>/variant.json ({ description, approach?, env? }) and an
 * optional prompts/ folder beside it whose files replace prompts/'s of the same name.
 */
export function loadVariant(name: string): Variant {
  if (name === "baseline") return BASELINE;
  // A game brought in from elsewhere (a playtest's report): played on whatever build made it.
  if (name.startsWith("import:")) return { name, description: `Imported: ${name.slice("import:".length)}`, approach: BASELINE.approach, env: {} };
  const dir = join(VARIANTS_DIR, name);
  const file = join(dir, "variant.json");
  if (!existsSync(file)) throw new Error(`No variant ${name} (looked for ${file}).`);
  const spec = JSON.parse(readFileSync(file, "utf8")) as Partial<Variant>;
  return {
    name, description: spec.description ?? "", approach: spec.approach ?? BASELINE.approach, env: spec.env ?? {},
    ...(existsSync(join(dir, "prompts")) ? { promptsDir: join(dir, "prompts") } : {}),
  };
}

export function variantEnv(v: Variant): Record<string, string> {
  return { ...v.env, ...(v.promptsDir ? { KM_PROMPTS_DIR: v.promptsDir } : {}) };
}

export interface Persona { id: string; as: string; style: string; goal?: string }
export const personas = (): Persona[] => JSON.parse(readFileSync(join(LOOP_DIR, "personas.json"), "utf8")) as Persona[];

export interface Round {
  name: string;
  scene: string;
  created: string;
  build: { commit: string; dirty: boolean };
  /** Most player turns a game may take. */
  maxTurns: number;
  level: number;
  /** Neutral arm name → the variant it plays. */
  arms: Record<string, string>;
  /** Neutral game name → its arm and persona (a goal, for a goal-directed game). */
  games: Record<string, { arm: string; persona: string; goal?: string }>;
}

export const roundDir = (name: string) => join(runsRoot(), name);
export const roundRuns = (name: string) => join(roundDir(name), "runs");
export const gameDir = (round: string, game: string) => join(roundRuns(round), "sessions", game);

export function loadRound(name: string): Round {
  const file = join(roundDir(name), "round.json");
  if (!existsSync(file)) throw new Error(`No round ${name} (looked for ${file}).`);
  return JSON.parse(readFileSync(file, "utf8")) as Round;
}

export function build(): { commit: string; dirty: boolean } {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "src", "prompts", "scenes", "lore"], { cwd: ROOT, encoding: "utf8" }).trim().length > 0;
    return { commit, dirty };
  } catch { return { commit: "unknown", dirty: true }; }
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}

export function saveRound(round: Round): void {
  writeFileSync(join(roundDir(round.name), "round.json"), JSON.stringify(round, null, 1) + "\n");
}

/** A new round: every persona plays every variant `repeat` times, under shuffled neutral names. */
export function newRound(name: string, options: { scene: string; variants: string[]; personas: string[]; repeat?: number; maxTurns?: number; level?: number; goal?: string }): Round {
  const dir = roundDir(name);
  if (existsSync(join(dir, "round.json"))) throw new Error(`Round ${name} already exists (${dir}).`);
  for (const v of options.variants) loadVariant(v);
  const known = new Set(personas().map(p => p.id));
  for (const p of options.personas) if (!known.has(p)) throw new Error(`No persona ${p} in evals/loop/personas.json.`);
  const arms = Object.fromEntries(shuffle(options.variants).map((v, i) => [`k${i + 1}`, v]));
  const armOf = Object.fromEntries(Object.entries(arms).map(([k, v]) => [v, k]));
  const plays = shuffle(options.personas.flatMap(p => options.variants.flatMap(v => Array.from({ length: options.repeat ?? 1 }, () => ({ arm: armOf[v]!, persona: p })))));
  const games = Object.fromEntries(plays.map((g, i) => [`g${String(i + 1).padStart(2, "0")}`, { ...g, ...(options.goal ? { goal: options.goal } : {}) }]));
  const round: Round = {
    name, scene: options.scene, created: new Date().toISOString(), build: build(),
    maxTurns: options.maxTurns ?? 20, level: options.level ?? 3, arms, games,
  };
  mkdirSync(join(dir, "notes"), { recursive: true });
  mkdirSync(join(dir, "reviews"), { recursive: true });
  writeFileSync(join(dir, "round.json"), JSON.stringify(round, null, 1) + "\n");
  return round;
}
