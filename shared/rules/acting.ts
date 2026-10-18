/**
 * Whether a player's line in a scene might be an act the rules resolve (a spell, a blow, a shot or
 * something thrown, a class feature): a cheap read of its words, with no model, so that only those
 * lines are asked the mechanic question before the reply (the simulation's act step, the AI
 * service's POST /v1/turns/act) and an ordinary line goes straight to the GM, as fast as it did. It
 * errs towards asking: a line it lets through that isn't an act costs one small call, which answers
 * that it isn't; one it misses is the GM's to narrate, as every line was before.
 *
 * The convention the game gives players is the mechanic question's (ai/gm/director.ts READ_TURN):
 * plain words are said aloud, and what their character does is in (brackets) or *asterisks*, or
 * narrated in the first person ("I take a swing at Kell"); and they act in the present tense ("the
 * smashed lantern", "he was strangled" are what happened, not what they do). So words that are
 * nearly always an act count anywhere in the line (casting, a stab, a punch, a shot); words that are
 * as often something else (hit, strike, smash, kill), something swung or thrown at someone, and the
 * character's weapons count only in what the character does; and a spell counts by its name, as the
 * character's own or any the rules know, an everyday word among them (Light, Sleep, Shield) only
 * when it's written as a name, with a capital letter in the middle of a sentence.
 */

import type { Rules } from "./types.ts";

/** Something of the sheet's or the rules' by its id and name: a spell, a weapon, a class feature. */
export interface Named { id: string; name: string }

/** What the rules keep ready on the character's sheet (the sheet row's spells, weapons and features). */
export interface ActingSheet { spells: Named[]; weapons: Named[]; features: Named[] }

/**
 * Why the line might be an act the rules resolve ("casting: cast", "a spell: Fire Bolt", "a blow:
 * stab"), for the log; undefined for a line that's only talk, or a deed nothing in the rules
 * settles. `spells` are every spell the rules know (the SRD's): a spell the character hasn't got is
 * still an act, which the rules refuse.
 */
export function mightAct(line: string, sheet: ActingSheet, spells: readonly Named[]): string | undefined {
  const deeds = deedsIn(line);

  return casting(line)
    ?? spellIn(line, sheet, spells)
    ?? featureIn(line, sheet)
    ?? blowIn(line, deeds)
    ?? weaponIn(deeds, sheet);
}

/**
 * The spell the player's words name, by its name as they'd type it ("firebolt", "Fire-Bolt" and
 * "fire bolt" are Fire Bolt), the longest when several fit ("Mass Cure Wounds" over "Cure Wounds"),
 * an everyday word (Light, Sleep) only written as a name; undefined when it names none. The rules
 * use it to say which spell a character reached for that isn't theirs ("Fire Bolt isn't a spell
 * Wren Ashdown has ready").
 */
export function spellNamed(spells: readonly Named[], line: string): Named | undefined {
  return namedIn(spells, line, { asName: true });
}

/**
 * The spell of `spells` the character casts by its name in what they do: a casting word and the
 * spell's name in the same (bracket), *asterisk* or first-person sentence ("(I cast thunderwave at
 * the constables)", "I cast Sleep on the boy"). That's a cast without asking: the act step goes
 * straight to its details, where a model read of "is this a spell?" said cast at .58, under the bar,
 * and the Thunderwave was narrated with no rules. An everyday name (Sleep, Light) counts written as
 * a name, or straight after "cast" ("I cast sleep on the boy"). Undefined when no deed names one
 * with a casting word.
 */
export function castNamed(line: string, spells: readonly Named[]): Named | undefined {
  const longest = [...spells].sort((a, b) => b.name.length - a.name.length);
  for (const deed of deedsIn(line)) {
    if (!CASTING.test(deed)) continue;
    const after = /\bcast(?:s|ing)?\s+(?:(?:a|an|my|the)\s+)?/i.exec(deed);
    const tail = after ? deed.slice(after.index + after[0].length) : "";
    const named = spellNamed(spells, deed) ?? longest.find(s => new RegExp(`^${patternOf(s.name)}\\b`, "i").test(tail));
    if (named) return named;
  }
  return undefined;
}

/** Every spell the rules know (the engine's content: the SRD's), by id and name, made once for the isolate's engine. */
export function spellsOf(rules: Pick<Rules, "content">): readonly Named[] {
  const known = KNOWN.get(rules.content);
  if (known) return known;
  const spells = [...rules.content.spells.values()].map(s => ({ id: s.id, name: s.name }));
  KNOWN.set(rules.content, spells);
  return spells;
}

const KNOWN = new WeakMap<object, readonly Named[]>();

