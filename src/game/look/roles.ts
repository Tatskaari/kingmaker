import type { Material, Size } from "../../world/scene-world.ts";
import { PALETTE, type FlameName } from "./color.ts";
import { nerd, type Glyph } from "./glyphs.ts";
import { singular, type ParsedName } from "./names.ts";

/**
 * What things are, for drawing: a role per kind of thing (a table, a barrel, a fire, a pigeon),
 * with its glyph in each set, its colours, how it moves when idle, whether it casts light, and how
 * big it is on the ground. The rules match the head noun first ("a tea tray": tray), then the whole
 * phrase, then structural tags (door, sign, body, light), then the kind. Specific before general.
 *
 * Conventions (roguelike tradition, kept because players read them instantly):
 *   @ the player · letters for named people and creatures (lowercase: children, small beasts) ·
 *   ☻ ☺ anonymous adults and children · v birds · % food and remains · ! bottles · $ money ·
 *   / long things (sticks, swords, branches) · [ clothes · ≡ writing (papers, signs) · + ' doors ·
 *   ▲ flames · ~ ≈ liquids · ♣ ♠ trees · Θ Ö ö ü round vessels · ■ δ boxes and sacks.
 * Colour carries meaning (Brogue, Cogmind): fire is red-orange-yellow and always moving, water is
 * blue and shimmering, magic is violet, poison green, metal grey; people are bright, things muted.
 */

export type Motion = "still" | "flicker" | "shimmer" | "sway" | "flutter" | "pulse" | "drift" | "swarm" | "drip" | "bob";
export type Stamp = "top" | "bench" | "block" | "canopy" | "hearth" | "hull" | "stack" | "pool" | "line" | "bed";

export interface LightSpec {
  /** Feet. */
  radius: number;
  color: string;
  intensity?: number;
  /** 0 steady, 1 wild (torches ~0.3, lanterns ~0.1). */
  flicker?: number;
  /** "always": a fire or a lamp that's simply on; "lit": only with the lit (or burning) state. */
  when: "always" | "lit";
}

export interface Role {
  id: string;
  glyph: Glyph;
  fg: string;
  bg?: string;
  bold?: boolean;
  /** Colour from the thing's material (a table of iron is grey) rather than fg. */
  byMaterial?: boolean;
  motion?: Motion;
  light?: LightSpec;
  /** What it's made of when the world didn't say (or said wrong: the stage manager makes ale of wood). */
  material?: Material;
  being?: boolean;
  /** Plural by nature (a crowd, the regulars, a swarm): drawn as several. */
  group?: boolean;
  flame?: FlameName;
  /** Footprint in feet (w, h) at size "large"; other sizes scale it. */
  footprint?: [number, number];
  stamp?: Stamp;
  /** Hangs above people's heads (eel traps, bunting): drawn dim and out of the way. */
  overhead?: boolean;
  /** States it has by nature (a hearth fire is lit). */
  states?: string[];
  /** Things that are liquid surfaces when they lie on the ground ("ale" spilled is a puddle). */
  liquid?: string;
}

type Opts = Omit<Role, "id" | "glyph" | "fg">;

interface Rule { id: string; head?: RegExp; phrase?: RegExp; role: Role }

const RULES: Rule[] = [];
const P = PALETTE;

/** Add a rule: words match the head noun (singular), and optionally the whole phrase. */
function r(id: string, words: string, ascii: string, fg: string, opts: Opts & { nerd?: string; plain?: string; phrase?: string } = {}): void {
  const { nerd: nerdName, plain, phrase, ...rest } = opts;
  const glyph: Glyph = { ascii, ...(nerdName && nerd(nerdName) ? { nerd: nerd(nerdName)! } : {}), ...(plain ? { plain } : {}) };
  RULES.push({ id, ...(words ? { head: new RegExp(`^(${words})$`) } : {}), ...(phrase ? { phrase: new RegExp(`\\b(${phrase})\\b`) } : {}), role: { id, glyph, fg, ...rest } });
}

