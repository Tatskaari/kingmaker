// New (docs/combat-gm.md): a fight in the conversation, in the simulation. The mouthpiece's reply
// rolls for initiative; from then on the scene goes round everyone in initiative order, each turn
// the GM's to narrate through its tools (the combat step, POST /v1/turns/combat: one tool call an
// answer). Each action is resolved here by the rules on the scene's world (its dice lines written at
// once), and the GM is asked again with what came of it; a turn's end passes the turn on, and the
// player's turn hands the scene back to them (their next line is their turn). The fight's end goes
// on to the settle, so the stage manager and the co-GM pick the scene up from how it went.

import { ACTS_A_TURN, nextTurn, overOf, whoseTurn, type CombatState, type Fighter } from "../../../shared/gm/combat.ts";
import { diceLine } from "../../../shared/gm/two-part.ts";
import type { CombatAction, CombatDone, CombatFighter, CombatNewcomer, CombatResponse, Initiative, Outcome } from "../../../shared/protocol/ai.ts";
import { idOf } from "../../../shared/protocol/keys.ts";
import { blowBetween, bystander, reachOf, rollInitiative, standings, standUp, type FightMember, type Standing } from "../../../shared/rules/acts.ts";
import type { Mechanic, Rules, SceneSession } from "../../../shared/rules/types.ts";
import { fightsAhead, storyNeeds, takeRoute } from "../../../shared/scene/beats.ts";
import { fighterOf, presentCast, presentFighters } from "../../../shared/scene/graph.ts";
import type { Character } from "../../../shared/scene/types.ts";
import { applyOps, distance, joinWorld, positionOf, type SceneWorld } from "../../../shared/world/scene-world.ts";
import type { TxCtx } from "../context.ts";
import { rollerFor } from "../dice-row.ts";
import { afterTurn } from "../gm/background.ts";
import { putGm } from "../gm/rows.ts";
import { inPlay, playedOut } from "../rules/play.ts";
import { engineCall } from "../rules/session.ts";
import { updateTurn } from "../rows.ts";
import { beingCalled, unnamed } from "../../../shared/scene/names.ts";
import { addEntry, entriesOf, noteHeard, writeReply } from "../transcript.ts";
import { finishTurn } from "../turns.ts";
import { syncStage } from "../world/stage.ts";
import type { Next } from "./move.ts";
import type { CombatPlan, SayPlan } from "./plans.ts";
import { atTurn, resolveAct, type At } from "./say-commits.ts";

/** Close enough for a blow at arm's length: toward() stops 3 ft short, and the world rounds. */
const SLACK = 2;

/**
 * A fight breaks out (the reply's roll_for_initiative, or the co-GM's move into an event with a
 * fight): its sides, everyone on one rolling once for initiative (the order and the dice written),
 * and the fight's first turn taken up. The player is always in it. With them are whoever follows
 * them (the companion, unless the reply set them against the player or had them run) and whoever
 * the reply put beside them; against them, those it put against them who are here; and whoever it
 * had run from it runs (gone from the scene). One that breaks out in the reply while a fight of the
 * scene's prep is on offer (fightsAhead: the Heron's blades out) is that one: the scene goes there
 * by its route, and its line-up fights too. Everyone else here picks a side, or runs, as the GM
 * says before the first turn (pick_sides). Undefined, and nothing started, when nobody here is
 * against the player or could be.
 */
