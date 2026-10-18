import { initialGm, type GmState } from "../../../shared/gm/state.ts";
import type { OpenResponse, TalkPrep } from "../../../shared/protocol/ai.ts";
import { idOf, idText, playerSpeaker } from "../../../shared/protocol/keys.ts";
import type { Mechanic } from "../../../shared/rules/types.ts";
import type { Scene } from "../../../shared/scene/types.ts";
import type { TxCtx } from "../context.ts";
import { openCall } from "../gm/requests.ts";
import { getGm, putGm } from "../gm/rows.ts";
import { gameRow, placeRow, playerRow, sceneRow, turnRow, updateScene, updateTurn, type GameRow, type PlayerRow, type SceneDefRow, type SceneRow } from "../rows.ts";
import { campaignFile, campaignOfGame, graphOf, sceneDefOf, documentOf, sceneGraph } from "../scenes.ts";
import { addEntry, noteHeard, noteHeardInStory, writeReply } from "../transcript.ts";
import { finishTurn, newTurn } from "../turns.ts";
import { talkLines } from "../map/talk.ts";
import { betweenScenes } from "../rules/play.ts";
import { refreshPockets } from "../rules/session.ts";
import { rekeyOwed } from "../world/cross.ts";
import { applyStage, joinPlace, openPlace, placeWorldOf, savePlaceWorld, type Start } from "../world/place.ts";
import { syncStage } from "../world/stage.ts";
import type { Move } from "./move.ts";
import type { OpenPlan, Seen } from "./plans.ts";
import { suggestAfter } from "./suggest.ts";
import { keysIn, lookForNew } from "./looks.ts";
import { openingRolesFor, writeSpoken } from "./two-part.ts";

/**
 * A scene opens (v0-design §4.3, v1-design §3.6): its place built, the scene row and its GM
 * bookkeeping, who's on stage, the time between scenes for the controller's character (a spell runs
 * out, they come to if they were down: the rules engine's first draw of the scene; a milestone's
 * level, the scene's rest: world-bridge-design §3.4), turn 0 holding the lease; then one think, the
 * opening, streamed into turn 0's draft and committed as the transcript's first entry, and the scene
 * goes live (its first lines asked for: v5-design §3.5). `start` is what the character
 * starts the game with: only the game's first scene hands it out. A scene waiting (map-design §3.5,
 * story-design §4.3: the lead, its place built when it became the lead, on the map where there is
 * one, with what the boundary handed on) opens in its row: its GM bookkeeping and its place kept,
 * the controller's character joining the place with what they carry, and the names heard anywhere in
 * the story so far heard here too. A fight's aftermath (story-design §4.3) is this move's think and
 * commit again, on a turn of its own (`aftermath`): the reply is that turn's, and what the stage
 * manager says it did goes through the gate.
 */
export const openScene: Move<{ game: bigint; sceneKey: string; start?: Start; act?: { text: string; mechanic: Mechanic } }, OpenPlan> = {
  name: "openScene",

  resolve(tx, actor, { game: gameId, sceneKey, start, act }) {
    const game = gameRow(tx, gameId);
    const def = sceneDefOf(tx, game, sceneKey);
    const controller = playerRow(tx, actor.id!);
    const waiting = waitingScene(tx, game.id, sceneKey);
    const gm = waiting ? getGm(tx, waiting.id) : initialGm(graphOf(def));
    const graph = graphOf(def, gm.patches);

    const scene = waiting ? openWaiting(tx, game, def, graph, gm, controller, start, waiting) : insertScene(tx, game, def, graph, gm, controller, start);
    // The two-part GM's roles as the scene opens (note -1), from who's present now: the opening reads them.
    openingRolesFor(graph, gm);
    putGm(tx, scene.id, waiting ? { ...getGm(tx, scene.id), twoPart: gm.twoPart } : gm);
    syncStage(tx, scene, graph, gm);
    if (waiting) noteHeardInStory(tx, scene, graph);
    else noteHeard(tx, scene, graph);
    betweenScenes(tx, scene, graph);

    const turn = newTurn(tx, scene, controller.id, 0, "replying");
    updateScene(tx, scene.id, { turnId: turn.id });
    return { done: false, plan: { step: "open", game: idText(game.id), scene: idText(scene.id), turn: idText(turn.id), seen: seenOf(tx, scene.id), ...(act ? { act } : {}) } };
  },

  think: (tx, plan) => openCall(tx, plan),

  /**
   * The opening as the transcript's first entry (the two-part GM's with its check rolled; an
   * aftermath's as it was narrated), a talk's prep kept; the first lines to suggest asked for
   * (engine.ts:211-212); the scene live, and turn 0 finished.
   */
  commit(tx, plan, answer) {
    const opened = answer as OpenResponse;
    const scene = sceneRow(tx, idOf(plan.scene));
    const gm = getGm(tx, scene.id);
    const turnId = idOf(plan.turn);
    const talk = scene.kind === "talk";

    if (talk && opened.talk) putGm(tx, scene.id, { ...gm, ...prepared(gm, opened.talk) });
    // The two-part GM's opening: what its mouthpiece said, and a check it called, rolled (docs/two-part-design.md).
    if (!plan.aftermath) writeSpoken(tx, scene, turnRow(tx, turnId).n, turnId, opened.entries, opened.check);
    else writeReply(tx, scene, turnRow(tx, turnId).n, turnId, opened.entries);
    // A talk's lines to choose come with its prep (talk.ts prepare); a scene's are asked for (v5-design §3.5).
    if (talk) { if (playerRow(tx, scene.controllerId).suggestions) talkLines(tx, scene, turnRow(tx, turnId).n, opened.talk?.suggestions ?? []); }
    else suggestAfter(tx, scene, turnId);
    if (plan.aftermath) stageAftermath(tx, scene, turnRow(tx, turnId).n, turnId, opened);
    noteHeard(tx, scene, sceneGraph(tx, scene, gm));
    // The map's act that opened it is its first turn (play.ts:256: said after the opening): queued now, started as turn 0 finishes.
    if (plan.act) queueAct(tx, sceneRow(tx, scene.id), plan.act);

    updateScene(tx, scene.id, { status: "live" });
    finishTurn(tx, scene.id, turnId);
    return { done: true };
  },
};