/** What the character does in the line: each (bracket) and *asterisk*, and each sentence narrated in the first person ("I swing at him"). */
export function deedsIn(line: string): string[] {
  const marked = [...line.matchAll(/\(([^()]*)\)|\*([^*]+)\*/g)].map(m => (m[1] ?? m[2])!);
  const unmarked = line.replace(/\([^()]*\)|\*[^*]+\*/g, " ");
  const narrated = unmarked.split(/(?<=[.!?;:])\s+|\n+/).filter(s => FIRST_PERSON.test(s));
  return [...marked, ...narrated];
}

/** A sentence narrated in the first person: "I" and a verb of doing (not of thinking or saying). */
const FIRST_PERSON = /^\s*I\s+(?!am\b|was\b|have\b|had\b|think\b|thought\b|know\b|knew\b|want\b|wanted\b|mean\b|meant\b|need\b|hope\b|wonder\b|believe\b|suppose\b|guess\b|swear\b|said\b|say\b|told\b|tell\b|asked\b|ask\b|heard\b|saw\b|see\b|can\b|could\b|would\b|will\b|shall\b|should\b|must\b|might\b|may\b|do\b|did\b|don't\b|didn't\b)/;

// ---------------------------------------------------------------------------------------------
// What counts.

/**
 * Casting, anywhere: "cast" (not cast off, out, aside or about, nor a glance, a look or an eye),
 * a spell, a cantrip, an incantation, conjuring or summoning, a hex, magic.
 */
const CASTING = /\b(?:cast(?:s|ing)?\b(?!\s+(?:off|out|aside|away|about|around|back|down|adrift|a\s+(?:glance|look|shadow|vote|line)|an?\s+eye|(?:my|his|her|their|your)\s+(?:eyes?|gaze|glance|net|line|vote|lot)|doubt|lots))|spells?\b|cantrips?\b|incant\w*|conjur(?:e|es|ing)\b|summon(?:s|ing)?\b|hex(?:es|ing)?\b|magick?\b)/i;

function casting(line: string): string | undefined {
  const m = CASTING.exec(line);
  return m ? `casting: ${m[0].toLowerCase()}` : undefined;
}

/** A spell by its name, anywhere: the character's own first (a ready spell's name wins over the rules' others), then any the rules know. */
function spellIn(line: string, sheet: ActingSheet, spells: readonly Named[]): string | undefined {
  const named = spellNamed(sheet.spells, line) ?? spellNamed(spells, line);
  return named ? `a spell: ${named.name}` : undefined;
}

/** A class feature of the character's, by its name, anywhere (Second Wind, Rage, Lay on Hands): an everyday word among them too, since only they have it. */
function featureIn(line: string, sheet: ActingSheet): string | undefined {
  const feature = namedIn(sheet.features, line, { asName: false });
  return feature ? `a feature: ${feature.name}` : undefined;
}

/**
 * A blow, a shot or a throw. Anywhere: what's nearly always one (attack, stab, punch, kick, shoot,
 * slash, smite, headbutt...). In what the character does: something swung, thrown, fired or loosed
 * at someone or something ("I take a swing at Kell", "loose the crossbow at his hand", "a stone at
 * the hook"), and what's as often something else (hit, strike, smash, bash, kill; a slap or an
 * elbow at someone). Present tense only: the past is what happened.
 */
const BLOW = /\b(?:attack(?:s|ing)?|stab(?:s|bing)?|punch(?:es|ing)?|kick(?:s|ing)?|shoot(?:s|ing)?|slash(?:es|ing)?|smite(?:s)?|smiting|headbutt(?:s|ing)?|bludgeon(?:s|ing)?|skewer(?:s|ing)?|impal(?:e|es|ing)|behead(?:s|ing)?|pummel(?:s|ling)?|slug(?:s|ged|ging)?|wallop(?:s|ed|ing)?|clobber(?:s|ed|ing)?|thump(?:s|ed|ing)?)\b/i;
const AT = /\b(?:swing(?:s|ing)?|swipe(?:s)?|swiping|lunge(?:s)?|lunging|thrust(?:s|ing)?|throw(?:s|ing)?|hurl(?:s|ing)?|fling(?:s|ing)?|lob(?:s|bing)?|toss(?:es|ing)?|fire(?:s)?|firing|loose(?:s)?|loosing|let\s+fly|aim(?:s|ing)?|launch(?:es|ing)?)\b[^.!?;:]{0,40}?\bat\b/i;
const DEED = /\b(?:hit(?:s|ting)?|strike(?:s)?|striking|smash(?:es|ing)?|bash(?:es|ing)?|whack(?:s|ing)?|clout(?:s|ing)?|kill(?:s|ing)?|cut\s+(?:him|her|them)\s+down|run\s+(?:him|her|them)\s+through)\b/i;
/** A slap, an elbow or a knee at someone: a pronoun, a person, or a name (a capital letter: "slap Cob", not "slap down a crown"). */
const AT_SOMEONE = /\b(?:[Ss]lap(?:s|ping)?|[Ee]lbow(?:s|ing)?|[Kk]nee(?:s|ing)?)\s+(?:him\b|her\b|them\b|the\s+(?:boy|girl|man|woman|sergeant|corporal|clerk|guard|constable)\b|[A-Z][a-z]+)/;

