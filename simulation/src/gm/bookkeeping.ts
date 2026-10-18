// Copied from the prototype's src/runtime/engine.ts:255-265 (moveTaken), 276-286 (heldEnding), 397-410 (wantsReview), 418-437 (settledFacts, applyMove), director.ts:330-342 (resolve) and src/lore/disclosure.ts:94-96 (keepOpened) at 44c6d4a. They read and write GmState, not the session; turn numbers are the scene's, passed in; the dice are the game's row, through the roll handed in; the GM's words stay with the AI service, so moveTaken and heldEnding say what they did instead of returning directives; wantsReview reads the wire's Decision and the move the decide commit resolved (the v2 approach has no freeform or pressure in its decision; the rules' act is its mechanic, world-bridge-design §3.4); no fights yet.

import type { RollResult } from "../../../shared/dice.ts";
import type { GmState, OpenedNote } from "../../../shared/gm/state.ts";
import type { Decision, Outcome } from "../../../shared/protocol/ai.ts";
import { currentBeat } from "../../../shared/scene/graph.ts";
import type { Exit, Scene, Transition } from "../../../shared/scene/types.ts";

/**
 * The GM's bookkeeping, the state machine the simulation runs in its commits (gm-port §6, §9): a
 * route taken and where it leaves the beats, the facts it settles, and the endings, when one is
 * held for the player's answer, when it gets a wind-down, when it closes the scene. (What the read
 * after the reply found, applied, went with the old pipeline's settle: moveOnAfterReply,
 * endingReached, whyItWaits, arrivals and reachEnding, engine.ts:335-395.) Pure functions
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
 * leaves it as it was; a turn that answers it (an ask, a challenge, a try the GM ruled on that might
 * change things: `considered`) holds it once more; any other turn lets it land in this reply.
 */
export function holdEnding(gm: GmState, pending: NonNullable<GmState["pendingExit"]>, decision: Decision, considered = false): NonNullable<Outcome["held"]> {
  if (decision.outOfCharacter) {
    gm.pendingExit = pending;
    return "ooc";
  }
  if ((!!decision.plain || considered || !!decision.answering) && !pending.extended) {
    gm.pendingExit = { ...pending, extended: true };
    return "brink";
  }
  return "closes";
}

/** What's been settled in this scene so far: its facts, and how the GM's rulings went, the last 16. */
export function settledFacts(gm: GmState): string[] {
  const rulings = gm.rulings.map(r => `${r.act.replace(/\.$/, "")}: ${r.went === "success" ? "it worked" : "it didn't"} (${r.changed})`);
  return [...gm.established, ...rulings].slice(-16);
}

/**
 * Does the turn go to the GM's review (considered rolls)? A roll is wanted that nothing the author
 * wrote settles, or it's a plan off the graph; and nothing else this turn has answered it (a route's
 * move, a route the author gave no dice read with confidence, the rules, a limit, the same push
 * again, out of character) or is winding the scene down. (The thief's crown for Cob's paper read as
 * the bribe route at .81 and off the graph at .84, and the review's ruling played instead of the
 * haggling the author wrote.) The rules answer it only when nothing's left to rule on: a spell or a
 * blow that's only the means to something risky (a Mage Hand at the page in a watching boy's boot),
 * or a class feature with a risky act beside it (a war-roar with the rage), still gets the act's
 * ruling, once the rules have resolved it.
 */
export function wantsReview(gm: GmState, decision: Decision, move: Move | undefined): boolean {
  const answered = !!(move || (decision.mechanic && !decision.considered) || decision.limit || decision.outOfCharacter || decision.sameAgain || decision.byPrep);
  return !gm.closing && !answered && !!(decision.considered || decision.offGraph);
}

/** The notes disclosure has open for the scene, with these too (their `p` dropped), the newest 24. */
export function keepOpened(opened: OpenedNote[], notes: OpenedNote[]): OpenedNote[] {
  return [...opened, ...notes.map(({ p, ...n }) => { void p; return n; })].slice(-MAX_OPEN);
}
