import { create } from "@bufbuild/protobuf";
import { DndCharacterSchema, InventorySchema, ProficiencyKind, ProficiencyRank } from "../../../packages/contracts/src/index.js";

const abilities = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"] as const;
const skills = ["acrobatics", "animal_handling", "arcana", "athletics", "deception", "history", "insight", "intimidation", "investigation", "medicine", "nature", "perception", "performance", "persuasion", "religion", "sleight_of_hand", "stealth", "survival"];
// Prototype starting packages, not a complete implementation of class features.
const classes = {
  barbarian: { hitDie: 12, subclass: "berserker", saves: ["strength", "constitution"] },
  bard: { hitDie: 8, subclass: "college-of-lore", saves: ["dexterity", "charisma"] },
  cleric: { hitDie: 8, subclass: "life-domain", saves: ["wisdom", "charisma"] },
  druid: { hitDie: 8, subclass: "circle-of-the-land", saves: ["intelligence", "wisdom"] },
  fighter: { hitDie: 10, subclass: "champion", saves: ["strength", "constitution"] },
  monk: { hitDie: 8, subclass: "warrior-of-the-open-hand", saves: ["strength", "dexterity"] },
  paladin: { hitDie: 10, subclass: "oath-of-devotion", saves: ["wisdom", "charisma"] },
  ranger: { hitDie: 10, subclass: "hunter", saves: ["strength", "dexterity"] },
  rogue: { hitDie: 8, subclass: "thief", saves: ["dexterity", "intelligence"] },
  sorcerer: { hitDie: 6, subclass: "draconic-sorcery", saves: ["constitution", "charisma"] },
  warlock: { hitDie: 8, subclass: "fiend-patron", saves: ["wisdom", "charisma"] },
  wizard: { hitDie: 6, subclass: "evoker", saves: ["intelligence", "wisdom"] },
} as const;

export const playerBuildParameter = {
  type: "object", additionalProperties: false, required: ["classId", "abilityPriority", "skills"],
  description: "Infer a level 3 starting build from the interview: occupation, training and demonstrated talents. Do not ask the player to fill out a rules form. Use a mundane class for a mundane history. The first two skills receive expertise for bards and rogues. Code assigns scores, HP and level; never invent those numbers.",
  properties: {
    classId: { type: "string", enum: Object.keys(classes) },
    abilityPriority: { type: "array", minItems: 6, maxItems: 6, uniqueItems: true, items: { type: "string", enum: abilities }, description: "All six abilities, strongest first. Receives final scores 15, 14, 13, 12, 10, 8 respectively." },
    skills: { type: "array", minItems: 4, maxItems: 4, uniqueItems: true, items: { type: "string", enum: skills }, description: "Four skills justified by the interview, strongest talents first." },
  },
};

function selection(value: unknown, allowed: readonly string[], count: number, label: string): string[] {
  if (!Array.isArray(value) || value.length !== count || new Set(value).size !== count
    || value.some(item => typeof item !== "string" || !allowed.includes(item))) {
    throw new Error(`${label} must contain ${count} distinct supported choices.`);
  }
  return value as string[];
}

export function buildInterviewCharacter(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("The Stranger must supply a character build.");
  const choice = input as Record<string, unknown>;
  if (typeof choice.classId !== "string" || !Object.hasOwn(classes, choice.classId)) throw new Error("Choose a supported character class.");
  const classId = choice.classId as keyof typeof classes, profile = classes[classId];
  const priority = selection(choice.abilityPriority, abilities, 6, "Ability priority");
  const selectedSkills = selection(choice.skills, skills, 4, "Skills");
  const scores = Object.fromEntries(priority.map((ability, index) => [ability, [15, 14, 13, 12, 10, 8][index]!])) as Record<typeof abilities[number], number>;
  const hp = profile.hitDie + 2 * (profile.hitDie / 2 + 1) + 3 * Math.floor((scores.constitution - 10) / 2);
  return {
    dnd: create(DndCharacterSchema, {
      rulesetId: "srd-5.2.1", speciesId: "human", backgroundId: "kingmaker-traveller",
      abilityScores: scores, classes: [{ classId, subclassId: profile.subclass, level: 3, hitDiceRemaining: 3 }],
      experience: 900, hitPoints: { current: hp, maximum: hp },
      proficiencies: [
        ...selectedSkills.map((targetId, index) => ({ kind: ProficiencyKind.SKILL, targetId,
          rank: (classId === "bard" || classId === "rogue") && index < 2 ? ProficiencyRank.EXPERTISE : ProficiencyRank.PROFICIENT,
          sourceId: "kingmaker-traveller" })),
        ...profile.saves.map(targetId => ({ kind: ProficiencyKind.SAVING_THROW, targetId, rank: ProficiencyRank.PROFICIENT, sourceId: classId })),
      ],
    }),
    inventory: create(InventorySchema, { items: [
      { id: "player_clothes", definitionId: "fine-clothes", name: "Traveller's clothes", quantity: 1 },
      { id: "player_dagger", definitionId: "dagger", name: "Dagger", quantity: 1 },
    ] }),
  };
}
