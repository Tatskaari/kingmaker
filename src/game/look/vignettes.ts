import { applyOps, buildWorld, caughtIn, damageThing, positionOf, tick, type Entity, type Point, type SceneWorld, type WorldOp, type WorldSpec } from "../../world/scene-world.ts";
import { drownedRatWorld } from "../../../scenes/worlds/drowned-rat.ts";
import { hangedClerkWorld } from "../../../scenes/worlds/hanged-clerk.ts";
import { kingsMorningWorld } from "../../../scenes/worlds/kings-morning.ts";
import { describeLook, lookOf, type TimeOfDay } from "./appearance.ts";
import { BOLD, Canvas, INK, UNLIT } from "./canvas.ts";
import { mix, rgbOf } from "./color.ts";
import { Director } from "./director.ts";
import { drownedRatDressing, granaryYardDressing, kingsRoomDressing } from "./dressings.ts";
import { Effects } from "./effects.ts";
import { glyphFor, type GlyphSet } from "./glyphs.ts";
import { renderStage, type Dressing } from "./stage.ts";
import { groundCell, type Weather } from "./terrain.ts";

/**
 * The gallery's vignettes: short scenes played on real scene worlds with the real rules (fire
 * from damageThing, spreading and the dust explosion from tick, Fireball's sphere from caughtIn,
 * the stage manager's operations through applyOps), and the director animating whatever changed.
 * Each is a list of beats at fixed times, so any instant can be rebuilt from scratch: frameAt()
 * is exact, which the headless dump and the tests rely on.
 *
 * Where the world's own surfaces and interactions (src/world/systems.ts, in progress) will do the
 * work, the scripts do it by hand with the same states (douse(), ignite()): marked "systems".
 */

export interface LogLine { at: number; text: string; kind: "rules" | "stage" | "gm" | "say" | "note" }

export interface StageScene {
  world: SceneWorld;
  dressing: Dressing;
  fx: Effects;
  director: Director;
  time: TimeOfDay;
  weather: Weather;
  turn: number;
  log: LogLine[];
  /** Zoom: a point to centre and a scale (feet per column). */
  focus?: Point;
  scale?: number;
}

export interface Beat { at: number; run: (s: StageScene, t: number) => void }

export interface View { w: number; h: number; glyphs: GlyphSet; time?: TimeOfDay; weather?: Weather }

export interface Vignette {
  id: string;
  title: string;
  /** What to look for. */
  blurb: string;
  /** Milliseconds per loop. */
  length: number;
  build: (clock: { t: number }) => StageScene;
  beats: Beat[];
  /** A vignette that isn't one world drawn whole (the inventions board, the three glyph sets). */
  render?: (s: StageScene, t: number, view: View) => Canvas;
}

// ---------------------------------------------------------------------------------------------
// Helpers for scripts.

const op = (o: Partial<WorldOp> & { op: WorldOp["op"] }): WorldOp => ({ what: "", to: "", how: "", name: "", kind: "", text: "", add: [], remove: [], ...o });

/** The stage manager writes (as it would after a GM reply), then the director animates it. */
function stage(s: StageScene, t: number, ops: Array<Partial<WorldOp> & { op: WorldOp["op"] }>, text?: string): string[] {
  const { changes } = applyOps(s.world, ops.map(op), s.turn, "stage");
  if (text) s.log.push({ at: t, text, kind: "gm" });
  s.director.observe(s.world, t);
  return changes;
}

function rulesSay(s: StageScene, t: number, lines: string[]): void {
  for (const line of lines) s.log.push({ at: t, text: line, kind: "rules" });
  s.director.rulesLines(s.world, lines, t);
  s.director.observe(s.world, t);
}

function say(s: StageScene, t: number, id: string, text: string): void {
  s.fx.bark(id, text, { color: lookOf(s.world.entities[id] ?? { name: id }, {}).fg }, t);
  const name = s.world.entities[id]?.name ?? id;
  s.log.push({ at: t, text: `${name}: “${text}”`, kind: "say" });
}

/** The newest entity with this name (what a create op just made). */
const made = (world: SceneWorld, name: string): Entity | undefined => Object.values(world.entities).filter(e => e.name === name).sort((a, b) => (b.created ?? -1) - (a.created ?? -1))[0];

/** systems: water (or ale, or slops) over something puts it out, and leaves it wet, scorched and standing in a pool. */
function douse(s: StageScene, t: number, id: string, liquid: string): void {
  const e = s.world.entities[id]!;
  const wasBurning = e.states.includes("burning") || e.states.includes("smouldering");
  e.states = [...e.states.filter(x => x !== "burning" && x !== "smouldering"), "wet", ...(wasBurning && !e.states.includes("scorched") ? ["scorched"] : [])];
  s.world.log.push({ turn: s.turn, text: `${e.name} is put out`, by: "rules" });
  applyOps(s.world, [op({ op: "create", name: `a pool of ${liquid}`, kind: "feature", to: id })], s.turn, "rules");
  const pool = made(s.world, `a pool of ${liquid}`)!;
  pool.at = { ...positionOf(s.world, id)! };
  pool.size = e.size === "large" || e.size === "huge" ? "large" : "medium";
  s.log.push({ at: t, text: `Rules: ${e.name} is put out: wet${wasBurning ? ", scorched" : ""}, and standing in ${pool.name}.`, kind: "rules" });
  s.director.observe(s.world, t);
}

