// closeScene is the prototype's src/runtime/engine.ts:981-996 at 44c6d4a (finishScene) and the game's flow after it (src/game/play.ts:425-440 afterScene, :510-516 onward's end), as rows: the recording world becomes the effects interpreter (story/effects.ts), afterwards is applied to the place's rows, the history entry is a chapter row (its hand-off the boundary's), and chainScene runs as a job (story/boundary.ts). dispelConjured is the world bridge's.

import type { GmState } from "../../../shared/gm/state.ts";
import { idText } from "../../../shared/protocol/keys.ts";
import { candidatesOf } from "../../../shared/scene/graph.ts";
import type { Exit, Scene } from "../../../shared/scene/types.ts";
import { applyOps, type WorldOp } from "../../../shared/world/scene-world.ts";
import type { TxCtx } from "../context.ts";
import { getGm, putGm } from "../gm/rows.ts";
import { queueThink } from "../jobs.ts";
import { gameRow, playerRow, sceneRow, updateScene, type GameRow, type SceneRow } from "../rows.ts";
import { gameCampaignId, graphOf, sceneDefOf, sceneFileOf } from "../scenes.ts";
import { entriesOf } from "../transcript.ts";
import { placeWorldOf, savePlaceWorld } from "../world/place.ts";
import { syncStage } from "../world/stage.ts";
import { crossBoundary } from "./boundary.ts";
import { applyEffects, recordAll, type Ending } from "./effects.ts";

/**
 * The end of a scene (story-design §4.3), once V0's end is written (moves/say-commits.ts endScene:
 * the "Scene ends" entry, `ended`, a line still waiting cancelled), whichever way it came: played to
 * an ending, or forced by the owner's end_scene. A combat exit's fight is next, in the same scene: it
 * goes `fighting`, its effects recorded, and nothing more until the fight's stand-in picks it up.
 * Otherwise the scene is a chapter of the story: its row (the hand-off to come); the scene's onEnd
 * and the exit's effects; what happens to the place offstage once it's over (afterwards); then the
 * story goes on, the boundary queued to cross to the scenes it could go to, or, with none, it's over:
 * The End.
 */
export function closeScene(tx: TxCtx, scene: SceneRow, exit: Exit, how: "played" | "forced"): void {
  const game = gameRow(tx, scene.gameId);
  const def = sceneDefOf(tx, game, scene.sceneKey);
  const gm = endedOn(tx, scene, exit);
  const at: Ending = { scene, graph: graphOf(def, gm.patches), file: sceneFileOf(def), gm };
  const label = `[end ${scene.sceneKey} ${exit.id}] ${how}`;

  if (exit.kind === "combat") {
    updateScene(tx, scene.id, { status: "fighting", endedAt: undefined });
    const recorded = recordAll(at, exit.effects ?? []);
    tx.log(`${label}: a fight${recorded.length ? ` · recorded: ${recorded.join("; ")}` : ""}`);
    return;
  }

  addChapter(tx, game, scene, at.graph, exit);
  const done = applyEffects(tx, at, [...(at.graph.onEnd ?? []), ...(exit.effects ?? [])]);
  const afterwards = applyAfterwards(tx, sceneRow(tx, scene.id), at.graph);
  tx.log(`${label}: applied: ${done.applied.join("; ") || "nothing"} · recorded: ${done.recorded.join("; ") || "nothing"}${afterwards}`);

  goOn(tx, game, sceneRow(tx, scene.id), at.graph, exit);
}

/** The bookkeeping says how the scene ended (finishScene's state.ended), however it came to: the wind-down's reply and the owner's end don't set it. */
function endedOn(tx: TxCtx, scene: SceneRow, exit: Exit): GmState {
  const gm = getGm(tx, scene.id);
  if (gm.ended?.exitId === exit.id) return gm;
  const ended = { ...gm, ended: { exitId: exit.id, turn: scene.turns } };
  putGm(tx, scene.id, ended);
  return ended;
}

/**
 * The scene as a chapter of the story (the prototype's history entry, engine.ts:1080): numbered on,
 * its ending, the facts settled in it, and its last moments as engine.ts:1078-1079 words them; the
 * hand-off, what moved in the fronts and what was skipped are the boundary's to write.
 */
