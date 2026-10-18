// After the GM loop's src/eval/loop/triage.ts at 5f01806 (origin/claude/gm-loop, draft PR #663): triage.json, what counts after it and the worksheet, a round's half (an eval run's waits for the evals to be ported).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { recordPath, reviewPath, roundDir, shortPath, type LoopConfig } from "./paths.ts";
import { readRecord, turnsOf, turnText } from "./record.ts";
import type { Finding, Review } from "./review.ts";
import { loadRound } from "./round.ts";

/**
 * Triage: a careful read of each finding before it's believed. A blind reviewer is fallible, so
 * every finding gets a verdict in the round's triage.json, keyed "<game>/<n>" (n from 1, in the
 * review's order): kept (it's real, with why in plain words, perhaps at another severity) or
 * discarded (it isn't, and why). The report shows the triage's why first and counts only what was kept.
 */

/** What a finding costs, by its severity (the rubric's scale: 1, 2, 4, 8, 16). */
export const PENALTY: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };

export interface Verdict { verdict: "keep" | "discard"; why: string; severity?: number }
export type Triage = Record<string, Verdict>;

/** A review's finding, numbered, with its verdict, and its severity as triaged. */
export interface Triaged extends Finding { n: number; v?: Verdict }

export function loadTriage(config: LoopConfig, round: string): Triage {
  const file = join(roundDir(config, round), "triage.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as Triage : {};
}

/** A game's findings with their verdicts: numbered from 1, the severity the triage gave where it gave one. */
export function triaged(game: string, findings: Finding[], triage: Triage): Triaged[] {
  return findings.map((f, i) => {
    const v = triage[`${game}/${i + 1}`];
    return { ...f, n: i + 1, ...(v ? { v, severity: v.severity ?? f.severity } : {}) };
  });
}

/** What counts: every finding the triage didn't discard (one not triaged yet counts, as the reviewer filed it). */
export const keptOf = (findings: Triaged[]) => findings.filter(f => f.v?.verdict !== "discard");

/** Verdicts that name no finding (a game or a number the reviews haven't got): a typo in triage.json. */
export function strays(triage: Triage, findings: Record<string, number>): string[] {
  return Object.keys(triage).filter(key => {
    const m = /^(g\d+)\/(\d+)$/.exec(key);
    return !m || Number(m[2]) < 1 || Number(m[2]) > (findings[m[1]!] ?? 0);
  });
}

/**
 * The worksheet: every finding with its key, the turn it's on as the player saw it, the quote, the
 * reviewer's why and better, and the verdict it has. Writing triage.json from it is a careful read,
 * not a formality: check each against the reply, the rubric's check and the truth behind the screen.
 */
export function triageSheet(config: LoopConfig, round: string): string {
  const name = loadRound(config, round).name;
  const triage = loadTriage(config, round);
  const out = [`# Triage for round ${name}\n\nWrite ${shortPath(join(roundDir(config, round), "triage.json"))}: { "<game>/<n>": { "verdict": "keep" | "discard", "why": "...", "severity"?: n } }.`];
  for (const game of Object.keys(loadRound(config, round).games)) out.push(...gameSheet(config, round, game, triage));
  if (out.length === 1) out.push("No reviews yet.");
  return out.join("\n\n");
}

function gameSheet(config: LoopConfig, round: string, game: string, triage: Triage): string[] {
  const file = reviewPath(config, round, game);
  const record = readRecord(recordPath(config, round, game));
  if (!existsSync(file) || !record) return [];
  const review = JSON.parse(readFileSync(file, "utf8")) as Review;
  const turns = new Map(turnsOf(record.entries));
  return triaged(game, review.findings ?? [], triage).map(f => {
    const key = `${game}/${f.n}`;
    const turn = turnText(turns.get(f.turn) ?? []).split("\n").map(l => `> ${l}`).join("\n");
    return `## ${key}${f.v ? ` [${f.v.verdict}${f.v.severity ? `, severity ${f.v.severity}` : ""}]` : ""}: ${f.check} ${f.severity}, turn ${f.turn}\n\n${turn}\n\nQuote: "${f.quote}"\nWhy: ${f.why}${f.better ? `\nBetter: ${f.better}` : ""}`;
  });
}
