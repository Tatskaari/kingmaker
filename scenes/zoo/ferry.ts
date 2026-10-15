import type { Scene } from "../../src/runtime/scene.ts";
import type { WorldSpec } from "../../src/world/scene-world.ts";
import { ft } from "./common.ts";

/**
 * The zoo's booth for the GM's markup (src/runtime/markup.ts): a ferry at the foot of Caerwyn's river
 * stairs, where every refusal has a reason and the reasons show. The ferryman carries the stairs'
 * own folk and whoever his mother speaks for; his mother sells eels, and remembers anyone who's rude
 * to her; nobody on the stairs carries for the watch (the stairs' grudge, from Caerwyn's lore: the
 * watch has never once come down them for a gentleman); and the landing has customs of its own
 * (eels by the yard, the King's face up, the board's rules). So a turn or two in, the replies carry
 * every kind of mark: why (a grudge from the visitor's rudeness, a side they aren't on, the stairs'
 * prejudice), know (a custom a Caerwyn hand would know and a newcomer wouldn't, the places of the
 * stairs) and you (the visitor's own rudeness, called back).
 */

export const ferryWorld: WorldSpec = {
  name: "The ferry stairs",
  description: "A stone landing at the foot of the river stairs, green with wet; a skiff at a mooring ring, the river going by brown and fast, a brazier, and a chalked board on a post.",
  size: { w: 50, h: 40 },
  areas: [
    { id: "landing", name: "the landing", rect: { x: 5, y: 5, w: 30, h: 30 } },
    { id: "river", name: "the river", rect: { x: 35, y: 5, w: 10, h: 30 } },
  ],
  things: [
    { id: "river-stairs", name: "the river stairs", kind: "feature", in: "landing", at: ft(1, 1), size: "large", material: "stone", tags: ["fixed", "passage"], description: "Worn stone steps going up the bank to the quay, wet and green; nobody has ever counted the same number twice." },
    { id: "ferry-board", name: "a chalked board on a post", kind: "object", in: "landing", at: ft(5, 1), size: "small", material: "wood", tags: ["sign", "fixed"], description: "FERRY TO THE WHARVES 1d. KING'S FACE UP. NO WATCH. RIVER FOLK, AND THOSE SPOKE FOR." },
    { id: "brazier", name: "a brazier", kind: "object", in: "landing", at: ft(2, 4), size: "medium", material: "iron", tags: ["fire", "light"], states: ["lit"], description: "An iron brazier of driftwood, burning blue at the edges with salt." },
    { id: "eel-basket", name: "a basket of live eels", kind: "item", in: "landing", at: ft(3, 3), size: "small", material: "wood", tags: ["container"], description: "Wicker, wet, and moving." },
    { id: "mooring-ring", name: "the mooring ring", kind: "feature", in: "landing", at: ft(6, 3), size: "small", material: "iron", tags: ["fixed"], description: "An iron ring in the landing's edge, with a skiff's painter round it." },
    { id: "skiff", name: "the ferry skiff", kind: "object", in: "river", at: ft(7, 3), size: "large", material: "wood", tags: ["boat"], description: "A flat-bottomed lighterman's skiff, tarred black, with a pole across the thwarts." },
    // The booth's door (the theatre's, on the south wall): the way back out.
    { id: "booth-door", name: "the booth's door", kind: "feature", in: "landing", at: ft(4, 7), size: "large", material: "wood", tags: ["door", "fixed"], states: ["open"] },
  ],
  people: {
    player: { in: "landing", at: ft(3, 5) },
    gudgeon: { in: "landing", at: ft(3, 3), note: "on the landing with her basket, an eel held up" },
    dab: { in: "river", at: ft(7, 4), note: "in his skiff, mending a net" },
  },
};

