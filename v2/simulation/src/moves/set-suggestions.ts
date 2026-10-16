import type { Identity } from "spacetimedb";
import { refusal } from "../../../shared/protocol/refusals.ts";
import { actorOf, Refused, type TxCtx } from "../context.ts";
import { playerRow, sceneOfPlayer, type PlayerRow } from "../rows.ts";
import { latestTurnOf } from "../turns.ts";
import { askForLines, hasLinesFor, sceneOver } from "./suggest.ts";

/**
 * set_suggestions (v5-design §3.3; the prototype's setSuggestions and suggestNow, play.ts:364-385):
 * whether lines to say are suggested over the box is a player's own setting, the controller's or a
 * spectator's. Off, any on their way are dropped when they come (the rows are left: the client
 * shows none while it's off). On, while they lead a scene whose latest reply is in, with no lines
 * for it landed or coming, this moment's are asked for at once.
 */
export function setSuggestionsReducer(tx: TxCtx, sender: Identity, { on }: { on: boolean }): void {
  const player = seatedPlayer(tx, sender);

  tx.db.player.id.update({ ...player, suggestions: on });

  const turnId = on ? turnWantingLines(tx, player) : undefined;
  if (turnId !== undefined) askForLines(tx, turnId);
}

function seatedPlayer(tx: TxCtx, sender: Identity): PlayerRow {
  const { id } = actorOf(tx, sender);
  if (id === undefined) throw new Refused(refusal("not_in_game"));
  return playerRow(tx, id);
}

/**
 * The turn whose lines to ask for now, if any: the latest of a live or closing scene the player
 * leads, its reply in (settling, noting or done), none of its lines coming or landed, and the scene
 * not ending on it (the reply's commit asked for none).
 */
function turnWantingLines(tx: TxCtx, player: PlayerRow): bigint | undefined {
  const scene = sceneOfPlayer(tx, player.id);
  if (!scene || scene.controllerId !== player.id || (scene.status !== "live" && scene.status !== "closing")) return undefined;
  if (sceneOver(tx, scene)) return undefined;

  const turn = latestTurnOf(tx, scene);
  if (!turn || !REPLIED.has(turn.phase) || turn.suggest === "coming" || hasLinesFor(tx, scene.id, turn.n)) return undefined;
  return turn.id;
}

/** The phases of a turn whose reply is in. */
const REPLIED = new Set(["settling", "noting", "done"]);
