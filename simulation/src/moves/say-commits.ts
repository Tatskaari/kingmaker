import { describeRoll } from "../../../shared/dice.ts";
import type { GmState } from "../../../shared/gm/state.ts";
import type { ConsiderResponse, Decision, DecideResponse, Outcome, ReactionsResponse, ReplyResponse } from "../../../shared/protocol/ai.ts";
import { idOf } from "../../../shared/protocol/keys.ts";
import { attack, castSpell, dispelConjured, rest, useFeature, wrestle, type RulesOutcome } from "../../../shared/rules/acts.ts";
import { leap, moveToAct, react, violence } from "../../../shared/rules/scene-acts.ts";
import type { Act, Mechanic, Reaction, Rules } from "../../../shared/rules/types.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import { unnamed } from "../../../shared/scene/names.ts";
import type { Exit, Scene } from "../../../shared/scene/types.ts";
import type { TxCtx } from "../context.ts";
import { rollerFor } from "../dice-row.ts";
import { applyMove, holdEnding, keepOpened, resolveMove, routeOf, takeMove, wantsReview, type Move } from "../gm/bookkeeping.ts";
import { settleRuling } from "../gm/consider.ts";
import { getGm, putGm } from "../gm/rows.ts";
import { sceneRow, updateScene, updateTurn, type SceneRow } from "../rows.ts";
import { inPlay, playedOut } from "../rules/play.ts";
import { engineCall } from "../rules/session.ts";
import { sceneGraph } from "../scenes.ts";
import { closeScene } from "../story/end.ts";
import { addEntry, entriesOf } from "../transcript.ts";
import { placeWorldOf, savePlaceWorld } from "../world/place.ts";
import { syncStage } from "../world/stage.ts";
import type { Next } from "./move.ts";
import type { SayPlan } from "./plans.ts";

/**
 * A say turn's commits (v0-design §6.2; gm-port §6, §8, §9; full-gm-design §4.2; world-bridge-design
 * §3.4), each one transaction, a pure function of the rows, the plan and the answer (the dice are a
 * row, and the rules engine is pinned to it), so withTx can run one twice. Each ends with the next
 * step's plan, or with the turn finished (turns.ts). The turn's last commit queues the jobs that
 * go over it once it's over (gm/background.ts afterTurn).
 */

/** A queued line's turn, when the scene ends before it starts. */
export const SCENE_ENDED_FIRST = "The scene ended first.";

/** What a commit works on: the scene, its graph (as play has changed it), and its GM bookkeeping, changed in place and written back. */
export interface At { scene: SceneRow; graph: Scene; gm: GmState }

/**
 * After decide: the notes disclosure opened kept; then, on the wind-down, only whether the player
 * spoke out of character. Otherwise the route taken (its check rolled, the dice line written, the
 * beat moved on), the rules' act resolved on the world (its dice lines written), and where that
 * leaves the endings. On to the reply; or, when the act was violence, to the reactions to it first,
 * the turn still deciding (what comes after them kept in `then`); or, when the GM is to rule on the
 * act first (wantsReview), to consider, the turn considering.
 */
export function afterDecide(tx: TxCtx, plan: SayPlan, answer: DecideResponse): Next<SayPlan> {
  const at = atTurn(tx, plan);
  // The map's act (town-design §3.4): what the rules resolve this turn was chosen already, whatever the decider read (director.ts:793's forced).
  const read = needs(answer.decision, "decision");
  const decision = plan.forced ? { ...read, mechanic: plan.forced } : read;
  at.gm.opened = keepOpened(at.gm.opened, answer.opened ?? []);

  const decided = plan.windDown ? { outcome: windDownOutcome(at, plan, decision) } : decideOutcome(tx, at, plan, decision);
  const { outcome } = decided;
  const pending = "pending" in decided && decided.pending ? { pendingExit: decided.pending } : {};

  putGm(tx, at.scene.id, at.gm);
  if ("act" in decided && decided.act) {
    return { done: false, plan: { ...plan, step: "reactions", decision, outcome, lines: outcome.lines, act: decided.act, then: decided.considers ? "consider" : "reply", ...pending } };
  }
  if ("considers" in decided && decided.considers) {
    updateTurn(tx, idOf(plan.turn), { phase: "considering" });
    return { done: false, plan: { ...plan, step: "consider", decision, outcome, lines: outcome.lines, ...pending } };
  }
  updateTurn(tx, idOf(plan.turn), { phase: "replying" });
  return { done: false, plan: { ...plan, step: "reply", decision, outcome, lines: outcome.lines } };
}

