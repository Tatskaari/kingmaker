import type { Infer, ViewCtx } from "spacetimedb/server";
import { campaignId, type CampaignFile } from "../../shared/scene/files.ts";
import type { Schema } from "./context.ts";
import type { creation, GameSummary, NameView, SeatView } from "./schema.ts";

/**
 * The views (v0-design §3.2, v1-design §3.2), per caller: my_seat, the game and scene their seat is
 * in, from which a client subscribes to the rest; my_names, the cast on that scene's stage by the
 * names its controller has heard (a spectator knows them as the controller does); my_creation, the
 * character they're making; my_games, the games they host, as the title lists them.
 */

type Ctx = ViewCtx<Schema>;
type Summary = Infer<typeof GameSummary>;

export function myCreationView(ctx: Ctx): Infer<typeof creation.rowType> | undefined {
  return ctx.db.creation.identity.find(ctx.sender) ?? undefined;
}

/**
 * The caller's games, newest first: each one they host that's still being played, with the
 * character's name, the time of day, where the story is (the latest scene, or the first before
 * `begin`) and that scene's hook.
 */
export function myGamesView(ctx: Ctx): Summary[] {
  const games: Summary[] = [];
  for (const player of ctx.db.player.identity.filter(ctx.sender)) {
    const game = player.role === "host" ? ctx.db.game.id.find(player.gameId) : undefined;
    if (game?.status !== "playing") continue;
    const at = whereOf(ctx, game);
    if (at) games.push({ gameId: game.id, name: player.name, time: game.time, ...at, lastPlayedAt: player.lastPlayedAt });
  }
  return games.sort((a, b) => (a.lastPlayedAt.microsSinceUnixEpoch > b.lastPlayedAt.microsSinceUnixEpoch ? -1 : 1));
}

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

type Game = NonNullable<ReturnType<Ctx["db"]["game"]["id"]["find"]>>;

/** Where a game's story is: in its latest scene ("in …", or "…, over" once it's ended), or, before it has one, heading for its first. */
function whereOf(ctx: Ctx, game: Game): Pick<Summary, "where" | "hook" | "begun"> | undefined {
  const latest = [...ctx.db.scene.gameId.filter(game.id)].sort((a, b) => (a.id > b.id ? -1 : 1))[0];
  if (latest) return { where: latest.status === "ended" ? `${latest.title}, over` : `in ${latest.title}`, hook: latest.hook, begun: true };

  const id = campaignId({ id: game.campaign, version: game.campaignVersion });
  const campaign = ctx.db.campaign.id.find(id);
  const first = campaign ? ctx.db.sceneDef.id.find(`${id}/${(JSON.parse(campaign.json) as CampaignFile).firstScene}`) : undefined;
  return first ? { where: `heading for ${first.title}`, hook: first.hook, begun: false } : undefined;
}
