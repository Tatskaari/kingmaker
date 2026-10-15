import { createCharacter, type Build } from "../../rules/dnd.ts";
import type { SessionState } from "../../runtime/session.ts";
import type { Entity, SceneWorld } from "../../world/scene-world.ts";
import { PREGENS } from "../combat/pregen.ts";

/**
 * Who the visitor can be in the zoo: the combat demo's ready-made characters, and three more for the
 * class features a scene can use (Rage, Bardic Inspiration, Innate Sorcery). Level 5, so the wizard
 * has Fireball and the fighter two attacks. Each is made by the engine exactly as character creation
 * makes one (createCharacter with the build given, so no model is asked).
 */

export const ZOO_LEVEL = 5;
export const ZOO_NAME = "Wren Ashdown";

export interface ZooBuild { id: string; name: string; concept: string; build: Build; robes: string }

const wizard: Build = {
  classId: "wizard", subclassId: "evoker", speciesId: "human", backgroundId: "sage", abilities: ["INT", "DEX", "CON", "WIS", "CHA", "STR"],
  skills: ["arcana", "investigation", "history"], feat: "alert", cantrips: ["fire-bolt", "ray-of-frost", "shocking-grasp"],
  spells: ["fireball", "lightning-bolt", "burning-hands", "magic-missile", "thunderwave", "sleep", "grease", "detect-magic"], weapons: ["quarterstaff", "dagger"], armor: "none", shield: false,
};

const cleric: Build = {
  ...PREGENS.cleric!.build,
  spells: ["cure-wounds", "healing-word", "guiding-bolt", "bless", "shield-of-faith", "create-or-destroy-water", "spiritual-weapon", "spirit-guardians"],
};

const fighter: Build = { ...PREGENS.fighter!.build, weapons: ["longsword", "longbow", "handaxe"] };

export const BUILDS: Record<string, ZooBuild> = {
  wizard: { id: "wizard", name: "the wizard", robes: "the wizard's robes (singed)", concept: "an evoker of the Invisible College on a day out, who has read about fire extensively and is keen to try it", build: wizard },
  fighter: { id: "fighter", name: "the fighter", robes: "the fighter's mail", concept: PREGENS.fighter!.concept, build: fighter },
  rogue: { id: "rogue", name: "the rogue", robes: "the rogue's soft shoes", concept: PREGENS.rogue!.concept, build: PREGENS.rogue!.build },
  cleric: { id: "cleric", name: "the cleric", robes: "the cleric's vestments", concept: PREGENS.cleric!.concept, build: cleric },
  barbarian: {
    id: "barbarian", name: "the barbarian", robes: "the barbarian's furs", concept: "a goliath porter from the grain wharves who discovered rage at a rates meeting and never looked back",
    build: { classId: "barbarian", subclassId: "path-of-the-berserker", speciesId: "goliath", backgroundId: "soldier", abilities: ["STR", "CON", "DEX", "WIS", "CHA", "INT"], skills: ["athletics", "intimidation", "survival"], feat: "savage-attacker", cantrips: [], spells: [], weapons: ["greataxe", "handaxe"], armor: "none", shield: false },
  },
  bard: {
    id: "bard", name: "the bard", robes: "the bard's good coat", concept: "a lute-player from the Assembly's lesser entertainments, very good at insults and very bad at running away",
    build: { classId: "bard", subclassId: "college-of-lore", speciesId: "elf", backgroundId: "acolyte", abilities: ["CHA", "DEX", "CON", "WIS", "INT", "STR"], skills: ["performance", "persuasion", "deception", "insight"], feat: "skilled", cantrips: ["vicious-mockery", "light"], spells: ["healing-word", "dissonant-whispers", "thunderwave", "faerie-fire", "charm-person", "heroism", "shatter", "hypnotic-pattern"], weapons: ["rapier", "dagger"], armor: "leather-armor", shield: false },
  },
  sorcerer: {
    id: "sorcerer", name: "the sorcerer", robes: "the sorcerer's scorched gloves", concept: "a tiefling with a dragon somewhere in the family tree and the temper to prove it",
    build: { classId: "sorcerer", subclassId: "draconic-sorcery", speciesId: "tiefling", backgroundId: "sage", abilities: ["CHA", "CON", "DEX", "WIS", "INT", "STR"], skills: ["arcana", "intimidation"], feat: "alert", cantrips: ["acid-splash", "chill-touch", "poison-spray", "shocking-grasp"], spells: ["chromatic-orb", "magic-missile", "burning-hands", "scorching-ray", "shatter", "lightning-bolt", "fireball"], weapons: ["dagger", "quarterstaff"], armor: "none", shield: false },
  },
};

/** The build the visitor is wearing now, by its class (a class feature's to ask: the tailor's fighter has Second Wind too). */
export function wearing(session: SessionState): string | undefined {
  const line = session.player.build ?? "";
  return Object.values(BUILDS).find(b => new RegExp(`\\b${b.build.classId}\\b`, "i").test(line))?.id;
}

/** Are these the robes the visitor has on (the wardrobe's and the rail's to ask)? A tailor's cut of the same class isn't them. */
export const inRobes = (session: SessionState, id: string): boolean => session.player.concept === BUILDS[id]?.concept;

/**
 * Become another build: a new character sheet from the engine (the same name; the build's concept),
 * and the gear the old one carried in the world swapped for the new one's. Returns the sheet's line.
 */
export async function wear(session: SessionState, id: string, world?: SceneWorld): Promise<string> {
  const b = BUILDS[id];
  if (!b) throw new Error(`No build ${id} in the wardrobe`);
  session.player.concept = b.concept;
  const line = await createCharacter(session, ZOO_LEVEL, b.build);
  if (world) refit(session, world);
  return line;
}

/** The player's gear in a world, as their sheet now has it: what the old build carried goes, the new build's comes out. */
export function refit(session: SessionState, world: SceneWorld): void {
  const gear = session.rules?.gear ?? [];
  const keep = new Set(gear.map(g => g.id));
  for (const e of Object.values(world.entities)) if (e.gear && !keep.has(e.gear)) delete world.entities[e.id];
  const first = session.player.name.split(" ")[0]!;
  for (const g of gear) {
    if (Object.values(world.entities).some(e => e.gear === g.id)) continue;
    let id = `${first}-${g.name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    for (let n = 2; world.entities[id]; n++) id = `${id}-${n}`;
    const item: Entity = { id, name: `${first}'s ${g.name.toLowerCase()}`, kind: "item", parent: "player", tags: [g.kind], states: g.slot ? [g.slot === "mainHand" || g.slot === "offHand" ? "in hand" : "worn"] : [], notes: [], gear: g.id };
    world.entities[id] = item;
  }
}
