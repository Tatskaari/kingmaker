// Copied from the prototype's src/game/look/invent.ts at 44c6d4a, its model half: GLYPH_MENU, GLYPH_BY_NAME, MOTIONS and MATERIALS (39-62), InventRequest (98), INSTRUCTIONS, prompt, SCHEMA and LOOK_MODEL (105-145) and askLuna (151-172), as inventLooks: its call through the request's calls, its answer v2/shared/protocol/ai.ts's Invention. The palette's colour names (color.ts's PALETTE, by its keys) and the Nerd Font icons' names (glyphs.ts's NERD_CODES, by its keys) are the lists themselves, as at 44c6d4a: the look layer is the client's (client/look/), which the AI service doesn't import. No cache, queue or inventor to swap: the simulation keeps what's invented (look_invention, a name's look once) and asks for it (its inventLook job, town-design §3.7).

import { respondJson, type CallContext } from "../llm/openrouter.ts";
import type { Invention } from "../../shared/protocol/ai.ts";

/**
 * Looks for things the rules don't recognise. The GM invents freely ("a disgruntled swan", "the
 * Purveyor's grain cart in garlands", "a sackbut"), and a look has to come from somewhere: a small
 * Luna call (no reasoning) picks a glyph from a curated menu, a colour from the palette, a Nerd Font
 * icon if one fits, and how it moves. The simulation keeps the answer by the name's key, so it costs
 * once per kind of thing, ever; rendering never waits for it (the thing is drawn with a guess until
 * the answer lands, then with the answer).
 */

/** The palette's colour names (the client's client/look/color.ts PALETTE, by its keys). */
export const COLOR_NAMES: readonly string[] = [
  "crimson", "scarlet", "rust", "ember", "orange", "amber", "gold", "straw", "parchment", "cream", "tan", "oak", "walnut", "tar", "leather", "sacking",
  "leaf", "moss", "grass", "olive", "poison", "sage", "teal", "cyan", "sky", "azure", "navy", "ice", "water", "violet", "purple", "royal", "magenta",
  "pink", "lilac", "white", "bone", "silver", "pewter", "grey", "slate", "iron", "steel", "brass", "copper", "stone", "charcoal", "soot", "black",
  "flesh", "glass",
];

/** The Nerd Font icons the look layer draws, by their nf-md-* names (the client's client/look/glyphs.ts NERD_CODES, by its keys). */
export const NERD_NAMES: readonly string[] = [
  "account", "account_group", "anchor", "apple", "axe", "barley", "barrel", "basket", "bat", "bed", "bee", "beer", "bell", "bird", "bomb", "bone",
  "book", "book_open_variant", "bottle_tonic", "bottle_tonic_skull", "bottle_wine", "bow_arrow", "bowl", "bread_slice", "bridge", "broom", "bucket",
  "bug", "butterfly", "campfire", "candelabra_fire", "candle", "cards_playing", "castle", "cat", "cheese", "church", "clock", "cloud", "coffin",
  "corn", "cow", "cross", "crown", "cup", "cupcake", "desk", "diamond_stone", "dice_5", "dog_side", "door_closed", "door_closed_lock", "door_open",
  "dresser", "duck", "egg", "email", "emoticon_dead", "exclamation_thick", "eye", "feather", "fence", "fire", "fireplace", "fireplace_off", "fish",
  "flag", "flask_round_bottom", "flower", "flower_tulip", "food_apple", "food_drumstick", "gate", "ghost", "glass_mug_variant", "glass_wine",
  "glasses", "gold", "grass", "grave_stone", "hammer", "hand_saw", "hanger", "hat_fedora", "heart", "horse_variant", "human", "human_child", "kettle",
  "key", "knife", "ladder", "lamp", "leaf", "link_variant", "liquor", "lock", "mace", "magic_staff", "map", "mirror", "mushroom", "music_note",
  "necklace", "needle", "newspaper", "oil_lamp", "owl", "package_variant_closed", "pail", "paw", "pickaxe", "pig", "pine_tree", "pot", "pot_steam",
  "purse", "rabbit", "ring", "rodent", "sack", "sail_boat", "scale_balance", "script_text", "seat", "sheep", "shield", "shoe_formal", "shovel",
  "sign_text", "skull", "skull_crossbones", "smoke", "snail", "snake", "snowflake", "sofa_single", "spear", "spider", "spider_web", "sprout", "stairs",
  "sword", "table_furniture", "tea", "tent", "timer_sand", "torch", "tray", "tray_full", "treasure_chest", "tree", "trumpet", "turtle", "violin",
  "wardrobe", "water", "water_pump", "water_well", "waves", "window_closed_variant", "window_open_variant", "wizard_hat",
];

