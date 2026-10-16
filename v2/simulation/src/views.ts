import type { Infer, ViewCtx } from "spacetimedb/server";
import type { Schema } from "./context.ts";
import type { NameView, SeatView } from "./schema.ts";

/**
 * The views (v0-design §3.2), per caller: my_seat, the game and scene their seat is in, from which a
 * client subscribes to the rest; my_names, the cast on that scene's stage by the names its
 * controller has heard (a spectator knows them as the controller does).
 */

type Ctx = ViewCtx<Schema>;

/** my_creation and my_games (v1-design §3.2): package B's; stand-ins until then, both empty. */
export { myCreationView, myGamesView } from "./stubs.ts";

export function mySeatView(ctx: Ctx): Infer<typeof SeatView> | undefined {
  const player = seatedPlayer(ctx);
  if (!player) return undefined;
  return { playerId: player.id, gameId: player.gameId, placeId: player.placeId, sceneId: player.sceneId, role: player.role };
}

export function myNamesView(ctx: Ctx): Array<Infer<typeof NameView>> {
  const scene = seatedPlayer(ctx)?.sceneId;
  const sceneRow = scene === undefined ? undefined : ctx.db.scene.id.find(scene);
  if (!sceneRow) return [];

  const heard = new Set([...ctx.db.heard.playerId.filter(sceneRow.controllerId)].map(h => h.entityKey));
  const names: Array<Infer<typeof NameView>> = [];
  for (const onStage of ctx.db.onStage.sceneId.filter(sceneRow.id)) {
    const entity = onStage.role === "cast" ? ctx.db.entity.id.find(onStage.entityId) : undefined;
    if (entity) names.push({ entityId: entity.id, key: entity.key, name: heard.has(entity.key) ? entity.name : (entity.called ?? entity.name) });
  }
  return names;
}

function seatedPlayer(ctx: Ctx) {
  const seat = ctx.db.seat.identity.find(ctx.sender);
  return seat ? (ctx.db.player.id.find(seat.playerId) ?? undefined) : undefined;
}
