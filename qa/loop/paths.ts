import { join, relative } from "node:path";

/**
 * Where the GM loop's things are: its material, checked in beside its code (qa/loop: the rubric, the
 * briefs, the personas, the truth sheets), and a round's files under the loop's folder (runs/loop, or
 * KM_LOOP_DIR: the host reads it and hands it in).
 *
 *   <rounds>/<round>/
 *     round.json              the scenes, the arms (k1 → a stack), the games (g01 → arm, persona, scene)
 *     play/<game>.json        each game's session: the identity its player plays as
 *     games/<game>.json       what the game's player saw, turn by turn, and how it went (start and say write it)
 *     notes/<game>.md         the tester's own notes, as a player
 *     reviews/<game>.pack.md  what a blind reviewer reads (review-pack)
 *     reviews/<game>.json     the review (checked by review-check)
 *     triage.json             each finding kept or discarded, and why
 *     report/                 index.html and games/<game>.html
 */

export const LOOP_DIR = import.meta.dirname;
export const REPO = join(LOOP_DIR, "..", "..");
export const RUBRIC = join(LOOP_DIR, "rubric.md");
export const PERSONAS = join(LOOP_DIR, "personas.json");
export const BRIEFS = join(LOOP_DIR, "brief");
export const TRUTH = join(LOOP_DIR, "truth");
/** The campaign folders the stacks install (campaigns/caerwyn). */
export const CAMPAIGNS = join(REPO, "campaigns");

/** The loop's folder and how a brief tells an agent to run the loop: the host's to say. */
export interface LoopConfig {
  /** runs/loop, or KM_LOOP_DIR. */
  rounds: string;
  /** `npm run -s loop --`, with KM_LOOP_DIR in front when it's set: what a brief tells an agent to type. */
  command: string;
}

export const roundDir = (config: LoopConfig, round: string) => join(config.rounds, round);
export const recordPath = (config: LoopConfig, round: string, game: string) => join(roundDir(config, round), "games", `${game}.json`);
export const notesPath = (config: LoopConfig, round: string, game: string) => join(roundDir(config, round), "notes", `${game}.md`);
export const reviewPath = (config: LoopConfig, round: string, game: string) => join(roundDir(config, round), "reviews", `${game}.json`);
export const packPath = (config: LoopConfig, round: string, game: string) => join(roundDir(config, round), "reviews", `${game}.pack.md`);

/** A path from the repo's root, as an agent working there types it (absolute when it's outside). */
export function shortPath(path: string): string {
  const from = relative(REPO, path);
  return from.startsWith("..") ? path : from;
}