export function startCombat(tx: TxCtx, at: At, plan: SayPlan, initiative: Initiative, from: "reply" | "settle" = "reply"): Next<SayPlan> | undefined {
  const pool = fightersHere(tx, at, plan.n);
  const ahead = from === "reply" ? fightsAhead(at.graph, at.gm)[0] : undefined;
  const beat = from === "settle" ? at.graph.beats.find(b => b.id === at.gm.beat && b.fight) : ahead?.beat;
  const foeIds = new Set([...initiative.foes, ...(beat?.fight?.foes ?? [])]);
  const fleeIds = new Set((initiative.flee ?? []).filter(id => !foeIds.has(id)));
  const allyIds = new Set([...initiative.allies, ...(beat?.fight?.allies ?? []), ...companionsHere(tx, at).filter(id => !fleeIds.has(id))]);
  // Whoever the reply put on no side who reacted to the player's violence this turn keeps the side their reaction took: going for the player, taking their side, running.
  const reacted = plan.acted?.reactions ?? {};
  for (const [id, how] of Object.entries(reacted)) {
    if (foeIds.has(id) || allyIds.has(id) || fleeIds.has(id)) continue;
    if (how === "fight") foeIds.add(id);
    else if (how === "join_player") allyIds.add(id);
    else if (how === "flee" || how === "raise_alarm") fleeIds.add(id);
  }
  const foes = pool.filter(c => foeIds.has(c.id));
  const allies = pool.filter(c => allyIds.has(c.id) && !foeIds.has(c.id) && !fleeIds.has(c.id));
  const running = pool.filter(c => fleeIds.has(c.id) && !allies.includes(c) && able(tx, at, plan.n, c.id));
  // Those named are in it even if already down (the player's blow felled Cob before initiative); the rest who can pick, pick.
  const pending = pool.filter(c => !foes.includes(c) && !allies.includes(c) && !running.includes(c) && able(tx, at, plan.n, c.id)).map(c => c.id);
  if (!foes.length && !pending.length) { tx.log(`[scene ${at.scene.id} turn ${plan.n}] no fight: nobody here is against the player (${[...foeIds].join(", ") || "none named"})`); return undefined; }
  if (ahead) {
    const taken = takeRoute(at.graph, at.gm, ahead.route.id, "none", plan.n);
    if ("error" in taken) tx.log(`[scene ${at.scene.id} turn ${plan.n}] the fight is ${ahead.beat.id}'s, but its route ${ahead.route.id} was refused: ${taken.error}`);
    else { at.gm = taken.gm; tx.log(`[scene ${at.scene.id} turn ${plan.n}] the fight is ${ahead.beat.id}'s: ${ahead.route.id}`); }
  }
  closeIn(tx, at, plan, [...foes, ...allies].map(c => c.id));
  rouse(tx, at, plan.n, [...foes, ...allies].map(c => c.id));
  const rolled = withRules(tx, at, plan.n, (rules, session) => rollInitiative(rules, session, ["player", ...allies, ...foes]));
  for (const line of rolled.lines) addEntry(tx, at.scene, { turn: plan.n, speaker: "dice", kind: "roll", text: line });
  const side = (id: string) => (foes.some(f => f.id === id) ? "foes" : "party") as Fighter["side"];
  const here = new Set(pool.map(c => c.id));
  const already = (at.graph.reinforcements ?? []).filter(r => here.has(r.id)).map(r => r.id);
  const state: CombatState = {
    started: plan.n, round: 1, order: rolled.rolls.map(r => ({ id: r.id, side: side(r.id), initiative: r.total })), at: 0, why: initiative.why || beat?.title || "",
    ...(pending.length ? { pending } : {}),
    ...(already.length ? { arrived: already } : {}),
    ...(from === "settle" ? { from } : {}),
  };
  at.gm.combat = state;
  const ran = ranWords(tx, at, plan.n, running.map(c => ({ id: c.id, how: runsOff(tx, at, plan.n, c.id) })));
  addEntry(tx, at.scene, { turn: plan.n, speaker: "system", kind: "system", text: [`Combat! In initiative order: ${state.order.map(f => nameOf(tx, at, plan.n, f.id)).join(", ")}.`, ...ran].join(" ") });
  tx.log(`[scene ${at.scene.id} turn ${plan.n}] combat: ${state.order.map(f => `${f.id} ${f.initiative}`).join(", ")}${running.length ? `; running: ${running.map(c => c.id).join(", ")}` : ""}${pending.length ? `; no side yet: ${pending.join(", ")}` : ""} (${state.why})`);
  return turnUp(tx, at, plan, 0, true);
}

