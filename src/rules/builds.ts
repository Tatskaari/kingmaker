import { gmOffline, respondJson, type Ask } from "../llm/openrouter.ts";
import type { SessionState } from "../runtime/session.ts";
import { BUILD_FIELDS, BUILD_GUIDE, BUILD_SCHEMA, buildMenu, createCharacter, settleBuild, sheetData, srdContent, type Build, type SheetData } from "./dnd.ts";

/**
 * Character creation's choices (the app's creation screens, the QA console's qa new, the zoo's
 * tailor): three distinct builds that fit a concept, from one model call, each made legal by the
 * rules engine and shown as a card (who they are, how they'd play, the numbers that matter);
 * offline, three from the class defaults that best match the concept's words; and a build of the
 * player's own making (a species, class, subclass and background from the SRD's lists, the rest
 * from the class's defaults), made legal the same way.
 */

/** What a build comes to, as the engine makes it: the numbers a card shows. */
export interface BuildCard {
  species: string;
  className: string;
  /** Where the level has one (2024: from level 3). */
  subclass?: string;
  background: string;
  level: number;
  hp: number;
  ac: number;
  speed: number;
  /** The weapon in hand (or the first they carry): what they'd hit someone with. */
  attack?: { name: string; bonus: number; damage: string; type: string };
  /** A caster's: the save DC and spell attack, the cantrips and the levelled spells ready. */
  casting?: { ability: string; saveDC: number; attackBonus: number; cantrips: string[]; spells: string[] };
  /** The class features worth naming on a card (Sneak Attack, Rage, Second Wind), with their uses. */
  features: string[];
  /** Trained skills, the build's most characteristic first. */
  skills: string[];
}

export interface BuildOption {
  /** Legal already (settleBuild's): character creation makes exactly this. */
  build: Build;
  /** How they'd play, in a sentence. */
  plays: string;
  card: BuildCard;
  /** The build in a line, as the GM's brief has it ("halfling rogue 3 (Thief), criminal background"). */
  line: string;
  /** The model's, the class defaults' (offline, or to fill in), or the player's own. */
  from: "model" | "defaults" | "own";
}

export interface Offer {
  options: BuildOption[];
  /** Why they're the class defaults rather than the model's: the GM is offline, or couldn't be reached. */
  note?: string;
}

// ---------------------------------------------------------------------------------------------
// The class defaults: a build for each class, the words that suggest it, how it plays.

