/** Player-facing starting identities; the GM supplies their scenario integration. */
export const premadeCharacters = [
  { id: "fighter", archetype: "The Sellsword", name: "Merrin Ward", gender: "woman", homeland: "Independent", sprite: 84,
    embassyRole: "A hired guard accompanying visitors to the assembly",
    lore: "You are Merrin Ward, a veteran caravan guard who trusts a steady blade and a blunt word. Hired to escort visitors to the assembly, you now have time to explore the court. You privately serve the Laughing Stranger and know none of the courtiers personally.",
    currentGoal: "Explore the court and see where a strong arm can make a difference.",
    build: { classId: "fighter", abilityPriority: ["strength", "constitution", "charisma", "wisdom", "dexterity", "intelligence"], skills: ["athletics", "intimidation", "perception", "insight"] } },
  { id: "bard", archetype: "The Silver Tongue", name: "Tamsin Reed", gender: "woman", homeland: "Independent", sprite: 86,
    embassyRole: "A travelling performer hired to entertain assembly guests",
    lore: "You are Tamsin Reed, a travelling singer who trades in compliments, stories and well-timed jokes. An engagement entertaining assembly guests brings you to court. You privately serve the Laughing Stranger and know none of the courtiers personally.",
    currentGoal: "Meet the court and find an audience worth winning over.",
    build: { classId: "bard", abilityPriority: ["charisma", "dexterity", "constitution", "wisdom", "intelligence", "strength"], skills: ["persuasion", "performance", "deception", "insight"] } },
  { id: "rogue", archetype: "The Rumour Broker", name: "Kit Vale", gender: "nonbinary", homeland: "Independent", sprite: 98,
    embassyRole: "A freelance courier delivering correspondence to assembly guests",
    lore: "You are Kit Vale, a freelance courier with a talent for listening unnoticed and talking around awkward questions. Delivering letters to assembly guests gives you a reason to visit court. You privately serve the Laughing Stranger and know none of the courtiers personally.",
    currentGoal: "Explore the court and discover what people are willing to talk about.",
    build: { classId: "rogue", abilityPriority: ["dexterity", "charisma", "intelligence", "constitution", "wisdom", "strength"], skills: ["deception", "investigation", "stealth", "perception"] } },
] as const;
export type PremadeCharacter = typeof premadeCharacters[number];
export function premadeCharacter(id: string): PremadeCharacter {
  const character = premadeCharacters.find(item => item.id === id);
  if (!character) throw new Error("Choose an available pre-made character.");
  return character;
}
