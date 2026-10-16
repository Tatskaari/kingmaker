import { describeRoll } from "../../../shared/dice.ts";
import type { GmState } from "../../../shared/gm/state.ts";
import type { After, Decision, DecideResponse, Outcome, Reply, ReplyResponse, SettleResponse } from "../../../shared/protocol/ai.ts";
import { idOf } from "../../../shared/protocol/keys.ts";
import type { Exit, Scene } from "../../../shared/scene/types.ts";
import type { TxCtx } from "../context.ts";
import { rollerFor } from "../dice-row.ts";
import { applyMove, holdEnding, keepOpened, moveOnAfterReply, movedOn, resolveMove, routeOf, takeMove, type Move } from "../gm/bookkeeping.ts";
import { getGm, putGm } from "../gm/rows.ts";
import { queueThink } from "../jobs.ts";
import { sceneRow, updateScene, updateTurn, type SceneRow } from "../rows.ts";
import { exitOf, sceneGraph } from "../scenes.ts";
import { addEntry, noteHeard, playerLine } from "../transcript.ts";
import { queuedTurnOf } from "../turns.ts";
import { applyStage, joinArrivals, placeWorldOf, savePlaceWorld } from "../world/place.ts";
import { syncStage } from "../world/stage.ts";
import type { Next } from "./move.ts";
import type { SayPlan } from "./plans.ts";
import { say, startPlan } from "./say.ts";

/**
 * A say turn's commits (v0-design §6.2; gm-port §6, §8, §9), each one transaction, a pure function
 * of the rows, the plan and the answer (the dice are a row), so withTx can run one twice. Each ends
 * with the next step's plan, or with the turn done: the lease released, and a line that was waiting
 * started.
 */

/** A queued line's turn, when the scene ends before it starts. */
export const SCENE_ENDED_FIRST = "The scene ended first.";

/** What a commit works on: the scene, its graph, and its GM bookkeeping, changed in place and written back. */
interface At { scene: SceneRow; graph: Scene; gm: GmState }

/**
 * After decide: the notes disclosure opened kept; then, on the wind-down, only whether the player
 * spoke out of character. Otherwise the route taken (its check rolled, the dice line written, the
 * beat moved on) and where that leaves the endings. On to the reply.
 */
export function afterDecide(tx: TxCtx, plan: SayPlan, answer: DecideResponse): Next<SayPlan> {
  const at = atTurn(tx, plan);
  const decision = needs(answer.decision, "decision");
  at.gm.opened = keepOpened(at.gm.opened, answer.opened ?? []);

  const outcome = plan.windDown ? windDownOutcome(at, plan, decision) : decideOutcome(tx, at, plan, decision);

  putGm(tx, at.scene.id, at.gm);
  updateTurn(tx, idOf(plan.turn), { phase: "replying" });
  return { done: false, plan: { ...plan, step: "reply", decision, outcome, lines: outcome.lines } };
}

/**
 * After reply: the GM's entry, the draft gone, what the reply offered or repeated noted, whoever a
 * cue brought on joined to the world and the stage. The wind-down's reply closes the scene (unless
 * the player spoke out of character); any other goes on to the settle, the box open again.
 */
export function afterReply(tx: TxCtx, plan: SayPlan, answer: ReplyResponse): Next<SayPlan> {
  const at = atTurn(tx, plan);
  const turnId = idOf(plan.turn);

  writeReply(tx, at.scene, plan.n, turnId, answer.entries ?? []);
  noteReply(at.gm, answer);
  bringOnArrivals(tx, at, plan.n);
  noteHeard(tx, at.scene, at.graph);

  if (plan.outcome?.windDown) return windDown(tx, at, plan);

  putGm(tx, at.scene.id, at.gm);
  updateTurn(tx, turnId, { phase: "settling" });
  return { done: false, plan: { ...plan, step: "settle", reply: (answer.entries ?? []).map(e => e.text).join("\n\n") } };
}

/**
 * After settle: the stage manager's operations through the gate; then, unless this reply closed the
 * scene, where the story stands (an outcome route, an ending reached, held or wound down); anyone
 * new joined; the beat's clock ticked; the world written back. The scene ends here if the reply
 * closed it (or a fight broke out). The turn is done.
 */