type Defaults = Omit<Build, "classId">;
const DEFAULTS: Record<string, Defaults & { plays: string }> = {
  barbarian: { subclassId: "path-of-the-berserker", speciesId: "goliath", backgroundId: "soldier", abilities: ["STR", "CON", "DEX", "WIS", "CHA", "INT"],
    skills: ["athletics", "intimidation", "perception", "survival"], feat: "alert", cantrips: [], spells: [], weapons: ["greataxe", "handaxe"], armor: "none", shield: false,
    plays: "Rage first, reasons later: you hit the hardest, take the most, and treat doors as suggestions." },
  bard: { subclassId: "college-of-lore", speciesId: "human", backgroundId: "acolyte", abilities: ["CHA", "DEX", "CON", "WIS", "INT", "STR"],
    skills: ["performance", "persuasion", "deception", "insight"], feat: "skilled", cantrips: ["vicious-mockery", "minor-illusion", "light"],
    spells: ["healing-word", "dissonant-whispers", "charm-person", "suggestion", "faerie-fire", "shatter", "heroism", "sleep", "silence", "hypnotic-pattern", "mass-healing-word"],
    weapons: ["rapier", "dagger"], armor: "leather-armor", shield: false,
    plays: "Talk first, sing second, stab third: Bardic Inspiration for your friends and Vicious Mockery for everyone else." },
  cleric: { subclassId: "life-domain", speciesId: "dwarf", backgroundId: "acolyte", abilities: ["WIS", "CON", "STR", "CHA", "DEX", "INT"],
    skills: ["insight", "medicine", "religion", "persuasion"], feat: "alert", cantrips: ["sacred-flame", "guidance", "thaumaturgy", "spare-the-dying"],
    spells: ["cure-wounds", "healing-word", "bless", "guiding-bolt", "spiritual-weapon", "lesser-restoration", "shield-of-faith", "aid", "spirit-guardians", "revivify"],
    weapons: ["mace"], armor: "chain-shirt", shield: true,
    plays: "The one who keeps everyone standing: healing, blessings, a god's ear, and a mace for the unrepentant." },
  druid: { subclassId: "circle-of-the-land", speciesId: "elf", backgroundId: "sage", abilities: ["WIS", "CON", "DEX", "INT", "CHA", "STR"],
    skills: ["nature", "animal-handling", "perception", "survival"], feat: "alert", cantrips: ["produce-flame", "guidance", "druidcraft"],
    spells: ["entangle", "goodberry", "cure-wounds", "faerie-fire", "moonbeam", "pass-without-trace", "barkskin", "speak-with-animals", "fog-cloud", "call-lightning"],
    weapons: ["quarterstaff", "sickle"], armor: "leather-armor", shield: false,
    plays: "The weather, the beasts and the growing things answer you, and Wild Shape gets you where nobody else can." },
  fighter: { subclassId: "champion", speciesId: "human", backgroundId: "soldier", abilities: ["STR", "CON", "DEX", "WIS", "CHA", "INT"],
    skills: ["athletics", "intimidation", "perception", "insight"], feat: "alert", cantrips: [], spells: [], weapons: ["longsword", "longbow"], armor: "chain-mail", shield: true,
    plays: "Steady in a fight and stubborn out of one: the best armour, the most blows, and Second Wind when it goes wrong." },
  monk: { subclassId: "warrior-of-the-open-hand", speciesId: "human", backgroundId: "acolyte", abilities: ["DEX", "WIS", "CON", "STR", "INT", "CHA"],
    skills: ["acrobatics", "insight", "stealth", "athletics"], feat: "alert", cantrips: [], spells: [], weapons: ["quarterstaff", "dart"], armor: "none", shield: false,
    plays: "Quick hands and quicker feet: you strike twice, dodge most things, and never need a weapon." },
  paladin: { subclassId: "oath-of-devotion", speciesId: "dragonborn", backgroundId: "soldier", abilities: ["STR", "CHA", "CON", "WIS", "DEX", "INT"],
    skills: ["athletics", "persuasion", "insight", "intimidation"], feat: "alert", cantrips: [],
    spells: ["bless", "cure-wounds", "shield-of-faith", "heroism", "divine-favor", "protection-from-evil-and-good", "aid", "magic-weapon"],
    weapons: ["longsword", "javelin"], armor: "chain-mail", shield: true,
    plays: "A sworn sword: heavy armour, Divine Smite and Lay on Hands, and an oath people will expect you to keep." },
  ranger: { subclassId: "hunter", speciesId: "elf", backgroundId: "soldier", abilities: ["DEX", "WIS", "CON", "STR", "INT", "CHA"],
    skills: ["survival", "perception", "stealth", "investigation", "nature"], feat: "alert", cantrips: [],
    spells: ["hunters-mark", "goodberry", "ensnaring-strike", "cure-wounds", "pass-without-trace", "spike-growth", "longstrider", "alarm"],
    weapons: ["longbow", "shortsword"], armor: "studded-leather", shield: false,
    plays: "A tracker with a longbow: you find what's been hidden, mark your quarry, and don't lose the trail." },
  rogue: { subclassId: "thief", speciesId: "halfling", backgroundId: "criminal", abilities: ["DEX", "CON", "INT", "WIS", "CHA", "STR"],
    skills: ["investigation", "insight", "stealth", "perception", "sleight-of-hand"], feat: "alert", cantrips: [], spells: [], weapons: ["rapier", "shortbow", "dagger"], armor: "leather-armor", shield: false,
    plays: "Soft shoes and a sharp eye: you notice what others miss, open what's locked, and Sneak Attack when it counts." },
  sorcerer: { subclassId: "draconic-sorcery", speciesId: "tiefling", backgroundId: "acolyte", abilities: ["CHA", "CON", "DEX", "WIS", "INT", "STR"],
    skills: ["arcana", "persuasion", "insight", "intimidation"], feat: "alert", cantrips: ["fire-bolt", "prestidigitation", "mage-hand", "light"],
    spells: ["magic-missile", "shield", "burning-hands", "chromatic-orb", "misty-step", "scorching-ray", "fireball", "haste"],
    weapons: ["dagger", "quarterstaff"], armor: "none", shield: false,
    plays: "Magic in the blood: fewer spells than a wizard, but you bend them as you like (Metamagic) and they burn hot." },
  warlock: { subclassId: "fiend-patron", speciesId: "tiefling", backgroundId: "acolyte", abilities: ["CHA", "CON", "DEX", "WIS", "INT", "STR"],
    skills: ["deception", "intimidation", "arcana", "investigation"], feat: "alert", cantrips: ["eldritch-blast", "minor-illusion", "mage-hand"],
    spells: ["hex", "hellish-rebuke", "charm-person", "protection-from-evil-and-good", "misty-step", "suggestion", "invisibility", "hypnotic-pattern"],
    weapons: ["dagger", "quarterstaff"], armor: "leather-armor", shield: false,
    plays: "A bargain with something below: Eldritch Blast, a patron's gifts, and spells that come back after a short rest." },
  wizard: { subclassId: "evoker", speciesId: "gnome", backgroundId: "sage", abilities: ["INT", "CON", "DEX", "WIS", "CHA", "STR"],
    skills: ["arcana", "investigation", "history", "insight"], feat: "alert", cantrips: ["fire-bolt", "mage-hand", "light", "ray-of-frost"],
    spells: ["magic-missile", "shield", "detect-magic", "sleep", "misty-step", "scorching-ray", "burning-hands", "identify", "fireball", "counterspell"],
    weapons: ["quarterstaff", "dagger"], armor: "none", shield: false,
    plays: "A spell for every occasion, from the book: Shield, Magic Missile, Sleep, and an answer for most locks." },
};

