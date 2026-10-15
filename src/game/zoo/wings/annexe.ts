import { move } from "../../map/index.ts";
import { T, type DecorDef } from "../../map/tiles.ts";
import type { MapActor, StoryState, Tile2 } from "../../types.ts";
import { exploreState, town } from "../../town.ts";
import { feet, marks, rect, type Ctx, type Exhibit, type Outcome, type Trigger, type Wing } from "../model.ts";
import { COBBLES, floorFor, stage } from "./common.ts";
import { toHall } from "./hall.ts";

/**
 * The Town Annexe: a street in the manner of Caerwyn, for the map itself. Walking and bumping into
 * things (the house's lines for every kind of wall, the goose, the cabbage cart), locked doors with
 * something to say, a shop with opening hours, people about by the hour, decor with lines, a
 * lost-property office for taking and giving things, and the ways out.
 */

const GRID = `
##################################################
%.BBBBBBB.HHHHHHH.PPPPPPPPP...LLLLLLLLLLL........#
%.BbbbbbB.H,,,,,H.PpppppppP...LllllllUllL........#
%.BbbbbbB.H,,,,,H.PpppppppP...LllCllllllL........#
%.BbbbbbB.H,,,,,H.PpppppppP...LlllllllKlL........#
%.BBBDBBB.HHHdHHH.PPPP+PPPP...LlNlllllllL........#
%....q.......r........s.......LLLLL+LLLLL........#
%.......o...............h........................#
%................................i.......z.......#
%.....j..................c..t.........~.....k....#
%................................................#
%.........S..........Y..................R........#
%................................................#
%...............W...........Z....................#
%...........f...............................Q....#
%................................................>
%.............n....e.......J.....................#
%................................................#
%.......................a.....v..................#
%.w.....u........................................#
%................................................#
%...A..E..F..G..I..M..O....g...m..x3.............#
%...1..2..3..4..5..6..7...........3..............#
%................................................#
X.@..............................................#
%...y............................................#
%.0..............................................#
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%#
`;

const ON_STREET = "qrsicSWYZRjJkQ~AEFGIMOgmxwuohneavtfyz@0";
const IN_OFFICE = "CUKN";
const at = marks(GRID, ON_STREET + IN_OFFICE);
const ID = "zoo-annexe";
const OFFICE_FLOOR = T("boards", { roof: "tar", roofHeight: 2 });

const decor = (id: string, name: string, glyph: string, color: string, text: string, extra: Partial<DecorDef> = {}) =>
  T("cobbles", {}, { id: `${ID}:${id}`, name, glyph, color, text, ...extra });

/** Walk into whatever's at a tile next to you, as a key would: what the map says when you do. */
function bump(z: Ctx, to: Tile2, lead: string): Outcome {
  const r = move(z.ex, Math.sign(to.x - z.ex.at.x), Math.sign(to.y - z.ex.at.y));
  return { text: `${lead} ${r.moved ? `You go through. ${r.message ?? ""}` : r.message ?? "Nothing stops you, which is its own kind of surprise."}`.trim() };
}

/** A walk-into-it trigger: stand on the mark, and walk into what's in front. */
const walkInto = (id: string, label: string, stand: Tile2, into: Tile2, extra: Partial<Trigger> = {}): Trigger =>
  ({ id, label, at: stand, stand: true, station: { name: "a chalk cross (walk on from here)", glyph: "×", color: "#e8e4d8" }, run: z => bump(z, into, ""), ...extra });

const TIMES: StoryState["time"][] = ["morning", "afternoon", "evening", "night", "next-morning"];

/** Who's about in the annexe by the hour (the town's presence works the same way, with more people). */
export function annexeByTheHour(story: StoryState, mapId: string): MapActor[] {
  if (mapId !== ID) return [];
  const person = (id: string, name: string, glyph: string, color: string, spot: Tile2, text: string): MapActor =>
    ({ id: `${ID}:${id}`, name, kind: "person", glyph, color, map: ID, at: { ...spot }, blocks: true, interaction: { kind: "examine", text, label: `Talk to ${name}` } });
  switch (story.time) {
    case "morning": return [person("sweeper", "a street sweeper", "s", "#b8ad9c", { x: 18, y: 15 }, "'Swept this twice already,' says the sweeper. 'The Assembly walks on it Thursday. The pigeons walk on it now.'")];
    case "afternoon": return [person("pie-seller", "a pie-seller", "p", "#e8b15a", { x: 18, y: 15 }, "'Pies!' says the pie-seller. 'Hot pies! Lukewarm pies, if you're slow about it!'")];
    case "evening": return [person("lamplighter", "the lamplighter", "l", "#e8c070", { x: 7, y: 10 }, "The lamplighter touches his pole to the lamp. 'Dusk,' he says, as if he'd arranged it.")];
    case "night": return [person("watchman", "a night-watchman", "w", "#9ab0c0", { x: 25, y: 12 }, "'All's well,' says the watchman, and then, more honestly: 'Mostly.'")];
    case "next-morning": return [person("crowd", "a crowd come for the procession", "c", "#b8ad9c", { x: 18, y: 14 }, "A crowd, early for the procession and already disappointed in it.")];
  }
}

