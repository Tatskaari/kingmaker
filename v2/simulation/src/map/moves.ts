import type { Identity } from "spacetimedb";
import { leaveScene, type ExploreState } from "../../../shared/map/explore.ts";
import { actionId, OUT, type InteractArgs, type MapMove, type TravelArgs, type WalkArgs } from "../../../shared/map/moves.ts";
import { exploreOf, exploreRowOf, type MapRows } from "../../../shared/map/rows.ts";
import { act, Unavailable, type Done } from "../../../shared/map/town.ts";
import { refusal } from "../../../shared/protocol/refusals.ts";
import { inventory, InventoryError } from "../../../shared/world/inventory.ts";
import { actorOf, Refused, type Actor, type TxCtx } from "../context.ts";
import { getGm } from "../gm/rows.ts";
import { gameRow, playerRow, type GameRow, type PlayerRow, type SceneRow } from "../rows.ts";
import { refreshPockets } from "../rules/session.ts";
import { sceneGraph } from "../scenes.ts";
import { placeWorldOf, savePlaceWorld } from "../world/place.ts";
import { openLead } from "./lead.ts";
import { mapPlaceOf, mapRowsOf, moveSeats, walkerOf, writeExplore, type ExploreTableRow } from "./rows.ts";

/**
 * The map's moves (v2/docs/map-design.md §3.2): walk, interact and travel, each the controller's,
 * each made as the prototype's explorer makes its action of that id (shared/map/moves.ts maps the
 * arguments onto it): the ExploreState made from rows (shared/map/rows.ts exploreOf, as a client
 * makes it), the copied act, the explore row written back with what it said, the seats moved with
 * the map, a thing picked up moved into the character's hands, and a scene that opens opened by
 * openLead in the same transaction. `walk out` takes the walker from a scene that has ended back
 * onto its map (the prototype's core did it as the scene ended).
 */

export function walkReducer(tx: TxCtx, sender: Identity, args: WalkArgs): void {
  const actor = actorOf(tx, sender);
  if (args.toward === OUT) walkOut(tx, actor);
  else mapMove(tx, actor, { move: "walk", args });
}

export function interactReducer(tx: TxCtx, sender: Identity, args: InteractArgs): void {
  mapMove(tx, actorOf(tx, sender), { move: "interact", args });
}

export function travelReducer(tx: TxCtx, sender: Identity, args: TravelArgs): void {
  mapMove(tx, actorOf(tx, sender), { move: "travel", args });
}

/** A move on the map by the prototype's action id: refused, or made and its row written (a walker in a scene that has ended walks out of it first). */
function mapMove(tx: TxCtx, actor: Actor, move: MapMove): void {
  const started = tx.elapsedMs();
  const { game, scene, row } = walker(tx, actor);
  const id = actionId(move);
  if (!id) throw new Refused(refusal("unavailable"));
  const walking = scene ? leave(tx, game, scene, row) : row;

  const rows = mapRowsOf(tx, game, walking);
  const ex = exploreOf(rows);
  const done = acted(ex, rows, id);

  if (done.take) take(tx, game, done.take);
  if (done.scene) openLead(tx, actor, game, ex);
  else if (ex.map !== rows.explore.map) moveSeats(tx, game.id, mapPlaceOf(tx, game, ex.map).id, undefined);
  writeExplore(tx, exploreRowOf(ex, rows.explore, done.text));
  tx.log(`[map] game ${game.id} ${id} ${Math.round(tx.elapsedMs() - started)} ms${done.scene ? `: ${game.leadScene} opens` : ""}`);
}

/** walk out: from a scene that has ended, back onto its map, where it left the walker. */
function walkOut(tx: TxCtx, actor: Actor): void {
  const { game, scene, row } = walker(tx, actor);
  if (!scene) throw new Refused(refusal("unavailable"));
  leave(tx, game, scene, row);
}

/**
 * Who may move on the map: the game's host (its controller), seated in it, not in a scene still
 * being played (one that has ended they walk out of), and on a map. Their game, the scene they're
 * in, and their explore row.
 */
function walker(tx: TxCtx, actor: Actor): { game: GameRow; host: PlayerRow; scene?: SceneRow; row: ExploreTableRow } {
  const player = actor.id === undefined ? undefined : (tx.db.player.id.find(actor.id) ?? undefined);
  if (!player) throw new Refused(refusal("not_in_game"));
  const game = gameRow(tx, player.gameId);
  if (player.id !== game.hostId) throw new Refused(refusal("not_controller", { name: playerRow(tx, game.hostId).name }));
  const scene = player.sceneId === undefined ? undefined : (tx.db.scene.id.find(player.sceneId) ?? undefined);
  if (scene && scene.status !== "ended") throw new Refused(refusal("scene_on"));
  const row = walkerOf(tx, game);
  if (!row) throw new Refused(refusal("no_way"));
  return { game, host: player, ...(scene ? { scene } : {}), row };
}

/** The copied act, an id it doesn't offer from here refused; anything else it throws is a bug. */
function acted(ex: ExploreState, rows: MapRows, id: string): Done {
  try {
    return act(ex, rows.unheard, id);
  } catch (e) {
    if (e instanceof Unavailable) throw new Refused(refusal("unavailable"));
    throw e;
  }
}

/**
 * Out of a scene that has ended, back onto its map (the prototype's town.leaveScene and
 * afterScene): where the scene's world left the walker (or outside the place, when they can't walk
 * out from there), whoever walks with them beside them, the scene's place kept as it was left (the
 * map draws it from its rows), what was said before the scene old news; every seat back on the
 * map. The explore row as it's left.
 */
function leave(tx: TxCtx, game: GameRow, scene: SceneRow, row: ExploreTableRow): ExploreTableRow {
  const rows = mapRowsOf(tx, game, row);
  const ex = exploreOf(rows);
  ex.scene = scene.sceneKey;
  leaveScene(ex, placeWorldOf(tx, scene).world);

  writeExplore(tx, { ...exploreRowOf(ex, rows.explore, ""), log: [] });
  moveSeats(tx, game.id, mapPlaceOf(tx, game, ex.map).id, undefined);
  return walkerOf(tx, game)!;
}

/**
 * take_<x>: something a played scene left lying about, picked up: into the character's hands in
 * that place's world (the character stays in the last scene's place until the next opens: V3), a
 * stack joining a like one (the world's own inventory), and the sheet's pockets with it.
 */
function take(tx: TxCtx, game: GameRow, thing: NonNullable<Done["take"]>): void {
  const scene = [...tx.db.scene.gameId.filter(game.id)].find(s => s.sceneKey === thing.sceneId);
  if (!scene) throw new Refused(refusal("unavailable"));
  const place = placeWorldOf(tx, scene);
  try {
    inventory(place.world, scene.turns).settle(thing.id, "player");
  } catch (e) {
    if (e instanceof InventoryError) throw new Refused(refusal("unavailable"));
    throw e;
  }
  savePlaceWorld(tx, scene, place, sceneGraph(tx, scene, getGm(tx, scene.id)));
  refreshPockets(tx, scene.controllerId, place.world);
}
