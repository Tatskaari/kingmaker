import { rollFrom, type RollResult } from "../../shared/dice.ts";
import type { Skill } from "../../shared/scene/types.ts";
import type { TxCtx } from "./context.ts";
import { sheetRow, type SceneRow } from "./rows.ts";
import { checkThroughEngine } from "./rules/play.ts";

/** A check rolled: the game's dice, the sheet's modifier for the skill. */
export type Roll = (skill: string, dc: number) => RollResult;

/**
 * The game's dice (v0-design §6.4, v1-design §3.6): the `dice` row is its only randomness after it's
 * made, each roll the next of its seed's sequence, the count written back in the same transaction.
 * So a commit that withTx runs twice rolls the same, and a game with the same seed and lines rolls
 * the same again. A check rolls through the rules engine on the controller's character, as the
 * prototype's rollFor does with a sheet (conditions and expertise apply); a character the engine
 * didn't make rolls their sheet's modifier, as it does without one.
 */
export function rollerFor(tx: TxCtx, scene: SceneRow): Roll {
  const engineMade = !!tx.db.rulesState.playerId.find(scene.controllerId);
  return (skill, dc) => (engineMade ? checkThroughEngine(tx, scene.controllerId, skill as Skill, dc) : bySheet(tx, scene, skill, dc));
}

function bySheet(tx: TxCtx, scene: SceneRow, skill: string, dc: number): RollResult {
  const skills = JSON.parse(sheetRow(tx, scene.controllerId).skills) as Partial<Record<string, number>>;
  const dice = tx.db.dice.gameId.find(scene.gameId);
  if (!dice) throw new Error(`game ${scene.gameId} has no dice`);
  const rolled = rollFrom(dice, skill, dc, skills[skill] ?? 0);
  tx.db.dice.gameId.update({ ...dice, rolls: rolled.dice.rolls });
  return rolled.roll;
}
