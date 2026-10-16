import { describeRoll } from "../../../shared/dice.ts";
import type { GmState } from "../../../shared/gm/state.ts";
import type { After, ConsiderResponse, Decision, DecideResponse, Outcome, ReplyResponse, SettleResponse } from "../../../shared/protocol/ai.ts";
import { idOf } from "../../../shared/protocol/keys.ts";
import { IMPROVISED_EXIT_ID } from "../../../shared/scene/graph.ts";
import { unnamed } from "../../../shared/scene/names.ts";
import type { Exit, Scene } from "../../../shared/scene/types.ts";
import type { TxCtx } from "../context.ts";
import { rollerFor } from "../dice-row.ts";
import { afterTurn } from "../gm/background.ts";
import { applyMove, holdEnding, keepOpened, moveOnAfterReply, movedOn, resolveMove, routeOf, takeMove, wantsReview, type Move } from "../gm/bookkeeping.ts";
import { landRuling, settleRuling } from "../gm/consider.ts";
import { getGm, putGm } from "../gm/rows.ts";
import { sceneRow, updateScene, updateTurn, type SceneRow } from "../rows.ts";
import { carryGearAfter } from "../rules/play.ts";
import { refreshPockets } from "../rules/session.ts";
import { exitOf, sceneGraph } from "../scenes.ts";
import { closeScene } from "../story/end.ts";
import { addEntry, entriesOf, noteHeard, writeReply } from "../transcript.ts";
import { finishTurn } from "../turns.ts";
import { applyStage, joinArrivals, placeWorldOf, savePlaceWorld } from "../world/place.ts";
import { syncStage } from "../world/stage.ts";
import type { Next } from "./move.ts";
import { askForNotes } from "./notes.ts";
import type { SayPlan } from "./plans.ts";
import { suggestAfter } from "./suggest.ts";

/**
 * A say turn's commits (v0-design §6.2; gm-port §6, §8, §9; full-gm-design §4.2), each one
 * transaction, a pure function of the rows, the plan and the answer (the dice are a row), so withTx
 * can run one twice. Each ends with the next step's plan, or with the turn finished (turns.ts: done,
 * or noting while its reply's notes are written, which v5-design §3.5 has the turn wait for). The
 * turn's last commit queues the jobs that go over it once it's over (gm/background.ts afterTurn).
 */

/** A queued line's turn, when the scene ends before it starts. */
export const SCENE_ENDED_FIRST = "The scene ended first.";

/** What a commit works on: the scene, its graph (as play has changed it), and its GM bookkeeping, changed in place and written back. */
interface At { scene: SceneRow; graph: Scene; gm: GmState }

/**
 * After decide: the notes disclosure opened kept; then, on the wind-down, only whether the player
 * spoke out of character. Otherwise the route taken (its check rolled, the dice line written, the
 * beat moved on) and where that leaves the endings. On to the reply; or, when the GM is to rule on
 * the act first (wantsReview), to consider, the turn considering.
 */
export function afterDecide(tx: TxCtx, plan: SayPlan, answer: DecideResponse): Next<SayPlan> {
  const at = atTurn(tx, plan);
  const decision = needs(answer.decision, "decision");
  at.gm.opened = keepOpened(at.gm.opened, answer.opened ?? []);

  const decided = plan.windDown ? { outcome: windDownOutcome(at, plan, decision) } : decideOutcome(tx, at, plan, decision);
  const { outcome } = decided;

  putGm(tx, at.scene.id, at.gm);
  if ("considers" in decided && decided.considers) {
    updateTurn(tx, idOf(plan.turn), { phase: "considering" });
    return { done: false, plan: { ...plan, step: "consider", decision, outcome, lines: outcome.lines, ...(decided.pending ? { pendingExit: decided.pending } : {}) } };
  }
  updateTurn(tx, idOf(plan.turn), { phase: "replying" });
  return { done: false, plan: { ...plan, step: "reply", decision, outcome, lines: outcome.lines } };
}

/**
 * After consider (engine.ts:663-703, 729-735): the GM's ruling settled (its route's check rolled from
 * the game's dice, its dice line, its record, the ways of trying it shuts closed) and its move applied
 * as any route's, with where that leaves the endings; or, with no ruling, the plain check rolled
 * instead. A plan off the graph with nothing ruled is the co-GM's to review. Then the ending held
 * for the player's answer, unless the ruling answered it, and what this reply closes on. On to the
 * reply, which plays what was decided.
 */