// ---------------------------------------------------------------------------------------------
// Fire and light. (Before furniture: "a fire" isn't a fireplace, "a torch" isn't a stick.)
const FIRE_LIGHT: LightSpec = { radius: 22, color: "#ff9a3c", intensity: 1.15, flicker: 0.35, when: "always" };
r("fire", "fire|bonfire|campfire|blaze|flame|flames|inferno|pyre|conflagration|firepit|fire-pit", "▲", P.orange, { nerd: "fire", plain: "^", motion: "flicker", light: FIRE_LIGHT, states: ["lit"], stamp: "hearth", footprint: [5, 4] });
r("hearth", "hearth|fireplace|grate|stove|oven|forge|kiln|range|chimney-piece|inglenook", "▲", P.orange, { nerd: "fireplace", plain: "^", motion: "flicker", light: { ...FIRE_LIGHT, when: "lit" }, stamp: "hearth", footprint: [6, 4], material: "stone" });
r("brazier", "brazier|firebasket|fire-basket|cresset|firebowl", "¥", P.iron, { nerd: "campfire", plain: "Y", motion: "flicker", light: { radius: 18, color: "#ffa040", intensity: 1.05, flicker: 0.3, when: "lit" }, material: "iron" });
r("torch", "torch|firebrand|brand|link|flambeau|rushlight", "¡", P.walnut, { nerd: "torch", plain: "i", motion: "flicker", light: { radius: 15, color: "#ffa448", intensity: 1, flicker: 0.32, when: "lit" }, material: "wood" });
r("lamp-post", "", "¤", P.brass, { nerd: "oil_lamp", plain: "*", phrase: "lamp post|street lamp|lamp-post|lamppost", motion: "flicker", light: { radius: 18, color: "#ffc070", intensity: 1, flicker: 0.08, when: "lit" }, material: "iron" });
r("lantern", "lantern|lamp|lamplight|lamp-post|lamppost|streetlamp|nightlight|storm-lantern", "¤", P.brass, { nerd: "oil_lamp", plain: "*", motion: "flicker", light: { radius: 16, color: "#ffc070", intensity: 0.95, flicker: 0.1, when: "lit" }, material: "brass" });
r("candle", "candle|candle-end|taper|candlestick|tallow|nightlight|wick", "¡", P.cream, { nerd: "candle", plain: "i", motion: "flicker", light: { radius: 8, color: "#ffd28a", intensity: 0.8, flicker: 0.18, when: "lit" }, material: "cloth" });
r("candelabra", "candelabra|candelabrum|chandelier|sconce", "¥", P.brass, { nerd: "candelabra_fire", plain: "Y", motion: "flicker", light: { radius: 14, color: "#ffd28a", intensity: 0.95, flicker: 0.15, when: "lit" }, material: "brass" });
r("embers", "ember|embers|coal|coals|cinder|cinders", "∙", P.ember, { plain: ".", motion: "pulse", light: { radius: 5, color: "#ff5a1a", intensity: 0.6, flicker: 0.2, when: "always" } });
r("ash", "ash|ashes|soot", "∙", P.grey, { plain: "." });
r("spark", "spark|sparks|sparkle|glint", "*", "#ffe680", { motion: "flicker", light: { radius: 3, color: "#ffd060", intensity: 0.5, when: "always" } });
r("smoke", "smoke|fume|fumes|smog|reek", "░", "#8a8690", { nerd: "smoke", plain: ".", motion: "drift" });
r("steam", "steam|vapour|vapor", "░", "#dfe6ee", { plain: ".", motion: "drift" });
r("mist", "mist|fog|haze|miasma|cloud", "░", "#b8c4d0", { nerd: "cloud", plain: ".", motion: "drift" });
r("explosion", "explosion|blast|fireball|flash", "☼", "#fff0a0", { plain: "*", motion: "flicker", light: { radius: 25, color: "#ffd080", intensity: 1.5, flicker: 0.5, when: "always" } });

// People and beings. (Named cast members have their own looks: see people.ts.)
r("crowd", "crowd|regulars|gang|mob|throng|townsfolk|porters|bargees|onlookers|spectators|delegation|delegations|valets|servants|drinkers|patrons|customers|punters|rabble|bystanders|congregation|audience|guests|courtiers|militia|bruisers|thugs|sailors|dockers|lightermen|labourers|workers|beggars|pilgrims", "☻", "#b8ad9c", { nerd: "account_group", plain: "p", being: true, group: true });
r("child", "child|kid|boy|girl|urchin|lad|lass|brat|youngster|toddler|baby|infant|waif|scamp|guttersnipe|page|pageboy|squire|apprentice|footboy", "☺", "#e8c890", { nerd: "human_child", plain: "c", being: true });
r("guard", "guard|watchman|watch|soldier|sergeant|corporal|constable|marshal|sentry|guardsman|captain|officer|bailiff|warden|halberdier|knight", "☻", "#8fa8c8", { nerd: "shield", plain: "g", being: true });
r("royal", "king|queen|prince|princess|monarch|majesty|duke|duchess|lord|lady|baron|baroness|count|countess|earl", "♔", P.gold, { nerd: "crown", plain: "K", being: true, bold: true });
r("person", "person|man|woman|fellow|figure|stranger|traveller|traveler|merchant|clerk|landlady|landlord|innkeeper|barmaid|barman|bartender|tapster|porter|bargee|lighterman|docker|thief|cutpurse|beggar|priest|monk|nun|wizard|witch|mage|sorcerer|scholar|cook|maid|servant|valet|butler|herald|minstrel|bard|drunk|drunkard|sailor|fisherman|fishwife|farmer|labourer|smith|blacksmith|carter|ostler|groom|footman|steward|purveyor|official|noble|nobleman|gentleman|gent|hag|crone|old-timer|gossip|regular|patron|customer|thug|bruiser|ruffian|villain|assassin|rogue|bandit|brigand|cultist|pilgrim|healer|physician|surgeon|apothecary|alchemist|tailor|seamstress|washerwoman|lamplighter|watchmaker|baker|butcher|brewer|vintner|miller|chandler|cooper|mason|carpenter|jeweller|banker|moneylender|lawyer|magistrate|judge|jailer|executioner|hangman|gravedigger|undertaker|ratcatcher|chimney-sweep|sweep|crier", "☻", "#c8b89a", { nerd: "account", plain: "p", being: true });
r("body", "body|corpse|cadaver|carcass|remains|dead|deceased|stiff|skeleton-remains", "%", "#b8b0a0", { nerd: "emoticon_dead", plain: "%", material: "flesh" });
r("ghost", "ghost|spirit|spectre|specter|wraith|phantom|shade|poltergeist|apparition|banshee", "G", "#c8e0ff", { nerd: "ghost", being: true, motion: "pulse", bold: true });
r("skeleton", "skeleton|skull|bones|bone", "Z", P.bone, { nerd: "skull", being: true });

