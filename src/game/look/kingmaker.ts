import { isKingmaker, km } from "./glyphs.ts";
import { KINGMAKER_GLYPHS, type KingmakerGlyph } from "./kingmaker-glyphs.ts";
import { singular, type ParsedName } from "./names.ts";

/**
 * The kingmaker glyph set's rules: which of Kingmaker Glyphs' pixel-art sprites a being gets. The
 * sprites are drawn in assets/glyphs/kingmaker.txt and built into a font by tools/glyphs/build.py
 * (`npm run glyphs` builds and installs it; kingmaker-glyphs.ts is the generated list).
 *
 * The cast have their own (people.ts). Anyone else is read by the words in their name, the head noun
 * first and then the rest, last first ("an old watchman" is the watch, "a flock of pigeons" a
 * pigeon six times over, "a vast mastiff" Duchess's kind of dog), then by what the rules made of them
 * (the role ids in roles.ts), and "old" ages a man or a woman. A being with no sprite keeps its ascii
 * letter (a cow is still a q), and things stay things, but for a body.
 */

/** Words (singular) and the sprite they mean, specific before general. */
const WORDS: Array<[RegExp, KingmakerGlyph]> = [
  // People.
  [/^(king|queen|monarch|majesty|emperor|empress|sovereign)$/, "king"],
  [/^(linkboy|link-boy|lantern-boy|lanternboy|torchboy|torch-bearer)$/, "lantern-boy"],
  [/^(page|pageboy|page-boy|footboy|herald)$/, "page"],
  [/^(guard|guardsman|soldier|sentry|sentinel|halberdier|pikeman|man-at-arms|trooper|militiaman|militia|knight|marshal|captain|lieutenant|garrison)$/, "guard"],
  [/^(watchman|watch|constable|sergeant|corporal|bailiff|beadle|warden|jailer|gaoler|turnkey|officer|thief-taker)$/, "watchman"],
  [/^(porter|docker|dockhand|stevedore|labourer|laborer|navvy|carter|carrier|coalheaver|heaver|bearer|drayman|loader|hauler)$/, "porter"],
  [/^(bargee|bargeman|bargewoman|lighterman|boatman|waterman|ferryman|sailor|seaman|mariner|deckhand|fisherman|bosun|boatswain|shipwright|rower|oarsman)$/, "bargee"],
  [/^(beggar|vagrant|tramp|vagabond|pauper|mendicant|wretch|cripple)$/, "beggar"],
  [/^(valet|butler|footman|manservant|lackey|flunkey|steward|waiter|servant|attendant|chamberlain|potboy|pot-boy|tapster|cupbearer)$/, "valet"],
  [/^(priest|monk|nun|friar|cleric|vicar|parson|chaplain|abbot|abbess|bishop|curate|deacon|preacher|cultist|acolyte|hermit|pilgrim|druid|prior|prioress)$/, "priest"],
  [/^(merchant|trader|shopkeeper|stallholder|pedlar|peddler|hawker|vendor|seller|costermonger|grocer|factor|moneylender|banker|purveyor|chandler|vintner|draper|haberdasher|tradesman)$/, "merchant"],
  [/^(noble|nobleman|noblewoman|gentleman|gentlewoman|gent|lord|lady|duke|duchess|prince|princess|baron|baroness|count|countess|earl|courtier|dandy|fop|aristocrat|squire|magister|delegate|ambassador|envoy)$/, "noble"],
  [/^(thug|bruiser|ruffian|tough|heavy|bully|enforcer|footpad|cutthroat|bravo|brawler|bouncer|crake)$/, "crake"],
  [/^(crone|hag|granny|grandmother|grandma|widow|beldam|gammer)$/, "old-woman"],
  [/^(greybeard|graybeard|grandfather|grandpa|elder|old-timer|oldster|codger|geezer|gaffer)$/, "old-man"],
  [/^(child|kid|boy|girl|urchin|lad|lass|brat|youngster|toddler|baby|infant|waif|scamp|guttersnipe|orphan|son|daughter|apprentice|squirt|nipper)$/, "child"],
  [/^(woman|wife|maid|maiden|barmaid|landlady|washerwoman|laundress|seamstress|mother|matron|goodwife|mistress|missus|madam|fishwife|alewife|sister|aunt|nurse|midwife|serving-girl|scullery-maid)$/, "woman"],
  [/^(body|corpse|cadaver|carcass|remains|deceased|stiff)$/, "body"],
  // Creatures.
  [/^(mastiff|wolfhound|bloodhound|boarhound|bulldog|bullmastiff|deerhound)$/, "duchess"],
  [/^(dog|hound|cur|mutt|puppy|pup|terrier|spaniel|whippet|greyhound|lurcher|collie|sheepdog|ratter)$/, "dog"],
  [/^(wolf|jackal|coyote|hyena|fox|vixen|warg|werewolf)$/, "wolf"],
  [/^(rat|mouse|rodent|vole|shrew|ferret|weasel|stoat|squirrel|mole|hamster|dormouse)$/, "rat"],
  [/^(goose|gander|gosling|duck|duckling|swan|cygnet|hen|chicken|rooster|cockerel|chick|turkey|peacock|pheasant|partridge|grouse|quail|fowl)$/, "goose"],
  [/^(crow|raven|rook|jackdaw|magpie|blackbird|hawk|falcon|kestrel|eagle|vulture|buzzard|kite|heron|stork|crane-bird)$/, "crow"],
  [/^(owl|owlet)$/, "owl"],
  [/^(pigeon|dove|bird|sparrow|finch|robin|wren|thrush|lark|songbird|canary|parrot|starling|swallow|swift|martin|gull|seagull|tern|tit|bunting-bird)$/, "pigeon"],
  [/^(cat|kitten|tomcat|mouser|moggy|lynx|wildcat|puss|pussycat|tabby)$/, "cat"],
  [/^(horse|pony|mule|donkey|nag|mare|stallion|foal|colt|steed|charger|gelding|packhorse|carthorse|warhorse)$/, "horse"],
  [/^(pig|hog|boar|sow|piglet|swine)$/, "pig"],
  [/^(goat|billy-goat|nanny-goat|kid-goat|ram|ewe|sheep|lamb)$/, "goat"],
  [/^(frog|toad|newt|salamander)$/, "frog"],
  [/^(fish|carp|pike|trout|salmon|cod|herring|perch|minnow|tench|bream|mackerel|sprat|sturgeon)$/, "fish"],
  [/^(snake|serpent|adder|viper|asp|python|cobra|wyrm)$/, "snake"],
  [/^(spider|tarantula|scorpion|centipede|millipede)$/, "spider"],
  [/^(bat|vampire-bat|fruit-bat)$/, "bat"],
  [/^(bear|bruin|grizzly)$/, "bear"],
  [/^(goblin|hobgoblin|gremlin|imp|kobold|redcap|boggart|gnome|brownie|sprite|pixie|bogle)$/, "goblin"],
  [/^(troll|ogre|giant|orc|bugbear|cyclops|ettin)$/, "troll"],
  [/^(skeleton|skull|bones)$/, "skeleton"],
  [/^(ghost|spirit|spectre|specter|wraith|phantom|shade|poltergeist|apparition|banshee|haunt|ghoul-spirit)$/, "ghost"],
  [/^(zombie|ghoul|revenant|draugr|wight|mummy|lich)$/, "zombie"],
  [/^(slime|ooze|jelly|blob|pudding|cube|sludge-beast)$/, "slime"],
  [/^(monster|beast|creature|horror|abomination|demon|devil|fiend|thing|aberration|homunculus|chimera|manticore|gargoyle)$/, "monster"],
  // Generic people last, so "a woman porter" is a porter and "the old man's dog" a dog.
  [/^(man|fellow|person|figure|stranger|traveller|traveler|husband|father|brother|uncle|landlord|innkeeper|publican|barman|bartender|clerk|scribe|secretary|bookkeeper|lawyer|notary|smith|blacksmith|baker|butcher|cook|tailor|carpenter|cooper|mason|miller|farmer|ostler|groom|drunk|drunkard|regular|patron|customer|gambler|thief|cutpurse|pickpocket|rogue|bandit|brigand|assassin|spy|informer|lamplighter|sweep|ratcatcher|gravedigger|undertaker|hangman|official|minstrel|bard|wizard|mage|sorcerer|witch|scholar|physician|surgeon|apothecary|alchemist|healer|townsman|citizen|villager|peasant|yokel|local|onlooker|bystander|witness|youth)$/, "man"],
];

