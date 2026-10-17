import { ScheduleAt, type Identity } from "spacetimedb";
import type { TxCtx } from "./context.ts";

/** The reaper's period (v0-design §3.5): reap_jobs every 2 s. */
const REAP_EVERY_MICROS = 2_000_000n;

/**
 * init: the publisher is the database's owner, and the reaper starts. It runs when the database is
 * made, and again after a publish deletes its data.
 */
export function initDatabase(tx: TxCtx, publisher: Identity): void {
  if (!tx.db.admin.identity.find(publisher)) tx.db.admin.insert({ identity: publisher, role: "owner" });
  if (tx.db.reaper.count() === 0n) tx.db.reaper.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(REAP_EVERY_MICROS) });
}

/**
 * onConnect and onDisconnect: a seated player is online while they're connected. Every HTTP call
 * connects and disconnects too, so an identity with no seat (the AI service's, the owner's) writes
 * nothing.
 */
export function markOnline(tx: TxCtx, sender: Identity, online: boolean): void {
  const seat = tx.db.seat.identity.find(sender);
  const player = seat ? tx.db.player.id.find(seat.playerId) : undefined;
  if (player && player.online !== online) tx.db.player.id.update({ ...player, online });
}
