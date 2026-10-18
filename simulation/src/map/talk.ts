// startTalk, leaveTalk and endTalk are the prototype's src/runtime/talk.ts:57-73, 405-446 at 44c6d4a as rows: the talk is a scene of its own (a row of kind talk, its own gm_state), so the scene the story is heading for is never set aside, nor put back: nothing touches it. The facts the talk's GM takes as given, its prep and its words are the AI service's (the open's TalkPrep); the told memory is its too. Since the old pipeline's salvage (docs/migration-log.md) a talk plays on the two-part GM's steps: it opens with the companion's role (the template's start's, note -1) and its open asks the two-part GM, and it's told once its discovery is reached.
import type { ExploreState } from "../../../shared/map/explore.ts";
import { initialGm, type GmState } from "../../../shared/gm/state.ts";
import { idText } from "../../../shared/protocol/keys.ts";
import { refusal } from "../../../shared/protocol/refusals.ts";
import type { Mechanic } from "../../../shared/rules/types.ts";
import { CONFIDED, talkSceneId, TOLD } from "../../../shared/scene/talk.ts";
import { Refused, type Actor, type TxCtx } from "../context.ts";
import { getGm, putGm } from "../gm/rows.ts";
import { queueThink } from "../jobs.ts";
import { openScene, seenOf } from "../moves/open-scene.ts";
import { openingRolesFor } from "../moves/two-part.ts";
import { gameRow, playerRow, sceneRow, turnRow, updateScene, updateTurn, type GameRow, type RowOf, type SceneRow } from "../rows.ts";
import { campaignFile, campaignOfGame, graphOf, sceneDefOf } from "../scenes.ts";
import { addEntry, noteHeard } from "../transcript.ts";
import { newTurn } from "../turns.ts";
import { exploreRowFrom, mapPlaceOf, moveSeats, walkerOf, writeExplore, type ExploreTableRow } from "./rows.ts";
import { keepTicking } from "./tick.ts";

/**
 * A word with someone walking with the player, between scenes (docs/town-design.md §3.6): a scene
 * of kind talk, key talk-<companion>-<n>, built from the campaign's talk template (scenes.ts), played
 * on the town's own place with no world of its own (as the prototype's had none), every seat moved
 * into it; its turns are `say`, as in any scene, on the two-part GM's steps (moves/two-part.ts). It
 * ends with the goodbye (its one exit: said in so many words, through a closing reply; said in the
 * player's own words, once the co-GM takes it) or by walking on (no reply), with no chapter, effects,
 * boundary or lead: the companion's record keeps what they told. The ended talk stays up until the
 * walker walks out, as a scene does.
 */

/**
 * The talk begins (talk.ts startTalk): the companion's record counted, the talk's scene row (opening)
 * and its bookkeeping with whom and where and the companion's role as it opens (the template's
 * start's, the co-GM's note -1, which the greeting reads), every seat in it, turn 0 holding the
 * lease, and the open think on the two-part GM (the greeting, and beside it the prep). `act`: what
 * the player did that opened it (the action menu's: hurting Kell, or working on her mind), queued as
 * its first turn once the greeting is in.
 */