const sign = (id: string, mark: string, title: string, shows: string[], text: string, triggers: Trigger[] = [], extra: Partial<Exhibit> = {}): Exhibit =>
  ({ id, title, shows, sign: at[mark]!, text, triggers, ...extra });

const station = (name: string, glyph: string, color = "#c8b28a") => ({ name, glyph, color });

const exhibits: Exhibit[] = [
  sign("annexe", "0", "The Town Annexe", ["The explore screen"],
    "A street in the manner of Caerwyn, for trying the map itself: walking, bumping, doors, looking, menus, things to take and give. Caerwyn proper is the story's; nothing done here reaches it."),
  sign("walking", "w", "Walking", ["Walking by key", "Click to walk"],
    "Arrows or WASD move with the screen: up is a step north-east on the map, whose north is up-left. A key that would catch on a corner is steered along the street; Home, PgUp, End and PgDn step along the map's own axes. Click a tile and you walk the shortest way there, a step at a time (any key stops it). Nobody squeezes diagonally between two walls: try it at the squeeze.",
    [walkInto("squeeze", "Try to squeeze between the two walls", at.x!, { x: at.x!.x + 1, y: at.x!.y + 1 })]),
  sign("bumping", "u", "The bump alley (the house's lines)", ["Bumping into things (the house quips)"],
    "Walk into something and the house has a line for it, never the same one twice running: walls by what they're built of (palace, plaster, brick, timber, fence, hedge, glass), the river, trees, the edge of the map, and people and things in the way, some with lines of their own (the goose has several). That's a wall. Caerwyn is full of them.",
    [
      walkInto("bump-palace", "Walk into the palace wall", at.A!, { x: 4, y: 22 }),
      walkInto("bump-plaster", "Walk into the plaster wall", at.E!, { x: 7, y: 22 }),
      walkInto("bump-brick", "Walk into the brick wall", at.F!, { x: 10, y: 22 }),
      walkInto("bump-timber", "Walk into the tarred timber", at.G!, { x: 13, y: 22 }),
      walkInto("bump-fence", "Walk into the fence", at.I!, { x: 16, y: 22 }),
      walkInto("bump-hedge", "Walk into the hedge", at.M!, { x: 19, y: 22 }),
      walkInto("bump-window", "Walk into the window", at.O!, { x: 22, y: 22 }),
      { id: "bump-goose", label: "Walk into the goose", at: "annexe-goose", run: z => bump(z, feetTile(z, "annexe-goose"), "") },
      { id: "bump-pigeons", label: "Walk into the pigeons", at: "annexe-pigeons", run: z => bump(z, feetTile(z, "annexe-pigeons"), "") },
      { id: "bump-cabbages", label: "Walk into the cabbage cart", at: at.Z!, run: z => bump(z, at.Z!, "") },
    ]),
  sign("locked", "o", "Locked doors", ["Locked doors with something to say"],
    "A locked door says why, when it has something particular to say: in the story, the granary's padlock, the watch house's note, the Heron barred from inside. Anywhere else: everyone's out hanging bunting. The brick house has a note; the plaster house is just out.",
    [
      walkInto("try-brick-door", "Try the brick house's door", at.q!, { x: 5, y: 5 }),
      walkInto("try-plaster-door", "Try the plaster house's door", at.r!, { x: 13, y: 5 }),
    ]),
  sign("hours", "h", "The pie shop (opening hours)", ["Doors, ways out and opening hours"],
    "Places open at their scene's time: in the story the Drowned Rat OPENS AT DUSK, and the palace guards cross their halberds until the King's morning; after its scene the granary yard is locked up. The pie shop opens once the last pie is sold, which happens in the Theatre's pie booth. Try it before; try it after.",
    [walkInto("try-pie-shop", "Try the pie shop's door", at.s!, { x: 22, y: 5 })]),
  sign("looking", "n", "Looking", ["Looking around, and at things", "Decor with lines"],
    "Look around (l) says where you are and on what ground, who's about, what's here and in what state, the ways out, and the hour's line. Right-click a tile and Look at it from where you stand: a person's or a thing's own line, where a way out goes, what a building is, or the house's line for a wall, the water, a tree or the ground.",
    [
      { id: "look-around", label: "Look around", at: at.n!, run: z => ({ text: town.act(z.game, z.session, "look").text }) },
    ]),
  sign("interact", "e", "Interact (e)", ["Interact (e)"],
    "e, Enter or Space does whatever's in front of you: talk to whoever's waiting with a scene, talk to whoever you face, go through a door or a way out ahead, step into a scene's place, or look at what's there. In the zoo it also sets off the lever, bell or chalk circle in front of you. The sidebar's e line says what it would do."),
  sign("menus", "a", "The right-click menu, hover and Nearby", ["The right-click menu", "Pointer hover", "The mouse"],
    "Right-click a tile, or someone in the Nearby list, for a menu beside the pointer: what's there, and what you can do with it (Talk to, Look at, Go through, Try the door, Walk here). Everything but looking walks you over first. The tile under the pointer lights up and the bottom line says what it is, which way, how far, and what a right-click offers. Every exhibit's trigger is in its tile's menu."),
  sign("lead", "v", "The lead (the next exhibit)", ["The lead"],
    "A pulsing gold ▼ with a ! floats over where the story's heading; off screen, an arrow at the edge names it. The sidebar shows the way (\"the Drowned Rat ↓ 24 paces\"), and g walks you there a step at a time, through doors. In the zoo the lead is the next exhibit you haven't seen."),
  sign("by-the-hour", "t", "The street by the hour", ["The town by the hour", "Lights on and off"],
    "Who's about follows the time of day: in Caerwyn, a sweeper and a goose in the morning, a pie-seller in the afternoon, the lamplighter at dusk, barge lanterns and a watchman at night, the procession's crowds the next morning, each with a line. The lamp posts light at dusk. Wind the street clock and see who comes.",
    [{ id: "street-clock", label: "Wind the street clock on", at: at.c!, station: station("the street clock", "◷", "#e8d8a0"),
      run: z => { const next = TIMES[(TIMES.indexOf(z.game.story.time) + 1) % TIMES.length]!; z.game.story.time = next; exploreState(z.game); return { text: `The street clock strikes. It's ${next.replace("-", " ")} in the annexe, and in the whole zoo.` }; } }],
    { tour: ["street-clock", "street-clock", "street-clock", "street-clock", "street-clock"] }),
  sign("decor", "f", "The street furniture (decor with lines)", ["Decor with lines"],
    "Things in the street have something to say when you look at them or walk into them: the statue (a pigeon on its head), the well (NO WISHING), the stocks (RESERVED), the cabbage cart, crates marked FRAGILE, the price board, the washing line overhead, the lamp posts. Caerwyn has more: the Corn Exchange's board says BREAD: DEAR. FLOUR: DEARER. GRAIN: ASK."),
  sign("lost-property", "i", "The lost-property office (things to take and give)", ["Inventory and coin", "Gear in the world"],
    "Every item has one owner: a person, a container or a room. Take the umbrella and it's yours (c, the sheet, lists what you carry); hand it over and it's the clerk's. Open the chest and take what's in it; put a penny in. Fixed things stay where they are, however you ask: the bench is screwed to the floor, and the clerk has heard every argument. In a scene, the stage manager writes these as give, drop and state.",
    [
      { id: "take-umbrella", label: "Take the umbrella from the stand", at: "umbrella-stand", when: z => z.world.entities.umbrella?.parent === "umbrella-stand", run: z => stage(z, [{ op: "give", what: "umbrella", to: "player" }], "You take the umbrella. The clerk notes it in a ledger, against you.") },
      { id: "give-umbrella", label: "Hand the umbrella to the clerk", at: "lost-clerk", when: z => carried(z, "umbrella"), run: z => stage(z, [{ op: "give", what: "umbrella", to: "lost-clerk" }], "You hand the clerk the umbrella. He puts it back on the stand, slowly, to make a point.") },
      { id: "open-chest", label: "Open the chest", at: "lost-chest", when: z => !z.thing("lost-chest").states.includes("open"), run: z => stage(z, [{ op: "state", what: "lost-chest", add: ["open"], remove: ["closed"] }], "You open the chest. Inside: a florin, three left gloves and a sense of loss.") },
      { id: "take-florin", label: "Take the florin from the chest", at: "lost-chest", when: z => z.thing("lost-chest").states.includes("open") && z.world.entities.florin?.parent === "lost-chest", run: z => stage(z, [{ op: "give", what: "florin", to: "player" }], "You take the florin. Lost property is, after all, property.") },
      { id: "chest-penny", label: "Put a penny in the chest", at: "lost-chest", when: z => z.thing("lost-chest").states.includes("open"), run: z => stage(z, [{ op: "give", what: "pennies", to: "lost-chest", quantity: 1 }], "You put a penny in the chest. It's lost now; that's the system.") },
      { id: "take-bench", label: "Try to carry off the bench", at: "lost-bench", run: z => stage(z, [{ op: "move", what: "lost-bench", to: "player" }], "You try to carry off the bench.") },
    ]),
  sign("roofs", "z", "The office's roof (roofs off and cutaways)", ["Roofs off and cutaways", "X-ray"],
    "Walk into the lost-property office: its roof comes off, and its front walls (south and west) are cut down to a ledge so you can see in. Outdoors nothing is cut. From outside, whoever's in there shows through the roof in a greyer patch: that's the x-ray, which the Hall of Looks has more of."),
  sign("travel", "y", "Ways out", ["Doors, ways out and opening hours"],
    "Ways out to other maps are doors and paths at a map's edge: in Caerwyn the palace gate, the Rat's door on the stairs, along the wharf to the Heron. Walk onto one (or right-click it: Go through) and you're on the other map, with whoever walks with you beside you. The door behind you goes back to the hall; every wing's door goes on to its wing."),
];

