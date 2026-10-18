// New (M5: problem reports): report_game's body, every row of one of the caller's games and the AI service's own of it, as the module's procedure and the memory host both make it.
import type { Identity } from "spacetimedb";
import { gamePath } from "../../../shared/protocol/ai.ts";
import { refusal, type Refusal } from "../../../shared/protocol/refusals.ts";
import { rowsJson } from "../../../shared/report/rows.ts";
import type { TxCtx } from "../context.ts";
import type { GameRow } from "../rows.ts";
import { gameRows, type Row } from "./tables.ts";

/**
 * A report of a problem's game (V16, M5: docs/migration-log.md), for the game's owner alone (its
 * host: another player's game, or one they only watch, is refused): every row of it in every table
 * (tables.ts), read in one transaction, and then, with nothing locked, what the AI service keeps of
 * it, its calls and memory reviews and its docs (GET /v1/games/{game}/calls and /docs, by its uid).
 * The answer is JSON (shared/report/format.ts GameReport), its u64s and the SDK's classes as
 * shared/report/rows.ts writes them; a refusal is { refusal }. The module's report_game procedure
 * (index.ts) and the memory host's report() make the same calls, each with its own way to GET.
 */

/** The game's rows, read for its report. */
export interface Asked { game: GameRow; rows: Partial<Record<string, Row[]>> }

/** What the AI service answered a GET, as a host had it: the status and body, or why there was none. */
export type AiGot = { status: number; body: string } | { error: string };

/** report_game's transaction: the game's every row, when the caller owns it; else the refusal, in the game's words. */
export function reportRows(tx: TxCtx, sender: Identity, gameId: bigint): Asked | { refusal: Refusal } {
  const game = tx.db.game.id.find(gameId);
  if (!game) return { refusal: refusal("unknown", { what: "game" }) };
  const host = tx.db.player.id.find(game.hostId);
  if (!host || !host.identity.isEqual(sender)) return { refusal: refusal("not_yours") };
  return { game, rows: gameRows(tx, game) };
}

/** The AI service's paths for a game's own: its calls and memory reviews, and its docs. */
export const aiAsks = (uid: string) => ({ calls: gamePath(uid, "calls"), docs: gamePath(uid, "docs") });

/**
 * The game's report as JSON: its rows as rows.ts writes them, and the AI service's two answers as
 * they came (spliced in whole: they're JSON already, and can be megabytes), or why they couldn't be
 * had. Never throws: a procedure's caller hears its answer, not its panic.
 */
export function gameReportJson({ game, rows }: Asked, got: { calls: AiGot; docs: AiGot }): string {
  const head = rowsJson({ kind: "kingmaker-game", id: String(game.id), uid: game.uid, campaign: `${game.campaign}@${game.campaignVersion}`, rows });
  return `${head.slice(0, -1)},"ai":${aiJson(got)}}`;
}

/** The AI service's calls and docs as one JSON object, or the first reason one of them couldn't be had. */
function aiJson({ calls, docs }: { calls: AiGot; docs: AiGot }): string {
  const why = whyNot(calls, "calls") ?? whyNot(docs, "docs");
  if (why) return JSON.stringify({ error: why });
  return `{"calls":${(calls as { body: string }).body},"docs":${(docs as { body: string }).body}}`;
}

/** Why a GET's answer won't do: none came, it wasn't a 200, or its body isn't a JSON object. */
function whyNot(got: AiGot, what: string): string | undefined {
  if ("error" in got) return `the AI service's ${what} couldn't be had: ${got.error}`;
  if (got.status !== 200) return `the AI service answered ${what} ${got.status}: ${got.body.slice(0, 300)}`;
  return /^\s*\{[\s\S]*\}\s*$/.test(got.body) ? undefined : `the AI service's ${what} weren't JSON`;
}
