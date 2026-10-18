import type { Identity } from "spacetimedb";
import type { ConsiderResponse, DecideResponse, ReactionsResponse, ReplyResponse, SettleResponse } from "../../../shared/protocol/ai.ts";
import { idText, playerSpeaker } from "../../../shared/protocol/keys.ts";
import { MAX_LINE, refusal, type Refusal } from "../../../shared/protocol/refusals.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import { actorOf, runMove, type Actor, type TxCtx } from "../context.ts";
import { settledFacts } from "../gm/bookkeeping.ts";
import { sayCall } from "../gm/requests.ts";
import { getGm } from "../gm/rows.ts";
import { gameRow, playerRow, sceneOfPlayer, sceneRow, updateScene, type SceneRow, type TurnRow } from "../rows.ts";
import { sceneGraph } from "../scenes.ts";
import { addEntry, noteHeard } from "../transcript.ts";
import { newTurn, queuedTurnOf } from "../turns.ts";
import type { Move } from "./move.ts";
import { seenOf } from "./open-scene.ts";
import type { SayPlan } from "./plans.ts";
import { afterConsider, afterDecide, afterReactions } from "./say-commits.ts";
import { afterTwoPartReply, afterTwoPartSettle, twoPartStart } from "./two-part.ts";

/**
 * say (v0-design §4.2): the controller's line, recorded at once with its turn, and the game played
 * now (the rules first: what was left hanging lands before they act, world-bridge-design §3.4); then
 * three thinks, each committed in turn: decide (the route, and its check rolled here; the rules' act,
 * resolved here), reply (streamed, then the GM's entry), settle (the world and where the story
 * stands). An act that was violence has the reactions to it between decide and what comes next
 * (world-bridge-design §3.4); a turn the GM rules on (full-gm-design §4.2) has consider before the
 * reply (the ruling, rolled here). A line said while the last turn settles, or waits for its reply's
 * notes, waits as queued, and starts when that one is done. On the wind-down, decide and reply close
 * the scene.
 */
export const say: Move<{ text: string }, SayPlan> = {
  name: "say",

  check(tx, actor, { text }) {
    const scene = sceneOfPlayer(tx, actor.id);
    return sceneRefusal(tx, actor, scene) ?? lineRefusal(text) ?? turnRefusal(tx, scene!);
  },

  resolve(tx, actor, { text }) {
    const scene = sceneOfPlayer(tx, actor.id)!;
    const line = text.trim(), n = scene.turns + 1;
    const waits = scene.turnId !== undefined;

    const turn = newTurn(tx, scene, actor.id!, n, waits ? "queued" : "replying");
    addEntry(tx, scene, { turn: n, speaker: playerSpeaker(actor.id!), kind: "player", text: line });
    noteHeard(tx, scene, sceneGraph(tx, scene, getGm(tx, scene.id)));
    updateScene(tx, scene.id, waits ? { turns: n } : { turns: n, turnId: turn.id });
    playedNow(tx, scene.gameId);

    return waits ? { done: true } : { done: false, plan: startPlan(tx, scene.id, turn, line) };
  },

  think: (tx, plan) => sayCall(tx, plan),

  commit(tx, plan, answer) {
    if (plan.step === "reply") return afterTwoPartReply(tx, plan, answer as ReplyResponse);
    if (plan.step === "settle") return afterTwoPartSettle(tx, plan, answer as SettleResponse);
    if (plan.step === "decide") return afterDecide(tx, plan, answer as DecideResponse);
    if (plan.step === "reactions") return afterReactions(tx, plan, answer as ReactionsResponse);
    return afterConsider(tx, plan, answer as ConsiderResponse);
  },
};

export function sayReducer(tx: TxCtx, sender: Identity, args: { text: string }): void {
  runMove(tx, say, actorOf(tx, sender), args);
}

/**
 * A turn's plan as it starts (on both paths a turn starts, a line said now or one that waited): who's
 * on stage as the player speaks, what's settled and whether this is the wind-down, then the two-part
 * GM's start (twoPartStart: a talk's goodbye said, the rules first, the map's act), its reply next.
 * Every scene plays on the two-part GM's steps (docs/two-part-design.md): no decide.
 */