/** Where something of the wing's world is, as a tile. */
function feetTile(z: Ctx, id: string): Tile2 {
  const p = z.at(id);
  return { x: Math.floor(p.x / 5), y: Math.floor(p.y / 5) };
}

/** Is the visitor carrying it (in the world while they act)? */
const carried = (z: Ctx, id: string) => z.world.entities[id]?.parent === "player" || !!z.session.carried?.some(e => e.id === id);

export const annexe: Wing = {
  id: ID,
  name: "the Town Annexe",
  about: "A street in the manner of Caerwyn, for the map itself: walking, bumping, locked doors, opening hours, the hour, decor, things to take and give, roofs, ways out.",
  entry: at["@"]!,
  map: {
    grid: GRID,
    legend: {
      "#": T("wall", { style: "stone", height: 3 }), "%": T("wall", { style: "stone", height: 1 }), ".": COBBLES, X: T("door", { style: "stone", height: 1 }), ">": T("door", { style: "brick", height: 2 }),
      B: T("wall", { style: "brick", height: 3 }), b: T("boards", { roof: "brick", roofHeight: 3 }), D: T("door", { style: "brick", height: 3, blocks: true }),
      H: T("wall", { style: "plaster", height: 3 }), ",": T("boards", { roof: "plaster", roofHeight: 3 }), d: T("door", { style: "plaster", height: 3, blocks: true }),
      P: T("wall", { style: "timber", height: 2 }), p: T("boards", { roof: "timber", roofHeight: 2 }),
      L: T("wall", { style: "tar", height: 2 }), l: OFFICE_FLOOR, "+": T("door", { style: "timber", height: 2 }),
      "1": T("wall", { style: "palace", height: 2 }), "2": T("wall", { style: "plaster", height: 2 }), "3": T("wall", { style: "brick", height: 2 }), "4": T("wall", { style: "tar", height: 2 }),
      "5": T("fence", { style: "fence" }), "6": T("wall", { style: "hedge", height: 2 }), "7": T("window", { style: "plaster", height: 2 }),
      S: decor("statue", "the statue of Good Queen Maud", "Å", "#b8c4c8", "Good Queen Maud the Adequate, in bronze, with a pigeon on her head. The pigeon has the better profile.", { blocks: true }),
      W: decor("well", "the annexe well", "◘", "#8aa0b0", "A well. A sign says NO WISHING: the last wish caused a shortage of pennies and a surplus of ponies.", { blocks: true }),
      Y: decor("stocks", "the stocks", "╥", "#a0703a", "The stocks, freshly painted. A sign on them says RESERVED, and doesn't say for whom.", { blocks: true }),
      Z: decor("cabbages", "a cabbage cart", "▬", "#7ab05a", "A cart of cabbages at Assembly prices. The cabbages are the bargain.", { blocks: true }),
      R: decor("crates", "crates marked FRAGILE", "■", "#a07a52", "Crates marked FRAGILE, stacked by somebody paid by the crate and not by the stack.", { blocks: true }),
      Q: decor("price-board", "the price board", "▤", "#c8a060", "BREAD: DEAR. FLOUR: DEARER. GRAIN: ASK. QUESTIONS: NOT TAKEN.", { blocks: true }),
      "~": decor("washing-line", "a washing line", "─", "#e8e4d8", "Somebody's washing, overhead, drying in the confident way washing does just before it rains.", { states: ["overhead"] }),
      j: decor("lamp-1", "a lamp post", "¤", "#e8c070", "A lamp post, freshly painted and already leant on.", { states: ["lamp", "post"] }),
      J: decor("lamp-2", "a lamp post", "¤", "#e8c070", "A lamp post. It lights at dusk, if you wind the clock on.", { states: ["lamp", "post"] }),
      k: decor("lamp-3", "a lamp post", "¤", "#e8c070", "A lamp post, leaning very slightly towards the pie shop.", { states: ["lamp", "post"] }),
      ...floorFor(ON_STREET.replace(/[SWYZRQ~jJk]/g, ""), COBBLES), ...floorFor(IN_OFFICE, OFFICE_FLOOR),
    },
    regions: [
      { id: "zoo-annexe-square", name: "the little square", rect: { x: 8, y: 9, w: 16, h: 8 }, description: "A little square with a statue, a well and the stocks." },
      { id: "zoo-annexe-brick-house", name: "the brick house", rect: { x: 2, y: 1, w: 7, h: 5 }, description: "A narrow brick house, shut up.", locked: "Locked. A note on the door: GONE TO SEE ABOUT A DOG. BACK WHEN THE DOG IS SEEN ABOUT." },
      { id: "zoo-annexe-pie-shop", name: "the pie shop", rect: { x: 18, y: 1, w: 9, h: 5 }, description: "A pie shop. Its sign says CLOSED UNTIL THE LAST PIE IS SOLD.", shut: "CLOSED UNTIL THE LAST PIE IS SOLD, says the sign. (The last pie is in the Theatre's pie booth.)", opensFor: "zoo-pie-stall" },
      { id: "zoo-annexe-office", name: "the lost-property office", rect: { x: 31, y: 2, w: 9, h: 4 }, description: "The lost-property office: a counter, a clerk, an umbrella stand and a chest." },
    ],
    exits: [{ at: { x: 0, y: 24 }, to: toHall(ID), label: "Back to the hall" }],
  },
  world: {
    name: "The Town Annexe", description: "A street in the manner of Caerwyn, with houses, a square and a lost-property office.",
    size: { w: 50 * 5, h: 28 * 5 },
    areas: [
      { id: "street", name: "the street", rect: rect(0, 0, 50, 28) },
      { id: "office", name: "the lost-property office", rect: rect(31, 2, 9, 4) },
    ],
    things: [
      { id: "lost-clerk", name: "the lost-property clerk", kind: "person", in: "office", at: feet(at.C!), description: "He has found everything anyone has ever lost, and given back almost none of it." },
      { id: "umbrella-stand", name: "an umbrella stand", in: "office", at: feet(at.U!), size: "small", material: "iron", tags: ["container"] },
      { id: "umbrella", name: "a black umbrella", kind: "item", in: "umbrella-stand", size: "small", material: "cloth" },
      { id: "lost-chest", name: "a chest of lost things", in: "office", at: feet(at.K!), size: "medium", material: "wood", tags: ["container"], states: ["closed"] },
      { id: "florin", name: "a florin", kind: "item", in: "lost-chest", size: "tiny", material: "silver" },
      { id: "left-gloves", name: "three left gloves", kind: "item", in: "lost-chest", size: "tiny", material: "leather" },
      { id: "lost-bench", name: "a bench screwed to the floor", in: "office", at: feet(at.N!), size: "large", material: "wood", tags: ["fixed", "furniture"] },
      { id: "annexe-goose", name: "a goose", kind: "creature", in: "street", at: feet(at.g!), description: "A goose. It belongs to nobody and fears nothing." },
      { id: "annexe-pigeons", name: "pigeons", kind: "creature", in: "street", at: feet(at.m!), description: "Pigeons, waiting for something to happen to the bunting." },
    ],
    people: { player: { in: "street", at: feet(at["@"]!) } },
  },
  dressing: { ground: { street: "cobbles", office: "boards" }, indoor: ["office"] },
  exhibits,
};
