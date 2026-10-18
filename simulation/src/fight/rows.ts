// New (M6, docs/combat-design.md): a fight's rows in the simulation, and a move on it, as one call: the board, the map and the engine's campaign read; the Skirmish made over them on the game's dice, pinned; what it did written back (the board, the campaign, its moments numbered, the player's options, the next of the other side's turns scheduled, the end).
import { ScheduleAt } from "spacetimedb";
import { rng } from "../../../shared/dice.ts";
import type { FightBoard, FightEvent, FightResult } from "../../../shared/fight/types.ts";
import { stepDelayMs } from "../../../shared/fight/pace.ts";
import { mapOf, type MapFile } from "../../../shared/map/tiles.ts";
import type { TileMap } from "../../../shared/map/types.ts";
import { keep, loaded } from "../../../shared/rules/engine.ts";
import type { TxCtx } from "../context.ts";
import { gameRow, type RowOf } from "../rows.ts";
import { engineCall } from "../rules/session.ts";
import { gameCampaignId } from "../scenes.ts";
import { optionsOf } from "./options.ts";
import { Table } from "./rules.ts";
import { Skirmish, type Moment } from "./skirmish.ts";
import { closeEncounter, ended } from "./end.ts";
import { tellTurns } from "./gm.ts";
import { playersTurn } from "./turns.ts";

export type FightRow = RowOf<"fight">;

/** The game's fight, the latest: on, over (its end still on screen) or done. */
export function fightOf(tx: TxCtx, gameId: bigint): FightRow | undefined {
  return [...tx.db.fight.gameId.filter(gameId)].sort((a, b) => (a.id > b.id ? -1 : 1))[0];
}

/** The game's fight while it's on, or its end is still on screen (not yet done). */
export function liveFightOf(tx: TxCtx, gameId: bigint): FightRow | undefined {
  const fight = fightOf(tx, gameId);
  return fight && fight.status !== "done" ? fight : undefined;
}

export const boardOfRow = (fight: Pick<FightRow, "board">) => JSON.parse(fight.board) as FightBoard;

/** The tile maps fights are played on, built once an isolate by the file they're built from. */
const MAPS = new Map<string, TileMap>();

/** A fight's map: its own (a zoo ring's), or the campaign's by key. */
export function fightMap(tx: TxCtx, fight: Pick<FightRow, "gameId" | "mapKey" | "map">): TileMap {
  const json = fight.map ?? campaignMapJson(tx, fight.gameId, fight.mapKey ?? "");
  let map = MAPS.get(json);
  if (!map) {
    map = mapOf(JSON.parse(json) as MapFile).map;
    MAPS.set(json, map);
  }
  return map;
}

function campaignMapJson(tx: TxCtx, gameId: bigint, key: string): string {
  const def = tx.db.mapDef.id.find(`${gameCampaignId(gameRow(tx, gameId))}/${key}`);
  if (!def) throw new Error(`fight: game ${gameId}'s campaign has no map ${key}`);
  return def.json;
}

/** Every row of a game's fights: the last one's, before another starts, and a deleted game's. */
export function clearFights(tx: TxCtx, gameId: bigint): void {
  for (const fight of [...tx.db.fight.gameId.filter(gameId)]) {
    tx.db.fightEvent.fightId.delete(fight.id);
    for (const s of [...tx.db.fightClock.iter()].filter(s => s.fightId === fight.id)) tx.db.fightClock.scheduledId.delete(s.scheduledId);
    tx.db.fight.id.delete(fight.id);
  }
  tx.db.fightRules.gameId.delete(gameId);
}

/**
 * A move on a fight (a player's act, the other side's turn): the Skirmish over its board and map,
 * on the engine (pinned to the game's dice and the transaction's time, its dice the game's next
 * roll), `act` done on it, then what it did written back. `act` may throw (a refusal): then nothing
 * is written, and the transaction's rollback takes the dice's count back too.
 */
export function play<T>(tx: TxCtx, fight: FightRow, act: (s: Skirmish) => T): T {
  const rules = tx.db.fightRules.fightId.find(fight.id);
  if (!rules) throw new Error(`fight ${fight.id} has no campaign`);
  const map = fightMap(tx, fight);
  const board = boardOfRow(fight);
  const dice = nextRoll(tx, fight.gameId);

  const out = engineCall(tx, fight.gameId, r => {
    const engine = r.engine(dice.engineSeed);
    const table = new Table({ E: r.E, engine, plan: engine.plan as unknown as Table["kit"]["plan"] }, loaded(r, rules.campaign), rng(dice.otherSeed));
    const s = new Skirmish({ ...board, map }, table);
    const result = act(s);
    // The move that ends the fight closes its encounter on the engine too.
    if (s.G.outcome && fight.status === "on") closeEncounter(s);
    const moments = s.done();
    const campaign = r.E.serializeCampaign(table.campaign);
    keep(r, campaign, table.campaign);
    return { result, moments, campaign, s };
  });

  if (out.campaign !== rules.campaign) tx.db.fightRules.fightId.update({ ...rules, campaign: out.campaign });
  save(tx, fight, out.s, out.moments, out.campaign);
  return out.result;
}

