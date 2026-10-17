import type { Timestamp } from "spacetimedb";
import type { Backstory } from "../../../shared/creation/types.ts";
import { pocketsOf, sheetRows } from "../../../shared/rules/index.ts";
import { withEngine } from "../../../shared/rules/pin.ts";
import type { Pockets, Rules, RulesSession } from "../../../shared/rules/types.ts";
import type { Skill } from "../../../shared/scene/types.ts";
import type { SceneWorld } from "../../../shared/world/scene-world.ts";
import type { TxCtx } from "../context.ts";
import { gameRow, playerRow, type PlayerRow, type RowOf } from "../rows.ts";
import { campaignFile, campaignOfGame } from "../scenes.ts";

/**
 * Where the rules engine meets the rows (v1-design §3.6). The rules code (shared/rules) reads a
 * RulesSession, the prototype's SessionState as far as it goes; this builds one from a character's
 * rows (the game's dice, the player, their sheet and rules_state, and the world they're in when
 * there is one), runs the engine pinned, and writes back what it changed: the dice's count, the
 * engine's campaign and what's gone, the sheet.
 */

/**
 * How far apart each roll's pins are: a call's ids come from the dice's seed and count, never from
 * the rolls themselves (the engine's dice are seed + 7919 × count), and never advance the count.
 */
const PIN_STRIDE = 104_729;

/**
 * An engine call for a game, pinned (shared/rules withEngine): its ids drawn from the game's dice
 * and the calls this transaction has made, its clock at the transaction's time. So what the engine
 * writes is a pure function of the rows, and a commit withTx runs twice writes the same.
 */
export function engineCall<T>(tx: TxCtx, gameId: bigint, fn: (rules: Rules) => T): T {
  const rules = tx.rules();
  const dice = diceOf(tx, gameId);
  const pin = { seed: dice.seed + PIN_STRIDE * (dice.rolls + 1) + tx.engineCalls++, nowMs: msOf(tx.now) };
  return withEngine(pin, () => fn(rules));
}

/** A player's character as the rules code reads it, from the rows: in the world given (the scene's place), or in none (before the story begins). */
export function sessionOf(tx: TxCtx, player: PlayerRow, world?: SceneWorld): RulesSession {
  const dice = diceOf(tx, player.gameId);
  const sheet = tx.db.sheet.playerId.find(player.id) ?? undefined;
  const state = tx.db.rulesState.playerId.find(player.id) ?? undefined;
  const backstory = sheet?.backstory ? (JSON.parse(sheet.backstory) as Backstory) : undefined;
  return {
    id: gameRow(tx, player.gameId).uid, seed: dice.seed, rollCount: dice.rolls,
    player: {
      name: player.name, concept: player.concept, modifiers: sheet ? (JSON.parse(sheet.skills) as Partial<Record<Skill, number>>) : {},
      ...(sheet ? { build: sheet.build } : {}), ...(backstory ? { backstory } : {}),
    },
    ...(state ? { rules: { campaign: state.campaign, pc: state.pc, npcs: {}, prefer: state.prefer, gear: state.gear, gone: state.gone } } : {}),
    ...(world ? { world } : {}),
    history: [],
  };
}

/** A new character's rows, as the engine made them: rules_state from session.rules, and the sheet with the pockets given. */
export function insertCharacter(tx: TxCtx, player: PlayerRow, session: RulesSession, rules: Rules, pockets: Pockets): void {
  const state = session.rules;
  if (!state) throw new Error(`player ${player.id}'s character wasn't made`);
  tx.db.rulesState.insert({ playerId: player.id, gameId: player.gameId, pc: state.pc, campaign: state.campaign, prefer: state.prefer ?? [], gear: (state.gear ?? []).map(gearRow), gone: state.gone ?? [] });
  tx.db.sheet.insert({ playerId: player.id, gameId: player.gameId, ...sheetRows(rules, session), pockets: JSON.stringify(pockets) });
}

/** What the engine changed, written back: the dice's count, its campaign and what's gone (and the gear, which it keeps up to date). */
export function saveSession(tx: TxCtx, player: PlayerRow, session: RulesSession): void {
  const dice = diceOf(tx, player.gameId);
  if (dice.rolls !== session.rollCount) tx.db.dice.gameId.update({ ...dice, rolls: session.rollCount });

  const state = tx.db.rulesState.playerId.find(player.id);
  const now = session.rules;
  if (!state || !now) return;
  tx.db.rulesState.playerId.update({ ...state, campaign: now.campaign, gone: now.gone ?? [], gear: (now.gear ?? state.gear).map(gearRow) });
}

/** The sheet's engine-made columns as the engine has the character now (sheetRows: about 19 KB of data for a wizard). */
export function writeSheet(tx: TxCtx, player: PlayerRow, session: RulesSession, rules: Rules): void {
  const sheet = tx.db.sheet.playerId.find(player.id);
  if (!sheet) throw new Error(`player ${player.id} has no sheet`);
  tx.db.sheet.playerId.update({ ...sheet, ...sheetRows(rules, session) });
}

/**
 * The sheet's pockets (the purse and what else they carry), from the world they're in, or before the
 * story begins the campaign's starting purse: no engine. Written only when they've changed, so a
 * settle that moved nothing of theirs sends the sheet's subscribers nothing.
 */
export function refreshPockets(tx: TxCtx, playerId: bigint, world: SceneWorld | undefined): void {
  const sheet = tx.db.sheet.playerId.find(playerId);
  if (!sheet) return;
  const pockets = JSON.stringify(pocketsFor(tx, playerRow(tx, playerId), world));
  if (pockets !== sheet.pockets) tx.db.sheet.playerId.update({ ...sheet, pockets });
}

/** What a player carries that isn't gear, in the world given (or, before the story begins, the campaign's starting purse). */
export function pocketsFor(tx: TxCtx, player: PlayerRow, world: SceneWorld | undefined): Pockets {
  const purse = campaignFile(campaignOfGame(tx, gameRow(tx, player.gameId))).startingPurse;
  return pocketsOf({ ...lightSession(tx, player), ...(world ? { world } : {}) }, purse);
}

// ---------------------------------------------------------------------------------------------

function diceOf(tx: TxCtx, gameId: bigint): RowOf<"dice"> {
  const dice = tx.db.dice.gameId.find(gameId);
  if (!dice) throw new Error(`game ${gameId} has no dice`);
  return dice;
}

/** A session with only what pocketsOf reads (the world, what was carried, the scenes played): no rows but the player's. */
const lightSession = (tx: TxCtx, player: PlayerRow): RulesSession => ({
  id: gameRow(tx, player.gameId).uid, seed: 0, rollCount: 0, player: { name: player.name, concept: player.concept, modifiers: {} }, history: [],
});

/** A gear row as the table takes it: an option column's key always there. */
const gearRow = (g: { id: string; name: string; kind: string; slot?: string }) => ({ id: g.id, name: g.name, kind: g.kind, slot: g.slot });

const msOf = (t: Timestamp) => Number(t.microsSinceUnixEpoch / 1000n);