/**
 * Someone who runs from the fight as it breaks out, or as they pick their side: out of it and away
 * from the scene (as a reaction's flight is), "away". Not one who keeps the story going (keepers:
 * whoever walks with the player, whoever holds what the player still needs): they're out of the
 * fight and keep clear of it, here when it's over, "clear" (the smoke test: Kell put to flight in the
 * yard, gone from the scene the story needs her in).
 */
function runsOff(tx: TxCtx, at: At, n: number, id: string): "away" | "clear" {
  const combat = at.gm.combat!;
  combat.fled = [...new Set([...(combat.fled ?? []), id])];
  const played = inPlay(tx, at.scene, at.graph, at.gm, n);
  const e = played.place.world.entities[id];
  const stays = keepers(tx, at).has(id);
  if (stays) { if (e) e.states = [...e.states.filter(s => s !== "cowering"), "cowering"]; }
  else {
    if (e) e.states = [...e.states.filter(s => s !== "cowering" && s !== AWAY), AWAY];
    played.session.absent = [...new Set([...(played.session.absent ?? []), id])];
  }
  playedOut(tx, at.scene, at.graph, at.gm, played);
  return stays ? "clear" : "away";
}

/** Whoever joins the fight is up and in it: not asleep, nor cowering, in the world (QA round hobo1-1018: Duchess fought on the map's key as "asleep"). */
function rouse(tx: TxCtx, at: At, n: number, ids: string[]): void {
  const played = inPlay(tx, at.scene, at.graph, at.gm, n);
  let changed = false;
  for (const id of ids) {
    const e = played.place.world.entities[id];
    if (!e || !e.states.some(s => s === "asleep" || s === "cowering")) continue;
    e.states = e.states.filter(s => s !== "asleep" && s !== "cowering");
    changed = true;
  }
  if (changed) playedOut(tx, at.scene, at.graph, at.gm, played);
}

/**
 * Who doesn't leave the scene when they run from a fight: whoever walks with the player (the story's
 * followers, and those the scene's own endings have follow them: Kell in the yard), and whoever
 * holds a discovery the scene can't end well without that the player hasn't made yet (its paths'
 * people: Scrope and the true book), so a fight never takes the story's lead or its proof away.
 */
function keepers(tx: TxCtx, at: At): Set<string> {
  return new Set([...companionsHere(tx, at), ...storyNeeds(at.graph, at.gm)]);
}

/** Who ran from the fight, in words: those away from the scene, and those keeping clear of it. */
function ranWords(tx: TxCtx, at: At, n: number, ran: Array<{ id: string; how: "away" | "clear" }>): string[] {
  const names = (how: "away" | "clear") => ran.filter(r => r.how === how).map(r => nameOf(tx, at, n, r.id));
  return [
    ...(names("away").length ? [`Running from it: ${names("away").join(", ")}.`] : []),
    ...(names("clear").length ? [`Keeping clear of it: ${names("clear").join(", ")}.`] : []),
  ];
}

/** The world's state for someone who has left the place. */
const AWAY = "gone";

/**
 * The sides the GM picked (pick_sides) for everyone who had none: each who joins rolls for
 * initiative and takes their place in the order (the round goes on from its top, so one quicker
 * than all the rest goes first), and each who runs is away. Their system line and dice.
 */