/** When nothing in the concept says otherwise: an investigator could be any of these, in this order. */
const FALLBACK = ["rogue", "fighter", "wizard", "cleric", "bard", "ranger", "druid", "paladin", "warlock", "sorcerer", "monk", "barbarian"];

/** The words that suggest each class: its name (3), what it is (2), and what goes with it (1). */
const CLASS_WORDS: Record<string, Array<[RegExp, number]>> = {
  barbarian: [[/\bbarbarian|\bberserk/, 3], [/\b(rag(e|es|ing)|fury|furious|savage|brute|wild(ling)?)\b/, 2], [/\b(axe|greataxe|brawl\w*|porter|strong|tribe|tribal|big|large|huge)\b/, 1]],
  bard: [[/\bbard\b/, 3], [/\b(lute|minstrel|songs?|sings?|singer|singing|poet|actor|actress|perform\w*|musician|storyteller|silver-tongued|con artist|charm\w*|insults?)\b/, 2], [/\b(wits?|witty|witted|humou?r|talker|gossip|flatter\w*|tongue|jokes?)\b/, 1]],
  cleric: [[/\bcleric\b/, 3], [/\b(priest\w*|temple|gods?|goddess|faith|holy|pray\w*|chaplain|friar|healer|bless\w*)\b/, 2], [/\b(heal|heals|healing|gentle|mercy|vicar|pious|church|shrine|brother|sister)\b/, 1]],
  druid: [[/\bdruid\b/, 3], [/\b(witch\w*|weather|herb\w*|nature|forest|grove|beasts?|animals?|moon|rain)\b/, 2], [/\b(garden\w*|plants?|trees?|farm\w*|furrows?|country|village|wild)\b/, 1]],
  fighter: [[/\bfighter\b/, 3], [/\b(soldier|sergeant|veteran|mercenary|guard|knight|sword\w*|duel\w*|warrior|ex-soldier|man-at-arms)\b/, 2], [/\b(watch|militia|tough|broken-nosed|shield|armou?r|army|spear|fight\w*|brawl\w*)\b/, 1]],
  monk: [[/\bmonk\b/, 3], [/\b(martial|fists?|ascetic|disciplin\w*|monastery|unarmed|meditat\w*)\b/, 2], [/\b(quiet|calm|barefoot|agile|acrobat\w*|brother)\b/, 1]],
  paladin: [[/\bpaladin\b/, 3], [/\b(oath|vows?|sworn|crusader|righteous|zealot|justice)\b/, 2], [/\b(knight|honou?r|noble|duty|devot\w*)\b/, 1]],
  ranger: [[/\branger\b/, 3], [/\b(hunter|tracker|longbow|bow|archer|scout|trapper|woods\w*|poacher|forester|outrider)\b/, 2], [/\b(trail|tracks?|wild|roads?|wander\w*|underdogs?)\b/, 1]],
  rogue: [[/\brogue\b/, 3], [/\b(thief|burglar|spy|pickpocket|cutpurse|smuggler|investigator|detective|inspector|auditor|sneak\w*|assassin|locksmith|crook|fence)\b/, 2], [/\b(ledger\w*|rapier|quick-witted|sharp|shadows?|soft shoes|notebook|clerk|clever|eye)\b/, 1]],
  sorcerer: [[/\bsorcer(er|ess)\b/, 3], [/\b(bloodline|dragons?|draconic|innate|wild magic|born with)\b/, 2], [/\b(temper|fire|sparks?|storm|blood)\b/, 1]],
  warlock: [[/\bwarlock\b/, 3], [/\b(pact|patron|fiend\w*|devil\w*|eldritch|bargain\w*|demon\w*|infernal)\b/, 2], [/\b(debts?|owes?|deal|whispers?|dark|soul)\b/, 1]],
  wizard: [[/\bwizard\b/, 3], [/\b(mage|scholar|arcane|spellbook|college|academic|magister|thaumaturge|apprentice)\b/, 2], [/\b(books?|library|study|studied|reads?|reader|reading|well-read|cantrips?|spells?|sage)\b/, 1]],
};

