import type * as Dnd from "../../../vendor/dnd-srd-engine/dnd-srd-engine.js";
import { ABILITIES, dnd, statusLine, type Build } from "../../rules/dnd.ts";
import { SKILLS, type Skill } from "../../runtime/scene.ts";
import type { SessionState } from "../../runtime/session.ts";

/**
 * Ready-made player characters for the headless fights (demo, tests) and a "quick start": the
 * same engine steps as `createCharacter` in src/rules/dnd.ts (level 1, the engine's choices, level
 * up, kit equipped), with the build given instead of asked of the model. No network.
 */

export const PREGENS: Record<string, { concept: string; build: Build }> = {
  fighter: {
    concept: "a broken-nosed ex-sergeant of the river watch who solves most problems with a longsword and the rest with a longer one",
    build: { classId: "fighter", subclassId: "champion", speciesId: "human", backgroundId: "soldier", abilities: ["STR", "CON", "DEX", "WIS", "CHA", "INT"],
      skills: ["athletics", "intimidation", "perception"], feat: "savage-attacker", cantrips: [], spells: [], weapons: ["longsword", "longbow"], armor: "chain-mail", shield: true },
  },
  wizard: {
    concept: "an absent-minded hedge-wizard of the Invisible College who has read about fire extensively and is keen to try it",
    build: { classId: "wizard", subclassId: "evoker", speciesId: "human", backgroundId: "sage", abilities: ["INT", "DEX", "CON", "WIS", "CHA", "STR"],
      skills: ["arcana", "investigation", "history"], feat: "alert", cantrips: ["fire-bolt", "ray-of-frost", "light"],
      spells: ["burning-hands", "magic-missile", "shield", "thunderwave", "sleep", "scorching-ray", "fireball", "misty-step"], weapons: ["quarterstaff", "dagger"], armor: "none", shield: false },
  },
  rogue: {
    concept: "a palace inspector with soft shoes, a rapier and a notebook, who reads people better than ledgers",
    build: { classId: "rogue", subclassId: "thief", speciesId: "halfling", backgroundId: "criminal", abilities: ["DEX", "CON", "INT", "WIS", "CHA", "STR"],
      skills: ["investigation", "insight", "stealth", "perception", "sleight-of-hand"], feat: "alert", cantrips: [], spells: [], weapons: ["rapier", "shortbow", "dagger"], armor: "leather-armor", shield: false },
  },
  cleric: {
    concept: "a cheerful priest of the river god who blesses barges for a living and hits harder than you'd think",
    build: { classId: "cleric", subclassId: "life-domain", speciesId: "dwarf", backgroundId: "acolyte", abilities: ["WIS", "CON", "STR", "DEX", "CHA", "INT"],
      skills: ["insight", "medicine", "religion"], feat: "alert", cantrips: ["sacred-flame", "guidance", "thaumaturgy"],
      spells: ["cure-wounds", "healing-word", "guiding-bolt", "bless", "shield-of-faith", "spiritual-weapon"], weapons: ["mace"], armor: "chain-shirt", shield: true },
  },
};

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const CASTING: Record<string, { cantrips: number; prepared: (l: number) => number; maxSpell: (l: number) => number }> = {
  bard: { cantrips: 2, prepared: l => l + 3, maxSpell: l => Math.ceil(l / 2) }, cleric: { cantrips: 3, prepared: l => l + 3, maxSpell: l => Math.ceil(l / 2) },
  druid: { cantrips: 2, prepared: l => l + 3, maxSpell: l => Math.ceil(l / 2) }, sorcerer: { cantrips: 4, prepared: l => l + 3, maxSpell: l => Math.ceil(l / 2) },
  wizard: { cantrips: 3, prepared: l => l + 3, maxSpell: l => Math.ceil(l / 2) }, warlock: { cantrips: 2, prepared: l => l + 1, maxSpell: l => Math.min(5, Math.ceil(l / 2)) },
  paladin: { cantrips: 0, prepared: l => l + 1, maxSpell: l => (l < 5 ? 1 : Math.ceil(l / 4)) }, ranger: { cantrips: 0, prepared: l => l + 1, maxSpell: l => (l < 5 ? 1 : Math.ceil(l / 4)) },
};

