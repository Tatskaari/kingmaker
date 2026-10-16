// The contract for the prototype's src/rules/dnd.ts acts at 44c6d4a (world-bridge-design §2.1), until the world bridge's package R copies them here: lines 103-108, 911-1059, 1064-1107 but castable, 1198-1452, 1521-1764, 1773-1869, 1884-1946 and 1993-2027, with V1's usual edits (the host's Rules first, no await, RulesSession for SessionState), Outcome as RulesOutcome (the protocol has an Outcome), and src/app/game.ts:1840-1851 as spellFactsOf. Copied already: HAZARDS and HAZARD_KINDS (dnd.ts:1667-1675), which the AI service's threat question names. Every function here throws "not built" until then.
import type * as Dnd from "../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import type { RollResult } from "../dice.ts";
import type { Character } from "../scene/types.ts";
import type { Entity, SceneWorld } from "../world/scene-world.ts";
import type { Rules, RulesSession, SpellFacts, SpellRef } from "./types.ts";

/**
 * The D&D rules' acts in a scene (world-bridge-design §2.1): a spell, a blow, a grab or a shove, a
 * jump, a class feature, a rest; a blow or a danger landing on the player; story time passing (a
 * spell running out, a Rage burning down); a level gained; and what the rules say of the spells
 * ready, for the scene's menu. Each works on a RulesSession whose world is the scene's place,
 * changes the world and the character in place as the prototype's do, and says what the dice
 * decided: its lines for the transcript, and the GM's directive. The simulation runs each in a
 * commit, pinned (pin.ts withEngine), and writes back what changed. Not re-exported by index.ts, so
 * the client never loads it.
 */

/** What an act came to (dnd.ts's Outcome). */
export interface RulesOutcome {
  /** Dice lines for the player: the transcript's roll entries. */
  lines: string[];
  /** What happened, for the GM to narrate. */
  directive: string;
  /** The player's status after it, when it changed. */
  status?: string;
  /** A danger's saving throw: whether the player saved. */
  saved?: boolean;
  /** It put the player down (0 hit points): what they meant to do this turn doesn't happen. */
  down?: boolean;
  /** The player's Shield went up against it (a reaction: their turn doesn't cast it again). */
  shielded?: boolean;
}

/**
 * Cast one of the player's spells at story characters (or themselves, or nobody in particular), or at
 * things in the world. `said`: the player's words, for what the spell asks them to choose (an
 * element, which way); `unclear`: aimed at a thing, but at which wasn't clear.
 */
export function castSpell(rules: Rules, state: RulesSession, cast: Character[], spellId: string, targetIds: string[], options: { ritual?: boolean; said?: string; unclear?: boolean } = {}): RulesOutcome {
  return notBuilt("castSpell", rules, state, cast, spellId, targetIds, options);
}

/** The player attacks a story character or a thing in the world, with a weapon they carry ("improvised" for anything else). */
export function attack(rules: Rules, state: RulesSession, cast: Character[], targetId: string, weaponId?: string): RulesOutcome {
  return notBuilt("attack", rules, state, cast, targetId, weaponId);
}

/** The player grabs or shoves a story character who'd resist. */
export function wrestle(rules: Rules, state: RulesSession, cast: Character[], targetId: string, how: "grapple" | "prone" | "push"): RulesOutcome {
  return notBuilt("wrestle", rules, state, cast, targetId, how);
}

/** A blow left hanging lands on the player (a Shield they raise against it first). */
export function attackOnPlayer(rules: Rules, state: RulesSession, attacker: Character, options: { shield?: boolean } = {}): RulesOutcome {
  return notBuilt("attackOnPlayer", rules, state, attacker, options);
}

