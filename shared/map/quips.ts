// Copied from the prototype's src/game/map/quips.ts at 44c6d4a, whole; MapActor from ./types.ts. (K copies it: QuipMemory is the explore row's.)
import type { MapActor } from "./types.ts";

/**
 * The house's lines for walking into things and looking at places, by what it was: walls (by what
 * they're built of), the river, doors, carts, geese, the palace guard, the statue. Each is picked
 * from a few, never the line just said, so bumping the same wall twice gets you a second opinion.
 * The memory is two fields kept in the explore state (it's saved with it).
 */

export interface QuipMemory {
  /** How many lines have been said (it moves each pick along). */
  quips?: number;
  /** The last one, never said twice running. */
  lastQuip?: string;
  /** The kinds of wall walked into so far: the first of each kind gets its own line. */
  styles?: string[];
}

/** What the player walked into. */
export type Bump =
  | { kind: "wall"; style?: string; terrain?: string }
  | { kind: "water" }
  | { kind: "tree" }
  | { kind: "edge" }
  | { kind: "squeeze" }
  /** A locked door, with the place's own line if it has one. */
  | { kind: "door"; line?: string }
  /** A place shut at this hour (the Rat before dusk, the palace), with its own line. */
  | { kind: "shut"; line: string }
  | { kind: "actor"; actor: MapActor };

const WALLS = [
  "You walk into the wall. The wall wins.",
  "The wall declines to move. It has seen off better than you.",
  "That's a wall. Caerwyn is full of them; it's how you can tell where the buildings are.",
  "You and the wall have a frank exchange of views. The wall's view prevails.",
  "A wall. It was here before the Assembly and it'll be here after, which is more than can be said for the bunting.",
  "You check the wall for secret doors. It's wall all the way through, and proud of it.",
  "The wall stands firm, upright and unmoved, like a magistrate before lunch.",
  "Walls are the one thing in Caerwyn that haven't put their prices up for the Assembly.",
];

/** Walls by what they're built of (the map's styles). */
const WALL_STYLES: Record<string, string[]> = {
  palace: ["The palace wall: pale stone, new bunting, and no way in for anyone who has to ask.", "Palace masonry. Somewhere behind it, someone is polishing something that was polished this morning."],
  plaster: ["Somebody's front wall. They're out hanging bunting; the wall stayed in.", "Plaster over brick over somebody's strong opinions about plaster."],
  brick: ["Good Caerwyn brick, laid in the reign of a king who is now mostly on coins."],
  civic: ["The Corn Exchange: civic stone, built to impress farmers and mostly impressing pigeons."],
  granary: ["The King's Granary. Very good at keeping things in; except, it turns out, grain."],
  timber: ["A warehouse wall, tarred against the river. The river is winning, slowly."],
  tar: ["Tarred planks: sticky to the touch, and to the conscience."],
  bank: ["The bank, holding the town up out of the river. You'd rather it kept at it."],
  stone: ["A low wall: good for sitting on, bad for walking through."],
  gilt: ["Gilt panelling. You decide not to scratch it to see how deep the gilt goes."],
  hull: ["The bar. You can lean on it, drink at it and be thrown over it, but not walk through it."],
  fence: ["A fence, doing the one thing fences do, and doing it well."],
  hedge: ["A hedge, thick with sparrows and the Assembly Committee's idea of topiary."],
  panel: ["The counting-box's panelling. Whatever's counted in there, it isn't you."],
};

const WINDOWS = [
  "You press your nose to the glass. Somebody inside presses theirs back. Neither of you learns anything.",
  "A window. You can see in, and you can't get in, which is the arrangement windows have with everyone.",
  "The glass holds. The face behind it draws the curtain, slowly, to make a point.",
];

/** Fences and hedges aren't walls, and won't be called it. */
const FENCES = [
  "A fence, doing the one thing fences do, and doing it well.",
  "You lean on the fence. The fence leans back.",
  "The fence is in the way. It's never had a day off, and it isn't starting now.",
];
const HEDGES = [
  "A hedge, thick with sparrows and the Assembly Committee's idea of topiary.",
  "You walk into the hedge. It keeps a twig, a sparrow's good opinion and a little of your dignity.",
  "The hedge rustles at you. Something in it disapproves.",
];