export function afterConsider(tx: TxCtx, plan: SayPlan, answer: ConsiderResponse): Next<SayPlan> {
  const at = atTurn(tx, plan);
  const decision = needs(plan.decision, "decision");
  const outcome: Outcome = { ...needs(plan.outcome, "outcome"), lines: [...plan.lines] };
  const pending = plan.pendingExit;

  const ruled = answer.ruling && answer.verdict && answer.route ? rule(tx, at, plan, answer as Ruled, pending, outcome) : undefined;
  if (!ruled && answer.fallback) plainCheck(tx, at, plan, answer.fallback, outcome);
  // The background co-GM is for the scene's direction: a plan off the graph the GM has ruled on doesn't need it now.
  if (decision.offGraph && !ruled) at.gm.offGraphTurn = plan.n;
  // An ending held for the player's answer: a ruling's success, or its own ending, answers it; one that failed without one is like any try that might change things.
  closesOrHolds(at.gm, plan.n, decision, outcome, pending, !!ruled && (ruled.went === "success" || !!ruled.exit), !!ruled);

  putGm(tx, at.scene.id, at.gm);
  updateTurn(tx, idOf(plan.turn), { phase: "replying" });
  tx.log(`[scene ${at.scene.id} turn ${plan.n}] considered: ${ruled ? `${ruled.ruling.act} -> ${ruled.verdict.kind}${ruled.verdict.dc ? ` DC ${ruled.verdict.dc}` : ""}, ${ruled.went}` : `no ruling (${answer.error ?? "none given"})${outcome.freeform ? `; a plain ${outcome.freeform.skill} check` : ""}`}`);
  const kept = ruled ? { ruling: ruled.ruling, verdict: ruled.verdict, route: ruled.route, withheld: ruled.withheld } : {};
  return { done: false, plan: { ...plan, step: "reply", outcome, lines: outcome.lines, ...kept } };
}

/**
 * After reply: the GM's entry, the draft gone; its notes asked for, and the lines to suggest after it
 * unless it ends the scene, both on the world as the reply left it (engine.ts:844, :869, before
 * :880); what the reply offered or repeated noted, whoever a cue brought on joined to the world and
 * the stage. The wind-down's reply closes the scene (unless the player spoke out of character); any
 * other goes on to the settle, the box open again. One that closed the scene in its own right (the
 * decide's gm.ended) leaves it ending: the settle ends it, and nothing more is said in it meanwhile.
 */
export function afterReply(tx: TxCtx, plan: SayPlan, answer: ReplyResponse): Next<SayPlan> {
  const at = atTurn(tx, plan);
  const turnId = idOf(plan.turn);

  const reply = writeReply(tx, at.scene, plan.n, turnId, answer.entries ?? []);
  if (reply) askForNotes(tx, turnId, reply);
  if (!endsScene(at, plan)) suggestAfter(tx, at.scene, turnId);
  noteReply(at.gm, answer);
  bringOnArrivals(tx, at, plan.n);
  noteHeard(tx, at.scene, at.graph);

  if (plan.outcome?.windDown) return windDown(tx, at, plan);

  putGm(tx, at.scene.id, at.gm);
  updateTurn(tx, turnId, { phase: "settling" });
  if (at.gm.ended) updateScene(tx, at.scene.id, { status: "ending" });
  return { done: false, plan: { ...plan, step: "settle", reply: (answer.entries ?? []).map(e => e.text).join("\n\n") } };
}

/**
 * After settle: the read after the reply, unless this reply closed the scene: how it's going, and
 * (unless the player spoke out of character) where the story stands (an outcome route, an ending
 * reached, held or wound down), what landed (on a ruled turn, not what the dice kept back), and
 * whether the player walked out of the place. Then the stage manager's operations through the gate;
 * the player's sheet without the gear the story took from them (or with what it gave back); anyone
 * new joined; the beat's clock ticked; the world written back, and their pockets read from it. The
 * scene ends here if the reply closed it, a fight broke out, or the player left. The jobs that go
 * over the turn are queued, and the turn is done.
 */