/** systems: fire on oil or spirits sets the surface alight (a burning puddle). */
function ignite(s: StageScene, t: number, id: string): void {
  const e = s.world.entities[id]!;
  if (!e.states.includes("burning")) e.states.push("burning");
  s.world.log.push({ turn: s.turn, text: `${e.name} catches fire`, by: "rules" });
  s.log.push({ at: t, text: `Rules: ${e.name} goes up: a burning puddle.`, kind: "rules" });
  s.director.observe(s.world, t);
}

function passTime(s: StageScene, t: number): void {
  s.turn++;
  const lines = tick(s.world, s.turn, 7 + s.turn * 31);
  if (lines.length) rulesSay(s, t, lines);
}

function scene(world: SceneWorld, dressing: Dressing, clock: { t: number }, time: TimeOfDay, extra: Partial<StageScene> = {}): StageScene {
  const fx = new Effects({ now: () => clock.t, seed: 11 });
  const director = new Director(fx);
  director.prime(world);
  return { world, dressing, fx, director, time, weather: "clear", turn: 1, log: [], ...extra };
}

const RAT_CAST = [["kell", "Sergeant Agnes Kell"], ["nan-quill", "Nan Quill"], ["arlo", "Arlo Quarry"], ["dilly", "Dilly Sparrow"], ["hobb", "Big Hobb Mallory"], ["cob", "Cob"]].map(([id, name]) => ({ id: id!, name: name! }));
const YARD_CAST = [["kell", "Sergeant Agnes Kell"], ["cob", "Cob"], ["moll", "Moll"]].map(([id, name]) => ({ id: id!, name: name! }));
const KING_CAST = [["kell", "Sergeant Agnes Kell"], ["holt", "Marshal Garran Holt"], ["king", "King Aldren"]].map(([id, name]) => ({ id: id!, name: name! }));
const PLAYER = { name: "the investigator" };

// ---------------------------------------------------------------------------------------------
// 1. The Drowned Rat at night: the blue driftwood fire, candles, a table catching fire and spreading.

const rat: Vignette = {
  id: "rat", title: "The Drowned Rat, night", length: 34_000,
  blurb: "Night at the Rat. The driftwood burns blue with the salt in it; candles the GM put on the tables; the river slapping at the foot of the stairs. A candle goes over, the long table catches (the rules), the fire spreads to the benches, Nan douses them with slops and Hobb empties the ale keg over the table.",
  build: clock => {
    const world = buildWorld("drowned-rat", drownedRatWorld, RAT_CAST, PLAYER);
    const s = scene(world, drownedRatDressing, clock, "night");
    // Earlier in the evening the GM put candles about (the stage manager made them).
    applyOps(world, [
      op({ op: "create", name: "a guttering candle", kind: "item", to: "long-table", how: "in", add: ["lit"] }),
      op({ op: "create", name: "a tallow candle", kind: "item", to: "arlos-table", how: "in", add: ["lit"] }),
      op({ op: "create", name: "a candle stub", kind: "item", to: "corner-table", how: "in", add: ["lit"] }),
      op({ op: "create", name: "a lantern on a hook", kind: "item", to: "bar-counter", add: ["lit"] }),
    ], 0, "stage");
    made(world, "a lantern on a hook")!.at = { x: 20, y: 11 };
    s.director.prime(world);
    return s;
  },
  beats: [
    { at: 0, run: (s, t) => s.log.push({ at: t, text: "Night at the Drowned Rat. The driftwood in the hearth burns blue with the salt in it.", kind: "note" }) },
    { at: 1500, run: (s, t) => say(s, t, "nan-quill", "No credit.") },
    { at: 3600, run: (s, t) => say(s, t, "dilly", "Deal you in, dearie?") },
    { at: 5600, run: (s, t) => say(s, t, "arlo", "Penny says I'd have you, champ.") },
    { at: 7400, run: (s, t) => {
      stage(s, t, [{ op: "drop", what: "a guttering candle", to: "long-table" }], "The GM: Arlo shoves a porter into the long table, and the guttering candle goes over.");
      rulesSay(s, t, damageThing(s.world, s.world.entities["long-table"]!, 3, "fire", s.turn));
      s.fx.alert("regulars", {}, t);
    } },
    { at: 8400, run: (s, t) => say(s, t, "regulars", "FIRE!") },
    { at: 9600, run: (s, t) => { stage(s, t, [{ op: "move", what: "regulars", to: "doorway" }], "The GM: the regulars make for the door, all at once."); say(s, t, "kell", "Calmly. CALMLY.") } },
    { at: 11_000, run: (s, t) => passTime(s, t) },
    { at: 12_400, run: (s, t) => { stage(s, t, [{ op: "create", name: "a bucket of slops", kind: "item", to: "nan-quill" }, { op: "move", what: "nan-quill", to: "benches" }], "The GM: Nan comes over the bar with the slop bucket."); } },
    { at: 14_400, run: (s, t) => {
      const from = positionOf(s.world, "nan-quill")!, to = positionOf(s.world, "benches")!;
      s.fx.effect("throw", { from: { ...from }, to: { ...to }, glyph: "Ü", color: "#7a5232" }, t);
      say(s, t, "nan-quill", "Not in MY Rat.");
    } },
    { at: 14_800, run: (s, t) => douse(s, t, "benches", "slops") },
    { at: 16_000, run: (s, t) => passTime(s, t) },
    { at: 17_200, run: (s, t) => { stage(s, t, [{ op: "move", what: "hobb", to: "ale-keg" }], "The GM: Big Hobb gets up. Everyone stops. He picks up the ale keg."); s.fx.alert("dilly", {}, t); } },
    { at: 19_600, run: (s, t) => {
      stage(s, t, [{ op: "move", what: "hobb", to: "long-table" }]);
      say(s, t, "hobb", "That was a full keg.");
    } },
    { at: 21_400, run: (s, t) => {
      const from = positionOf(s.world, "hobb")!, to = positionOf(s.world, "long-table")!;
      s.fx.effect("splash", { at: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, radius: 3, color: "#e8b040" }, t);
      douse(s, t, "long-table", "ale");
    } },
    { at: 23_400, run: (s, t) => say(s, t, "nan-quill", "That's going on your slate, Hobb.") },
    { at: 26_000, run: (s, t) => s.log.push({ at: t, text: "The long table and the benches: wet, scorched, standing in slops and ale. The fire in the hearth burns on, blue.", kind: "note" }) },
  ],
};

