import type { Backstory } from "../../../shared/creation/types.ts";
import type { TxCtx } from "../context.ts";
import { createGame, makeCharacterRows } from "../games/create.ts";
import { campaignFile, campaignVersion } from "../scenes.ts";
import { chosenOf, json, moveOn, type CreationRow } from "./rows.ts";

/**
 * The backstory settled, the game is made (v1-design §3.5; the prototype's create, game.ts:783-804,
 * with Core.create and createSession): the game, under the creation's uid, its host seated and its
 * dice; the character the rules engine makes from the chosen build, with the backstory, as its
 * rules_state and sheet; and the creation made, pointing at the game until `begin` sets off in it
 * (or choose_again puts it away). The module logs how long the engine took.
 */
export function makeCharacter(tx: TxCtx, row: CreationRow, backstory?: Backstory): void {
  const started = tx.elapsedMs();
  const chosen = chosenOf(row);
  if (!chosen) throw new Error(`creation ${row.uid} has no build chosen`);
  const campaign = campaignVersion(tx, row.campaign, row.campaignVersion);

  const { game, player } = createGame(tx, campaign, row.identity, { uid: row.uid, name: row.name, concept: row.concept });
  const made = makeCharacterRows(tx, player, chosen.build, campaignFile(campaign).level, backstory);

  moveOn(tx, row, { step: "made", gameId: game.id, busy: undefined, backstory: json(backstory) });
  tx.log(`[rules] makeCharacter ${Math.round(tx.elapsedMs() - started)} ms (createCharacter ${Math.round(made.createMs)}, sheetData ${Math.round(made.sheetMs)})`);
}
