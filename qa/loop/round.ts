// After the GM loop's src/eval/loop/round.ts at 5f01806 (origin/claude/gm-loop, draft PR #663): a round's games under neutral names, every persona dealt out across them. On the game, each game has a scene of its own (a round can mix them), and an arm is the stack its games are played on (a dev stack's folder), not a prompt overlay: the game's AI service takes none.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PERSONAS, roundDir, type LoopConfig } from "./paths.ts";

/**
 * A QA round: blind testers play the game's scenes, each game on an arm (a build of the game) under
 * a neutral name, so neither the testers nor the reviewers can tell which build a game is on.
 */

/** An archetype a tester plays (docs/QA.txt): who, in a sentence, how they play, and the ready-made build nearest them, for when a character can't be made from the sentence. */
export interface Persona { id: string; as: string; style: string; build: string; goal?: string }

export const personas = (file = PERSONAS): Persona[] => JSON.parse(readFileSync(file, "utf8")) as Persona[];

/** A build of the game a round's games are played on: a running dev stack, by its folder (its stack.json says where it is). */
export interface Arm { name: string; stack: string }

/** One game of a round: its arm (neutral), its persona, and the scene it plays. */
export interface GameSpec { arm: string; persona: string; scene: string; goal?: string }

export interface Round {
  name: string;
  created: string;
  /** The commit the round was made on, and whether the game's code had changes beyond it. */
  build: { commit: string; dirty: boolean };
  /** Most player turns a game may take. */
  maxTurns: number;
  /** The scenes played, with how many games each. */
  scenes: Array<{ scene: string; games: number }>;
  /** Neutral arm name → the build it plays. */
  arms: Record<string, Arm>;
  /** Neutral game name → its arm, persona and scene. */
  games: Record<string, GameSpec>;
}

/** A scene asked for, and how many games of it (none: every persona on every arm, `repeat` times). */
export interface SceneAsk { scene: string; games?: number }

export interface RoundAsked {
  scenes: SceneAsk[];
  personas: string[];
  arms: Arm[];
  repeat?: number;
  maxTurns?: number;
  /** A goal-directed round (docs/QA.txt): every tester has it. */
  goal?: string;
}

/** What a new round is checked against and stamped with: the personas, the scenes a game can play, the build and the time. */
export interface RoundContext {
  personas: Persona[];
  scenes: string[];
  build: Round["build"];
  now: string;
  shuffle?: Shuffle;
}

export type Shuffle = <T>(xs: readonly T[]) => T[];

/** "hanged-clerk:3,drowned-rat:2": each scene, and how many games of it. A scene without a number gets every persona on every arm. */
export function parseScenes(text: string): SceneAsk[] {
  return text.split(",").map(s => s.trim()).filter(Boolean).map(s => {
    const m = /^([a-z0-9][a-z0-9-]*)(?::(\d+))?$/.exec(s);
    if (!m || m[2] === "0") throw new Error(`"${s}" isn't a scene, or a scene and how many games of it (hanged-clerk:3).`);
    return { scene: m[1]!, ...(m[2] ? { games: Number(m[2]) } : {}) };
  });
}

/** "baseline=runs/loop-stack,candidate=../other/runs/loop-stack": each arm's name and stack; none given, one arm, baseline, on `stack`. */
export function parseArms(text: string | undefined, stack: string): Arm[] {
  if (!text) return [{ name: "baseline", stack }];
  return text.split(",").map(s => s.trim()).filter(Boolean).map(s => {
    const m = /^([\w.-]+)=(.+)$/.exec(s);
    if (!m) throw new Error(`"${s}" isn't an arm: name=<the stack's folder>.`);
    return { name: m[1]!, stack: m[2]! };
  });
}

/**
 * A new round: its games planned (planGames), under neutral names, in its own folder. Refused when
 * the round is there already, or it asks for a persona or a scene there isn't.
 */
export function newRound(config: LoopConfig, name: string, asked: RoundAsked, context: RoundContext): Round {
  checkNew(config, name);
  checkAsked(asked, context);

  const { arms, games } = planGames(asked, context.shuffle ?? shuffled);
  const round: Round = {
    name, created: context.now, build: context.build, maxTurns: asked.maxTurns ?? 20,
    scenes: scenesOf(asked, games), arms, games,
  };

  for (const folder of ["games", "notes", "reviews", "play"]) mkdirSync(join(roundDir(config, name), folder), { recursive: true });
  writeFileSync(join(roundDir(config, name), "round.json"), `${JSON.stringify(round, null, 1)}\n`);
  return round;
}