const HAZARDS: Record<string, { ability: Dnd.Ability; damage?: string; text: string }> = {
  fall_or_blow: { ability: "DEX", damage: "bludgeoning", text: "a fall, a falling weight or a crushing blow" },
  fire: { ability: "DEX", damage: "fire", text: "fire, scalding or burning" },
  poison: { ability: "CON", damage: "poison", text: "poison, rot or bad air" },
  cold_or_drowning: { ability: "CON", damage: "cold", text: "cold water, drowning or freezing" },
  grab_or_shove: { ability: "STR", text: "being grabbed, pinned, dragged or shoved" },
  mind: { ability: "WIS", text: "fear, a charm, an illusion or something working on the mind" },
};
export const HAZARD_KINDS = Object.fromEntries(Object.entries(HAZARDS).map(([k, v]) => [k, v.text]));

/** A danger the last reply left hanging over the player: a saving throw, with damage on a failure. */
export function hazard(rules: Rules, state: RulesSession, kind: string, severity: "glancing" | "serious"): RulesOutcome {
  return notBuilt("hazard", rules, state, kind, severity);
}

/** Time passes in the story (about a minute an exchange, longer between scenes): spells with a listed duration end, and so does a Rage. Their lines. */
export function passTime(rules: Rules, state: RulesSession, minutes: number): string[] {
  return notBuilt("passTime", rules, state, minutes);
}

/** Tag what this turn's spell conjured (created this turn, called what it conjures). */
export function markConjured(world: SceneWorld, spellId: string, turn: number): void {
  notBuilt("markConjured", world, spellId, turn);
}

/** What these spells conjured (or every spell's, when none are named: the scene is over) is gone. */
export function dispelConjured(world: SceneWorld, spellIds: string[] | undefined, turn: number): void {
  notBuilt("dispelConjured", world, spellIds, turn);
}

/** A short rest or a long one: hit dice spent, hit points, slots and uses back as the rest gives them. */
export function rest(rules: Rules, state: RulesSession, kind: "short" | "long"): RulesOutcome {
  return notBuilt("rest", rules, state, kind);
}

/** A milestone: one level in the player's main class, choices made by the engine's defaults. Its lines. */
export function levelUp(rules: Rules, state: RulesSession): string[] {
  return notBuilt("levelUp", rules, state);
}

export interface JumpReach { long: number; standingLong: number; high: number; standingHigh: number }

export interface Jump {
  feet: number;
  high?: boolean;
  /** At least 10 feet on foot first. */
  runUp?: boolean;
  /** What falling short means: the drop into whatever is between, in feet (0 for a puddle, a table). */
  drop?: number;
}
export interface JumpOutcome { made: boolean; reach: number; roll?: RollResult; lines: string[]; account: string; status?: string }

/**
 * A jump: within reach it simply happens (no dice); up to half as far again takes Strength
 * (Athletics) at DC 10 plus a point for every foot over; farther than that falls short. Falling
 * short with a drop beneath is a fall (1d6 bludgeoning per 10 feet, prone).
 */
export function jump(rules: Rules, state: RulesSession, j: Jump): JumpOutcome {
  return notBuilt("jump", rules, state, j);
}

/** A class feature, through the engine's own intent for it (uses, rests and all). */
export function useFeature(rules: Rules, state: RulesSession, cast: Character[], featureId: string, targetId?: string): RulesOutcome {
  return notBuilt("useFeature", rules, state, cast, featureId, targetId);
}

/** Someone the story brought in who isn't in the cast (a crowd, a passer-by): a commoner, for the rules. */
export function bystander(e: Entity): Character {
  return notBuilt("bystander", e);
}

/**
 * What the rules say of each spell ready, from the engine's spell definitions (the prototype's
 * loadSpellFacts, synchronous): its range, its effects' kinds and whether it fills an area. sheetRows
 * writes it as the sheet's spellFacts, which the scene's menu reads.
 */
export function spellFactsOf(rules: Rules, spells: SpellRef[]): SpellFacts[] {
  return notBuilt("spellFactsOf", rules, spells);
}

/** A function of the contract the rules' package hasn't copied yet. */
function notBuilt(name: string, ..._args: unknown[]): never {
  throw new Error(`not built: shared/rules/acts.ts ${name} (the world bridge's rules, package R)`);
}
