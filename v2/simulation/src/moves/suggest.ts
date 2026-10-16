import type { Suggestion, SuggestResponse } from "../../../shared/protocol/ai.ts";
import { idOf, idText } from "../../../shared/protocol/keys.ts";
import type { TxCtx } from "../context.ts";
import { suggestCall } from "../gm/requests.ts";
import { queueThink } from "../jobs.ts";
import { playerRow, sceneRow, turnRow, updateTurn, type SceneRow, type TurnRow } from "../rows.ts";
import type { Move } from "./move.ts";
import type { SuggestPlan } from "./plans.ts";

/**
 * The lines the player might say or do next (v5-design §3.4, §3.5; the prototype's suggest.ts:53-93
 * as rows). After a reply that leaves the scene going, and when its controller has them on, they're
 * asked for; the AI service proposes, screens, judges and mixes them; they land as the scene's one
 * set of `scene_suggestion` rows, replacing the last. A job in the background that nothing waits for:
 * a set whose moment has passed (a later line said, the scene over, the lines turned off) is dropped
 * when it comes, and one that can't be made leaves the moment with none.
 */
export const suggest: Move<void, SuggestPlan> = {
  name: "suggest",
  background: true,
  giveUpMs: 60_000,

  resolve() {
    throw new Error("the lines are asked for by a commit or set_suggestions, never made as a move");
  },

  think: (tx, plan) => suggestCall(tx, plan),

  /** Always: whether the set still lands is the commit's to say. */
  applies: () => true,

  commit(tx, plan, answer) {
    const lines = (answer as Partial<SuggestResponse>).lines;
    if (!Array.isArray(lines)) throw new Error("the answer has no lines");

    landLines(tx, plan, lines, "landed");
    return { done: true };
  },

  /** The prototype lands no lines when the proposal fails (suggest.ts:91): the moment has none. */
  giveUp(tx, plan) {
    landLines(tx, plan, [], "lost");
  },
};

/** After a reply that leaves the scene going: this moment's lines asked for, when its controller has them on (engine.ts:869, :504). */
export function suggestAfter(tx: TxCtx, scene: SceneRow, turnId: bigint): void {
  if (playerRow(tx, scene.controllerId).suggestions) askForLines(tx, turnId);
}

/** A turn's lines asked for: its next ask (suggest, suggest-2, …), the turn saying they're coming. */
export function askForLines(tx: TxCtx, turnId: bigint): void {
  const turn = updateTurnAsk(tx, turnId);
  queueThink(tx, suggest, { step: "suggest", game: idText(turn.gameId), scene: idText(turn.sceneId), turn: idText(turn.id), n: turn.n, ask: turn.suggestAsks });
}

/** Whether a scene has suggested lines for this turn. */
export function hasLinesFor(tx: TxCtx, sceneId: bigint, n: number): boolean {
  return [...tx.db.sceneSuggestion.sceneId.filter(sceneId)].some(s => s.turn === n);
}

// ---------------------------------------------------------------------------------------------

function updateTurnAsk(tx: TxCtx, turnId: bigint): TurnRow {
  return updateTurn(tx, turnId, { suggest: "coming", suggestAsks: turnRow(tx, turnId).suggestAsks + 1 });
}

/**
 * A set come (or lost, landing as none): the scene's set replaced, in order, for its controller; or,
 * when its moment has passed, the rows left as they are (`land`, suggest.ts:85-90; `stopSuggesting`,
 * :69). With no lines, the set is cleared, so the next ask offers nothing as already offered.
 */
function landLines(tx: TxCtx, plan: SuggestPlan, lines: Suggestion[], came: "landed" | "lost"): void {
  const scene = sceneRow(tx, idOf(plan.scene));
  const passed = momentPassed(tx, scene, plan.n);

  if (!passed) replaceSet(tx, scene, plan.n, lines);
  const state = came === "landed" && passed ? "dropped" : came;
  updateTurn(tx, idOf(plan.turn), { suggest: state });
  tx.log(`[scene ${plan.scene} turn ${plan.n}] lines ${state}${passed ? ` (${passed})` : came === "landed" ? `: ${lines.length}` : ": the set cleared"}`);
}

/** Why a set for turn n no longer lands, if it doesn't: a later line was said, the scene is over, or its controller turned them off. */
function momentPassed(tx: TxCtx, scene: SceneRow, n: number): string | undefined {
  if (scene.turns !== n) return `turn ${scene.turns} has been said`;
  if (scene.status === "ended") return "the scene is over";
  if (!playerRow(tx, scene.controllerId).suggestions) return "they're turned off";
  return undefined;
}

function replaceSet(tx: TxCtx, scene: SceneRow, n: number, lines: Suggestion[]): void {
  tx.db.sceneSuggestion.sceneId.delete(scene.id);
  lines.forEach((line, i) => {
    tx.db.sceneSuggestion.insert({ id: 0n, gameId: scene.gameId, sceneId: scene.id, playerId: scene.controllerId, turn: n, ord: i + 1, kind: line.kind, text: line.text });
  });
}
