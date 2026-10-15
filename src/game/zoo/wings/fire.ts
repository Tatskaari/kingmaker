import { ELEMENTS } from "../../look/director.ts";
import { DAMAGE_COLOR } from "../../look/color.ts";
import { T } from "../../map/tiles.ts";
import { spill } from "../../../world/systems.ts";
import { marks, feet, point, rect, type Ctx, type Cue, type Exhibit, type Wing } from "../model.ts";
import { made, passTurn } from "../world.ts";
import { cast, COBBLES, DIRT, floorFor, resetLever, sandGlass, stage, strike } from "./common.ts";
import { toHall } from "./hall.ts";

/**
 * The Burning Gallery: what the look layer's effects look like, set off the way the game sets them
 * off. Spells are the visitor's own, cast through the rules at things in the gallery's world (so a
 * fighter's Fireball is nothing at all); what they burn, freeze or break is the world's physics; the
 * director turns the rules' lines and the world's changes into fireballs, bolts, sparks and numbers.
 * A few effects nothing in the game sets off yet (a thrown ball, a goose's "!", a dust cloud, embers)
 * are played here as they are, and their signs say so.
 */

const GRID = `
############################################
%............................=:::::::::::::#
%.......G........A..D..C.....=:::::::::U:::#
%............................=:::W:::::::::#
%.......F....................=::::::S::O:::#
%...............~............=:::::::::::::#
%.......E....^...............=:::::::::Y:::#
%.................b.2........=::::P::::::::#
%............*...............=:::::::::::::#
%.......4.d.r................=:::::::::::::#
%.............................===::========#
%.............K.....L.....M................#
%..H.5..................................R..#
%............................a.1..N..Q.....#
%.....e.......7.g...8.i...9................#
%........?..................j.......k......#
%.........<................................#
%.......s...........................BBBBBBB#
%.JI.........$..Z......V..[.........B:::::B#
%.....6...................v.........B:::(:B#
%..............................T..t.+:::::B#
X..]...f......n..............0.....{B:):::B#
%.@.x................m.&...l........B:::::B#
%...>...............................BBBBBBB#
%..........................................#
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%#
`;

const ON_DIRT = "SYWUPO()";
const ON_COBBLES = "1aADC2bEFG4dH5eJI6fK7gL8iM9jNQRkT0lV&mZ$n^*~r?<>st[v]@x{";
const at = marks(GRID, ON_DIRT + ON_COBBLES);
const ID = "zoo-fire";

const chalk = { name: "a chalk circle (cast from here)", glyph: "○", color: "#e8e4d8" };

/** The colour chart: a bolt from you in each element's colour, with its name over the chart. */
function colours(): Cue[] {
  return Object.entries(ELEMENTS).flatMap(([element, color], i): Cue[] => [
    element === "lightning" ? { kind: "effect", effect: "lightning", from: { id: "player" }, to: { id: "colour-chart" }, delay: i * 420 }
      : { kind: "effect", effect: element === "heal" ? "sparks" : "bolt", ...(element === "heal" ? { at: { id: "colour-chart" } } : { from: { id: "player" }, to: { id: "colour-chart" } }), color, delay: i * 420 },
    { kind: "float", at: { id: "colour-chart" }, text: element, style: "info", color, delay: i * 420 + 260 },
  ]);
}

/** The numbers board: a number in each damage type's colour, a heal and an "unharmed". */
function numbers(): Cue[] {
  const kinds = Object.keys(DAMAGE_COLOR).filter(k => k !== "heal" && k !== "piercing" && k !== "slashing");
  return [
    ...kinds.map((damage, i): Cue => ({ kind: "float", at: { id: "numbers-board" }, text: String(4 + i * 2), damage, delay: i * 260 })),
    { kind: "float", at: { id: "numbers-board" }, text: "+7", damage: "heal", delay: kinds.length * 260 },
    { kind: "float", at: { id: "numbers-board" }, text: "unharmed", style: "info", color: "#a8a49c", delay: kinds.length * 260 + 300 },
  ];
}