/** The species a concept names (the SRD has no half-elves: they're elves here), first named first. */
const SPECIES_WORDS: Array<[RegExp, string]> = [
  [/\bhalf-?elf|\belf\b|\belves\b|\belven|\belvish/, "elf"], [/\bdwar(f|ves|ven|fish)/, "dwarf"], [/\bhalflings?\b/, "halfling"], [/\bgnom(e|es|ish)\b/, "gnome"],
  [/\bhalf-?orc|\borcs?\b|\borcish/, "orc"], [/\btieflings?\b/, "tiefling"], [/\bdragonborn\b/, "dragonborn"], [/\bgoliaths?\b/, "goliath"], [/\bhumans?\b/, "human"],
];

/** The background the concept's words suggest most (the SRD has four). */
const BACKGROUND_WORDS: Record<string, RegExp> = {
  acolyte: /\b(priest\w*|acolyte|temple|monk|nun|friar|chaplain|pilgrim|novice|shrine)\b/g,
  criminal: /\b(thief|criminal|smuggler|crook|con|burglar|pickpocket|cutpurse|fence|gang\w*|disgraced|outlaw|poacher)\b/g,
  sage: /\b(scholar|sage|clerk|auditor|scribe|student|librarian|academic|college|ledger\w*|archivist|wizard|book\w*)\b/g,
  soldier: /\b(soldier|sergeant|veteran|mercenary|guard|army|militia|watch|ex-soldier|knight)\b/g,
};

const score = (text: string, words: Array<[RegExp, number]>) => words.reduce((n, [rx, w]) => n + (rx.test(text) ? w : 0), 0);

/** The classes in order of how well the concept's words suggest them (the fallback order breaks ties). */
export function classesFor(concept: string): string[] {
  const text = concept.toLowerCase();
  return [...FALLBACK].map((id, i) => ({ id, i, s: score(text, CLASS_WORDS[id]!) })).sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.id);
}

/** The species a concept names, if it names one (the first it names). */
export function speciesFor(concept: string): string | undefined {
  const text = concept.toLowerCase();
  const named = SPECIES_WORDS.map(([rx, id]) => ({ id, at: text.search(rx) })).filter(x => x.at >= 0).sort((a, b) => a.at - b.at);
  return named[0]?.id;
}

/** The background a concept's words suggest, if they suggest one: the most words, then the first. */
export function backgroundFor(concept: string): string | undefined {
  const text = concept.toLowerCase();
  const hits = Object.entries(BACKGROUND_WORDS).map(([id, rx]) => ({ id, n: [...text.matchAll(rx)].length, at: text.search(new RegExp(rx.source)) })).filter(x => x.n);
  return hits.sort((a, b) => b.n - a.n || a.at - b.at)[0]?.id;
}

