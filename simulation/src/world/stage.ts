import type { GmState } from "../../../shared/gm/state.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import type { Character, Scene } from "../../../shared/scene/types.ts";
import type { TxCtx } from "../context.ts";
import { gameRow, playerRow, type SceneRow } from "../rows.ts";
import { campaignOfGame, looksOf } from "../scenes.ts";

/**
 * Who's on a scene's stage, as the clients see it: on_stage rows for the controller's character and
 * the cast present as the player has seen it (presentShown), each cast member's look from the
 * campaign. Called whenever who's present may have changed (the opening, a cue's entrance shown).
 * Someone not in the world yet has no entity, so no row until they join it.
 */
export function syncStage(tx: TxCtx, scene: SceneRow, graph: Scene, gm: GmState): void {
  // A talk has no stage of its own (no place, no world: town-design §3.6), and the companion's rows are the waiting scene's.
  if (scene.kind === "talk") return;
  const stage = stageOf(tx, scene, graph, gm);

  for (const row of [...tx.db.onStage.sceneId.filter(scene.id)]) {
    if (!stage.has(row.entityId)) tx.db.onStage.entityId.delete(row.entityId);
  }
  for (const [entityId, role] of stage) putOnStage(tx, scene, entityId, role);
  putLooks(tx, scene, graph, gm);
}

/** The stage: each entity on it, and its role there. */
function stageOf(tx: TxCtx, scene: SceneRow, graph: Scene, gm: GmState): Map<bigint, string> {
  const stage = new Map<bigint, string>();
  const character = playerRow(tx, scene.controllerId).characterId;
  if (character !== undefined) stage.set(character, "controller");
  for (const c of presentShown(graph, gm)) {
    const entity = castEntity(tx, scene, c.id);
    if (entity !== undefined) stage.set(entity, "cast");
  }
  return stage;
}

/**
 * The cast present as the player has seen it: shared presentCast (the AI service's own reading, by
 * which the next reply plays them arriving), but whoever the stage the co-GM has just moved to
 * brings on (twoPart.moved), until the reply that shows them arriving is written (QA round
 * qa3-1018: "Here:" listed the corporal, and the place drew him, a reply before the narration
 * brought him in).
 */
export function presentShown(graph: Scene, gm: GmState): Character[] {
  const arriving = gm.twoPart?.moved;
  return presentCast(graph, gm).filter(c => !arriving || c.enters !== arriving);
}

function putOnStage(tx: TxCtx, scene: SceneRow, entityId: bigint, role: string): void {
  const row = { entityId, sceneId: scene.id, role };
  const old = tx.db.onStage.entityId.find(entityId);
  if (!old) tx.db.onStage.insert(row);
  else if (old.sceneId !== row.sceneId || old.role !== row.role) tx.db.onStage.entityId.update(row);
}

/** Each cast member present, drawn as looks.json says (Kell is a blue K). */
function putLooks(tx: TxCtx, scene: SceneRow, graph: Scene, gm: GmState): void {
  const looks = looksOf(campaignOfGame(tx, gameRow(tx, scene.gameId)));
  for (const c of presentShown(graph, gm)) {
    const entityId = castEntity(tx, scene, c.id);
    const look = Object.prototype.hasOwnProperty.call(looks, c.id) ? looks[c.id] : undefined;
    if (entityId === undefined || !look) continue;
    const row = { entityId, placeId: scene.placeId, role: look.role, glyph: look.glyph, fg: look.fg, invention: undefined };
    const old = tx.db.look.entityId.find(entityId);
    if (!old) tx.db.look.insert(row);
    else if (old.placeId !== row.placeId || old.role !== row.role || old.glyph !== row.glyph || old.fg !== row.fg) tx.db.look.entityId.update(row);
  }
}

/** A cast member's entity in the game (their key is their cast id). */
function castEntity(tx: TxCtx, scene: SceneRow, castId: string): bigint | undefined {
  return [...tx.db.entity.byGameKey.filter([scene.gameId, castId])][0]?.id;
}
