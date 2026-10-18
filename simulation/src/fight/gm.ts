// New (docs/combat-gm.md): the GM on the board, in the simulation. A scene's fight is fought on the
// board, and the GM is still the voice at the table (the user: "make it so the GM still narrates
// what happens in the log, and if I click on it, I can still narrate what I do"). Each turn the
// board plays is told by the GM in the fight's log (narrateFight: a think beside the fight, queued as
// the turn's moments are written; the next of the other side's turns waits a few seconds for it, so
// the log reads in order). The player's turn in their own words (fight_say) is the GM's to play on
// the board: a think a step (boardTurn), each answer one of the board's options done (as the menu
// does it), a move toward someone, or the turn's end, and the next step asked with what came of it.

import type { Identity } from "spacetimedb";
import type { FightBoard, FightEvent, FightOptions, Unit } from "../../../shared/fight/types.ts";
import { FEET, feetBetween, same } from "../../../shared/fight/grid.ts";
import type { BoardDone, BoardMoment, BoardTurnResponse, BoardView, NarrateResponse, Reply } from "../../../shared/protocol/ai.ts";
import { idOf, idText } from "../../../shared/protocol/keys.ts";
import { MAX_LINE, refusal } from "../../../shared/protocol/refusals.ts";
import { actorOf, runMove, type TxCtx } from "../context.ts";
import { boardTurnCall, narrateCall } from "../gm/requests.ts";
import { getGm } from "../gm/rows.ts";
import { queueThink } from "../jobs.ts";
import type { JobOwner, Move } from "../moves/move.ts";
import type { BoardTurnPlan, NarratePlan } from "../moves/plans.ts";
import { playerRow, sceneRow } from "../rows.ts";
import { optionAct } from "./moves.ts";
import { moveChoices } from "./named.ts";
import { nothingLeft } from "./options.ts";
import { boardOfRow, eventsOf, liveFightOf, play, type FightRow } from "./rows.ts";
import type { Skirmish } from "./skirmish.ts";
import { afterAct, endTurn, playersTurn } from "./turns.ts";

/** How long the board holds the next of the other side's turns for the GM's telling of the last: the log reads in order, but a slow GM never stops the fight. */
export const TELL_WAIT_MS = 6000;

/** How much of the fight so far a telling is given: its last moments and words. */
const FIGHT_SO_FAR = 16;

/** At most this many steps on a typed turn (the GM's own limit is one fewer: then only end_turn), then it's over. */
const MOST_STEPS = 6;

// ---------------------------------------------------------------------------------------------
// The board as the GM sees it.

/** The board as the GM sees it: what it's about, the round, everyone in initiative order (how they stand, where, how far from each other), whose turn. */
export function boardViewOf(board: FightBoard, why: string): BoardView {
  const units = board.order.map(id => board.units[id]!).filter(Boolean);
  const idOf = (u: Unit) => (u.id === board.pc ? "player" : u.id);
  return {
    why, round: board.round, whose: idOf(board.units[board.order[board.active] ?? ""] ?? board.units[board.pc]!),
    fighters: units.map(u => ({
      id: idOf(u), name: u.id === board.pc ? "you" : u.name, side: u.side, hp: u.hp, max: u.maxHp, state: u.state,
      conditions: u.conditions.filter(c => !/active$/.test(c)),
      feet: Object.fromEntries(units.filter(v => v !== u).map(v => [idOf(v), feetBetween(u.at, v.at)])),
    })),
  };
}

/** A moment as the GM reads it: its kind, who did it, its caption and its dice. */
const momentOf = (e: Pick<FightEvent, "kind" | "actor" | "caption" | "detail">): BoardMoment => ({ kind: e.kind, ...(e.actor ? { actor: e.actor } : {}), caption: e.caption, lines: e.detail.lines });

/** What the scene's fight is about (gm_state's fight), for the GM's note. */
const whyOf = (tx: TxCtx, board: FightBoard) => (board.scene ? getGm(tx, idOf(board.scene)).fight?.why ?? "" : "");

// ---------------------------------------------------------------------------------------------
// Telling each turn.

/**
 * The turns the moments just written finished (`starts`: each new turn's start, and the end's), in
 * a scene's fight, each queued for the GM to tell: from the moment after the last told to the one
 * before the next turn's start (the end's, with the end in it). A turn with nothing in it but its
 * start isn't told, and neither is the fight's start (the reply told it) or the player's turn in
 * their own words (the GM's own as it played it). The board waits on the last one queued (telling).
 */
