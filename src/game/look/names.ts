/**
 * Reading a thing's name for its look. The GM invents things in plain English ("a flock of
 * pigeons", "a burning branch", "the jar of gin with the drowned rat in it", "an oil slick"), so the
 * look layer pulls out what matters for drawing:
 *
 * - the head noun, which decides the glyph (a jar, a pigeon, a branch);
 * - adjectives that are really states (burning, singed, wet, frozen, smashed) or colours (blue, silver);
 * - constructions with "of": a group ("a flock of pigeons": draw several pigeons), a pile ("a fistful
 *   of gutter stones": draw the stones), a surface ("a pool of blood": a patch on the ground), or a
 *   vessel ("a bucket of water": draw the bucket, tinted by what's in it).
 *
 * The key (the noun phrase without articles, owners, states and numbers) is what the look cache
 * remembers, so "a singed pigeon" and "the pigeon" cost one model call between them, at most.
 */

export interface ParsedName {
  /** Cache key: the bare noun phrase ("tea tray", "pigeon", "driftwood fire"). */
  key: string;
  /** The head noun, singular ("tray", "pigeon", "fire"). */
  head: string;
  /** The noun phrase the rules match against ("tea tray"). */
  phrase: string;
  /** States the name implies ("a burning branch" is burning). */
  states: string[];
  /** Colour words in the name ("blue", "silver"). */
  colors: string[];
  /** "flock", "crowd"...: a group of the thing. */
  group?: string;
  /** "fistful", "pile"...: several of the thing, lying together. */
  pile?: string;
  /** "pool", "slick", "cloud"...: the thing is a surface or a cloud of what follows "of". */
  surface?: string;
  /** "bucket", "jar"...: a vessel, and what's in it ("water"). */
  contents?: string;
  plural: boolean;
}

const GROUP = new Set(["flock", "crowd", "swarm", "pack", "herd", "gang", "mob", "throng", "band", "troupe", "school", "colony", "murder", "parliament", "knot", "party", "posse", "gaggle", "litter", "brood", "drove", "host", "horde", "rabble", "family", "clutch", "bevy", "covey", "skein"]);
const PILE = new Set(["pile", "heap", "stack", "tangle", "cluster", "bank", "handful", "fistful", "bundle", "bunch", "scattering", "armful", "pair", "brace", "set", "couple", "lot", "load", "mound", "drift", "litter", "string", "row", "line", "ring", "basketful", "sackful", "bagful", "pocketful", "few"]);
const SURFACE = new Set(["puddle", "pool", "slick", "spill", "splash", "stain", "smear", "trail", "patch", "film", "sheet", "cloud", "plume", "puff", "column", "wisp", "haze", "pall", "spatter", "splatter", "slop", "drift", "layer", "carpet", "blanket"]);
/** "a stub of candle", "a wheel of cheese": the look is the stuff, not the measure of it. */
const PART = new Set(["stub", "end", "scrap", "slice", "piece", "bit", "lump", "chunk", "shard", "sliver", "drop", "sip", "swig", "length", "coil", "roll", "bolt", "loaf", "wheel", "side", "sprig", "lock", "strip", "splinter", "fragment", "crumb", "morsel", "wedge", "hunk", "knob", "dab", "dash", "pinch", "speck", "fleck", "ball", "twist", "wad", "tuft", "stalk", "ear", "clump", "clod", "bar", "ingot", "nugget", "leg", "joint", "rasher", "round", "quarter", "half", "spoonful", "mouthful", "dollop", "smidgen", "trace", "whiff", "gust", "shower", "rain", "hail", "storm", "spray", "jet", "spurt", "trickle", "stream", "quantity", "amount", "portion", "helping", "serving", "measure", "dose", "batch", "supply", "share", "kind", "sort", "type", "variety"]);
const VESSEL = new Set(["bucket", "pail", "jar", "jug", "mug", "cup", "tankard", "glass", "bottle", "flask", "vial", "phial", "barrel", "keg", "cask", "sack", "bag", "basket", "box", "crate", "plate", "bowl", "pot", "pan", "tray", "pitcher", "purse", "pouch", "chest", "tin", "can", "saucer", "trough", "tub", "vat", "bowlful", "cupful", "goblet", "flagon", "measure", "decanter", "carafe", "kettle", "cauldron", "teapot", "platter", "dish", "cart", "barrow", "wagon", "skin", "wineskin", "satchel", "tumbler"]);

