import { initialGm, type GmState } from "../../../shared/gm/state.ts";
import type { OpenResponse } from "../../../shared/protocol/ai.ts";
import { idOf, idText } from "../../../shared/protocol/keys.ts";
import type { Scene } from "../../../shared/scene/types.ts";
import type { TxCtx } from "../context.ts";
import { keepOpened } from "../gm/bookkeeping.ts";
import { openCall } from "../gm/requests.ts";
import { getGm, putGm } from "../gm/rows.ts";
import { gameRow, placeRow, playerRow, sceneRow, updateScene, type GameRow, type PlayerRow, type SceneDefRow, type SceneRow } from "../rows.ts";
import { campaignFile, campaignOfGame, graphOf, sceneDefOf, sceneFileOf, sceneGraph } from "../scenes.ts";
import { noteHeard, writeReply } from "../transcript.ts";
import { finishTurn, newTurn } from "../turns.ts";
import { comeToAtOpening } from "../rules/play.ts";
import { refreshPockets } from "../rules/session.ts";
import { openPlace, type Start } from "../world/place.ts";
import { syncStage } from "../world/stage.ts";
import type { Move } from "./move.ts";
import { askForNotes } from "./notes.ts";
import type { OpenPlan, Seen } from "./plans.ts";
import { suggestAfter } from "./suggest.ts";

/**
 * A scene opens (v0-design §4.3, v1-design §3.6): its place built, the scene row and its GM
 * bookkeeping, who's on stage, the controller come to if they were down (the rules engine's first
 * draw of the scene), turn 0 holding the lease; then one think, the opening, streamed into turn 0's
 * draft and committed as the transcript's first entry, and the scene goes live (its notes and first
 * lines asked for: v5-design §3.5). `start` is what the character starts the game with: only the
 * game's first scene hands it out.
 */
export const openScene: Move<{ game: bigint; sceneKey: string; start?: Start }, OpenPlan> = {
  name: "openScene",

  resolve(tx, actor, { game: gameId, sceneKey, start }) {
    const game = gameRow(tx, gameId);
    const def = sceneDefOf(tx, game, sceneKey);
    const graph = graphOf(def);
    const gm = initialGm(graph);
    const controller = playerRow(tx, actor.id!);

    const scene = insertScene(tx, game, def, graph, gm, controller, start);
    putGm(tx, scene.id, gm);
    syncStage(tx, scene, graph, gm);
    noteHeard(tx, scene, graph);
    comeToAtOpening(tx, scene);

    const turn = newTurn(tx, scene, controller.id, 0, "replying");
    updateScene(tx, scene.id, { turnId: turn.id });
    return { done: false, plan: { step: "open", game: idText(game.id), scene: idText(scene.id), turn: idText(turn.id), seen: seenOf(tx, scene.id) } };
  },

  think: (tx, plan) => openCall(tx, plan),

  /**
   * The opening as the transcript's first entry, the notes disclosure opened kept; its notes and the
   * first lines to suggest asked for (engine.ts:211-212); the scene live, and turn 0 finished (done,
   * or noting until its notes are in, the lease kept till then).
   */
  commit(tx, plan, answer) {
    const opened = answer as OpenResponse;
    const scene = sceneRow(tx, idOf(plan.scene));
    const gm = getGm(tx, scene.id);
    const turnId = idOf(plan.turn);

    putGm(tx, scene.id, { ...gm, opened: keepOpened(gm.opened, opened.opened ?? []) });
    const opening = writeReply(tx, scene, 0, turnId, opened.entries);
    if (opening) askForNotes(tx, turnId, opening);
    suggestAfter(tx, scene, turnId);
    noteHeard(tx, scene, sceneGraph(tx, scene, gm));

    updateScene(tx, scene.id, { status: "live" });
    finishTurn(tx, scene.id, turnId);
    return { done: true };
  },
};

/** The scene's row, in its place (built now), with the controller and their character placed in both. */
function insertScene(tx: TxCtx, game: GameRow, def: SceneDefRow, graph: Scene, gm: GmState, controller: PlayerRow, start: Start | undefined): SceneRow {
  const placeKey = sceneFileOf(def).place ?? campaignFile(campaignOfGame(tx, game)).startPlace;
  const place = openPlace(tx, game, placeKey, graph, gm, controller, start);
  refreshPockets(tx, controller.id, place.world);
  const scene = tx.db.scene.insert({
    id: 0n, gameId: game.id, sceneKey: def.key, title: def.title, hook: def.hook, kind: "scene", placeId: place.placeId,
    status: "opening", controllerId: controller.id, turnId: undefined, turns: 0, exitKey: undefined, rev: 0, openedAt: tx.now, endedAt: undefined,
  });

  tx.db.place.id.update({ ...placeRow(tx, place.placeId), sceneId: scene.id });
  tx.db.player.id.update({ ...playerRow(tx, controller.id), characterId: place.characterId, placeId: place.placeId, sceneId: scene.id });
  return scene;
}

/** The scene's and its place's revs now: a plan's record of what it saw. */
export function seenOf(tx: TxCtx, sceneId: bigint): Seen {
  const scene = sceneRow(tx, sceneId);
  return { scene: scene.rev, place: placeRow(tx, scene.placeId).rev };
}
