/**
 * Blind review: what a reviewer reads (the rubric, the truth behind the screen, the scene as the
 * player saw it), and the check on what they write (every quote must be in that turn's reply).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sceneById } from "../../../scenes/index.ts";
import { sceneBrief, speakerName } from "../../runtime/brief.ts";
import type { Entry, SessionState } from "../../runtime/session.ts";
import type { Finding } from "./fixture.ts";
import { locate } from "./html.ts";
import { LOOP_DIR, RUBRIC } from "./paths.ts";

/** The rubric's check ids: its "#### `id`: ..." headings. */
export function rubricChecks(text = readFileSync(RUBRIC, "utf8")): string[] {
  return [...text.matchAll(/^#### `([a-z-]+)`/gm)].map(m => m[1]!);
}

export interface Review {
  game: string;
  summary: string;
  ratings: Record<string, number>;
  findings: Finding[];
  good: Array<{ turn: number; what: string }>;
}

export const RATINGS = ["pacing", "agency", "characters", "improvisation", "dice", "overall"] as const;

/** The scene's entries as the player read them, by turn. */
export function turnsOf(state: SessionState): Map<number, Entry[]> {
  const turns = new Map<number, Entry[]>();
  for (const e of state.transcript.filter(e => (e.scene ?? state.sceneId) === state.sceneId)) {
    turns.set(e.turn, [...(turns.get(e.turn) ?? []), e]);
  }
  return turns;
}

/** One turn as the player saw it, in plain text. */
export function turnText(state: SessionState, entries: Entry[], options: { player?: boolean } = {}): string {
  const scene = sceneById(state.sceneId);
  return entries.filter(e => options.player !== false || e.kind !== "player").map(e =>
    e.kind === "player" ? `> ${state.player.name} (the player): ${e.text}`
      : e.kind === "roll" ? `🎲 ${e.text}`
        : e.kind === "system" ? `— ${e.text} —`
          : e.kind === "dialogue" ? `${speakerName(scene, state, e.speaker)}: ${e.text}` : e.text).join("\n\n");
}

/** The truth behind the screen, as a judge or reviewer has it: the scene's truth sheet and its prep. */
export function truthOf(state: SessionState): string {
  const scene = sceneById(state.sceneId);
  const sheet = join(LOOP_DIR, "truth", `${scene.id}.md`);
  return `${existsSync(sheet) ? `${readFileSync(sheet, "utf8").trim()}\n\n` : ""}${sceneBrief(scene, state, { secrets: true })}`;
}

/** The opening's state (turn 0), for the prep as it stood before play changed anything. */
function openingState(dir: string, final: SessionState): SessionState {
  const snap = join(dir, "snapshots", `${final.sceneId}-turn-000.json`);
  return existsSync(snap) ? JSON.parse(readFileSync(snap, "utf8")) as SessionState : final;
}

/** The pack a blind reviewer reads for one game; written beside where their review goes. */
export function reviewPack(options: { round: string; game: string; sessionDir: string; out: string }): string {
  const final = JSON.parse(readFileSync(join(options.sessionDir, "state.json"), "utf8")) as SessionState;
  const scene = sceneById(final.sceneId);
  const opening = openingState(options.sessionDir, final);
  const turns = [...turnsOf(final)].sort((a, b) => a[0] - b[0]);
  const reviewPath = options.out.replace(/\.pack\.md$/, ".json");
  const brief = readFileSync(join(LOOP_DIR, "reviewer.md"), "utf8").replace(/\{\{(\w+)\}\}/g, (_, k: string) => ({ round: options.round, game: options.game } as Record<string, string>)[k] ?? "");
  const text = [
    brief,
    `---\n\n# The pack for game ${options.game}\n\nWrite your review to \`${reviewPath}\`, with \`"game": "${options.game}"\`.`,
    `---\n\n${readFileSync(RUBRIC, "utf8")}`,
    `---\n\n# The truth behind the screen (the player never saw this)\n\n${truthOf(opening)}`,
    `---\n\n# What the player was told before the scene began\n\n${scene.hook}\n\nTheir character: **${final.player.name}**: ${final.player.concept}${final.player.build ? ` (${final.player.build})` : ""}.`,
    `---\n\n# The scene, as the player saw it\n\n${turns.map(([n, entries]) => `## Turn ${n}${n === 0 ? " (the opening)" : ""}\n\n${turnText(final, entries)}`).join("\n\n")}${final.ended ? `\n\n— The scene ended (${final.ended.exitId}). —` : "\n\n— The game stopped here (out of turns, or the player stopped). —"}`,
  ].join("\n\n");
  writeFileSync(options.out, text + "\n");
  return options.out;
}

/** What's wrong with a review: unknown checks, turns out of range, quotes not in that turn's reply. */
export function checkReview(review: Review, state: SessionState, checks = rubricChecks()): string[] {
  const problems: string[] = [];
  const turns = turnsOf(state);
  if (!review || typeof review !== "object") return ["not a JSON object"];
  if (typeof review.summary !== "string" || !review.summary.trim()) problems.push("summary: missing");
  for (const r of RATINGS) {
    const v = review.ratings?.[r];
    if (typeof v !== "number" || v < 0 || v > 5) problems.push(`ratings.${r}: a number 1 to 5 (0 for dice when nothing called for them)`);
  }
  if (!Array.isArray(review.findings)) problems.push("findings: must be a list (empty for a clean game)");
  for (const [i, f] of (review.findings ?? []).entries()) {
    const at = `findings[${i}] (turn ${f.turn}, ${f.check})`;
    if (!checks.includes(f.check)) problems.push(`${at}: no check "${f.check}" in the rubric (${checks.join(", ")})`);
    if (![1, 2, 3, 4, 5].includes(f.severity)) problems.push(`${at}: severity must be 1 to 5`);
    if (!f.why?.trim()) problems.push(`${at}: why is missing`);
    const entries = turns.get(f.turn);
    if (!entries) { problems.push(`${at}: there's no turn ${f.turn} (turns 0 to ${Math.max(...turns.keys())})`); continue; }
    const reply = turnText(state, entries, { player: false });
    if (!f.quote?.trim()) problems.push(`${at}: quote is missing`);
    else if (!locate(reply, f.quote)) problems.push(`${at}: the quote "${f.quote}" isn't in turn ${f.turn}'s reply: copy it exactly`);
  }
  for (const [i, g] of (review.good ?? []).entries()) if (!turns.has(g.turn)) problems.push(`good[${i}]: there's no turn ${g.turn}`);
  return problems;
}
