import type * as Dnd from "../../vendor/dnd-srd-engine/dnd-srd-engine.js";
import type { SessionState } from "../runtime/session.ts";
import { ABILITY_NAME, casterChoice, dnd, FEATURE_IDS, featureRule, jumpReachFor, pactOf, rulesNow, slotFor, spellVariants, type JumpReach, type RulesNow } from "./dnd.ts";

/**
 * What the player's character can do outside a fight, by kind: the action menu's catalogue. The app
 * draws it (src/app/ui/actions.tsx), and the map aims and resolves it (src/game/town.ts). It all
 * comes from the character's rules state:
 *   - cantrips, and prepared spells by level with the slots left (a ritual is cast as one: no slot);
 *   - class features with their uses left (Second Wind, Lay on Hands, Channel Divinity...);
 *   - what anyone can do (attack, leap, hide, throw, shove, grab, rest), and the fight's own
 *     actions, which only a fight has (dash, dodge, help);
 *   - what they carry that can be used up (a potion).
 * What can't be done now says why, in a few words: no slots left, only in a fight, nothing to rest
 * off. Where, and at whom, is the map's to say: each entry's aim says what it needs (someone,
 * someone or something, a spot for an area, a direction from you, a place to land, or nothing),
 * and how far it reaches.
 */

// The engine reads synchronously from here on (a menu asks between keystrokes).
await dnd();

export type Group = "cantrips" | "spells" | "features" | "actions" | "items";

export type Aim =
  /** Just do it (hide, a rest). */
  | { kind: "none" }
  /** On yourself (Second Wind, Shield of Faith on you). */
  | { kind: "self" }
  /** Someone (people and creatures), within range in feet; yourself too when `self`. */
  | { kind: "creature"; range: number; self: boolean }
  /** Someone or something (a door, a cart): within range; yourself too when `self`. */
  | { kind: "target"; range: number; self: boolean }
  /** A spot for an area (a 20-ft sphere 150 ft off), or, from yourself, a direction (a cone, a line). */
  | { kind: "area"; range: number; shape: string; size: number; fromSelf: boolean }
  /**
   * Somewhere to land or to step to (a leap, Misty Step), within range. A leap's `jump`: how far it
   * goes easily with a run-up and standing (half as far again takes Athletics; `range` is the most).
   */
  | { kind: "tile"; range: number; jump?: { long: number; standing: number } };

/** What it does to whoever it's aimed at: who reacts to it, and what's a scene's to play (charming someone). */
export type Effect = "harm" | "social" | "help" | "none";

export interface Entry {
  /** Stable in a menu: "spell:fire-bolt", "feature:second-wind", "jump", "rest:short". */
  key: string;
  group: Group;
  name: string;
  /** One line: what it does, how far. */
  summary: string;
  aim: Aim;
  effect: Effect;
  /** Why it can't be done now; undefined when it can. */
  why?: string;
  /** It heals: no use on someone who isn't hurt. */
  heals?: boolean;
  /** The conditions it ends (Lesser Restoration: blinded, deafened, paralysed, poisoned): no use on someone who has none of them. */
  cures?: string[];
  /** The game core's action id, or its stem for an aimed one: "cast_fire-bolt" (+ "@x,y" or "_self"), "rest_short". */
  act: string;
  spell?: { id: string; level: number; slot: number; pact?: boolean; ritual?: boolean; concentration: boolean; bonus?: boolean; element?: string };
  uses?: { current: number; max: number; recharge?: string };
}

export interface Section {
  key: string;
  group: Group;
  /** "Cantrips", "1st level", "Class features", "Actions", "To hand". */
  title: string;
  /** What's left: "3/4 slots", "pact slots 2/2". */
  note?: string;
  entries: Entry[];
}

export interface Catalogue {
  sections: Section[];
  /** Every entry, in the order the sections list them. */
  entries: Entry[];
  /** How far they jump (feet), for aiming a leap. */
  reach: JumpReach;
  /** Their main weapon, for attacks. */
  weapon?: { name: string; range: number; long?: number; dice: string; type: string };
}

export interface Context {
  /** Rested already since the story's clock last moved: once each a time of day. */
  rested?: { short?: boolean; long?: boolean };
}

