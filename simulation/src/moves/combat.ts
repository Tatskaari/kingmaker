// New (docs/combat-gm.md): a fight in the conversation, in the simulation. The mouthpiece's reply
// rolls for initiative; from then on the scene goes round everyone in initiative order, each turn
// the GM's to narrate through its tools (the combat step, POST /v1/turns/combat: one tool call an
// answer). Each action is resolved here by the rules on the scene's world (its dice lines written at
// once), and the GM is asked again with what came of it; a turn's end passes the turn on, and the
// player's turn hands the scene back to them (their next line is their turn). The fight's end goes
// on to the settle, so the stage manager and the co-GM pick the scene up from how it went.

import { ACTS_A_TURN, nextTurn, overOf, whoseTurn, type CombatState, type Fighter } from "../../../shared/gm/combat.ts";
import { diceLine } from "../../../shared/gm/two-part.ts";
import type { CombatAction, CombatDone, CombatFighter, CombatResponse, Initiative, Outcome } from "../../../shared/protocol/ai.ts";
import { idOf } from "../../../shared/protocol/keys.ts";
import { blowBetween, reachOf, rollInitiative, standings, type FightMember, type Standing } from "../../../shared/rules/acts.ts";
import type { Mechanic, Rules, SceneSession } from "../../../shared/rules/types.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import type { Character } from "../../../shared/scene/types.ts";
import { applyOps, distance, positionOf, type SceneWorld } from "../../../shared/world/scene-world.ts";
import type { TxCtx } from "../context.ts";
import { rollerFor } from "../dice-row.ts";
import { afterTurn } from "../gm/background.ts";
import { putGm } from "../gm/rows.ts";
import { inPlay, playedOut } from "../rules/play.ts";
import { engineCall } from "../rules/session.ts";
import { updateTurn } from "../rows.ts";
import { addEntry, noteHeard, writeReply } from "../transcript.ts";
import { finishTurn } from "../turns.ts";
import { syncStage } from "../world/stage.ts";
import type { Next } from "./move.ts";
import type { CombatPlan, SayPlan } from "./plans.ts";
import { atTurn, resolveAct, type At } from "./say-commits.ts";

/** Close enough for a blow at arm's length: toward() stops 3 ft short, and the world rounds. */
const SLACK = 2;

/**
 * The reply rolled for initiative (its roll_for_initiative): everyone in it rolls once, the order and
 * the dice written, and the fight's first turn taken up. The player is always in it, with whoever
 * the reply put beside them; those it put against them who are here are the other side.
 */
export function startCombat(tx: TxCtx, at: At, plan: SayPlan, initiative: Initiative): Next<SayPlan> {
  const cast = presentCast(at.graph, at.gm);
  const foes = cast.filter(c => initiative.foes.includes(c.id));
  const allies = cast.filter(c => initiative.allies.includes(c.id) && !initiative.foes.includes(c.id));
  const rolled = withRules(tx, at, plan.n, (rules, session) => rollInitiative(rules, session, ["player", ...allies, ...foes]));
  for (const line of rolled.lines) addEntry(tx, at.scene, { turn: plan.n, speaker: "dice", kind: "roll", text: line });
  const side = (id: string) => (foes.some(f => f.id === id) ? "foes" : "party") as Fighter["side"];
  const state: CombatState = { started: plan.n, round: 1, order: rolled.rolls.map(r => ({ id: r.id, side: side(r.id), initiative: r.total })), at: 0, why: initiative.why };
  at.gm.combat = state;
  addEntry(tx, at.scene, { turn: plan.n, speaker: "system", kind: "system", text: `Combat! In initiative order: ${state.order.map(f => nameOf(at, f.id)).join(", ")}.` });
  tx.log(`[scene ${at.scene.id} turn ${plan.n}] combat: ${state.order.map(f => `${f.id} ${f.initiative}`).join(", ")} (${initiative.why})`);
  return turnUp(tx, at, plan, 0, true);
}

/**
 * A line said while a fight is on is the player's turn (twoPartStart's): the combat step, on them,
 * with nothing done yet.
 */