/**
 * The glyphs the model may choose from: by name (strict structured output won't take quotes and
 * odd characters in an enum, and names read better anyway), each with what it's for. "letter"
 * means a letter of the model's choosing, for creatures (the roguelike way).
 */
export const GLYPH_MENU: Array<[string, string, string]> = [
  ["person", "☻", "a person"], ["child", "☺", "a child"], ["royal", "♔", "royalty"], ["bird", "v", "a bird (flying or perched)"], ["fish", "α", "a fish"],
  ["swarm", "·", "insects, a swarm, specks"], ["tree", "♣", "a tree or bush"], ["pine", "♠", "a pine or conifer"], ["grass", "\"", "grass, straw, an amulet"],
  ["star", "*", "a flower, a gem, a spark, a star"], ["leaf", "'", "a leaf, a feather, a shard"], ["stick", "/", "a stick, branch, blade, club or staff"],
  ["pole", "|", "a pole, post or spear"], ["knife", "-", "a knife or dagger"], ["tool", "(", "a tool"], ["bow", "}", "a bow"], ["arrow", "↑", "an arrow"],
  ["cloth", "[", "clothes, cloth, armour"], ["hat", "ⁿ", "a hat"], ["boot", "⌡", "a boot or shoe"], ["chain", "∞", "spectacles, a chain"], ["ring", "=", "a ring"],
  ["money", "$", "money, coins"], ["key", "⌐", "a key"], ["bottle", "!", "a bottle, flask or potion"], ["jar", "ô", "a jar or jug"], ["cup", "ü", "a cup, mug or tankard"],
  ["bucket", "Ü", "a bucket, tub or basket"], ["pot", "ö", "a pot, kettle or cauldron"], ["barrel", "Ö", "a barrel, keg or cask"],
  ["round", "○", "a plate, bowl, wheel or hoop"], ["pebble", "•", "a small round thing, a stone, a ball"], ["boulder", "●", "a boulder, a big ball"],
  ["small", "°", "an egg, a watch, something small and light"], ["food", "%", "food, or remains"], ["papers", "≡", "papers, a book, a sign, a shelf"],
  ["music", "♪", "a musical instrument"], ["statue", "Ω", "a statue or bell"], ["brazier", "¥", "a brazier or candelabra"], ["candle", "¡", "a candle or torch"],
  ["lantern", "¤", "a lantern or lamp"], ["flame", "▲", "a fire, a tent, a peak"], ["machine", "☼", "a machine, a contraption, magic, the sun"],
  ["table", "π", "a table or desk"], ["chair", "╥", "a chair, stool or throne"], ["bench", "═", "a bench or beam"], ["plank", "▬", "a tray, plank, boat or coffin"],
  ["box", "■", "a box or crate"], ["sack", "δ", "a sack, bag or purse"], ["chest", "⌂", "a chest or trunk"], ["block", "▓", "a wardrobe, cupboard or big block"],
  ["pane", "▒", "a pane of glass, grain, a haze"], ["haze", "░", "smoke, steam, mist"], ["net", "#", "a net, web or grate"], ["coil", "§", "rope, a coil"],
  ["liquid", "~", "a liquid, an eel, a worm"], ["waves", "≈", "water, waves"], ["door", "+", "a door or gate"], ["hatch", "□", "a hatch or trapdoor"],
  ["arch", "∩", "a gravestone or arch"], ["ladder", "╫", "a ladder"], ["well", "{", "a fountain or well"], ["hook", "¬", "a hook or bracket"],
  ["gibbet", "╤", "a hoist, gibbet or crane"], ["dice", "◘", "dice, a block"], ["cart", "æ", "a cart or wagon"], ["bomb", "ò", "a bomb"],
  ["letter", "", "a letter (give it in \"letter\"): creatures and monsters, the first letter of what they are, lowercase if small"],
];
const GLYPH_BY_NAME = new Map(GLYPH_MENU.map(([name, glyph]) => [name, glyph]));
const MOTIONS = ["still", "flicker", "shimmer", "sway", "flutter", "pulse", "drift", "swarm", "drip", "bob"];
const MATERIALS = ["none", "cloth", "paper", "rope", "glass", "ice", "crystal", "wood", "bone", "leather", "stone", "iron", "steel", "brass", "silver", "flesh", "liquid"];

