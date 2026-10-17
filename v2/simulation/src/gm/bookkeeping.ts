// Copied from the prototype's src/runtime/engine.ts:255-265 (moveTaken), 276-286 (heldEnding), 335-395 (moveOnAfterReply, endingReached, whyItWaits, arrivals, reachEnding), 419-437 (settledFacts, applyMove), director.ts:330-342 (resolve) and src/lore/disclosure.ts:94-96 (keepOpened) at 44c6d4a. They read and write GmState, not the session; turn numbers are the scene's, passed in; the dice are the game's row, through the roll handed in; the GM's words stay with the AI service, so moveTaken and heldEnding say what they did instead of returning directives; no rulings (considered rolls) or fights yet.

import type { RollResult } from "../../../shared/dice.ts";
import type { GmState, OpenedNote } from "../../../shared/gm/state.ts";
import type { After, Decision, Outcome } from "../../../shared/protocol/ai.ts";
import { currentBeat, IMPROVISED_EXIT_ID, presentCast } from "../../../shared/scene/graph.ts";
import type { Exit, Scene, Transition } from "../../../shared/scene/types.ts";

/**
 * The GM's bookkeeping, the state machine the simulation runs in its commits (gm-port §6, §9): a
 * route taken and where it leaves the beats, the facts it settles, and the endings, when one is
 * held for the player's answer, when it gets a wind-down, when it closes the scene. Pure functions
 * of the GM's state and the scene's graph; they change the state they're handed, as the
 * prototype's did, and the commit writes it back.
 */

/** A route taken (director.ts's Move): where it leads, its roll, the exit it reaches, whether the player chose it. */
export interface Move { transition: Transition; phase: "attempt" | "cue" | "outcome"; roll?: RollResult; to: string; exit?: Exit; chosen: boolean }

/** A route the AI service picked: its id and phase, its check (the skill already the player's means), and whether the ending it leads to is theirs. */
export interface RoutePick { id: string; phase: Move["phase"]; check?: { skill: string; dc: number }; theirs?: boolean }

/** A check rolled: the game's dice, the sheet's modifier for the skill. */
export type Roll = (skill: string, dc: number) => RollResult;

/** The most opened notes a scene keeps (disclosure.ts's MAX_OPEN). */
const MAX_OPEN = 24;
/** The bar for an ending read after the reply (director.ts's SCENE_ENDING_CONFIDENCE), and the lower one that leads twice running. */
const ENDING_READ = 0.6;
const ENDING_TWICE = 0.35;

/** A route open from where the scene is: one of the current beat's, or an anytime one. */
export function routeOf(scene: Scene, gm: GmState, id: string): Transition | undefined {
  return [...currentBeat(scene, gm).transitions, ...(scene.anytime ?? [])].find(t => t.id === id);
}

/** director.ts's resolve: where a route leads, its check rolled, the exit it reaches, and whether the player chose it. */
export function resolveMove(scene: Scene, gm: GmState, transition: Transition, pick: RoutePick, roll: Roll): Move {
  let to = transition.to ?? gm.beat;
  let rolled: RollResult | undefined;
  if (transition.check) {
    rolled = roll(pick.check?.skill ?? transition.check.skill, pick.check?.dc ?? transition.check.dc);
    to = rolled.success ? transition.check.onSuccess : transition.check.onFailure ?? gm.beat;
  }
  const exit = scene.exits.find(e => e.id === to);
  // (The cue's ending is the one the player is leaving by: their choice, as their own route's would be.)
  const chosen = !!pick.theirs || (pick.phase === "attempt" && (!rolled || rolled.success));
  return { transition, phase: pick.phase, to, chosen, ...(rolled ? { roll: rolled } : {}), ...(exit ? { exit } : {}) };
}

export function applyMove(gm: GmState, move: Move, source: "pre" | "post", turn: number): void {
  // (How much was settled before it: a beat left before something was settled can't be gone back to by the co-GM.)
  const known = gm.established.length;
  // The route's own facts, then those of how its check went.
  const byOutcome = move.roll && move.transition.check?.establishes ? (move.roll.success ? move.transition.check.establishes.success : move.transition.check.establishes.failure) ?? [] : [];
  for (const fact of [...(move.transition.establishes ?? []), ...byOutcome]) if (!gm.established.includes(fact)) gm.established.push(fact);
  if (move.to !== gm.beat) {
    gm.path.push({ turn, from: gm.beat, to: move.to, via: move.transition.id, source, ...(move.roll ? { roll: move.roll } : {}), known });
    if (!move.exit) { gm.beat = move.to; gm.turnsInBeat = 0; }
  } else if (move.roll) {
    gm.path.push({ turn, from: gm.beat, to: gm.beat, via: move.transition.id, source, roll: move.roll, known });
  }
}

/**
 * moveTaken: where a move before the reply leaves the scene. An ending the dice decided plays its
 * moment now and closes on the next reply; one the player chose closes now; one they didn't is
 * held for their answer.
 */
export function takeMove(gm: GmState, move: Move, pending: GmState["pendingExit"], turn: number): NonNullable<Outcome["taken"]> {
  if (move.exit && move.chosen && move.roll && move.exit.kind !== "combat") {
    gm.closing = { exitId: move.exit.id, turn };
    return { closing: move.exit.id };
  }
  if (move.exit && (move.chosen || pending?.exitId === move.exit.id)) return { ended: move.exit.id };
  if (move.exit) {
    gm.pendingExit = { exitId: move.exit.id, turn, via: move.transition.id, extended: false };
    return { pendingExit: move.exit.id };
  }
  return {};
}

/**
 * heldEnding: the player's turn with an ending held for their answer. A word out of character
 * leaves it as it was; a turn that answers it holds it once more; any other turn lets it land in
 * this reply.
 */