/** Adjectives that are states of the thing (the look shows them as states). */
const STATE_WORDS: Array<[RegExp, string]> = [
  [/^(burning|blazing|flaming|aflame|alight|ablaze|fiery)$/, "burning"],
  [/^(smouldering|smoldering|smoking|glowing-hot)$/, "smouldering"],
  [/^(singed|scorched|charred|burnt|burned|blackened|sooty|scalded|toasted)$/, "scorched"],
  [/^(wet|soaked|sodden|dripping|damp|drenched|soggy|waterlogged)$/, "wet"],
  [/^(frozen|icy|frosted|frosty|iced)$/, "frozen"],
  [/^(broken|smashed|shattered|cracked|bent|splintered|snapped|wrecked|ruined|dented)$/, "broken"],
  [/^(poisoned|poisonous|venomous|toxic|tainted)$/, "poisoned"],
  [/^(lit|lighted|glowing|shining|luminous|guttering|flickering)$/, "lit"],
  [/^(unlit|dark|cold|extinguished|dead-cold|snuffed)$/, "unlit"],
  [/^(dead|slain|lifeless)$/, "dead"],
  [/^(sleeping|asleep|dozing|snoring)$/, "asleep"],
  [/^(hidden|concealed)$/, "hidden"],
  [/^(oily|oiled|greasy|greased)$/, "oiled"],
  [/^(bloody|bloodied|bloodstained|blood-soaked|gory)$/, "bloodied"],
  [/^(rotten|rotting|mouldy|moldy|putrid)$/, "rotten"],
  [/^(spilled|spilt|upset)$/, "spilled"],
  [/^(overturned|toppled|knocked-over|tipped)$/, "overturned"],
  [/^(empty)$/, "empty"],
  [/^(full)$/, "full"],
  [/^(open)$/, "open"],
  [/^(closed|shut)$/, "closed"],
  [/^(locked|padlocked)$/, "locked"],
  [/^(barred|bolted)$/, "barred"],
  [/^(hanging|dangling|hanged)$/, "hanging"],
];

const COLOR_WORDS = new Set(["red", "crimson", "scarlet", "orange", "amber", "yellow", "gold", "golden", "gilt", "gilded", "green", "emerald", "blue", "azure", "navy", "teal", "cyan", "purple", "violet", "pink", "rose", "white", "ivory", "black", "ebony", "grey", "gray", "silver", "silvery", "brown", "tan", "copper", "bronze", "brass", "rusty", "rust", "pale", "dark", "tarred", "lavender", "lilac", "mauve", "magenta", "indigo", "ginger", "tawny", "russet", "ochre", "ashen"]);

const QUANTITY = /^(a|an|the|some|one|two|three|four|five|six|seven|eight|nine|ten|dozen|several|many|few|various|assorted|numerous|countless|both|all|each|every|another|other|more|this|that|these|those|his|her|their|its|my|your|our)$/;

const IRREGULAR: Record<string, string> = {
  mice: "mouse", geese: "goose", men: "man", women: "woman", children: "child", people: "person", feet: "foot", teeth: "tooth", oxen: "ox",
  leaves: "leaf", knives: "knife", wolves: "wolf", loaves: "loaf", shelves: "shelf", halves: "half", calves: "calf", thieves: "thief", wives: "wife",
  dice: "dice", glasses: "glasses", spectacles: "spectacles", stairs: "stairs", steps: "steps", trousers: "trousers", clothes: "clothes", cards: "cards",
  regulars: "regulars", sheep: "sheep", fish: "fish", deer: "deer", embers: "embers", ashes: "ashes", ash: "ash", bunting: "bunting", winnings: "winnings",
  boots: "boots", shoes: "shoes", robes: "robes", oars: "oar", traps: "trap", measures: "measure", pennies: "penny", ladies: "lady", berries: "berry",
  flies: "fly", cherries: "cherry", sausages: "sausage", tongs: "tongs", scissors: "scissors", shears: "shears", bellows: "bellows", gallows: "gallows",
  slops: "slops", dregs: "dregs", suds: "suds", goods: "goods", wares: "wares", news: "news", series: "series", species: "species", molasses: "molasses",
};

