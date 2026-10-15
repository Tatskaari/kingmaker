import { T } from "../../map/tiles.ts";
import { registerArena, type Arena } from "../arenas.ts";
import { feet, marks, rect, type Exhibit, type Trigger, type Wing } from "../model.ts";
import { BOARDS, DIRT, floorFor, GRASS } from "./common.ts";
import { toHall } from "./hall.ts";

/**
 * The Arena: four rings, each a tactical fight on the map, started by ringing its bell by the gate.
 * Everyone stands where the arena's world has them; the ring's lanterns, brazier, grain dust and
 * sacks are in the fight; the gate is the way out. Kell fights beside you in the Heron's ring always,
 * and in the others when she's walking with you. A fight's end is written back into the arena's
 * world (who's down, what burned), and the next ring of its bell sets the ring out fresh.
 */

const GRID = `
##################################################
%BBBBBBBBBBBBBBBBBBBB..BBBBBBBBBBBBBB............#
%BffffffffffffffffffB..BhhhhhhhhhhhhB............#
%BfwWfffffSfffffvfffB..Bhhhhhhhhhh4hB...q...s....#
%BffffffCfffcfffffffB..BhhhhhGhhhhhhB............#
%Bffff1fffLfffffffffB..BhhPhhhhhQhhhB............#
%Bfffffffffffff2ffNfB..BhhhhhRhhhhhhB............#
%BfffffffffffTffffffB..BhhhhhhhhhhhhB...u...x....#
%BffffZfffffffffffffB..BhhhhhhhhhhhhB............#
%BffffffffffffffffffB..BhthhhhhhhhhhB............#
%BfkfffffffffffffKffB..BhhhhhhhhhhhhB............#
%BffffffffffffffffffB..BhhhhhhhhhhhhB...y...z....#
%Bffffffff3fffffffffB..Bhhhhh5hhhhhhB............#
%BBBBBBBBBDBBBBBBBBBB..BBBBBBDBBBBBBB............#
%...a..b....d..............e...g.....V.!.........#
X.@..............................................#
%......l.....m.............n...o.................#
%=========E==========..======E=======............#
%=pppppppp6ppppppppp=..=rrrrr7rrrrrr=............#
%=pppppppppppppppppp=..=rrrrrrrrrrrr=............#
%=pppppppppppppppppp=..=rrrrrrrrrrrr=...0...8....#
%=pppppppppppppppppp=..=rr^rrrrrrrrr=............#
%=pppppjpppppJpppppp=..=rrrrrrrrrrrr=............#
%=pppppppppppppppppp=..=rrrrrrrrr&rr=............#
%=ppppppppUppppppppp=..=rrrrrrrrrrrr=............#
%=ppppppppppppppippp=..=rrrrrrrrrrrr=...9........#
%=pppppppppppppppppp=..=rrrrrrrrrrrr=............#
%=ppppppppOppppppppp=..=rrFrrrrrIrrr=............#
%=pppppppppppppppppp=..=rrrrrHrrrrrr=.........M..#
%=ppApppppppppppYppp=..=rrrrrrrrrrrr=............#
%=pppppppppppppppppp=..=rrrrrrrrrrrr=............#
%====================..==============............#
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%#
`;

const ON_GRAIN = "SCcLwWvkKTZ12N3";
const ON_HEPS = "GPQRt45";
const ON_PIT = "OAYUjJi6";
const ON_RUN = "FHI7";
const ON_FLAGS = "@abdeglmnoqsuxyz089MV!";
const TREES = "^&";
const at = marks(GRID, ON_GRAIN + ON_HEPS + ON_PIT + ON_RUN + ON_FLAGS + TREES);
const ID = "zoo-arena";
const FLAGS = T("floor", { style: "flags" });
const GRAIN = T("boards");

// ---------------------------------------------------------------------------------------------
// The rings.