function sidesPicked(tx: TxCtx, at: At, n: number, sides: Record<string, string>): void {
  const combat = at.gm.combat!;
  const pending = combat.pending ?? [];
  const world = worldOf(tx, at, n);
  const joining = pending.filter(id => sides[id] === "with_player" || sides[id] === "against_player").map(id => castOf(at, id, world)).filter((c): c is Character => !!c);
  const running = pending.filter(id => !joining.some(c => c.id === id));
  delete combat.pending;
  const ran = running.map(id => ({ id, how: runsOff(tx, at, n, id) }));
  if (joining.length) {
    rouse(tx, at, n, joining.map(c => c.id));
    const rolled = withRules(tx, at, n, (rules, session) => rollInitiative(rules, session, joining));
    for (const line of rolled.lines) addEntry(tx, at.scene, { turn: n, speaker: "dice", kind: "roll", text: line });
    const now = at.gm.combat!;
    const order: Fighter[] = [...now.order, ...rolled.rolls.map(r => ({ id: r.id, side: (sides[r.id] === "against_player" ? "foes" : "party") as Fighter["side"], initiative: r.total }))]
      .sort((a, b) => b.initiative - a.initiative);
    // Nobody has had a turn this round yet (they're picked as it breaks out, or arrive at a round's top): it goes on from its top.
    const down = downOf(tx, at, n);
    const top = order.findIndex(f => !f.out && !down.has(f.id));
    at.gm.combat = { ...now, order, at: Math.max(0, top) };
  }
  tx.log(`[scene ${at.scene.id} turn ${n}] combat: sides picked: ${joining.map(c => `${c.id} ${sides[c.id]}`).join(", ") || "nobody joins"}${running.length ? `; running: ${running.join(", ")}` : ""}`);
  const words = [
    ...(joining.length ? [`Joining the fight: ${joining.map(c => `${nameOf(tx, at, n, c.id)} (${sides[c.id] === "against_player" ? "against you" : "with you"})`).join(", ")}.`] : []),
    ...ranWords(tx, at, n, ran),
  ];
  if (words.length) addEntry(tx, at.scene, { turn: n, speaker: "system", kind: "system", text: words.join(" ") });
}

/**
 * The scene's reinforcements due as a round starts (after their `after` rounds of fighting), who
 * haven't come and haven't left: each in at the way in (one of the cast, there from now, a group
 * with its members; someone new, a person in the place's world with their own statblock), with no
 * side yet, for the GM to pick before the round's first turn. Their system line.
 */
function arrivals(tx: TxCtx, at: At, n: number): void {
  const combat = at.gm.combat!;
  const played = inPlay(tx, at.scene, at.graph, at.gm, n);
  const world = played.place.world;
  const inFight = new Set([...combat.order.map(f => f.id), ...(combat.fled ?? []), ...(combat.pending ?? [])]);
  const due = (at.graph.reinforcements ?? []).filter(r => r.after + 1 <= combat.round && !combat.arrived?.includes(r.id) && !inFight.has(r.id)
    && !world.entities[r.id]?.states.includes(AWAY) && !(played.session.absent ?? []).includes(r.id));
  if (!due.length) return;
  for (const r of due) {
    const card = at.graph.cast.find(c => c.id === r.id);
    joinWorld(world, [{ id: r.id, name: card?.name ?? r.name ?? r.id, ...(card?.members ? { members: card.members } : {}) }], n);
    const e = world.entities[r.id]!;
    if (card) { e.cast = card.id; at.gm.entered = [...new Set([...(at.gm.entered ?? []), card.id])]; }
    else e.stats = { statblock: r.statblock ?? "commoner", ...(r.weapon ? { weapon: r.weapon } : {}) };
    if (!card && r.look) e.description = r.look;
  }
  playedOut(tx, at.scene, at.graph, at.gm, played);
  const members = due.flatMap(r => at.graph.cast.find(c => c.id === r.id)?.members?.map(m => m.id) ?? []);
  at.gm.combat = { ...combat, arrived: [...(combat.arrived ?? []), ...due.map(r => r.id)], pending: [...(combat.pending ?? []), ...due.map(r => r.id), ...members] };
  syncStage(tx, at.scene, at.graph, at.gm);
  addEntry(tx, at.scene, { turn: n, speaker: "system", kind: "system", text: `Arriving: ${due.map(r => nameOf(tx, at, n, r.id)).join(", ")}.` });
  tx.log(`[scene ${at.scene.id} turn ${n}] combat: round ${combat.round}, arriving: ${due.map(r => r.id).join(", ")}`);
}

/**
 * A fight that breaks out on the player's own blow or grab this turn starts with them beside its
 * target (toll1-1018: a rapier run into the man with the cup at arm's length, outside the fight,
 * left the world's player 25 feet off, and the first turn of the fight went on crossing the sand).
 */