export function tellTurns(tx: TxCtx, fight: FightRow, board: FightBoard, starts: Array<{ seq: number; kind: string }>, written: Array<Pick<FightEvent, "seq" | "kind" | "actor">>): void {
  if (!board.scene) return;
  for (const start of starts) {
    const from = (board.told ?? 0) + 1;
    const to = start.kind === "over" ? start.seq : start.seq - 1;
    if (to < from) continue;
    board.told = to;
    const typed = board.typed && board.typed.at >= from && board.typed.at <= to;
    if (typed) { delete board.typed; continue; }
    const events = [...eventsBetween(tx, fight, from, to, written)];
    const turn = events.find(e => e.kind === "turn");
    const acted = events.some(e => !["turn", "start", "pass", "gm"].includes(e.kind));
    if (!turn?.actor || !acted) continue;
    const scene = sceneRow(tx, idOf(board.scene));
    const plan: NarratePlan = { step: "narrate", game: idText(fight.gameId), scene: board.scene, n: getGm(tx, scene.id).fight?.turn ?? scene.turns, fight: idText(fight.id), from, to, whose: turn.actor === board.pc ? "player" : turn.actor };
    queueThink(tx, narrateFight, plan);
    board.telling = { to, since: Number(tx.now.microsSinceUnixEpoch / 1000n) };
  }
}

/** The fight's moments from `from` to `to`: those written already, and those this save is writing. */
function eventsBetween(tx: TxCtx, fight: FightRow, from: number, to: number, written: Array<Pick<FightEvent, "seq" | "kind" | "actor">>): Array<Pick<FightEvent, "seq" | "kind" | "actor">> {
  const kept = [...tx.db.fightEvent.fightId.filter(fight.id)].filter(e => e.seq >= from && e.seq <= to).map(e => ({ seq: e.seq, kind: e.kind as FightEvent["kind"], ...(e.actor ? { actor: e.actor } : {}) }));
  const fresh = written.filter(e => e.seq >= from && e.seq <= to && !kept.some(k => k.seq === e.seq));
  return [...kept, ...fresh].sort((a, b) => a.seq - b.seq);
}

/** Whether the next of the other side's turns waits for the GM's telling of the last (a few seconds at most; never in a fight played at once). */
export function waitsForTheGm(tx: TxCtx, board: FightBoard): boolean {
  if (!board.telling || board.fast) return false;
  return Number(tx.now.microsSinceUnixEpoch / 1000n) - board.telling.since < TELL_WAIT_MS;
}

/** The GM's words in the fight's log (a "gm" moment after the one they follow), the fight's moments counted on; the board as `board` leaves it. */
function writeWords(tx: TxCtx, fight: FightRow, board: FightBoard, entries: Reply[], after: number): FightRow {
  let seq = fight.seq;
  for (const r of entries.filter(r => r.text.trim())) {
    seq++;
    tx.db.fightEvent.insert({
      id: 0n, fightId: fight.id, gameId: fight.gameId, seq, round: board.round, turn: board.order[board.active] ?? "", kind: "gm", actor: undefined, target: undefined,
      caption: r.text.trim(), detail: JSON.stringify({ rolls: [], hits: [], lines: [], after, ...(r.markup?.speech.length ? { speech: r.markup.speech } : {}) }), at: tx.now,
    });
  }
  return tx.db.fight.id.update({ ...fight, seq, board: JSON.stringify(board), rev: fight.rev + 1 });
}

/** A turn the board played, told by the GM (POST /v1/fights/narrate): its words in the log after the turn's last moment, and the board waiting on it no longer. */
export const narrateFight: Move<never, NarratePlan> = {
  name: "narrateFight",
  resolve() { return { done: true }; },
  think(tx, plan) {
    const fight = tx.db.fight.id.find(idOf(plan.fight))!;
    const board = boardOfRow(fight);
    const all = eventsOf(tx, fight.id);
    const moments = all.filter(e => e.seq >= plan.from && e.seq <= plan.to && e.kind !== "gm").map(momentOf);
    // What's been told of the fight so far (the GM's own words, the player's, and the turns' captions), so nothing is told twice or borrowed.
    const before = all.filter(e => e.seq < plan.from && e.kind !== "start").slice(-FIGHT_SO_FAR).map(momentOf);
    return narrateCall(tx, plan, boardViewOf(board, whyOf(tx, board)), moments, before);
  },
  commit(tx, plan, answer) {
    const fight = tx.db.fight.id.find(idOf(plan.fight));
    if (!fight || fight.status === "done") return { done: true };
    const board = boardOfRow(fight);
    if (board.telling?.to === plan.to) delete board.telling;
    writeWords(tx, fight, board, (answer as NarrateResponse).entries, plan.to);
    return { done: true };
  },
  get owner() { return fightOwner; },
  background: true,
};