// Creatures: letters, mostly (the roguelike way), and v for birds in flight.
r("pigeon", "pigeon|dove|rock-dove", "v", "#a8b0c8", { nerd: "bird", being: true, motion: "flutter" });
r("crow", "crow|raven|rook|jackdaw|magpie|blackbird|starling|crowd-of-crows", "v", "#4a4a5a", { nerd: "bird", being: true, motion: "flutter", bold: true });
r("gull", "gull|seagull|tern|albatross|heron|egret|stork|crane-bird", "v", P.white, { nerd: "bird", being: true, motion: "flutter" });
r("bird", "bird|sparrow|finch|robin|wren|thrush|lark|songbird|canary|parrot|songster|tit|swallow|swift|martin|hawk|falcon|kestrel|eagle|vulture|buzzard|kite", "v", "#c8a070", { nerd: "bird", being: true, motion: "flutter" });
r("owl", "owl|owlet", "v", "#b89868", { nerd: "owl", being: true, motion: "bob" });
r("fowl", "duck|duckling|goose|gosling|swan|cygnet|chicken|hen|rooster|cockerel|cock|chick|turkey|peacock|pheasant|partridge|grouse|quail", "v", "#e8e0c8", { nerd: "duck", being: true, motion: "bob" });
r("dog", "dog|hound|mastiff|cur|mutt|puppy|pup|terrier|wolfhound|lurcher|spaniel|bloodhound|whippet|greyhound", "d", "#c08a5a", { nerd: "dog_side", being: true, motion: "bob" });
r("wolf", "wolf|jackal|coyote|hyena", "d", "#9a9a9a", { nerd: "paw", being: true, bold: true });
r("fox", "fox|vixen", "d", "#e07a3a", { nerd: "paw", being: true });
r("cat", "cat|kitten|tom|tomcat|mouser|moggy|lynx|wildcat", "f", "#d8a050", { nerd: "cat", being: true, motion: "bob" });
r("rat", "rat|mouse|rodent|vole|shrew|ferret|weasel|stoat|hamster|squirrel|mole", "r", "#a08870", { nerd: "rodent", being: true, motion: "bob" });
r("rabbit", "rabbit|hare|bunny|coney", "r", "#c8b8a0", { nerd: "rabbit", being: true, motion: "bob" });
r("horse", "horse|pony|mule|donkey|nag|mare|stallion|foal|colt|steed|charger|cob-horse|ass", "u", "#a07850", { nerd: "horse_variant", being: true });
r("cattle", "cow|ox|bull|bullock|calf|heifer|steer|yak", "q", "#8a6a50", { nerd: "cow", being: true });
r("sheep", "sheep|lamb|ram|ewe|goat|kid-goat|billy-goat|nanny-goat", "q", "#e8e4d8", { nerd: "sheep", being: true });
r("pig", "pig|hog|boar|sow|piglet|swine", "q", "#e0a0a0", { nerd: "pig", being: true });
r("fish", "fish|carp|pike|trout|salmon|cod|herring|perch|minnow|tench|bream|mackerel|sprat|sturgeon", "α", "#7fb0c0", { nerd: "fish", plain: "f", being: true, motion: "bob" });
r("eel", "eel|lamprey|elver", "~", "#7a8a50", { nerd: "snake", plain: "~", being: true, motion: "sway" });
r("snake", "snake|serpent|adder|viper|asp|python|cobra|worm-snake", "S", "#6a9a3a", { nerd: "snake", being: true, motion: "sway" });
r("frog", "frog|toad|newt|salamander|lizard|gecko|tortoise|turtle", "f", "#7aa04a", { nerd: "turtle", being: true });
r("spider", "spider|tarantula|scorpion|centipede|millipede", "s", "#6a5a4a", { nerd: "spider", being: true });
r("insect", "bee|wasp|hornet|fly|midge|gnat|mosquito|moth|butterfly|beetle|bug|cockroach|roach|louse|flea|ant|termite|locust|cricket|grasshopper|dragonfly|insect|maggot|grub", "·", "#e0c040", { nerd: "bee", plain: ".", being: true, motion: "swarm" });
r("swarm", "swarm|cloud-of-flies", "·", "#d0b040", { nerd: "bee", plain: ".", being: true, motion: "swarm", group: true });
r("bat", "bat|vampire-bat", "B", "#6a5a50", { nerd: "bat", being: true, motion: "flutter" });
r("snail", "snail|slug|leech|worm|earthworm", "~", "#c8a8a0", { nerd: "snail", being: true });
r("goblin", "goblin|hobgoblin|gremlin|imp|kobold|gnome|sprite|pixie|fairy|faerie|brownie|boggart|redcap", "g", "#7ab84a", { being: true, bold: true });
r("orc", "orc|ogre|troll|giant|bugbear|gnoll|cyclops|hill-giant", "O", "#8a9a5a", { being: true, bold: true });
r("dragon", "dragon|wyvern|drake|wyrm|basilisk|cockatrice|griffin|gryphon|manticore|chimera|hydra", "D", "#e04a2a", { being: true, bold: true });
r("undead", "zombie|ghoul|mummy|lich|vampire|revenant|draugr|wight", "Z", "#9ab08a", { nerd: "skull", being: true, bold: true });
r("horror", "demon|devil|fiend|horror|abomination|monster|beast|creature|thing|elemental|golem|ooze|slime|jelly|cube", "&", "#c05ac0", { being: true, bold: true });