function closeIn(tx: TxCtx, at: At, plan: SayPlan, fighters: string[]): void {
  const m = plan.forced ?? plan.read;
  const target = m && (m.kind === "attack" || m.kind === "wrestle") && fighters.includes(m.target) ? m.target : undefined;
  if (!target || (m!.kind === "attack" && !reachFor(tx, at, plan.n, "player", m!.weapon).melee)) return;
  const played = inPlay(tx, at.scene, at.graph, at.gm, plan.n);
  const blank = { name: "", kind: "", text: "", add: [], remove: [] };
  applyOps(played.place.world, [{ ...blank, op: "place", what: "player", to: target, how: "toward", feet: 999 }], plan.n, "rules");
  playedOut(tx, at.scene, at.graph, at.gm, played);
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
  const combat = at.gm.combat;
  const k = (plan.combat?.k ?? 1) + 1;
  const said = () => { if (answer.entries.length) writeReply(tx, at.scene, plan.n, turnId, answer.entries); noteHeard(tx, at.scene, at.graph); };
  if (!combat || answer.move.kind === "end_combat") { said(); return endCombat(tx, at, plan, answer.move.kind === "end_combat" ? answer.move : undefined); }
  if (answer.move.kind === "end_turn") { said(); return passTurn(tx, at, plan, k); }
  if (answer.move.kind === "sides") { said(); sidesPicked(tx, at, plan.n, answer.move.sides); return turnUp(tx, at, plan, k, false); }
  // A GM that never ends a turn doesn't hold the fight up: past twice the turn's actions, it passes on.
  if ((plan.combat?.done.length ?? 0) >= 2 * ACTS_A_TURN) { tx.log(`[scene ${at.scene.id} turn ${plan.n}] combat: ${whoseTurn(combat).id}'s turn passed on after ${plan.combat!.done.length} actions`); return passTurn(tx, at, plan, k); }

  // An action's attempt is narrated before its dice, unless the rules refuse it (the GM is told why, and tries again).
  const act = answer.move.act;
  const refused = refusalOf(tx, at, plan.n, whoseTurn(combat).id, act);
  if (!refused) said();
  else tx.db.replyDraft.turnId.delete(turnId);
  const done = resolve(tx, at, plan, act);
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
  if (next.round > combat.round) arrivals(tx, at, plan.n);
  return turnUp(tx, at, plan, k, false);
}

/**
 * Whoever's turn it is now takes it: the player's hands the scene back (the turn is done, and their
 * next line is their turn), anyone else's is the combat step on them. One who can't (down, gone) is
 * passed over, and a fight the rules say is over goes to its end.
 */
function turnUp(tx: TxCtx, at: At, plan: SayPlan, k: number, starting: boolean): Next<SayPlan> {
  const combat = at.gm.combat!;
  // Anyone here with no side yet picks one, or runs, before the next turn: a combat step for the GM's pick_sides.
  if (combat.pending?.length) { putGm(tx, at.scene.id, at.gm); return { done: false, plan: { ...plan, step: "combat", combat: { k: Math.max(k, 1), done: [], ...fightNow(tx, at, plan.n) } } }; }
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
  // A fight the settle started that's over on the same turn: the settle after it is the turn's second.
  const again = at.gm.combat?.from === "settle" && at.gm.combat.started === plan.n;
  delete at.gm.combat;
  syncStage(tx, at.scene, at.graph, at.gm);
  putGm(tx, at.scene.id, at.gm);
  updateTurn(tx, idOf(plan.turn), { phase: "settling" });
  tx.log(`[scene ${at.scene.id} turn ${plan.n}] combat over after ${rounds} round(s): ${outcome}`);
  const reply = `The fight is over: ${OUTCOME_WORDS[outcome] ?? outcome}. ${ended?.narration ?? ""}`.trim();
  return { done: false, plan: { ...plan, step: "settle", reply, lines: [...plan.lines, ...(plan.combat?.done ?? []).flatMap(d => d.lines)], ...(again ? { settleAsk: 2 } : {}) } };
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
  const stood = (plan.combat?.done ?? []).some(d => d.act.action === "stand" && !d.refused);
  const out = act.action === "move" ? move(tx, at, plan.n, f.id, act, stood)
    : act.action === "stand" ? stand(tx, at, plan.n, f.id)
    : act.action === "flee" || act.action === "surrender" ? leaves(tx, at, plan.n, f, act.action)
    : act.action === "other" ? { lines: [], result: "Done: no dice." }
    : act.action === "check" ? check(tx, at, plan.n, act)
    : f.id === "player" ? playersAct(tx, at, plan, act)
    : theirBlow(tx, at, plan.n, f.id, act.target!);
  tx.log(`[scene ${at.scene.id} turn ${plan.n}] combat: ${f.id} ${act.action}${act.target ? ` ${act.target}` : ""}: ${out.result}`);
  return { act, lines: out.lines, result: [out.result, standingAfter(tx, at, plan.n, act)].filter(Boolean).join(" ") };
}