/** A class's default build, with what the concept names (a species, a background) in place of its own. */
function classDefault(classId: string, concept = ""): { build: Build; plays: string } {
  const d = DEFAULTS[classId] ?? DEFAULTS.rogue!;
  const { plays, ...rest } = d;
  return { build: { classId, ...rest, speciesId: speciesFor(concept) ?? d.speciesId, backgroundId: backgroundFor(concept) ?? d.backgroundId }, plays };
}

/** Offline: three builds from the class defaults that best match the concept's words, each a different class. */
export function defaultBuilds(concept: string): Array<{ build: Build; plays: string }> {
  return classesFor(concept).slice(0, 3).map(id => classDefault(id, concept));
}

// ---------------------------------------------------------------------------------------------
// Through the engine: a build made, and read off its sheet.

/** A session with nothing in it but the player's name: the engine makes a character on it to see what a build comes to. */
function scratch(name: string): SessionState {
  return {
    id: "creation", sceneId: "", approach: "v2", seed: 1, rollCount: 0, player: { name, concept: "", modifiers: {} },
    turn: 0, beat: "", turnsInBeat: 0, path: [], established: [], canon: [], notes: null, notesTurn: null, patches: [], repairs: [], transcript: [], metrics: [], history: [],
  };
}

/** The features a card names, in this order of interest, when the character has them. */
const SIGNATURE = /^(Sneak Attack|Rage|Reckless Attack|Second Wind|Action Surge|Bardic Inspiration|Channel Divinity|Wild Shape|Martial Arts|Flurry of Blows|Lay on Hands|Divine Smite|Favored Enemy|Metamagic|Font of Magic|Eldritch Invocations|Pact Magic|Arcane Recovery|Cunning Action|Expertise|Unarmored Defense|Fighting Style|Divine Sense|Innate Sorcery)\b/;

/**
 * The features a card names: the ones with uses first ("Rage ×3"), then the rest, a feature's parts
 * once ("Channel Divinity", not each of its options), what was chosen for it in brackets.
 */
function signature(sheet: SheetData): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const base = (name: string) => name.replace(/\s*\(.*\)$/, "").replace(/:.*$/, "");
  for (const f of sheet.features.filter(f => SIGNATURE.test(f.name)).sort((a, b) => Number(!!b.uses) - Number(!!a.uses))) {
    if (seen.has(base(f.name))) continue;
    seen.add(base(f.name));
    out.push(`${f.name}${f.uses ? ` ×${f.uses.max}` : f.choice ? ` (${f.choice})` : ""}`);
  }
  return out;
}

/** What a sheet says of a build, for its card. */
export function cardOf(sheet: SheetData, build: Build): BuildCard {
  const cls = sheet.classes[0];
  const attack = sheet.attacks.find(a => a.held) ?? sheet.attacks.find(a => !/^Unarmed/.test(a.name));
  const sc = sheet.spellcasting;
  const rank = (name: string) => { const i = build.skills.findIndex(s => s === name.toLowerCase().replace(/ /g, "-")); return i < 0 ? 99 : i; };
  return {
    species: sheet.species, className: cls?.name ?? build.classId, ...(cls?.subclass ? { subclass: cls.subclass } : {}), background: sheet.background, level: sheet.level,
    hp: sheet.hp.max, ac: sheet.ac, speed: sheet.speeds["walk"] ?? 30,
    ...(attack ? { attack: { name: attack.name, bonus: attack.bonus, damage: attack.damage, type: attack.type } } : {}),
    ...(sc ? { casting: {
      ability: sc.ability, saveDC: sc.saveDC, attackBonus: sc.attackBonus,
      cantrips: sc.spells.filter(g => g.level === 0).flatMap(g => g.spells.map(s => s.name)),
      spells: sc.spells.filter(g => g.level > 0).flatMap(g => g.spells.filter(s => s.ready).map(s => s.name)),
    } } : {}),
    features: signature(sheet),
    skills: sheet.skills.filter(s => s.proficiency !== "none").sort((a, b) => rank(a.name) - rank(b.name)).map(s => s.name),
  };
}