/** A session with an engine character and no scene played yet (the Heron's place in the arc is up to the caller). */
export async function pregenSession(options: { name?: string; pregen?: keyof typeof PREGENS | string; build?: Build; concept?: string; level?: number; seed?: number; sceneId?: string }): Promise<SessionState> {
  const preset = PREGENS[options.pregen ?? "fighter"] ?? PREGENS.fighter!;
  const build = options.build ?? preset.build;
  const name = options.name ?? "Wren Ashdown";
  const state: SessionState = {
    id: `pregen-${build.classId}-${options.seed ?? 1}`, sceneId: options.sceneId ?? "heron-warehouse", approach: "v2",
    seed: options.seed ?? 1, rollCount: 0, player: { name, concept: options.concept ?? preset.concept, modifiers: {} },
    turn: 0, beat: "midnight", turnsInBeat: 0, path: [], established: [], canon: [], notes: null, notesTurn: null,
    patches: [], repairs: [], transcript: [], metrics: [], history: [],
  };
  await buildCharacter(state, build, options.level ?? 3);
  state.rules!.status = await statusLine(state);
  return state;
}

/** The engine steps of createCharacter, for a build that's already legal. */
async function buildCharacter(state: SessionState, build: Build, level: number): Promise<void> {
  const { E, pack } = await dnd();
  const engine = E.createEngine({ contentPacks: [pack], rng: E.seededRNG(state.seed) });
  const content = engine.content;
  let campaign = engine.createCampaign({ name: state.id });
  const apply = (events: Dnd.EngineEvent[]) => { campaign = E.commit(campaign, events); return events; };
  const ev = (type: string, rest: Record<string, unknown>): Dnd.EngineEvent => ({ id: E.newEventId(), at: new Date().toISOString(), type, ...rest });
  const cls = content.classes.get(build.classId)!;
  const casting = CASTING[build.classId];
  const onList = (id: string, ok: (l: number) => boolean) => { const s = content.spells.get(id); return !!s && s.classes.includes(build.classId) && ok(s.level); };
  const cantrips = casting ? build.cantrips.filter(id => onList(id, l => l === 0)).slice(0, casting.cantrips) : [];
  const spells = casting ? build.spells.filter(id => onList(id, l => l >= 1 && l <= casting.maxSpell(level))).slice(0, casting.prepared(level)) : [];
  const scores = Object.fromEntries(ABILITIES.map(a => [a, STANDARD_ARRAY[build.abilities.indexOf(a)] ?? 10])) as Record<Dnd.Ability, number>;
  // Background ability increases (2024): +2 and +1 among the background's three, as createCharacter does.
  const bgOptions = (content.backgrounds.get(build.backgroundId)?.["abilityScoreIncreases"] as { options?: string[] } | undefined)?.options ?? ABILITIES;
  const [plusTwo, plusOne] = build.abilities.filter(a => bgOptions.includes(a));
  if (plusTwo) scores[plusTwo as Dnd.Ability] += 2;
  if (plusOne) scores[plusOne as Dnd.Ability] += 1;
  const hitDie = Number(cls.hitDie ?? 8);
  const conMod = Math.floor((scores.CON - 10) / 2);
  const pc = E.CharacterSchema.parse({
    id: E.newCharacterId(), name: state.player.name, speciesId: build.speciesId, backgroundId: build.backgroundId,
    classes: [{ classId: build.classId, level: 1, hitDiceRemaining: 1 }], abilityScores: scores,
    hp: { current: hitDie + conMod, max: hitDie + conMod, temp: 0 }, knownSpells: [...cantrips, ...spells], preparedSpells: spells,
  });
  apply([ev("CharacterCreated", { snapshot: pc })]);
  const item = (definitionId: string) => ({ id: E.newItemInstanceId(), definitionId, quantity: 1, attuned: false, identifiedByCharacterIds: [] });
  const gear = [...build.weapons, "unarmed-strike", ...(build.armor !== "none" ? [build.armor] : []), ...(build.shield ? ["shield"] : [])].filter(id => content.items.has(id)).map(item);
  apply(gear.map(instance => ev("ItemAcquired", { instance, characterId: pc.id })));
  const equip = (instanceId: string | undefined, slot: "mainHand" | "armor" | "shield") => {
    if (!instanceId) return;
    try { apply(engine.plan.equip(campaign.state, { characterId: pc.id, instanceId, slot }).events); } catch { /* carried, not worn */ }
  };
  equip(gear.find(g => g.definitionId === build.weapons[0])?.id, "mainHand");
  equip(gear.find(g => g.definitionId === build.armor)?.id, "armor");
  equip(gear.find(g => g.definitionId === "shield")?.id, "shield");
  const prefer = [...build.skills, build.feat, build.subclassId, ...cantrips, ...spells, "medium", "ability-score-improvement",
    ...build.abilities.flatMap(a => [a.toLowerCase()])].filter(Boolean).map(k => k.toLowerCase());
  // The class's own skill picks, offered as a choice like createCharacter does.
  const skillChoices = cls["skillChoices"] as { choices: number; from: string[] } | undefined;
  const background = (content.backgrounds.get(build.backgroundId)?.["skillProficiencies"] as string[] | undefined) ?? [];
  const from = (skillChoices?.from ?? []).filter(k => !background.includes(k));
  if (skillChoices && from.length) {
    apply([ev("ChoiceRequired", {
      choiceId: E.newEventId(), characterId: pc.id, promptKey: `${build.classId}-skills`, prompt: `Choose ${skillChoices.choices} skills.`,
      oneOf: Math.min(skillChoices.choices, from.length),
      options: from.map(k => ({ id: k, label: k, effects: [{ kind: "GrantProficiency", target: "skill", id: k, level: "proficient" }] })),
    })]);
  }
  apply(engine.plan.offerCharacterChoices(campaign.state, { characterId: pc.id }).events);
  const resolve = () => {
    for (let guard = 0; guard < 40; guard++) {
      const open = Object.values(campaign.state.pendingChoices).find(c => c.forCharacterId === pc.id && c.resolution === undefined);
      if (!open) return;
      const n = Math.max(1, Math.min(open.oneOf ?? 1, open.options.length));
      const rank = (o: Dnd.ChoiceOption) => Math.min(...[o.id, o.label].map(k => prefer.indexOf(k.toLowerCase())).map(i => (i < 0 ? Infinity : i)));
      const ranked = open.options.map((o, i) => ({ o, r: rank(o), i })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.o);
      try {
        apply(engine.plan.resolveChoice(campaign.state, { characterId: pc.id, choiceId: open.id, selectedOptionIds: ranked.slice(0, n).map(o => o.id) }).events);
      } catch {
        apply(engine.plan.resolveChoice(campaign.state, { characterId: pc.id, choiceId: open.id, selectedOptionIds: open.options.slice(0, n).map(o => o.id) }).events);
      }
    }
  };
  resolve();
  for (let l = 2; l <= level; l++) {
    try { apply(engine.plan.levelUp(campaign.state, { characterId: pc.id, classId: build.classId, hpStrategy: "average" }).events); resolve(); } catch { break; }
  }
  const sheetNow = () => E.buildCharacterSheet({ character: campaign.state.characters[pc.id]!, itemInstances: campaign.state.itemInstances, content, characters: campaign.state.characters, pendingChoices: campaign.state.pendingChoices });
  // Features that raise maximum hit points (a dwarf's toughness) don't raise the current: start whole.
  const missing = sheetNow().effectiveHpMax - campaign.state.characters[pc.id]!.hp.current;
  if (missing > 0) apply([ev("Healed", { targetId: pc.id, amount: missing, source: "pregen" })]);
  const sheet = sheetNow();
  state.rules = {
    campaign: E.serializeCampaign(campaign), pc: pc.id, npcs: {}, prefer,
    spells: (sheet.spellcasting?.spellsByLevel ?? []).flatMap(g => g.spells.filter(sp => g.level === 0 || sp.prepared || sp.alwaysPrepared)).map(sp => ({ id: sp.spellId, name: sp.name, level: sp.level })),
    weapons: campaign.state.characters[pc.id]!.inventory.map(i => campaign.state.itemInstances[i]).filter((i): i is Dnd.ItemInstance => !!i && content.items.get(i.definitionId)?.itemKind === "weapon").map(i => ({ id: i.id, name: content.items.get(i.definitionId)!.name })),
  };
  state.player.modifiers = Object.fromEntries(SKILLS.map((skill: Skill) => [skill, sheet.skills.find(s => s.skill === skill.replace(/_/g, "-"))?.modifier ?? 0]));
  state.player.build = `${build.speciesId} ${build.classId} ${level}${build.subclassId ? ` (${build.subclassId})` : ""}, ${build.backgroundId} background`;
}