export function afterSettle(tx: TxCtx, plan: SayPlan, answer: SettleResponse): Next<SayPlan> {
  const at = atTurn(tx, plan);
  const place = placeWorldOf(tx, at.scene);

  const read = at.gm.ended ? {} : moveOn(tx, at, plan, answer.after);
  const stage = applyStage(place, answer.ops ?? [], plan.n, read.left === true);
  const left = leftThePlace(at, read, plan.n);
  carryGearAfter(tx, at.scene, place.world, plan.n);
  joinArrivals(place.world, at.graph, at.gm, plan.n);
  if (!plan.decision?.outOfCharacter && !movedOn(at.gm, plan.n)) at.gm.turnsInBeat++;
  savePlaceWorld(tx, at.scene, place, at.graph);
  refreshPockets(tx, at.scene.controllerId, place.world);
  syncStage(tx, at.scene, at.graph, at.gm);

  const ending = endingOf(at, read.fight ?? left, plan.n);
  putGm(tx, at.scene.id, at.gm);
  tx.log(`[scene ${at.scene.id} turn ${plan.n}] settled: ${stage.changes.length} changed, ${stage.problems.length} not done${ending ? `; the scene ends: ${ending.id}` : ""}`);
  if (ending) endScene(tx, at.scene.id, ending, plan.n);
  else if (at.gm.closing) updateScene(tx, at.scene.id, { status: "closing" });
  noteHeard(tx, at.scene, at.graph);

  afterTurn(tx, at.scene.id, plan, at.gm);
  finishTurn(tx, at.scene.id, idOf(plan.turn));
  return { done: true };
}

/**
 * The scene ends on an exit: its system line, the scene's status and exit, and a line still waiting
 * cancelled; then the story's end of it (story/end.ts closeScene: a fight, or its effects and the
 * way on). `how`: played to it, or forced by the owner's end_scene.
 */
export function endScene(tx: TxCtx, sceneId: bigint, exit: Exit, n: number, how: "played" | "forced" = "played"): void {
  addEntry(tx, sceneRow(tx, sceneId), { turn: n, speaker: "system", kind: "system", text: `Scene ends: ${exit.title}` });
  updateScene(tx, sceneId, { status: "ended", exitKey: exit.id, endedAt: tx.now });
  for (const t of [...tx.db.turn.sceneId.filter(sceneId)].filter(t => t.phase === "queued")) {
    updateTurn(tx, t.id, { phase: "done", endedAt: tx.now, error: SCENE_ENDED_FIRST });
  }
  closeScene(tx, sceneRow(tx, sceneId), exit, how);
}

// ---------------------------------------------------------------------------------------------
// afterDecide's parts.

function atTurn(tx: TxCtx, plan: SayPlan): At {
  const scene = sceneRow(tx, idOf(plan.scene));
  const gm = getGm(tx, scene.id);
  return { scene, graph: sceneGraph(tx, scene, gm), gm };
}

/** The wind-down: the ending it closes on; nothing moves but a word out of character noted. */
function windDownOutcome(at: At, plan: SayPlan, decision: Decision): Outcome {
  if (!at.gm.closing) throw new Error(`scene ${at.scene.id} is winding down with no ending closing`);
  if (decision.outOfCharacter) at.gm.oocTurns.push(plan.n);
  return { lines: [], directives: [], wasStuck: at.gm.sceneStatus === "stuck", windDown: { exit: at.gm.closing.exitId } };
}

/**
 * engine.ts:593-617, 703, 723-738: the pending ending taken off; the route's move, or the same push
 * again; out of character; then, for a turn the GM is to rule on (wantsReview), nothing more until
 * the ruling (`considers`, with the ending held for the player's answer: `pending`). Otherwise a
 * plan off the graph noted for the co-GM, the held ending, and what this reply closes on.
 */