export function afterSettle(tx: TxCtx, plan: SayPlan, answer: SettleResponse): Next<SayPlan> {
  const at = atTurn(tx, plan);
  const place = placeWorldOf(tx, at.scene);
  const stage = applyStage(place, answer.ops ?? [], plan.n);

  const fight = at.gm.ended ? undefined : moveOn(tx, at, plan, answer.after);
  joinArrivals(place.world, at.graph, at.gm, plan.n);
  if (!plan.decision?.outOfCharacter && !movedOn(at.gm, plan.n)) at.gm.turnsInBeat++;
  savePlaceWorld(tx, at.scene, place, at.graph);
  syncStage(tx, at.scene, at.graph, at.gm);

  const ending = endingOf(at, fight, plan.n);
  putGm(tx, at.scene.id, at.gm);
  tx.log(`[scene ${at.scene.id} turn ${plan.n}] settled: ${stage.changes.length} changed, ${stage.problems.length} not done${ending ? `; the scene ends: ${ending.id}` : ""}`);
  if (ending) endScene(tx, at.scene.id, ending, plan.n);
  else if (at.gm.closing) updateScene(tx, at.scene.id, { status: "closing" });
  noteHeard(tx, at.scene, at.graph);

  endTurn(tx, at.scene.id, idOf(plan.turn));
  return { done: true };
}

/** The scene ends on an exit: its system line, the scene's status and exit, and a line still waiting cancelled. */
export function endScene(tx: TxCtx, sceneId: bigint, exit: Exit, n: number): void {
  addEntry(tx, sceneRow(tx, sceneId), { turn: n, speaker: "system", kind: "system", text: `Scene ends: ${exit.title}` });
  updateScene(tx, sceneId, { status: "ended", exitKey: exit.id, endedAt: tx.now });
  for (const t of [...tx.db.turn.sceneId.filter(sceneId)].filter(t => t.phase === "queued")) {
    updateTurn(tx, t.id, { phase: "done", endedAt: tx.now, error: SCENE_ENDED_FIRST });
  }
}

// ---------------------------------------------------------------------------------------------
// afterDecide's parts.

function atTurn(tx: TxCtx, plan: SayPlan): At {
  const scene = sceneRow(tx, idOf(plan.scene));
  return { scene, graph: sceneGraph(tx, scene), gm: getGm(tx, scene.id) };
}

/** The wind-down: the ending it closes on; nothing moves but a word out of character noted. */
function windDownOutcome(at: At, plan: SayPlan, decision: Decision): Outcome {
  if (!at.gm.closing) throw new Error(`scene ${at.scene.id} is winding down with no ending closing`);
  if (decision.outOfCharacter) at.gm.oocTurns.push(plan.n);
  return { lines: [], directives: [], wasStuck: at.gm.sceneStatus === "stuck", windDown: { exit: at.gm.closing.exitId } };
}

/** engine.ts:593-617, 723-738: the pending ending taken off; the route's move, or the same push again; out of character; the held ending; what this reply closes on. */
function decideOutcome(tx: TxCtx, at: At, plan: SayPlan, decision: Decision): Outcome {
  const { gm } = at;
  const outcome: Outcome = { lines: [], directives: [], wasStuck: gm.sceneStatus === "stuck" };
  const pending = gm.pendingExit;
  delete gm.pendingExit;

  const move = decision.route ? routeMove(tx, at, plan, decision.route) : undefined;
  if (move) takeRoute(tx, at, plan, move, pending, outcome);
  else if (decision.sameAgain) gm.path.push({ turn: plan.n, from: gm.beat, to: gm.beat, via: `same-again:${decision.sameAgain.route}`, source: "pre" });

  if (decision.outOfCharacter) gm.oocTurns.push(plan.n);
  if (pending && !move) outcome.held = holdEnding(gm, pending, decision);
  if (pending) outcome.pending = { exit: pending.exitId };
  const closes = outcome.taken?.ended ?? (outcome.held === "closes" ? pending?.exitId : undefined);
  if (closes) {
    outcome.closes = closes;
    gm.ended = { exitId: closes, turn: plan.n };
  }
  return outcome;
}

/** The decision's route, resolved and its check rolled; none when it isn't a route open here (a stale or mistaken pick moves nothing). */
function routeMove(tx: TxCtx, at: At, plan: SayPlan, route: NonNullable<Decision["route"]>): Move | undefined {
  const transition = routeOf(at.graph, at.gm, route.id);
  if (!transition) {
    tx.log(`[scene ${at.scene.id} turn ${plan.n}] the decision's route ${route.id} isn't open from ${at.gm.beat}: no move`);
    return undefined;
  }
  return resolveMove(at.graph, at.gm, transition, route, rollerFor(tx, at.scene));
}

/** The move taken: its dice line, what the reply is told of it (from the beat before), the beat moved on, and the ending it reaches. */
function takeRoute(tx: TxCtx, at: At, plan: SayPlan, move: Move, pending: GmState["pendingExit"], outcome: Outcome): void {
  if (move.roll) outcome.lines.push(diceLine(tx, at.scene, plan.n, move));
  outcome.move = {
    route: move.transition.id, phase: move.phase === "cue" ? "cue" : "attempt", from: at.gm.beat, to: move.to,
    ...(move.roll ? { roll: move.roll } : {}), ...(move.exit ? { exit: move.exit.id } : {}), chosen: move.chosen,
  };
  applyMove(at.gm, move, "pre", plan.n);
  outcome.taken = takeMove(at.gm, move, pending, plan.n);
}