/** A look at a fight as the rules see it, nothing written and nothing rolled for good: the Skirmish over its board, on the engine (a test's: the AI's next step, the options). */
export function peek<T>(tx: TxCtx, fight: FightRow, look: (s: Skirmish) => T): T {
  const rules = tx.db.fightRules.fightId.find(fight.id);
  if (!rules) throw new Error(`fight ${fight.id} has no campaign`);
  const map = fightMap(tx, fight);
  const board = boardOfRow(fight);
  return engineCall(tx, fight.gameId, r => {
    const engine = r.engine(0);
    const table = new Table({ E: r.E, engine, plan: engine.plan as unknown as Table["kit"]["plan"] }, loaded(r, rules.campaign), rng(0));
    return look(new Skirmish({ ...board, map }, table));
  });
}

/**
 * What a move did, written back: its moments numbered on from the fight's last, the board and its
 * bookkeeping columns, the player's options when it's their turn, and either the end (over, how it
 * went, the player written back when the fight keeps them) or, when the other side has the turn,
 * its step scheduled once these moments have had their time on screen.
 */
export function save(tx: TxCtx, fight: FightRow, s: Skirmish, moments: Moment[], campaign: string): FightRow {
  const { map: _map, ...board } = s.G;
  let seq = fight.seq;
  const fresh: Array<{ seq: number; kind: Moment["kind"]; actor?: string }> = [];
  for (const m of moments) {
    seq++;
    tx.db.fightEvent.insert({
      id: 0n, fightId: fight.id, gameId: fight.gameId, seq, round: m.round, turn: m.turn, kind: m.kind, actor: m.actor, target: m.target,
      caption: m.caption, detail: JSON.stringify(m.detail), at: tx.now,
    });
    fresh.push({ seq, kind: m.kind, ...(m.actor ? { actor: m.actor } : {}) });
  }
  // A scene's fight: each turn these moments finished, for the GM to tell in the log (fight/gm.ts).
  tellTurns(tx, fight, board, fresh.filter(w => w.kind === "turn" || w.kind === "over"), fresh);
  const over = !!board.outcome;
  const result: FightResult | undefined = over && fight.status === "on" ? ended(tx, fight, board, campaign) : undefined;
  const written = tx.db.fight.id.update({
    ...fight,
    status: over ? (fight.status === "on" ? "over" : fight.status) : "on",
    outcome: board.outcome ?? fight.outcome,
    round: board.round, turn: over ? "" : (board.order[board.active] ?? ""), order: [...board.order], seq,
    board: JSON.stringify(board),
    options: !over && playersTurn(s) ? JSON.stringify(optionsOf(s)) : "",
    ...(result ? { result: JSON.stringify(result) } : {}),
    rev: fight.rev + 1,
  });
  if (!over && !playersTurn(s)) scheduleStep(tx, written, board.fast ? 0 : stepDelayMs(moments));
  return written;
}

/** The next of the other side's turns, `ms` from now: the fight's one step (any other is taken out first). */
export function scheduleStep(tx: TxCtx, fight: Pick<FightRow, "id">, ms: number): void {
  for (const s of [...tx.db.fightClock.iter()].filter(s => s.fightId === fight.id)) tx.db.fightClock.scheduledId.delete(s.scheduledId);
  const at = tx.now.microsSinceUnixEpoch + BigInt(Math.max(0, Math.round(ms))) * 1000n;
  tx.db.fightClock.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(at), fightId: fight.id });
}

/** The fight's moments as a client reads them: in order. */
export function eventsOf(tx: TxCtx, fightId: bigint): FightEvent[] {
  return [...tx.db.fightEvent.fightId.filter(fightId)].sort((a, b) => a.seq - b.seq).map(e => ({
    seq: e.seq, round: e.round, turn: e.turn, kind: e.kind as FightEvent["kind"], ...(e.actor !== undefined ? { actor: e.actor } : {}),
    ...(e.target !== undefined ? { target: e.target } : {}), caption: e.caption, detail: JSON.parse(e.detail) as FightEvent["detail"],
  }));
}

/**
 * The game's next roll for a move on a fight: the engine's dice are seeded from the game's seed and
 * the roll's number, as a check's are (shared/rules/engine.ts opened), and a roll outside the engine
 * (a blow at a lantern) has a seed of its own beside it; the dice's count goes on by one.
 */
export function nextRoll(tx: TxCtx, gameId: bigint): { engineSeed: number; otherSeed: number } {
  const dice = tx.db.dice.gameId.find(gameId);
  if (!dice) throw new Error(`game ${gameId} has no dice`);
  const n = dice.rolls + 1;
  tx.db.dice.gameId.update({ ...dice, rolls: n });
  return { engineSeed: dice.seed + 7919 * n, otherSeed: dice.seed + 15485863 * n };
}