// Food and drink. (Drinks are servings: a tankard of it, unless it's spilled.)
r("ale", "ale|beer|stout|porter|mead|cider|perry|lager|bitter|small-beer|grog", "ü", P.amber, { nerd: "glass_mug_variant", plain: "u", motion: "shimmer", material: "liquid", liquid: "ale" });
r("wine", "wine|claret|sack|sherry|port|madeira|hock|burgundy|vinegar", "!", "#9a2040", { nerd: "glass_wine", motion: "shimmer", material: "liquid", liquid: "wine" });
r("spirits", "gin|brandy|whisky|whiskey|rum|vodka|spirits|liquor|schnapps|absinthe|moonshine|hooch|poteen|aquavit|cordial|tincture|elixir|potion|tonic|draught", "!", "#cfe0d8", { nerd: "liquor", motion: "shimmer", material: "liquid", liquid: "spirits" });
r("tea", "tea|tisane|infusion|coffee|cocoa|chocolate|broth-cup", "ü", "#c8803c", { nerd: "tea", plain: "u", material: "liquid", liquid: "tea" });
r("milk", "milk|cream|whey|buttermilk", "ü", P.white, { nerd: "cup", plain: "u", material: "liquid", liquid: "milk" });
r("water", "water|rainwater|seawater|brine", "~", P.water, { nerd: "water", motion: "shimmer", material: "liquid", liquid: "water" });
r("oil", "oil|lamp-oil|grease|tallow-fat|pitch|naphtha", "~", "#3a3428", { nerd: "water", motion: "shimmer", material: "liquid", liquid: "oil" });
r("blood", "blood|gore|ichor", "~", "#8a1018", { plain: "~", material: "liquid", liquid: "blood" });
r("slops", "slops|slop|swill|dregs|sewage|bilge|filth|dishwater|piss|vomit", "~", "#7a6a4a", { material: "liquid", liquid: "slops" });
r("honey", "honey|treacle|syrup|molasses|jam", "~", P.amber, { material: "liquid", liquid: "honey" });
r("ink", "ink|dye", "~", "#2a2a4a", { material: "liquid", liquid: "ink" });
r("stew", "stew|soup|porridge|broth|gruel|pottage|chowder|curry|hotpot", "ö", "#a8784a", { nerd: "pot_steam", plain: "o", motion: "drift", material: "iron" });
r("bread", "bread|loaf|roll-of-bread|bun|biscuit|shortbread|cake|scone|muffin|pastry|tart|pie|pasty|crust|cracker|wafer|bannock|oatcake|flatbread|gingerbread|cupcake|bun-loaf", "%", "#d8b070", { nerd: "bread_slice", plain: "%" });
r("cheese", "cheese|curd|butter", "%", "#f0d060", { nerd: "cheese", plain: "%" });
r("fruit", "apple|pear|plum|orange|lemon|cherry|berry|grape|grapes|fig|peach|quince|fruit|turnip|onion|cabbage|carrot|leek|potato|vegetable|radish|marrow|pumpkin|mushroom|toadstool|nut|walnut|chestnut|acorn", "%", "#c84a3a", { nerd: "food_apple", plain: "%" });
r("meat", "meat|ham|bacon|sausage|chop|steak|joint|haunch|pork|beef|mutton|venison|chicken-leg|drumstick|pie-meat|kipper|eel-pie|tripe", "%", "#c87060", { nerd: "food_drumstick", plain: "%" });
r("egg", "egg|eggs", "°", P.white, { nerd: "egg", plain: "o" });

// Money and valuables.
r("coins", "coin|coins|penny|pennies|crown|crowns|shilling|sovereign|groat|copper|coppers|farthing|florin|guinea|noble-coin|ducat|doubloon|money|cash|winnings|purse-money|change|silver-penny|heron-penny|takings|fee|bribe|wages|tip", "$", P.gold, { nerd: "gold", plain: "$", byMaterial: false, motion: "shimmer" });
r("ring", "ring|signet|band", "=", P.gold, { nerd: "ring", motion: "shimmer" });
r("necklace", "necklace|amulet|locket|pendant|chain-of-office|torc|brooch|medallion|medal|badge|seal|token|charm|talisman", "\"", P.gold, { nerd: "necklace", motion: "shimmer" });
r("gem", "gem|jewel|diamond|ruby|emerald|sapphire|pearl|opal|crystal|amethyst|topaz|garnet", "*", "#7fe0ff", { nerd: "diamond_stone", motion: "shimmer", bold: true });
r("key", "key|keys|skeleton-key", "⌐", P.brass, { nerd: "key", plain: "-" });
r("crown-regalia", "circlet|diadem|tiara|coronet|regalia-crown", "♔", P.gold, { nerd: "crown", plain: "W", motion: "shimmer" });

// Writing and games.
r("ledger", "book|tome|ledger|roll|register|almanac|grimoire|codex|journal|diary|notebook|logbook|account-book|bible|prayer-book|hymnal|volume", "≡", "#a0603a", { nerd: "book_open_variant", plain: "=" });
r("paper", "page|letter|note|scroll|paper|papers|document|deed|warrant|map|pamphlet|broadsheet|notice-paper|receipt|bill|invoice|ticket|leaflet|parchment|vellum|chit|ious|iou|confession|will|contract|charter|petition|list|manifest|tally|writ|summons", "≡", P.parchment, { nerd: "script_text", plain: "=" });
r("sign", "sign|board|noticeboard|notice|placard|poster|plaque|signboard|signpost|banner-sign", "≡", "#2a2018", { nerd: "sign_text", plain: "=", bg: "#8a6a42" });
r("cards", "cards|card|deck|pack-of-cards|tarot|hand", "♠", "#f0ece0", { nerd: "cards_playing", plain: "*" });
r("dice", "dice|die|knucklebones|bones-dice", "◘", P.bone, { nerd: "dice_5", plain: "#" });
r("chessboard", "chessboard|board-game|draughts|backgammon", "▒", P.bone, {});