// ---------------------------------------------------------------------------------------------
// 2. The granary yard by day: puddles, the elm, pigeons; a Fireball on the elm.

const yard: Vignette = {
  id: "yard", title: "The granary yard, morning", length: 32_000,
  blurb: "It rained in the night: the puddles hold the morning sky. The elm sways, the GM's pigeons flutter in it, Prout hangs from the hoist and Cob lobs gutter stones at him. Then a Fireball on the elm: the bolt, the burst, the elm alight (the rules), the GM's burning branch and singed pigeon, damage numbers, and a bucket from the water butt.",
  build: clock => {
    const world = buildWorld("hanged-clerk", hangedClerkWorld, YARD_CAST, PLAYER);
    const s = scene(world, granaryYardDressing, clock, "morning");
    applyOps(world, [op({ op: "create", name: "a flock of pigeons", kind: "creature", to: "elm" })], 0, "stage");
    made(world, "a flock of pigeons")!.at = { x: 31, y: 3 };
    s.director.prime(world);
    return s;
  },
  beats: [
    { at: 0, run: (s, t) => s.log.push({ at: t, text: "Morning behind the King's Granary. It rained in the night; the city is hanging bunting.", kind: "note" }) },
    { at: 1200, run: (s, t) => s.fx.effect("throw", { from: { ...positionOf(s.world, "cob")! }, to: { ...positionOf(s.world, "prout")! }, glyph: "•" }, t) },
    { at: 1700, run: (s, t) => s.fx.float({ ...positionOf(s.world, "prout")! }, "thunk", { style: "info", color: "#c8c0b0" }, t) },
    { at: 2400, run: (s, t) => say(s, t, "kell", "Cob. Stop that.") },
    { at: 4200, run: (s, t) => s.fx.effect("throw", { from: { ...positionOf(s.world, "cob")! }, to: { ...positionOf(s.world, "prout")! }, glyph: "•" }, t) },
    { at: 4700, run: (s, t) => s.fx.float({ ...positionOf(s.world, "prout")! }, "thunk", { style: "info", color: "#c8c0b0" }, t) },
    { at: 5400, run: (s, t) => say(s, t, "moll", "He jumped. I saw him. Definitely jumped.") },
    { at: 8200, run: (s, t) => {
      s.log.push({ at: t, text: "The investigator casts Fireball at the old elm. (To see what the pigeons know.)", kind: "gm" });
      s.fx.effect("fireball", { from: { ...positionOf(s.world, "player")! }, at: { ...positionOf(s.world, "elm")! }, radius: 20 }, t);
    } },
    { at: 8460, run: (s, t) => {
      const origin = positionOf(s.world, "player")!, aim = positionOf(s.world, "elm")!;
      const caught = caughtIn(s.world, "sphere", 20, origin, aim).filter(e => e.kind !== "person" && e.kind !== "creature");
      const lines = ["Damage to things in it: 8d6 = 28 fire (things don't dodge)"];
      for (const e of caught) lines.push(...damageThing(s.world, e, 28, "fire", s.turn));
      rulesSay(s, t, lines);
      s.fx.float({ ...positionOf(s.world, "moll")! }, "9", { damage: "fire" }, t + 150);
      stage(s, t, [
        { op: "move", what: "a flock of pigeons", to: "loft" },
        { op: "create", name: "a burning branch", kind: "item", to: "yard-wall", add: ["burning"] },
        { op: "create", name: "a singed pigeon", kind: "creature", to: "gate" },
      ], "The GM: the pigeons leave all at once, but for one; a burning branch drops over the wall.");
      made(s.world, "a burning branch")!.at = { x: 30, y: 11 };
      made(s.world, "a singed pigeon")!.at = { x: 18, y: 12 };
    } },
    { at: 9000, run: (s, t) => say(s, t, "moll", "MY HAIR!") },
    { at: 10_200, run: (s, t) => say(s, t, "kell", "Was that STRICTLY necessary?") },
    { at: 11_600, run: (s, t) => { stage(s, t, [{ op: "remove", what: "a flock of pigeons", text: "over the rooftops" }]); say(s, t, "cob", "AGAIN! Do it again!"); } },
    { at: 13_000, run: (s, t) => passTime(s, t) },
    { at: 14_200, run: (s, t) => stage(s, t, [{ op: "move", what: "a singed pigeon", to: "satchel" }]) },
    { at: 16_500, run: (s, t) => say(s, t, "kell", "Somebody fetch a bucket.") },
    { at: 17_200, run: (s, t) => { stage(s, t, [{ op: "move", what: "cob", to: "water-butt" }], "The GM: Cob, delighted, runs for the water butt."); } },
    { at: 18_000, run: (s, t) => passTime(s, t) },
    { at: 20_400, run: (s, t) => { stage(s, t, [{ op: "create", name: "a bucket of water", kind: "item", to: "cob" }, { op: "move", what: "cob", to: "a burning branch" }]); } },
    { at: 23_000, run: (s, t) => {
      s.fx.effect("throw", { from: { ...positionOf(s.world, "cob")! }, to: { ...positionOf(s.world, "a burning branch")! }, glyph: "Ü", color: "#7a5232" }, t);
    } },
    { at: 23_400, run: (s, t) => { const b = made(s.world, "a burning branch")!; douse(s, t, b.id, "water"); say(s, t, "cob", "Got it!"); } },
    { at: 25_000, run: (s, t) => passTime(s, t) },
    { at: 26_500, run: (s, t) => s.log.push({ at: t, text: "The elm burns on. The pigeons will be talking about this for years.", kind: "note" }) },
  ],
};

