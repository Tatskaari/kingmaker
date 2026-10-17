// buildLead and openLead are the map unit's (claude/v2-map's map/start.ts and map/lead.ts, the same names and signatures; openLead takes no walking state here): buildLead also takes what the boundary handed on, so the lead's place has the cast present but the absent, with what's owed that they hold; openLead goes straight in where there's no map.

import { initialGm, type GmState } from "../../../shared/gm/state.ts";
import { runMove, type Actor, type TxCtx } from "../context.ts";
import { startOf } from "../games/create.ts";
import { putGm } from "../gm/rows.ts";
import { openScene, placeKeyOf, waitingScene } from "../moves/open-scene.ts";
import { placeRow, playerRow, sceneRow, type GameRow, type SceneRow } from "../rows.ts";
import { campaignOfGame, graphOf, sceneDefOf } from "../scenes.ts";
import { noteHeard } from "../transcript.ts";
import { moveSeats, rekeyOwed } from "../world/cross.ts";
import { waitingPlace } from "../world/place.ts";

/**
 * The lead's place built and its scene waiting (map-design §3.3; story-design §4.3, the boundary's
 * commit): the place from its file with the cast present at the scene's start and no one playing in
 * it yet (the absent left out; those of the cast already in the game moved in, with what the story
 * still owes the player that they hold); the scene's row `waiting`, at its time of day, with its GM
 * bookkeeping as it starts and what was handed on (`handed`: the adjustments, the opening rewritten,
 * the lead, who's absent, what's owed; none, as the map's first lead has none), in that place. The
 * names the hook has given are heard. openLead opens it.
 */
export function buildLead(tx: TxCtx, game: GameRow, sceneKey: string, handed?: GmState): SceneRow {
  const def = sceneDefOf(tx, game, sceneKey);
  const gm = handed ?? initialGm(graphOf(def));
  const graph = graphOf(def, gm.patches);
  const host = playerRow(tx, game.hostId);

  const { placeId, renamed, owed } = waitingPlace(tx, game, placeKeyOf(tx, game, def), graph, gm, host);
  const scene = tx.db.scene.insert({
    id: 0n, gameId: game.id, sceneKey: def.key, title: def.title, hook: def.hook, kind: "scene", placeId,
    status: "waiting", controllerId: host.id, turnId: undefined, turns: 0, exitKey: undefined, rev: 0, openedAt: tx.now, endedAt: undefined,
    time: graph.time,
  });
  putGm(tx, scene.id, { ...gm, owed: rekeyOwed(gm.owed, renamed) });
  noteHeard(tx, scene, graph);
  tx.db.place.id.update({ ...placeRow(tx, placeId), sceneId: scene.id });
  if (owed.length) tx.log(`[story] ${sceneKey} waits with what's owed: ${owed.join(", ")}`);
  return scene;
}

/**
 * The one way into a scene (map-design §3.5): the lead's waiting scene (game.leadScene) opened
 * through V0's openScene, with what the character starts with on the game's first scene, and every
 * seat of the game moved into it. Go on calls it (walk toward the lead where there's no map), and so
 * does a summons, from the boundary's commit; the map unit's walk calls it too, with the state it
 * walked.
 */
export function openLead(tx: TxCtx, actor: Actor, game: GameRow): void {
  const sceneKey = game.leadScene;
  if (!sceneKey) throw new Error(`game ${game.id} has no lead to open`);
  const first = [...tx.db.scene.gameId.filter(game.id)].every(s => s.status === "waiting");
  const waiting = waitingScene(tx, game.id, sceneKey);

  runMove(tx, openScene, actor, { game: game.id, sceneKey, ...(first ? { start: startOf(tx, campaignOfGame(tx, game), actor.id!) } : {}) });

  const scene = sceneRow(tx, waiting?.id ?? openedScene(tx, game, sceneKey));
  moveSeats(tx, game.id, scene.placeId, scene.id);
}

/** The scene just opened, when it wasn't waiting (V0's insert): the newest of that key. */
function openedScene(tx: TxCtx, game: GameRow, sceneKey: string): bigint {
  const scene = [...tx.db.scene.gameId.filter(game.id)].filter(s => s.sceneKey === sceneKey).sort((a, b) => (a.id > b.id ? -1 : 1))[0];
  if (!scene) throw new Error(`game ${game.id}'s scene ${sceneKey} didn't open`);
  return scene.id;
}