/**
 * The games: the arms under shuffled neutral names (k1, k2…); then, scene by scene, its games, the
 * arms taking turns and each persona played on every arm before the next (so the arms are compared
 * on the same players), the personas dealt from a shuffled deck that carries on across the scenes;
 * then every game under a shuffled neutral name (g01, g02…).
 */
export function planGames(asked: RoundAsked, shuffle: Shuffle): Pick<Round, "arms" | "games"> {
  const arms = Object.fromEntries(shuffle(asked.arms).map((arm, i) => [`k${i + 1}`, arm]));
  const keys = Object.keys(arms);
  const deck = shuffle(asked.personas);

  let dealt = 0;
  const plays: GameSpec[] = [];
  for (const { scene, games } of asked.scenes) {
    const count = games ?? asked.personas.length * keys.length * (asked.repeat ?? 1);
    plays.push(...sceneGames({ scene, count, arms: keys, deck, from: dealt, goal: asked.goal }));
    dealt += Math.ceil(count / keys.length);
  }

  const games = Object.fromEntries(shuffle(plays).map((game, i) => [`g${String(i + 1).padStart(2, "0")}`, game]));
  return { arms, games };
}

/** One scene's games: the i-th on arm i mod arms, played by the deck's persona (i div arms) on from `from`, round again when the deck runs out. */
function sceneGames(at: { scene: string; count: number; arms: string[]; deck: string[]; from: number; goal: string | undefined }): GameSpec[] {
  return Array.from({ length: at.count }, (_, i) => ({
    arm: at.arms[i % at.arms.length]!, persona: at.deck[(at.from + Math.floor(i / at.arms.length)) % at.deck.length]!, scene: at.scene,
    ...(at.goal ? { goal: at.goal } : {}),
  }));
}

export function loadRound(config: LoopConfig, name: string): Round {
  const file = join(roundDir(config, name), "round.json");
  if (!existsSync(file)) throw new Error(`There's no round ${name} (looked for ${file}).`);
  return JSON.parse(readFileSync(file, "utf8")) as Round;
}

/** A round's game with its arm and persona, or why not. */
export function gameOf(round: Round, id: string, all = personas()): GameSpec & { id: string; armed: Arm; who: Persona } {
  const game = round.games[id];
  if (!game) throw new Error(`There's no game ${id} in round ${round.name} (its games: ${Object.keys(round.games).join(", ")}).`);
  const who = all.find(p => p.id === game.persona);
  if (!who) throw new Error(`Game ${id}'s persona ${game.persona} isn't in qa/loop/personas.json.`);
  return { ...game, id, armed: round.arms[game.arm]!, who };
}

// ---------------------------------------------------------------------------------------------

function checkNew(config: LoopConfig, name: string): void {
  if (!/^[\w.-]+$/.test(name) || name.startsWith(".")) throw new Error(`A round's name is letters, digits, dots, dashes and underscores: not "${name}".`);
  if (existsSync(join(roundDir(config, name), "round.json"))) throw new Error(`Round ${name} is there already (${roundDir(config, name)}).`);
}

function checkAsked(asked: RoundAsked, context: RoundContext): void {
  const known = new Set(context.personas.map(p => p.id));
  const unknown = asked.personas.filter(p => !known.has(p));
  if (unknown.length) throw new Error(`No persona ${unknown.join(", ")} in qa/loop/personas.json (there's ${[...known].join(", ")}).`);
  if (!asked.personas.length) throw new Error("A round needs a persona at least.");

  if (new Set(asked.scenes.map(s => s.scene)).size !== asked.scenes.length) throw new Error("Name each scene once: hanged-clerk:3, not hanged-clerk:2,hanged-clerk:1.");
  const scenes = asked.scenes.filter(s => !context.scenes.includes(s.scene));
  if (scenes.length) throw new Error(`The campaign has no scene to play called ${scenes.map(s => s.scene).join(", ")} (there's ${context.scenes.join(", ")}).`);
  if (!asked.scenes.length) throw new Error("A round needs a scene: --scene hanged-clerk, or --scenes hanged-clerk:3,drowned-rat:2.");

  if (!asked.arms.length) throw new Error("A round needs an arm.");
  if (new Set(asked.arms.map(a => a.name)).size !== asked.arms.length) throw new Error("Each arm needs a name of its own.");
}

/** The scenes as the round played them: each with its count of games. */
function scenesOf(asked: RoundAsked, games: Record<string, GameSpec>): Round["scenes"] {
  return asked.scenes.map(s => ({ scene: s.scene, games: Object.values(games).filter(g => g.scene === s.scene).length }));
}

/** Fisher–Yates, on Math.random: the neutral names have to be unguessable, not repeatable. */
const shuffled: Shuffle = <T>(xs: readonly T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};