// ---------------------------------------------------------------------------------------------
// 3. Grain dust: the tally loft goes up.

const dust: Vignette = {
  id: "dust", title: "Grain dust", length: 24_000,
  blurb: "Up in the tally loft: dust motes in the light from a gap in the boards. Cob jumps on the grain stacks (the stage manager makes the loft dusty), lights a candle-end, drops it in his nest, and the rules do the rest: the dust goes up.",
  build: clock => {
    const world = buildWorld("hanged-clerk", hangedClerkWorld, YARD_CAST, PLAYER);
    applyOps(world, [op({ op: "move", what: "cob", to: "cobs-nest" }), op({ op: "move", what: "kell", to: "tally-desk" }), op({ op: "move", what: "player", to: "smashed-lantern" })], 0, "stage");
    world.entities.cob!.at = { x: 44, y: 33 };
    world.entities.kell!.at = { x: 42, y: 20 };
    world.entities.player!.at = { x: 40, y: 26 };
    return scene(world, granaryYardDressing, clock, "morning", { focus: { x: 44.5, y: 24 }, scale: 0.42 });
  },
  beats: [
    { at: 0, run: (s, t) => s.log.push({ at: t, text: "The tally loft, under the granary roof. Light comes in through a gap in the boards.", kind: "note" }) },
    { at: 1000, run: (s, t) => say(s, t, "kell", "Nobody light anything.") },
    { at: 3000, run: (s, t) => {
      stage(s, t, [{ op: "move", what: "cob", to: "grain-stacks" }, { op: "state", what: "loft", add: ["dusty"] }], "The GM: Cob leaps onto the grain stacks. A great cloud of dust goes up.");
      const at = positionOf(s.world, "grain-stacks")!;
      for (let k = 0; k < 3; k++) s.fx.effect("poof", { at: { x: at.x - 3 + k * 3, y: at.y - 1 }, radius: 4, amount: 2 }, t + k * 120);
    } },
    { at: 4400, run: (s, t) => say(s, t, "cob", "I'm the King of the Castle!") },
    { at: 6800, run: (s, t) => { stage(s, t, [{ op: "create", name: "a candle-end", kind: "item", to: "cobs-nest", add: ["lit"] }, { op: "move", what: "cob", to: "cobs-nest" }], "The GM: it's dark behind the stacks, so Cob lights one of his candle-ends."); } },
    { at: 8200, run: (s, t) => { s.fx.alert("kell", {}, t); say(s, t, "kell", "Cob. COB. Put the candle DOWN."); } },
    { at: 10_400, run: (s, t) => {
      stage(s, t, [{ op: "drop", what: "a candle-end", to: "cobs-nest" }], "The GM: Cob puts the candle down. In his nest.");
      rulesSay(s, t, damageThing(s.world, s.world.entities["cobs-nest"]!, 2, "fire", s.turn));
    } },
    { at: 11_600, run: (s, t) => {
      passTime(s, t);
      s.fx.float({ x: 44, y: 22 }, "WHUMP", { style: "info", color: "#ffe680" }, t + 200);
    } },
    { at: 12_600, run: (s, t) => { stage(s, t, [{ op: "state", what: "cob", add: ["scorched"] }, { op: "state", what: "kell", add: ["scorched"] }, { op: "state", what: "player", add: ["prone"] }]); } },
    { at: 13_600, run: (s, t) => say(s, t, "cob", "...again?") },
    { at: 15_400, run: (s, t) => say(s, t, "kell", "My eyebrows.") },
    { at: 16_000, run: (s, t) => passTime(s, t) },
    { at: 19_000, run: (s, t) => s.log.push({ at: t, text: "Rules: everything in the loft took 4d6 fire. The loft is ablaze.", kind: "note" }) },
  ],
};

