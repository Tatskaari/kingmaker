// The contract for the prototype's src/runtime/threats.ts at 44c6d4a (world-bridge-design §2.1), until the world bridge's package R copies it here whole (87 lines), with V1's usual edits: the host's Rules first, no await, a SceneSession for the SessionState (it reads threat, held, turn, the world and the cast present). Every function here throws "not built" until then.
import type { Scene } from "../scene/types.ts";
import type { RulesOutcome } from "./acts.ts";
import type { Rules, RulesSession, SceneSession } from "./types.ts";

/**
 * What the last reply left hanging over the player lands as their turn begins, before they act, as
 * at the table: someone's blow, or a danger they save against. Down is down: a player the last reply
 * knocked to 0 hit points comes round first (comeRound). A reaction answers first: a Shield the
 * player raises against the blow goes up before it lands. A hold is resisted once: a grab gets a
 * saving throw when it catches the player; once it has them, it stands without more saves until they
 * break free or the story lets them go; giving in takes no roll at all.
 */

/** The threat on the session lands (and is taken off it): an attack, a hold, or a danger. */
export function landThreat(rules: Rules, scene: Scene, state: SceneSession, input: string): RulesOutcome | undefined {
  return notBuilt("landThreat", rules, scene, state, input);
}

/** Knocked down in the last reply: they come to as their next turn begins, conscious at 1 hit point. */
export function comeRound(rules: Rules, state: RulesSession): RulesOutcome | undefined {
  return notBuilt("comeRound", rules, state);
}

/** A hold ends when the reply no longer has the player held: the story let them go, or moved on (threatRead: the read after the reply's raw choice). */
export function holdAfterReply(state: Pick<RulesSession, "held">, threatRead: string | undefined): void {
  notBuilt("holdAfterReply", state, threatRead);
}

/** The player's words give in to what has hold of them (or is about to): they stop struggling, go quietly, let them take them. */
export function givesIn(input: string): boolean {
  return notBuilt("givesIn", input);
}

/** A function of the contract the rules' package hasn't copied yet. */
function notBuilt(name: string, ..._args: unknown[]): never {
  throw new Error(`not built: shared/rules/threats.ts ${name} (the world bridge's rules, package R)`);
}