/**
 * After reactions (engine.ts:637-656): everyone who saw the player's violence reacts as the AI
 * service decided (scene-acts.ts react): the fleeing leave the place (gone, absent, off the stage),
 * the cowering cower, and a fight starts if anyone wants one, its first fighter's blow left hanging
 * over the player. Their directive follows the act's, and their step goes on the path. A fight that
 * broke out is the turn's answer: an ending the move reached this turn is undone, and the GM's
 * ruling is skipped. Then what the decide commit left for after them: the ruling, or the reply with
 * the tail it held back (an ending held for the player's answer, what this reply closes on).
 */
export function afterReactions(tx: TxCtx, plan: SayPlan, answer: ReactionsResponse): Next<SayPlan> {
  const at = atTurn(tx, plan);
  const decision = needs(plan.decision, "decision");
  const outcome: Outcome = { ...needs(plan.outcome, "outcome"), lines: [...plan.lines] };
  const reactions = answer.reactions ?? {};

  if (Object.keys(reactions).length) reactionsTakeEffect(tx, at, plan, needs(plan.act, "act"), reactions, answer.directive, outcome);
  const brawl = at.gm.brawl?.turn === plan.n;
  if (brawl) breakOut(at.gm, plan.n, outcome);
  const then = brawl ? "reply" : (plan.then ?? "reply");
  if (then === "reply") {
    if (decision.offGraph) at.gm.offGraphTurn = plan.n;
    closesOrHolds(at.gm, plan.n, decision, outcome, plan.pendingExit, !!outcome.move, false);
  }

  putGm(tx, at.scene.id, at.gm);
  updateTurn(tx, idOf(plan.turn), { phase: then === "consider" ? "considering" : "replying" });
  return { done: false, plan: { ...plan, step: then, outcome, lines: outcome.lines } };
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
 * The scene ends on an exit: what a spell conjured goes with it (engine.ts:984: its lights and hands
 * don't outlast the scene), its system line, the scene's status and exit, and a line still waiting
 * cancelled; then the story's end of it (story/end.ts closeScene: a fight, or its effects and the
 * way on). `how`: played to it, or forced by the owner's end_scene.
 */
export function endScene(tx: TxCtx, sceneId: bigint, exit: Exit, n: number, how: "played" | "forced" = "played"): void {
  dispelAtTheEnd(tx, sceneRow(tx, sceneId), n);
  addEntry(tx, sceneRow(tx, sceneId), { turn: n, speaker: "system", kind: "system", text: `Scene ends: ${exit.title}` });
  updateScene(tx, sceneId, { status: "ended", exitKey: exit.id, endedAt: tx.now });
  for (const t of [...tx.db.turn.sceneId.filter(sceneId)].filter(t => t.phase === "queued")) {
    updateTurn(tx, t.id, { phase: "done", endedAt: tx.now, error: SCENE_ENDED_FIRST });
  }
  closeScene(tx, sceneRow(tx, sceneId), exit, how);
}

/** engine.ts:984: what the scene's spells conjured fades as it ends; the world written back only when something did. */
function dispelAtTheEnd(tx: TxCtx, scene: SceneRow, n: number): void {
  const place = placeWorldOf(tx, scene);
  const logged = place.world.log.length;
  dispelConjured(place.world, undefined, n);
  if (place.world.log.length > logged) savePlaceWorld(tx, scene, place, sceneGraph(tx, scene, getGm(tx, scene.id)));
}

// ---------------------------------------------------------------------------------------------
// afterDecide's parts.

export function atTurn(tx: TxCtx, plan: Pick<SayPlan, "scene">): At {
  const scene = sceneRow(tx, idOf(plan.scene));
  const gm = getGm(tx, scene.id);
  return { scene, graph: sceneGraph(tx, scene, gm), gm };
}

/** The wind-down: the ending it closes on; nothing moves but a word out of character noted. */
function windDownOutcome(at: At, plan: SayPlan, decision: Decision): Outcome {
  if (!at.gm.closing) throw new Error(`scene ${at.scene.id} is winding down with no ending closing`);
  if (decision.outOfCharacter) at.gm.oocTurns.push(plan.n);
  return { lines: [], directives: [], windDown: { exit: at.gm.closing.exitId } };
}

/**
 * engine.ts:593-638, 703, 723-738: the pending ending taken off; the route's move, or the same push
 * again; the rules' act (takeAct); out of character; then, for an act that was violence, nothing
 * more until the reactions to it (`act`, with whether the GM is to rule on it after them:
 * `considers`), and for a turn the GM is to rule on (wantsReview), nothing more until the ruling
 * (`considers`, with the ending held for the player's answer: `pending`). Otherwise a plan off the
 * graph noted for the co-GM, the held ending, and what this reply closes on. The turn's dice lines
 * start with the rules first's, and its directives are theirs.
 */
function decideOutcome(tx: TxCtx, at: At, plan: SayPlan, decision: Decision): { outcome: Outcome; considers: boolean; pending: GmState["pendingExit"]; act?: Act } {
  const { gm } = at;
  const outcome: Outcome = { lines: [...plan.lines], directives: [...(plan.rulesFirst?.directives ?? [])] };
  const pending = gm.pendingExit;
  delete gm.pendingExit;

  const move = decision.route ? routeMove(tx, at, plan, decision.route) : undefined;
  if (move) takeRoute(tx, at, plan, move, pending, outcome);
  else if (decision.sameAgain) gm.path.push({ turn: plan.n, from: gm.beat, to: gm.beat, via: `same-again:${decision.sameAgain.route}`, source: "pre" });
  const act = decision.mechanic ? takeAct(tx, at, plan, decision.mechanic, move, outcome) : undefined;

  if (decision.outOfCharacter) gm.oocTurns.push(plan.n);
  const considers = wantsReview(gm, decision, move);
  if (act) return { outcome, considers, pending, act };
  if (considers) return { outcome, considers: true, pending };
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

/**
 * engine.ts:618-636 (but 632, the opening blow: V12's): the rules resolve the player's act on the
 * scene's world, from where they moved to first: a spell, a blow, a grab or a shove, a jump, a class
 * feature, a rest. Its dice lines, its directive (Outcome.acts), its step on the path; the world, the
 * character, the sheet and the pockets written. Then whether it was violence people would react to
 * (not while a fight is on already, nor on a route into one, which answers it on its own): the
 * reactions step's act. Not when the blow before their turn put them down (it doesn't happen), nor a
 * Shield already raised against it.
 */
export function takeAct(tx: TxCtx, at: At, plan: Pick<SayPlan, "n" | "input" | "rulesFirst">, m: Mechanic, move: Move | undefined, outcome: Outcome): Act | undefined {
  const first = plan.rulesFirst;
  const forestalled = !!first?.down || (!!first?.shielded && m.kind === "cast" && m.spell === "shield");
  if (forestalled && first?.down) outcome.lines.push(diceEntry(tx, at.scene, plan.n, "(Knocked down before you could act: it doesn't happen)"));
  if (forestalled) return undefined;
  const played = inPlay(tx, at.scene, at.graph, at.gm, plan.n);
  const { session } = played, world = played.place.world, input = plan.input;
  if (!session.rules) return undefined;
  const started = tx.elapsedMs();
  const engine = <T>(fn: (rules: Rules) => T): T => engineCall(tx, at.scene.gameId, fn);
  const present = presentCast(at.graph, at.gm);

  // Moved first, in the same turn: the spell or blow comes from where they ended up.
  if ((m.kind === "cast" || m.kind === "attack" || m.kind === "wrestle") && m.from && session.world) moveToAct(session, m.from, m.kind === "cast" ? m.targets.find(t => t !== "self") : m.target);
  const before = Object.fromEntries(Object.values(world.entities).map(e => [e.id, [...e.states]]));
  const result = engine((rules): RulesOutcome => {
    try {
      return m.kind === "cast" ? castSpell(rules, session, present, m.spell, m.targets, { ritual: /\britual\b/i.test(input) && !/\b(not|no|without|rather than)\b[^.!?]{0,20}\britual/i.test(input) && !/\bspend(ing)? a\b[^.!?]{0,12}\bslot\b/i.test(input), said: input, ...(m.unclear ? { unclear: true } : {}) })
        : m.kind === "attack" ? attack(rules, session, present, m.target, m.weapon)
        : m.kind === "wrestle" ? wrestle(rules, session, present, m.target, m.how)
        : m.kind === "jump" ? leap(rules, session, m)
        : m.kind === "feature" ? useFeature(rules, session, present, m.feature, m.target)
        : rest(rules, session, m.length);
    } catch (error) {
      return { lines: [`(The rules couldn't resolve that: ${error instanceof Error ? error.message : String(error)})`], directive: "" };
    }
  });
  for (const text of result.lines) outcome.lines.push(diceEntry(tx, at.scene, plan.n, text));
  if (result.directive) outcome.acts = [...(outcome.acts ?? []), result.directive];
  at.gm.path.push({ turn: plan.n, from: at.gm.beat, to: at.gm.beat, via: `rules:${m.kind}${m.kind === "cast" ? `:${m.spell}` : m.kind === "attack" || m.kind === "wrestle" ? `:${m.target}` : m.kind === "jump" ? `:${m.how}` : m.kind === "feature" ? `:${m.feature}` : `:${m.length}`}`, source: "pre" });
  // Violence draws a reaction from everyone present: some fight, some flee, some run for help. An authored fight answers it on its own.
  const act = move?.exit?.kind !== "combat" && !at.gm.brawl ? engine(rules => violence(rules, at.graph, session, m, before)) : undefined;

  playedOut(tx, at.scene, at.graph, at.gm, played);
  tx.log(`[rules] act ${m.kind} ${Math.round(tx.elapsedMs() - started)} ms: ${result.lines.length} dice lines${act ? `; violence: ${act.what}` : ""}`);
  return act;
}

// ---------------------------------------------------------------------------------------------
// afterReactions' parts.

/** engine.ts:641-650: the reactions take effect on the world and the GM's bookkeeping (who left the stage), their directive after the act's, their step on the path. */
export function reactionsTakeEffect(tx: TxCtx, at: At, plan: Pick<SayPlan, "n">, act: Act, reactions: Record<string, Reaction>, directive: string | undefined, outcome: Outcome): void {
  const played = inPlay(tx, at.scene, at.graph, at.gm, plan.n);
  react(at.graph, played.session, act, reactions);
  playedOut(tx, at.scene, at.graph, at.gm, played);
  if (directive) outcome.acts = [...(outcome.acts ?? []), directive];
  const read = Object.entries(reactions).map(([id, r]) => `${id}=${r}`).join(",");
  at.gm.path.push({ turn: plan.n, from: at.gm.beat, to: at.gm.beat, via: `reactions:${read}`, source: "pre" });
  syncStage(tx, at.scene, at.graph, at.gm);
  tx.log(`[scene ${at.scene.id} turn ${plan.n}] reactions to "${act.what}": ${read}`);
}

/**
 * engine.ts:643-648: a fight broke out this turn, and it's the turn's answer: an ending the move
 * reached this turn is undone (the reply isn't told it, and nothing closes on it), and the reply
 * ends on the fight breaking out (Outcome.brawl: the move's closing lines are dropped).
 */
function breakOut(gm: GmState, n: number, outcome: Outcome): void {
  delete outcome.taken;
  if (gm.closing?.turn === n) delete gm.closing;
  if (gm.pendingExit?.turn === n) delete gm.pendingExit;
  outcome.brawl = true;
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

/** A stage's pressure, once offered, isn't offered again. */
export function noteReply(gm: GmState, answer: ReplyResponse): void {
  const offered = answer.gm?.offered;
  if (offered && !gm.pressureOffered.includes(offered)) gm.pressureOffered.push(offered);
}

function needs<T>(value: T | undefined, what: string): T {
  if (value === undefined || value === null) throw new Error(`the answer has no ${what}`);
  return value;
}