// ---------------------------------------------------------------------------------------------
// 4. Surfaces: a bucket over a burning table; Fireball on an oil slick; spirits burn blue; ice.

const grapesYard: WorldSpec = {
  name: "The stable yard of the Bunch of Grapes",
  description: "A cobbled yard between the inn's kitchen door and its stables, lit by a lantern on a bracket. Somebody dropped the lamp oil. Somebody else had a disagreement about a horse.",
  size: { w: 44, h: 30 },
  areas: [
    { id: "yard", name: "the yard", rect: { x: 0, y: 0, w: 31, h: 30 }, tags: ["outside"] },
    { id: "stable", name: "the stable", rect: { x: 31, y: 0, w: 13, h: 30 } },
  ],
  things: [
    { id: "trestle", name: "a trestle table", in: "yard", at: [12, 12], size: "large", material: "wood", tags: ["furniture"] },
    { id: "lantern", name: "a lantern on a bracket", kind: "feature", in: "yard", at: [2, 1.5], size: "small", material: "brass", tags: ["light"], states: ["lit"] },
    { id: "trough", name: "the horse trough", kind: "feature", in: "yard", at: [25, 5], size: "large", material: "stone", tags: ["container", "water"], states: ["full"] },
    { id: "oil-barrel", name: "a smashed barrel of lamp oil", in: "yard", at: [22, 22], size: "medium", material: "wood", states: ["broken"] },
    { id: "oil-slick", name: "an oil slick", kind: "feature", in: "yard", at: [18, 22], size: "large", material: "liquid", tags: ["surface"] },
    { id: "gin", name: "spilled gin", kind: "feature", in: "yard", at: [8, 23], size: "medium", material: "liquid", tags: ["surface", "spirits"] },
    { id: "blood", name: "a pool of blood", kind: "feature", in: "yard", at: [27, 16], size: "medium", material: "liquid", tags: ["surface"] },
    { id: "cudgel", name: "a bloodied cudgel", in: "yard", at: [28, 18], size: "small", material: "wood", tags: ["weapon"], states: ["bloodied"] },
    { id: "ash", name: "a heap of ash", kind: "feature", in: "yard", at: [4, 15], size: "small", tags: ["surface"] },
    { id: "bucket", name: "a bucket of water", in: "yard", at: [22, 8], size: "small", material: "wood", tags: ["container"] },
    { id: "hay", name: "hay bales", in: "stable", at: [38, 7], size: "large", material: "cloth" },
    { id: "stable-door", name: "the stable door", kind: "feature", in: "stable", at: [31, 15], size: "large", material: "wood", tags: ["door"], states: ["open"] },
    { id: "horse", name: "a bad-tempered horse", kind: "creature", in: "stable", at: [38, 20] },
    { id: "ostler", name: "a drunk ostler", kind: "person", in: "yard", at: [14, 9] },
  ],
  people: { player: { in: "yard", at: [4, 7] }, kell: { in: "yard", at: [7, 5] } },
};
const grapesDressing: Dressing = {
  ground: { yard: "cobbles", stable: "straw" },
  walls: [{ from: [31, 0], to: [31, 29.5], style: "timber" }, { from: [31, 0], to: [43.5, 0], style: "timber" }, { from: [43.5, 0], to: [43.5, 29.5], style: "timber" }, { from: [31, 29.5], to: [43.5, 29.5], style: "timber" }],
  indoor: ["stable"],
  wind: { dir: -0.6, strength: 0.4 },
  patches: [{ surface: "mud", circle: { x: 33, y: 22, r: 3 } }],
};