const exhibits: Exhibit[] = [
  {
    id: "fire-gallery", title: "The Burning Gallery", sign: at.x!, shows: [],
    text: "Effects for what happens, set off as the game sets them off. Spells here are yours, through the rules, from your own slots: the wizard's robes in the hall have the fire in them (any other robes get you a fizzle, which is also an exhibit). The lever by the door puts the gallery back after you've set fire to it.",
    triggers: [resetLever("fire-reset", at["]"]!)],
  },
  {
    id: "fireball", title: "Fireball", sign: at.a!, shows: ["Fireball", "Shockwave ring", "Flash", "Screen shake", "Ignite", "Damage numbers, heals and 'unharmed'", "Areas catch by shape", "Damage to things, and immunities"],
    text: "A glowing ball flies from the caster and bursts: a white flash, a shockwave, a churning sphere of fire, embers, smoke, a great deal of light, and the screen shakes. The rules catch everything within 20 feet of the aim (things don't dodge: one roll for them all): straw and hay burn, the stone fireman is unharmed, the puddle hisses and the oil catches. Stand in the chalk circle and cast it at the scarecrow. In a scene the GM's decider reads \"(I cast Fireball at the scarecrow)\" and does the same.",
    triggers: [{ id: "fireball-scarecrow", expect: ["fireball", "float:damage", "float:unharmed", "ignite"], label: "Cast Fireball at the scarecrow", at: at["1"]!, station: chalk, stand: true, run: z => cast(z, "fireball", ["scarecrow"]) }],
  },
  {
    id: "bolts", title: "Bolts", sign: at.b!, shows: ["Bolt (and Magic Missile's darts)", "Sparks", "Damage numbers, heals and 'unharmed'"],
    text: "A spell at one target is a bright head with a trail, coloured by its element, landing in sparks and a flash of light: Fire Bolt orange, Ray of Frost pale blue, and Magic Missile's three violet darts, 140 milliseconds apart. Attack spells roll against a thing's armour class (straw 11, wood 15, tin 19); darts don't miss. From the firing line:",
    triggers: [
      { id: "bolt-fire", expect: ["bolt"], label: "Cast Fire Bolt at the straw target", at: at["2"]!, station: { name: "the firing line", glyph: "═", color: "#e8e4d8" }, stand: true, run: z => cast(z, "fire-bolt", ["straw-target"]) },
      { id: "bolt-frost", expect: ["bolt"], label: "Cast Ray of Frost at the wooden target", at: at["2"]!, stand: true, run: z => cast(z, "ray-of-frost", ["wooden-target"]) },
      { id: "bolt-missile", expect: ["bolt"], label: "Cast Magic Missile at the tin target", at: at["2"]!, stand: true, run: z => cast(z, "magic-missile", ["tin-target"]) },
    ],
  },
  {
    id: "lightning", title: "Lightning", sign: at.d!, shows: ["Lightning", "Areas catch by shape"],
    text: "Anything named lightning or shock, or whose damage is lightning, is a jagged stroke that flickers for a moment, with flashes at both ends and sparks where it lands. Lightning Bolt is a line 100 feet long from the caster: from the chalk circle it runs up the line of posts to the rod. Shocking Grasp is a touch, so walk up to the rod.",
    triggers: [
      { id: "lightning-bolt", expect: ["lightning"], label: "Cast Lightning Bolt up the line of posts", at: at["4"]!, station: chalk, stand: true, run: z => cast(z, "lightning-bolt", ["lightning-rod"]) },
      { id: "shocking-grasp", expect: ["lightning"], label: "Cast Shocking Grasp on the lightning rod", at: "lightning-rod", run: z => cast(z, "shocking-grasp", ["lightning-rod"]) },
    ],
  },
  {
    id: "thunder", title: "The gong (a shockwave)", sign: at.e!, shows: ["Shockwave ring"],
    text: "An area spell that isn't fire is a ring of air going out from it, white-hot to dull, in its element's colour. Thunderwave is a 15-foot cube in front of the caster: from the chalk circle, the gong is in it. Every fireball and explosion has one of these rings too.",
    triggers: [{ id: "thunderwave-gong", expect: ["shockwave"], label: "Cast Thunderwave at the gong", at: at["5"]!, station: chalk, stand: true, run: z => cast(z, "thunderwave", ["gong"]) }],
  },
  {
    id: "flash", title: "The night-watchman (a flash)", sign: at.f!, shows: ["Flash"],
    text: "An area spell that's not fire, thunder or lightning flashes the cells it covers, with a shockwave, in its colour. Sleep is a 5-foot sphere: cast it on the night-watchman, who is asleep already, and who will tell you so.",
    triggers: [{ id: "sleep-watchman", expect: ["shockwave", "flash", "bark"], label: "Cast Sleep on the night-watchman", at: at["6"]!, station: chalk, stand: true,
      run: async z => ({ ...(await cast(z, "sleep", ["watchman"])), cues: [{ kind: "line", id: "watchman", text: "“Not asleep,” he mumbles. “Resting my eyes.”" }] }) }],
  },
  {
    id: "colours", title: "The colour chart", sign: at.g!, shows: ["Bolt (and Magic Missile's darts)"],
    text: "A spell's colour is its element's (Cogmind's rule: colour carries the kind): fire orange, cold pale blue, lightning white, thunder lilac, acid green, poison green, necrotic purple, radiant gold, force violet, psychic pink, healing green. The wizard has only some of these; pull the cord for all of them, one after another, each named as it lands. (The cord plays the effects as they are; the cleric's and the bard's robes in the hall cast the gold and the pink for real.)",
    triggers: [{ id: "colour-cord", expect: ["bolt", "lightning", "sparks", "float:text"], label: "Pull the cord: a bolt of every colour", at: at["7"]!, station: { name: "the cord", glyph: "¡", color: "#c8a060" }, run: () => ({ text: "Eleven bolts in eleven colours go into the chart, one after another. The chart takes it well.", cues: colours() }) }],
  },
  {
    id: "frost", title: "The frost basin (sparks)", sign: at.i!, shows: ["Sparks"],
    text: "Sparks: icy ones for a thing that freezes (a basin of water hit by Ray of Frost goes to ice), a sparkle in a spell's colour for a spell that does no damage, a green one for healing. A spell with nothing to aim at sparkles at the caster: Detect Magic, for instance, which finds that the gallery is extremely magic.",
    triggers: [
      { id: "frost-basin", expect: ["bolt"], label: "Cast Ray of Frost at the basin", at: at["8"]!, station: chalk, stand: true, run: z => cast(z, "ray-of-frost", ["basin"]) },
      { id: "detect-magic", expect: ["sparks"], label: "Cast Detect Magic (nothing to hit: a sparkle at you)", at: at["8"]!, stand: true, run: z => cast(z, "detect-magic", []) },
    ],
  },
  {
    id: "numbers", title: "The numbers board", sign: at.j!, shows: ["Damage numbers, heals and 'unharmed'"],
    text: "Numbers rise and fade over whoever was hurt, in the damage type's colour; healing is +N in green; a thing the element can't hurt says \"unharmed\" in grey. In play they come from the rules' lines (\"The long table takes 7 fire damage\"), and from a thing's hit points dropping when no line said so. Ring the bell for one of each.",
    triggers: [{ id: "numbers-bell", expect: ["float:damage", "float:heal", "float:unharmed"], label: "Ring the bell: one of every number", at: at["9"]!, station: { name: "a brass bell", glyph: "♪", color: "#e8c070" }, run: () => ({ text: "Ding. The board floats one of everything.", cues: numbers() }) }],
  },
  {
    id: "barks", title: "Barks", sign: at.k!, shows: ["Barks"],
    text: "Short quoted lines in the GM's narration (60 characters or fewer) show over the speaker's head for a few seconds, one per speaker, 700 milliseconds apart. The speaker is found by the speech tag, by name, or by what the player calls them (\"the woman in the hat\"). Your own words (\"...,\" you say) and people who are only mentioned get none. Each of these three is given a line of narration to bark from, as the GM would write it.",
    triggers: [
      { id: "bark-crier", expect: ["bark"], label: "Ask the crier for the news", at: "crier", run: () => ({ text: "The crier rings his bell. “Oyez! The Assembly is tomorrow!” he bellows. “Bring a hat.” “Thank you,” you say, and he looks at you as if you'd interrupted.", cues: [{ kind: "narration", text: "The crier rings his bell. “Oyez! The Assembly is tomorrow!” he bellows. “Bring a hat.” “Thank you,” you say, and he looks at you as if you'd interrupted." }] }) },
      { id: "bark-hat", expect: ["bark"], label: "Say good morning to the woman in the hat", at: "hat-woman", run: () => ({ text: "“Good morning,” you say. “Not today, dear,” says the woman in the hat, who has decided you're selling something.", cues: [{ kind: "narration", text: "“Good morning,” you say. “Not today, dear,” says the woman in the hat, who has decided you're selling something.", called: { "hat-woman": "the woman in the hat" } }] }) },
      { id: "bark-parrot", expect: ["bark"], label: "Ask the parrot what it thinks", at: "parrot", run: () => ({ text: "The parrot thinks about it. “Mind the bunting!”", cues: [{ kind: "line", id: "parrot", text: "“Mind the bunting!”" }] }) },
    ],
  },
  {
    id: "goose", title: "The goose (an alert)", sign: at.l!, shows: ["Alert '!'"],
    text: "A bobbing yellow \"!\" over someone who has just noticed something. Only the look gallery uses it so far: nothing in play sets it off. The goose has noticed you before you've noticed the goose. Walk onto the flagstone in front of her.",
    triggers: [{ id: "goose-plate", expect: ["alert", "bark"], label: "Walk up to the goose", at: at["0"]!, step: true, station: { name: "a loose flagstone", glyph: "▫", color: "#9a9890" }, run: () => ({ text: "The goose has noticed you. HONK.", cues: [{ kind: "alert", id: "goose" }, { kind: "line", id: "goose", text: "HONK." }] }) }],
  },
  {
    id: "coconuts", title: "The coconut stall (things thrown)", sign: at.m!, shows: ["Thrown things (throw)", "A blow in a scene"],
    text: "Something thrown arcs through the air with its own glyph. Only the look gallery throws things (Cob's gutter stones, a bucket of slops); the director would throw an ember from the nearest fire whenever the world logs \"fire spread to X\", but the world logs \"X catches fire\" instead, so that one never flies. Throw a ball for the effect, or a bottle for the rules: an improvised weapon, 1d4 and no proficiency.",
    triggers: [
      { id: "throw-ball", expect: ["throw", "float:text"], label: "Throw a wooden ball at the coconuts", at: at["&"]!, station: { name: "the throwing line", glyph: "═", color: "#e8e4d8" }, stand: true, run: () => ({ text: "You throw. It's a good throw. The coconuts are glued on.", cues: [{ kind: "effect", effect: "throw", from: { id: "player" }, to: { id: "coconut-stall" }, glyph: "•", color: "#c8a878" }, { kind: "float", at: { id: "coconut-stall" }, text: "thunk", style: "info", color: "#c8c0b0", delay: 520 }] }) },
      { id: "throw-bottle", expect: ["throw"], label: "Throw a bottle at the stall (an improvised weapon)", at: at["&"]!, stand: true, run: async z => ({ ...(await strike(z, "coconut-stall", "improvised", "You throw a bottle.")), cues: [{ kind: "effect", effect: "throw", from: { id: "player" }, to: { id: "coconut-stall" }, glyph: "ô", color: "#9fd0c0" }] }) },
    ],
  },
  {
    id: "dust-embers", title: "Dust and embers", sign: at.n!, shows: ["Unused effect kinds: dust cloud and embers"],
    text: "Two effects nothing in the game sets off. A dust cloud is a slow billow (the look gallery's Cob raises one, jumping on the grain stacks); embers are defined and never called, because burning things make their own on the map. Beat the sack, or blow on the brazier.",
    triggers: [
      { id: "beat-sack", expect: ["dust"], label: "Beat the flour sack", at: "flour-sack", run: () => ({ text: "You beat the sack. The sack wins on points.", cues: [0, 1, 2].map((k): Cue => ({ kind: "effect", effect: "dust", at: { id: "flour-sack" }, radius: 4, amount: 1.4, delay: k * 160 })) }) },
      { id: "blow-embers", expect: ["embers"], label: "Blow on the embers", at: "embers", run: () => ({ text: "You blow on the embers. They glow, briefly, as if to be polite.", cues: [{ kind: "effect", effect: "embers", at: { id: "embers" }, radius: 2, amount: 1.5 }] }) },
    ],
  },
  {
    id: "poof", title: "The magician's cabinet (a poof)", sign: at.r!, shows: ["Poof"],
    text: "A small puff of dust when someone appears in the world (the stage manager made them, or they came in at a door), leaves, goes down or hides, or when something hanging falls because what it hung from broke. The wand at the cabinet does the first four, through the stage manager's own operations; the sandbag's rope is on the beam.",
    triggers: [
      { id: "wand-appear", expect: ["poof"], label: "Wave the wand: the assistant appears", at: at["*"]!, station: { name: "the magician's wand", glyph: "/", color: "#e0d0f0" },
        when: z => !Object.values(z.world.entities).some(e => e.name === "the magician's assistant" && !e.states.includes("gone")),
        run: z => stage(z, [{ op: "create", name: "the magician's assistant", kind: "person", to: "cabinet" }], "Ta-da: the magician's assistant steps out of the cabinet.") },
      { id: "wand-hide", expect: ["poof"], label: "Wave the wand: she hides", at: at["*"]!, when: z => present(z, "the magician's assistant", s => !s.includes("hidden")),
        run: z => stage(z, [{ op: "state", what: made(z.world, "the magician's assistant")!.id, add: ["hidden"] }], "She hides. You can just about see her, which is the point of the exhibit.") },
      { id: "wand-faint", expect: ["poof"], label: "Wave the wand: she faints", at: at["*"]!, when: z => present(z, "the magician's assistant", s => !s.includes("unconscious")),
        run: z => stage(z, [{ op: "state", what: made(z.world, "the magician's assistant")!.id, add: ["unconscious"], remove: ["hidden"] }], "She faints, beautifully: down she goes.") },
      { id: "wand-vanish", expect: ["poof"], label: "Wave the wand: she vanishes", at: at["*"]!, when: z => present(z, "the magician's assistant"),
        run: z => stage(z, [{ op: "remove", what: made(z.world, "the magician's assistant")!.id, text: "into thin air, and out of the back of the cabinet" }], "She's gone.") },
      { id: "cut-sandbag", expect: ["poof"], label: "Cut the sandbag's rope", at: "beam", when: z => !z.thing("sandbag-rope").states.includes("destroyed"),
        run: z => stage(z, [{ op: "break", what: "sandbag-rope", text: "cut through" }], "You cut the rope. The sandbag comes down, as sandbags do.") },
    ],
  },
  {
    id: "tweens", title: "The porter and his crate (walks and slides)", sign: at.s!, shows: ["Walks and slides (tweens)"],
    text: "On the scene's stage, people walk (nine feet a second) and things slide or arc from where the world had them to where it has them now, instead of jumping. In play, the stage manager moving people after a reply sets it off. Ask the porter, then press v to look down on the gallery and watch him go.",
    triggers: [
      { id: "porter-carry", expect: ["moves"], label: "Ask the porter to carry the crate to the corner", at: "porter", when: z => !inCorner(z),
        run: z => stage(z, [{ op: "move", what: "porter", to: "corner" }, { op: "place", what: "crate", to: "porter", how: "beside" }], "“Right you are,” says the porter, and carries it.") },
      { id: "porter-back", expect: ["moves"], label: "Ask him to bring it back", at: "porter", when: z => inCorner(z),
        run: z => stage(z, [{ op: "move", what: "porter", to: "porters-patch" }, { op: "place", what: "crate", to: "porter", how: "beside" }], "He brings it back. He has the air of a man paid by the hour.") },
    ],
  },
  {
    id: "flour-store", title: "The flour store (an explosion)", sign: at.t!, tour: ["flour-match", "fire-reset", "flour-candle"], shows: ["Explosion", "A dust explosion in a scene", "Screen shake", "Debris and smoke"],
    text: "Flour dust in the air is an explosion waiting for a flame. Fire in a dusty place sets it off: the place becomes \"exploded\" and burning, everything in it takes 4d6 fire, and anyone standing in it makes a serious fire save (Dexterity, DC 15, 3d6). The director plays it as a bigger burst with debris thrown up, falling back, and a stronger shake. Toss a match in from the door, or go in and knock the candle over, if you'd like to try the save.",
    triggers: [
      { id: "flour-match", expect: ["explosion"], label: "Toss a lit match in through the door", at: at["{"]!, station: { name: "a box of matches", glyph: "▪", color: "#c86040" }, when: z => !z.thing("flour-store").states.includes("exploded"),
        run: async z => { const lines = [...ignited(z), ...(await passTurn(z))]; return { text: `You toss a match in. ${lines.join(" · ")}`, lines }; } },
      { id: "flour-candle", expect: ["explosion"], label: "Knock the candle into the flour", at: "store-candle", when: z => !z.thing("flour-store").states.includes("exploded"),
        run: async z => { const lines = [...ignited(z), ...(await passTurn(z))]; return { text: `You knock the candle over, standing right there. ${lines.join(" · ")}`, lines }; } },
    ],
  },
  {
    id: "fire-time", title: "Time passes (the sand-glass)", sign: at.v!, shows: ["Fire over time (the tick)", "Steam puff", "Wrecks and smouldering"],
    text: "Story time passes a turn at a time: in a scene, at the start of each of your turns. What's burning takes 1d10 fire and sets flammable things within five feet alight; a burnt wreck smoulders for a turn and goes out with a puff of steam; burning oil burns away to a scorch mark and smoke. Set something alight somewhere in the gallery, then turn the glass.",
    triggers: [sandGlass("fire-sandglass", at["["]!)],
  },
];