/**
 * A talk's prep kept (talk.ts prepare): what the talk's GM takes as given, the one thing the companion
 * might tell (on their card, and the talk's discovery filled with it: the prep's patches), and what
 * they'd tell.
 */
function prepared(gm: GmState, prep: TalkPrep): Partial<GmState> {
  return {
    established: [...gm.established, ...prep.established.filter(f => !gm.established.includes(f))],
    patches: [...gm.patches, ...prep.patches],
    ...(gm.talk && prep.confide ? { talk: { ...gm.talk, confide: prep.confide } } : {}),
  };
}

/**
 * The map's act as the scene's first turn (town-design §3.4: storyAct's): the player's line in
 * brackets, and its mechanic, chosen already, on the turn (turn.mechanic, which the turn's start resolves). It
 * waits as queued; turn 0's end starts it (turns.ts).
 */
function queueAct(tx: TxCtx, scene: SceneRow, act: { text: string; mechanic: Mechanic }): void {
  const n = scene.turns + 1;
  const turn = newTurn(tx, scene, scene.controllerId, n, "queued");
  updateTurn(tx, turn.id, { mechanic: JSON.stringify(act.mechanic) });
  addEntry(tx, scene, { turn: n, speaker: playerSpeaker(scene.controllerId), kind: "player", text: act.text });
  updateScene(tx, scene.id, { turns: n });
  tx.log(`[scene ${scene.id}] the map's act queued as turn ${n}: ${act.text}`);
}

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
function openWaiting(tx: TxCtx, game: GameRow, def: SceneDefRow, graph: Scene, gm: GmState, controller: PlayerRow, start: Start | undefined, waiting: SceneRow): SceneRow {
  const place = joinPlace(tx, game, placeKeyOf(tx, game, def), graph, gm, controller, start, waiting.placeId);
  refreshPockets(tx, controller.id, place.world);
  const scene = updateScene(tx, waiting.id, { status: "opening", controllerId: controller.id, openedAt: tx.now });
  if (place.renamed.size) putGm(tx, scene.id, { ...gm, owed: rekeyOwed(gm.owed, place.renamed) });

  tx.db.player.id.update({ ...playerRow(tx, controller.id), characterId: place.characterId, placeId: place.placeId, sceneId: scene.id });
  return scene;
}

/** A game's scene of that key waiting to be opened (the lead, on the map where there is one), if there is one. */
export function waitingScene(tx: TxCtx, gameId: bigint, sceneKey: string): SceneRow | undefined {
  return [...tx.db.scene.gameId.filter(gameId)].find(s => s.sceneKey === sceneKey && s.status === "waiting");
}

/** The place a scene is played in: its own, or the campaign's start place. */
export function placeKeyOf(tx: TxCtx, game: GameRow, def: SceneDefRow): string {
  return documentOf(def).place ?? campaignFile(campaignOfGame(tx, game)).startPlace;
}

/**
 * What the aftermath did to the world, as a turn's reply's is (engine.ts:1024-1035, stageAftermath):
 * the stage manager's operations through the gate (the player kept in the place), written back.
 */
function stageAftermath(tx: TxCtx, scene: SceneRow, n: number, turnId: bigint, opened: OpenResponse): void {
  const place = placeWorldOf(tx, scene);
  const graph = sceneGraph(tx, scene, getGm(tx, scene.id));
  const keys = keysIn(tx, scene.placeId);
  const done = applyStage(place, opened.ops ?? [], n);
  savePlaceWorld(tx, scene, place, graph);
  refreshPockets(tx, scene.controllerId, place.world);
  syncStage(tx, scene, graph, getGm(tx, scene.id));
  lookForNew(tx, scene, n, turnId, keys);
  tx.log(`[scene ${scene.id} turn ${n}] the aftermath staged: ${done.changes.length} changed, ${done.problems.length} not done`);
}

/** The scene's and its place's revs now: a plan's record of what it saw. */
export function seenOf(tx: TxCtx, sceneId: bigint): Seen {
  const scene = sceneRow(tx, sceneId);
  return { scene: scene.rev, place: placeRow(tx, scene.placeId).rev };
}
