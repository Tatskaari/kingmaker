import { locate, STARTERS } from "../../shared/creation/story.ts";
import type { Asked, Backstory, CreationWorld, LoreIssue, Who } from "../../shared/creation/types.ts";
import { canonPaths } from "../../shared/creation/world.ts";
import { modelOffline, respondJson, type Ask } from "../llm/openrouter.ts";
import { seedDoc, seedPaths, titleOf, type Doc } from "./docs.ts";

// Moved to shared/creation (the client and the simulation need them, and may not import ai/): re-exported, so the prototype's imports stayed as they were.
export { applyFix, locate, MOST_WORDS, tooLong, wordCount } from "../../shared/creation/story.ts";
export type { Asked, LoreIssue, Who } from "../../shared/creation/types.ts";

/**
 * The player's backstory at character creation: drafting one from the concept and the build,
 * working rough notes into a story in the player's own voice (keeping everything they wrote),
 * checking it against the world's lore (the docs service's public World, Places and Cast: what
 * anyone in Caerwyn could know, and never the GM's truths, since what the check says goes straight
 * to the player) for what contradicts canon, with a fix that keeps its spirit, and drawing out what
 * it says of them (who they are, in a sentence or two for every GM brief; personality, ideals,
 * bonds and flaws for the sheet). The model's part goes through an Ask, so the checks can stand in
 * for it; offline there's no model to ask (or `ask: null` says so), and each says so (the traits are
 * then drawn from the player's own sentences). The world is the campaign's (`world`, campaign.json's
 * `creation`), Caerwyn's when none is given.
 */

const OFFLINE = "The GM is offline, so there's nobody to ask: write it yourself, or skip it.";
const unreached = (error: unknown) => `the GM couldn't be reached (${error instanceof Error ? error.message.slice(0, 160) : String(error)})`;
const failed = (error: unknown) => `${unreached(error).replace(/^t/, "T")}.`;
/** The model to ask: the one given; none when it's null (offline, whatever the environment says); else OpenRouter, unless it's offline. */
const asker = (ask?: Ask | null): Ask | undefined => (ask === null ? undefined : (ask ?? (modelOffline() ? undefined : respondJson)));
const STYLE = "The house style is dry and a little comic (Pratchett): the world plays it straight, and the comedy is in the specifics.";

// ---------------------------------------------------------------------------------------------
// The world, as the model's told it (the docs service's authored lore).

/** The story the backstory leads into (why they took this case). */
export const PREMISE = "This morning, the eve of the Centennial Assembly in Caerwyn, a palace clerk, Wendell Prout, was found hanged behind the King's Granary, and the Watch Captain has already called it suicide. When the news reached him, King Aldren, who remembers how Prout took his tea, asked the player character quietly to see Prout done right by (they're the King's investigator now), and lent them a sergeant of the watch, Agnes Kell, who has never met them. The game begins as they walk into the granary yard to meet her. The King asked for them, but none of the story's other named people know them yet.";

/**
 * Caerwyn, the world a backstory is written for when no other is given: the premise, the city's own
 * doc, the World docs that aren't canon (how it stands now, its fronts, the index), and the places'
 * public docs by the words that call them up. v2's campaign.json has the same as its `creation`.
 */
export const CAERWYN: CreationWorld = {
  name: "Caerwyn",
  premise: PREMISE,
  primer: "World/Caerwyn.md",
  notCanon: ["World/Caerwyn now.md", "World/Fronts.md", "World/index.md"],
  places: [
    { doc: "Places/Granary Yard.md", words: "\\b(granary|prout|clerk|loft|hoist)\\b" },
    { doc: "Places/Heron Warehouse.md", words: "\\b(heron|warehouse|saltmere|wharf|wharves)\\b" },
    { doc: "Places/The Drowned Rat.md", words: "\\b(drowned rat|the rat|tavern|alehouse|inn)\\b" },
    { doc: "Places/Market Square.md", words: "\\b(market|corn exchange|square)\\b" },
    { doc: "Places/River Stairs.md", words: "\\b(river|stairs|docks?|wharf|wharves|barges?|bargee)\\b" },
    { doc: "Places/Palace Kitchens.md", words: "\\b(kitchens?|cook|scullery)\\b" },
    { doc: "Places/Watch House.md", words: "\\b(watch house|watch-house|cells?|gaol|jail)\\b" },
  ],
};