/** What the rules made of a being, when no word says more. */
const ROLES: Record<string, KingmakerGlyph> = {
  crowd: "man", child: "child", guard: "guard", royal: "noble", person: "man", body: "body", ghost: "ghost", skeleton: "skeleton",
  pigeon: "pigeon", crow: "crow", gull: "pigeon", bird: "pigeon", owl: "owl", fowl: "goose", dog: "dog", wolf: "wolf", fox: "wolf",
  cat: "cat", rat: "rat", horse: "horse", sheep: "goat", pig: "pig", fish: "fish", snake: "snake", frog: "frog",
  spider: "spider", bat: "bat", goblin: "goblin", orc: "troll", undead: "zombie", horror: "monster",
};

const OLD = /\b(old|elderly|aged|ancient|grey-haired|white-haired|wrinkled|doddering)\b/;
const AGED: Partial<Record<KingmakerGlyph, KingmakerGlyph>> = { man: "old-man", woman: "old-woman" };

/** A sprite's name for a being's name and role, or undefined (it keeps its ascii glyph). */
export function kmName(parsed: ParsedName, role?: string): KingmakerGlyph | undefined {
  // The head noun, then the other words, last first; a compound by its last part too ("an eel-seller").
  const words = [parsed.head, ...parsed.phrase.split(" ").reverse().slice(1).map(singular)].flatMap(w => (w.includes("-") ? [w, singular(w.split("-").at(-1)!)] : [w]));
  let name: KingmakerGlyph | undefined;
  for (const word of words) {
    name = WORDS.find(([re]) => re.test(word))?.[1];
    if (name) break;
  }
  name ??= role ? ROLES[role] : undefined;
  if (name && OLD.test(parsed.phrase)) name = AGED[name] ?? name;
  return name;
}

