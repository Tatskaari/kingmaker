import type { Identity } from "spacetimedb";
import { andList, refusal } from "../../../shared/protocol/refusals.ts";
import { reachDiscoveries } from "../../../shared/scene/beats.ts";
import { isAdmin } from "../access.ts";
import { actorOf, Refused, type Actor, type TxCtx } from "../context.ts";
import { getGm, putGm } from "../gm/rows.ts";
import { moveNamed } from "../moves/registry.ts";
import { waitingScene } from "../moves/open-scene.ts";
import { endScene } from "../moves/say-commits.ts";
import { gameRow, playerRow, sceneRow, updateScene, updateTurn, type GameRow, type PlayerRow, type SceneRow } from "../rows.ts";
import { sceneGraph } from "../scenes.ts";
import { crossBoundary } from "./boundary.ts";
import { candidatesFrom, queueBoundary } from "./end.ts";
import { fightItOut } from "./fight.ts";
import { fightOnMap } from "../map/fight.ts";
import { openLead } from "../map/lead.ts";

/**
 * The story's moves between scenes (story-design §4.3), registered in index.ts and the memory host
 * with their arguments. `walk`'s arguments are the map unit's (map-design §3.2): `to` a tile,
 * `toward` "lead" (on a map, also a compass word, "out" or a place); with no map, only the lead,
 * straight into its waiting scene.
 */

/** walk where there's no map (map/moves.ts's walk hands it on): on to the lead, straight into its waiting scene (openLead). The game's host's (the scenes' controller). */
export function goOnReducer(tx: TxCtx, sender: Identity, args: { to?: { x: number; y: number } | undefined; toward?: string | undefined }): void {
  const { actor, player, game } = hostOf(tx, sender);
  if (game.status === "ended") throw new Refused(refusal("story_over"));
  const scene = player.sceneId === undefined ? undefined : tx.db.scene.id.find(player.sceneId);
  if (scene && scene.status !== "ended") throw new Refused(refusal("scene_on"));
  if (args.to !== undefined || args.toward !== "lead") throw new Refused(refusal("no_way"));
  if (!game.leadScene || !waitingScene(tx, game.id, game.leadScene)) throw new Refused(refusal("no_lead"));

  openLead(tx, actor, game);
  tx.log(`[story] game ${game.id}: on to ${game.leadScene}`);
}

/**
 * end_scene: the scene being played ends through an exit now, with no closing reply (the prototype's
 * forceEnding, engine.ts:1046-1053): the owner's, for testing (the QA console's end, the arc). A turn
 * whose reply is in (settling) or that failed is finished first, its own steps' job dropped; one the
 * GM is still answering refuses it. `thorough` (the GM loop's, a scene skipped for QA): every
 * discovery the scene can still reach is reached first, as a thorough player's game would have them
 * by its end, so the chapter has their facts and the story owes none of them on.
 */
export function endSceneReducer(tx: TxCtx, sender: Identity, args: { game: bigint; exit: string; thorough?: boolean | undefined }): void {
  if (!isAdmin(tx, sender)) throw new Refused(refusal("not_admin", { what: "end a scene for testing" }));
  const game = tx.db.game.id.find(args.game);
  if (!game) throw new Refused(refusal("unknown", { what: "game" }));
  const scene = sceneInPlay(tx, game);
  if (!scene) throw new Refused(refusal("no_scene"));

  const exits = sceneGraph(tx, scene, getGm(tx, scene.id)).exits;
  const exit = exits.find(e => e.id === args.exit);
  if (!exit) throw new Refused(refusal("no_exit", { exit: args.exit, exits: andList(exits.map(e => `${e.id} (${e.title})`)) }));
  letGo(tx, scene);
  if (args.thorough) reachAll(tx, scene);

  endScene(tx, scene.id, exit, sceneRow(tx, scene.id).turns, "forced");
}

/** A thorough end's discoveries (beats.ts reachDiscoveries), each through its route as the co-GM would take it: their facts settled, the carried ones landed, the stage where it was. */
function reachAll(tx: TxCtx, scene: SceneRow): void {
  const gm = getGm(tx, scene.id);
  const done = reachDiscoveries(sceneGraph(tx, scene, gm), gm, sceneRow(tx, scene.id).turns);
  putGm(tx, scene.id, done.gm);
  tx.log(`[end ${scene.sceneKey}] thorough: reached ${done.reached.join(", ") || "nothing more"}`);
}

