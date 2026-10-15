import { gmOffline, respondJson, type Ask } from "../llm/openrouter.ts";
import type { Backstory } from "../runtime/session.ts";
import { seedDoc, seedPaths, titleOf, type Doc } from "./docs.ts";

/**
 * The player's backstory at character creation: drafting one from the concept and the build,
 * working rough notes into a story in the player's own voice (keeping everything they wrote),
 * checking it against the world's lore (the docs service's World, Places and Cast, the GM's truths
 * among them, for what it touches) for what contradicts canon, with a fix that keeps its spirit, and
 * drawing out what it says of them (who they are, in a sentence or two for every GM brief;
 * personality, ideals, bonds and flaws for the sheet). The model's part goes through an Ask, so the
 * checks can stand in for it; offline there's no model to ask, and each says so (the traits are
 * then drawn from the player's own sentences).
 */

/** Who the backstory is for, as the model is told: their name, concept, and build in a line. */
export interface Who { name: string; concept: string; build?: string }

/** A part of a backstory that contradicts canon, and a fix that keeps its spirit. */
export interface LoreIssue {
  /** The backstory's own words that don't fit, as written; undefined when they couldn't be found in it (rewrite it, then). */
  quote?: string;
  /** What's wrong, in terms anyone in Caerwyn could know: never a secret of the GM's. */
  problem: string;
  /** Words to put in the quote's place: the same spirit, fitting the world. */
  fix: string;
}

/** What asking came to: the text, or why there's none (offline, or the GM couldn't be reached). */
export type Asked<T> = { ok: true; value: T } | { ok: false; why: string };

const OFFLINE = "The GM is offline, so there's nobody to ask: write it yourself, or skip it.";
const failed = (error: unknown) => `The GM couldn't be reached (${error instanceof Error ? error.message.slice(0, 160) : String(error)}).`;
const asker = (ask?: Ask): Ask | undefined => ask ?? (gmOffline() ? undefined : respondJson);
const STYLE = "The house style is dry and a little comic (Pratchett): the world plays it straight, and the comedy is in the specifics.";

// ---------------------------------------------------------------------------------------------
// The world, as the model's told it (the docs service's authored lore).

/** The story the backstory leads into (why they took this case). */
export const PREMISE = "The King's investigator, on the morning of the eve of the Centennial Assembly in Caerwyn: King Aldren, who remembers how the dead clerk Wendell Prout took his tea, has asked them quietly to see Prout done right by, and lent them a sergeant of the watch, Agnes Kell, who has never met them.";