/**
 * Where an action's target stands now, by the rules, for the GM (the user's play, combat-gm: a blow
 * that left the talking Crake badly hurt at 1 hit point was narrated as him dropping out cold): down,
 * or still on their feet and how hurt.
 */
function standingAfter(tx: TxCtx, at: At, n: number, act: CombatAction): string {
  if (!act.target || !["attack", "cast", "grapple", "shove", "feature"].includes(act.action)) return "";
  const s = standingsOf(tx, at, n).find(x => x.id === act.target);
  if (!s) return "";
  return `Now ${nameOf(tx, at, n, s.id)} ${s.id === "player" ? "are" : "is"} ${s.hp <= 0 ? "down: 0 hit points, out cold" : `${s.hurt} (${s.hp}/${s.max} HP), still on ${s.id === "player" ? "your" : "their"} feet`}.`;
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
  return `Out of reach: ${nameOf(tx, at, n, act.target)} is ${feet} ft away, and ${act.action === "attack" ? "a melee blow reaches" : "hands reach"} 5 ft. move_towards first (or end the turn).`;
}

/** Getting up off the ground: prone no more, half their move gone (one already on their feet loses nothing). */
function stand(tx: TxCtx, at: At, n: number, who: string): { lines: string[]; result: string } {
  const m: FightMember = who === "player" ? "player" : castOf(at, who, worldOf(tx, at, n)) ?? "player";
  const was = withRules(tx, at, n, (rules, session) => standUp(rules, session, m));
  return { lines: [], result: was ? `${nameOf(tx, at, n, who)} ${who === "player" ? "get" : "gets"} up off the ground: half ${who === "player" ? "your" : "their"} move gone.` : `${nameOf(tx, at, n, who)} ${who === "player" ? "are" : "is"} on ${who === "player" ? "your" : "their"} feet already.` };
}

/**
 * A move up to their speed, towards someone or something (they stop beside them) or away from it, in
 * the place's world. One on the ground gets up first, and getting up (now or earlier this turn) takes
 * half their move.
 */
