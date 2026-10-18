// After the GM loop's src/eval/loop/review.ts at 5f01806 (origin/claude/gm-loop, draft PR #663): what a blind reviewer reads (the brief, the rubric, the truth behind the screen, the scene as the player saw it) and the check on what they write (every quote in its turn's reply), with html.ts's locate. On the game, the prep is the runtime scene the AI service loaded (prep.ts), and a later scene's pack says what the story handed on to it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prepText } from "./prep.ts";
import { BRIEFS, packPath, recordPath, reviewPath, RUBRIC, shortPath, TRUTH, type LoopConfig } from "./paths.ts";
import { readRecord, turnsOf, turnText, type GameRecord } from "./record.ts";
import { sceneOf, type Loaded } from "./scenes.ts";

/** A blind reviewer's findings on one game (reviews/<game>.json). */
export interface Review {
  game: string;
  summary: string;
  ratings: Record<string, number>;
  findings: Finding[];
  good: Array<{ turn: number; what: string }>;
}

/** One problem, on the turn where it went wrong, under one of the rubric's checks. */
export interface Finding { turn: number; check: string; severity: number; quote: string; why: string; better?: string }

export const RATINGS = ["pacing", "agency", "characters", "improvisation", "dice", "overall"] as const;

/** The rubric's check ids: its "#### `id`: ..." headings. */
export function rubricChecks(text = readFileSync(RUBRIC, "utf8")): string[] {
  return [...text.matchAll(/^#### `([a-z-]+)`/gm)].map(m => m[1]!);
}

// ---------------------------------------------------------------------------------------------
// The pack

/**
 * A game's pack, written beside where its review goes (reviews/<game>.pack.md); its path. The scene's
 * prep is the scene its stack's campaign has, loaded as the GM's was (`campaign`).
 */
export async function reviewPack(config: LoopConfig, round: string, game: string, campaign: (record: GameRecord) => Promise<Loaded>): Promise<string> {
  const record = readRecord(recordPath(config, round, game));
  if (!record?.sceneRow) throw new Error(`Game ${game} hasn't been played: there's no record of its scene.`);

  const scene = sceneOf(await campaign(record), record.scene);
  const out = packPath(config, round, game);
  writeFileSync(out, `${packText({ config, round, record, prep: prepText(scene), hook: scene.hook })}\n`);
  return out;
}

/** The pack itself: the brief, where the review goes, the rubric, the truth behind the screen, what the player was told, the scene turn by turn. */
export function packText(at: { config: LoopConfig; round: string; record: GameRecord; prep: string; hook?: string | undefined }): string {
  const { config, round, record } = at;
  const brief = readFileSync(join(BRIEFS, "reviewer.md"), "utf8").replace(/\{\{(\w+)\}\}/g, (_, k: string) => ({ round, game: record.game, loop: config.command } as Record<string, string>)[k] ?? "");
  return [
    brief,
    `---\n\n# The pack for game ${record.game}\n\nWrite your review to \`${shortPath(reviewPath(config, round, record.game))}\`, with \`"game": "${record.game}"\`.`,
    `---\n\n${readFileSync(RUBRIC, "utf8").trim()}`,
    `---\n\n# The truth behind the screen (the player never saw this)\n\n${truthOf(record, at.prep)}`,
    `---\n\n# What the player was told before the scene began\n\n${toldOf(record, at.hook)}`,
    `---\n\n# The scene, as the player saw it\n\n${sceneText(record)}`,
  ].join("\n\n");
}

/** The scene's truth sheet when it has one (qa/loop/truth/<scene>.md), its prep, and what the story handed on to it. */
function truthOf(record: GameRecord, prep: string): string {
  const sheet = join(TRUTH, `${record.scene}.md`);
  return [existsSync(sheet) ? readFileSync(sheet, "utf8").trim() : undefined, prep, handedOnText(record)].filter(Boolean).join("\n\n");
}

/** For a later scene: the scenes ended for the test on the way, and the boundary's work on this one, as the GM had it. */
function handedOnText(record: GameRecord): string | undefined {
  const h = record.handedOn;
  if (!record.skipped.length && !h) return undefined;
  return [
    "# What the story handed on to this scene",
    record.skipped.length ? `The scenes before this one were ended for the test, not played (each with its discoveries made first, as a thorough player's game would have them, and the story moved on from each as it would have): ${record.skipped.map(s => `${s.scene} on "${s.title ?? s.exit}"`).join("; ")}. The player's notebook (below) has how things stood after each.` : undefined,
    h?.lead ? `**How the story led the player here:** ${h.lead}` : undefined,
    h?.opening ? `**The opening, as the boundary rewrote it for where the story is:** ${h.opening}` : undefined,
    h?.adjustments.length ? `**Where the prep no longer matched the story (the GM was told):**\n${h.adjustments.map(a => `- ${a}`).join("\n")}` : undefined,
    h?.owed.length ? `**What the story still owed the player from scenes before:** ${h.owed.join("; ")}` : undefined,
    h?.absent.length ? `**Away from the scene:** ${h.absent.join(", ")}` : undefined,
  ].filter(Boolean).join("\n\n");
}

function toldOf(record: GameRecord, hook: string | undefined): string {
  const p = record.player;
  return [
    record.hook ?? hook,
    p ? `Their character: **${p.name}**: ${p.concept}${p.build ? ` (${p.build})` : ""}.` : undefined,
    record.notebook ? `Their notebook of the story so far:\n\n${record.notebook.join("\n\n")}` : undefined,
  ].filter(Boolean).join("\n\n");
}

function sceneText(record: GameRecord): string {
  const turns = turnsOf(record.entries).map(([n, entries]) => `## Turn ${n}${n === 0 ? " (the opening)" : ""}\n\n${turnText(entries)}`);
  const end = record.ended ? `— The scene ended (${record.ended.title}). —` : "— The game stopped here (out of turns, or the player stopped). —";
  return `${turns.join("\n\n")}\n\n${end}`;
}

// ---------------------------------------------------------------------------------------------
// The check

/** A review file read and checked against its game: its problems (none: it's fit to count). */
export function checkReviewFile(config: LoopConfig, round: string, game: string, checks = rubricChecks()): string[] {
  const file = reviewPath(config, round, game);
  if (!existsSync(file)) return [`no review at ${shortPath(file)}`];
  const record = readRecord(recordPath(config, round, game));
  if (!record) return [`game ${game} has no record`];
  try {
    return checkReview(JSON.parse(readFileSync(file, "utf8")) as Review, record, checks);
  } catch (error) {
    return [`not valid JSON: ${error instanceof Error ? error.message : String(error)}`];
  }
}

/** What's wrong with a review: a missing part, a rating out of range, an unknown check, a turn out of range, a quote not in its turn's reply. */
export function checkReview(review: Review, record: Pick<GameRecord, "entries">, checks = rubricChecks()): string[] {
  if (!review || typeof review !== "object") return ["not a JSON object"];
  const turns = new Map(turnsOf(record.entries));
  return [
    ...(typeof review.summary !== "string" || !review.summary.trim() ? ["summary: missing"] : []),
    ...RATINGS.filter(r => { const v = review.ratings?.[r]; return typeof v !== "number" || v < 0 || v > 5; })
      .map(r => `ratings.${r}: a number 1 to 5 (0 for dice when nothing called for them)`),
    ...(Array.isArray(review.findings) ? review.findings.flatMap((f, i) => findingProblems(f, i, turns, checks)) : ["findings: must be a list (empty for a clean game)"]),
    ...(review.good ?? []).flatMap((g, i) => (turns.has(g.turn) ? [] : [`good[${i}]: there's no turn ${g.turn}`])),
  ];
}

function findingProblems(f: Finding, i: number, turns: Map<number, GameRecord["entries"]>, checks: string[]): string[] {
  const at = `findings[${i}] (turn ${f.turn}, ${f.check})`;
  const problems = [
    ...(checks.includes(f.check) ? [] : [`${at}: no check "${f.check}" in the rubric (${checks.join(", ")})`]),
    ...([1, 2, 3, 4, 5].includes(f.severity) ? [] : [`${at}: severity must be 1 to 5`]),
    ...(f.why?.trim() ? [] : [`${at}: why is missing`]),
  ];
  const entries = turns.get(f.turn);
  if (!entries) return [...problems, `${at}: there's no turn ${f.turn} (turns 0 to ${Math.max(...turns.keys())})`];
  if (!f.quote?.trim()) return [...problems, `${at}: quote is missing`];
  return quoted(entries, f.quote) ? problems : [...problems, `${at}: the quote "${f.quote}" isn't in turn ${f.turn}'s reply: copy it exactly`];
}

/** Is the quote in the turn's reply: as the pack shows it (with each speaker's "Name: "), or in any one of its entries' own words. */
export function quoted(entries: GameRecord["entries"], quote: string): boolean {
  const reply = entries.filter(e => e.kind !== "player");
  return !!locate(turnText(reply), quote) || reply.some(e => !!locate(e.text, quote));
}

/** Where a quote sits in a text: exactly, or with curly quotes, dashes, spacing and case taken as plain. */
export function locate(text: string, quote: string): [number, number] | undefined {
  if (!quote.trim()) return undefined;
  const plain = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, "\"").replace(/[—–]/g, "-").replace(/\s/g, " ").toLowerCase();
  const at = plain(text).indexOf(plain(quote.trim()));
  return at === -1 ? undefined : [at, at + quote.trim().length];
}
