// After the prototype's src/game/combat/controller.ts at bc2ab1f (dispatch, npcTurn, autoTurn and style, advance's turn passing) and src/game/combat/game.ts (boardgame.io's turn hooks: a turn's end advances the engine's encounter, the next one's start begins it), with boardgame.io dropped: the turn machinery over a Skirmish, plain functions the moves and the step call.
import type { Unit } from "../../../shared/fight/types.ts";
import { decide, freshMemo, type PlayerStyle, type Step } from "./ai.ts";
import type { Skirmish } from "./skirmish.ts";

/**
 * Whose turn it is and what comes of it (docs/combat-design.md §1): the AI's turn for everyone but
 * the player, played a step at a time on the Skirmish; the turn passing (the engine's encounter moved
 * on past anyone who can't take one, and the next turn begun, its moment written); the player's turn
 * passing by itself once nothing at all is left of it; and the player's whole turn played by the AI
 * when they ask (auto).
 */

/** Whose turn needs the player: theirs, with them able to act, and the fight still on. */
export const playersTurn = (s: Skirmish): boolean => !s.G.outcome && s.activeUnit()?.id === s.G.pc && s.able(s.pc());

/** One of the AI's steps, made as the Skirmish's operation: why not, when it couldn't be. */
export function dispatch(s: Skirmish, u: Unit, step: Step): string | undefined {
  switch (step.kind) {
    case "move": return s.move(u, step.to);
    case "attack": return s.attack(u, step.target, step.weapon);
    case "cast": return s.cast(u, step.spell, step.target, step.at);
    case "use": return s.use(u, step.prop);
    case "dash": case "dodge": case "disengage": return s.simple(u, step.kind);
    case "leave": return s.leave(u);
    case "surrender": return s.surrender(u);
    case "standDown": return s.standDown(u);
    case "arrest": return s.arrest(u, step.target);
    case "nerve": return s.nerve(u, step.dc, step.why, step.test);
    case "remark": return s.remark(u, step.line);
    case "end": return undefined;
  }
}

/**
 * Someone's whole turn as the AI plays it (the prototype's npcTurn): its steps until it says end,
 * sixteen at most, giving up once four couldn't be done. `style`: how it plays the player (auto).
 */
export function aiTurn(s: Skirmish, u: Unit, style?: PlayerStyle): void {
  const memo = freshMemo();
  for (let i = 0; i < 16 && !s.G.outcome; i++) {
    if (!s.isTurnOf(u)) return;
    const step = decide(s, u, memo, style);
    if (step.kind === "end") return;
    const error = dispatch(s, u, step);
    if (error) memo.failed.push(`${step.kind}:${error}`);
    if (memo.failed.length > 3) return;
  }
}

/** The turn passes (a turn's end, boardgame.io's onEnd): the engine's encounter moves on past anyone who can't take a turn, and the next turn begins (its onBegin), its moment written. */
export function nextTurn(s: Skirmish): void {
  if (s.G.outcome) return;
  s.advance();
  if (!s.G.outcome) s.beginTurn();
}

/**
 * The step for the turn in hand (fight_step's): someone else's turn played by the AI, or the
 * player's while they're down (its death save is its start), then the next turn begun. False when
 * it's the player's to play, or the fight is over: nothing to do.
 */
export function step(s: Skirmish): boolean {
  const u = s.activeUnit();
  if (!u || s.G.outcome || playersTurn(s)) return false;
  s.beginTurn();
  if (u.id !== s.G.pc) aiTurn(s, u);
  nextTurn(s);
  return true;
}

/** How the AI plays the player's character (auto): a caster at range, or into the thick of it (the prototype's style). */
export function styleOf(s: Skirmish): PlayerStyle {
  const classes = s.t.char(s.pc().engineId)?.classes.map(c => c.classId) ?? [];
  return classes.some(c => ["wizard", "sorcerer", "warlock"].includes(c)) ? "wizard" : "fighter";
}

/** The player's turn played by the AI (auto: "let the dice decide"), then passed. */
export function autoTurn(s: Skirmish): void {
  aiTurn(s, s.pc(), styleOf(s));
  if (!s.G.outcome && s.isTurnOf(s.pc())) nextTurn(s);
}

/** The player ends their turn (end_turn): it passes. */
export function endTurn(s: Skirmish): void {
  nextTurn(s);
}

/**
 * After one of the player's acts: with nothing at all left of their turn (no action, no movement
 * worth a step, no bonus action they could use), it passes by itself, and says so (its moment).
 */
export function afterAct(s: Skirmish, nothingLeft: (s: Skirmish) => boolean): void {
  if (!playersTurn(s) || !nothingLeft(s)) return;
  s.moment("pass", s.pc());
  nextTurn(s);
}