const WATER = [
  "The river is high, fast and freezing. You decide to stay the investigator rather than become evidence.",
  "The river slaps at the edge, brown and in a hurry. What goes in comes out at the sea, or doesn't.",
  "You'd swim it, but you'd rather not be found in it.",
  "Not without a boat. Not much more with one.",
  "The river has been carrying things off for a thousand years. It doesn't need you to make up the numbers.",
];

const TREES = ["A tree. It was here first.", "You walk into a tree. It takes it well.", "The tree stays where it is. Trees are good at that; it's most of what they do."];

const EDGES = ["That's the edge of the map. The council keeps meaning to put a fence up.", "Beyond here is more Caerwyn, and none of it is any of your business today."];

const SQUEEZES = ["Too tight a squeeze, even for an investigator.", "You'd have to go sideways, and investigators don't go sideways. Not in public."];

const DOORS = [
  "Locked. Everyone's out hanging bunting.",
  "Locked. Through the keyhole: a cat, unimpressed.",
  "You try the door. It tries you back, finds you wanting, and stays shut.",
  "Locked, with a new padlock bought specially for the Assembly.",
  "Shut fast. A note on it says AFTER THE ASSEMBLY, which is what everything in Caerwyn says this week.",
];

const STILL_SHUT = ["Still shut. You check again, in case it's changed its mind. It hasn't.", "Still shut. The doors in Caerwyn keep their hours better than the people do."];

/** Somebody in the way ({name}: who, as the map calls them, "a porter"; {Name} capitalised; {The}: "The porter", said again). */
const PEOPLE = [
  "{Name} is in the way, and has no plans to be anywhere else.",
  "You say 'excuse me' to {name}. {The} says it back, and neither of you moves.",
  "{Name} is in the way. This week in Caerwyn, everybody is in somebody's way.",
  "You and {name} do the little dance of two people trying to get past each other. {The} wins.",
];

/** Something in the way. */
const THINGS = [
  "{Name} is in the way, and doesn't care.",
  "{Name} is in the way. It was there first, and it has the paperwork.",
  "You walk into {name}. {The} is unmoved, in every sense.",
];

/** Particular people and things, by name. */
const BY_NAME: Array<[RegExp, string[]]> = [
  [/palace guard/, [
    "The palace guard looks through you at a point some distance behind your head. He's been practising all week.",
    "'Move along,' says the palace guard. You'd love to; he's in the way.",
    "The palace guard shifts his halberd a quarter of an inch. It is enough.",
  ]],
  [/goose/, [
    "The goose stands its ground. After a moment's thought, so do you, somewhere else.",
    "You step towards the goose. The goose steps towards you. You remember somewhere else to be.",
    "The goose hisses. You apologise. The apology is not accepted.",
  ]],
  [/pigeons?/, ["The pigeons regard you as a large, slow pigeon, and don't move.", "The pigeons won't budge. They've had a great deal of practice with the bunting."]],
  [/cabbage/, [
    "The cabbage cart is in the way. The cabbages are for sale, the cart is for sale, and if you ask nicely so is the way round it.",
    "You bump the cabbage cart. A cabbage rolls off and is sold before it stops rolling.",
    "The cabbage cart doesn't budge. Neither, wherever it's got to, does the donkey.",
  ]],
  [/purveyor's grain cart/, [
    "The Purveyor's grain cart, garlanded for the procession. Bump it again and someone will want a word about the people's confidence.",
    "The Purveyor's cart is mostly garland, and the garland is in the way.",
  ]],
  [/grain cart/, ["The grain cart, with one wheel off. It isn't going anywhere, and neither are you, that way."]],
  [/\bcart\b|wagon/, ["{Name} is in the way. Carts in Caerwyn don't so much park as settle."]],
  [/market stall/, [
    "The stall's in the way. The stallholder offers to sell you a way round it: commemorative, slightly wrong.",
    "You walk into a market stall and come away with a commemorative mug you don't remember paying for. You did.",
  ]],
  [/statue/, ["Good King Bertram the Moderately Wise is in the way, as he was for most of his reign.", "You bump into King Bertram. The pigeon on his head gives you a look."]],
  [/\bwell\b/, ["The town well. You decide against falling in: the sign says NO WISHING, and you'd hate to be fined."]],
  [/stocks/, ["The stocks. RESERVED, says the sign. You'd rather not be the reservation."]],
  [/crates?/, ["Crates marked FRAGILE. You decide not to be the one who tests it.", "Crates, stacked by porters paid by the crate and not by the stack."]],
  [/crane/, ["The wharf crane. Its treadwheel creaks at you in a way that is very nearly a threat."]],
  [/asleep/, ["The porter asleep on the steps doesn't stir. He's been asleep since the last Assembly, and means to wake for the next."]],
];