// Weapons and tools.
r("sword", "sword|blade|sabre|saber|rapier|cutlass|scimitar|longsword|broadsword|falchion|claymore|sword-cane|swordstick|smallsword", "/", P.steel, { nerd: "sword", bold: true, material: "steel" });
r("dagger", "dagger|knife|dirk|stiletto|shiv|poniard|cleaver|razor|scalpel|letter-opener", "-", P.steel, { nerd: "knife", bold: true, material: "steel" });
r("club", "club|cudgel|cosh|bludgeon|truncheon|blackjack|staff|stick|cane|walking-stick|rod|shillelagh|quarterstaff|bat|baton|crook|mace|flail|morningstar|maul", "/", P.walnut, { nerd: "mace", material: "wood" });
r("wand", "wand|sceptre|scepter|magic-staff", "/", P.violet, { nerd: "magic_staff", motion: "pulse", material: "wood" });
r("axe", "axe|hatchet|tomahawk|halberd|poleaxe|billhook|bill|scythe|sickle", "/", P.steel, { nerd: "axe", material: "steel" });
r("spear", "spear|pike|lance|javelin|trident|harpoon|boathook|gaff|pitchfork|fork", "|", P.walnut, { nerd: "spear", material: "wood" });
r("bow", "bow|longbow|shortbow|crossbow|sling", "}", P.oak, { nerd: "bow_arrow", material: "wood" });
r("arrow", "arrow|arrows|bolt|quarrel|dart|darts", "↑", P.tan, { nerd: "bow_arrow", plain: "^" });
r("shield", "shield|buckler|targe", "[", P.steel, { nerd: "shield", material: "steel" });
r("armour", "armour|armor|breastplate|mail|hauberk|helmet|helm|gauntlet|gauntlets|greaves|cuirass", "[", P.steel, { nerd: "shield", material: "steel" });
r("hammer", "hammer|mallet|sledgehammer|gavel", "(", P.iron, { nerd: "hammer", material: "iron" });
r("tool", "tool|tools|saw|chisel|crowbar|jemmy|pliers|tongs|bellows|awl|file|plane|drill|auger|spanner|wrench|lever|pick|pickaxe|mattock|hoe|rake|trowel|spade|shovel|scissors|shears|needle|pin|thimble|hook|grapple|grappling-hook|lockpick|lockpicks|pick-lock|tinderbox|flint|whetstone|anvil", "(", P.iron, { nerd: "hammer", material: "iron" });
r("broom", "broom|brush|mop|besom|duster|feather-duster", "(", P.straw, { nerd: "broom", material: "wood" });

// Rope, chains, nets.
r("rope", "rope|cord|line|noose|lasso|cable|hawser|twine|string|halter|lead|leash|tether|lanyard|rigging", "§", "#c8a878", { plain: "&", material: "rope" });
r("chain", "chain|chains|manacle|manacles|shackle|shackles|fetter|fetters|irons", "∞", P.iron, { nerd: "link_variant", plain: "8", material: "iron" });
r("net", "net|nets|trap|traps|snare|snares|eel-trap|lobster-pot|creel|weir", "#", "#8a7a5a", { plain: "#", material: "rope" });