/** A simple singular for a noun ("pigeons" -> "pigeon", "benches" -> "bench", "pennies" -> "penny"). */
export function singular(word: string): string {
  if (IRREGULAR[word]) return IRREGULAR[word]!;
  if (word.length <= 3 || /(ss|us|is|ous)$/.test(word)) return word;
  if (/ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|xes|sses|zes)$/.test(word)) return word.slice(0, -2);
  if (/oes$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

const CLAUSE = /\s+(with|that|which|who|whose|marked|stamped|sewn|labelled|labeled|bearing|showing|depicting|announcing|advertising|proclaiming|holding|containing|from|behind|under|beneath|beside|near|by|on|upon|in|inside|at|for|belonging|to|over|against|left|lying|hung|where|while|as|going|coming|walking|running|sitting|standing|waiting|sleeping|playing|drinking|singing|dancing|watching|carrying|pushing|pulling|leaning|looking|circling|flying|swimming|perched|perching|roosting|nesting|clustered|gathered|huddled|crowded|piled|stacked|scattered|strewn|floating|drifting|rising|spreading|pooling)\b.*$/;

export function parseName(name: string): ParsedName {
  let s = name.toLowerCase().replace(/[“”"«»]/g, "").replace(/\(.*?\)/g, " ").replace(/[,;:].*$/, "").replace(/\s+/g, " ").trim();
  // "of" constructions first, before trailing clauses are cut ("a flock of pigeons in the elm").
  s = s.replace(/\s+and\s+.*$/, "");
  const words0 = s.split(" ").filter(w => !QUANTITY.test(w));
  s = words0.join(" ").replace(/\b[\w-]+'s\s+/g, "").replace(/\b[\w-]+s'\s+/g, "");
  let group: string | undefined, pile: string | undefined, surface: string | undefined, contents: string | undefined;
  const of = /^(.*?)\b([a-z-]+)\s+of\s+(.+)$/.exec(s);
  if (of) {
    const lead = of[1]!.trim(), noun = singular(of[2]!), rest = of[3]!.replace(CLAUSE, "").trim();
    const restWords = rest.split(" ").filter(w => !QUANTITY.test(w)).join(" ");
    if (GROUP.has(noun)) { group = noun; s = `${lead} ${restWords}`.trim(); }
    else if (PILE.has(noun)) { pile = noun; s = `${lead} ${restWords}`.trim(); }
    else if (SURFACE.has(noun)) { surface = noun; s = `${lead} ${restWords}`.trim(); }
    else if (VESSEL.has(noun)) { contents = restWords; s = `${lead} ${noun}`.trim(); }
    else if (PART.has(noun)) s = `${lead} ${restWords}`.trim();
    else s = `${lead} ${noun}`.trim(); // "the King of Cats": the king
  } else {
    s = s.replace(CLAUSE, "");
  }
  // "an oil slick", "a blood stain", "spilled gin": the surface word after (or the adjective before) the stuff.
  let words = s.split(" ").filter(Boolean);
  const last = words.at(-1) ?? "";
  // Not a pool: "a plunge pool", "the fish pool" are pools (what's in a pool comes after "of").
  if (!surface && words.length >= 2 && SURFACE.has(singular(last)) && singular(last) !== "pool") { surface = singular(last); words = words.slice(0, -1); }
  const states: string[] = [];
  const colors: string[] = [];
  const kept: string[] = [];
  words.forEach((w, i) => {
    const isHead = i === words.length - 1;
    const state = isHead ? undefined : STATE_WORDS.find(([re]) => re.test(w))?.[1];
    if (state) { states.push(state); return; }
    if (!isHead && COLOR_WORDS.has(w)) { colors.push(w); return; }
    kept.push(w);
  });
  if (states.includes("spilled") && !surface) surface = "spill";
  // The head noun is the last word; drop stray adjectives nobody draws ("old", "good", "disgruntled") from the key only when the rules know the rest.
  const rawHead = kept.at(-1) ?? words.at(-1) ?? s;
  const head = singular(rawHead);
  const plural = head !== rawHead || !!group || (!!pile && pile !== "pair");
  const phrase = [...kept.slice(0, -1), head].join(" ").trim();
  return {
    key: phrase || head, head, phrase: phrase || head, states: [...new Set(states)], colors: [...new Set(colors)], plural,
    ...(group ? { group } : {}), ...(pile ? { pile } : {}), ...(surface ? { surface } : {}), ...(contents ? { contents } : {}),
  };
}
