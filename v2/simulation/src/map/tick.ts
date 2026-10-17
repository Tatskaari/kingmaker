import { ScheduleAt, Timestamp } from "spacetimedb";
import { exploreOf, LOG_LINES } from "../../../shared/map/rows.ts";
import { keepTown, townWorld } from "../../../shared/map/town-world.ts";
import { tick } from "../../../shared/world/scene-world.ts";
import type { TxCtx } from "../context.ts";
import type { PlaceRow } from "../rows.ts";
import { exploreRowFrom, mapRowsOf, walkerOf, writeExplore } from "./rows.ts";

/**
 * tick_place (v2/docs/town-design.md §3.5): the world's clock on a map's own place while its game's
 * host is there, out of a scene, run by its place_tick row every 6 s (the scenes' own `tick`, so the
 * town and the scenes share one coding of fire). A tick runs the rounds due since place.tickedAt, one
 * each 6 s and ten at most, on the town's world (shared/map/town-world.ts) when anything in
 * place.town burns, and keeps what they did there (keepTown). The row goes in as a seat comes onto
 * the map (keepTicking: a new game, walking out of a scene, travel, a talk's end), and the tick that
 * finds nobody there takes it out. A scene's place burns by its turns (rules/play.ts rulesFirst).
 */

/** A round of the world's clock: 6 s, as a fight's (the schedule's interval). */
export const ROUND_MICROS = 6_000_000n;
/** The most rounds a tick catches up on. */
const MOST_ROUNDS = 10;

/** The map's own place ticks while its host is there: its place_tick row, unless it has one. */
export function keepTicking(tx: TxCtx, placeId: bigint): void {
  if ([...tx.db.placeTick.iter()].some(r => r.placeId === placeId)) return;
  tx.db.placeTick.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(ROUND_MICROS), placeId });
}

/** Does anything in a place's town burn (place.town, JSON TownChanges)? */
export const burns = (town: string) => town.includes('"burning"');

export function tickPlace(tx: TxCtx, row: { scheduledId: bigint; placeId: bigint }): void {
  const place = tx.db.place.id.find(row.placeId);
  const game = place ? tx.db.game.id.find(place.gameId) : undefined;
  const host = game ? tx.db.player.id.find(game.hostId) : undefined;
  const walker = game ? walkerOf(tx, game) : undefined;
  // Nobody here: the host is in a scene (a talk is one), on another map, or the story is over.
  if (!place || !game || !host || !walker || place.mapKey === undefined || game.status === "ended" || host.placeId !== place.id || host.sceneId !== undefined || walker.map !== place.mapKey) {
    tx.db.placeTick.scheduledId.delete(row.scheduledId);
    if (place) tx.log(`[tick_place] place ${place.id}: nobody there, the clock stops`);
    return;
  }
  if (!burns(place.town)) return;

  const now = tx.now.microsSinceUnixEpoch;
  const since = place.tickedAt?.microsSinceUnixEpoch;
  const due = since === undefined ? 1 : Number((now - since) / ROUND_MICROS);
  const rounds = Math.min(MOST_ROUNDS, due);
  if (rounds <= 0) return;
  burnOn(tx, place, rounds, since === undefined || due > MOST_ROUNDS ? now : since + BigInt(rounds) * ROUND_MICROS);
}

/**
 * The rounds burned on the town's world, from the rows (the ExploreState its walker's, the town's
 * changes in it), each with the game's dice; what they did kept in place.town, and the place's round
 * and clock moved on. What happened, in a few words, goes in the walker's log ("Recently").
 */
function burnOn(tx: TxCtx, place: PlaceRow, rounds: number, tickedAt: bigint): void {
  const started = tx.elapsedMs();
  const game = tx.db.game.id.find(place.gameId)!;
  const walker = walkerOf(tx, game)!;
  const ex = exploreOf(mapRowsOf(tx, game, walker));
  const tw = townWorld(ex);
  const dice = tx.db.dice.gameId.find(game.id);
  const seed = dice?.seed ?? 0;
  const lines: string[] = [];
  for (let i = 1; i <= rounds; i++) {
    const n = place.round + i;
    lines.push(...tick(tw.world, n, seed + 31337 * n));
  }
  keepTown(ex, tw);
  const town = ex.overlay.town?.[place.mapKey!];
  tx.db.place.id.update({ ...place, town: town ? JSON.stringify(town) : "", round: place.round + rounds, tickedAt: new Timestamp(tickedAt), rev: place.rev + 1 });
  if (lines.length) {
    const row = exploreRowFrom(walker);
    writeExplore(tx, { ...row, log: [...row.log, lines.join(". ")].slice(-LOG_LINES) });
  }
  tx.log(`[tick_place] place ${place.id}: ${rounds} round${rounds === 1 ? "" : "s"} ${Math.round(tx.elapsedMs() - started)} ms${lines.length ? `: ${lines.join("; ")}` : ""}`);
}
