import type { Identity } from "spacetimedb";
import type { DecideResponse, ReplyResponse, SettleResponse } from "../../../shared/protocol/ai.ts";
import { idText, playerSpeaker } from "../../../shared/protocol/keys.ts";
import { MAX_LINE, refusal, type Refusal } from "../../../shared/protocol/refusals.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import { actorOf, runMove, type Actor, type TxCtx } from "../context.ts";
import { settledFacts } from "../gm/bookkeeping.ts";
import { sayCall } from "../gm/requests.ts";
import { getGm } from "../gm/rows.ts";
import { playerRow, sceneOfPlayer, sceneRow, updateScene, type SceneRow, type TurnRow } from "../rows.ts";
import { sceneGraph } from "../scenes.ts";
import { addEntry, noteHeard } from "../transcript.ts";
import { newTurn, queuedTurnOf } from "../turns.ts";
import type { Move } from "./move.ts";
import { seenOf } from "./open-scene.ts";
import type { SayPlan } from "./plans.ts";
import { afterDecide, afterReply, afterSettle } from "./say-commits.ts";

/**
 * say (v0-design §4.2): the controller's line, recorded at once with its turn; then three thinks,
 * each committed in turn: decide (the route, and its check rolled here), reply (streamed, then the
 * GM's entry), settle (the world and where the story stands). A line said while the last turn
 * settles waits as queued, and starts when that one is done. On the wind-down, decide and reply
 * close the scene.
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

    const turn = newTurn(tx, scene, actor.id!, n, waits ? "queued" : "deciding");
    addEntry(tx, scene, { turn: n, speaker: playerSpeaker(actor.id!), kind: "player", text: line });
    noteHeard(tx, scene, sceneGraph(tx, scene));
    updateScene(tx, scene.id, waits ? { turns: n } : { turns: n, turnId: turn.id });

    return waits ? { done: true } : { done: false, plan: startPlan(tx, scene.id, turn, line) };
  },

  think: (tx, plan) => sayCall(tx, plan),

  commit(tx, plan, answer) {
    if (plan.step === "decide") return afterDecide(tx, plan, answer as DecideResponse);
    if (plan.step === "reply") return afterReply(tx, plan, answer as ReplyResponse);
    return afterSettle(tx, plan, answer as SettleResponse);
  },
};

export function sayReducer(tx: TxCtx, sender: Identity, args: { text: string }): void {
  runMove(tx, say, actorOf(tx, sender), args);
}

/** A turn's plan as it starts: who's on stage and what's settled as the player speaks, and whether this is the wind-down. */
export function startPlan(tx: TxCtx, sceneId: bigint, turn: TurnRow, line: string): SayPlan {
  const scene = sceneRow(tx, sceneId);
  const gm = getGm(tx, sceneId);
  return {
    step: "decide", game: idText(scene.gameId), scene: idText(scene.id), turn: idText(turn.id), n: turn.n, player: idText(turn.playerId),
    input: line,
    onStage: presentCast(sceneGraph(tx, scene), gm).map(c => c.id),
    settledBefore: settledFacts(gm),
    windDown: !!gm.closing,
    lines: [],
    seen: seenOf(tx, sceneId),
  };
}

// ---------------------------------------------------------------------------------------------
// The check's parts.

/**
 * In a scene, which is open, and theirs to lead. An opening that failed is a turn like any other
 * (turn 0, holding the lease): the line gets turnRefusal's /retry, not a wait that never ends.
 */
function sceneRefusal(tx: TxCtx, actor: Actor, scene: SceneRow | undefined): Refusal | undefined {
  if (!scene) return refusal("not_in_game");
  if (scene.status === "opening" && leaseOf(tx, scene)?.phase !== "failed") return refusal("not_ready");
  if (scene.status === "ended") return refusal("scene_over");
  if (scene.controllerId !== actor.id) return refusal("not_controller", { name: playerRow(tx, scene.controllerId).name });
  return undefined;
}

function lineRefusal(text: string): Refusal | undefined {
  const line = text.trim();
  if (!line) return refusal("empty_line");
  if (line.length > MAX_LINE) return refusal("too_long");
  return undefined;
}

/** The turn in flight: a failed one waits for /retry; one deciding or replying, or settling with a line already waiting, can't take another. */
function turnRefusal(tx: TxCtx, scene: SceneRow): Refusal | undefined {
  const inFlight = leaseOf(tx, scene);
  if (inFlight?.phase === "failed") return refusal("turn_failed");
  if (inFlight && (inFlight.phase !== "settling" || queuedTurnOf(tx, scene.id))) return refusal("turn_in_flight");
  return undefined;
}

/** The turn holding the scene's lease: in flight, or failed and waiting for /retry. */
function leaseOf(tx: TxCtx, scene: SceneRow): TurnRow | undefined {
  return scene.turnId === undefined ? undefined : tx.db.turn.id.find(scene.turnId) ?? undefined;
}