/**
 * The lore a backstory is checked against, through the docs service from the authored lore: what
 * anyone in the world could know, and only that (the World's public docs, the Cast's public faces,
 * and the public docs of the places it touches; no index, whose one-line summaries of where to read
 * on say more than the public faces do: canonPaths chooses them). Never a private or GM doc, whatever
 * the story says: what the check finds is shown to the player as it's written, and a model that's
 * been told the murder gives it away in a problem or a fix ("the tally loft is where Prout was
 * killed, and Cob was hiding there"), however it's told not to. A tie to the story's people or its
 * case is the premise's to rule out, which needs no secret.
 */
export function canonFor(story: string, world: CreationWorld = CAERWYN): Doc[] {
  return canonPaths(seedPaths(), story, world).map(p => seedDoc(p)).filter((d): d is Doc => !!d && d.meta.visibility === "public");
}

const lore = (docs: Doc[]) => docs.map(d => `### ${d.path}\n${d.body}`).join("\n\n");

/** The world in brief, for drafting: its own doc, and the story's premise. */
function primer(world: CreationWorld): string {
  const doc = seedDoc(world.primer);
  return [`## The world: ${doc ? titleOf(doc) : world.name}\n${doc?.body ?? ""}`, `## The story this backstory leads into\n${world.premise}`].join("\n\n");
}

const who = (w: Who) => `${w.name}: ${w.concept}.${w.build ? ` In game terms: ${w.build}.` : ""}`;

// ---------------------------------------------------------------------------------------------
// Drafting one, and working one in.

/** "Draft one": a backstory from the concept and the build, in the first person. Never put in the box until the player says so. */
export async function draftBackstory(w: Who, options: { ask?: Ask | null; world?: CreationWorld } = {}): Promise<Asked<string>> {
  const ask = asker(options.ask);
  if (!ask) return { ok: false, why: OFFLINE };
  const once = async (also: string[] = []) => tidy((await ask<{ story: string }>({
    operation: "backstory.draft", effort: "low", maxOutputTokens: 1200,
    instructions: [
      "You write a player character's backstory for a tabletop roleplaying game, in the first person, as the player would write it at the table: where they're from, what they owe (and to whom), who they've lost, and why they took this case (the story it leads into).",
      "120 to 180 words, in two or three short paragraphs; plain and specific: names, places, and one good detail each. Their past makes sense of their concept and their build (the class's skills, the background's trade, the species), told as a life, not in the game's terms (no class, subclass or background by name).",
      "Invent their own people and places freely, but fit the world below: don't make them kin to, or old friends or enemies of, the story's named people (they've never met any of them), and don't give them anything the world would have had to record (a title, an office, a famous deed).",
      "It ends where the game begins. Their past runs up to this morning: Prout was found hanged, and then, when the news reached him, the King asked them (because Prout was found, so never before it, and never on another day). Say why they said yes, not how the case goes: their reasons are their own (a debt, a loss, a conscience), but the case is Prout's alone, and nothing in their past is part of it.",
      STYLE,
      ...(also.length ? [`Your first draft got the order of this morning wrong (${also.join("; ")}): keep to the story's premise this time.`] : []),
    ].join("\n"),
    input: [{ role: "user", content: [`## The player character\n${who(w)}`, primer(options.world ?? CAERWYN)].join("\n\n") }],
    json: { name: "backstory", schema: { type: "object", additionalProperties: false, required: ["story"], properties: { story: { type: "string", description: "The backstory: paragraphs separated by a blank line" } } } },
  })).story);
  try {
    let story = await once();
    // Words alone can show a draft that has the King asking before Prout was found (or on another day): asked again, once.
    const slips = premiseSlips(story);
    if (slips.length) story = await once(slips);
    return story ? { ok: true, value: story } : { ok: false, why: "The GM had nothing to say. Try again, or write it yourself." };
  } catch (error) { return { ok: false, why: failed(error) }; }
}

/**
 * What a story says against the premise's order of things that its words alone show: the King
 * asking before Prout was found ("This morning, before Prout was found, the King asked me"), or on
 * another day ("Yesterday a palace runner asked me"). Each as what the premise has instead.
 */