/** A build made legal and made by the engine as character creation would make it: the build, its line and its card. */
export async function throughEngine(raw: Partial<Build>, level: number, name = "You"): Promise<{ build: Build; line: string; card: BuildCard }> {
  const build = settleBuild(raw, level, await srdContent());
  const state = scratch(name);
  await createCharacter(state, level, build);
  const sheet = await sheetData(state);
  if (!sheet) throw new Error("The rules engine couldn't make that build.");
  return { build, line: state.player.build ?? "", card: cardOf(sheet, build) };
}

// ---------------------------------------------------------------------------------------------
// Three builds for a concept.

interface Suggested extends Partial<Build> { plays?: string }

const THREE = ["first", "second", "third"] as const;

/** The model's three builds for a concept (one call): three classes, each a way to play who they are. */
async function askThree(name: string, concept: string, level: number, ask: Ask): Promise<Suggested[]> {
  const content = await srdContent();
  const one = { type: "object", additionalProperties: false, required: [...BUILD_FIELDS, "plays"], properties: { ...BUILD_SCHEMA,
    plays: { type: "string", description: "How they'd play, in one sentence for the player choosing: what they'd do first and what they're good at, in plain words (a feature's name is fine, no numbers)" } } };
  const answer = await ask<Record<(typeof THREE)[number], Suggested>>({
    operation: "rules.builds", effort: "low",
    instructions: `You turn a tabletop character concept into three D&D (2024 rules, SRD 5.2.1) builds for a level ${level} character, for the player to choose one from. Each fits who they are, and the three are different ways to play them: three different classes. If the concept names a class, the first is that class, done as the concept says. ${BUILD_GUIDE}`,
    input: [{ role: "user", content: [`Character concept: ${name}: ${concept}`, buildMenu(level, content)].join("\n\n") }],
    json: { name: "builds", schema: { type: "object", additionalProperties: false, required: [...THREE], properties: Object.fromEntries(THREE.map(k => [k, one])) } },
  });
  return THREE.map(k => answer[k]).filter((b): b is Suggested => !!b && typeof b === "object");
}

/**
 * Three distinct builds that fit a concept, each made legal and made by the engine (its card): the
 * model's, in one call; offline (or if the call fails), the class defaults that best match the
 * concept's words. Three different classes either way: one the model doubled is made up from the
 * defaults. `ask`: the model, or a stand-in for it.
 */
export async function threeBuilds(name: string, concept: string, level: number, options: { ask?: Ask } = {}): Promise<Offer> {
  const ask = options.ask ?? (gmOffline() ? undefined : respondJson);
  let suggested: Suggested[] = [];
  let note: string | undefined;
  if (!ask) note = "The GM is offline: three from the class defaults that best match your words.";
  else {
    try { suggested = await askThree(name, concept, level, ask); }
    catch (error) { note = `The GM couldn't be reached (${error instanceof Error ? error.message.slice(0, 80) : String(error)}): three from the class defaults that best match your words.`; }
  }
  const content = await srdContent();
  const picked: Array<{ raw: Partial<Build>; plays: string; from: BuildOption["from"] }> = [];
  for (const s of suggested) {
    const classId = s.classId && content.classes.has(s.classId) ? s.classId : undefined;
    if (!classId || picked.some(p => p.raw.classId === classId) || picked.length >= 3) continue;
    const { plays, ...raw } = s;
    picked.push({ raw: { ...raw, classId }, plays: plays?.trim() || DEFAULTS[classId]!.plays, from: "model" });
  }
  for (const d of classesFor(concept)) {
    if (picked.length >= 3) break;
    if (!picked.some(p => p.raw.classId === d)) { const made = classDefault(d, concept); picked.push({ raw: made.build, plays: made.plays, from: "defaults" }); }
  }
  const options3 = await Promise.all(picked.map(async p => ({ ...(await throughEngine(p.raw, level, name)), plays: p.plays, from: p.from })));
  return { options: options3, ...(note ? { note } : {}) };
}

// ---------------------------------------------------------------------------------------------
// A build of the player's own making.

export interface Choice { id: string; name: string; about: string }
export interface SrdLists {
  species: Choice[];
  classes: Choice[];
  /** Each class's subclasses (the SRD has one each), for a level that has one. */
  subclasses: Record<string, Choice[]>;
  backgrounds: Choice[];
  /** The level they're made at: below a class's subclass level there's none to choose. */
  level: number;
  subclassLevel: Record<string, number>;
}

