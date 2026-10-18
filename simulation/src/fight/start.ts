// New (M6, docs/combat-design.md §1): a fight started from a setup, the one way in (the prototype's startCombat and initialState, src/game/combat/controller.ts and setup.ts at bc2ab1f, as rows): the zoo's rings call it now, and the story's fights will.
import { rng } from "../../../shared/dice.ts";
import { flavour, hash } from "../../../shared/fight/flavour.ts";
import type { FightSetup } from "../../../shared/fight/types.ts";
import type { TileMap } from "../../../shared/map/types.ts";
import { refusal } from "../../../shared/protocol/refusals.ts";
import { keep, loaded } from "../../../shared/rules/engine.ts";
import { Refused, type TxCtx } from "../context.ts";
import { gameRow, type PlayerRow } from "../rows.ts";
import { engineCall } from "../rules/session.ts";
import { campaignOfGame, looksOf } from "../scenes.ts";
import { clearFights, fightMap, nextRoll, save, type FightRow } from "./rows.ts";
import { Table } from "./rules.ts";
import { boardOf, initiativeLine, type Looks } from "./setup.ts";
import { Skirmish } from "./skirmish.ts";

/**
 * A fight, started (docs/combat-design.md §1): `player`'s, from `setup` (who's in it with their
 * statblocks and sides, the map, where everyone stands, its hazards). The game's last fight goes;
 * the player's character is copied as their campaign has them (rested first when the setup says
 * fresh); everyone else is made from their statblock; the engine rolls initiative; the start is the
 * fight's first moment and the first turn's start its second. Then either the player's options, on
 * their turn, or the first of the other side's turns scheduled. The caller says who may start one
 * (start_ring: the game's host, out of a scene, with no fight on).
 */
export function startFight(tx: TxCtx, player: PlayerRow, setup: FightSetup): FightRow {
  const game = gameRow(tx, player.gameId);
  const state = tx.db.rulesState.playerId.find(player.id);
  if (!state) throw new Refused(refusal("not_now", { text: "(A fight needs a character the rules engine made: make one first.)" }));
  clearFights(tx, game.id);

  const where = setup.map;
  const located = "key" in where ? { mapKey: where.key, map: undefined } : { mapKey: undefined, map: JSON.stringify(where.file) };
  const map = fightMap(tx, { gameId: game.id, ...located });
  const looks = looksOf(campaignOfGame(tx, game)) as Looks;
  const dice = nextRoll(tx, game.id);

  const out = engineCall(tx, game.id, r => {
    const engine = r.engine(dice.engineSeed);
    const table = new Table({ E: r.E, engine, plan: engine.plan as unknown as Table["kit"]["plan"] }, loaded(r, state.campaign), rng(dice.otherSeed));
    const { board, rolled } = boardOf(table, setup, map, { engineId: state.pc, gone: state.gone }, looks);
    const s = new Skirmish({ ...board, map }, table);
    begin(s, setup, map, rolled);
    const moments = s.done();
    const campaign = r.E.serializeCampaign(table.campaign);
    keep(r, campaign, table.campaign);
    return { s, moments, campaign };
  });

  const fight = tx.db.fight.insert({
    id: 0n, gameId: game.id, playerId: player.id, title: setup.title, place: setup.place, ...located,
    status: "on", outcome: undefined, round: out.s.G.round, turn: "", order: [], seq: 0, board: "", options: "", result: undefined, startedAt: tx.now, rev: 0,
  });
  tx.db.fightRules.insert({ fightId: fight.id, gameId: game.id, campaign: out.campaign });
  const written = save(tx, fight, out.s, out.moments, out.campaign);
  tx.log(`[fight] game ${game.id}: ${setup.title} starts, ${out.s.G.order.length} in it, ${out.s.activeUnit()?.id ?? "nobody"} first`);
  return written;
}

/** The start's moment (initiative, the opening lines; whoever's coming later isn't in them: they're the fight's surprise), then the first turn's. */
function begin(s: Skirmish, setup: FightSetup, map: TileMap, all: ReturnType<typeof boardOf>["rolled"]): void {
  const rolled = all.filter(r => s.G.units[r.unit]?.state !== "coming");
  s.moment("start", undefined, { initiative: rolled });
  s.log("system", "Roll for initiative!");
  s.log("dice", initiativeLine(rolled, s.G));
  const sallow = Object.values(s.G.units).find(u => u.castId === "sallow");
  if (sallow) s.log("narration", flavour("draw:sallow", hash(map.id, setup.title))!, sallow.id);
  if (setup.dust?.length) s.log("narration", `The grain dust hangs in the lantern light between the stacks like a golden fog, and everyone in ${setup.place} is suddenly very aware of the lanterns.`);
  s.beginTurn();
}