function move(tx: TxCtx, at: At, n: number, who: string, act: CombatAction, stood = false): { lines: string[]; result: string } {
  const m: FightMember = who === "player" ? "player" : castOf(at, who, worldOf(tx, at, n)) ?? "player";
  const rose = withRules(tx, at, n, (rules, session) => standUp(rules, session, m));
  const played = inPlay(tx, at.scene, at.graph, at.gm, n);
  const world = played.place.world;
  const full = reachFor(tx, at, n, who).speed;
  const speed = rose || stood ? Math.floor(full / 2) : full;
  const before = apart(world, who, act.target!) ?? 0;
  const blank = { name: "", kind: "", text: "", add: [], remove: [] };
  applyOps(world, [{ ...blank, op: "place", what: who, to: act.target!, how: act.away ? "away" : "toward", feet: speed }], n, "rules");
  playedOut(tx, at.scene, at.graph, at.gm, played);
  const after = apart(world, who, act.target!) ?? 0;
  const beside = after <= 5 + SLACK;
  return { lines: [], result: `${rose ? `${nameOf(tx, at, n, who)} got up off the ground first (half the move). ` : ""}${nameOf(tx, at, n, who)} moved ${Math.abs(before - after)} ft ${act.away ? "back from" : "towards"} ${nameOf(tx, at, n, act.target!)}: now ${beside ? "beside them" : `${after} ft away`}.` };
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
  return { lines: [], result: `${nameOf(tx, at, n, f.id)} ${how === "flee" ? "flees: out of the fight" : "gives up: out of the fight"}.` };
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
  const world = worldOf(tx, at, n);
  const attacker = castOf(at, who, world)!;
  const victim: FightMember = target === "player" ? "player" : castOf(at, target, world) ?? "player";
  const out = withRules(tx, at, n, (rules, session) => blowBetween(rules, session, attacker, victim));
  for (const line of out.lines) addEntry(tx, at.scene, { turn: n, speaker: "dice", kind: "roll", text: line });
  return { lines: out.lines, result: out.directive };
}

/** A rules directive as a result the GM reads: what happened, without the narrating instructions meant for a reply. */
const plainly = (directive: string) => directive.replace(/^Rules: /, "").split(/(?<=\.)\s+(?=Narrate|Then let|A single blow|If this becomes)/)[0]!.trim();

// ---------------------------------------------------------------------------------------------
// The fight as it stands.

/** Everyone in the fight as the GM sees them now (rules, world), and whether the rules say it's over. */
function fightNow(tx: TxCtx, at: At, n: number): Pick<CombatPlan, "fighters" | "over" | "pending"> {
  const combat = at.gm.combat!;
  const stand = standingsOf(tx, at, n);
  const world = worldOf(tx, at, n);
  const fighters = combat.order.map((f): CombatFighter => {
    const s = stand.find(x => x.id === f.id)!;
    const feet = Object.fromEntries(combat.order.filter(o => o.id !== f.id && world).map(o => [o.id, apart(world!, f.id, o.id) ?? 0]));
    return {
      id: f.id, name: f.id === "player" ? "you" : castOf(at, f.id, world)?.name ?? f.id, ...(called(tx, at, f.id, world) ? { called: called(tx, at, f.id, world) } : {}), side: f.side, initiative: f.initiative, hurt: s.hurt, hp: s.hp, max: s.max, ac: s.ac, down: s.hp <= 0,
      ...(s.conditions?.length ? { conditions: s.conditions } : {}),
      ...(f.out ? { out: f.out } : {}), reach: reachFor(tx, at, n, f.id), feet,
    };
  });
  const over = overOf(combat, new Set(fighters.filter(f => f.down).map(f => f.id)));
  const pending = (combat.pending ?? []).map((id): CombatNewcomer => {
    const c = castOf(at, id, world);
    const r = at.graph.reinforcements?.find(x => x.id === id);
    const leader = at.graph.cast.find(x => x.members?.some(m => m.id === id));
    const arriving = r && combat.arrived?.includes(id) && combat.round > 1 ? r.why : leader && combat.arrived?.includes(leader.id) && combat.round > 1 ? `with ${leader.name}` : undefined;
    return { id, name: c?.name ?? id, ...(called(tx, at, id, world) ? { called: called(tx, at, id, world) } : {}), about: [c?.look, ...(at.graph.cast.some(x => x.id === id) ? [c?.attitude, c?.limits] : [])].filter(Boolean).join(" ").trim(), ...(arriving ? { arriving } : {}) };
  });
  return { fighters, ...(over ? { over } : {}), ...(pending.length ? { pending } : {}) };
}

/** Who's down now, by the rules. */
const downOf = (tx: TxCtx, at: At, n: number) => new Set(standingsOf(tx, at, n).filter(s => s.hp <= 0).map(s => s.id));