// Furniture.
r("hull-bar", "", "▬", "#4a4038", { phrase: "skiff-hull|upturned skiff|upturned boat|boat-hull|hull", plain: "=", footprint: [12, 3], stamp: "hull", material: "wood", bold: true });
r("table", "table|desk|counter|workbench|bench-table|trestle|bar|sideboard|lectern|altar|board-table|dresser-table|card-table|tally-desk|bureau|escritoire|stall", "π", P.oak, { nerd: "table_furniture", plain: "T", byMaterial: true, footprint: [8, 3], stamp: "top" });
r("armchair", "armchair|throne|chair-of-state|settle|sofa|couch|chaise|wingchair|seat-of-honour", "╥", "#b07a3a", { nerd: "sofa_single", plain: "h", byMaterial: true, bold: true });
r("chair", "chair|stool|seat|pew-chair|rocking-chair|footstool|cushion|hassock|ottoman", "╥", P.oak, { nerd: "seat", plain: "h", byMaterial: true });
r("bench", "bench|pew|form", "═", "#8a6038", { plain: "=", byMaterial: true, footprint: [8, 1.5], stamp: "bench" });
r("bed", "bed|cot|bunk|hammock|pallet|mattress|cradle|berth|four-poster|truckle", "Θ", "#a85a5a", { nerd: "bed", plain: "0", footprint: [4, 7], stamp: "bed" });
r("wardrobe", "wardrobe|cupboard|cabinet|armoire|closet|press|dresser|chest-of-drawers|tallboy|bookcase|shelf|shelves|rack|cabinetry|dresser-unit", "▓", "#5e3e24", { nerd: "wardrobe", plain: "#", byMaterial: false, footprint: [6, 2.5], stamp: "block" });
r("chest", "chest|trunk|coffer|strongbox|footlocker|casket|lockbox|ark|kist|safe|money-box|cashbox|reliquary", "⌂", "#b0803a", { nerd: "treasure_chest", plain: "=", material: "wood" });
r("crate", "crate|box|case|package|parcel|packing-case|tea-chest|coffin-box|bale|bundle", "■", "#a07a4a", { nerd: "package_variant_closed", plain: "#", byMaterial: true });
r("sack", "sack|bag|satchel|pouch|knapsack|pack|rucksack|haversack|purse|sporran|valise|portmanteau|holdall|saddlebag|grain-sack", "δ", P.sacking, { nerd: "sack", plain: "s", byMaterial: true });
r("grain", "grain|wheat|barley|oats|rye|corn|flour|meal|malt|chaff|seed|seeds|hay|straw|fodder|haystack|hay-bale|stack|stacks|sheaf|sheaves", "▒", P.straw, { nerd: "barley", plain: ":", footprint: [8, 6], stamp: "stack" });
r("barrel", "barrel|keg|cask|tun|vat|butt|hogshead|firkin|puncheon|rain-barrel|water-butt|drum", "Ö", "#9a6a3a", { nerd: "barrel", plain: "O", byMaterial: true });
r("bucket", "bucket|pail|tub|trough|basin|washtub|bathtub|bath|cistern|font", "Ü", P.walnut, { nerd: "bucket", plain: "U", byMaterial: true });
r("basket", "basket|hamper|creel-basket|pannier|trug|punnet|crib|manger", "Ü", "#c8a060", { nerd: "basket", plain: "U" });
r("pot", "pot|pots|kettle|cauldron|pan|skillet|saucepan|stockpot|wok|griddle|crock|stewpot", "ö", P.iron, { nerd: "pot", plain: "o", material: "iron" });
r("teapot", "teapot|coffeepot|samovar|urn|tea-urn", "ö", P.silver, { nerd: "kettle", plain: "o", material: "silver" });
r("jar", "jar|jug|pitcher|ewer|carafe|decanter|amphora|urn-jar|pickle-jar|flagon-jar|honeypot|demijohn|bottle-jar|pot-jar", "ô", "#9fc8c0", { nerd: "bottle_tonic", plain: "o", material: "glass" });
r("bottle", "bottle|flask|vial|phial|flagon|wineskin|skin|canteen|hip-flask|ampoule|cruet", "!", "#7fb8a0", { nerd: "bottle_wine", material: "glass" });
r("cup", "cup|mug|tankard|stein|goblet|chalice|beaker|teacup|tumbler|glass|horn|measure|measures|noggin|quaich|bowl-cup", "ü", P.pewter, { nerd: "cup", plain: "u", byMaterial: true });
r("tray", "tray|platter|salver|charger|trencher|tea-tray|serving-tray", "▬", P.silver, { nerd: "tray_full", plain: "=", material: "silver", bold: true });
r("plate", "plate|dish|bowl|saucer|porringer|tureen|ladle|spoon|fork-cutlery|cutlery|knife-and-fork|crockery|china", "○", "#e8e4d8", { nerd: "bowl", plain: "o" });
r("mirror", "mirror|looking-glass|cheval-glass|pier-glass", "║", "#c8e0f0", { nerd: "mirror", plain: "|", material: "glass", motion: "shimmer" });
r("clock", "clock|watch|pocket-watch|timepiece|hourglass|sundial|chronometer", "°", P.gold, { nerd: "clock", plain: "o" });
r("instrument", "lute|guitar|fiddle|violin|harp|drum|flute|pipe|pipes|bagpipes|whistle|horn|trumpet|bugle|lyre|mandolin|hurdy-gurdy|accordion|recorder|tambourine|cymbal|cymbals|harpsichord|organ", "♪", "#e0c080", { nerd: "music_note", plain: "d" });
r("bell", "bell|gong|chime|handbell", "Ω", P.brass, { nerd: "bell", plain: "&" });
r("statue", "statue|idol|bust|effigy|figurine|carving|gargoyle|monument|obelisk|cairn", "Ω", P.stone, { plain: "&" });
r("well", "well|fountain|pump|spring|cistern-well|horse-trough|water-trough|wellhead", "{", P.azure, { nerd: "water_well", plain: "{", motion: "shimmer" });
r("ladder", "ladder|stepladder|rope-ladder", "╫", P.oak, { nerd: "ladder", plain: "H" });
r("stairs", "stairs|staircase|stair|steps|stairway|step", "≡", P.stone, { nerd: "stairs", plain: "=" });
r("cart", "cart|wagon|waggon|barrow|wheelbarrow|handcart|carriage|coach|dray|tumbril|sledge|sled|pram|litter-chair", "æ", "#9a7048", { plain: "=", footprint: [10, 5], stamp: "block" });
r("boat", "boat|skiff|barge|punt|dinghy|raft|ship|canoe|rowboat|wherry|lighter|ferry|coracle|galley|cog|hulk|hull", "▬", P.tar, { nerd: "sail_boat", plain: "=", footprint: [14, 5], stamp: "hull" });
r("coffin", "coffin|casket-coffin|sarcophagus|bier", "▬", "#5a3a28", { nerd: "coffin", plain: "=" });
r("grave", "grave|tombstone|headstone|gravestone|tomb|crypt|memorial", "∩", P.stone, { nerd: "grave_stone", plain: "n" });

// Clothes.
r("robes", "robe|robes|gown|vestments|cope|mantle|ermine|regalia|finery", "[", P.royal, { nerd: "hanger", plain: "[", material: "cloth" });
r("clothing", "cloak|coat|jacket|shirt|tunic|dress|apron|smock|jerkin|doublet|breeches|trousers|hose|stockings|scarf|shawl|blanket|rug|cloth|sheet|towel|rag|rags|handkerchief|kerchief|glove|gloves|belt|sash|uniform|livery|cape|hood|veil|wig|clothes|laundry|washing|tablecloth|curtain|curtains|tapestry|drape|drapes|bedding|quilt", "[", "#b8a888", { nerd: "hanger", plain: "[", byMaterial: true, material: "cloth" });
r("hat", "hat|cap|bonnet|tricorn|bicorne|beret|helm-cap|mitre|fez|turban|hood-hat|wizard-hat|top-hat|bowler", "ⁿ", "#6a5a8a", { nerd: "hat_fedora", plain: "n" });
r("boots", "boot|boots|shoe|shoes|clog|clogs|slipper|slippers|sandal|sandals|galoshes|footwear", "⌡", "#4a3a30", { nerd: "shoe_formal", plain: "j", material: "leather" });
r("spectacles", "spectacles|glasses|monocle|lens|lenses|eyeglasses|pince-nez|goggles|telescope|spyglass", "∞", "#c8d8e8", { nerd: "glasses", plain: "8", material: "glass", motion: "shimmer" });
r("bunting", "bunting|banner|banners|flag|flags|pennant|pennants|streamer|streamers|garland|garlands|festoon|ribbon|ribbons", "~", "#e04040", { nerd: "flag", plain: "~", motion: "sway", overhead: true });