function blowIn(line: string, deeds: string[]): string | undefined {
  const m = BLOW.exec(line) ?? deeds.map(d => AT.exec(d) ?? DEED.exec(d) ?? AT_SOMEONE.exec(d)).find(Boolean);
  return m ? `a blow: ${m[0].replace(/\s+/g, " ").slice(0, 40).toLowerCase()}` : undefined;
}

/**
 * One of the character's weapons in what they do, brought onto, into or through someone or
 * something ("I bring my dagger down on his hand", "my crossbow at his sword hand"); not drawn,
 * sheathed or used to slit a lining.
 */
function weaponIn(deeds: string[], sheet: ActingSheet): string | undefined {
  const weapon = sheet.weapons.find(w => deeds.some(d => usedOn(w, d)));
  return weapon ? `a weapon: ${weapon.name}` : undefined;
}

const usedOn = (weapon: Named, deed: string) => new RegExp(`\\b${patternOf(weapon.name)}\\b[^.!?;:]{0,30}?\\b(?:at|into|onto|on|across|against|through)\\s+(?:him|her|them|his|its|their|the|a|an|[A-Z])`, "i").test(deed);

// ---------------------------------------------------------------------------------------------
// Names as they're typed.

/**
 * The SRD's spells whose name is an everyday word, which count only written as a name (a capital
 * letter, in the middle of a sentence: "I cast Light on it", "Sleep on them both"): "the light's
 * poor", "a message for the Captain" and "watch the gate" aren't spells.
 */
const EVERYDAY = new Set([
  "aid", "alarm", "augury", "awaken", "bane", "bless", "blight", "blink", "blur", "clone", "command", "commune", "compulsion", "confusion",
  "contagion", "contingency", "creation", "darkness", "daylight", "divination", "dream", "earthquake", "entangle", "enthrall", "fabricate",
  "fear", "fly", "forbiddance", "foresight", "gate", "grease", "guidance", "hallow", "harm", "haste", "heal", "heroism", "identify",
  "imprisonment", "jump", "knock", "light", "maze", "mending", "message", "mislead", "regenerate", "resistance", "resurrection", "sanctuary",
  "seeming", "sending", "sequester", "shatter", "shield", "silence", "sleep", "slow", "suggestion", "symbol", "tongues", "tsunami", "web",
  "weird", "wish",
]);

/** A name's key: its letters alone, in lower case ("Fire-Bolt", "fire bolt" and "firebolt" are "firebolt"). */
const keyOf = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");

/** A name as a pattern: its words with anything or nothing between them (a space, a hyphen, an apostrophe). */
const patternOf = (name: string) => name.toLowerCase().split(/[^a-z]+/).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s'’/-]*");

/**
 * Written as a name: a capital letter, not where a sentence, a bracket or the line starts, and not
 * the first word of a longer name ("the Mending House").
 */
const asAName = (line: string, at: number, length: number) => /^[A-Z]/.test(line.slice(at)) && !/(?:^|[.!?;:()*"“]\s*)$/.test(line.slice(0, at)) && !/^\s+[A-Z]/.test(line.slice(at + length));

/** The longest of the names the line has, by its words as typed; an everyday one only written as a name when `asName`. */
function namedIn(names: readonly Named[], line: string, options: { asName: boolean }): Named | undefined {
  const { all, byKey } = matcherOf(names);
  const found = [...line.matchAll(all)]
    .map(m => ({ named: byKey.get(keyOf(m[0])), at: m.index, length: m[0].length }))
    .filter((f): f is { named: Named; at: number; length: number } => !!f.named && (!options.asName || !EVERYDAY.has(keyOf(f.named.name)) || asAName(line, f.at, f.length)))
    .map(f => f.named);
  return found.sort((a, b) => b.name.length - a.name.length)[0];
}

interface Matcher { all: RegExp; byKey: Map<string, Named> }
const MATCHERS = new WeakMap<readonly Named[], Matcher>();

/** Every name of a list in one pattern, made once for the list (the rules' spells are the same list every turn). */
function matcherOf(names: readonly Named[]): Matcher {
  const known = MATCHERS.get(names);
  if (known) return known;
  const byKey = new Map(names.filter(n => keyOf(n.name)).map(n => [keyOf(n.name), n]));
  const alternatives = names.map(n => patternOf(n.name)).filter(Boolean).sort((a, b) => b.length - a.length);
  const all = new RegExp(alternatives.length ? `\\b(?:${alternatives.join("|")})\\b` : "(?!)", "gi");
  const made = { all, byKey };
  MATCHERS.set(names, made);
  return made;
}
