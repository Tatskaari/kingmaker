import type { GmState } from "../../../shared/gm/state.ts";
import type { ActResponse, Outcome, ReactionsResponse, ReplyResponse, TurnAct } from "../../../shared/protocol/ai.ts";
import { idOf } from "../../../shared/protocol/keys.ts";
import { attack, castSpell, dispelConjured, rest, useFeature, wrestle, type RulesOutcome } from "../../../shared/rules/acts.ts";
import { leap, moveToAct, react, violence } from "../../../shared/rules/scene-acts.ts";
import type { Act, Mechanic, Reaction, Rules } from "../../../shared/rules/types.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import type { Exit, Scene } from "../../../shared/scene/types.ts";
import type { TxCtx } from "../context.ts";
import { getGm, putGm } from "../gm/rows.ts";
import { sceneRow, updateScene, updateTurn, type SceneRow } from "../rows.ts";
import { inPlay, playedOut } from "../rules/play.ts";
import { engineCall } from "../rules/session.ts";
import { sceneGraph } from "../scenes.ts";
import { closeScene } from "../story/end.ts";
import { addEntry } from "../transcript.ts";
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
 * The act step's commit: what the rules resolve of the player's line, as the AI service read it
 * (POST /v1/turns/act: the mechanic question, then the act's details), resolved by the rules on the
 * scene's world (resolveAct: its dice lines in the transcript before the reply, its directive the
 * reply's, the world, the character and the sheet written), as the map's act is; nothing, when the
 * line wasn't an act after all. Then the reactions of whoever saw it, when it was violence, or the
 * reply.
 */
export function afterAct(tx: TxCtx, plan: SayPlan, answer: ActResponse): Next<SayPlan> {
  const at = atTurn(tx, plan);
  const outcome: Outcome = { ...needs(plan.outcome, "outcome"), lines: [...plan.lines] };
  const resolved = answer.mechanic ? resolveAct(tx, at, plan, answer.mechanic, outcome) : undefined;
  if (!resolved) tx.log(`[scene ${at.scene.id} turn ${plan.n}] the line wasn't an act the rules resolve (${plan.acting ?? "asked"})`);

  putGm(tx, at.scene.id, at.gm);
  const read = answer.mechanic ? { read: answer.mechanic } : {};
  return { done: false, plan: beforeReply({ ...plan, ...read, outcome, lines: outcome.lines }, resolved) };
}

/**
 * The reactions step's commit (engine.ts:637-656): everyone who saw the player's violence (`plan.act`,
 * what takeAct found it to be) reacts as the AI service decided (reactionsTakeEffect: the fleeing
 * leave the place, the cowering cower; someone who'd fight turns on the player, but no fight starts:
 * that's the scene's routes' and the co-GM's). Then the two-part GM's reply, its directives the act's
 * and the reactions' after the rules', and the reactions kept for the co-GM with the act's lines.
 */
export function afterReactions(tx: TxCtx, plan: SayPlan, answer: ReactionsResponse): Next<SayPlan> {
  const at = atTurn(tx, plan);
  const outcome: Outcome = { ...needs(plan.outcome, "outcome"), lines: [...plan.lines] };
  const reactions = answer.reactions ?? {};

  if (Object.keys(reactions).length) reactionsTakeEffect(tx, at, plan, needs(plan.act, "act"), reactions, answer.directive, outcome);
  if (at.gm.brawl?.turn === plan.n) outcome.brawl = true;

  putGm(tx, at.scene.id, at.gm);
  updateTurn(tx, idOf(plan.turn), { phase: "replying" });
  const acted = plan.acted && Object.keys(reactions).length ? { acted: { ...plan.acted, reactions } } : {};
  return { done: false, plan: { ...plan, ...acted, step: "reply", outcome, lines: outcome.lines } };
}

/** The player's act resolved (takeAct), and what it came to: the violence people react to, if it was, and its dice lines for the co-GM. */
export interface Resolved { act?: Act; acted: TurnAct }

/** takeAct's act, with the dice lines it wrote (TurnAct: the co-GM is told them). */
export function resolveAct(tx: TxCtx, at: At, plan: Pick<SayPlan, "n" | "input" | "rulesFirst">, m: Mechanic, outcome: Outcome): Resolved {
  const before = outcome.lines.length;
  const act = takeAct(tx, at, plan, m, outcome);
  return { ...(act ? { act } : {}), acted: { lines: outcome.lines.slice(before) } };
}

/** What comes before the reply once the act is resolved: the reactions of whoever saw it, when it was violence; else the reply. */
export function beforeReply(plan: SayPlan, resolved: Resolved | undefined): SayPlan {
  const acted = resolved ? { acted: resolved.acted } : {};
  return resolved?.act ? { ...plan, ...acted, step: "reactions", act: resolved.act } : { ...plan, ...acted, step: "reply" };
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
// The turn's parts.

export function atTurn(tx: TxCtx, plan: Pick<SayPlan, "scene">): At {
  const scene = sceneRow(tx, idOf(plan.scene));
  const gm = getGm(tx, scene.id);
  return { scene, graph: sceneGraph(tx, scene, gm), gm };
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
 * (not while a fight is on already): the reactions step's act. Not when the blow before their turn
 * put them down (it doesn't happen), nor a Shield already raised against it.
 */
export function takeAct(tx: TxCtx, at: At, plan: Pick<SayPlan, "n" | "input" | "rulesFirst">, m: Mechanic, outcome: Outcome): Act | undefined {
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
  // Violence draws a reaction from everyone present: some fight, some flee, some run for help (not while a fight is on already).
  const act = !at.gm.brawl && !at.gm.fight ? engine(rules => violence(rules, at.graph, session, m, before)) : undefined;

  playedOut(tx, at.scene, at.graph, at.gm, played);
  tx.log(`[rules] act ${m.kind} ${Math.round(tx.elapsedMs() - started)} ms: ${result.lines.length} dice lines${act ? `; violence: ${act.what}` : ""}`);
  return act;
}

// ---------------------------------------------------------------------------------------------
// afterReactions' parts.

/** engine.ts:641-650: the reactions take effect on the world and the GM's bookkeeping (who left the stage; no fight starts), their directive after the act's, their step on the path. */
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

/** A stage's pressure, once offered, isn't offered again. */
export function noteReply(gm: GmState, answer: ReplyResponse): void {
  const offered = answer.gm?.offered;
  if (offered && !gm.pressureOffered.includes(offered)) gm.pressureOffered.push(offered);
}

function needs<T>(value: T | undefined, what: string): T {
  if (value === undefined || value === null) throw new Error(`the answer has no ${what}`);
  return value;
}
