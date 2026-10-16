// The contract for the prototype's src/runtime/engine.ts scene acts at 44c6d4a (world-bridge-design §2.1), until the world bridge's package R copies them here: lines 1301-1327 (leap), 1329 (nameIn), 1336-1358 (violence), 1371-1388 (react) and 1412-1421 (moveToAct), with V1's usual edits (the host's Rules first, no await), a SceneSession for the SessionState (react writes absent, brawl and threat on it) and the scene passed in for sceneById. Every function here throws "not built" until then.
import type { Scene } from "../scene/types.ts";
import type { RulesOutcome } from "./acts.ts";
import type { Act, ActFrom, Jumping, Mechanic, Reaction, Rules, RulesSession, SceneSession } from "./types.ts";

/**
 * What the rules do around an act in a scene's world: the player moved to where they act from, a
 * jump landed where the world says, whether the act was violence people would react to, and the
 * reactions taking effect (the fleeing leave, the cowering cower, a fight starts if anyone wants
 * one). The simulation's decide and reactions commits call them on the world rebuilt from the rows.
 */

/**
 * A jump in a scene: how far from the world when it knows where they're going (or the decider's
 * read), the rules decide whether they make it, and the world puts them where they land: across, or
 * in what they were jumping over (wet, if it was water; prone, after a fall).
 */
export function leap(rules: Rules, state: RulesSession, j: Jumping): RulesOutcome {
  return notBuilt("leap", rules, state, j);
}

/** Someone by the name the player knows them by: what they call them until they've heard it (the dice name them so). */
export function nameIn(scene: Scene, state: RulesSession, id: string): string {
  return notBuilt("nameIn", scene, state, id);
}

/**
 * Did the player just do violence people would react to? A blow or a grab at a person, a harmful
 * spell at or around people, or one that set something burning or broke it where people are. The
 * rules have already decided what it did; this reads it off the mechanic and the world's states
 * (`before`: each entity's states before the act).
 */
export function violence(rules: Rules, scene: Scene, state: SceneSession, m: Mechanic, before: Record<string, string[]> | undefined): Act | undefined {
  return notBuilt("violence", rules, scene, state, m, before);
}

/** The reactions take effect: the fleeing leave (gone, and absent), the cowering cower, and a fight starts if anyone wants one (brawl, and the first fighter's threat). */
export function react(scene: Scene, state: SceneSession, act: Act, reactions: Record<string, Reaction>): void {
  notBuilt("react", scene, state, act, reactions);
}

/** Put the player where they act from before the rules roll (see ActFrom). */
export function moveToAct(state: RulesSession, from: ActFrom, aim: string | undefined): void {
  notBuilt("moveToAct", state, from, aim);
}

/** A function of the contract the rules' package hasn't copied yet. */
function notBuilt(name: string, ..._args: unknown[]): never {
  throw new Error(`not built: shared/rules/scene-acts.ts ${name} (the world bridge's rules, package R)`);
}