/** Who in the Cast the backstory touches, by the words that bring them in: their folder, and what calls them up. */
const CAST_WORDS: Array<[string, RegExp]> = [
  ["King Aldren", /\b(king|kings|king's|aldren|queen|royal|crown|throne|majesty|prince|princess|palace|court|edric)\b/i],
  ["Sergeant Agnes Kell", /\b(kell|agnes|sergeant|watch|watchman|watchwoman)\b/i],
  ["Corporal Abner Tull", /\b(tull|abner|corporal|watch)\b/i],
  ["Marshal Garran Holt", /\b(holt|garran|marshal|garrison|palace guard)\b/i],
  ["Master Josiah Sallow", /\b(sallow|josiah|purveyor\w*|under-purveyor)\b/i],
  ["The Crake Brothers", /\b(crakes?|bruisers?)\b/i],
  ["Big Hobb Mallory", /\b(hobb|mallory|arm-wrestl\w*)\b/i],
  ["Nan Quill", /\b(nan|quill|landlady|drowned rat)\b/i],
  ["Arlo Quarry", /\b(arlo|quarry|lighterman|lightermen)\b/i],
  ["Dilly Sparrow", /\b(dilly|sparrow|dabchick|bargewoman)\b/i],
  ["Saul Tench", /\b(saul|tench|duchess|night watchman)\b/i],
  ["Hepzibah Grist", /\b(hepzibah|hep|grist|forewoman)\b/i],
  ["Mister Lemuel Scrope", /\b(scrope|lemuel)\b/i],
  ["Cob", /\bcob\b/i],
  ["Moll", /\bmoll\b/i],
];

/** The places' docs and the truths behind the world's public docs, by what calls them up. */
const PLACE_WORDS: Array<[string, RegExp]> = [
  ["World/City Watch (truth).md", /\b(watch|captain|sergeant|corporal|constable)\b/i],
  ["World/Grain Crisis (truth).md", /\b(grain|granary|corn|bread|famine|harvest)\b/i],
  ["Places/Granary Yard.md", /\b(granary|prout|clerk)\b/i],
  ["Places/Granary Yard (truth).md", /\b(granary|prout|clerk)\b/i],
  ["Places/Heron Warehouse.md", /\b(heron|warehouse|saltmere|wharf|wharves)\b/i],
  ["Places/Heron Warehouse (truth).md", /\b(heron|warehouse|saltmere)\b/i],
  ["Places/The Drowned Rat.md", /\b(drowned rat|the rat|tavern|alehouse|inn)\b/i],
  ["Places/The Drowned Rat (truth).md", /\b(drowned rat|the rat)\b/i],
  ["Places/Market Square.md", /\b(market|corn exchange|square)\b/i],
  ["Places/River Stairs.md", /\b(river|stairs|docks?|wharf|wharves|barges?|bargee)\b/i],
  ["Places/Palace Kitchens.md", /\b(kitchens?|cook|scullery)\b/i],
  ["Places/Watch House.md", /\b(watch house|watch-house|cells?|gaol|jail)\b/i],
];

/**
 * The lore a backstory is checked against, through the docs service from the authored lore:
 * everything anyone in Caerwyn could know (the World's public docs, what's where, the Cast's public
 * faces), and, for the people, places and things it touches, the deeper truth (their own notes, the
 * GM's notes on them, a place's doc and the truth behind it).
 */
export function canonFor(story: string): Doc[] {
  const paths = seedPaths();
  const isTruth = (p: string) => / \(truth\)\.md$/.test(p);
  const always = paths.filter(p => p === "index.md" || (/^World\//.test(p) && !isTruth(p) && !/(Fronts|Caerwyn now)\.md$/.test(p)) || p === "Places/index.md" || p === "Cast/index.md" || /^Cast\/[^/]+\/public\.md$/.test(p));
  const touched = [
    ...CAST_WORDS.filter(([, rx]) => rx.test(story)).flatMap(([folder]) => [`Cast/${folder}/private.md`, `Cast/${folder}/gm.md`]),
    ...PLACE_WORDS.filter(([, rx]) => rx.test(story)).map(([p]) => p),
  ];
  return [...new Set([...always, ...touched])].filter(p => paths.includes(p)).map(p => seedDoc(p)).filter((d): d is Doc => !!d);
}

const lore = (docs: Doc[]) => docs.map(d => `### ${d.path} (${d.meta.visibility === "gm" ? "the GM's truth: never tell the player what's in it" : d.meta.visibility === "private" ? "their own notes: what they know and believe" : "public: anyone could know it"})\n${d.body}`).join("\n\n");

/** The world in brief, for drafting: the city, and the story's premise. */
function primer(): string {
  const city = seedDoc("World/Caerwyn.md");
  return [`## The world: ${city ? titleOf(city) : "Caerwyn"}\n${city?.body ?? ""}`, `## The story this backstory leads into\n${PREMISE}`].join("\n\n");
}

const who = (w: Who) => `${w.name}: ${w.concept}.${w.build ? ` In game terms: ${w.build}.` : ""}`;

// ---------------------------------------------------------------------------------------------
// Drafting one, and working one in.

/** "Draft one": a backstory from the concept and the build, in the first person. Never put in the box until the player says so. */
export async function draftBackstory(w: Who, options: { ask?: Ask } = {}): Promise<Asked<string>> {
  const ask = asker(options.ask);
  if (!ask) return { ok: false, why: OFFLINE };
  try {
    const out = await ask<{ story: string }>({
      operation: "backstory.draft", effort: "low", maxOutputTokens: 1200,
      instructions: [
        "You write a player character's backstory for a tabletop roleplaying game, in the first person, as the player would write it at the table: where they're from, what they owe (and to whom), who they've lost, and why they took this case (the story it leads into).",
        "120 to 180 words, in two or three short paragraphs; plain and specific: names, places, and one good detail each. Their past makes sense of their concept and their build (the class's skills, the background's trade, the species).",
        "Invent their own people and places freely, but fit the world below: don't make them kin to, or old friends or enemies of, the story's named people, and don't give them anything the world would have had to record (a title, an office, a famous deed).",
        STYLE,
      ].join("\n"),
      input: [{ role: "user", content: [`## The player character\n${who(w)}`, primer()].join("\n\n") }],
      json: { name: "backstory", schema: { type: "object", additionalProperties: false, required: ["story"], properties: { story: { type: "string", description: "The backstory: paragraphs separated by a blank line" } } } },
    });
    const story = tidy(out.story);
    return story ? { ok: true, value: story } : { ok: false, why: "The GM had nothing to say. Try again, or write it yourself." };
  } catch (error) { return { ok: false, why: failed(error) }; }
}

/** Words that start sentences without being anyone's name. */
const STARTERS = new Set(("i my me mine we our us you your he his him she her they their them it its this that these those there here then when while " +
  "but and or so yet nor if as at in on to for of from by with without after before since until once now later still also even just only " +
  "the a an no not never always sometimes some all every each one two three both because though although which who whom whose what where why how " +
  "was were is are am be been had has have did do does will would could should might must can may shall let").split(" "));

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

/** Which of the words a story left out (case aside). */
export const leftOut = (words: string[], story: string) => words.filter(w => !story.toLowerCase().includes(w.toLowerCase()));

/** "Work it in": the player's rough notes as a story in their own voice, keeping everything they wrote. Never put in the box until they say so. */
export async function workIn(notes: string, w: Who, options: { ask?: Ask } = {}): Promise<Asked<string>> {
  const ask = asker(options.ask);
  if (!ask) return { ok: false, why: OFFLINE };
  if (!notes.trim()) return { ok: false, why: "There's nothing written yet to work in: write a few notes first (or Draft one)." };
  const keep = keepWords(notes);
  const once = async (also?: string[]) => tidy((await ask<{ story: string }>({
    operation: "backstory.work", effort: "low", maxOutputTokens: 1500,
    instructions: [
      "You turn a player's rough notes about their character into their backstory, in the player's own voice: the first person if that's how they wrote (or if it's unclear), the third if they wrote in it; their tone, their turns of phrase.",
      "Keep everything they wrote: every fact, name, place, number and choice stays, and nothing they wrote is contradicted, softened or explained away. You may order it, join it up and smooth it, and add only what links it together (a because, a then); no new people, places or events of your own.",
      "As long as it needs to be and no longer (their notes are the measure): paragraphs separated by a blank line.",
      ...(also?.length ? [`Your first try left out some of what they wrote: ${also.join(", ")}. Keep every one of them this time.`] : []),
    ].join("\n"),
    input: [{ role: "user", content: [`## The player character\n${who(w)}`, `## The player's notes, word for word\n${notes.trim()}`].join("\n\n") }],
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
// The lore check.

/**
 * Where a quote is in the text: exactly, or with case, spacing and quote marks aside. Its start and
 * end in the text as written, or undefined.
 */
export function locate(text: string, quote: string): { start: number; end: number } | undefined {
  const q = quote.trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g, "").trim();
  if (!q) return undefined;
  const exact = text.indexOf(q);
  if (exact >= 0) return { start: exact, end: exact + q.length };
  // Normalised, keeping a map back to the original's indices.
  const norm = (c: string) => (/["“”]/.test(c) ? '"' : /['‘’]/.test(c) ? "'" : c.toLowerCase());
  const chars: string[] = [], at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (/\s/.test(c)) { if (chars.at(-1) !== " ") { chars.push(" "); at.push(i); } continue; }
    chars.push(norm(c)); at.push(i);
  }
  const hay = chars.join("");
  const needle = q.replace(/\s+/g, " ").split("").map(norm).join("").replace(/[.,;:!?]+$/, "");
  const found = hay.indexOf(needle);
  if (found < 0 || !needle) return undefined;
  return { start: at[found]!, end: at[found + needle.length - 1]! + 1 };
}

/** The text with a fix accepted: the quote's words replaced by the fix's. Undefined if the quote isn't there any more. */
export function applyFix(text: string, issue: LoreIssue): string | undefined {
  if (!issue.quote) return undefined;
  const span = locate(text, issue.quote);
  if (!span) return undefined;
  return `${text.slice(0, span.start)}${issue.fix.trim()}${text.slice(span.end)}`;
}

/**
 * Check a backstory against the world's lore: what contradicts canon (or claims a tie to its named
 * people, offices or events that canon would have had to record), each with a fix that keeps its
 * spirit. An empty list when it fits. Offline (or when the GM can't be reached) it isn't checked,
 * and says why: nothing is ever changed without the player seeing it.
 */
export async function checkLore(story: string, w: Who, options: { ask?: Ask } = {}): Promise<Asked<LoreIssue[]>> {
  const ask = asker(options.ask);
  if (!ask) return { ok: false, why: "The GM is offline, so nobody has checked it against the world: it goes in as you wrote it." };
  if (!story.trim()) return { ok: true, value: [] };
  try {
    const out = await ask<{ issues: Array<{ quote: string; problem: string; fix: string }> }>({
      operation: "backstory.check", effort: "low", maxOutputTokens: 1500,
      instructions: [
        "You check a player character's backstory against the lore of the world they're about to play in, before the game starts, as a good GM would at session zero.",
        "The backstory is theirs, and most of it is simply new: their own family, home, trade, debts, losses and people are theirs to invent, and need no lore behind them. Leave all of that alone.",
        "Flag only what doesn't fit the world: what contradicts the lore below (a place, a law, an event, how someone is), or what claims a tie to the world's named people, offices or events that the lore would have had to record and doesn't (kin to the King, a post at court, an old partner or enemy of someone the story will introduce as a stranger, a hand in what the story is about). The story's premise holds too: the people of the story don't know them yet, but the King asked for them.",
        "For each: quote, the backstory's own words that don't fit, copied exactly (as short as makes sense, a phrase or a sentence); problem, what doesn't fit, in a sentence for the player, in terms anyone in Caerwyn could know (if it's a GM's truth that it breaks, say only that it doesn't fit the world as it stands, never what the truth is); fix, words to put in the quote's place that keep its spirit (what it does for them: a tie to the court, a grudge, a debt, a reason) and fit the world, in their voice, about as long.",
        "Most backstories fit: then there are no issues. Never more than four.",
      ].join("\n"),
      input: [{ role: "user", content: [
        `## The lore (the docs service: the world, its places and its people)\n${lore(canonFor(story))}`,
        `## The story's premise\n${PREMISE}`,
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
  } catch (error) { return { ok: false, why: `${failed(error)} It goes in as you wrote it.` }; }
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
export async function finishBackstory(text: string, w: Who, options: { ask?: Ask } = {}): Promise<Backstory> {
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