const HERON = registerArena({
  id: "heron", wing: ID, name: "grain floor", ring: { x: 2, y: 2, w: 18, h: 11 }, start: at["3"]!, gate: { x: 10, y: 13 }, outside: { x: 10, y: 14 }, kell: true,
  enemies: [
    { id: "sallow", castId: "sallow", statblock: "sword-cane-duellist", role: "villain" },
    { id: "crake-1", castId: "crake-1", statblock: "river-bruiser", role: "bruiser" },
    { id: "crake-2", castId: "crake-2", statblock: "river-bruiser", role: "bruiser" },
    { id: "lantern-boy", castId: "lantern-boy", statblock: "lantern-boy", role: "coward" },
  ],
});
const PORTERS = registerArena({
  id: "porters", wing: ID, name: "porters' floor", ring: { x: 24, y: 2, w: 12, h: 11 }, start: at["5"]!, gate: { x: 29, y: 13 }, outside: { x: 29, y: 14 },
  enemies: [
    { id: "hep", castId: "hep", statblock: "tough", weapon: "dagger", role: "brawler" },
    { id: "porter-1", statblock: "porter", role: "brawler" },
    { id: "porter-2", statblock: "porter", role: "brawler" },
    { id: "porter-3", statblock: "porter", role: "brawler" },
  ],
});
const GOBLINS = registerArena({
  id: "goblins", wing: ID, name: "goblin pit", ring: { x: 2, y: 18, w: 18, h: 13 }, start: at["6"]!, gate: { x: 10, y: 17 }, outside: { x: 10, y: 16 },
  enemies: [
    { id: "goblin-boss", statblock: "goblin-boss", weapon: "scimitar", role: "bruiser" },
    { id: "goblin", statblock: "goblin-warrior", weapon: "scimitar", role: "brawler" },
    { id: "goblin-archer-1", statblock: "goblin-warrior", weapon: "shortbow", role: "archer" },
    { id: "goblin-archer-2", statblock: "goblin-warrior", weapon: "shortbow", role: "archer" },
  ],
});
const WOLVES = registerArena({
  id: "wolves", wing: ID, name: "wolf run", ring: { x: 24, y: 18, w: 12, h: 13 }, start: at["7"]!, gate: { x: 29, y: 17 }, outside: { x: 29, y: 16 },
  enemies: [
    { id: "wolf-1", statblock: "wolf", role: "bruiser" },
    { id: "wolf-2", statblock: "wolf", role: "bruiser" },
    { id: "wolf-3", statblock: "wolf", role: "bruiser" },
  ],
});

const bell = { name: "a fight bell", glyph: "♫", color: "#e8c070" };

/**
 * A ring's bell: ring it and the fight starts, the ring set out fresh. `fight` is how the tour
 * opens it: action ids, and lines typed as the player would type them ("say:..."), read the same
 * way (the plain commands with no model; the rest by the decider, or offline the GM's absence).
 */
function ringBell(id: string, arena: Arena, at: { x: number; y: number }, label: string, text: string, fight: string[], expect: string[] = ["fight"]): Trigger {
  return { id, label, at, station: bell, expect, plan: { fight }, run: () => ({ text, fight: arena.id }) };
}

const sign = (id: string, mark: string, title: string, shows: string[], text: string, triggers: Trigger[] = []): Exhibit =>
  ({ id, title, shows, sign: at[mark]!, text, triggers });