// ---------------------------------------------------------------------------------------------
// The player's turn in their own words.

/**
 * fight_say: the player's turn in a scene's fight, in their own words (the user: "if I click on it,
 * I can still narrate what I do"): theirs to say on their own turn, while the GM isn't playing one
 * already; the line in the log as theirs, and the GM asked to play it on the board.
 */
export const fightSay: Move<{ text: string }, BoardTurnPlan> = {
  name: "fightSay",
  check(tx, actor, { text }) {
    const player = actor.id === undefined ? undefined : tx.db.player.id.find(actor.id);
    const fight = player ? liveFightOf(tx, player.gameId) : undefined;
    if (!player || !fight) return refusal("no_fight");
    if (fight.playerId !== player.id) return refusal("not_controller", { name: playerRow(tx, fight.playerId).name });
    const board = boardOfRow(fight);
    if (!board.scene) return refusal("not_now", { text: "(Saying what you do is for a scene's fights: here, the menu has your moves.)" });
    if (fight.status !== "on") return refusal("not_now", { text: "(The fight's over: out goes back.)" });
    if (board.thinking) return refusal("not_now", { text: "(The GM is playing what you said: a moment.)" });
    if (!fight.options) return refusal("not_your_turn");
    const line = text.trim();
    if (!line) return refusal("empty_line");
    if (line.length > MAX_LINE) return refusal("too_long");
    return undefined;
  },
  resolve(tx, actor, { text }) {
    const player = tx.db.player.id.find(actor.id!)!;
    const fight = liveFightOf(tx, player.gameId)!;
    const board = boardOfRow(fight);
    const line = text.trim();
    const seq = fight.seq + 1;
    tx.db.fightEvent.insert({
      id: 0n, fightId: fight.id, gameId: fight.gameId, seq, round: board.round, turn: board.order[board.active] ?? "", kind: "say", actor: board.pc, target: undefined,
      caption: line, detail: JSON.stringify({ rolls: [], hits: [], lines: [] }), at: tx.now,
    });
    board.typed = { at: seq };
    board.thinking = true;
    tx.db.fight.id.update({ ...fight, seq, board: JSON.stringify(board), rev: fight.rev + 1 });
    const scene = sceneRow(tx, idOf(board.scene!));
    return { done: false, plan: { step: "fight", game: idText(fight.gameId), scene: board.scene!, n: getGm(tx, scene.id).fight?.turn ?? scene.turns, fight: idText(fight.id), line, at: seq, done: [] } };
  },
  think(tx, plan) {
    const fight = tx.db.fight.id.find(idOf(plan.fight))!;
    const board = boardOfRow(fight);
    const options = fight.options ? (JSON.parse(fight.options) as FightOptions) : undefined;
    return boardTurnCall(tx, plan, boardViewOf(board, whyOf(tx, board)), (options?.actions ?? []).map(a => ({ id: a.id, label: a.label, ...(a.cost ? { cost: a.cost } : {}) })), options?.movementLeft ?? 0);
  },
  /**
   * The GM's step: its words in the log (an attempt's before what the board makes of it, the turn's
   * end after); one of the player's options done as the menu does it, or a move toward someone, and
   * what came of it (or why the board refused it) kept for the next step; the turn's end, or nothing
   * at all left of it, or too many steps, and the turn is over, the other side's turns going on.
   */
  commit(tx, plan, answer) {
    const fight = tx.db.fight.id.find(idOf(plan.fight));
    if (!fight) return { done: true };
    const { move, entries } = answer as BoardTurnResponse;
    if (move.kind === "end_turn" || fight.status !== "on" || !fight.options) {
      // The turn's end told before it passes, so its words follow the turn they tell.
      done(tx, idOf(plan.fight), entries);
      const told = tx.db.fight.id.find(fight.id)!;
      if (told.status === "on" && told.options) play(tx, told, s => { if (playersTurn(s)) endTurn(s); });
      return { done: true };
    }
    const before = boardOfRow(fight);
    const said = writeWords(tx, fight, before, entries, fight.seq);
    const refused = play(tx, said, s => {
      const why = move.kind === "act" ? optionAct(s, move.id) : move.kind === "talk" ? s.talkDown(s.pc(), move.target, move.skill, move.dc) : towards(s, move.target, move.away);
      if (!why) afterAct(s, nothingLeft);
      return why;
    });
    const now = tx.db.fight.id.find(fight.id)!;
    const moments = eventsOf(tx, fight.id).filter(e => e.seq > said.seq && e.kind !== "gm").map(momentOf);
    const step: BoardDone = { act: move.kind === "act" ? move.id : move.kind === "talk" ? `talk_down ${move.target} (${move.skill}, DC ${move.dc})` : `move_towards ${move.target}${move.away ? " (away)" : ""}`, narration: move.narration, moments, ...(refused ? { refused } : {}) };
    const doneSoFar = [...plan.done, step];
    if (now.status !== "on" || !now.options || doneSoFar.length >= MOST_STEPS) {
      if (now.status === "on" && now.options) play(tx, now, s => { if (playersTurn(s)) endTurn(s); });
      done(tx, idOf(plan.fight), []);
      return { done: true };
    }
    return { done: false, plan: { ...plan, done: doneSoFar } };
  },
  get owner() { return fightOwner; },
};