export function premiseSlips(story: string): string[] {
  const slips: string[] = [];
  if (/\bbefore\s+(?:Prout|he|his body|the body|the clerk|anyone)\b[^.!?\n]{0,30}?\b(?:was|had been|were)\s+(?:found|discovered)\b/i.test(story)) slips.push("the King asked them after Prout was found, not before");
  const another = /\b(?:yesterday|last night|the night before|the day before|days? ago|last week|a week ago)\b/i;
  const asked = /\b(?:King|palace)\b[^.!?\n]{0,80}?\b(?:asked|sent for|summoned|called for|sent word)\b/i;
  if (story.split(/(?<=[.!?])\s+|\n+/).some(s => another.test(s) && asked.test(s))) slips.push("the King asked them this morning");
  return slips;
}

/** The words of the player's notes that a story made from them must keep: names, places, numbers. */
export function keepWords(notes: string): string[] {
  const words = new Set<string>();
  for (const sentence of notes.split(/(?<=[.!?])\s+|\n+/)) {
    const tokens = sentence.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
    tokens.forEach((t, i) => {
      const bare = t.replace(/['’]s$/, "");
      // A number; a capital in a sentence; a capital starting one that isn't a word sentences start with ("Mum", "Kell").
      if (/^\p{N}/u.test(bare) || (/^\p{Lu}/u.test(bare) && bare !== "I" && (i > 0 || !STARTERS.has(bare.toLowerCase())))) words.add(bare);
    });
  }
  return [...words];
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const NTHS: Record<string, string> = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };

/** A number as a story would write it ("89": eighty-nine; "1st": first), or none past what's worth spelling out. */
export function numberWords(numeral: string): string | undefined {
  const m = /^(\d+)(st|nd|rd|th)?$/i.exec(numeral);
  if (!m) return undefined;
  const n = Number(m[1]);
  const say = (k: number): string | undefined => k < 20 ? ONES[k]
    : k < 100 ? `${TENS[Math.floor(k / 10)]}${k % 10 ? `-${ONES[k % 10]}` : ""}`
    : k < 1000 ? `${ONES[Math.floor(k / 100)]} hundred${k % 100 ? ` and ${say(k % 100)}` : ""}` : undefined;
  const words = say(n);
  if (!words || !m[2]) return words;
  // The last word made an ordinal: "twenty-first", "fortieth", "a hundred and third".
  return words.replace(/[a-z]+$/, w => NTHS[w] ?? (w.endsWith("y") ? `${w.slice(0, -1)}ieth` : `${w}th`));
}

/** Which of the words a story left out (case aside; a number written as words is kept: "3" as "three", "1st" as "first"). */
export const leftOut = (words: string[], story: string) => {
  const plain = (t: string) => t.toLowerCase().replace(/[\s-]+/g, " ");
  const told = plain(story);
  const inWords = (w: string) => { const said = numberWords(w); return !!said && new RegExp(`\\b${plain(said)}\\b`).test(told); };
  return words.filter(w => !told.includes(plain(w)) && !inWords(w));
};

/** "Work it in": the player's rough notes as a story in their own voice, keeping everything they wrote. Never put in the box until they say so. */
export async function workIn(notes: string, w: Who, options: { ask?: Ask | null } = {}): Promise<Asked<string>> {
  const ask = asker(options.ask);
  if (!ask) return { ok: false, why: OFFLINE };
  if (!notes.trim()) return { ok: false, why: "There's nothing written yet to work in: write a few notes first (or Draft one)." };
  const keep = keepWords(notes);
  const once = async (also?: string[]) => tidy((await ask<{ story: string }>({
    operation: "backstory.work", effort: "low", maxOutputTokens: 1500,
    instructions: [
      "You turn a player's rough notes about their character into their backstory, in the player's own voice: the first person if that's how they wrote (or if it's unclear), the third if they wrote in it; their tone, their turns of phrase.",
      "Keep everything they wrote: every fact, name, place, number and choice stays, and nothing they wrote is contradicted, softened or explained away. You may order it, join it up and smooth it, and add only what links it together (a because, a then); no new people, places or events of your own.",
      "Write it as a story, not as notes: numbers in words where a story would have them (\"two men\", \"seventy years\", \"the first winter\"; a year can stay as it is), and shorthand spelled out (\"yrs\" is years). Leave out the game's terms: no class, subclass, background or level (they're on the sheet; a story says what they do, not what they are in the rules).",
      "As long as it needs to be and no longer (their notes are the measure): paragraphs separated by a blank line.",
      ...(also?.length ? [`Your first try left out some of what they wrote: ${also.join(", ")}. Keep every one of them this time.`] : []),
    ].join("\n"),
    // Their name and concept, not their build: what's in the story is theirs, and the game's terms aren't.
    input: [{ role: "user", content: [`## The player character\n${who({ name: w.name, concept: w.concept })}`, `## The player's notes, word for word\n${notes.trim()}`].join("\n\n") }],
    json: { name: "backstory", schema: { type: "object", additionalProperties: false, required: ["story"], properties: { story: { type: "string" } } } },
  })).story);
  try {
    let story = await once();
    const missed = leftOut(keep, story);
    if (missed.length) story = await once(missed);
    return story ? { ok: true, value: story } : { ok: false, why: "The GM had nothing to say. Try again, or write it yourself." };
  } catch (error) { return { ok: false, why: failed(error) }; }
}

/** Paragraphs as the box shows them: trimmed, a blank line between, no stray markdown. */
const tidy = (text: string | undefined) => (text ?? "").replace(/\r/g, "").replace(/^#+\s.*$/gm, "").split(/\n\s*\n/).map(p => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean).join("\n\n");

// ---------------------------------------------------------------------------------------------
// The lore check (where a quote is, and a fix applied: shared/creation/story.ts).

/**
 * Check a backstory against the world's lore: what contradicts canon (or claims a tie to its named
 * people, offices or events that canon would have had to record), each with a fix that keeps its
 * spirit. An empty list when it fits. Offline (or when the GM can't be reached) it isn't checked,
 * and says why: nothing is ever changed without the player seeing it.
 */
export async function checkLore(story: string, w: Who, options: { ask?: Ask | null; world?: CreationWorld } = {}): Promise<Asked<LoreIssue[]>> {
  const ask = asker(options.ask), world = options.world ?? CAERWYN;
  if (!ask) return { ok: false, why: "The GM is offline, so nobody has checked it against the world: it goes in as you wrote it.", reason: "the GM is offline" };
  if (!story.trim()) return { ok: true, value: [] };
  try {
    const out = await ask<{ issues: Array<{ quote: string; problem: string; fix: string }> }>({
      operation: "backstory.check", effort: "low", maxOutputTokens: 1500,
      instructions: [
        "You check a player character's backstory against the lore of the world they're about to play in, before the game starts, as a good GM would at session zero.",
        "The backstory is theirs, and most of it is simply new: their own family, home, trade, debts, losses and people are theirs to invent, and need no lore behind them. Leave all of that alone.",
        "Only the backstory is checked: their name, concept and build are there so you know who they are, and stand as they are; a quote is always the backstory's own words.",
        "Flag only what doesn't fit the world: what contradicts the lore below (a place, a law, an event, how someone is), or what claims a tie to the world's named people, offices or events that the lore would have had to record and doesn't (kin to the King, a post at court, an old partner or enemy of someone the story will introduce as a stranger, a hand in what the story is about). The story's premise holds too: the people of the story don't know them yet, but the King asked for them (this morning, once Prout had been found: not before, and not on another day); and their past is their own, not part of the case. They weren't at the granary the night Prout died, saw and heard nothing of it, didn't know what he was doing, and had no hand in it: his death, that night, that place and whatever's behind it are the story's to tell and theirs to find out, so a past that puts them there, or makes them a witness, doesn't fit.",
        "The lore below is what anyone in Caerwyn could know, and all you're told: the story's secrets aren't in it, and aren't yours to guess at. What they believe of someone that the lore doesn't contradict is theirs to believe; flag a belief only when it's a tie the premise rules out.",
        "For each: quote, the backstory's own words that don't fit, copied exactly (as short as makes sense, a phrase or a sentence); problem, what doesn't fit, in a sentence for the player, from the lore below or the premise; fix, words to put in the quote's place that keep its spirit (what it does for them: a tie to the court, a grudge, a debt, a reason) and fit the world, in their voice, about as long: they replace the quote and nothing else, reading on from the words before it and into the words after it without repeating them.",
        "A fix has to fit everything a story does, the premise too: it never keeps what didn't fit by another road (if they can't have met someone, the fix doesn't have them meet some other way; not kin, then not kin by marriage either). Check each fix as you checked the story.",
        "Most backstories fit: then there are no issues. Never more than four.",
      ].join("\n"),
      input: [{ role: "user", content: [
        `## The lore (the docs service: the world, its places and its people, as anyone in Caerwyn could know them)\n${lore(canonFor(story, world))}`,
        `## The story's premise\n${world.premise}`,
        `## The player character\n${who(w)}`,
        `## Their backstory, word for word\n${story.trim()}`,
      ].join("\n\n") }],
      json: { name: "lore_check", schema: { type: "object", additionalProperties: false, required: ["issues"], properties: { issues: { type: "array", items: {
        type: "object", additionalProperties: false, required: ["quote", "problem", "fix"],
        properties: { quote: { type: "string" }, problem: { type: "string" }, fix: { type: "string" } },
      } } } } },
    });
    const issues = (out.issues ?? []).filter(i => i && typeof i.problem === "string" && typeof i.fix === "string" && i.fix.trim()).slice(0, 4).map((i): LoreIssue => {
      // The quote as the backstory has it (the model's copy may differ in case or spacing); none if it isn't there.
      const span = typeof i.quote === "string" ? locate(story, i.quote) : undefined;
      return { ...(span ? { quote: story.slice(span.start, span.end) } : {}), problem: i.problem.trim(), fix: i.fix.trim() };
    });
    return { ok: true, value: issues };
  } catch (error) { return { ok: false, why: `${failed(error)} It goes in as you wrote it.`, reason: unreached(error) }; }
}

// ---------------------------------------------------------------------------------------------
// What it says of them.

const SENTENCES = (text: string) => text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
const short = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : s);

/** Offline: what the player's own sentences say of them, by their words (a debt, a loss, a vow, a weakness). */
export function traitsFromWords(text: string, w: Who): Omit<Backstory, "text"> {
  const s = SENTENCES(text);
  const find = (rx: RegExp, n: number) => s.filter(x => rx.test(x)).slice(0, n).map(x => short(x));
  const bonds = find(/\b(owe\w*|debt\w*|promis\w*|swore|sworn|sister|brother|mother|father|mum|da|daughter|son|wife|husband|friend|lost|died|dead|grave|home)\b/i, 2);
  const flaws = find(/\b(never|can't|cannot|won't|drink\w*|temper|afraid|fear\w*|coward\w*|lie|lies|lied|gambl\w*|greed\w*|proud|pride)\b/i, 1).filter(x => !bonds.includes(x));
  const ideals = find(/\b(believe\w*|justice|truth|right|duty|honou?r|freedom|must|fair\w*)\b/i, 1).filter(x => !bonds.includes(x) && !flaws.includes(x));
  const first = s.slice(0, 2).join(" ");
  return {
    summary: first ? `${w.name}, in their own words: "${short(first, 260)}"` : `${w.name}: ${w.concept}.`,
    personality: [short(w.concept, 120)], ideals, bonds, flaws,
  };
}

/**
 * What a finished backstory says of them: who they are in a sentence or two (for every GM brief),
 * and the sheet's personality, ideals, bonds and flaws. From the model; offline (or if it can't be
 * reached), from the player's own sentences.
 */
export async function finishBackstory(text: string, w: Who, options: { ask?: Ask | null } = {}): Promise<Backstory> {
  const ask = asker(options.ask);
  const story = text.trim();
  if (ask) {
    try {
      const out = await ask<Omit<Backstory, "text">>({
        operation: "backstory.traits", effort: "none", maxOutputTokens: 700,
        instructions: [
          "From a player character's backstory, write what it says of them, for their character sheet and the GM:",
          "- summary: who they are, in one or two sentences in the third person, using their name: where they're from, what drives them, what they're carrying (a debt, a loss) and why they took this case. The GM reads it every turn.",
          "- personality: one or two short traits; ideals: one; bonds: one or two (people, places, debts); flaws: one. Short phrases, in the backstory's own terms.",
          "Only what the backstory says or plainly implies: nothing new.",
        ].join("\n"),
        input: [{ role: "user", content: [`## The player character\n${who(w)}`, `## Their backstory\n${story}`].join("\n\n") }],
        json: { name: "traits", schema: { type: "object", additionalProperties: false, required: ["summary", "personality", "ideals", "bonds", "flaws"], properties: {
          summary: { type: "string" }, personality: { type: "array", items: { type: "string" } }, ideals: { type: "array", items: { type: "string" } },
          bonds: { type: "array", items: { type: "string" } }, flaws: { type: "array", items: { type: "string" } },
        } } },
      });
      const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map(x => x.trim()).slice(0, 3) : []);
      if (typeof out.summary === "string" && out.summary.trim()) return { text: story, summary: out.summary.trim(), personality: list(out.personality), ideals: list(out.ideals), bonds: list(out.bonds), flaws: list(out.flaws) };
    } catch { /* from their own words, then */ }
  }
  return { text: story, ...traitsFromWords(story, w) };
}