export function combatTurnPlan(tx: TxCtx, at: At, plan: SayPlan): SayPlan {
  return { ...plan, step: "combat", combat: { k: 1, done: [], ...fightNow(tx, at, plan.n) } };
}

/**
 * A combat step's answer: its narration written, then the move. An action is resolved by the rules
 * and the GM asked again, on the same turn, with what came of it; the turn's end passes the turn
 * on (to the player: the scene waits for their line); the fight's end goes on to the settle.
 */
export function afterCombat(tx: TxCtx, plan: SayPlan, answer: CombatResponse): Next<SayPlan> {
  const at = atTurn(tx, plan);
  const turnId = idOf(plan.turn);
  if (answer.entries.length) writeReply(tx, at.scene, plan.n, turnId, answer.entries);
  noteHeard(tx, at.scene, at.graph);
  const combat = at.gm.combat;
  const k = (plan.combat?.k ?? 1) + 1;
  if (!combat || answer.move.kind === "end_combat") return endCombat(tx, at, plan, answer.move.kind === "end_combat" ? answer.move : undefined);
  if (answer.move.kind === "end_turn") return passTurn(tx, at, plan, k);
  // A GM that never ends a turn doesn't hold the fight up: past twice the turn's actions, it passes on.
  if ((plan.combat?.done.length ?? 0) >= 2 * ACTS_A_TURN) { tx.log(`[scene ${at.scene.id} turn ${plan.n}] combat: ${whoseTurn(combat).id}'s turn passed on after ${plan.combat!.done.length} actions`); return passTurn(tx, at, plan, k); }

  const done = resolve(tx, at, plan, answer.move.act);
  putGm(tx, at.scene.id, at.gm);
  const fight = fightNow(tx, at, plan.n);
  return { done: false, plan: { ...plan, step: "combat", combat: { k, done: [...(plan.combat?.done ?? []), done], ...fight } } };
}

// ---------------------------------------------------------------------------------------------
// The turn order.

/** The turn passes on: to the next still fighting (a new round when it comes round), or the fight is over. */
function passTurn(tx: TxCtx, at: At, plan: SayPlan, k: number): Next<SayPlan> {
  const combat = at.gm.combat!;
  const down = downOf(tx, at, plan.n);
  const next = overOf(combat, down) ? undefined : nextTurn(combat, down);
  if (!next) return overStep(tx, at, plan, k);
  if (next.round > combat.round) addEntry(tx, at.scene, { turn: plan.n, speaker: "system", kind: "system", text: `Round ${next.round}.` });
  at.gm.combat = next;
  return turnUp(tx, at, plan, k, false);
}

/**
 * Whoever's turn it is now takes it: the player's hands the scene back (the turn is done, and their
 * next line is their turn), anyone else's is the combat step on them. One who can't (down, gone) is
 * passed over, and a fight the rules say is over goes to its end.
 */
function turnUp(tx: TxCtx, at: At, plan: SayPlan, k: number, starting: boolean): Next<SayPlan> {
  const combat = at.gm.combat!;
  const down = downOf(tx, at, plan.n);
  if (overOf(combat, down)) return overStep(tx, at, plan, Math.max(k, 1));
  const f = whoseTurn(combat);
  if (f.out || down.has(f.id)) {
    const next = nextTurn(combat, down);
    if (!next) return overStep(tx, at, plan, Math.max(k, 1));
    at.gm.combat = next;
    return turnUp(tx, at, plan, k, starting);
  }
  putGm(tx, at.scene.id, at.gm);
  if (f.id === "player") return playersTurn(tx, at, plan);
  return { done: false, plan: { ...plan, step: "combat", combat: { k: Math.max(k, 1), done: [], ...fightNow(tx, at, plan.n) } } };
}

/** The player's turn: the scene waits for their line, which is it. */
function playersTurn(tx: TxCtx, at: At, plan: SayPlan): Next<SayPlan> {
  addEntry(tx, at.scene, { turn: plan.n, speaker: "system", kind: "system", text: "Your turn." });
  tx.log(`[scene ${at.scene.id} turn ${plan.n}] combat: round ${at.gm.combat!.round}, the player's turn`);
  afterTurn(tx, plan);
  finishTurn(tx, at.scene.id, idOf(plan.turn));
  return { done: true };
}