const surfaces: Vignette = {
  id: "surfaces", title: "Douse and burn", length: 26_000,
  blurb: "Surfaces, BG3-style, as the world will keep them: blood (dark and still), an oil slick (a rainbow sheen), spilled gin, ash. A table catches fire; a bucket of water leaves it scorched, wet and in a puddle, with a puff of steam. Fireball on the oil: a burning puddle, and the gin burns blue. Ray of Frost freezes the trough.",
  build: clock => {
    const world = buildWorld("grapes-yard", grapesYard, [], PLAYER);
    world.entities.kell = { id: "kell", name: "Sergeant Agnes Kell", kind: "person", parent: "yard", at: { x: 7, y: 5 }, tags: [], states: [], notes: [], cast: "kell" };
    return scene(world, grapesDressing, clock, "evening");
  },
  beats: [
    { at: 0, run: (s, t) => s.log.push({ at: t, text: "Evening in the stable yard of the Bunch of Grapes. Someone dropped the lamp oil; someone else lost an argument about a horse.", kind: "note" }) },
    { at: 1400, run: (s, t) => say(s, t, "kell", "Don't step in that. Or that. Or that.") },
    { at: 3400, run: (s, t) => {
      s.log.push({ at: t, text: "The GM: the drunk ostler knocks out his pipe on the trestle table.", kind: "gm" });
      rulesSay(s, t, damageThing(s.world, s.world.entities.trestle!, 4, "fire", s.turn));
    } },
    { at: 4400, run: (s, t) => say(s, t, "ostler", "...whoops.") },
    { at: 6000, run: (s, t) => passTime(s, t) },
    { at: 7000, run: (s, t) => stage(s, t, [{ op: "move", what: "kell", to: "bucket" }], "The GM: Kell goes for the bucket.") },
    { at: 9000, run: (s, t) => stage(s, t, [{ op: "give", what: "bucket", to: "kell" }, { op: "move", what: "kell", to: "trestle" }]) },
    { at: 10_800, run: (s, t) => s.fx.effect("throw", { from: { ...positionOf(s.world, "kell")! }, to: { ...positionOf(s.world, "trestle")! }, glyph: "Ü", color: "#7a5232" }, t) },
    { at: 11_200, run: (s, t) => douse(s, t, "trestle", "water") },
    { at: 12_400, run: (s, t) => say(s, t, "kell", "Scorched, soaked and standing in a puddle. Like me.") },
    { at: 14_600, run: (s, t) => {
      s.log.push({ at: t, text: "The investigator casts Fireball at the oil slick.", kind: "gm" });
      s.fx.effect("fireball", { from: { ...positionOf(s.world, "player")! }, at: { ...positionOf(s.world, "oil-slick")! }, radius: 20 }, t);
    } },
    { at: 14_880, run: (s, t) => {
      const origin = positionOf(s.world, "player")!, aim = positionOf(s.world, "oil-slick")!;
      const things = caughtIn(s.world, "sphere", 20, origin, aim).filter(e => e.kind !== "person" && e.kind !== "creature" && !e.tags.includes("surface"));
      rulesSay(s, t, ["Damage to things in it: 8d6 = 24 fire (things don't dodge)", ...things.flatMap(e => damageThing(s.world, e, 24, "fire", s.turn))]);
      ignite(s, t, "oil-slick");
      ignite(s, t, "gin");
      s.fx.float({ ...positionOf(s.world, "kell")! }, "12", { damage: "fire" }, t + 120);
      s.fx.float({ ...positionOf(s.world, "ostler")! }, "15", { damage: "fire" }, t + 200);
    } },
    { at: 15_600, run: (s, t) => say(s, t, "kell", "I was STANDING in the radius.") },
    { at: 17_000, run: (s, t) => { stage(s, t, [{ op: "move", what: "ostler", to: "stable" }], "The GM: the ostler leaves, briskly, for the stable."); } },
    { at: 18_600, run: (s, t) => {
      s.log.push({ at: t, text: "The investigator casts Ray of Frost at the horse trough.", kind: "gm" });
      s.fx.effect("bolt", { from: { ...positionOf(s.world, "player")! }, to: { ...positionOf(s.world, "trough")! }, color: "#bfefff" }, t);
    } },
    { at: 18_900, run: (s, t) => {
      stage(s, t, [{ op: "state", what: "trough", add: ["frozen"] }, { op: "create", name: "a sheet of ice", kind: "feature", to: "trough" }]);
      made(s.world, "a sheet of ice")!.at = { x: 25, y: 7 };
      s.log.push({ at: t, text: "Rules: the trough freezes over, and the splash round it.", kind: "rules" });
    } },
    { at: 20_400, run: (s, t) => say(s, t, "horse", "(contempt)") },
    { at: 22_500, run: (s, t) => s.log.push({ at: t, text: "Oil burns orange and black; spirits burn blue; blood just lies there.", kind: "note" }) },
  ],
};

// ---------------------------------------------------------------------------------------------
// 5. New things: names the GM makes up, and the looks they get.