export function holdEnding(gm: GmState, pending: NonNullable<GmState["pendingExit"]>, decision: Decision): NonNullable<Outcome["held"]> {
  if (decision.outOfCharacter) {
    gm.pendingExit = pending;
    return "ooc";
  }
  if ((!!decision.plain || !!decision.answering) && !pending.extended) {
    gm.pendingExit = { ...pending, extended: true };
    return "brink";
  }
  return "closes";
}

/**
 * What the after-reply read found, applied: an outcome route taken (its dice, its move), then where
 * the story stands. An ending reached there waits for the player's answer unless it's their own
 * doing with nothing left hanging; a fight ends the scene at once (`ended`).
 */
export function moveOnAfterReply(scene: Scene, gm: GmState, after: After, onStage: string[], turn: number, roll: Roll): { move?: Move; ended?: Exit } {
  const from = gm.beat;
  const move = outcomeMove(scene, gm, after, roll);
  if (move) applyMove(gm, move, "post", turn);
  const waits = whyItWaits(after, arrivals(scene, gm, onStage));
  // (An ending the dice decided before the reply stands, unless a fight has broken out.)
  if (move?.exit) return { move, ended: gm.closing && move.exit.kind !== "combat" ? undefined : reachEnding(gm, move.exit, move.transition.id, waits, turn) };
  if (!after.ending) {
    delete gm.endingLead;
    return { move };
  }
  // An outcome that moved the scene on makes the read of where it stood stale; one that kept it where it was doesn't.
  if ((move && move.to !== from) || gm.closing || gm.pendingExit) return { move };
  const exit = endingReached(scene, gm, after.ending);
  if (!exit) return { move };
  gm.path.push({ turn, from: gm.beat, to: exit.id, via: "ending-reached", source: "post" });
  return { move, ended: reachEnding(gm, exit, "ending-reached", waits, turn) };
}

/** Where the story stands: an ending that leads twice running (or clearly) has been reached. */
export function endingReached(scene: Scene, gm: GmState, ending: NonNullable<After["ending"]>): Exit | undefined {
  const lead = gm.endingLead?.exitId === ending.exitId ? gm.endingLead.count + 1 : 1;
  gm.endingLead = { exitId: ending.exitId, count: lead, probability: ending.probability };
  const exit = scene.exits.find(e => e.id === ending.exitId);
  if (!exit || !(ending.probability >= ENDING_READ || (lead >= 2 && ending.probability >= ENDING_TWICE))) return undefined;
  delete gm.endingLead;
  return exit;
}

/**
 * Why an ending found after the reply waits for the player's answer: they asked something the
 * reply left hanging, someone has just come in, or it isn't their own doing.
 */
export function whyItWaits(after: Pick<After, "unanswered" | "theirs">, arrived: string[]): string | undefined {
  if (after.unanswered) return "the player asked something the reply left unanswered";
  if (arrived.length) return `${arrived.join(" and ")} just came in`;
  if (!after.theirs) return "it isn't the player's own doing";
  return undefined;
}

/** Who is here now and wasn't when the player spoke. */
export function arrivals(scene: Scene, gm: GmState, onStage: string[]): string[] {
  return presentCast(scene, gm).filter(c => !onStage.includes(c.id)).map(c => c.name);
}

/**
 * An ending the after-reply read found: a fight that has broken out ends the scene now; one already
 * held for the player stays as it is; one that waits is held for their answer; and one the player
 * chose, with nothing hanging, gets one wind-down turn.
 */
export function reachEnding(gm: GmState, exit: Exit, via: string, waits: string | undefined, turn: number): Exit | undefined {
  if (exit.kind === "combat") { delete gm.pendingExit; return exit; }
  if (gm.pendingExit?.exitId === exit.id) return undefined;
  delete gm.pendingExit;
  if (waits) gm.pendingExit = { exitId: exit.id, turn, via, extended: false, waits };
  else gm.closing = { exitId: exit.id, turn };
  return undefined;
}

/** What's been settled in the scene so far: its facts (and, once there are rulings, how they went), the last 16. */
export function settledFacts(gm: GmState): string[] {
  return gm.established.slice(-16);
}

/** The notes disclosure has open for the scene, with these too (their `p` dropped), the newest 24. */
export function keepOpened(opened: OpenedNote[], notes: OpenedNote[]): OpenedNote[] {
  return [...opened, ...notes.map(({ p, ...n }) => { void p; return n; })].slice(-MAX_OPEN);
}

/** Did a step this turn move the scene on from its beat (the clock of exchanges doesn't tick then)? */
export const movedOn = (gm: GmState, turn: number) => gm.path.some(p => p.turn === turn && p.to !== p.from);

/** The outcome route the after-reply read says has happened, resolved (its check rolled); none when the read names no route open here. */
function outcomeMove(scene: Scene, gm: GmState, after: After, roll: Roll): Move | undefined {
  const transition = after.outcome ? routeOf(scene, gm, after.outcome.route) : undefined;
  if (!transition) return undefined;
  const move = resolveMove(scene, gm, transition, { id: transition.id, phase: "outcome", ...(after.outcome?.check ? { check: after.outcome.check } : {}) }, roll);
  return insteadOfImprovised(scene, move, after.outcome?.exit);
}

/**
 * The improvised ending gives way to an authored one the after-reply read found plausible
 * (the prototype's director.ts:1330-1333): the AI service names it in `outcome.exit`.
 */
function insteadOfImprovised(scene: Scene, move: Move, exitId: string | undefined): Move {
  const exit = exitId && move.exit?.id === IMPROVISED_EXIT_ID ? scene.exits.find(e => e.id === exitId) : undefined;
  return exit ? { ...move, to: exit.id, exit } : move;
}
