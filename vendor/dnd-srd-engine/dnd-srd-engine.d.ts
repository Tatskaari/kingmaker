// Minimal typings for the vendored dnd-srd-engine bundle: only the surface Kingmaker uses.
// The engine's own (much larger) declarations live in its repository; see README.md.

export type Ability = "STR" | "DEX" | "CON" | "INT" | "WIS" | "CHA";
export type Advantage = "advantage" | "disadvantage" | "none";

export interface EngineEvent { id: string; at: string; type: string; [key: string]: unknown }
export interface PlanResult { events: EngineEvent[]; [key: string]: unknown }

export interface ItemInstance { id: string; definitionId: string; quantity: number; attuned: boolean; identifiedByCharacterIds: string[] }

export interface ChoiceOption { id: string; label: string; [key: string]: unknown }
export interface PendingChoice { id: string; prompt: string; options: ChoiceOption[]; oneOf?: number; forCharacterId: string; promptKey?: string; resolution?: unknown }

export interface AppliedCondition { conditionId: string; [key: string]: unknown }

export interface EngineCharacter {
  id: string;
  kind: "pc" | "npc" | "creature";
  statblockId?: string;
  name: string;
  speciesId: string;
  backgroundId: string;
  classes: Array<{ classId: string; subclassId?: string; level: number; hitDiceRemaining: number }>;
  abilityScores: Record<Ability, number>;
  hp: { current: number; max: number; temp: number };
  armorClass?: number;
  inventory: string[];
  equipped: { mainHand?: string; offHand?: string; armor?: string; shield?: string; attuned: string[] };
  appliedConditions: AppliedCondition[];
  knownSpells: string[];
  preparedSpells: string[];
  spellSlotsUsed: Record<string, number>;
  featsTaken: string[];
  deathSaves: { successes: number; failures: number; stable: boolean };
  heroicInspiration: boolean;
  [key: string]: unknown;
}

export interface CampaignState {
  characters: Record<string, EngineCharacter>;
  itemInstances: Record<string, ItemInstance>;
  pendingChoices: Record<string, PendingChoice>;
  [key: string]: unknown;
}
export interface Campaign { id: string; name: string; state: CampaignState; events: EngineEvent[]; [key: string]: unknown }

export interface Named { id: string; name: string; [key: string]: unknown }
export interface SpellDef extends Named {
  level: number; school: string; castingTime: string; range: string; duration: string;
  concentration: boolean; ritual: boolean; classes: string[]; components?: Record<string, unknown>;
  mechanicalEffects?: Array<{ kind: string; [key: string]: unknown }>;
}
export interface ItemDef extends Named {
  itemKind: string; category?: string; attackKind?: string; damageDice?: string; damageType?: string;
  properties?: string[]; armorCategory?: string; [key: string]: unknown;
}
export interface Statblock extends Named {
  size: string; type: string; ac: number; hp: { average: number; formula: string };
  abilityScores: Record<Ability, number>; cr: number; multiattack?: unknown; [key: string]: unknown;
}
export interface ClassDef extends Named { hitDie?: number | string; [key: string]: unknown }

export interface Content {
  species: Map<string, Named>;
  backgrounds: Map<string, Named>;
  classes: Map<string, ClassDef>;
  subclasses: Map<string, Named>;
  feats: Map<string, Named>;
  spells: Map<string, SpellDef>;
  items: Map<string, ItemDef>;
  monsters: Map<string, Statblock>;
  conditions: Map<string, Named>;
}

export interface RNG { state: unknown }

export interface CharacterSheet {
  id: string; name: string; totalLevel: number; proficiencyBonus: number;
  abilityScores: Record<Ability, number>; abilityModifiers: Record<Ability, number>;
  hp: { current: number; max: number; temp: number }; effectiveHpMax: number;
  ac: { total: number };
  savingThrows: Record<Ability, { total: number }>;
  spellSlots: { slotsByLevel: number[] };
  skills: Array<{ skill: string; ability: Ability; proficiency: string; modifier: number; hasAdvantage: boolean; hasDisadvantage: boolean }>;
  passiveScores: Record<string, number>;
  initiative: { modifier: number };
  speeds: Record<string, number>;
  attacks: Array<{ name: string; attackKind: string; attackBonus: number; damage: { dice: string; modifier: number; type: string }; unarmed?: boolean; instanceId?: string }>;
  inventory: { items: Array<{ instanceId: string; definitionId: string; name: string; itemKind: string; quantity: number; equippedSlot?: string }> };
  spellcasting?: {
    classes: Array<{ classId: string; className: string; ability: Ability; saveDC: number; attackBonus: number }>;
    spellsByLevel: Array<{ level: number; spells: Array<{ spellId: string; name: string; level: number; prepared: boolean; alwaysPrepared: boolean }> }>;
  };
  knownLanguages: string[];
  [key: string]: unknown;
}

export interface Engine {
  content: Content;
  createCampaign(options: { name: string }): Campaign;
  plan: {
    offerCharacterChoices(state: CampaignState, intent: { characterId: string }): PlanResult;
    resolveChoice(state: CampaignState, intent: { characterId: string; choiceId: string; selectedOptionIds: string[] }): PlanResult;
    equip(state: CampaignState, intent: { characterId: string; instanceId: string; slot: "mainHand" | "offHand" | "armor" | "shield" }): PlanResult;
    attack(state: CampaignState, intent: { attackerId: string; targetId: string; weaponInstanceId: string; advantage?: Advantage }): PlanResult;
    castSpell(state: CampaignState, intent: { characterId: string; spellId: string; slotLevel: number; targetIds: string[] }): PlanResult;
    abilityCheck(state: CampaignState, intent: { type: "AbilityCheck"; characterId: string; ability: Ability; skill?: string; dc?: number; advantage?: Advantage }): PlanResult;
    save(state: CampaignState, intent: { type: "Save"; characterId: string; ability: Ability; dc: number; advantage?: Advantage }): PlanResult;
    shortRest(state: CampaignState, intent: { participantIds: string[]; hitDiceToSpend?: Record<string, number> }): PlanResult;
    longRest(state: CampaignState, intent: { participantIds: string[] }): PlanResult;
    levelUp(state: CampaignState, intent: { characterId: string; classId: string; hpStrategy: "average" | "rolled" }): PlanResult;
    expireSpellDurations(state: CampaignState, intent: { type: "ExpireSpellDurations" }): PlanResult | EngineEvent[];
    [planner: string]: unknown;
  };
}

export function createEngine(options: { contentPacks: unknown[]; rng: RNG }): Engine;
export function seededRNG(seed: number): RNG;
export function loadStarterPack(): unknown;
export const CharacterSchema: { parse(input: unknown): EngineCharacter };
export function commit(campaign: Campaign, events: EngineEvent[]): Campaign;
export function newEventId(): string;
export function newCharacterId(): string;
export function newItemInstanceId(): string;
export function serializeCampaign(campaign: Campaign): string;
export function loadCampaign(serialized: string, engine: Engine): Campaign;
export function buildCharacterSheet(input: { character: EngineCharacter; itemInstances: Record<string, ItemInstance>; content: Content; characters: Record<string, EngineCharacter>; pendingChoices?: Record<string, PendingChoice> }): CharacterSheet;