/**
 * The sprite (a character) for a thing in the kingmaker set, or undefined. Beings by their name and
 * role; of things, only bodies (a corpse is a body whoever it was).
 */
export function kmFor(parsed: ParsedName, role: string | undefined, being: boolean): string | undefined {
  if (!being) return role === "body" ? km("body") : undefined;
  const name = kmName(parsed, role);
  return name ? km(name) : undefined;
}

/** Wingbeats: the frame a flying sprite shows with its wings up. */
const FLAPS: Partial<Record<KingmakerGlyph, KingmakerGlyph>> = { pigeon: "pigeon-flap", crow: "crow-flap", bat: "bat-flap" };
const FLAP_OF = new Map(Object.entries(FLAPS).map(([from, to]) => [km(from as KingmakerGlyph), km(to)]));

/** A sprite on the beat: wings up when `up`, otherwise as it is. Anything that doesn't fly is unchanged. */
export function kmFlap(glyph: string, up: boolean): string {
  return up && isKingmaker(glyph) ? FLAP_OF.get(glyph) ?? glyph : glyph;
}

/** Every sprite with its name and what it is, in the font's order (for the gallery's board). */
export const KM_VOCABULARY = Object.entries(KINGMAKER_GLYPHS).map(([name, [code, about]]) => ({ name: name as KingmakerGlyph, glyph: String.fromCodePoint(code), code, about }));