export function openTalk(tx: TxCtx, actor: Actor, game: GameRow, ex: ExploreState, talk: { with: string; where: string }, act?: { text: string; mechanic: Mechanic }): SceneRow {
  if (!campaignFile(campaignOfGame(tx, game)).talk) throw new Refused(refusal("not_built"));
  const host = playerRow(tx, game.hostId);
  const record = counted(tx, game, talk.with);
  const sceneKey = talkSceneId(talk.with, record.count);
  const def = sceneDefOf(tx, game, sceneKey);
  const graph = graphOf(def);
  const town = mapPlaceOf(tx, game, ex.map);

  const scene = tx.db.scene.insert({
    id: 0n, gameId: game.id, sceneKey, title: def.title, hook: def.hook, kind: "talk", placeId: town.id,
    status: "opening", controllerId: host.id, turnId: undefined, turns: 0, exitKey: undefined, rev: 0, openedAt: tx.now, endedAt: undefined,
    time: game.time,
  });
  const gm: GmState = { ...initialGm(graph), talk: { with: talk.with, where: talk.where } };
  openingRolesFor(graph, gm);
  putGm(tx, scene.id, gm);
  moveSeats(tx, game.id, town.id, scene.id);
  noteHeard(tx, scene, graph);
  companionOnStage(tx, game, scene, talk.with);

  const turn = newTurn(tx, scene, host.id, 0, "replying");
  updateScene(tx, scene.id, { turnId: turn.id });
  queueThink(tx, openScene, { step: "open", game: idText(game.id), scene: idText(scene.id), turn: idText(turn.id), seen: seenOf(tx, scene.id), ...(act ? { act } : {}) });
  tx.log(`[talk] game ${game.id}: ${sceneKey} opens (${talk.where})${act ? `, the act its first turn: ${act.text}` : ""}; actor ${actor.id ?? "?"}`);
  return sceneRow(tx, scene.id);
}

/**
 * Who the talk is with is on stage in it, as the prototype's talk has its companion present: a
 * client names and colours their lines by their on_stage row (my_names gives their name only for
 * who's on stage). Only that row moves, from the scene they were last on stage in, which is over;
 * their entity, its place and the waiting scene's rows stay as they are (town-design §3.6).
 */
function companionOnStage(tx: TxCtx, game: GameRow, scene: SceneRow, castKey: string): void {
  const companion = [...tx.db.entity.byGameKey.filter([game.id, castKey])].find(e => e.kind === "person" || e.kind === "creature");
  if (!companion) return;
  const was = tx.db.onStage.entityId.find(companion.id);
  const there = was ? tx.db.scene.id.find(was.sceneId) : undefined;
  if (there && there.status !== "ended") return;
  const row = { entityId: companion.id, sceneId: scene.id, role: "cast" };
  if (was) tx.db.onStage.entityId.update(row);
  else tx.db.onStage.insert(row);
}

/** A companion's record with the player (talk_record), its talks counted one more (the first makes it). */
function counted(tx: TxCtx, game: GameRow, castKey: string): RowOf<"talkRecord"> {
  const record = recordOf(tx, game.id, castKey);
  if (record) return tx.db.talkRecord.id.update({ ...record, count: record.count + 1 });
  return tx.db.talkRecord.insert({ id: 0n, gameId: game.id, castKey, count: 1, told: [], stages: [] });
}

/** A companion's record with the player, if they've talked. */
export function recordOf(tx: TxCtx, gameId: bigint, castKey: string): RowOf<"talkRecord"> | undefined {
  return [...tx.db.talkRecord.gameId.filter(gameId)].find(r => r.castKey === castKey);
}

/** Is the actor's seat in a talk still going (not ended)? walk toward out walks on from it. */
export function inALiveTalk(tx: TxCtx, actor: Actor): boolean {
  const player = actor.id === undefined ? undefined : tx.db.player.id.find(actor.id);
  const scene = player?.sceneId === undefined ? undefined : tx.db.scene.id.find(player.sceneId);
  return !!scene && scene.kind === "talk" && scene.status !== "ended";
}

/**
 * The player walks on without a word (talk.ts leaveTalk): "<name> walks on", the talk over with no
 * reply, its record kept, and every seat back on the map. Not while the companion is answering (a
 * turn in flight); a turn that failed is let go.
 */