// Doors, windows and the bones of a place.
r("door", "door|doors|gate|gates|wicket|portal|doorway|postern|portcullis|shutter|shutters", "+", "#a8743c", { nerd: "door_closed", plain: "+", material: "wood" });
r("hatch", "hatch|trapdoor|trap-door|grate-door|grille|grating|manhole|scuttle", "□", "#8a6a42", { plain: "o", material: "wood" });
r("window", "window|windows|casement|skylight|pane|panes|oriel|lattice|porthole", "▒", "#9fc8e8", { nerd: "window_closed_variant", plain: ":", material: "glass", footprint: [8, 1], stamp: "line" });
r("wall", "wall|walls|partition|palisade|rampart|battlement|parapet|bulwark", "█", P.stone, { plain: "#", material: "stone", footprint: [20, 2], stamp: "line" });
r("fence", "fence|railing|railings|paling|hurdle|stockade|balustrade|banister", "╪", P.oak, { nerd: "fence", plain: "+", material: "wood" });
r("pillar", "pillar|column|post|pole|stake|mast|pile-post|bollard|mooring-post|gibbet-post|maypole", "○", P.stone, { plain: "o" });
r("beam", "beam|hoist|pulley|crane|gibbet|gallows|winch|windlass|derrick|yardarm|joist|rafter|lintel", "╤", "#8a6a48", { plain: "T", material: "wood" });
r("cleat", "cleat|hook-cleat|bracket|peg|nail|nails|hinge|bolt-lock|latch|hasp|ring-bolt", "¬", P.iron, { plain: "-", material: "iron" });
r("passage", "passage|hole|gap|crack|crevice|tunnel|burrow|crawlway|loose-board|panel", "▫", "#2a2420", { plain: ".", bg: "#141010" });
r("plank", "plank|board-plank|timber|beam-plank|log|logs|lumber|stave|staves|board", "▬", "#8a6038", { plain: "=", material: "wood" });

// Nature.
r("tree", "tree|elm|oak|ash-tree|willow|beech|birch|chestnut-tree|plane|sycamore|lime|alder|hawthorn|rowan|apple-tree|pear-tree|cherry-tree|poplar|maple|hornbeam|sapling|treetop", "♣", "#3f7a2e", { nerd: "tree", plain: "T", motion: "sway", footprint: [11, 11], stamp: "canopy", material: "wood" });
r("pine", "pine|fir|yew|spruce|larch|cedar|cypress|juniper|conifer|holly", "♠", "#2e6a3a", { nerd: "pine_tree", plain: "t", motion: "sway", footprint: [8, 8], stamp: "canopy", material: "wood" });
r("bush", "bush|shrub|hedge|bramble|brambles|thicket|briar|briars|gorse|furze|bracken|fern|ferns|nettle|nettles|thistle|thistles|weed|weeds|ivy|creeper", "♣", "#2f5a24", { nerd: "sprout", plain: "*", motion: "sway" });
r("flower", "flower|flowers|rose|roses|daisy|daisies|posy|bouquet|blossom|lily|lilies|tulip|tulips|violet-flower|primrose|poppy|poppies|marigold|lavender-sprig|herb|herbs|nosegay", "*", "#e87ab0", { nerd: "flower", plain: "*", motion: "sway" });
r("branch", "branch|bough|twig|twigs|stick-branch|limb|sprig-branch|driftwood|firewood|kindling|faggot|faggots", "/", "#8a6038", { plain: "/", material: "wood" });
r("leaf", "leaf|leaves|foliage|petal|petals|feather|feathers|down", "'", "#8ab04a", { nerd: "leaf", plain: "'", motion: "drift" });
r("grass", "grass|turf|lawn|sod|reed|reeds|rush|rushes|sedge", "\"", "#5a8a3a", { nerd: "grass", plain: "\"", motion: "sway" });
r("rock", "rock|rocks|stone|stones|pebble|pebbles|boulder|cobble|cobbles|brick|bricks|rubble|gravel|flint-stone|slate|scree|gutter-stone|missile", "•", "#9a968e", { plain: "*", material: "stone" });
r("boulder", "boulder|millstone|block|monolith|menhir", "●", P.stone, { plain: "O", material: "stone" });
r("mud", "mud|dirt|soil|earth|clay|dung|manure|muck|sludge|silt|peat|compost|midden", ",", "#6a5038", { plain: "," });
r("sand", "sand|dust|sawdust|grit|powder|chalk|salt|sugar|spice|pepper|snuff|soot-powder", "∙", "#c8b480", { plain: "." });
r("ice", "ice|icicle|icicles|frost|snow|snowball|hailstone|sleet", "*", P.ice, { nerd: "snowflake", plain: "*", material: "ice", motion: "shimmer" });
r("river", "river|stream|brook|canal|pond|lake|sea|moat|creek|rill|millrace|channel|weir-pool|harbour|harbor|estuary|tide|current|ford|backwater", "≈", P.water, { nerd: "waves", plain: "~", motion: "shimmer", material: "liquid", liquid: "water" });
r("puddle", "puddle|pool|slick|spill|splash|stain|smear|spatter|splatter", "~", P.water, { nerd: "water", plain: "~", motion: "shimmer", material: "liquid", liquid: "water" });
r("web", "web|cobweb|cobwebs|gossamer", "#", "#c8c8d0", { nerd: "spider_web", plain: "#" });
r("nest", "nest|lair|den|bed-of-straw|bedding-straw|roost|eyrie|warren", "≈", "#b89868", { plain: "~", material: "cloth" });
r("bone-item", "bone-item|bones-pile|antler|horn-item|tusk|skull-item", "%", P.bone, { nerd: "bone", plain: "%" });
r("tent", "tent|pavilion|awning|canopy|marquee|booth", "▲", "#c8b088", { nerd: "tent", plain: "^", footprint: [10, 8], stamp: "block" });