const exhibits: Exhibit[] = [
  sign("arena", "a", "The Arena", ["Roll for initiative", "Who fights"],
    "Four rings, each a fight on the map, as the story fights them: the same engine for every roll, the same screen, the same AI, everyone keeping their cast letter and colour. Ring a ring's bell by its gate and it's \"Roll for initiative!\". Each ring starts fresh every time its bell is rung, and so do you (the attendants patch you up and hand your spell slots back); when a fight's over it stays as the fight left it, bodies and scorch marks and all, which is the arena's idea of a souvenir. The fights are saved as they go: quit mid-fight and Continue picks it up."),
  sign("heron-ring", "d", "The grain floor (the Heron, rehearsed)", ["Who fights", "Lanterns and braziers", "The grain dust goes up", "Fire spreading", "Nerve, surrender and walking off", "How the other side fights", "Kell's arrests", "Spells in a fight"],
    "The story's own fight, on a floor of its own: Master Sallow (a sword-cane duellist: two thrusts a turn, a parry, and an air of mild disappointment), the talking Crake and the silent Crake (cudgels, a shilling extra for the uniform), and the lantern-boy, who has a lantern and no ambition. The floor is thick with grain dust, there are lanterns in the beams, a brazier for cold hands, and sacks to catch: fire anywhere in the dust sets all of it off. The draught keeps the dust off the gate, which is where you start, by design. Kell comes too; it's her arrest.",
    [ringBell("bell-heron", HERON, at.b!, "Ring the bell: the Heron's fight (Sallow, the Crakes, the lantern-boy)", "You ring the bell. On the grain floor, Master Sallow looks up from his gloves, and Kell is already beside you. \"Investigator,\" she says. \"I'll take the uniform's share.\"",
      ["say:cast fireball at sallow", "say:Master Sallow! The King's watch. Put the cane down, there's a good fellow."], ["fight", "typed"])]),
  sign("porters-ring", "g", "The porters' floor (a brawl)", ["Moving", "Attacking", "How the other side fights"],
    "Hep Grist and three of her porters, before midnight, as the Heron's fight goes when Sallow hasn't come yet: brawlers with sack-knives, who gang up and don't stop to talk. A good place to try moving (click a blue tile, or the arrows: you can pass a friend but not stop on them, and leaving someone's reach gets you swung at), closing in (z), and Extra Attack, which comes at level five.",
    [ringBell("bell-porters", PORTERS, at.e!, "Ring the bell: Hep Grist and her porters", "You ring the bell. Hep Grist spits on her hands. Her porters, who are paid by the sack, look at you as if you were one.", ["dodge"])]),
  sign("goblin-pit", "m", "The goblin pit (arrows and cover)", ["Attacking", "Spells in a fight"],
    "A goblin boss, a goblin with a scimitar, and two goblin archers who keep their distance and shoot from behind the rocks. Ranged attacks need a clear shot; someone in the way is half cover; past a bow's normal range is disadvantage. The scene harness's other scenes (the warren, the crossroads) fight goblins like these in a plain room. Lightning Bolt is a line: line them up.",
    [ringBell("bell-goblins", GOBLINS, at.l!, "Ring the bell: the goblin pit", "You ring the bell. In the pit, four goblins stop arguing about the bell and start arguing about you.",
      ["cast_lightning-bolt_at_goblin-boss", "say:Your lads are half cooked, boss. Throw that scimitar down and we'll say no more about it."])]),
  sign("wolf-run", "o", "The wolf run (pack tactics)", ["Attacking", "Down, death saves and nearly dying"],
    "Three wolves. A wolf with a friend beside its target has advantage (Pack Tactics), so they come in together and they come in from the sides. Keep your back to a tree, or bring Kell. If you go down, you make death saves at the start of your turns; nobody dies in the zoo, which the wolves were not told.",
    [ringBell("bell-wolves", WOLVES, at.n!, "Ring the bell: the wolf run", "You ring the bell. Three wolves get up, unhurriedly, as if they'd been expecting you for some time.",
      ["say:Back! Go on, get back, the lot of you!", "say:cast fire bolt at the nearest wolf"], ["fight", "typed"])]),
  sign("battlefield", "q", "The battlefield on screen", ["The battlefield on screen"],
    "A fight is drawn on the place's own map with its roof off: blue tiles where you can move, your target in brackets, the dust in brown, the fire, the scorch after the blast, the world's spills, and the people not in the fight standing back. Bolts, fireballs, sparks on hits, damage numbers and the blast, with its shake. Beside it: the initiative list (health words, x for down, ! for yielded), the target, whose turn it is, the options as buttons, and the log with its 🎲 lines."),
  sign("pacing", "s", "Pacing and targeting", ["Pacing and targeting", "Moving"],
    "The other side's turns play out one at a time, with a beat between them (KM_APP_COMBAT_DELAY_MS, 450 ms) under \"The others act…\". Targets are held by who they are, listed nearest first: Tab, Shift-Tab or 1-9 pick one, a click on someone (or their name in the initiative list) aims at them, and \"click to attack: +5\" says what a click would do."),
  sign("turn-options", "u", "Dodge, dash, disengage, end turn, let the dice decide", ["Dodge, dash, disengage, end turn, let the dice decide"],
    "g dodges (attacks on you have disadvantage until your next turn), d dashes (double movement), x disengages (move away without being swung at). e or Space ends your turn, which also ends by itself when there's nothing worth doing left. f lets the dice decide: the AI plays your turn, as a fighter, or as a wizard who has read about grain dust. m lists every option you have."),
  sign("after-fight", "x", "After the fight", ["After the fight", "Leaving, and how it ends"],
    "When it's over the fight is written back: your hit points, slots and conditions to the sheet (dodging and prone cleared; at 0, stable), and everyone's fate and where they ended up, the lanterns that fell and the floor that burned into the place's world. In the story the scene picks up for the aftermath; in the zoo you're back on the map, with a line in the notebook, and the ring as the fight left it."),
  sign("resuming", "y", "Resuming mid-fight", ["Resuming mid-fight", "Saving, resuming and recovering"],
    "A game saved mid-fight resumes on the battlefield (\"You pick yourself up where you left off: mid-brawl.\"): quit with Esc or Ctrl+C in the middle of a ring and Continue on the title screen. A fight saved by the old one-action stand-in would carry on as one, if you can find one."),
  sign("headless", "z", "Headless fights and the combat demo", ["Headless fights and the combat demo"],
    "The QA console fights by action id: attack_crake-1, attack_<target>_with_<weapon> (or _with_improvised), cast_fire-bolt_sallow, cast_fireball_at_<target> (or at tile coordinates, or _slot3 for a higher slot), use_brazier, shove_hep, push_hep, grapple_hep, urge_intimidation_yield_hep, check_perception_13, close_sallow, back_off, move_12_6, step_north, make_for_the_door, leave, dash, dodge, disengage, auto, end_turn, with a text grid and a key. Or it types, as the player does: qa say reads a line onto the same ids. The combat demo (src/game/combat/demo.ts) plays both sides by AI. The zoo's tour fights every ring this way, typing as it goes."),
  sign("typing", "V", "Talking in a fight", ["Typing in a fight"],
    "You can type in a fight, as in a scene: Enter (or a click on the box under the log), and say what you do. Plain words are said out loud, and whoever you say them to answers, in a line. *Asterisks* or (brackets) are done, and so are plain commands: attack the goblin boss, cast fire bolt at the nearest wolf, move to the brazier and kick it over, shove Hep over, end turn. It's read onto this turn's own options, done by the rules exactly as a click would do it, and then the GM says how it looked. Talking is free. Telling someone to give up, clear off or hold back is your action and a Charisma check, at disadvantage while they're keen on the fight; someone who'd gladly stop needs no roll, and someone who never would just answers back. What can't be done says why, and costs nothing. Offline, only the plain commands work, and anything else says so. Ring the bell and try it on Hep's porters, who have heard it all before.",
    [ringBell("bell-typing", PORTERS, at["!"]!, "Ring the bell, and say your piece: Hep's porters, typed at", "You ring the bell. Hep Grist looks up from her sack-needle. \"Talkers,\" she says, to nobody in particular. \"We get a lot of talkers.\"",
      ["say:Hep! Nobody's paying you enough to get set on fire. Clear off, and take your lads with you.", "say:cast fire bolt at hep", "say:end turn", "say:*I crack the nearest porter across the knuckles with my staff*", "say:end turn"], ["fight", "typed"])]),
  sign("down", "0", "Down, death saves and nearly dying", ["Down, death saves and nearly dying", "Knocked out, and coming to"],
    "At 0 hit points you make death saves at the start of your turns: a natural 20 gets you up, three successes and you're stable, three failures and you \"very nearly died\", because nobody dies in these fights. Everyone else is out cold, unless the damage was massive; the lantern-boy is only ever knocked flat. Back on the map you come round with 1 hit point. The wolves are the likeliest to show you."),
  sign("leaving", "8", "Leaving, and how it ends", ["Leaving, and how it ends"],
    "Stand in the ring's gate with five feet of movement to spare and press l: you've fled, and you're outside the gate. No enemy able to fight is a victory (a surrender, if the one in charge yielded); nobody able on your side is a defeat. Each ending has its line, then Enter: back to the map. The wolf run's bell has a second rope, for those who'd like to see the wolves and then not.",
    [{ id: "bell-flee", label: "Ring the wolf run's bell, then leave by the gate", at: at.n!, expect: ["fight", "fled"], plan: { fight: ["disengage", "make_for_the_door", "leave"] },
      run: () => ({ text: "You ring the bell, and keep a hand on the gate. The wolves get up. So, in a hurry, do you.", fight: WOLVES.id }) }]),
  sign("story-fights", "9", "The story's fights", ["Roll for initiative"],
    "In the story a fight is a scene's ending: the Heron's, on the Heron's own floor, with everyone where its world had them (rehearse it in the Theatre and take /end fight), and the tavern booth's, on its own floor. The scene harness's other scenes fight in a plain room with their exit script's goblins, wolves and bandits (rehearse the warren). If the two sides can't reach each other, the doors get thrown open in the scramble."),
];