/** A check's line in the transcript, as the dice say it. */
function diceLine(tx: TxCtx, scene: SceneRow, n: number, move: Move): string {
  const text = describeRoll(move.roll!, move.transition.check?.reason);
  addEntry(tx, scene, { turn: n, speaker: "dice", kind: "roll", text });
  return text;
}

// ---------------------------------------------------------------------------------------------
// afterReply's parts.

function writeReply(tx: TxCtx, scene: SceneRow, n: number, turnId: bigint, entries: Reply[]): void {
  for (const e of entries) addEntry(tx, scene, { turn: n, speaker: e.speaker ?? "gm", kind: e.kind ?? "narration", text: e.text, ...(e.markup ? { markup: e.markup } : {}) });
  tx.db.replyDraft.turnId.delete(turnId);
}

/** A beat's pressure, once offered, isn't offered again; a sentence the reply repeated word for word, the next is told not to (or that's cleared). */
function noteReply(gm: GmState, answer: ReplyResponse): void {
  const offered = answer.gm?.offered;
  if (offered && !gm.pressureOffered.includes(offered)) gm.pressureOffered.push(offered);
  if (answer.gm?.repeated) gm.repeated = answer.gm.repeated;
  else delete gm.repeated;
}

/** Whoever a cue brought on joins the world and the stage after the reply, before the stage manager reads the world (engine.ts:880). */
function bringOnArrivals(tx: TxCtx, at: At, n: number): void {
  const place = placeWorldOf(tx, at.scene);
  if (joinArrivals(place.world, at.graph, at.gm, n).length) savePlaceWorld(tx, at.scene, place, at.graph);
  syncStage(tx, at.scene, at.graph, at.gm);
}

/** The wind-down's reply: in character, it closed the scene on its ending; out of character, the ending still waits. Either way, no settle. */
function windDown(tx: TxCtx, at: At, plan: SayPlan): Next<SayPlan> {
  const closing = at.gm.closing;
  const closes = !!closing && !plan.decision?.outOfCharacter;
  if (closes) delete at.gm.closing;
  putGm(tx, at.scene.id, at.gm);

  if (closes) endScene(tx, at.scene.id, exitOf(at.graph, closing.exitId), plan.n);
  endTurn(tx, at.scene.id, idOf(plan.turn));
  return { done: true };
}

// ---------------------------------------------------------------------------------------------
// afterSettle's parts.

/**
 * engine.ts:887-913: how the scene is going; and, unless the player spoke out of character, the
 * essentials hinted and come across, and the outcome route or ending the read found. A fight that
 * broke out is the exit it returns.
 */
function moveOn(tx: TxCtx, at: At, plan: SayPlan, after: After | undefined): Exit | undefined {
  if (!after) return undefined;
  if (after.status) at.gm.sceneStatus = after.status;
  if (plan.decision?.outOfCharacter) return undefined;

  if (after.hinted?.length) at.gm.hinted = [...new Set([...at.gm.hinted, ...after.hinted])];
  const moved = moveOnAfterReply(at.graph, at.gm, after, plan.onStage, plan.n, rollerFor(tx, at.scene));
  if (moved.move?.roll) diceLine(tx, at.scene, plan.n, moved.move);
  if (after.landed?.length) at.gm.landed = [...new Set([...at.gm.landed, ...after.landed])];
  return moved.ended;
}

/** The exit this turn ends the scene on: the one its reply closed (decided before the reply), or a fight's. */
function endingOf(at: At, fight: Exit | undefined, n: number): Exit | undefined {
  if (at.gm.ended) return exitOf(at.graph, at.gm.ended.exitId);
  if (fight) at.gm.ended = { exitId: fight.id, turn: n };
  return fight;
}

/** The turn done and the lease released; a line said meanwhile starts now, its think queued. */
function endTurn(tx: TxCtx, sceneId: bigint, turnId: bigint): void {
  updateTurn(tx, turnId, { phase: "done", endedAt: tx.now, note: undefined });
  const scene = updateScene(tx, sceneId, { turnId: undefined });
  if (scene.status === "ended") return;

  const queued = queuedTurnOf(tx, sceneId);
  if (!queued) return;
  updateTurn(tx, queued.id, { phase: "deciding" });
  updateScene(tx, sceneId, { turnId: queued.id });
  queueThink(tx, say, startPlan(tx, sceneId, queued, playerLine(tx, sceneId, queued.n)));
}

function needs<T>(value: T | undefined, what: string): T {
  if (value === undefined || value === null) throw new Error(`the answer has no ${what}`);
  return value;
}