/** The rules say the fight is over: one more combat step, for the GM to end it (end_combat). */
function overStep(tx: TxCtx, at: At, plan: SayPlan, k: number): Next<SayPlan> {
  putGm(tx, at.scene.id, at.gm);
  return { done: false, plan: { ...plan, step: "combat", combat: { k, done: [], ...fightNow(tx, at, plan.n) } } };
}

/**
 * The fight is over: its system line, the fight off the bookkeeping, and the turn on to the settle,
 * with the end's narration as the reply, so the stage manager keeps the world in step and the co-GM
 * takes the scene on from how it went.
 */
function endCombat(tx: TxCtx, at: At, plan: SayPlan, ended: { outcome: string; narration: string } | undefined): Next<SayPlan> {
  const outcome = ended?.outcome ?? "stopped";
  addEntry(tx, at.scene, { turn: plan.n, speaker: "system", kind: "system", text: `The fight is over (${OUTCOME_WORDS[outcome] ?? outcome}).` });
  const rounds = at.gm.combat?.round ?? 0;
  delete at.gm.combat;
  syncStage(tx, at.scene, at.graph, at.gm);
  putGm(tx, at.scene.id, at.gm);
  updateTurn(tx, idOf(plan.turn), { phase: "settling" });
  tx.log(`[scene ${at.scene.id} turn ${plan.n}] combat over after ${rounds} round(s): ${outcome}`);
  const reply = `The fight is over: ${OUTCOME_WORDS[outcome] ?? outcome}. ${ended?.narration ?? ""}`.trim();
  return { done: false, plan: { ...plan, step: "settle", reply, lines: [...plan.lines, ...(plan.combat?.done ?? []).flatMap(d => d.lines)] } };
}

const OUTCOME_WORDS: Record<string, string> = { won: "you won", lost: "you lost", yielded: "they gave up", fled: "you got away", stopped: "everyone stopped" };

// ---------------------------------------------------------------------------------------------
// An action, resolved.

/** An action on the current fighter's turn, resolved by the rules on the scene's world: what was asked, its dice lines, what came of it. */
function resolve(tx: TxCtx, at: At, plan: SayPlan, act: CombatAction): CombatDone {
  const f = whoseTurn(at.gm.combat!);
  const refused = refusalOf(tx, at, plan.n, f.id, act);
  if (refused) {
    tx.log(`[scene ${at.scene.id} turn ${plan.n}] combat: ${f.id}'s ${act.action} refused: ${refused}`);
    return { act, lines: [], result: refused, refused: true };
  }
  const out = act.action === "move" ? move(tx, at, plan.n, f.id, act)
    : act.action === "flee" || act.action === "surrender" ? leaves(tx, at, plan.n, f, act.action)
    : act.action === "other" ? { lines: [], result: "Done: no dice." }
    : act.action === "check" ? check(tx, at, plan.n, act)
    : f.id === "player" ? playersAct(tx, at, plan, act)
    : theirBlow(tx, at, plan.n, f.id, act.target!);
  tx.log(`[scene ${at.scene.id} turn ${plan.n}] combat: ${f.id} ${act.action}${act.target ? ` ${act.target}` : ""}: ${out.result}`);
  return { act, ...out };
}

/** What the rules refuse before anything is rolled: a target nobody knows, a blow or a hold from out of reach, what the cast can't do. */
function refusalOf(tx: TxCtx, at: At, n: number, who: string, act: CombatAction): string | undefined {
  const world = worldOf(tx, at, n);
  if (act.target && act.target !== "self" && !world?.entities[act.target]) return `There's no ${act.target} here: ids in the fight are ${at.gm.combat!.order.map(f => f.id).join(", ")}.`;
  if (!["attack", "grapple", "shove"].includes(act.action) || !act.target || !world) return undefined;
  if (act.target === who) return "Nobody attacks themselves.";
  const feet = apart(world, who, act.target);
  const reach = act.action === "attack" ? reachFor(tx, at, n, who, act.weapon) : { melee: true, feet: 5 };
  if (act.weapon === "improvised" || !reach.melee || feet === undefined || feet <= reach.feet + SLACK) return undefined;
  return `Out of reach: ${nameOf(at, act.target)} is ${feet} ft away, and ${act.action === "attack" ? "a melee blow reaches" : "hands reach"} 5 ft. move_towards first (or end the turn).`;
}