function decideOutcome(tx: TxCtx, at: At, plan: SayPlan, decision: Decision): { outcome: Outcome; considers: boolean; pending: GmState["pendingExit"] } {
  const { gm } = at;
  const outcome: Outcome = { lines: [], directives: [], wasStuck: gm.sceneStatus === "stuck" };
  const pending = gm.pendingExit;
  delete gm.pendingExit;

  const move = decision.route ? routeMove(tx, at, plan, decision.route) : undefined;
  if (move) takeRoute(tx, at, plan, move, pending, outcome);
  else if (decision.sameAgain) gm.path.push({ turn: plan.n, from: gm.beat, to: gm.beat, via: `same-again:${decision.sameAgain.route}`, source: "pre" });

  if (decision.outOfCharacter) gm.oocTurns.push(plan.n);
  if (wantsReview(gm, decision, move)) return { outcome, considers: true, pending };
  if (decision.offGraph) gm.offGraphTurn = plan.n;
  closesOrHolds(gm, plan.n, decision, outcome, pending, !!move, false);
  return { outcome, considers: false, pending };
}

/**
 * engine.ts:729-735: an ending held for the player's answer, unless the turn's move answered it
 * (`answered`), is held once more or lands (heldEnding, with whether the GM ruled on the turn); and
 * the ending this reply closes on, if any.
 */
function closesOrHolds(gm: GmState, n: number, decision: Decision, outcome: Outcome, pending: GmState["pendingExit"], answered: boolean, considered: boolean): void {
  if (pending && !answered) outcome.held = holdEnding(gm, pending, decision, considered);
  if (pending) outcome.pending = { exit: pending.exitId };
  const closes = outcome.taken?.ended ?? (outcome.held === "closes" ? pending?.exitId : undefined);
  if (closes) {
    outcome.closes = closes;
    gm.ended = { exitId: closes, turn: n };
  }
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
  return diceEntry(tx, scene, n, describeRoll(move.roll!, move.transition.check?.reason));
}

/** A dice line written to the transcript. */
function diceEntry(tx: TxCtx, scene: SceneRow, n: number, text: string): string {
  addEntry(tx, scene, { turn: n, speaker: "dice", kind: "roll", text });
  return text;
}

// ---------------------------------------------------------------------------------------------
// afterConsider's parts.

/** A consider answer with its ruling. */
type Ruled = ConsiderResponse & Required<Pick<ConsiderResponse, "ruling" | "verdict" | "route">>;

/**
 * engine.ts:669-681: the ruling settled (gm/consider.ts) and kept, its dice line written, its move
 * applied as a route's (one with no roll that keeps the scene where it is is a step on the path
 * too, as a plain check is), and where that leaves the endings (moveTaken). What the reply is told
 * of it, and what its dice kept back.
 */
function rule(tx: TxCtx, at: At, plan: SayPlan, answer: Ruled, pending: GmState["pendingExit"], outcome: Outcome): NonNullable<Outcome["ruled"]> & { withheld: string[] } {
  const { ruling, verdict, route } = answer;
  const aliases = unnamed(at.graph, { transcript: entriesOf(tx, at.scene.id) });
  const settled = settleRuling(at.graph, at.gm, ruling, verdict, route, rollerFor(tx, at.scene), plan.n, aliases);
  at.gm.rulings.push(settled.record);
  if (settled.dice) outcome.lines.push(diceEntry(tx, at.scene, plan.n, settled.dice));
  const from = at.gm.beat;
  applyMove(at.gm, settled.move, "pre", plan.n);
  if (!settled.move.roll && settled.move.to === from) at.gm.path.push({ turn: plan.n, from, to: from, via: settled.move.transition.id, source: "pre" });
  outcome.taken = takeMove(at.gm, settled.move, pending, plan.n);
  outcome.ruled = {
    ruling, verdict, route, went: settled.record.went, ...(settled.move.roll ? { roll: settled.move.roll } : {}),
    from, to: settled.move.to, ...(settled.move.exit ? { exit: settled.move.exit.id } : {}), chosen: settled.move.chosen,
  };
  return { ...outcome.ruled, withheld: settled.withheld };
}

/**
 * engine.ts:687-699: no ruling (the review failed, or ran past its deadline), and the decider wanted a
 * roll: the dice still decide it, as a plain check of the skill and DC the AI service read, its dice
 * line's reason the player's goal as they'd put it.
 */