const ORDINAL = ["cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
const RECHARGE: Record<string, string> = { shortRest: "short rest", longRest: "long rest", partialShortFullLong: "one back each short rest" };
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const words = (id: string) => id.replace(/-/g, " ");

/** "120 feet" → 120, "Touch" → 5, "Self" or "Self (15-foot cone)" → 0, a mile in feet. */
export function rangeFeet(range: string): number {
  if (/^touch/i.test(range)) return 5;
  if (/^self/i.test(range)) return 0;
  const m = /(\d+)\s*(feet|foot|ft)/i.exec(range);
  if (m) return Number(m[1]);
  const miles = /(\d+)\s*mile/i.exec(range);
  return miles ? Number(miles[1]) * 5280 : /unlimited/i.test(range) ? 5280 : 0;
}

// ---------------------------------------------------------------------------------------------
// Spells: one line each, in the house's few words. {dice} is a cantrip's damage at their level,
// {mod} their spellcasting modifier.

const SPELLS: Record<string, string> = {
  // Cantrips.
  "acid-splash": "a splash of acid, {dice} (Dex save), 60 ft",
  "chill-touch": "{dice} necrotic by touch; no healing for them",
  "dancing-lights": "up to four floating lights, 120 ft",
  druidcraft: "a bloom, a breeze, tomorrow's weather",
  "eldritch-blast": "{dice} force, 120 ft",
  elementalism: "a gust, a spark, a drizzle, a puff of dust",
  "fire-bolt": "{dice} fire, 120 ft: sets things alight",
  guidance: "a d4 on someone's next check, by touch",
  light: "a thing shines like a torch for an hour",
  "mage-hand": "a spectral hand to fetch and carry, 30 ft",
  mending: "mends a tear or a break (a minute's work)",
  message: "a whisper to someone 120 ft away",
  "minor-illusion": "a sound or an image, 30 ft",
  "poison-spray": "{dice} poison, 30 ft",
  prestidigitation: "small tricks: a spark, a smell, a clean collar",
  "produce-flame": "a flame in your hand: a light, or {dice} thrown",
  "ray-of-frost": "{dice} cold, 60 ft, and it slows them",
  resistance: "a d4 off someone's next save, by touch",
  "sacred-flame": "{dice} radiant, 60 ft (Dex save; cover won't help)",
  shillelagh: "your staff or club hits like a mallet",
  "shocking-grasp": "{dice} lightning by touch",
  "sorcerous-burst": "{dice} of an element (fire), 120 ft",
  "spare-the-dying": "steadies someone who's dying, 15 ft",
  "starry-wisp": "{dice} radiant, 60 ft; they glow",
  thaumaturgy: "a booming voice, guttering flames, a tremor",
  "true-strike": "a blow guided by insight",
  "vicious-mockery": "{dice} psychic and a cutting remark, 60 ft",
  // 1st level.
  alarm: "a ward that rings if anyone comes, 8 hours",
  "animal-friendship": "a beast decides you're a friend (Wis save)",
  bane: "up to three take a d4 off attacks and saves",
  bless: "up to three add a d4 to attacks and saves",
  "burning-hands": "a 15-ft cone of fire, 3d6 (Dex save for half)",
  "charm-person": "someone takes you for a friend, an hour (Wis)",
  "chromatic-orb": "3d8 of an element (fire), 90 ft",
  "color-spray": "a cone of colours blinds 6d10 hit points of people",
  command: "a one-word order they obey (Wis save)",
  "comprehend-languages": "understand any language, an hour",
  "create-or-destroy-water": "water out of the air, 30 ft",
  "cure-wounds": "heals 2d8 {mod}, by touch",
  "detect-evil-and-good": "sense fiends, fey and the undead about",
  "detect-magic": "sense magic within 30 ft",
  "detect-poison-and-disease": "sense poison and disease within 30 ft",
  "disguise-self": "look like someone else, an hour",
  "dissonant-whispers": "3d6 psychic, and they run (Wis save), 60 ft",
  "divine-favor": "your blows burn with radiance, a minute",
  "divine-smite": "your next hit lands 2d8 radiant harder",
  "ensnaring-strike": "your next hit binds them in thorns",
  entangle: "grasping weeds over a 20-ft square, 90 ft",
  "expeditious-retreat": "dash as a bonus action, ten minutes",
  "faerie-fire": "outlines a 20-ft square in light (Dex save)",
  "false-life": "2d4 + 4 temporary hit points",
  "floating-disk": "a floating disk that carries 500 lb",
  "fog-cloud": "a 20-ft sphere of thick fog, 120 ft",
  goodberry: "ten berries, each a meal and a hit point",
  grease: "a 10-ft slick of grease, 60 ft",
  "guiding-bolt": "4d6 radiant, 120 ft; the next blow has advantage",
  "healing-word": "heals 2d4 {mod}, 60 ft",
  heroism: "someone is fearless, and heartier each turn",
  hex: "curses someone: your hits do 1d6 necrotic more",
  "hideous-laughter": "someone falls about laughing (Wis save)",
  "hunters-mark": "marks a quarry: your hits do 1d6 more",
  "ice-knife": "1d10 piercing, then a 2d6 burst of cold, 60 ft",
  identify: "learn what a magic thing does (a minute)",
  "illusory-script": "writing only the right eyes can read",
  "inflict-wounds": "2d10 necrotic by touch (Con save for half)",
  jump: "someone jumps three times as far, a minute",
  longstrider: "someone's speed is 10 ft faster, an hour",
  "mage-armor": "AC 13 + Dex for someone unarmoured, 8 hours",
  "magic-missile": "three darts, 1d4+1 force each, never miss",
  "protection-from-evil-and-good": "wards someone against fiends and the dead",
  "purify-food-and-drink": "food and drink made safe, 10 ft",
  "ray-of-sickness": "2d8 poison, 60 ft, and maybe they're sick",
  sanctuary: "anyone who'd strike someone must save first",
  "searing-smite": "your next hit sets them alight",
  "shield-of-faith": "+2 AC for someone, ten minutes",
  "silent-image": "an illusion of a thing, up to 15 ft across",
  sleep: "puts 5d8 hit points of people to sleep, 60 ft",
  shield: "+5 AC against a blow that would land",
  "feather-fall": "up to five fall as slowly as feathers",
  "hellish-rebuke": "2d10 fire back at whoever hurt you",
  counterspell: "stops someone's spell as it's cast",
  "speak-with-animals": "talk with beasts for ten minutes",
  thunderwave: "a 15-ft cube of thunder, 2d8; it shoves",
  // 2nd level.
  "acid-arrow": "4d4 acid, 90 ft, and it goes on burning",
  aid: "up to three gain 5 hit points, 8 hours",
  "alter-self": "change your shape a little, an hour",
  "animal-messenger": "a small beast carries your message",
  "arcane-lock": "locks a door or a chest by magic",
  "arcanists-magic-aura": "makes a thing seem magic, or not",
  augury: "an omen: weal or woe for what you plan",
  barkskin: "someone's AC won't drop below 17, an hour",
  "blindness-deafness": "blinds someone (Con save), 120 ft",
  blur: "your outline blurs: blows miss more",
  "calm-emotions": "settles tempers in a 20-ft sphere (Cha save)",
  "continual-flame": "a flame that never goes out",
  darkness: "a 15-ft sphere of magical darkness, 60 ft",
  darkvision: "someone sees in the dark, 8 hours",
  "detect-thoughts": "read surface thoughts, a minute",
  "dragons-breath": "someone breathes a 15-ft cone of fire",
  "enhance-ability": "someone does one kind of thing better",
  "enlarge-reduce": "someone grows to twice their size",
  enthrall: "people about can't look away (Wis save)",
  "find-traps": "sense traps within 120 ft",
  "flame-blade": "a blade of fire in your hand: 3d6 fire",
  "flaming-sphere": "a ball of fire you roll about: 2d6, 60 ft",
  "gentle-repose": "keeps a body from rotting, ten days",
  "gust-of-wind": "a 60-ft line of wind that shoves",
  "heat-metal": "metal glows red hot: 2d8 fire, 60 ft",
  "hold-person": "someone is paralysed (Wis save), 60 ft",
  invisibility: "someone goes unseen until they act, an hour",
  knock: "opens a lock, 60 ft (and the knock is heard a street off)",
  "lesser-restoration": "ends a disease, blindness or poisoning",
  levitate: "someone rises off the ground, ten minutes",
  "locate-animals-or-plants": "the nearest of a kind of beast or plant",
  "locate-object": "the way to something you know",
  "magic-mouth": "a thing speaks a message when triggered",
  "magic-weapon": "a weapon becomes +1, an hour",
  "mind-spike": "3d8 psychic, 120 ft; you know where they are",
  "mirror-image": "three doubles take blows for you",
  "misty-step": "step through mist to a spot 30 ft away",
  moonbeam: "a beam of moonlight: 2d10 radiant, 120 ft",
  "pass-without-trace": "you and yours sneak better (+10 Stealth)",
  "phantasmal-force": "an illusion only one mind sees (Int save)",
  "prayer-of-healing": "up to five heal 2d8 {mod} (ten minutes)",
  "protection-from-poison": "ends a poisoning, and wards off more",
  "ray-of-enfeeblement": "someone's blows go feeble, 60 ft",
  "rope-trick": "a rope up to a hidey-hole out of the world",
  "scorching-ray": "three rays, 2d6 fire each, 120 ft",
  "see-invisibility": "see the invisible, an hour",
  shatter: "a 10-ft burst of thunder, 3d8; breaks things",
  "shining-smite": "your next hit makes them glow",
  silence: "a 20-ft sphere of silence, 120 ft",
  "spider-climb": "someone walks up walls, an hour",
  "spike-growth": "a 20-ft patch of hidden thorns, 150 ft",
  "spiritual-weapon": "a floating weapon of force: 1d8 {mod}, 60 ft",
  suggestion: "someone follows a sensible suggestion (Wis)",
  "warding-bond": "you share someone's hurt, an hour",
  web: "a 20-ft cube of sticky web (Dex save), 60 ft",
  "zone-of-truth": "nobody can lie in a 15-ft sphere (Cha save)",
  // 3rd level.
  "beacon-of-hope": "allies heal fully and fear nothing, a minute",
  "bestow-curse": "a curse, by touch (Wis save)",
  blink: "you flicker in and out of the world, a minute",
  "call-lightning": "a storm cloud: 3d10 lightning, 120 ft",
  clairvoyance: "see or hear somewhere up to a mile off",
  "create-food-and-water": "food and water for fifteen, 30 ft",
  daylight: "a 60-ft sphere of daylight, 60 ft",
  "dispel-magic": "ends a spell on someone or something, 120 ft",
  fear: "a 30-ft cone of terror (Wis save)",
  fireball: "a 20-ft burst of fire, 8d6 (Dex save for half), 150 ft",
  fly: "someone flies at 60 ft, ten minutes",
  "gaseous-form": "someone turns to mist, an hour",
  "glyph-of-warding": "a glyph that goes off when touched",
  haste: "someone moves and acts faster, a minute",
  "hypnotic-pattern": "a 30-ft cube of colours that entrances (Wis)",
  "lightning-bolt": "a 100-ft line of lightning, 8d6 (Dex half)",
  "magic-circle": "a 10-ft circle that keeps things out",
  "major-image": "an illusion with sound, smell and heat",
  "mass-healing-word": "up to six heal 2d4 {mod}, 60 ft",
  "meld-into-stone": "step into stone and wait there",
  nondetection: "hides someone from divination, 8 hours",
  "plant-growth": "thick growth over 100 ft, or a richer crop",
  "protection-from-energy": "someone shrugs off fire, an hour",
  "remove-curse": "ends curses, by touch",
  revivify: "brings back someone dead less than a minute",
  sending: "25 words to someone, anywhere",
  "sleet-storm": "a 40-ft storm of sleet (Dex save or fall)",
  slow: "up to six slow down (Wis save), 120 ft",
  "speak-with-dead": "a corpse answers five questions",
  "speak-with-plants": "plants talk, and part for you",
  "spirit-guardians": "spirits about you: 3d8 radiant to foes near",
  "stinking-cloud": "a 20-ft sphere of choking gas, 90 ft",
  "tiny-hut": "a dome of force to sleep in, 8 hours",
  tongues: "someone speaks and understands any language",
  "vampiric-touch": "3d6 necrotic by touch; you heal half",
  "water-breathing": "up to ten breathe water, a day",
  "water-walk": "up to ten walk on water, an hour",
  "wind-wall": "a wall of wind that turns arrows aside",
};

/** What working on someone's mind is for: a scene's to play, with them, never settled in passing. */
export const SOCIAL_SPELLS = new Set(["charm-person", "charm-monster", "suggestion", "mass-suggestion", "command", "friends", "calm-emotions", "enthrall",
  "zone-of-truth", "detect-thoughts", "animal-friendship", "hypnotic-pattern", "geas", "modify-memory", "dominate-person", "dominate-beast", "dominate-monster", "sending", "message"]);
/** Buffs the engine puts on a foe (marks), and other spells that help nobody but you. */
const FOE_MARKS = new Set(["hunters-mark", "hex", "bane", "faerie-fire"]);
/** Spells aimed at a thing rather than a person: a lock, a weapon, a tear. */
const AT_THINGS = new Set(["knock", "arcane-lock", "mending", "light", "continual-flame", "magic-weapon", "arcanists-magic-aura", "magic-mouth", "glyph-of-warding", "mage-hand", "identify"]);
/**
 * Harmful spells the SRD aims at a creature only ("each dart strikes a creature of your choice"):
 * not at a door or a lamp post. (Fire Bolt, Eldritch Blast, Starry Wisp, Poison Spray and the like
 * say "a creature or an object".)
 */
const AT_CREATURES = new Set(["magic-missile", "sacred-flame", "ray-of-frost", "chill-touch", "guiding-bolt", "shocking-grasp", "acid-splash", "inflict-wounds", "vicious-mockery",
  "ice-knife", "ray-of-sickness", "mind-spike", "blindness-deafness", "hold-person", "dissonant-whispers", "spiritual-weapon", "hideous-laughter", "ray-of-enfeeblement", "vampiric-touch",
  "bestow-curse", "phantasmal-force", "witch-bolt", "toll-the-dead", "mind-sliver", "hunters-mark", "hex", "bane"]);
/** Spells that take you somewhere: a spot to step to. */
const STEPS: Record<string, number> = { "misty-step": 30 };

/** A cantrip's damage dice at a character level (more dice at 5th, 11th and 17th). */
function cantripDice(m: Record<string, unknown> | undefined, level: number): string {
  const base = String(m?.["damageDice"] ?? m?.["damageDicePerDart"] ?? "");
  const scaling = m?.["cantripScalingDice"];
  const tier = scaling ? (level >= 17 ? 3 : level >= 11 ? 2 : level >= 5 ? 1 : 0) : 0;
  const d = /^(\d+)d(\d+)(.*)$/.exec(base);
  return d ? `${Number(d[1]) + tier}d${d[2]}${d[3]}` : base;
}

/** What a spell does to whoever it's aimed at. */
export function spellEffect(spell: Dnd.SpellDef): Effect {
  if (SOCIAL_SPELLS.has(spell.id)) return "social";
  const fx = spell.mechanicalEffects ?? [];
  if (FOE_MARKS.has(spell.id)) return "harm";
  if (fx.some(m => ["attack", "auto-hit", "hp-pool-knockout", "aura-damage", "movement-damage", "trap", "weaponAttack"].includes(String(m.kind)) || m["damageDice"] || (m.kind === "save" && m["conditionOnFail"]))) return "harm";
  if (fx.some(m => m.kind === "save")) return "harm";
  if (fx.some(m => ["heal", "buff", "temp-hp", "remove-condition", "stabilize", "weapon-buff"].includes(String(m.kind)))) return "help";
  return "none";
}

/** What a spell needs aiming at, and how far it reaches. */
export function spellAim(spell: Dnd.SpellDef): Aim {
  const shape = spell["targeting"] as { shape: string; size: number } | undefined;
  const range = rangeFeet(spell.range);
  const fromSelf = /^self/i.test(spell.range);
  if (STEPS[spell.id]) return { kind: "tile", range: STEPS[spell.id]! };
  if (shape) {
    // An emanation round you (Spirit Guardians) goes where you go; a cone or a line goes out from you, towards where you point.
    if (fromSelf && (shape.shape === "sphere" || shape.shape === "emanation" || shape.shape === "cylinder")) return { kind: "self" };
    return { kind: "area", range: fromSelf ? shape.size : range, shape: shape.shape, size: shape.size, fromSelf };
  }
  if (range === 0) return { kind: "self" };
  const effect = spellEffect(spell);
  if (AT_THINGS.has(spell.id)) return { kind: "target", range, self: range <= 5 };
  if (effect === "harm") return { kind: AT_CREATURES.has(spell.id) ? "creature" : "target", range, self: false };
  if (effect === "social") return { kind: "creature", range, self: false };
  if (effect === "help") return { kind: "creature", range, self: true };
  return { kind: "target", range, self: range <= 5 };
}

/** A spell's line: the table's, else made from what it does. */
function spellSummary(spell: Dnd.SpellDef, level: number, mod: number): string {
  const fx = spell.mechanicalEffects ?? [];
  const damage = fx.find(m => m["damageDice"] || m["damageDicePerDart"]);
  const dice = cantripDice(damage, level);
  const said = SPELLS[spell.id];
  const fill = (t: string) => t.replace("{dice}", dice).replace("{mod}", signed(mod).replace(/^\+/, "+ ").replace(/^-/, "- "));
  if (said) return fill(said);
  const range = rangeFeet(spell.range);
  const reach = /^touch/i.test(spell.range) ? "by touch" : range ? `${range} ft` : "on you";
  const shape = spell["targeting"] as { shape: string; size: number } | undefined;
  const type = String(damage?.["damageType"] ?? "");
  if (shape && damage) return `a ${shape.size}-ft ${shape.shape} of ${type || "harm"}, ${dice}, ${reach}`;
  if (damage) return `${dice} ${type}, ${reach}`.trim();
  const heal = fx.find(m => m.kind === "heal");
  if (heal) return `heals ${heal["amountDice"] ?? heal["flatAmount"] ?? ""}, ${reach}`;
  return `${capital(spell.school)}, ${reach}${spell.concentration ? " (concentration)" : ""}`;
}

/**
 * Why the map can't play a spell yet, when it can't: a reaction's moment is a fight's; summoning
 * isn't drawn yet; and a spell cast one of several ways (Command's word, Hex's ability) needs the
 * player to say which, which a scene can hear and a menu can't ask yet.
 */
function spellWhy(spell: Dnd.SpellDef): string | undefined {
  if (/reaction/i.test(spell.castingTime)) return "a reaction: only in a fight";
  if ((spell.mechanicalEffects ?? []).some(m => m.kind === "summon")) return "nothing comes when called on the map yet: in a scene, say you cast it";
  const ways = spellVariants(spell);
  if (ways) return `it's cast one of ${ways.length} ways, and the menu can't ask which yet: in a scene, say how`;
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Class features: those with uses (the engine's resources), and the fight's own.

interface FeatureLine {
  name: string;
  summary: (r: RulesNow) => string;
  aim: Aim;
  effect: Effect;
  /** Why not now, whatever the uses say. */
  why?: (r: RulesNow, uses: { current: number; max: number }) => string | undefined;
  /** It heals whoever it's aimed at. */
  heals?: boolean;
}

const level = (r: RulesNow, classId: string) => r.character.classes.find(k => k.classId === classId)?.level ?? 0;
/**
 * Hurt as the rules heal: below the engine's own maximum, which is as far as healing goes. (The
 * sheet's maximum adds bonuses like a dwarf's toughness, which healing never reaches: by it a fresh
 * dwarf would always be hurt, and a rest or Second Wind always worth it.)
 */
const hurt = (r: RulesNow) => Math.max(0, r.character.hp.current) < r.character.hp.max;
const notHurt = (r: RulesNow) => (hurt(r) ? undefined : "you're not hurt");

/** The features the rules resolve (src/rules/dnd.ts FEATURES), as a menu says them. */
const FEATURE_LINES: Record<string, FeatureLine> = {
  "second-wind": { name: "Second Wind", summary: r => `catch your breath: heal 1d10 + ${level(r, "fighter")}`, aim: { kind: "self" }, effect: "help", why: notHurt },
  rage: { name: "Rage", summary: () => "ten minutes of hitting harder and shrugging blows off", aim: { kind: "self" }, effect: "none" },
  "bardic-inspiration": { name: "Bardic Inspiration", summary: r => `a d${bardDie(level(r, "bard"))} for someone to add to a roll, 60 ft`, aim: { kind: "creature", range: 60, self: false }, effect: "help" },
  "innate-sorcery": { name: "Innate Sorcery", summary: () => "a minute of fiercer spells (+1 to their DC)", aim: { kind: "self" }, effect: "none" },
  "lay-on-hands": { name: "Lay on Hands", summary: () => "heal from your pool, by touch", aim: { kind: "creature", range: 5, self: true }, effect: "help", heals: true },
  "divine-spark": { name: "Divine Spark", summary: r => `Channel Divinity: heal 1d8 ${signed(r.sheet.abilityModifiers.WIS)}, 30 ft`, aim: { kind: "creature", range: 30, self: true }, effect: "help", heals: true },
  "preserve-life": { name: "Preserve Life", summary: r => `Channel Divinity: heal up to ${5 * level(r, "cleric")} of your own hurt`, aim: { kind: "none" }, effect: "help", why: notHurt },
  "sacred-weapon": { name: "Sacred Weapon", summary: r => `Channel Divinity: your weapon shines, ${signed(Math.max(1, r.sheet.abilityModifiers.CHA))} to hit, a minute`, aim: { kind: "self" }, effect: "none" },
  "magical-cunning": { name: "Magical Cunning", summary: () => "a minute's rite: half your pact slots back", aim: { kind: "none" }, effect: "none", why: r => (Number(r.character["pactSlotsUsed"] ?? 0) > 0 ? undefined : "no pact slots spent") },
};

const bardDie = (l: number) => (l >= 15 ? 12 : l >= 10 ? 10 : l >= 5 ? 8 : 6);

/** Resources the menu knows but the map can't spend (yet), and what they're for. */
const RESOURCE_LINES: Record<string, { name: string; summary: string; why: string }> = {
  "action-surge": { name: "Action Surge", summary: "an extra action on your turn", why: "only in a fight" },
  "arcane-recovery-points": { name: "Arcane Recovery", summary: "with a short rest: spent slots back", why: "" },
  "magical-cunning": { name: "Magical Cunning", summary: "a minute's rite: half your pact slots back", why: "" },
  "channel-divinity": { name: "Channel Divinity", summary: "a god's power, a use at a time", why: "" },
  "wild-shape": { name: "Wild Shape", summary: "take a beast's shape for a while", why: "not on the map yet: in a scene, say what you become" },
  ki: { name: "Focus", summary: "Flurry of Blows, Patient Defense, Step of the Wind", why: "only in a fight" },
  "uncanny-metabolism": { name: "Uncanny Metabolism", summary: "focus and health back as a fight begins", why: "only as a fight begins" },
  "sorcery-points": { name: "Font of Magic", summary: "sorcery points into spell slots, and back", why: "not on the map yet" },
  "sorcerous-restoration": { name: "Sorcerous Restoration", summary: "sorcery points back on a short rest", why: "comes with a short rest" },
  "hunters-mark": { name: "Hunter's Mark (free casts)", summary: "cast Hunter's Mark without a slot", why: "cast it from your spells: the free casts go first" },
  "wild-resurgence": { name: "Wild Resurgence", summary: "a spell slot for a Wild Shape, or back", why: "not on the map yet" },
  "bardic-inspiration": { name: "Bardic Inspiration", summary: "", why: "" },
};

/** Fight-only features without uses, by class and the level they come at. */
const FIGHT_FEATURES: Array<{ classId: string; level: number; name: string; summary: string }> = [
  { classId: "rogue", level: 2, name: "Cunning Action", summary: "dash, disengage or hide as a bonus action" },
  { classId: "rogue", level: 3, name: "Steady Aim", summary: "stand still and take aim: advantage" },
  { classId: "barbarian", level: 2, name: "Reckless Attack", summary: "swing wild: advantage, and so do they" },
];

// ---------------------------------------------------------------------------------------------
// The catalogue.

/** What the player can do now, out of a fight, by kind; undefined for a session without a rules character. */
export function catalogue(state: SessionState, context: Context = {}): Catalogue | undefined {
  const r = rulesNow(state);
  if (!r) return undefined;
  const { character: c, sheet, content } = r;
  const total = sheet.totalLevel;
  const sections: Section[] = [];
  const conditions = c.appliedConditions.map(a => a.conditionId);
  const down = c.hp.current <= 0 || conditions.includes("unconscious");
  const tied = conditions.includes("grappled") || conditions.includes("restrained") || conditions.includes("paralyzed") || conditions.includes("incapacitated");
  const cantAct = down ? "you're out cold" : tied ? "you're held fast" : undefined;

  // Spells: cantrips, then each level with its slots.
  const sc = sheet.spellcasting?.classes[0];
  const mod = sc ? sheet.abilityModifiers[sc.ability] : 0;
  const pact = pactOf(sheet);
  const ready = (sheet.spellcasting?.spellsByLevel ?? []).flatMap(g => g.spells.filter(sp => g.level === 0 || sp.prepared || sp.alwaysPrepared));
  // A wizard's Arcane Recovery, unspent: a short rest brings some slots back.
  const recoverable = ((c as unknown as { resources?: Array<{ resourceId: string; current: number }> }).resources ?? []).some(x => x.resourceId === "arcane-recovery-points" && x.current > 0);
  const seen = new Set<string>();
  const spellEntries: Entry[] = [];
  for (const sp of ready) {
    if (seen.has(sp.spellId)) continue;
    seen.add(sp.spellId);
    const def = content.spells.get(sp.spellId);
    if (!def) continue;
    const slot = def.level ? slotFor(sheet, c, def.level) : 0;
    // Out of a fight there's time for a ritual: ten minutes, and no slot.
    const ritual = def.ritual && def.level > 0;
    const aim = spellAim(def);
    const element = String((def.mechanicalEffects ?? []).find(m => m["damageType"])?.["damageType"] ?? (casterChoice(def)?.kind === "damageType" ? casterChoice(def)!.value : ""));
    const why = cantAct ?? spellWhy(def) ?? (def.level && !slot && !ritual ? (pact ? "no pact slots left (a short rest)" : `no ${ORDINAL[def.level]}-level slots left (a long rest${recoverable ? ", or Arcane Recovery with a short one" : ""})`) : undefined);
    const fx = def.mechanicalEffects ?? [];
    const cures = fx.flatMap(m => (m.kind === "remove-condition" ? ((m["eligibleConditionIds"] as string[] | undefined) ?? []) : []));
    // Its own level's slots spent, it takes a higher one (and does more for it).
    const upcast = def.level && slot > def.level && !ritual && !(pact && slot === pact.level) ? ` (a ${ORDINAL[slot]}-level slot: no ${ORDINAL[def.level]}-level left)` : "";
    spellEntries.push({
      key: `spell:${def.id}`, group: def.level ? "spells" : "cantrips", name: def.name,
      summary: `${spellSummary(def, total, mod)}${ritual ? " (a ritual: no slot)" : upcast}`,
      aim, effect: spellEffect(def), act: `cast_${def.id}`,
      ...(why ? { why } : {}),
      // A heal that does more besides (Aid raises your maximum too) is worth it to someone who's whole.
      ...(fx.some(m => m.kind === "heal") && !fx.some(m => m.kind === "buff") ? { heals: true } : {}),
      ...(cures.length ? { cures } : {}),
      spell: { id: def.id, level: def.level, slot: ritual ? 0 : slot, ...(slot && pact && slot === pact.level && !(sheet.spellSlots.slotsByLevel[slot - 1]) ? { pact: true } : {}), ...(ritual ? { ritual: true } : {}), concentration: def.concentration, ...(/bonus/i.test(def.castingTime) ? { bonus: true } : {}), ...(element ? { element } : {}) },
    });
  }
  const cantrips = spellEntries.filter(e => e.group === "cantrips");
  if (cantrips.length) sections.push({ key: "cantrips", group: "cantrips", title: "Cantrips", entries: cantrips });
  const levels = [...new Set(spellEntries.filter(e => e.group === "spells").map(e => e.spell!.level))].sort((a, b) => a - b);
  for (const l of levels) {
    const max = sheet.spellSlots.slotsByLevel[l - 1] ?? 0;
    const used = c.spellSlotsUsed[String(l)] ?? 0;
    const note = max ? `${max - used}/${max} slots` : pact && pact.level >= l ? `pact slots ${pact.count - Number(c["pactSlotsUsed"] ?? 0)}/${pact.count} (${ORDINAL[pact.level]})` : "no slots of its own";
    sections.push({ key: `spells-${l}`, group: "spells", title: `${ORDINAL[l]} level`, note, entries: spellEntries.filter(e => e.group === "spells" && e.spell!.level === l) });
  }

  // Class features: the ones with uses first (the rules resolve them), then what the map can't spend, then the fight's own.
  const resources = ((c as unknown as { resources?: Array<{ resourceId: string; current: number; max: number; recharge?: string }> }).resources ?? []);
  const features: Entry[] = [];
  const usesOf = (id: string) => { const x = resources.find(q => q.resourceId === id); return x ? { current: x.current, max: x.max, ...(x.recharge ? { recharge: RECHARGE[x.recharge] ?? x.recharge } : {}) } : undefined; };
  const listed = new Set<string>();
  for (const id of FEATURE_IDS) {
    const rule = featureRule(id)!;
    const line = FEATURE_LINES[id];
    if (!line || !c.classes.some(k => k.classId === rule.classId && (!rule.subclassId || k.subclassId === rule.subclassId))) continue;
    const uses = usesOf(rule.resource);
    if (!uses) continue;
    listed.add(rule.resource);
    const why = cantAct ?? (uses.current <= 0 ? `no uses left (${uses.recharge ?? "a rest"})` : line.why?.(r, uses));
    features.push({ key: `feature:${id}`, group: "features", name: line.name, summary: id === "lay-on-hands" ? `heal from your pool (${uses.current} left), by touch` : line.summary(r), aim: line.aim, effect: line.effect, act: `feature_${id}`, ...(why ? { why } : {}), ...(line.heals ? { heals: true } : {}), uses });
  }
  // Turn Undead: a Channel Divinity with no undead to turn.
  if (c.classes.some(k => k.classId === "cleric") && usesOf("channel-divinity")) features.push({ key: "feature:turn-undead", group: "features", name: "Turn Undead", summary: "Channel Divinity: the undead flee you", aim: { kind: "none" }, effect: "none", act: "feature_turn-undead", why: "no undead about (Caerwyn buries its dead properly)", uses: usesOf("channel-divinity")! });
  const spent = Object.values(c.spellSlotsUsed).some(n => n > 0);
  const recovery = usesOf("arcane-recovery-points");
  if (recovery) {
    listed.add("arcane-recovery-points");
    const why = cantAct ?? (recovery.current <= 0 ? "used today (a long rest)" : !spent ? "no spell slots spent" : context.rested?.short ? "you've had your short rest" : undefined);
    features.push({ key: "feature:arcane-recovery", group: "features", name: "Arcane Recovery", summary: `with a short rest: spent slots back (${recovery.current} levels' worth)`, aim: { kind: "none" }, effect: "none", act: "rest_short_recover", ...(why ? { why } : {}), uses: recovery });
  }
  for (const x of resources) {
    if (listed.has(x.resourceId) || x.resourceId === "channel-divinity") continue;
    const line = RESOURCE_LINES[x.resourceId];
    if (line && !line.why) continue;
    const uses = usesOf(x.resourceId)!;
    features.push({ key: `feature:${x.resourceId}`, group: "features", name: line?.name ?? capital(words(x.resourceId.replace(/-points$/, ""))), summary: line?.summary || "the rules use it where it counts", aim: { kind: "none" }, effect: "none", act: `feature_${x.resourceId}`, why: line?.why || "not on the map yet", uses });
  }
  for (const f of FIGHT_FEATURES) if (c.classes.some(k => k.classId === f.classId && k.level >= f.level)) features.push({ key: `feature:${words(f.name).replace(/ /g, "-").toLowerCase()}`, group: "features", name: f.name, summary: f.summary, aim: { kind: "none" }, effect: "none", act: "", why: "only in a fight" });
  if (features.length) sections.push({ key: "features", group: "features", title: "Class features", entries: features });

  // What anyone can do.
  const reach = jumpReachFor(sheet.abilityScores.STR);
  const athletics = sheet.skills.find(k => k.skill === "athletics")?.modifier ?? 0;
  const stealth = sheet.skills.find(k => k.skill === "stealth")?.modifier ?? 0;
  const main = mainWeapon(r);
  const actions: Entry[] = [];
  if (main) actions.push({ key: "attack", group: "actions", name: `Attack (${main.name.toLowerCase()})`, summary: `${main.dice} ${main.type}, ${main.range > 5 ? `${main.range} ft` : "in reach"}`, aim: { kind: "target", range: main.long ?? main.range, self: false }, effect: "harm", act: "attack", ...(cantAct ? { why: cantAct } : {}) });
  actions.push({ key: "jump", group: "actions", name: "Leap", summary: `${reach.long} ft with a run-up, ${reach.standingLong} standing (more takes Athletics ${signed(athletics)})`, aim: { kind: "tile", range: Math.floor(reach.long * 1.5 / 5) * 5, jump: { long: reach.long, standing: reach.standingLong } }, effect: "none", act: "jump", ...(cantAct ? { why: cantAct } : conditions.includes("prone") ? { why: "you're on the ground: get up first" } : {}) });
  actions.push({ key: "hide", group: "actions", name: "Hide", summary: `slip out of sight: a Stealth check (${signed(stealth)})`, aim: { kind: "none" }, effect: "none", act: "hide", ...(cantAct ? { why: cantAct } : {}) });
  actions.push({ key: "throw", group: "actions", name: "Throw something", summary: "a stone, or whatever's to hand: 1d4, 20 ft", aim: { kind: "target", range: 60, self: false }, effect: "harm", act: "throw", ...(cantAct ? { why: cantAct } : {}) });
  actions.push({ key: "shove", group: "actions", name: "Shove someone over", summary: `your Strength against theirs: down they go`, aim: { kind: "creature", range: 5, self: false }, effect: "harm", act: "shove", ...(cantAct ? { why: cantAct } : {}) });
  actions.push({ key: "grapple", group: "actions", name: "Grab hold of someone", summary: "hold them fast, until they break free", aim: { kind: "creature", range: 5, self: false }, effect: "harm", act: "grapple", ...(cantAct ? { why: cantAct } : {}) });
  actions.push({ key: "help", group: "actions", name: "Help", summary: "give someone advantage on what they're trying", aim: { kind: "creature", range: 5, self: false }, effect: "help", act: "", why: "only when someone's trying something: in a fight, or a scene" });
  for (const [key, name, summary] of [["dash", "Dash", "twice as far this turn"], ["dodge", "Dodge", "blows at you have disadvantage"], ["disengage", "Disengage", "walk away without a parting blow"]] as const) {
    actions.push({ key, group: "actions", name, summary, aim: { kind: "none" }, effect: "none", act: "", why: "only in a fight" });
  }
  const fresh = !hurt(r) && !spent && c.classes.every(k => k.hitDiceRemaining >= k.level) && resources.every(x => x.current >= x.max) && !(pact && Number(c["pactSlotsUsed"] ?? 0) > 0);
  const dice = c.classes.reduce((n, k) => n + k.hitDiceRemaining, 0);
  const shortWhy = cantAct ?? (context.rested?.short ? "you've had a short rest since the clock last moved" : fresh ? "nothing to rest off: you're whole and fresh" : !hurt(r) && !resources.some(x => x.current < x.max && x.recharge !== "longRest") && !(pact && Number(c["pactSlotsUsed"] ?? 0) > 0) ? "nothing a short rest gives back" : undefined);
  actions.push({ key: "rest:short", group: "actions", name: "Short rest", summary: `an hour: Hit Dice (${dice} left) and some uses back`, aim: { kind: "none" }, effect: "none", act: "rest_short", ...(shortWhy ? { why: shortWhy } : {}) });
  const longWhy = cantAct ?? (context.rested?.long ? "you've slept once since the clock last moved" : fresh ? "nothing to rest off: you're whole and fresh" : undefined);
  actions.push({ key: "rest:long", group: "actions", name: "Long rest", summary: "a night's sleep: everything back", aim: { kind: "none" }, effect: "none", act: "rest_long", ...(longWhy ? { why: longWhy } : {}) });
  sections.push({ key: "actions", group: "actions", title: "Actions", entries: actions });

  // What they carry that can be used up.
  const gone = new Set(state.rules?.gone ?? []);
  const items: Entry[] = [];
  for (const item of sheet.inventory.items) {
    const def = content.items.get(item.definitionId);
    if (!def || def.itemKind !== "consumable" || gone.has(item.instanceId)) continue;
    const heal = ((def["onConsume"] as Array<Record<string, unknown>> | undefined) ?? []).some(m => m["kind"] === "Heal");
    const said = String(def["description"] ?? "").split(/(?<=\.)\s/)[0]!.replace(/\.$/, "");
    items.push({ key: `item:${item.instanceId}`, group: "items", name: def.name, summary: said ? said.charAt(0).toLowerCase() + said.slice(1) : "use it up", aim: { kind: "self" }, effect: heal ? "help" : "none", act: `use_${item.instanceId}`, ...(cantAct ? { why: cantAct } : heal && !hurt(r) ? { why: "you're not hurt" } : {}) });
  }
  if (items.length) sections.push({ key: "items", group: "items", title: "To hand", entries: items });

  return { sections, entries: sections.flatMap(s => s.entries), reach, ...(main ? { weapon: main } : {}) };
}

/** The weapon in hand (or the first they carry), as an attack: its dice and how far it reaches. */
function mainWeapon(r: RulesNow): Catalogue["weapon"] {
  const held = r.character.equipped.mainHand;
  const attacks = r.sheet.attacks as Array<Dnd.CharacterSheet["attacks"][number] & { weaponInstanceId?: string; range?: { normal: number; long: number }; properties?: string[] }>;
  const a = attacks.find(x => x.weaponInstanceId === held) ?? attacks.find(x => !x.unarmed) ?? attacks[0];
  if (!a) return undefined;
  const reach = a.properties?.some(p => /reach/i.test(p)) ? 10 : 5;
  const ranged = a.attackKind === "ranged" && a.range;
  return {
    name: a.name, dice: `${a.damage.dice}${a.damage.modifier ? signed(a.damage.modifier) : ""}`, type: a.damage.type,
    range: ranged ? a.range!.normal : reach, ...(ranged ? { long: a.range!.long } : {}),
  };
}

/** "Fire Bolt (cantrip)", "Fireball (3rd-level slot)", for a line that says what was chosen. */
export function entryLabel(e: Entry): string {
  if (!e.spell) return e.name;
  return `${e.name} (${e.spell.ritual ? "a ritual" : e.spell.level ? `${ORDINAL[e.spell.slot || e.spell.level]}-level${e.spell.pact ? " pact" : ""} slot` : "cantrip"})`;
}

export { ABILITY_NAME };