/** What the player picks from to make their own: the SRD's species, classes, subclasses and backgrounds, each with a line about it. */
export async function srdLists(level: number): Promise<SrdLists> {
  const content = await srdContent();
  const words = (t: string) => t.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const species = [...content.species.values()].map(s => {
    const traits = ((s["traits"] as Array<Record<string, unknown>> | undefined) ?? []);
    const sense = traits.find(t => t["kind"] === "GrantSense");
    const resist = traits.filter(t => t["kind"] === "GrantResistance").map(t => `${t["damageType"]} resistance`);
    const speed = (s["speed"] as { walk?: number } | number | undefined);
    const walk = typeof speed === "number" ? speed : speed?.walk ?? 30;
    return { id: s.id, name: s.name, about: [`${String(s["size"] ?? "medium").toLowerCase()}`, `${walk} ft`, ...(sense ? [`${sense["sense"]} ${sense["range"]} ft`] : []), ...resist].join(", ") };
  });
  const classes = [...content.classes.values()].map(c => ({ id: c.id, name: c.name, about: [`d${c["hitDie"]} hit die`, ...(((c["primaryAbility"] as string[] | string | undefined) ? [`${[c["primaryAbility"]].flat().join("/")}`] : [])), ...(((c["armorProficiencies"] as string[] | undefined) ?? []).length ? [`${(c["armorProficiencies"] as string[]).join(", ")} armour`] : ["no armour"])].join(", ") }));
  const subclasses: Record<string, Choice[]> = {};
  for (const s of content.subclasses.values()) {
    const parent = String(s["parentClassId"] ?? "");
    (subclasses[parent] ??= []).push({ id: s.id, name: s.name, about: `a ${content.classes.get(parent)?.name.toLowerCase() ?? parent}'s path` });
  }
  const backgrounds = [...content.backgrounds.values()].map(b => ({ id: b.id, name: b.name,
    about: [((b["skillProficiencies"] as string[] | undefined) ?? []).map(words).join(", "), content.feats.get(String(b["originFeatId"] ?? ""))?.name ?? ""].filter(Boolean).join(" · ") }));
  const subclassLevel = Object.fromEntries([...content.classes.values()].map(c => [c.id, Number(c["subclassLevel"] ?? 3)]));
  return { species, classes, subclasses, backgrounds, level, subclassLevel };
}

export interface OwnPicks { speciesId: string; classId: string; subclassId?: string; backgroundId: string }

/** The player's own build: their species, class, subclass and background, the rest the class's defaults, made legal by the engine. */
export async function ownBuild(picks: OwnPicks, level: number, name = "You"): Promise<BuildOption> {
  const d = classDefault(picks.classId);
  const raw: Build = { ...d.build, speciesId: picks.speciesId, backgroundId: picks.backgroundId, ...(picks.subclassId ? { subclassId: picks.subclassId } : {}) };
  return { ...(await throughEngine(raw, level, name)), plays: d.plays, from: "own" };
}

/** A build's card as plain text (the QA console's, the zoo's tailor's): who, how they'd play, the numbers. */
export function cardText(o: BuildOption): string {
  const c = o.card;
  const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  return [
    `${c.species} ${c.className} ${c.level}${c.subclass ? ` · ${c.subclass}` : ""} · ${c.background}`,
    o.plays,
    [`HP ${c.hp}`, `AC ${c.ac}`, `${c.speed} ft`, ...(c.attack ? [`${c.attack.name} ${signed(c.attack.bonus)} ${c.attack.damage} ${c.attack.type}`] : []),
      ...(c.casting ? [`spells DC ${c.casting.saveDC}, ${signed(c.casting.attackBonus)} (${[...c.casting.cantrips, ...c.casting.spells].join(", ")})`] : []), ...c.features].join(" · "),
    `Skills: ${c.skills.join(", ") || "none"}`,
  ].join("\n");
}

/** The picks a build was made from (to start the player's own from the one they were looking at). */
export const picksOf = (b: Build): OwnPicks => ({ speciesId: b.speciesId, classId: b.classId, subclassId: b.subclassId, backgroundId: b.backgroundId });