// Odds and ends the GM likes.
r("toy", "toy|doll|puppet|ball|top|kite|marble|marbles|rattle|hoop|yo-yo", "•", "#e07a7a", { plain: "*" });
r("bomb", "bomb|grenade|petard|firework|fireworks|powder-keg|keg-of-powder|fuse|gunpowder|blackpowder", "ò", "#4a4a4a", { nerd: "bomb", plain: "o", motion: "flicker" });
r("music-box", "music-box|automaton|clockwork|contraption|device|machine|gadget|gizmo|mechanism|engine", "☼", P.brass, { plain: "*" });
r("magic", "orb|crystal-ball|rune|runestone|glyph|sigil|circle|pentacle|ward|scroll-magic|totem|fetish|relic|artifact|artefact", "☼", P.violet, { plain: "*", motion: "pulse", light: { radius: 8, color: "#b07aff", intensity: 0.6, flicker: 0.1, when: "always" } });

/** Rules by tag: when the name says nothing the rules know, what it's tagged as decides. */
const TAG_ROLES: Array<[string, string]> = [
  ["door", "door"], ["sign", "sign"], ["body", "body"], ["hearth", "hearth"], ["fire", "fire"], ["light", "lantern"], ["weapon", "club"],
  ["spirits", "spirits"], ["water", "water"], ["liquid", "water"], ["passage", "passage"], ["furniture", "table"], ["container", "crate"],
  ["overhead", "net"], ["evidence", "paper"], ["hanging", "rope"],
];

const byId = new Map(RULES.map(rule => [rule.id, rule.role]));
export const roleById = (id: string): Role | undefined => byId.get(id);
export const ROLE_IDS = RULES.map(rule => rule.id);

/** Generic looks by kind, for things nothing recognises (the model can do better: see invent.ts). */
export const KIND_ROLES: Record<string, Role> = {
  person: { id: "person", glyph: { ascii: "☻", plain: "p" }, fg: "#c8b89a", being: true },
  creature: { id: "creature", glyph: { ascii: "c" }, fg: "#c0a080", being: true },
  item: { id: "item", glyph: { ascii: "•", plain: "*" }, fg: "#c8c0a8" },
  object: { id: "object", glyph: { ascii: "▪", plain: "=" }, fg: "#a08a6a" },
  feature: { id: "feature", glyph: { ascii: "▪", plain: "=" }, fg: "#8a8070" },
};

export interface RoleMatch { role: Role; how: "head" | "phrase" | "tag" | "kind" }

/** Tags that say more than any name: a loose board tagged "passage" is a way through, a fire tagged "hearth" has a hearth round it. */
const STRONG_TAGS = ["passage", "hearth"];

/**
 * The role for a thing: strong tags, then the name (phrase rules, the head noun, the phrase's other
 * words), then any tag, then nothing (the caller guesses by kind, and may ask the model). Beings
 * and things share words ("a bat", "the watch", "a page"), so a known kind narrows the rules first.
 */
export function matchRole(parsed: ParsedName, tags: readonly string[] = [], kind?: string): RoleMatch | undefined {
  for (const tag of STRONG_TAGS) if (tags.includes(tag)) {
    const role = byId.get(TAG_ROLES.find(([t]) => t === tag)![1]);
    if (role) return { role, how: "tag" };
  }
  const being = kind === "person" || kind === "creature";
  const narrowed = kind ? RULES.filter(rule => !!rule.role.being === being) : RULES;
  for (const rules of kind ? [narrowed, RULES] : [RULES]) {
    for (const rule of rules) if (rule.phrase && rule.phrase.test(parsed.phrase)) return { role: rule.role, how: "phrase" };
    for (const rule of rules) if (rule.head && rule.head.test(parsed.head)) return { role: rule.role, how: "head" };
    // The phrase's other words, last first ("grain stacks": grain; "gutter stones": stones).
    const words = parsed.phrase.split(" ").reverse().slice(1).map(singular);
    for (const w of words) for (const rule of rules) if (rule.head && rule.head.test(w)) return { role: rule.role, how: "phrase" };
  }
  for (const [tag, id] of TAG_ROLES) if (tags.includes(tag)) { const role = byId.get(id); if (role) return { role, how: "tag" }; }
  return undefined;
}

/** How a size scales a role's footprint (feet). */
export const SIZE_SCALE: Record<Size, number> = { tiny: 0.25, small: 0.45, medium: 0.7, large: 1, huge: 1.6, gargantuan: 2.6 };
