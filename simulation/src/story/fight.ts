// A scene's fight, on the board (docs/combat-gm.md; docs/combat-design.md §5): set out once the
// player goes on to it (fight_it_out), fought as the zoo's combat ring fights one, and the scene
// picked up from how it went once the player is out. What comes after it is the prototype's
// (src/game/play.ts:479-507 afterFight, src/runtime/engine.ts:1003-1018 resumeAfterFight's
// bookkeeping) as rows, as the fight's stand-in had it: the aftermath's reply is the opening's think
// on a turn of its own, with how the fight went (gm.aftermath, the AI service's), and its commit
// stages what it did (stageAftermath).

import type { FightResult } from "../../../shared/fight/types.ts";
import type { SceneFight } from "../../../shared/gm/fight.ts";
import type { GmState } from "../../../shared/gm/state.ts";
import { idOf, idText } from "../../../shared/protocol/keys.ts";
import { refusal } from "../../../shared/protocol/refusals.ts";
import { presentFighters } from "../../../shared/scene/graph.ts";
import type { Scene } from "../../../shared/scene/types.ts";
import { Refused, type TxCtx } from "../context.ts";
import { boardOfRow, type FightRow } from "../fight/rows.ts";
import { fightIntoWorld, resultOf, sceneBoard, sceneFightSetup } from "../fight/scene.ts";
import { startFight } from "../fight/start.ts";
import { getGm, putGm } from "../gm/rows.ts";
import { queueThink } from "../jobs.ts";
import { companionsHere, keepers } from "../moves/fight.ts";
import { openScene, seenOf } from "../moves/open-scene.ts";
import { playerRow, sceneRow, updateScene, updateTurn, type SceneRow } from "../rows.ts";
import { sceneGraph } from "../scenes.ts";
import { addEntry } from "../transcript.ts";
import { newTurn } from "../turns.ts";
import { placeWorldOf, savePlaceWorld } from "../world/place.ts";
import { syncStage } from "../world/stage.ts";
import { journal } from "./effects.ts";

/**
 * The scene's fight set out on the board (fight_it_out on a scene at its fight): from its sides as
 * they were taken (gm_state's fight), or, for a combat exit's (whose ending broke into one), the
 * companion beside the player and everyone else here against them. Refused when it's out already.
 * `scene` is fighting, and its controller's.
 */
export function setOutTheFight(tx: TxCtx, scene: SceneRow): FightRow {
  const gm = getGm(tx, scene.id);
  const graph = sceneGraph(tx, scene, gm);
  const fight = gm.fight ?? exitFight(tx, scene, graph, gm);
  if (fight.board && tx.db.fight.id.find(idOf(fight.board))) throw new Refused(refusal("not_now", { text: "(The fight's on: see it through.)" }));
  const row = startFight(tx, playerRow(tx, scene.controllerId), sceneFightSetup(tx, scene, graph, fight));
  putGm(tx, scene.id, { ...gm, fight: { ...fight, board: idText(row.id) } });
  tx.log(`[story] scene ${scene.id} ${scene.sceneKey}: the fight (${fight.why || fight.from}) set out on the board, fight ${row.id}`);
  return row;
}

/** A combat exit's fight: the companion beside the player, everyone else here against them. */
function exitFight(tx: TxCtx, scene: SceneRow, graph: Scene, gm: GmState): SceneFight {
  const exit = scene.exitKey ?? gm.ended?.exitId;
  const companions = new Set(companionsHere(tx, { scene, graph, gm }));
  const sides = Object.fromEntries(presentFighters(graph, gm).map(c => [c.id, companions.has(c.id) ? "with" as const : "against" as const]));
  return { turn: scene.turns, why: graph.exits.find(e => e.id === exit)?.title ?? "", from: "exit", sides };
}

/**
 * The scene picks up after its fight, once the player is out of it (story-design §4.3,
 * resumeAfterFight): how it went in the place's world (fight/scene.ts fightIntoWorld: who's down,
 * hurt, held or gone, where everyone ended up, the lights it broke), whoever ran off the board away
 * from the scene; "The fight: <how it went>" in the transcript, and in the notebook; "The fight is
 * over: <how it went>" settled; a combat exit's ending undone (as the stand-in's was: spent, no
 * longer reached, so the scene's routes are open again but the fight's). Then a new turn holds the
 * scene while the GM tells the aftermath (the opening's think, with how it went), and the scene is
 * live again once it's told.
 */
export function pickUpAfterFight(tx: TxCtx, fight: FightRow): void {
  const board = boardOfRow(fight);
  const scene = sceneRow(tx, idOf(board.scene!));
  const result = resultOf(fight.result);
  if (!result) throw new Error(`fight ${fight.id} is over with no result`);
  const gm = getGm(tx, scene.id);
  const graph = sceneGraph(tx, scene, gm);
  const n = scene.turns + 1;
  let lease = scene.turnId === undefined ? undefined : tx.db.turn.id.find(scene.turnId);
  // A turn still holding the scene's lease is done now, so nothing finishing it lets go of the aftermath's.
  if (lease) lease = updateTurn(tx, lease.id, { phase: "done", endedAt: tx.now, note: undefined });

  const place = placeWorldOf(tx, scene);
  const laid = sceneBoard(tx, scene, place.world);
  const { gone } = laid ? fightIntoWorld(place.world, laid.region, board, keepers(tx, { scene, graph, gm })) : { gone: [] };
  savePlaceWorld(tx, scene, place, graph);

  addEntry(tx, scene, { turn: n, speaker: "system", kind: "system", text: `The fight: ${told(result)}` });
  journal(tx, scene, `${fight.title}: ${told(result)}`);

  const exit = gm.fight?.from === "exit" ? scene.exitKey ?? gm.ended?.exitId : undefined;
  delete gm.ended; delete gm.closing; delete gm.fight;
  if (exit && !gm.fought.includes(exit)) gm.fought.push(exit);
  // The scene format's play (shared/scene/beats.ts): the fight's ending is no longer where the scene is, so its routes open again (all but the fight's).
  if (exit) gm.reached = gm.reached.filter(id => id !== exit);
  gm.absent = [...new Set([...gm.absent, ...gone])];
  gm.established.push(`The fight is over: ${result.summary}`);
  putGm(tx, scene.id, gm);
  syncStage(tx, scene, graph, gm);

  const turn = newTurn(tx, scene, scene.controllerId, n, "replying");
  updateScene(tx, scene.id, { status: "live", exitKey: undefined, endedAt: undefined, turnId: turn.id, turns: n });
  queueThink(tx, openScene, {
    step: "open", game: idText(scene.gameId), scene: idText(scene.id), turn: idText(turn.id), seen: seenOf(tx, scene.id), aftermath: { summary: result.summary },
  });
  tx.log(`[story] scene ${scene.id} ${scene.sceneKey}: the fight ${fight.id} over (${result.outcome})${gone.length ? `, gone: ${gone.join(", ")}` : ""}; the aftermath on turn ${n}`);
}

/** How it went, as the player was told it (older results have only the story's summary). */
const told = (result: FightResult) => result.told ?? result.summary;