/** How everyone in the fight stands, read on a session that isn't kept (the rules' characters are made at initiative). */
function standingsOf(tx: TxCtx, at: At, n: number): Standing[] {
  const played = inPlay(tx, at.scene, at.graph, at.gm, n);
  return engineCall(tx, at.scene.gameId, rules => standings(rules, played.session, membersOf(at, played.place.world)));
}

/** Someone's reach and speed, read on a session that isn't kept. */
function reachFor(tx: TxCtx, at: At, n: number, who: string, weapon?: string): { melee: boolean; feet: number; speed: number } {
  const played = inPlay(tx, at.scene, at.graph, at.gm, n);
  const m: FightMember = who === "player" ? "player" : castOf(at, who, played.place.world) ?? "player";
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

/**
 * What the player calls someone whose name they haven't heard yet; none once they have. One of the
 * cast by their card's `called`, one of the place's beings with a name of their own by what they are
 * (QA round hobo1-1018: "Combat! In initiative order: Duchess, you." gave the mastiff's name away,
 * and the narration took it up).
 */
function called(tx: TxCtx, at: At, id: string, world?: SceneWorld): string | undefined {
  if (id === "player") return undefined;
  const heard = { transcript: entriesOf(tx, at.scene.id) };
  const card = unnamed(at.graph, heard)[id];
  if (card || fighterOf(at.graph, id)) return card;
  const e = world?.entities[id];
  const name = e ? beingCalled(e, heard) : undefined;
  return name && name !== e!.name ? name : undefined;
}

/**
 * Someone in the fight as the rules know them: their card, a group's member (the Crakes, with their
 * own statblock and weapon), or a being in the place's world with no card (a dog), by its stats.
 */
function castOf(at: At, id: string, world?: SceneWorld): Character | undefined {
  const known = fighterOf(at.graph, id);
  if (known) return known;
  const e = world?.entities[id];
  return e && (e.kind === "person" || e.kind === "creature") && !e.player ? bystander(e) : undefined;
}
const membersOf = (at: At, world?: SceneWorld): FightMember[] => at.gm.combat!.order.map(f => (f.id === "player" ? "player" : castOf(at, f.id, world) ?? "player"));

/**
 * Everyone here who could be in a fight: the cast here and their groups' members, then the people
 * and creatures in the place's world who have no card (Duchess the dog), none gone.
 */
function fightersHere(tx: TxCtx, at: At, n: number): Character[] {
  const world = worldOf(tx, at, n);
  const here = (id: string) => !world?.entities[id]?.states.includes(AWAY);
  const known = presentFighters(at.graph, at.gm).filter(c => here(c.id));
  const others = Object.values(world?.entities ?? {}).filter(e => (e.kind === "person" || e.kind === "creature") && !e.player && here(e.id) && !known.some(c => c.id === e.id) && !at.graph.cast.some(c => c.id === e.id));
  return [...known, ...others.map(bystander)];
}

/** Whether someone here can pick a side or run: not down, dead or out cold, in the world or by the rules. */
function able(tx: TxCtx, at: At, n: number, id: string): boolean {
  const e = worldOf(tx, at, n)?.entities[id];
  return !e?.states.some(s => OUT_OF_IT.has(s));
}

/** The world's states of someone who can't take a side: gone from the place, down, dead or out cold. */
const OUT_OF_IT: ReadonlySet<string> = new Set([AWAY, "down", "dead", "unconscious"]);

/** Who follows the player through the story (the follower rows: Kell, from the first scene's end) and is here. */
export function companionsHere(tx: TxCtx, at: At): string[] {
  const here = new Set(presentCast(at.graph, at.gm).map(c => c.id));
  return [...tx.db.follower.gameId.filter(at.scene.gameId)].map(f => f.castKey).filter(k => here.has(k));
}
/** Someone in the fight as the player knows them: by what they call them until they've heard the name (shared/scene/names.ts unnamed). */
function nameOf(tx: TxCtx, at: At, n: number, id: string): string {
  if (id === "player") return "you";
  const world = fighterOf(at.graph, id) ? undefined : worldOf(tx, at, n);
  return called(tx, at, id, world) ?? castOf(at, id, world)?.name ?? id;
}
