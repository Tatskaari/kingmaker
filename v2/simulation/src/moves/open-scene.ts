import { initialGm, type GmState } from "../../../shared/gm/state.ts";
import type { OpenResponse } from "../../../shared/protocol/ai.ts";
import { idOf, idText } from "../../../shared/protocol/keys.ts";
import type { Scene } from "../../../shared/scene/types.ts";
import type { TxCtx } from "../context.ts";
import { keepOpened } from "../gm/bookkeeping.ts";
import { openCall } from "../gm/requests.ts";
import { getGm, putGm } from "../gm/rows.ts";
import { gameRow, placeRow, playerRow, sceneRow, turnRow, updateScene, type GameRow, type PlayerRow, type SceneDefRow, type SceneRow } from "../rows.ts";
import { campaignFile, campaignOfGame, graphOf, sceneDefOf, sceneFileOf, sceneGraph } from "../scenes.ts";
import { noteHeard, noteHeardInStory, writeReply } from "../transcript.ts";
import { finishTurn, newTurn } from "../turns.ts";
import { comeToAtOpening } from "../rules/play.ts";
import { refreshPockets } from "../rules/session.ts";
import { rekeyOwed } from "../world/cross.ts";
import { applyStage, joinPlace, openPlace, placeWorldOf, savePlaceWorld, type Start } from "../world/place.ts";
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
 * game's first scene hands it out. A scene waiting (map-design §3.5, story-design §4.3: the lead, its
 * place built when it became the lead, with what the boundary handed on) opens in its row: its GM
 * bookkeeping and its place kept, the controller's character joining the place with what they carry,
 * and the names heard anywhere in the story so far heard here too. A fight's aftermath (story-design
 * §4.3) is this move's think and commit again, on a turn of its own (`aftermath`): the reply is that
 * turn's, and what the stage manager says it did goes through the gate.
 */
export const openScene: Move<{ game: bigint; sceneKey: string; start?: Start }, OpenPlan> = {
  name: "openScene",

  resolve(tx, actor, { game: gameId, sceneKey, start }) {
    const game = gameRow(tx, gameId);
    const def = sceneDefOf(tx, game, sceneKey);
    const controller = playerRow(tx, actor.id!);
    const waiting = waitingScene(tx, game.id, sceneKey);
    const handed = waiting ? getGm(tx, waiting.id) : initialGm(graphOf(def));
    const graph = graphOf(def, handed.patches);

    const opened = waiting ? openWaiting(tx, game, def, graph, handed, controller, start, waiting) : { scene: insertScene(tx, game, def, graph, handed, controller, start), gm: handed };
    const { scene, gm } = opened;
    putGm(tx, scene.id, gm);
    syncStage(tx, scene, graph, gm);
    if (waiting) noteHeardInStory(tx, scene, graph);
    else noteHeard(tx, scene, graph);
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
    const opening = writeReply(tx, scene, turnRow(tx, turnId).n, turnId, opened.entries);
    if (opening) askForNotes(tx, turnId, opening);
    suggestAfter(tx, scene, turnId);
    if (plan.aftermath) stageAftermath(tx, scene, turnRow(tx, turnId).n, opened);
    noteHeard(tx, scene, sceneGraph(tx, scene, gm));

    updateScene(tx, scene.id, { status: "live" });
    finishTurn(tx, scene.id, turnId);
    return { done: true };
  },
};

/** The scene's row, in its place (built now), with the controller and their character placed in both. */
function insertScene(tx: TxCtx, game: GameRow, def: SceneDefRow, graph: Scene, gm: GmState, controller: PlayerRow, start: Start | undefined): SceneRow {
  const place = openPlace(tx, game, placeKeyOf(tx, game, def), graph, gm, controller, start);
  refreshPockets(tx, controller.id, place.world);
  const scene = tx.db.scene.insert({
    id: 0n, gameId: game.id, sceneKey: def.key, title: def.title, hook: def.hook, kind: "scene", placeId: place.placeId,
    status: "opening", controllerId: controller.id, turnId: undefined, turns: 0, exitKey: undefined, rev: 0, openedAt: tx.now, endedAt: undefined,
    time: graph.time,
  });

  tx.db.place.id.update({ ...placeRow(tx, place.placeId), sceneId: scene.id });
  tx.db.player.id.update({ ...playerRow(tx, controller.id), characterId: place.characterId, placeId: place.placeId, sceneId: scene.id });
  return scene;
}

/**
 * A waiting scene's row, opening, in its place (built when it became the lead), the controller's
 * character joining it from where they were, with what they carry, and the controller placed in
 * both. Its bookkeeping is what the boundary handed on, the owed things it names re-keyed if they
 * came in with the player.
 */
function openWaiting(tx: TxCtx, game: GameRow, def: SceneDefRow, graph: Scene, gm: GmState, controller: PlayerRow, start: Start | undefined, waiting: SceneRow): { scene: SceneRow; gm: GmState } {
  const place = joinPlace(tx, game, placeKeyOf(tx, game, def), graph, gm, controller, start, waiting.placeId);
  refreshPockets(tx, controller.id, place.world);
  const scene = updateScene(tx, waiting.id, { status: "opening", controllerId: controller.id, openedAt: tx.now });

  tx.db.player.id.update({ ...playerRow(tx, controller.id), characterId: place.characterId, placeId: place.placeId, sceneId: scene.id });
  return { scene, gm: { ...gm, owed: rekeyOwed(gm.owed, place.renamed) } };
}

/** A game's scene of that key waiting to be opened (the lead), if there is one. */
export function waitingScene(tx: TxCtx, gameId: bigint, sceneKey: string): SceneRow | undefined {
  return [...tx.db.scene.gameId.filter(gameId)].find(s => s.sceneKey === sceneKey && s.status === "waiting");
}

/** The place a scene is played in: its own, or the campaign's start place. */
export function placeKeyOf(tx: TxCtx, game: GameRow, def: SceneDefRow): string {
  return sceneFileOf(def).place ?? campaignFile(campaignOfGame(tx, game)).startPlace;
}

/**
 * What the aftermath did to the world, as a turn's reply's is (engine.ts:1024-1035, stageAftermath):
 * the stage manager's operations through the gate (the player kept in the place), written back.
 */
function stageAftermath(tx: TxCtx, scene: SceneRow, n: number, opened: OpenResponse): void {
  const place = placeWorldOf(tx, scene);
  const graph = sceneGraph(tx, scene, getGm(tx, scene.id));
  const done = applyStage(place, opened.ops ?? [], n);
  savePlaceWorld(tx, scene, place, graph);
  refreshPockets(tx, scene.controllerId, place.world);
  syncStage(tx, scene, graph, getGm(tx, scene.id));
  tx.log(`[scene ${scene.id} turn ${n}] the aftermath staged: ${done.changes.length} changed, ${done.problems.length} not done`);
}

/** The scene's and its place's revs now: a plan's record of what it saw. */
export function seenOf(tx: TxCtx, sceneId: bigint): Seen {
  const scene = sceneRow(tx, sceneId);
  return { scene: scene.rev, place: placeRow(tx, scene.placeId).rev };
}