/** A move up to their speed, towards someone or something (they stop beside them) or away from it, in the place's world. */
function move(tx: TxCtx, at: At, n: number, who: string, act: CombatAction): { lines: string[]; result: string } {
  const played = inPlay(tx, at.scene, at.graph, at.gm, n);
  const world = played.place.world;
  const speed = reachFor(tx, at, n, who).speed;
  const before = apart(world, who, act.target!) ?? 0;
  const blank = { name: "", kind: "", text: "", add: [], remove: [] };
  applyOps(world, [{ ...blank, op: "place", what: who, to: act.target!, how: act.away ? "away" : "toward", feet: speed }], n, "rules");
  playedOut(tx, at.scene, at.graph, at.gm, played);
  const after = apart(world, who, act.target!) ?? 0;
  const beside = after <= 5 + SLACK;
  return { lines: [], result: `${nameOf(at, who)} moved ${Math.abs(before - after)} ft ${act.away ? "back from" : "towards"} ${nameOf(at, act.target!)}: now ${beside ? "beside them" : `${after} ft away`}.` };
}

/** Fleeing or giving up: out of the fight (one of the cast who flees is gone from the scene, as the reactions' flight is). */
function leaves(tx: TxCtx, at: At, n: number, f: Fighter, how: "flee" | "surrender"): { lines: string[]; result: string } {
  f.out = how === "flee" ? "fled" : "yielded";
  if (how === "flee" && f.id !== "player") {
    const played = inPlay(tx, at.scene, at.graph, at.gm, n);
    const e = played.place.world.entities[f.id];
    if (e) e.states = [...e.states.filter(s => s !== "cowering"), "gone"];
    played.session.absent = [...new Set([...(played.session.absent ?? []), f.id])];
    playedOut(tx, at.scene, at.graph, at.gm, played);
  }
  return { lines: [], result: `${nameOf(at, f.id)} ${how === "flee" ? "flees: out of the fight" : "gives up: out of the fight"}.` };
}

/** A stunt the dice decide: the player's check, rolled as every check is (rollerFor), its dice line written. */
function check(tx: TxCtx, at: At, n: number, act: CombatAction): { lines: string[]; result: string } {
  const roll = rollerFor(tx, at.scene)(act.skill!, act.dc!);
  const line = diceLine(roll);
  addEntry(tx, at.scene, { turn: n, speaker: "dice", kind: "roll", text: line });
  return { lines: [line], result: roll.success ? `Success: ${act.skill} ${roll.total} against DC ${act.dc}.` : `Failure: ${act.skill} ${roll.total} against DC ${act.dc}.` };
}

/** The player's act, as the rules resolve any act of theirs in a scene (takeAct, without the reactions: the fight is the reaction). */
function playersAct(tx: TxCtx, at: At, plan: SayPlan, act: CombatAction): { lines: string[]; result: string } {
  const m: Mechanic = act.action === "cast" ? { kind: "cast", spell: act.spell!, targets: act.target ? [act.target] : ["self"] }
    : act.action === "attack" ? { kind: "attack", target: act.target!, ...(act.weapon ? { weapon: act.weapon } : {}) }
    : act.action === "feature" ? { kind: "feature", feature: act.feature!, ...(act.target ? { target: act.target } : {}) }
    : { kind: "wrestle", target: act.target!, how: act.action === "grapple" ? "grapple" : "prone" };
  const outcome: Outcome = { lines: [], directives: [] };
  const resolved = resolveAct(tx, at, { n: plan.n, input: act.narration }, m, outcome);
  return { lines: resolved.acted.lines, result: plainly(outcome.acts?.join(" ") || (resolved.acted.lines.length ? "" : "Nothing happened: the rules found nothing to do.")) };
}

