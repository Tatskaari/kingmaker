// Copied from the prototype's src/runtime/threats.ts at 44c6d4a, whole. The usual edits (world-bridge-design §2): the host's Rules first and no await, so a promise's .catch(() => undefined) is orNothing's try; a SceneSession for the SessionState (it reads threat, held, turn, the world, and presentCast's beat, path, entered and absent), presentCast from shared/scene/graph.ts; RulesOutcome for Outcome; holdAfterReply takes only the held turn, so the simulation can hand it the scene's gm.
import { presentCast } from "../scene/graph.ts";
import type { Scene } from "../scene/types.ts";
import { attackOnPlayer, bystander, hazard, type RulesOutcome } from "./acts.ts";
import { comeTo } from "./character.ts";
import type { Rules, RulesSession, SceneSession, Threat } from "./types.ts";

/**
 * What the last reply left hanging over the player lands as their turn begins, before they act, as
 * at the table: someone's blow, or a danger they save against.
 *
 * - **Down is down.** A player the last reply knocked to 0 hit points comes round first, at 1 hit
 *   point ([`comeRound`](#comeRound)): the rules and the GM agree they're conscious again, as the GM
 *   was told they would be.
 * - **A reaction answers first.** A Shield the player raises against the blow goes up before it lands.
 * - **A hold is resisted once.** A grab gets a saving throw when it catches the player. Once it has
 *   them (they failed, or gave in to it), it stands without more saves until they break free (an
 *   attempt of their own, rolled as theirs) or the story lets them go. Giving in takes no roll at all.
 */
export function landThreat(rules: Rules, scene: Scene, state: SceneSession, input: string): RulesOutcome | undefined {
  const threat = state.threat!;
  delete state.threat;
  if (threat.kind === "attack") return attackLands(rules, scene, state, threat.by, input);
  return holdOrHazard(rules, state, threat, input);
}

/** Knocked down in the last reply: they come to as their next turn begins, conscious at 1 hit point. */
export function comeRound(rules: Rules, state: RulesSession): RulesOutcome | undefined {
  if (!state.rules || !/^HP 0\//.test(state.rules.status ?? "")) return undefined;
  const line = orNothing(() => comeTo(rules, state));
  if (!line) return undefined;
  return { lines: [line], directive: `Rules, before the player's turn: the player has come round after being knocked down. They're conscious at 1 hit point (${state.rules.status}): they can talk, act and cast again, but they're badly hurt, and one more wound puts them down.` };
}

/** A hold ends when the reply no longer has the player held: the story let them go, or moved on. */
export function holdAfterReply(state: Pick<RulesSession, "held">, threatRead: string | undefined): void {
  if (threatRead !== `hazard:${HOLD}`) delete state.held;
}

const HOLD = "grab_or_shove";

function attackLands(rules: Rules, scene: Scene, state: SceneSession, by: string, input: string): RulesOutcome | undefined {
  const bystanding = state.world?.entities[by];
  const attacker = presentCast(scene, state).find(c => c.id === by) ?? (bystanding && !bystanding.states.includes("gone") ? bystander(bystanding) : undefined);
  if (!attacker) return undefined;
  return orNothing(() => attackOnPlayer(rules, state, attacker, { shield: raisesShield(state, input) }));
}

/** The player's words answer the blow with the Shield spell, which they have ready. */
function raisesShield(state: RulesSession, input: string): boolean {
  return (state.rules?.spells ?? []).some(s => s.id === "shield") && /\bshield\b/i.test(input) && !/\b(no|not|without|drop|lower)\b[^.!?]{0,12}\bshield\b/i.test(input);
}

function holdOrHazard(rules: Rules, state: RulesSession, threat: Extract<Threat, { kind: "hazard" }>, input: string): RulesOutcome | undefined {
  if (threat.hazard !== HOLD) return orNothing(() => hazard(rules, state, threat.hazard, threat.severity));
  // The same hold as before: no new save.
  if (state.held !== undefined) return { lines: [], directive: "Rules, before the player's turn: no new saving throw against the hold on the player: it still has them, unless what they do this turn breaks it (breaking free is an attempt of their own, decided by its own roll), or someone lets them go." };
  // They don't resist: the story has them taken, held or dragged, with no roll.
  if (givesIn(input)) {
    state.held = state.turn;
    return { lines: [], directive: "Rules, before the player's turn: the player doesn't resist the hands on them, so there's no saving throw: they're held, or taken where they're being taken, as the story has it. Narrate that, then what the player does." };
  }
  const outcome = orNothing(() => hazard(rules, state, threat.hazard, threat.severity));
  if (outcome && !outcome.saved) state.held = state.turn;
  return outcome;
}

const GIVING_IN = [
  /\b(stop|quit|cease|give up|no longer)\s+(struggling|resisting|fighting|pulling away|squirming|wriggling|kicking)\b/,
  /\b(don't|do not|won't|will not|make no move to|offer no)\s+(struggle|resist|fight (it|them|him|her|back)|pull away|resistance)\b/,
  /\blet (myself )?(be )?(taken|led|dragged|hauled|carried|marched|pulled|held|pinned|bound|tied)\b/,
  /\blet (them|him|her|the [a-z]+( [a-z]+)?) (take|lead|drag|haul|carry|march|pull|hold|pin|have|walk|bundle|bind|tie|grab|search)\b/,
  /\ballow (them|him|her|the [a-z]+( [a-z]+)?) to\b/,
  /\b(go|come) (quietly|limp|slack)\b/,
  /\bgo (along )?with (it|them|him|her)\b/,
  /\bi (surrender|yield|submit)\b(?! (the|my|a|an|this|that|it|to the)\b)/,
  /\bgive (myself )?(up|in)\b(?! (the|my|his|her|their|a|an)\b)/,
  /\b(hands up|raise my hands|put my hands up|hold up my hands)\b/,
];

/** The player's words give in to what has hold of them (or is about to): they stop struggling, go quietly, let them take them. */
export function givesIn(input: string): boolean {
  const text = input.toLowerCase().replace(/[’']/g, "'");
  return GIVING_IN.some(re => {
    const m = re.exec(text);
    // (Not "I won't stop struggling", "I refuse to go quietly".)
    return !!m && !/(\bnot|\bnever|n't|\brefuse to|\brefusing to|\brather than)\s+(\w+\s+)?$/.test(text.slice(Math.max(0, m.index - 24), m.index));
  });
}

/** What the prototype's `.catch(() => undefined)` was: the rules couldn't, so nothing lands. */
function orNothing<T>(f: () => T): T | undefined {
  try { return f(); } catch { return undefined; }
}