const INVENTIONS: Array<{ name: string; kind: string; states?: string[] }> = [
  { name: "a flock of pigeons", kind: "creature" }, { name: "a burning branch", kind: "item", states: ["burning"] }, { name: "a singed pigeon", kind: "creature" },
  { name: "ale", kind: "item" }, { name: "a tea tray", kind: "item" }, { name: "a guttering candle", kind: "item", states: ["lit"] }, { name: "a bucket of slops", kind: "item" },
  { name: "a startled goat", kind: "creature" }, { name: "a wheel of cheese", kind: "item" }, { name: "the Purveyor's grain cart", kind: "object" },
  { name: "a puddle of flaming oil", kind: "feature", states: ["burning"] }, { name: "a pool of blood", kind: "feature" }, { name: "a lantern on a hook", kind: "item", states: ["lit"] },
  { name: "a sackbut", kind: "item" }, { name: "a quantity of marzipan", kind: "item" }, { name: "a whirligig", kind: "item" }, { name: "a gibbering homunculus", kind: "creature" },
];

const inventions: Vignette = {
  id: "inventions", title: "New things", length: 12_000,
  blurb: "Things the GM invents get looks without art: the rules read the name (a head noun, adjectives that are states or colours, \"a flock of\", \"a pool of\"). Names the rules don't know get a guess now and a look from Luna later (one small call per kind of thing, cached on disk, never per frame).",
  build: clock => scene(buildWorld("void", { name: "nowhere", description: "", size: { w: 10, h: 10 }, areas: [], things: [], people: {} }, [], PLAYER), {}, clock, "afternoon"),
  beats: [],
  render: (_s, t, view) => {
    const c = new Canvas(view.w, view.h, INK);
    const head = rgbOf("#e8c170"), dim = rgbOf("#8a8273"), text = rgbOf("#ddd5c4");
    c.text(2, 0, "name the GM said".padEnd(36) + "ascii  nerd  plain   on the ground         decided by", head, undefined, UNLIT | BOLD);
    const rows = Math.min(INVENTIONS.length, view.h - 2);
    for (let k = 0; k < rows; k++) {
      const thing = { ...INVENTIONS[k]!, created: 1 };
      const y = k + 2;
      const d = describeLook(thing);
      c.text(2, y, thing.name.slice(0, 34), text, undefined, UNLIT);
      // Each glyph set's glyph, live (burning things flicker, birds flap).
      const sets: GlyphSet[] = ["ascii", "nerd", "plain"];
      sets.forEach((set, j) => {
        const look = lookOf(thing, { t: t + k * 97, glyphs: set });
        c.put(39 + j * 6, y, look.glyph, rgbOf(look.fg), look.bg ? rgbOf(look.bg) : undefined, UNLIT | (look.bold ? BOLD : 0));
      });
      // A strip of cobbles with the thing (or a few of it) on it, animated.
      for (let x = 0; x < 18; x++) {
        const cell = groundCell(x < 9 ? "cobbles" : "boards", 60 + x, y, { t, time: "afternoon" });
        c.put(56 + x, y, cell.glyph, mix(cell.fg, rgbOf("#000000"), 0.15), cell.bg, UNLIT);
      }
      const look = lookOf(thing, { t: t + k * 131, glyphs: view.glyphs });
      const n = look.group ?? 1;
      for (let m = 0; m < n; m++) {
        const ml = n > 1 ? lookOf(thing, { t, glyphs: view.glyphs, seed: 1000 + k * 17 + m * 101 }) : look;
        const x = 64 + (n > 1 ? (m % 4) * 2 - 3 : 0), yy = y;
        c.put(x, yy, ml.glyph, rgbOf(ml.fg), ml.bg ? rgbOf(ml.bg) : undefined, UNLIT | (ml.bold ? BOLD : 0));
      }
      const source = d.source === "guess" ? "a guess (Luna on the way)" : d.source === "cache" ? "Luna (cached)" : `the rules: ${d.role}`;
      c.text(77, y, source.slice(0, Math.max(0, view.w - 78)), d.source === "guess" ? rgbOf("#c08a5a") : d.source === "cache" ? rgbOf("#9be36b") : dim, undefined, UNLIT);
      void glyphFor;
    }
    return c;
  },
};

// ---------------------------------------------------------------------------------------------
// 6. Glyph sets side by side: the King's dressing room in the morning sun.

