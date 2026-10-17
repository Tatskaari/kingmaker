// fightOnMap is the prototype's town.afterFight (src/game/town.ts:654-682 at 44c6d4a) after the fight's stand-in (src/game/fight-standin.ts: one action, told as won), for a fight that broke out on the map: whoever came at the player goes down where they stood, until the story's clock moves on (the town's people are the time of day's). Its line is new, in the stand-in's manner (the Heron's names the Crakes).
import { exploreOf, exploreRowOf } from "../../../shared/map/rows.ts";
import type { TownFight } from "../../../shared/map/types.ts";
import { refusal } from "../../../shared/protocol/refusals.ts";
import { Refused, type TxCtx } from "../context.ts";
import { gameRow, playerRow, type PlayerRow } from "../rows.ts";
import { mapPlaceOf, mapRowsOf, walkerOf, writeExplore } from "./rows.ts";

/**
 * A fight that broke out on the map (town-design §3.3: the explore row's `fight`, recorded for V12,
 * which plays it), fought by the stand-in: told as won in a line, whoever came at the player down
 * where they stood (the town's people's states, until the clock moves on), the fight off the row.
 * False when the player's game has no fight on the map. Its host's, as every move on the map is.
 */
export function fightOnMap(tx: TxCtx, player: PlayerRow): boolean {
  const game = gameRow(tx, player.gameId);
  const row = walkerOf(tx, game);
  if (!row?.fight) return false;
  if (game.hostId !== player.id) throw new Refused(refusal("not_controller", { name: playerRow(tx, game.hostId).name }));

  const rows = mapRowsOf(tx, game, row);
  const ex = exploreOf(rows);
  const fight = rows.explore.fight!;
  const town = ((ex.overlay.town ??= {})[ex.map] ??= { things: {} });
  if (!town.people || town.people.time !== ex.story.time) town.people = { time: ex.story.time, states: {} };
  const fell = fight.combatants.filter(c => c.side === "enemy" && c.castId);
  for (const c of fell) town.people.states[c.castId!] = ["down"];

  const place = mapPlaceOf(tx, game, ex.map);
  tx.db.place.id.update({ ...place, town: JSON.stringify(town), rev: place.rev + 1 });
  const said = [standinLine(fight), fell.length ? `${capital(theyAll(fight))} ${fell.length === 1 ? "lies" : "lie"} where they fell. Caerwyn steps round.` : ""].filter(Boolean).join("\n");
  const { fight: _over, ...written } = exploreRowOf(ex, rows.explore, said);
  writeExplore(tx, written);
  tx.log(`[map] game ${game.id}: the fight on ${fight.place ?? ex.map} fought by the stand-in: ${fell.map(c => c.name).join(", ") || "nobody"} down`);
  return true;
}

/** What the stand-in's one action says of a fight on the map: told as won, in a line. */
function standinLine(fight: TownFight): string {
  const who = theyAll(fight);
  return `Fists, steel and a lot of shouting: after a short, ugly scuffle${fight.place ? ` in ${fight.place}` : ""}, ${who} ${fight.combatants.filter(c => c.side === "enemy").length === 1 ? "is" : "are"} down, and nobody else about wants to be next.`;
}

/** Whoever came at the player, in a few words: "the palace guard", "both palace guards", "the porter and the sweeper". */
function theyAll(fight: TownFight): string {
  const enemies = fight.combatants.filter(c => c.side === "enemy");
  const bases = [...new Set(enemies.map(c => c.name.replace(/^the (first|second|third|fourth|fifth|sixth|\d+th) /, "").replace(/^(a|an|the)\s+/i, "")))];
  if (enemies.length > 1 && bases.length === 1) return `${enemies.length === 2 ? "both" : `all ${enemies.length}`} ${bases[0]}s`;
  const names = enemies.map(c => c.name);
  return names.length <= 1 ? (names[0] ?? "nobody") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