export const arena: Wing = {
  id: ID,
  name: "the Arena",
  about: "Fights on the map, four rings of them: the Heron's grain floor, a brawl, a goblin pit with archers, and a wolf run.",
  entry: at["@"]!,
  cast: {
    sallow: { name: "Master Josiah Sallow", description: "A man in an excellent coat, with a cane that isn't one, and the patience of someone who signs other people's warrants." },
    "crake-1": { name: "the talking Crake", description: "A river-bruiser with a cudgel and opinions." },
    "crake-2": { name: "the silent Crake", description: "A river-bruiser with a cudgel and no opinions he'll share." },
    "lantern-boy": { name: "the lantern-boy", description: "A yawning boy with a lit lantern on a pole, in the middle of the grain dust, which is the whole problem." },
    hep: { name: "Hepzibah Grist", description: "Hep Grist, the porters' forewoman: forearms like hams and a sack-needle behind one ear." },
  },
  map: {
    grid: GRID,
    legend: {
      "#": T("wall", { style: "stone", height: 3 }), "%": T("wall", { style: "stone", height: 1 }), ".": FLAGS,
      B: T("wall", { style: "timber", height: 2 }), D: T("door", { style: "timber", height: 2 }), "=": T("fence", { style: "fence" }), E: T("door", { style: "fence", height: 1 }),
      X: T("door", { style: "stone", height: 1 }),
      f: GRAIN, h: BOARDS, p: DIRT, r: GRASS,
      ...floorFor(ON_GRAIN, GRAIN), ...floorFor(ON_HEPS, BOARDS), ...floorFor(ON_PIT, DIRT), ...floorFor(ON_RUN, GRASS), ...floorFor(ON_FLAGS, FLAGS),
      ...floorFor(TREES, T("tree")),
    },
    regions: [
      { id: "zoo-arena-grain", name: "the grain floor", rect: { x: 2, y: 2, w: 18, h: 11 }, description: "A re-sacking floor like the Heron's, thick with grain dust, with lanterns in the beams and a brazier. A sign says NO NAKED LIGHTS." },
      { id: "zoo-arena-porters", name: "the porters' floor", rect: { x: 24, y: 2, w: 12, h: 11 }, description: "Bare boards, a trestle and a lantern on a hook: the porters' floor." },
      { id: "zoo-arena-pit", name: "the goblin pit", rect: { x: 2, y: 18, w: 18, h: 13 }, description: "A sandy pit with rocks to hide behind, which the goblins know about." },
      { id: "zoo-arena-run", name: "the wolf run", rect: { x: 24, y: 18, w: 12, h: 13 }, description: "Long grass and two trees, and the wolves in it." },
    ],
    exits: [{ at: { x: 0, y: 15 }, to: toHall(ID), label: "Back to the hall" }],
  },
  world: {
    name: "The Arena", description: "Four rings round a flagged concourse, with bells by their gates.",
    size: { w: 50 * 5, h: 33 * 5 },
    areas: [
      { id: "concourse", name: "the concourse", rect: rect(0, 0, 50, 33) },
      { id: "grain-floor", name: "the grain floor", rect: rect(2, 2, 18, 11), states: ["dusty"], description: "Thick with grain dust, hanging in the lantern light." },
      { id: "porters-floor", name: "the porters' floor", rect: rect(24, 2, 12, 11) },
      { id: "goblin-pit", name: "the goblin pit", rect: rect(2, 18, 18, 13) },
      { id: "wolf-run", name: "the wolf run", rect: rect(24, 18, 12, 13) },
    ],
    things: [
      { id: "wheat-sacks-1", name: "a stack of wheat-ear sacks", in: "grain-floor", at: feet(at.w!), size: "huge", material: "cloth", tags: ["cover"] },
      { id: "wheat-sacks-2", name: "another stack of wheat-ear sacks", in: "grain-floor", at: feet(at.W!), size: "huge", material: "cloth", tags: ["cover"] },
      { id: "wheat-sacks-3", name: "a third stack of wheat-ear sacks", in: "grain-floor", at: feet(at.v!), size: "huge", material: "cloth", tags: ["cover"] },
      { id: "heron-sacks-1", name: "a stack of heron sacks", in: "grain-floor", at: feet(at.k!), size: "huge", material: "cloth", tags: ["cover"] },
      { id: "heron-sacks-2", name: "another stack of heron sacks", in: "grain-floor", at: feet(at.K!), size: "huge", material: "cloth", tags: ["cover"] },
      { id: "arena-trestles", name: "the trestles", in: "grain-floor", at: feet(at.T!), size: "large", material: "wood", tags: ["furniture", "cover"] },
      { id: "arena-brazier", name: "a brazier for cold hands", in: "grain-floor", at: feet(at.Z!), size: "medium", material: "iron", tags: ["fire", "light"], states: ["lit"], description: "Burning merrily in the middle of the grain dust." },
      { id: "arena-lantern-west", name: "a lantern hung from the beams", in: "grain-floor", at: feet(at["1"]!), size: "small", material: "iron", tags: ["light"], states: ["lit", "hanging"] },
      { id: "arena-lantern-east", name: "a lantern hung from the beams", in: "grain-floor", at: feet(at["2"]!), size: "small", material: "iron", tags: ["light"], states: ["lit", "hanging"] },
      { id: "arena-no-lights", name: "a sign: NO NAKED LIGHTS", kind: "feature", in: "grain-floor", at: feet(at.N!), size: "medium", material: "wood", tags: ["sign"], description: "Painted in red. Everyone ignores it, and the brazier is right under it." },
      { id: "porters-trestle", name: "a trestle", in: "porters-floor", at: feet(at.t!), size: "large", material: "wood", tags: ["furniture", "cover"] },
      { id: "hook-lantern", name: "a lantern on a hook", in: "porters-floor", at: feet(at["4"]!), size: "small", material: "iron", tags: ["light"], states: ["lit", "hanging"] },
      { id: "porter-1", name: "a floury porter", kind: "person", in: "porters-floor", at: feet(at.P!), description: "White to the elbows, and spoiling for it." },
      { id: "porter-2", name: "a porter with a sack-needle", kind: "person", in: "porters-floor", at: feet(at.Q!), description: "He holds the needle the way other people hold a knife." },
      { id: "porter-3", name: "a big porter", kind: "person", in: "porters-floor", at: feet(at.R!), description: "Big. That's the whole description; it's enough." },
      { id: "rock-1", name: "a boulder", in: "goblin-pit", at: feet(at.j!), size: "large", material: "stone", tags: ["cover"] },
      { id: "rock-2", name: "another boulder", in: "goblin-pit", at: feet(at.J!), size: "large", material: "stone", tags: ["cover"] },
      { id: "rock-3", name: "a flat rock", in: "goblin-pit", at: feet(at.i!), size: "large", material: "stone", tags: ["cover"] },
      { id: "goblin-boss", name: "the goblin boss", kind: "person", in: "goblin-pit", at: feet(at.O!), description: "A goblin in a helmet two sizes too big, which he says is a crown." },
      { id: "goblin", name: "a goblin", kind: "person", in: "goblin-pit", at: feet(at.U!), description: "A goblin with a scimitar and a grudge he hasn't picked a target for yet." },
      { id: "goblin-archer-1", name: "a goblin archer", kind: "person", in: "goblin-pit", at: feet(at.A!), description: "Keeps its distance, and its arrows." },
      { id: "goblin-archer-2", name: "another goblin archer", kind: "person", in: "goblin-pit", at: feet(at.Y!), description: "Keeps its distance, and its opinions." },
      { id: "wolf-1", name: "a grey wolf", kind: "creature", in: "wolf-run", at: feet(at.F!) },
      { id: "wolf-2", name: "a big grey wolf", kind: "creature", in: "wolf-run", at: feet(at.H!) },
      { id: "wolf-3", name: "a lean grey wolf", kind: "creature", in: "wolf-run", at: feet(at.I!) },
      { id: "arena-bench", name: "a bench for the walking wounded", kind: "feature", in: "concourse", at: feet(at.M!), size: "medium", material: "wood", description: "Sat on by everyone who rang a bell and regretted it." },
    ],
    people: {
      player: { in: "concourse", at: feet(at["@"]!) },
      sallow: { in: "grain-floor", at: feet(at.S!), note: "on the grain floor, pulling on his gloves" },
      "crake-1": { in: "grain-floor", at: feet(at.C!) },
      "crake-2": { in: "grain-floor", at: feet(at.c!) },
      "lantern-boy": { in: "grain-floor", at: feet(at.L!) },
      hep: { in: "porters-floor", at: feet(at.G!) },
    },
  },
  stats: {
    "porter-1": { statblock: "bandit" }, "porter-2": { statblock: "bandit" }, "porter-3": { statblock: "bandit" },
    "goblin-boss": { statblock: "goblin-boss", weapon: "scimitar" }, goblin: { statblock: "goblin-warrior", weapon: "scimitar" },
    "goblin-archer-1": { statblock: "goblin-warrior", weapon: "shortbow" }, "goblin-archer-2": { statblock: "goblin-warrior", weapon: "shortbow" },
    "wolf-1": { statblock: "wolf" }, "wolf-2": { statblock: "wolf" }, "wolf-3": { statblock: "wolf" },
  },
  dressing: {
    ground: { concourse: "flags", "grain-floor": "boards", "porters-floor": "boards", "goblin-pit": "sand", "wolf-run": "grass" },
    indoor: ["grain-floor", "porters-floor"],
    haze: [{ area: "grain-floor", kind: "dust", density: 0.3 }],
  },
  exhibits,
};