/** A thing to invent a look for: its key (the answer's), its name, and what kind of thing it is. */
export interface InventRequest { key: string; name: string; kind?: string }

const INSTRUCTIONS = [
  "You decide how things look on a Caves of Qud-style ASCII map, in a comic fantasy game (Pratchett, Monty Python). A game master has just invented these things; each needs a look a player can read at a glance.",
  "For each thing choose:",
  "- glyph: the name of a glyph from the menu, the shape that reads best. For a creature or monster, \"letter\", with the letter in \"letter\": the first letter of what it is (lowercase if small, uppercase if big). Otherwise letter is \"\".",
  "- nerd: a Nerd Font icon name from the list if one fits well, else \"none\".",
  "- color: a palette name. The colour of what it's made of, or its mood. Red and orange mean fire; blue means water; green means plants or poison; violet means magic.",
  "- motion: \"still\" unless it lives or burns: flutter (birds, bats), swarm (insects), sway (plants, hanging things, flags), shimmer (liquids, glass, gems, metal that glints), flicker (flames), pulse (magic, embers), drift (smoke, steam, mist), bob (small animals), drip (wet things).",
  "- light: true only if it gives off light. being: true for creatures and people. group: true if it is many (a flock, a crowd, a swarm). material: what it's mostly made of.",
  "Answer every key you're given, once each.",
].join("\n");

function prompt(items: InventRequest[]): string {
  const menu = GLYPH_MENU.map(([name, g, what]) => `${name}${g ? ` (${g})` : ""}: ${what}`).join("\n");
  const things = items.map(i => `- key "${i.key}": ${i.name}${i.kind ? ` (${i.kind})` : ""}`).join("\n");
  return `Glyph menu:\n${menu}\n\nThings:\n${things}`;
}

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["looks"],
  properties: {
    looks: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["key", "glyph", "letter", "nerd", "color", "motion", "light", "being", "group", "material"],
        properties: {
          key: { type: "string" },
          glyph: { type: "string", enum: GLYPH_MENU.map(([name]) => name) },
          letter: { type: "string" },
          nerd: { type: "string", enum: ["none", ...NERD_NAMES] },
          color: { type: "string", enum: COLOR_NAMES },
          motion: { type: "string", enum: MOTIONS },
          light: { type: "boolean" }, being: { type: "boolean" }, group: { type: "boolean" },
          material: { type: "string", enum: MATERIALS },
        },
      },
    },
  },
};

export const LOOK_MODEL = "openai/gpt-6-luna";

/**
 * Luna's looks for a batch of things (askLuna), one call, through the request's calls: a key the
 * model left out, or answered for something it wasn't asked, has none.
 */
export async function inventLooks(items: InventRequest[], calls: CallContext): Promise<{ looks: Record<string, Invention>; costUsd: number }> {
  type Answer = { key: string; glyph: string; letter: string; nerd: string; color: string; motion: string; light: boolean; being: boolean; group: boolean; material: string };
  const result = await respondJson<{ looks: Answer[] }>({
    model: LOOK_MODEL, effort: "none", operation: "look.invent", instructions: INSTRUCTIONS,
    input: [{ role: "user", content: prompt(items) }],
    json: { name: "looks", schema: SCHEMA }, maxOutputTokens: 120 * items.length + 200,
    calls,
  });
  const out: Record<string, Invention> = {};
  for (const a of result.looks ?? []) {
    if (!items.some(i => i.key === a.key)) continue;
    const letter = /^[A-Za-z]$/.test(a.letter ?? "") ? a.letter : undefined;
    out[a.key] = {
      glyph: a.glyph === "letter" ? letter ?? "?" : GLYPH_BY_NAME.get(a.glyph) || letter || "?",
      ...(a.nerd && a.nerd !== "none" && NERD_NAMES.includes(a.nerd) ? { nerd: a.nerd } : {}),
      color: COLOR_NAMES.includes(a.color) ? a.color : "grey",
      motion: MOTIONS.includes(a.motion) ? a.motion : "still",
      light: !!a.light, being: !!a.being, group: !!a.group,
      ...(a.material && a.material !== "none" ? { material: a.material } : {}),
    };
  }
  return { looks: out, costUsd: result._meta.costUsd };
}