export function startPlan(tx: TxCtx, sceneId: bigint, turn: TurnRow, line: string): SayPlan {
  const scene = sceneRow(tx, sceneId);
  const gm = getGm(tx, sceneId);
  const onStage = presentCast(sceneGraph(tx, scene, gm), gm).map(c => c.id);
  const ids = { game: idText(scene.gameId), scene: idText(scene.id), turn: idText(turn.id), n: turn.n, player: idText(turn.playerId) };
  const plan = twoPartStart(tx, scene, sceneGraph(tx, scene, gm), gm, turn, line, { ...ids, input: line, onStage, settledBefore: settledFacts(gm), windDown: !!gm.closing, seen: seenOf(tx, sceneId) });
  return { ...plan, seen: seenOf(tx, sceneId) };
}

/** The game played now (v1-design §3.1): its host's lastPlayedAt, which the title's "(just now)" and my_games' order read, as the prototype's save after every turn gave its folder's time. */
function playedNow(tx: TxCtx, gameId: bigint): void {
  tx.db.player.id.update({ ...playerRow(tx, gameRow(tx, gameId).hostId), lastPlayedAt: tx.now });
}

// ---------------------------------------------------------------------------------------------
// The check's parts.

/**
 * In a scene, which is open, and theirs to lead. A scene ending (a reply closed it, and its settle
 * ends it) is over already. A failed turn holding the lease gets turnRefusal's /retry instead: an
 * opening that failed (turn 0), or the settle of a reply that closed the scene, is a turn like any
 * other, and only /retry brings the scene on, or to its end. In a game on the map, between scenes,
 * there's nothing to say a line to (map-design §3.2); nor in a scene at its fight (fighting), until
 * the fight is fought.
 */
function sceneRefusal(tx: TxCtx, actor: Actor, scene: SceneRow | undefined): Refusal | undefined {
  if (!scene) return onMap(tx, actor) ? refusal("not_in_scene") : refusal("not_in_game");
  const failed = leaseOf(tx, scene)?.phase === "failed";
  if (scene.status === "opening" && !failed) return refusal("not_ready");
  if (scene.status === "ended" || (scene.status === "ending" && !failed)) return refusal("scene_over");
  // A fight is next (story-design §4.3): it takes no words, only its stand-in's action (fight_it_out).
  if (scene.status === "fighting") return refusal("not_now");
  if (scene.controllerId !== actor.id) return refusal("not_controller", { name: playerRow(tx, scene.controllerId).name });
  return undefined;
}

function lineRefusal(text: string): Refusal | undefined {
  const line = text.trim();
  if (!line) return refusal("empty_line");
  if (line.length > MAX_LINE) return refusal("too_long");
  return undefined;
}

/**
 * The turn in flight: a failed one waits for /retry; one deciding or replying, or with a line
 * already waiting, can't take another. One settling (its reply in: the box is open) takes
 * one more, which waits.
 */
function turnRefusal(tx: TxCtx, scene: SceneRow): Refusal | undefined {
  const inFlight = leaseOf(tx, scene);
  if (inFlight?.phase === "failed") return refusal("turn_failed");
  if (inFlight && (!BOX_OPEN.has(inFlight.phase) || queuedTurnOf(tx, scene.id))) return refusal("turn_in_flight");
  return undefined;
}

/** A seated player whose game is on the map: its host walks it (an explore row). */
function onMap(tx: TxCtx, actor: Actor): boolean {
  const player = actor.id === undefined ? undefined : tx.db.player.id.find(actor.id);
  const game = player ? tx.db.game.id.find(player.gameId) : undefined;
  return !!game && !!tx.db.explore.playerId.find(game.hostId);
}

/** The phases of a turn in flight whose reply is in: a line said now waits for it (v5-design §3.3). */
const BOX_OPEN = new Set(["settling"]);

/** The turn holding the scene's lease: in flight, or failed and waiting for /retry. */
function leaseOf(tx: TxCtx, scene: SceneRow): TurnRow | undefined {
  return scene.turnId === undefined ? undefined : (tx.db.turn.id.find(scene.turnId) ?? undefined);
}
