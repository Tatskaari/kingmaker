import type { Identity } from "spacetimedb";
import { refusal } from "../../../shared/protocol/refusals.ts";
import { actorOf, Refused, runMove, type TxCtx } from "../context.ts";
import { creationOf } from "../creation/rows.ts";
import { startOnMap } from "../map/start.ts";
import { openScene } from "../moves/open-scene.ts";
import { playerRow, seatPlayer, type GameRow, type PlayerRow } from "../rows.ts";
import { campaignFile, campaignOfGame } from "../scenes.ts";
import { startOf } from "./create.ts";
import { deleteGameRows } from "./delete.ts";

/**
 * The games' moves (v1-design §3.3): setting off in the game a creation made (the prototype's begin,
 * game.ts:949: onto the map, or straight into the first scene for a campaign without one), carrying
 * on with one of the caller's games, and deleting one with every row of it.
 */

/**
 * Set off: onto the campaign's start map, the first scene the lead, waiting (map-design §3.3); or,
 * with no map, the first scene opens, with what the character starts with and coming to as the
 * prototype's opening does. The creation that made the game is done with.
 */
export function beginReducer(tx: TxCtx, sender: Identity, _args: Record<string, never>): void {
  const started = tx.elapsedMs();
  const { game, player } = notYetBegun(tx, sender);
  const campaign = campaignOfGame(tx, game);

  if (!startOnMap(tx, game, campaign)) runMove(tx, openScene, actorOf(tx, sender), { game: game.id, sceneKey: campaignFile(campaign).firstScene, start: startOf(tx, campaign, player.id) });

  doneCreating(tx, sender, game);
  played(tx, player.id);
  tx.log(`[rules] begin ${Math.round(tx.elapsedMs() - started)} ms`);
}

/** Continue: the caller's seat moves to their character in that game (the title's Continue). */
export function continueGameReducer(tx: TxCtx, sender: Identity, { game: gameId }: { game: bigint }): void {
  const game = gameNamed(tx, gameId);
  const player = [...tx.db.player.identity.filter(sender)].find(p => p.gameId === game.id && p.role === "host");
  if (!player) throw new Refused(refusal("not_yours"));

  seatPlayer(tx, sender, player.id);
  played(tx, player.id);
}

/** Delete: every row of one of the caller's games (the title's x, twice), and the seats on it with them. */
export function deleteGameReducer(tx: TxCtx, sender: Identity, { game: gameId }: { game: bigint }): void {
  const game = gameNamed(tx, gameId);
  const host = tx.db.player.id.find(game.hostId);
  if (!host || !host.identity.isEqual(sender)) throw new Refused(refusal("not_yours"));

  deleteGameRows(tx, game);
}

// ---------------------------------------------------------------------------------------------

/** The game the caller is seated in as its host, which hasn't set off yet. */
function notYetBegun(tx: TxCtx, sender: Identity): { game: GameRow; player: PlayerRow } {
  const actor = actorOf(tx, sender);
  const player = actor.id === undefined ? undefined : tx.db.player.id.find(actor.id);
  const game = player && player.role === "host" ? tx.db.game.id.find(player.gameId) : undefined;
  if (!player || !game) throw new Refused(refusal("not_in_game"));
  if ([...tx.db.scene.gameId.filter(game.id)].length) throw new Refused(refusal("already_begun"));
  return { game, player };
}

function gameNamed(tx: TxCtx, gameId: bigint): GameRow {
  const game = tx.db.game.id.find(gameId);
  if (!game) throw new Refused(refusal("unknown", { what: "game" }));
  return game;
}

/** The creation that made this game, if it's still the caller's: set off in, it's done with. */
function doneCreating(tx: TxCtx, sender: Identity, game: GameRow): void {
  const creation = creationOf(tx, sender);
  if (creation?.gameId === game.id) tx.db.creation.identity.delete(sender);
}

/** When they last played it, for the title's "(5 min ago)"; online, as whoever plays it now is. */
function played(tx: TxCtx, playerId: bigint): void {
  tx.db.player.id.update({ ...playerRow(tx, playerId), online: true, lastPlayedAt: tx.now });
}