function addChapter(tx: TxCtx, game: GameRow, scene: SceneRow, graph: Scene, exit: Exit): void {
  const seq = Math.max(0, ...[...tx.db.chapter.gameId.filter(game.id)].map(c => c.seq)) + 1;
  const row = {
    sceneId: scene.id, gameId: game.id, seq, sceneKey: scene.sceneKey, title: scene.title, exitKey: exit.id, ending: exit.title,
    summary: "", lastMoments: lastMoments(tx, scene, graph), facts: [...getGm(tx, scene.id).established], fronts: [], skipped: [],
    calls: 0, costMicros: 0n, at: tx.now,
  };
  if (tx.db.chapter.sceneId.find(scene.id)) tx.db.chapter.sceneId.update(row);
  else tx.db.chapter.insert(row);
}

/** The scene's last four moments that aren't the system's, as the prototype words them (engine.ts:1078-1079). */
export function lastMoments(tx: TxCtx, scene: SceneRow, graph: Scene): string[] {
  const player = playerRow(tx, scene.controllerId).name;
  return entriesOf(tx, scene.id).filter(e => e.kind !== "system").slice(-4)
    .map(e => (e.kind === "player" ? `${player} (player): ${e.text}` : e.kind === "dialogue" ? `${graph.cast.find(c => c.id === e.speaker)?.name ?? e.speaker}: ${e.text}` : e.text));
}

/**
 * What happens to the place offstage once the scene is over (engine.ts:988-991): its operations on
 * the place's world, by the rules (Prout's body taken away), written back. Not after a fight's exit:
 * the fight comes first. What couldn't be done is in the log line it returns.
 */
function applyAfterwards(tx: TxCtx, scene: SceneRow, graph: Scene): string {
  if (!graph.afterwards?.length) return "";
  const place = placeWorldOf(tx, scene);
  const ops = graph.afterwards.map((o): WorldOp => ({ to: "", how: "", name: "", kind: "", text: "", add: [], remove: [], ...o }));
  const done = applyOps(place.world, ops, scene.turns, "rules");
  savePlaceWorld(tx, scene, place, graph);
  syncStage(tx, scene, graph, getGm(tx, scene.id));
  return ` · afterwards: ${done.changes.length} changed${done.problems.length ? `, not done: ${done.problems.join("; ")}` : ""}`;
}

/**
 * The story goes on (play.ts:510-516): to the scenes it could go to after this ending (candidatesOf,
 * engine.ts:1061-1069), the boundary queued now, so its request has the scene as it ended; or, when
 * the ending goes nowhere, the story is over (The End), and no lead is left.
 */
function goOn(tx: TxCtx, game: GameRow, scene: SceneRow, graph: Scene, exit: Exit): void {
  const candidates = candidatesFrom(tx, game, graph, exit.id);

  if (!candidates.length) {
    tx.db.game.id.update({ ...gameRow(tx, game.id), status: "ended", leadScene: undefined, leadText: undefined, onward: undefined, onwardNote: undefined });
    tx.log(`[story] game ${game.id}: The End (${scene.sceneKey} ended: ${exit.title})`);
    return;
  }
  queueBoundary(tx, game, scene, exit.id, candidates);
}

/** The scenes the story could go to after a scene's ending, in order (candidatesOf over the game's campaign: interludes skipped, then where each overtaken one goes). */
export function candidatesFrom(tx: TxCtx, game: GameRow, graph: Scene, exitId: string): string[] {
  return candidatesOf(graph, exitId, key => {
    const def = tx.db.sceneDef.id.find(`${gameCampaignId(game)}/${key}`);
    return def ? graphOf(def) : undefined;
  });
}

/** The boundary's think queued, its request built from the scene as it ended, and the way on moving. */
export function queueBoundary(tx: TxCtx, game: GameRow, scene: SceneRow, exitId: string, candidates: string[]): void {
  tx.db.game.id.update({ ...gameRow(tx, game.id), onward: "moving", onwardNote: undefined });
  queueThink(tx, crossBoundary, { step: "boundary", game: idText(game.id), scene: idText(scene.id), n: scene.turns, exit: exitId, candidates });
}
