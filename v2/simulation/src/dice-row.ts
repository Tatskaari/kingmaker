import { rollFrom, type RollResult } from "../../shared/dice.ts";
import type { TxCtx } from "./context.ts";
import type { Roll } from "./gm/bookkeeping.ts";
import { sheetRow, type SceneRow } from "./rows.ts";

/**
 * The game's dice (v0-design §6.4): the `dice` row is its only randomness after it's made, each roll
 * the next of its seed's sequence, the count written back in the same transaction. So a commit that
 * withTx runs twice rolls the same, and a game with the same seed and lines rolls the same again.
 * The modifier is the controller's sheet's for the skill.
 */
export function rollerFor(tx: TxCtx, scene: SceneRow): Roll {
  const skills = JSON.parse(sheetRow(tx, scene.controllerId).skills) as Partial<Record<string, number>>;
  return (skill, dc) => roll(tx, scene.gameId, skill, dc, skills[skill] ?? 0);
}

function roll(tx: TxCtx, gameId: bigint, skill: string, dc: number, modifier: number): RollResult {
  const dice = tx.db.dice.gameId.find(gameId);
  if (!dice) throw new Error(`game ${gameId} has no dice`);
  const rolled = rollFrom(dice, skill, dc, modifier);
  tx.db.dice.gameId.update({ ...dice, rolls: rolled.dice.rolls });
  return rolled.roll;
}