/** Someone the cabinet made is here (and, optionally, in a state). */
function present(z: Ctx, name: string, test: (states: string[]) => boolean = () => true): boolean {
  const e = made(z.world, name);
  return !!e && !e.states.includes("gone") && test(e.states);
}

/** The porter's in the corner (he's carried the crate there). */
function inCorner(z: Ctx): boolean {
  const p = z.at("porter");
  return Math.hypot(p.x - point(at[">"]!).x, p.y - point(at[">"]!).y) < 15;
}

/** The flour catches (a match or a candle: fire to the stacks). */
const ignited = (z: Ctx): string[] => z.ops([{ op: "ignite", what: "flour-stacks" }]);

export const fire: Wing = {
  id: ID,
  name: "the Burning Gallery",
  about: "Spells, fire, explosions and everything they set off: the look layer's effects, set off the way the game sets them off.",
  entry: at["@"]!,
  map: {
    grid: GRID,
    legend: {
      "#": T("wall", { style: "brick", height: 3 }), "%": T("wall", { style: "brick", height: 1 }), ".": COBBLES, ":": DIRT,
      "=": T("fence", { style: "fence" }), B: T("wall", { style: "timber", height: 2 }), "+": T("door", { style: "timber", height: 2 }), X: T("door", { style: "brick", height: 1 }),
      ...floorFor(ON_DIRT, DIRT), ...floorFor(ON_COBBLES, COBBLES),
    },
    regions: [
      { id: "zoo-fire-range", name: "the Fireball range", rect: { x: 30, y: 1, w: 13, h: 9 }, description: "Beaten earth, a scarecrow in a borrowed hat, straw, hay, a stone fireman and a puddle somebody has been waiting to see hiss." },
      { id: "zoo-fire-store", name: "the flour store", rect: { x: 37, y: 18, w: 5, h: 5 }, description: "A shed full of flour sacks, and the air full of flour. A sign says NO NAKED LIGHTS. A candle burns under it." },
    ],
    exits: [{ at: { x: 0, y: 21 }, to: toHall(ID), label: "Back to the hall" }],
  },
  world: {
    name: "The Burning Gallery", description: "A fireproof courtyard of brick and cobbles, with things set out to be set on fire.",
    size: { w: 44 * 5, h: 26 * 5 },
    areas: [
      { id: "gallery", name: "the gallery", rect: rect(0, 0, 44, 26) },
      { id: "range", name: "the Fireball range", rect: rect(30, 1, 13, 9) },
      { id: "flour-store", name: "the flour store", rect: rect(37, 18, 5, 5), states: ["dusty"], description: "Thick with flour dust." },
      { id: "corner", name: "the corner by the wall", rect: rect(2, 22, 4, 2) },
      { id: "porters-patch", name: "the porter's patch", rect: rect(8, 14, 3, 3) },
    ],
    things: [
      { id: "scarecrow", name: "a scarecrow in a borrowed hat", kind: "object", in: "range", at: feet(at.S!), size: "medium", material: "cloth", description: "Straw, sacking and somebody's hat. It has been told it's for the birds." },
      { id: "hay-bale", name: "a hay bale", kind: "object", in: "range", at: feet(at.Y!), size: "large", material: "cloth" },
      { id: "straw-heap", name: "a heap of straw", kind: "object", in: "range", at: feet(at.W!), size: "medium", material: "cloth" },
      { id: "stone-fireman", name: "a stone statue of a fireman", kind: "object", in: "range", at: feet(at.U!), size: "large", material: "stone", description: "A fireman in stone, holding a stone bucket, looking disappointed in everyone." },
      { id: "straw-target", name: "a straw target", kind: "object", in: "gallery", at: feet(at.A!), size: "small", material: "cloth" },
      { id: "wooden-target", name: "a wooden target", kind: "object", in: "gallery", at: feet(at.D!), size: "medium", material: "wood" },
      { id: "tin-target", name: "a tin target", kind: "object", in: "gallery", at: feet(at.C!), size: "medium", material: "iron" },
      { id: "post-near", name: "a wooden post", kind: "object", in: "gallery", at: feet(at.E!), size: "medium", material: "wood" },
      { id: "post-far", name: "another wooden post", kind: "object", in: "gallery", at: feet(at.F!), size: "medium", material: "wood" },
      { id: "lightning-rod", name: "the lightning rod", kind: "object", in: "gallery", at: feet(at.G!), size: "medium", material: "iron", description: "An iron rod on a stone foot, looking up hopefully." },
      { id: "gong", name: "a brass gong", kind: "object", in: "gallery", at: feet(at.H!), size: "large", material: "brass" },
      { id: "sentry-box", name: "the watchman's sentry box", kind: "object", in: "gallery", at: feet(at.J!), size: "large", material: "wood" },
      { id: "watchman", name: "the night-watchman", kind: "person", in: "gallery", at: feet(at.I!), states: ["asleep"], description: "A night-watchman asleep in the daytime, as is the custom." },
      { id: "colour-chart", name: "the colour chart", kind: "object", in: "gallery", at: feet(at.K!), size: "medium", material: "wood", tags: ["sign"] },
      { id: "basin", name: "a basin of water", kind: "object", in: "gallery", at: feet(at.L!), size: "medium", material: "liquid", tags: ["water", "container"], hp: 40 },
      { id: "numbers-board", name: "the numbers board", kind: "object", in: "gallery", at: feet(at.M!), size: "medium", material: "wood", tags: ["sign"] },
      { id: "crier", name: "the town crier", kind: "person", in: "gallery", at: feet(at.N!), description: "A crier with a bell, a tricorn hat and the lungs of a much larger man." },
      { id: "hat-woman", name: "Madam Pleat", kind: "person", in: "gallery", at: feet(at.Q!), description: "A woman in a hat with most of a pheasant on it." },
      { id: "parrot", name: "a green parrot on a perch", kind: "creature", in: "gallery", at: feet(at.R!) },
      { id: "goose", name: "a goose", kind: "creature", in: "gallery", at: feet(at.T!), description: "A goose. It belongs to nobody and fears nothing." },
      { id: "coconut-stall", name: "the coconut stall", kind: "object", in: "gallery", at: feet(at.V!), size: "large", material: "wood", description: "Three coconuts on posts, and a sign: THREE THROWS A PENNY. The coconuts are glued on." },
      { id: "flour-sack", name: "a flour sack", kind: "object", in: "gallery", at: feet(at.Z!), size: "medium", material: "cloth" },
      { id: "embers", name: "a brazier of embers", kind: "object", in: "gallery", at: feet(at.$!), size: "medium", material: "iron", tags: ["fire", "light"], states: ["lit"] },
      { id: "cabinet", name: "the magician's cabinet", kind: "object", in: "gallery", at: feet(at["^"]!), size: "large", material: "wood", tags: ["container"] },
      { id: "beam", name: "a hoist beam", kind: "feature", in: "gallery", at: feet(at["~"]!), size: "large", material: "wood", tags: ["fixed"] },
      { id: "sandbag-rope", name: "the sandbag's rope", kind: "item", in: "beam", size: "small", material: "rope", tags: ["hanging", "fixed"] },
      { id: "sandbag", name: "a sandbag", kind: "object", in: "sandbag-rope", size: "medium", material: "cloth", states: ["hanging"] },
      { id: "porter", name: "a porter", kind: "person", in: "gallery", at: feet(at["?"]!), description: "A porter, paid by the hour, in no hurry to stop being paid." },
      { id: "crate", name: "a crate", kind: "object", in: "gallery", at: feet(at["<"]!), size: "medium", material: "wood" },
      { id: "flour-stacks", name: "stacks of flour sacks", kind: "object", in: "flour-store", at: feet(at["("]!), size: "large", material: "cloth" },
      { id: "store-candle", name: "a candle-end", kind: "item", in: "flour-store", at: feet(at[")"]!), size: "tiny", material: "wood", tags: ["light"], states: ["lit"] },
    ],
    people: { player: { in: "gallery", at: feet(at["@"]!) } },
  },
  setup: world => {
    spill(world, "water", point(at.P!), 4, 0);
    spill(world, "oil", point(at.O!), 4, 0);
  },
  dressing: {
    ground: { gallery: "cobbles", range: "dirt", "flour-store": "boards", corner: "cobbles" },
    indoor: ["flour-store"],
    haze: [{ area: "flour-store", kind: "dust", density: 0.35 }],
  },
  exhibits,
};