/** The typed turn over: the GM's last words in the log, and the menu the player's again. Its moments are told already (the GM played them). */
function done(tx: TxCtx, fightId: bigint, entries: Reply[]): void {
  const fight = tx.db.fight.id.find(fightId);
  if (!fight) return;
  const board = boardOfRow(fight);
  delete board.thinking;
  writeWords(tx, fight, board, entries, fight.seq);
}

/** A move toward someone (or away from them, or to the way out: "exit"), as far as the player's move takes them this turn. Why not, in the board's words. */
function towards(s: Skirmish, target: string, away?: boolean): string | undefined {
  const u = s.pc();
  const left = s.movementLeft(u);
  if (left < FEET) return "You've no movement left this turn.";
  const them = target === "player" ? undefined : s.unit(target) ?? s.units.find(v => v.castId === target);
  const footing = { at: u.at, left };
  const best = (away ? moveChoices(s, u, footing, { kind: "back" }) : target === "exit" || target === "door" ? moveChoices(s, u, footing, { kind: "door" }) : them ? moveChoices(s, u, footing, { kind: "close", at: them.at }) : [])[0];
  if (!them && !away && target !== "exit" && target !== "door") return `There's nobody called ${target} on the board.`;
  if (!best) return away ? "There's nowhere further from them to go." : `You can't get any nearer to ${them?.called ?? "the way out"}.`;
  if (same(best.at, u.at)) return away ? "You're as far from them as you can get." : `You're beside ${them?.called ?? "the way out"} already.`;
  return s.move(u, best.at);
}

// ---------------------------------------------------------------------------------------------

/**
 * Whose the GM's jobs on the board are: the fight's. A telling is wanted while the fight is there to
 * be told (not once the player's out of it); a typed turn's step while its turn is still the one the
 * GM is playing. What they cost goes on the scene's turn the fight broke out on; a typed turn that
 * fails for good leaves the menu the player's again, saying why.
 */
const fightOwner: JobOwner<NarratePlan | BoardTurnPlan> = {
  wanted(tx, plan) {
    const fight = tx.db.fight.id.find(idOf(plan.fight));
    if (!fight || fight.status === "done") return false;
    if (plan.step === "narrate") return true;
    const board = boardOfRow(fight);
    return !!board.thinking && board.typed?.at === plan.at;
  },
  waiting() { /* the board says nothing of a slow GM: its moves go on */ },
  charge(tx, plan, usage) {
    const scene = tx.db.scene.id.find(idOf(plan.scene));
    const turn = scene ? [...tx.db.turn.sceneId.filter(scene.id)].find(t => t.n === plan.n) : undefined;
    if (turn) tx.db.turn.id.update({ ...turn, calls: turn.calls + usage.calls, costMicros: turn.costMicros + BigInt(Math.round(usage.costUsd * 1_000_000)) });
  },
  failed(tx, plan, words) {
    const fight = tx.db.fight.id.find(idOf(plan.fight));
    if (!fight) return;
    const board = boardOfRow(fight);
    if (plan.step === "narrate") {
      if (board.telling?.to === plan.to) { delete board.telling; tx.db.fight.id.update({ ...fight, board: JSON.stringify(board), rev: fight.rev + 1 }); }
      tx.log(`[fight] fight ${fight.id}: the telling of ${plan.from}-${plan.to} failed: ${words}`);
      return;
    }
    delete board.thinking;
    writeWords(tx, fight, board, [{ speaker: "gm", kind: "narration", text: `(The GM couldn't play that: ${words} Say it again, or use the menu.)` }], fight.seq);
  },
};

/** fight_say's reducer. */
export function fightSayReducer(tx: TxCtx, sender: Identity, args: { text: string }): void {
  runMove(tx, fightSay, actorOf(tx, sender), args);
}

