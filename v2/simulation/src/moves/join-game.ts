import type { Identity } from "spacetimedb";
import { refusal } from "../../../shared/protocol/refusals.ts";
import { Refused, type TxCtx } from "../context.ts";
import { playerRow, seatPlayer, type GameRow, type PlayerRow } from "../rows.ts";

/**
 * join_game (v0-design §3.3, v1-design §3.3): a seat in a game as a spectator, with no character,
 * watching the host's scene row for row, once it has one (there's nothing to watch while the host
 * makes their character). Joining a game you're already in seats you as the player you were (the
 * host gets their lead back).
 */
export function joinGameReducer(tx: TxCtx, sender: Identity, { game: gameId }: { game: bigint }): void {
  const game = tx.db.game.id.find(gameId);
  if (!game) throw new Refused(refusal("unknown", { what: "game" }));

  const player = playerIn(tx, sender, game) ?? addSpectator(tx, sender, begun(tx, game));

  seatPlayer(tx, sender, player.id);
  markPresent(tx, player.id);
}

/** The caller is connected now, as whoever they're seated as. */
function markPresent(tx: TxCtx, playerId: bigint): void {
  const player = playerRow(tx, playerId);
  if (!player.online) tx.db.player.id.update({ ...player, online: true });
}

/** The game, if it has set off (not_begun otherwise). */
function begun(tx: TxCtx, game: GameRow): GameRow {
  if (![...tx.db.scene.gameId.filter(game.id)].length) throw new Refused(refusal("not_begun"));
  return game;
}

function playerIn(tx: TxCtx, identity: Identity, game: GameRow): PlayerRow | undefined {
  return [...tx.db.player.identity.filter(identity)].find(p => p.gameId === game.id);
}

/** A spectator watches the host's scene: on it, in its place, with no character. */
function addSpectator(tx: TxCtx, identity: Identity, game: GameRow): PlayerRow {
  const host = playerRow(tx, game.hostId);
  return tx.db.player.insert({
    id: 0n, identity, gameId: game.id, name: "Spectator", concept: "", role: "spectator",
    characterId: undefined, placeId: host.placeId, sceneId: host.sceneId, online: true, suggestions: true, lastPlayedAt: tx.now,
  });
}