function plainCheck(tx: TxCtx, at: At, plan: SayPlan, fallback: NonNullable<ConsiderResponse["fallback"]>, outcome: Outcome): void {
  const roll = rollerFor(tx, at.scene)(fallback.skill, fallback.dc);
  outcome.lines.push(diceEntry(tx, at.scene, plan.n, describeRoll(roll, fallback.reason)));
  at.gm.path.push({ turn: plan.n, from: at.gm.beat, to: at.gm.beat, via: "freeform", source: "pre", roll });
  outcome.freeform = { skill: fallback.skill, dc: fallback.dc, roll, reason: fallback.reason };
}

// ---------------------------------------------------------------------------------------------
// afterReply's parts.

/** This reply ends the scene: the decide commit found it closes on an ending, or it's the wind-down in character (engine.ts:498-504). */
function endsScene(at: At, plan: SayPlan): boolean {
  return !!at.gm.ended || (!!plan.outcome?.windDown && !plan.decision?.outOfCharacter);
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

/** The wind-down's reply: in character, it closed the scene on its ending; out of character, the ending still waits. Either way, no settle: the turn's last commit. */
function windDown(tx: TxCtx, at: At, plan: SayPlan): Next<SayPlan> {
  const closing = at.gm.closing;
  const closes = !!closing && !plan.decision?.outOfCharacter;
  if (closes) delete at.gm.closing;
  putGm(tx, at.scene.id, at.gm);

  if (closes) endScene(tx, at.scene.id, exitOf(at.graph, closing.exitId), plan.n);
  afterTurn(tx, at.scene.id, plan, at.gm);
  finishTurn(tx, at.scene.id, idOf(plan.turn));
  return { done: true };
}

// ---------------------------------------------------------------------------------------------
// afterSettle's parts.

/** What the read after the reply found that the settle acts on: a fight that broke out, and whether the player walked out of the place. */
interface Read { fight?: Exit; left?: boolean }

/**
 * engine.ts:887-913: how the scene is going; and, unless the player spoke out of character, the
 * essentials hinted, the outcome route or ending the read found, what came across (on a ruled turn,
 * less what the ruling's dice kept back: landRuling), and whether the player walked out of the place
 * (not while an ending is closing, nor when an outcome took the scene to one).
 */
function moveOn(tx: TxCtx, at: At, plan: SayPlan, after: After | undefined): Read {
  if (!after) return {};
  if (after.status) at.gm.sceneStatus = after.status;
  if (plan.decision?.outOfCharacter) return {};

  const leaving = !!after.left && !at.gm.closing;
  if (after.hinted?.length) at.gm.hinted = [...new Set([...at.gm.hinted, ...after.hinted])];
  const moved = moveOnAfterReply(at.graph, at.gm, after, plan.onStage, plan.n, rollerFor(tx, at.scene));
  if (moved.move?.roll) diceLine(tx, at.scene, plan.n, moved.move);
  landRuling(at.gm, { withheld: plan.withheld ?? [] }, after.landed ?? []);
  return { ...(moved.ended ? { fight: moved.ended } : {}), ...(leaving && !moved.move?.exit ? { left: true } : {}) };
}

/**
 * engine.ts:920-932: the player has walked out of this place altogether: the scene ends here on an
 * ending of their own, and what comes next is the story's (rather than the scene's own endings
 * chasing them across town). Not when the reply closed the scene, a fight broke out, or the read
 * found the story at an ending first.
 */
function leftThePlace(at: At, read: Read, n: number): Exit | undefined {
  if (!read.left || read.fight || at.gm.ended || at.gm.closing) return undefined;
  const exit = at.graph.exits.find(e => e.id === IMPROVISED_EXIT_ID);
  if (exit) at.gm.path.push({ turn: n, from: at.gm.beat, to: exit.id, via: "left-the-place", source: "post" });
  return exit;
}

/** The exit this turn ends the scene on: the one its reply closed (decided before the reply), a fight's, or the player's own as they left. */
function endingOf(at: At, ends: Exit | undefined, n: number): Exit | undefined {
  if (at.gm.ended) return exitOf(at.graph, at.gm.ended.exitId);
  if (ends) at.gm.ended = { exitId: ends.id, turn: n };
  return ends;
}

function needs<T>(value: T | undefined, what: string): T {
  if (value === undefined || value === null) throw new Error(`the answer has no ${what}`);
  return value;
}
