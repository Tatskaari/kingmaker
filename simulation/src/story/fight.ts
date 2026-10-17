// fightItOut is the prototype's fight stand-in (src/game/fight-standin.ts at 44c6d4a: its one action, its line and its result) and what comes after it (src/game/play.ts:479-507 afterFight, src/runtime/engine.ts:1003-1018 resumeAfterFight's bookkeeping), as rows: the aftermath's reply is the opening's think on a turn of its own, with how the fight went (gm.aftermath, the AI service's), and its commit stages what it did (stageAftermath). The notebook's line that the fight wasn't played is the story unit's.

import { idText } from "../../../shared/protocol/keys.ts";
import type { TxCtx } from "../context.ts";
import { getGm, putGm } from "../gm/rows.ts";
import { queueThink } from "../jobs.ts";
import { openScene, seenOf } from "../moves/open-scene.ts";
import { updateScene, updateTurn, type SceneRow } from "../rows.ts";
import { addEntry } from "../transcript.ts";
import { newTurn } from "../turns.ts";
import { journal } from "./effects.ts";
import { FIGHT_NOT_PLAYED, FIGHT_SUMMARY, STANDIN_LINE } from "./words.ts";

/**
 * The fight, fought by the stand-in (story-design §4.3): one action resolves it as won. Its line,
 * then "The fight: <how it went>" in the scene's transcript, and the notebook's line that it wasn't
 * played. The scene picks up where the fight left it (resumeAfterFight): its combat exit is spent
 * (fought), its ending is undone (ended, closing, pending, the lead towards one, and its node no
 * longer reached, so the scene's routes are open again but the fight's), and "The fight is
 * over: <how it went>" is settled; a new turn holds the scene while the GM tells the aftermath (the
 * opening's think, with how it went), and the scene is live again once it's told. `scene` is
 * fighting, and its controller's.
 */
export function fightItOut(tx: TxCtx, scene: SceneRow): void {
  const gm = getGm(tx, scene.id);
  const exit = scene.exitKey ?? gm.ended?.exitId;
  const n = scene.turns + 1;
  let lease = scene.turnId === undefined ? undefined : tx.db.turn.id.find(scene.turnId);
  // A turn still waiting on its reply's notes holds the scene: it's done now, so the notes landing don't let go of the aftermath's.
  if (lease) lease = updateTurn(tx, lease.id, { phase: "done", endedAt: tx.now, note: undefined });

  addEntry(tx, scene, { turn: n, speaker: "system", kind: "system", text: STANDIN_LINE });
  addEntry(tx, scene, { turn: n, speaker: "system", kind: "system", text: `The fight: ${FIGHT_SUMMARY}` });
  journal(tx, scene, FIGHT_NOT_PLAYED);

  delete gm.ended; delete gm.closing; delete gm.pendingExit; delete gm.endingLead;
  if (exit && !gm.fought.includes(exit)) gm.fought.push(exit);
  // The scene format's play (shared/scene/beats.ts): the fight's ending is no longer where the scene is, so its routes open again (all but the fight's).
  if (exit) gm.reached = gm.reached.filter(id => id !== exit);
  gm.established.push(`The fight is over: ${FIGHT_SUMMARY}`);
  putGm(tx, scene.id, gm);

  const turn = newTurn(tx, scene, scene.controllerId, n, "replying");
  updateScene(tx, scene.id, { status: "live", exitKey: undefined, endedAt: undefined, turnId: turn.id, turns: n });
  queueThink(tx, openScene, {
    step: "open", game: idText(scene.gameId), scene: idText(scene.id), turn: idText(turn.id), seen: seenOf(tx, scene.id), aftermath: { summary: FIGHT_SUMMARY },
  });
  tx.log(`[story] scene ${scene.id} ${scene.sceneKey}: the fight (${exit ?? "?"}) fought by the stand-in; the aftermath on turn ${n}`);
}
