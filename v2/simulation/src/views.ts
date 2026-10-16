import type { Infer, ViewCtx } from "spacetimedb/server";
import { campaignId, type CampaignFile } from "../../shared/scene/files.ts";
import type { Schema } from "./context.ts";
import type { creation, GameSummary, NameView, SeatView } from "./schema.ts";

/**
 * The views (v0-design §3.2, v1-design §3.2, map-design §3.3), per caller: my_seat, the game and
 * scene their seat is in, from which a client subscribes to the rest; my_names, the cast on that
 * scene's stage, or, on the map, the people in the places on it, by the names the scene's controller
 * (the game's host) has heard (a spectator knows them as the controller does); my_creation, the
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
  const player = seatedPlayer(ctx);
  const scene = player?.sceneId;
  const sceneRow = scene === undefined ? undefined : ctx.db.scene.id.find(scene);
  if (!sceneRow) return player ? namesOnMap(ctx, player) : [];

  const heard = heardBy(ctx, sceneRow.controllerId);
  const names: Array<Infer<typeof NameView>> = [];
  for (const onStage of ctx.db.onStage.sceneId.filter(sceneRow.id)) {
    const entity = onStage.role === "cast" ? ctx.db.entity.id.find(onStage.entityId) : undefined;
    if (entity) names.push(nameOf(entity, heard));
  }
  return names;
}

type Player = NonNullable<ReturnType<typeof seatedPlayer>>;
type Entity = NonNullable<ReturnType<Ctx["db"]["entity"]["id"]["find"]>>;

/** Between scenes, the people in the places on the seat's map (the lead's, waiting there), as the host knows them. */
function namesOnMap(ctx: Ctx, player: Player): Array<Infer<typeof NameView>> {
  const here = player.placeId === undefined ? undefined : ctx.db.place.id.find(player.placeId);
  const game = ctx.db.game.id.find(player.gameId);
  if (!here?.mapKey || !game) return [];

  const heard = heardBy(ctx, game.hostId);
  const names: Array<Infer<typeof NameView>> = [];
  for (const place of ctx.db.place.gameId.filter(player.gameId)) {
    if (place.id === here.id || place.mapKey !== here.mapKey || !place.active) continue;
    for (const entity of ctx.db.entity.placeId.filter(place.id)) {
      if ((entity.kind === "person" || entity.kind === "creature") && !ctx.db.playerCharacter.entityId.find(entity.id)) names.push(nameOf(entity, heard));
    }
  }
  return names;
}

const heardBy = (ctx: Ctx, playerId: bigint) => new Set([...ctx.db.heard.playerId.filter(playerId)].map(h => h.entityKey));

/** Someone by the name the controller knows them by: theirs once it's been heard, what they look like until then. */
const nameOf = (entity: Entity, heard: Set<string>): Infer<typeof NameView> => ({ entityId: entity.id, key: entity.key, name: heard.has(entity.key) ? entity.name : (entity.called ?? entity.name) });

function seatedPlayer(ctx: Ctx) {
  const seat = ctx.db.seat.identity.find(ctx.sender);
  return seat ? (ctx.db.player.id.find(seat.playerId) ?? undefined) : undefined;
}

type Game = NonNullable<ReturnType<Ctx["db"]["game"]["id"]["find"]>>;

/** Where a game's story is: in its latest scene ("in …", "…, over" once it's ended, "heading for …" while it waits on the map), or, before it has one, heading for its first. */
function whereOf(ctx: Ctx, game: Game): Pick<Summary, "where" | "hook" | "begun"> | undefined {
  const latest = [...ctx.db.scene.gameId.filter(game.id)].sort((a, b) => (a.id > b.id ? -1 : 1))[0];
  if (latest) return { where: latest.status === "ended" ? `${latest.title}, over` : latest.status === "waiting" ? `heading for ${latest.title}` : `in ${latest.title}`, hook: latest.hook, begun: true };

  const id = campaignId({ id: game.campaign, version: game.campaignVersion });
  const campaign = ctx.db.campaign.id.find(id);
  const first = campaign ? ctx.db.sceneDef.id.find(`${id}/${(JSON.parse(campaign.json) as CampaignFile).firstScene}`) : undefined;
  return first ? { where: `heading for ${first.title}`, hook: first.hook, begun: false } : undefined;
}