export const ferry: Scene = {
  id: "zoo-ferry",
  title: "The Ferry Stairs",
  time: "evening",
  summary: "The zoo's booth for the GM's markup: a ferry that carries only its own, an eel-wife who remembers, and the river stairs' rules, every refusal with its reason.",
  setting: "A booth in the zoo's theatre set up as a landing at the foot of Caerwyn's river stairs at dusk, on the eve of the Assembly: worn green steps coming down to a stone landing, a skiff tied to a mooring ring, the river going by brown and fast in winter spate, a brazier of driftwood burning blue with salt, and a chalked board on a post (FERRY TO THE WHARVES 1d. KING'S FACE UP. NO WATCH. RIVER FOLK, AND THOSE SPOKE FOR). An eel-wife works the landing with a basket on her hip, and the ferryman sits in his skiff mending a net. The ferry is the only way across short of the bridge, two miles round.",
  premise: "Will the visitor get across the river, and what will it cost them, in pennies and in manners?",
  hook: "The ferry at the foot of the river stairs carries river folk. Are you river folk?",
  background: [
    "The stairs look after their own: a lighterman carries river folk, and anyone a stairs person will speak for, and nobody else. That's the custom of this landing (this booth's own), and every lighterman on it keeps it.",
    "Caerwyn's money carries the King's face, and the stairs, like the chandlers, want to see it: a penny is paid King's face up, and foreign coin isn't taken.",
    "The river stairs are the river watch's patch, and the watch comes down them only when it must. Everyone on the stairs says the same: in thirty years the watch has never once come down the stairs for a gentleman. Nobody on the landing does anything for anyone who comes in the watch's name.",
    "Eels are sold on the stairs by the yard, a penny a yard: an eel held up against the arm, fingertip to nose.",
    "This booth is for the marks on your replies: when someone here refuses, bristles or comes round, it's for a reason worth a why; the stairs' customs (the board's rules, the King's face, eels by the yard, the river watch) are worth a know the first time they matter; and the visitor's own doings on this landing, called back, are worth a you.",
  ],
  opening: "Open on the landing at the foot of the stairs: the river going by fast and brown, the skiff at its ring with a lighterman in it mending a net, and the chalked board on its post. An eel-wife with a basket on her hip steps into the visitor's way and holds up an eel against her arm, by the yard, and asks if they'd like one. Don't name either of them. End on the eel, held up, waiting.",
  cast: [
    {
      id: "gudgeon", name: "Peg Gudgeon", called: "the eel-wife", statblock: "commoner",
      look: "A small, fierce old woman in a sacking apron and a man's cap, a wicker basket of live eels on her hip, and a voice that carries across water.",
      voice: "River-stairs patter; calls everyone 'my duck'; sells as she breathes, and says what she thinks of people to the whole landing.",
      wants: "To sell an eel to everyone who comes down the stairs, and to be treated like a person while she does it.",
      fears: "Being laughed at on her own landing.",
      knows: [
        "The ferryman is her son, Dab. He carries river folk across, and whoever she says is all right.",
        "The stairs look after their own: a lighterman carries his own folk and anyone one of them will speak for. Anyone else can walk round by the bridge, two miles.",
        "The watch on the stairs: in thirty years it's never once come down them for a gentleman, and the river watch walks them in fours after dark, or not at all.",
        "Eels go by the yard on the stairs, a penny a yard, King's face up.",
      ],
      attitude: "Cheerful and pushy. Civility, a purchase or a laugh, and she'll speak for the visitor to her son. Insult her (her eels, her face, her trade) and she remembers it out loud, to the whole landing, and won't speak for them; a proper apology and an eel bought at her price bring her round, slowly.",
    },
    {
      id: "dab", name: "Dab Gudgeon", called: "the ferryman", statblock: "commoner",
      look: "A broad, quiet lighterman in a tarred coat, sitting in a skiff at the mooring ring with a net across his knees and his pole beside him.",
      voice: "Few words, river vowels, long pauses; says no without raising his voice.",
      wants: "To carry his own folk across, a penny a head, King's face up, and his mother's say-so on anyone else.",
      knows: [
        "The ferry is a penny to the wharves, King's face up: he won't take foreign coin, any more than anyone on the stairs will.",
        "The stairs carry their own: river folk, and anyone a stairs person speaks for. He's never carried a stranger nobody spoke for, and he's not starting in Assembly week.",
        "The watch fined him a shilling last month for mooring where everyone moors. He doesn't carry the watch, or anyone who comes in its name.",
      ],
      attitude: "Polite and immovable. He carries river folk and anyone his mother speaks for, for a penny, King's face up. A stranger nobody speaks for: no. Anyone who comes in the watch's name, or who was rude to his mother: no, and he says why in as few words as it takes.",
    },
  ],
  start: "landing",
  beats: [
    {
      id: "landing",
      title: "Nobody's spoken for you",
      direction: "The visitor wants the ferry, and the ferry carries the stairs' own. The eel-wife sells eels and sizes the visitor up; the ferryman mends his net and answers what he's asked. Asked to cross, he says no to a stranger nobody's spoken for, and his no carries a why: the stairs carry their own. Someone who comes in the watch's name gets the stairs' grudge from both of them, and that no carries a why too. Civility to the eel-wife (a purchase, a laugh, a kindness) and she speaks for the visitor to her son. The first time one of the stairs' customs comes up (the King's face, eels by the yard, the river watch, the board's rules), it carries a know.",
      cast: { gudgeon: "Sell an eel. Hold one up against your arm, by the yard. Size the visitor up out loud.", dab: "Mend the net. Answer only what's asked, in as few words as it takes." },
      pressure: "The tide turns: the ferryman starts to coil his painter, as if the last crossing of the evening is going without anyone.",
      transitions: [
        { id: "spoken-for", on: "outcome", when: "The eel-wife has been treated decently (an eel bought, a kindness, a laugh, an apology she's accepted) and the visitor has asked to cross: she speaks for them to her son.", to: "aboard", given: true },
        { id: "insulted", on: "outcome", when: "The visitor has insulted the eel-wife or pushed past her rudely: her eels, her looks, her trade, her son.", to: "snubbed", establishes: ["The visitor was rude to Peg Gudgeon on her own landing, in front of her son."] },
        {
          id: "talk-him-round", on: "attempt", when: "The visitor tries to talk the ferryman into carrying them without anyone on the stairs speaking for them.",
          check: { skill: "persuasion", dc: 16, reason: "to talk a lighterman into carrying a stranger nobody's spoken for", success: "He looks at the visitor a long time, then at the river, and jerks his head at the skiff.", failure: "He goes back to his net: the stairs carry their own." , onSuccess: "aboard" },
        },
      ],
    },
    {
      id: "snubbed",
      title: "The whole landing heard",
      direction: "The visitor was rude to the eel-wife, and the whole landing knows it: she says so, to anyone listening, and won't speak for them, and her son won't carry anyone who was rude to his mother. Asked anything, they answer from that: each no carries a why, and when either of them throws the visitor's words back at them, those words carry a you. A proper apology, and an eel bought at her price, might bring her round, slowly, in her own good time.",
      cast: { gudgeon: "Tell the river what the visitor called you. Sell eels to everyone else, loudly.", dab: "Don't look up from the net. A no, with the reason, in as few words as it takes." },
      transitions: [
        { id: "amends", on: "outcome", when: "The visitor has made a proper apology to the eel-wife and bought an eel at her price (or done her a real kindness), and she's accepted it.", to: "landing" },
      ],
    },
    {
      id: "aboard",
      title: "Spoken for",
      direction: "Someone has spoken for the visitor (or they talked the ferryman round): he takes them across for a penny, King's face up, without a word more than he needs. A foreign coin is handed back. The scene closes once they're in the skiff and he's pushed off.",
      cast: { dab: "Hold out a hand for the penny. Check the King's face. Push off.", gudgeon: "Call the price of eels after them across the water." },
      transitions: [
        { id: "across", on: "outcome", when: "The visitor is in the skiff and the ferryman has pushed off for the far side.", to: "ferried" },
      ],
    },
  ],
  exits: [
    {
      id: "ferried", kind: "progress", title: "Across the river",
      outcome: "The ferryman takes the visitor across the river to the wharves, a penny, King's face up.",
      closing: "Close on the skiff sliding out into the brown river, and the eel-wife calling the price of eels after it.",
      script: world => { world.setFlag("ferry", "crossed"); world.journal("Crossed the river at the foot of the stairs in a lighterman's skiff: a penny, King's face up, and somebody had to speak for me."); },
    },
    {
      id: "turned-back", kind: "other", title: "Back up the stairs",
      outcome: "The visitor gives up on the ferry and goes back up the stairs (or round by the bridge, two miles).",
      closing: "Close on the stairs going up, and the eel-wife's opinion of the visitor following them all the way.",
      script: world => { world.setFlag("ferry", "turned-back"); world.journal("Turned away from the ferry at the foot of the river stairs. Nobody would speak for me."); },
    },
  ],
  limits: [
    "The bridge: it's two miles round, and not in this booth.",
    "Swimming: the river's in winter spate; nobody swims it and comes back to tell the stairs.",
    "Another boat: the ferryman's skiff is the only one at this landing tonight.",
    "The watch: nobody here does anything in the watch's name, and no watchman comes down the stairs to make them.",
  ],
  lore: ["Places/River Stairs.md", "World/City Watch.md", "World/Caerwyn.md"],
  // The landing's customs, as anyone on the stairs knows them: what a note on the GM's marks explains from.
  known: [
    "The stairs look after their own: a lighterman carries river folk, and anyone a stairs person will speak for, and nobody else. Anyone else walks round by the bridge, two miles.",
    "Eels are sold on the stairs by the yard, a penny a yard: an eel held up against the seller's arm, fingertip to nose.",
    "Money on the stairs is paid King's face up, and foreign coin isn't taken: the ferry to the wharves is a penny.",
    "In thirty years the watch has never once come down the stairs for a gentleman, and nobody on the landing does anything for anyone who comes in the watch's name.",
    "\"My duck\" is how the stairs say \"my dear\", to anyone at all.",
  ],
  world: ferryWorld,
};