/** Looking at places: the ground, by what it is. */
const GROUND: Record<string, string[]> = {
  cobbles: ["Cobbles, swept for the Assembly and already unswept.", "Cobbles. Every one of them has been stood on by a king, a pig or a porter; mostly porters."],
  grass: ["Grass, trimmed to regulation length by the Assembly Committee (Verges Sub-Committee)."],
  dirt: ["Beaten earth, beaten some more."],
  boards: ["Boards: wet, warped, and on first-name terms with a great many boots."],
  stairs: ["Steps. Nobody has ever counted the same number twice."],
  water: ["The river's edge, ankle-deep and opinionated."],
  bridge: ["A gangplank, springy in a way you'd rather it wasn't."],
  floor: ["Flagstones. If they've any secrets, they're keeping them."],
};

const LOOK_WALL = ["A wall. Caerwyn has a great many; this is one of the better ones.", "A wall, doing a wall's work: keeping the outside out, and the inside in, and the investigator on the street."];
const LOOK_TREE = ["A tree, being a tree in the professional manner."];
const LOOK_WATER = ["The river: brown, fast and freezing. What goes in comes out at the sea, or doesn't."];

/** A line from the pool, never the one just said (then another from the pool or the fallback). */
export function quip(memory: QuipMemory, pool: readonly string[], fallback: readonly string[] = []): string {
  const n = memory.quips ?? 0;
  const lines = pool.length ? pool : fallback;
  let line = lines[n % lines.length] ?? "";
  if (line === memory.lastQuip) {
    const others = [...new Set([...lines, ...fallback])].filter(l => l !== memory.lastQuip);
    if (others.length) line = others[n % others.length]!;
  }
  memory.quips = n + 1;
  memory.lastQuip = line;
  return line;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fill = (line: string, name: string) => line.replace(/\{Name\}/g, capital(name)).replace(/\{name\}/g, name).replace(/\{The\}/g, capital(name.replace(/^(a|an) /i, "the ")));

/** The house's line for walking into something. */
export function bumpLine(memory: QuipMemory, bump: Bump): string {
  switch (bump.kind) {
    case "wall": {
      if (bump.terrain === "window") return quip(memory, WINDOWS);
      if (bump.terrain === "fence" || bump.style === "fence") return quip(memory, FENCES);
      if (bump.style === "hedge") return quip(memory, HEDGES);
      const own = WALL_STYLES[bump.style ?? ""] ?? [];
      // The first walk into a kind of wall gets its own line (the palace's, the warehouse's); after that, any of the house's.
      if (own.length && !(memory.styles ?? []).includes(bump.style!)) {
        memory.styles = [...(memory.styles ?? []), bump.style!];
        return quip(memory, own, WALLS);
      }
      return quip(memory, [...own, ...WALLS]);
    }
    case "water": return quip(memory, WATER);
    case "tree": return quip(memory, TREES);
    case "edge": return quip(memory, EDGES);
    case "squeeze": return quip(memory, SQUEEZES);
    case "door": return quip(memory, bump.line ? [bump.line] : DOORS, DOORS);
    case "shut": return quip(memory, [bump.line], STILL_SHUT);
    case "actor": {
      const a = bump.actor;
      const person = a.kind === "person" || a.kind === "creature";
      const own = BY_NAME.find(([re]) => re.test(a.name.toLowerCase()))?.[1];
      return fill(quip(memory, own ?? (person ? PEOPLE : THINGS), person ? PEOPLE : THINGS), a.name);
    }
  }
}

/** The house's line for looking at a bit of the map with nothing on it: a wall, the river, a tree, the ground. */
export function placeLine(memory: QuipMemory, what: { terrain: string; style?: string }): string {
  const t = what.terrain;
  if (t === "window") return quip(memory, WINDOWS);
  if (t === "fence" || what.style === "fence") return quip(memory, FENCES);
  if (what.style === "hedge") return quip(memory, HEDGES);
  if (t === "wall" || t === "door") return quip(memory, [...(WALL_STYLES[what.style ?? ""] ?? []), ...LOOK_WALL]);
  if (t === "deep-water") return quip(memory, LOOK_WATER);
  if (t === "tree") return quip(memory, LOOK_TREE);
  return quip(memory, GROUND[what.style && GROUND[what.style] ? what.style : t] ?? GROUND.floor!);
}
