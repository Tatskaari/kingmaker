// A fight that broke out on the map (town-design §3.3: the explore row's `fight`, menu.ts's
// townFight), fought on the board as the zoo's combat ring fights one (docs/combat-design.md §5): set
// out on the town's own map where everyone stood, the player's hit points and slots kept; once the
// player is out of it, the town's people are as the fight left them (down, hurt, given up, run off)
// until the story's clock moves on (the town's people are the time of day's, as the prototype's
// town.afterFight had them, src/game/town.ts:654-682 at 44c6d4a), each where they ended up.
import { exploreOf, exploreRowOf, LOG_LINES } from "../../../shared/map/rows.ts";
import type { FightSetup, Unit } from "../../../shared/fight/types.ts";
import type { TownFight } from "../../../shared/map/types.ts";
import { refusal } from "../../../shared/protocol/refusals.ts";
import { Refused, type TxCtx } from "../context.ts";
import { boardOfRow, liveFightOf, type FightRow } from "../fight/rows.ts";
import { resultOf } from "../fight/scene.ts";
import { startFight } from "../fight/start.ts";
import { gameRow, playerRow, type PlayerRow } from "../rows.ts";
import { mapPlaceOf, mapRowsOf, walkerOf, writeExplore } from "./rows.ts";

/**
 * A fight that broke out on the map, set out on the board (fight_it_out off the map): its map, the
 * player and whoever came at them where they stood, the player's sheet kept. False when the player's
 * game has no fight on the map. Its host's, as every move on the map is.
 */
export function fightOnMap(tx: TxCtx, player: PlayerRow): boolean {
  const game = gameRow(tx, player.gameId);
  const row = walkerOf(tx, game);
  if (!row?.fight) return false;
  if (game.hostId !== player.id) throw new Refused(refusal("not_controller", { name: playerRow(tx, game.hostId).name }));
  if (liveFightOf(tx, game.id)) throw new Refused(refusal("not_now", { text: "(The fight's on: see it through.)" }));
  const broke = mapRowsOf(tx, game, row).explore.fight!;
  const fight = startFight(tx, player, townSetup(broke, player.name));
  tx.log(`[map] game ${game.id}: the fight on ${broke.place ?? broke.map} set out on the board, fight ${fight.id}`);
  return true;
}

/** A fight on the map as the board sets it out: on the town's map, the player (by their name) and whoever came at them where they stood, kept. */
export function townSetup(fight: TownFight, name: string): FightSetup {
  const place = fight.place ?? "the street";
  return {
    title: `A fight in ${place}`, place, map: { key: fight.map },
    combatants: fight.combatants.map(c => ({ ...c, ...(c.side === "player" ? { name } : {}), at: { ...c.at } })),
    keep: true, town: true,
  };
}

/**
 * The town after a fight on the map, once the player is out of it: each of the town's people in it
 * as the fight left them, where they ended up, until the clock moves on; the player where they
 * ended up; the fight off the explore row, and how it went its latest words (and in its log).
 */
export function townFightOver(tx: TxCtx, player: PlayerRow, fight: FightRow): void {
  const game = gameRow(tx, player.gameId);
  const row = walkerOf(tx, game);
  if (!row) return;
  const rows = mapRowsOf(tx, game, row);
  const ex = exploreOf(rows);
  const board = boardOfRow(fight);
  const town = ((ex.overlay.town ??= {})[ex.map] ??= { things: {} });
  if (!town.people || town.people.time !== ex.story.time) town.people = { time: ex.story.time, states: {} };
  const people = town.people;
  for (const u of Object.values(board.units)) {
    if (u.id === board.pc || !u.castId) continue;
    people.states[u.castId] = townStates(u);
    people.at = { ...(people.at ?? {}), [u.castId]: { ...u.at } };
  }
  const place = mapPlaceOf(tx, game, ex.map);
  tx.db.place.id.update({ ...place, town: JSON.stringify(town), rev: place.rev + 1 });
  const result = resultOf(fight.result);
  const said = `${fight.title}: ${result?.told ?? result?.summary ?? "it's over."}`;
  const me = board.units[board.pc];
  const { fight: _over, ...written } = exploreRowOf(ex, rows.explore, said);
  writeExplore(tx, { ...written, ...(me ? { at: { ...me.at } } : {}), log: [...rows.explore.log, said].slice(-LOG_LINES) });
  tx.log(`[map] game ${game.id}: the fight on ${ex.map} over (${fight.outcome ?? "?"}), the town as it left them`);
}

/** Someone of the town's after the fight, in the town's words: run off (gone), down, dead, given up, hurt. */
function townStates(u: Unit): string[] {
  if (u.state === "fled") return ["gone"];
  if (u.state === "dead") return ["dead"];
  if (u.state === "down" || u.hp <= 0) return ["down"];
  return [...(u.state === "surrendered" ? ["cowering"] : []), ...(u.hp < u.maxHp ? [u.hp * 2 <= u.maxHp ? "badly hurt" : "hurt"] : [])];
}