/** carry_on: a boundary that failed, queued again (its key the same, so an answer the AI service kept is served). The game's host's. */
export function carryOnReducer(tx: TxCtx, sender: Identity, _args: Record<string, never> = {}): void {
  const { game } = hostOf(tx, sender);
  if (game.status === "ended") throw new Refused(refusal("story_over"));
  const stuck = game.onward === "failed" ? stuckChapter(tx, game) : undefined;
  if (!stuck) throw new Refused(refusal("not_stuck"));

  const scene = sceneRow(tx, stuck.sceneId);
  for (const job of [...tx.db.job.iter()].filter(j => j.move === crossBoundary.name && j.sceneId === scene.id)) tx.db.job.id.delete(job.id);
  queueBoundary(tx, game, scene, stuck.exitKey, candidatesFrom(tx, game, sceneGraph(tx, scene, getGm(tx, scene.id)), stuck.exitKey));
  tx.log(`[story] game ${game.id}: the boundary after ${scene.sceneKey} carried on`);
}

/**
 * fight_it_out: the fight's stand-in resolves it (src/game/fight-standin.ts), and the scene picks up
 * after it. The fighting scene's controller's; or, on the map, a fight that broke out there (the
 * explore row's: town-design §3.3), its host's.
 */
export function fightItOutReducer(tx: TxCtx, sender: Identity, _args: Record<string, never> = {}): void {
  const actor = actorOf(tx, sender);
  if (actor.id === undefined) throw new Refused(refusal("not_in_game"));
  const player = playerRow(tx, actor.id);
  if (player.sceneId === undefined && fightOnMap(tx, player)) return;
  const scene = sceneOfSeat(tx, player);
  if (!scene || scene.status !== "fighting") throw new Refused(refusal("no_fight"));
  if (scene.controllerId !== actor.id) throw new Refused(refusal("not_controller", { name: playerRow(tx, scene.controllerId).name }));

  fightItOut(tx, scene);
}

// ---------------------------------------------------------------------------------------------

/** The caller as their game's host: between scenes, the story's moves are its controller's. */
function hostOf(tx: TxCtx, sender: Identity): { actor: Actor; player: PlayerRow; game: GameRow } {
  const actor = actorOf(tx, sender);
  const player = actor.id === undefined ? undefined : tx.db.player.id.find(actor.id);
  if (!player) throw new Refused(refusal("not_in_game"));
  const game = gameRow(tx, player.gameId);
  if (game.hostId !== player.id) throw new Refused(refusal("not_controller", { name: playerRow(tx, game.hostId).name }));
  return { actor, player, game };
}

const sceneOfSeat = (tx: TxCtx, player: PlayerRow): SceneRow | undefined => (player.sceneId === undefined ? undefined : (tx.db.scene.id.find(player.sceneId) ?? undefined));

/** The game's scene being played (opening, live, closing, ending, or fighting), the latest. */
function sceneInPlay(tx: TxCtx, game: GameRow): SceneRow | undefined {
  return [...tx.db.scene.gameId.filter(game.id)].filter(s => IN_PLAY.has(s.status)).sort((a, b) => (a.id > b.id ? -1 : 1))[0];
}
const IN_PLAY = new Set(["opening", "live", "closing", "ending", "fighting"]);

/**
 * The turn holding the scene, let go of before a forced end: one whose reply is in (settling) or
 * that failed is done, its own steps' job dropped (its lines and the reviews after it still come);
 * one the GM is still deciding, considering or answering refuses it.
 */
function letGo(tx: TxCtx, scene: SceneRow): void {
  const turn = scene.turnId === undefined ? undefined : tx.db.turn.id.find(scene.turnId);
  if (!turn) return;
  if (!LET_GO.has(turn.phase)) throw new Refused(refusal("turn_in_flight"));
  for (const job of [...tx.db.job.iter()].filter(j => j.turnId === turn.id && !moveNamed(j.move).background)) tx.db.job.id.delete(job.id);
  updateTurn(tx, turn.id, { phase: "done", endedAt: tx.now, note: undefined });
  updateScene(tx, scene.id, { turnId: undefined });
}
const LET_GO = new Set(["settling", "failed"]);

/** The chapter whose boundary failed: the latest with no hand-off, its scene ended. */
function stuckChapter(tx: TxCtx, game: GameRow) {
  return [...tx.db.chapter.gameId.filter(game.id)].filter(c => c.summary === "" && tx.db.scene.id.find(c.sceneId)?.status === "ended").sort((a, b) => b.seq - a.seq)[0];
}