const glyphs: Vignette = {
  id: "glyphs", title: "Glyph sets", length: 16_000,
  blurb: "The King's dressing room in the morning, in all three glyph sets: ascii (CP437-flavoured Unicode, the default), nerd (Nerd Font icons where they help: needs a Nerd Font, Mono variant best, or kitty/WezTerm), and plain seven-bit ASCII. Sun through the tall windows.",
  build: clock => {
    const world = buildWorld("kings-morning", kingsMorningWorld, KING_CAST, PLAYER);
    return scene(world, kingsRoomDressing, clock, "morning");
  },
  beats: [
    { at: 1500, run: (s, t) => say(s, t, "king", "Is that shortbread for me?") },
    { at: 5000, run: (s, t) => say(s, t, "holt", "After the procession, Majesty.") },
    { at: 9000, run: (s, t) => say(s, t, "king", "I am the King.") },
    { at: 12_000, run: (s, t) => say(s, t, "holt", "After the procession, Majesty.") },
  ],
  render: (s, t, view) => {
    const c = new Canvas(view.w, view.h, INK);
    const sets: GlyphSet[] = ["ascii", "nerd", "plain"];
    const pw = Math.floor((view.w - 2) / 3);
    sets.forEach((set, k) => {
      const panel = renderStage(s.world, s.dressing, { w: pw, h: view.h - 1, t, time: s.time, glyphs: set, effects: s.fx, positions: id => s.director.tweens.at(id, t) });
      for (let y = 0; y < panel.h; y++) for (let x = 0; x < panel.w; x++) {
        const i = y * panel.w + x;
        c.put(k * (pw + 1) + x, y + 1, panel.glyph[i]!, panel.fg[i]!, panel.bg[i]!, panel.flags[i]!);
      }
      c.text(k * (pw + 1) + 1, 0, ` ${set} `, rgbOf("#e8c170"), rgbOf("#2a2630"), UNLIT | BOLD);
    });
    return c;
  },
};

// ---------------------------------------------------------------------------------------------
// 7. Time and weather: the lane through the day, into a drizzly night.

const TIMES: TimeOfDay[] = ["morning", "afternoon", "evening", "night"];
const weather: Vignette = {
  id: "weather", title: "Time and weather", length: 24_000,
  blurb: "The granary lane through the day: morning sun, afternoon, an evening with the lamp lit, a drizzly night. Darkness falls where nothing lights it; the lamp's pool flickers; drizzle rings the puddles.",
  build: clock => {
    const world = buildWorld("hanged-clerk", hangedClerkWorld, YARD_CAST, PLAYER);
    const s = scene(world, granaryYardDressing, clock, "morning");
    applyOps(world, [op({ op: "create", name: "a lamp post", kind: "feature", to: "gate" })], 0, "stage");
    made(world, "a lamp post")!.at = { x: 9, y: 6 };
    s.director.prime(world);
    return s;
  },
  beats: TIMES.flatMap((time, k) => [{
    at: k * 6000, run: (s: StageScene, t: number) => {
      s.time = time;
      s.weather = time === "night" ? "drizzle" : "clear";
      const lamp = made(s.world, "a lamp post")!;
      lamp.states = time === "evening" || time === "night" ? ["lit"] : [];
      const words: Record<string, string> = { morning: "Morning: low gold sun, the puddles full of sky.", afternoon: "Afternoon: plain daylight.", evening: "Evening: the lamplighter's been; the light goes amber.", night: "Night, and a drizzle: only the lamp, and the rings on the puddles." };
      s.log.push({ at: t, text: words[time] ?? time, kind: "note" });
    },
  }]),
};

export const VIGNETTES: Vignette[] = [rat, yard, dust, surfaces, inventions, glyphs, weather];
export const vignetteById = (id: string) => VIGNETTES.find(v => v.id === id);

// ---------------------------------------------------------------------------------------------
// Playing them.

/** Plays a vignette: beats run in order as time passes; going back in time rebuilds from the start. */
export class VignettePlayer {
  readonly vignette: Vignette;
  scene!: StageScene;
  private clock = { t: 0 };
  private next = 0;
  private last = -1;
  constructor(vignette: Vignette) { this.vignette = vignette; this.reset(); }

  reset(): void {
    this.clock.t = 0;
    this.scene = this.vignette.build(this.clock);
    this.next = 0;
    this.last = -1;
  }

  /** Run every beat up to t (milliseconds into the vignette). */
  seek(t: number): void {
    if (t < this.last) this.reset();
    const beats = this.vignette.beats;
    while (this.next < beats.length && beats[this.next]!.at <= t) {
      const beat = beats[this.next++]!;
      this.clock.t = beat.at;
      beat.run(this.scene, beat.at);
    }
    this.clock.t = t;
    this.last = t;
  }

  /** The frame at t. */
  frame(t: number, view: View): Canvas {
    this.seek(t);
    const s = this.scene;
    if (this.vignette.render) return this.vignette.render(s, t, view);
    return renderStage(s.world, s.dressing, {
      w: view.w, h: view.h, t, time: view.time ?? s.time, glyphs: view.glyphs, effects: s.fx, weather: view.weather ?? s.weather,
      positions: id => s.director.tweens.at(id, t), ...(s.focus ? { focus: s.focus } : {}), ...(s.scale ? { scale: s.scale } : {}),
    });
  }

  /** What happened lately (for the caption panel). */
  recent(t: number, n = 4): LogLine[] { return this.scene.log.filter(l => l.at <= t).slice(-n); }
}

/** A single frame of a vignette at time t, from scratch (exact; for dumps and tests). */
export function frameAt(id: string, t: number, view: View): Canvas {
  const v = vignetteById(id);
  if (!v) throw new Error(`no vignette "${id}" (have: ${VIGNETTES.map(x => x.id).join(", ")})`);
  return new VignettePlayer(v).frame(t, view);
}