export function walkOn(tx: TxCtx, actor: Actor): void {
  const player = playerRow(tx, actor.id!);
  const scene = sceneRow(tx, player.sceneId!);
  if (scene.controllerId !== player.id) throw new Refused(refusal("not_controller", { name: playerRow(tx, scene.controllerId).name }));
  const lease = scene.turnId === undefined ? undefined : turnRow(tx, scene.turnId);
  if (lease && lease.phase !== "failed") throw new Refused(refusal("turn_in_flight"));
  if (lease) updateTurn(tx, lease.id, { phase: "done", endedAt: tx.now, note: undefined });
  for (const t of [...tx.db.turn.sceneId.filter(scene.id)].filter(t => t.phase === "queued")) updateTurn(tx, t.id, { phase: "done", endedAt: tx.now, error: "The talk ended first." });

  addEntry(tx, scene, { turn: scene.turns, speaker: "system", kind: "system", text: `${playerRow(tx, scene.controllerId).name} walks on` });
  updateScene(tx, scene.id, { status: "ended", exitKey: "goodbye", endedAt: tx.now, turnId: undefined });
  endTalk(tx, sceneRow(tx, scene.id));

  const game = gameRow(tx, scene.gameId);
  leaveTalk(tx, game, walkerOf(tx, game)!);
  tx.log(`[talk] scene ${scene.id} ${scene.sceneKey}: walked on`);
}

/**
 * The talk is over (talk.ts endTalk), however it ended: what came out of it goes on the companion's
 * record (the one thing they were keeping back, once it's out: told, and how near a talk of the old
 * pipeline's had come to it, the record's stage for it, dropped). How near this talk came is in its
 * own words, which the next talk's plan reads: the co-GM staged it through their role. The line in
 * the GM's notes on them that they told it is the AI service's (the settle's).
 */
export function endTalk(tx: TxCtx, scene: SceneRow): void {
  const gm = getGm(tx, scene.id);
  const talk = gm.talk;
  const record = talk ? recordOf(tx, scene.gameId, talk.with) : undefined;
  if (!talk || !record) return;
  const confide = talk.confide;
  if (confide && toldIt(gm)) {
    tx.db.talkRecord.id.update({ ...record, told: [...record.told, { note: confide.note, topic: confide.topic, turn: scene.turns }], stages: record.stages.filter(s => s.note !== confide.note) });
  }
  tx.log(`[talk] scene ${scene.id} ${scene.sceneKey} over${confide ? `: ${confide.topic} ${toldIt(gm) ? "told" : "not told"}` : ""}`);
}

/** Has it come out? Its discovery reached (the co-GM's move), or in a talk from before, its route taken (talk.ts toldIt). */
export const toldIt = (gm: GmState) => !!gm.reached?.includes(TOLD) || gm.path.some(p => p.via === CONFIDED);

/** Back on the map from a talk, where they stopped for it (the explore row as it was, the move counted): every seat on the map's own place, its clock going. */
export function leaveTalk(tx: TxCtx, game: GameRow, row: ExploreTableRow): ExploreTableRow {
  const town = mapPlaceOf(tx, game, row.map).id;
  moveSeats(tx, game.id, town, undefined);
  keepTicking(tx, town);
  const shared = exploreRowFrom(row);
  writeExplore(tx, { ...shared, acts: shared.acts + 1, said: "" });
  return walkerOf(tx, game)!;
}

/**
 * A talk's lines to choose from after turn n (the prep's for the greeting, the settle's after each
 * reply): the scene's set replaced, each a line to say. Without new ones (the call failed, or none
 * came), the old ones less the line just said, as the prototype keeps them (src/runtime/talk.ts:381-382).
 */
export function talkLines(tx: TxCtx, scene: SceneRow, n: number, lines: string[], said?: string): void {
  const old = [...tx.db.sceneSuggestion.sceneId.filter(scene.id)].sort((a, b) => a.turn - b.turn || a.ord - b.ord).map(row => row.text);
  const next = lines.length ? lines : old.filter(text => text !== said?.trim());
  tx.db.sceneSuggestion.sceneId.delete(scene.id);
  next.forEach((text, i) => {
    tx.db.sceneSuggestion.insert({ id: 0n, gameId: scene.gameId, sceneId: scene.id, playerId: scene.controllerId, turn: n, ord: i + 1, kind: "say", text });
  });
}