/** One of the cast's blows, with their own weapon, at someone in the fight: its dice lines written. */
function theirBlow(tx: TxCtx, at: At, n: number, who: string, target: string): { lines: string[]; result: string } {
  const attacker = castOf(at, who)!;
  const victim: FightMember = target === "player" ? "player" : castOf(at, target) ?? "player";
  const out = withRules(tx, at, n, (rules, session) => blowBetween(rules, session, attacker, victim));
  for (const line of out.lines) addEntry(tx, at.scene, { turn: n, speaker: "dice", kind: "roll", text: line });
  return { lines: out.lines, result: out.directive };
}

/** A rules directive as a result the GM reads: what happened, without the narrating instructions meant for a reply. */
const plainly = (directive: string) => directive.replace(/^Rules: /, "").split(/(?<=\.)\s+(?=Narrate|Then let|A single blow|If this becomes)/)[0]!.trim();

// ---------------------------------------------------------------------------------------------
// The fight as it stands.

/** Everyone in the fight as the GM sees them now (rules, world), and whether the rules say it's over. */
function fightNow(tx: TxCtx, at: At, n: number): Pick<CombatPlan, "fighters" | "over"> {
  const combat = at.gm.combat!;
  const stand = standingsOf(tx, at, n);
  const world = worldOf(tx, at, n);
  const fighters = combat.order.map((f): CombatFighter => {
    const s = stand.find(x => x.id === f.id)!;
    const feet = Object.fromEntries(combat.order.filter(o => o.id !== f.id && world).map(o => [o.id, apart(world!, f.id, o.id) ?? 0]));
    return {
      id: f.id, name: nameOf(at, f.id), side: f.side, initiative: f.initiative, hurt: s.hurt, hp: s.hp, max: s.max, ac: s.ac, down: s.hp <= 0,
      ...(f.out ? { out: f.out } : {}), reach: reachFor(tx, at, n, f.id), feet,
    };
  });
  const over = overOf(combat, new Set(fighters.filter(f => f.down).map(f => f.id)));
  return { fighters, ...(over ? { over } : {}) };
}

/** Who's down now, by the rules. */
const downOf = (tx: TxCtx, at: At, n: number) => new Set(standingsOf(tx, at, n).filter(s => s.hp <= 0).map(s => s.id));

/** How everyone in the fight stands, read on a session that isn't kept (the rules' characters are made at initiative). */
function standingsOf(tx: TxCtx, at: At, n: number): Standing[] {
  const played = inPlay(tx, at.scene, at.graph, at.gm, n);
  return engineCall(tx, at.scene.gameId, rules => standings(rules, played.session, membersOf(at)));
}

/** Someone's reach and speed, read on a session that isn't kept. */
function reachFor(tx: TxCtx, at: At, n: number, who: string, weapon?: string): { melee: boolean; feet: number; speed: number } {
  const played = inPlay(tx, at.scene, at.graph, at.gm, n);
  const m: FightMember = who === "player" ? "player" : castOf(at, who) ?? "player";
  return engineCall(tx, at.scene.gameId, rules => reachOf(rules, played.session, m, weapon));
}

/** A rules call on the scene's session, its changes written back (the dice, the campaign, the world). */
function withRules<T>(tx: TxCtx, at: At, n: number, fn: (rules: Rules, session: SceneSession) => T): T {
  const played = inPlay(tx, at.scene, at.graph, at.gm, n);
  const out = engineCall(tx, at.scene.gameId, rules => fn(rules, played.session));
  playedOut(tx, at.scene, at.graph, at.gm, played);
  return out;
}

const worldOf = (tx: TxCtx, at: At, n: number): SceneWorld | undefined => inPlay(tx, at.scene, at.graph, at.gm, n).place.world;

/** How far apart two in the world are, in whole feet (undefined when either has no place). */
function apart(world: SceneWorld, a: string, b: string): number | undefined {
  const p = positionOf(world, a), q = positionOf(world, b);
  return p && q ? Math.round(distance(p, q)) : undefined;
}

const castOf = (at: At, id: string): Character | undefined => at.graph.cast.find(c => c.id === id);
const membersOf = (at: At): FightMember[] => at.gm.combat!.order.map(f => (f.id === "player" ? "player" : castOf(at, f.id) ?? "player"));
const nameOf = (at: At, id: string) => (id === "player" ? "you" : castOf(at, id)?.name ?? id);
