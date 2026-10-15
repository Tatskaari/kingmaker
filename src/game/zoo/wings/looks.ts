import type { Entity, SceneWorld, ThingSpec } from "../../../world/scene-world.ts";
import { ignite, spill } from "../../../world/systems.ts";
import { DRESSINGS } from "../../look/dressings.ts";
import type { Weather } from "../../look/terrain.ts";
import { T } from "../../map/tiles.ts";
import type { Tile2 } from "../../types.ts";
import { feet, marks, point, rect, type Ctx, type Exhibit, type Trigger, type Wing } from "../model.ts";
import { COBBLES, floorFor, stage } from "./common.ts";
import { toHall } from "./hall.ts";

/**
 * The Hall of Looks: how everything is drawn, standing still to be looked at (and moving, where
 * things move). Every look here comes from the world's own states and names, as a scene's would:
 * nothing is painted on. The map draws them as the explore screen does; v looks down on the hall
 * from above, as a scene's stage does, with its weather, haze and coloured light.
 */

const GRID = `
########################################################
%......................................................#
%......................................................#
%......................................................#
%......................................................#
%.a...............b...............c....................#
%......................................................#
%......................................................#
%..w+w+w+w+ww..........................................#
%.................................~~~~.................#
%.................................~~~~.................#
%.d...............e.....l..............................#
%...............................f......................#
%......................................................#
%......................................................#
%......................................................#
%......................................................#
%.g...............h.............i......................#
%......................................................#
%......................................................#
%......................................................#
%......................................................#
%......................................................#
%.j......n........k....................o...............#
%..........................H...........................#
%.......................PPPPPPP...LLLLLLLLLLL..........#
%..CCFFBBGGDDWWKKSSYY...PrrrrrP...LmmmmmmmmmL...v..s...#
%..CCFFBBGGDDWWKKSSYY...PrrrrrP...+mmmmmmmmmL..........#
%.......................PrrrrrP...LmmmmmmmmmL..u..y....#
%..1.2.3.4.5.6.7.8.9....PPP+PPP...LmmmmmmmmmL..........#
%.q...............................LLLLLLLLLLL........z.#
%......................x......................t........#
X.E.A..................................................#
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%#
`;

const MARKS = "abcdelfghijnkoqxHtvusyzEA";
const at = marks(GRID, MARKS);
const ID = "zoo-looks";
const FLOOR = T("floor", { style: "flags" });

/** Things in a row: one every `step` tiles along y from x, each a thing spec with its spot. */
function row(x: number, y: number, step: number, things: Array<Omit<ThingSpec, "at" | "in"> & { in?: string }>): ThingSpec[] {
  return things.map((t, i) => ({ in: "hall-of-looks", ...t, at: feet({ x: x + i * step, y }) }));
}

const FIRES = row(3, 3, 2, [
  { id: "bonfire", name: "a bonfire", size: "medium", material: "wood", tags: ["fire", "light"], states: ["burning"] },
  { id: "blue-fire", name: "a blue driftwood fire", size: "medium", material: "wood", tags: ["fire", "light"], states: ["burning"] },
  { id: "green-fire", name: "a green witch-fire", size: "medium", material: "wood", tags: ["fire", "light"], states: ["burning"] },
  { id: "violet-fire", name: "a violet fire", size: "medium", material: "wood", tags: ["fire", "light"], states: ["burning"] },
  { id: "coal-brazier", name: "a brazier of coals", size: "medium", material: "iron", tags: ["fire", "light"], states: ["lit"] },
  { id: "burning-pan", name: "an oily iron pan, burning", size: "small", material: "iron", states: ["burning"] },
]);

const WRECKS = row(19, 3, 2, [
  { id: "burnt-chair", name: "a burnt chair", size: "medium", material: "wood", states: ["destroyed", "burnt"] },
  { id: "smouldering-cart", name: "the wreck of a handcart", size: "medium", material: "wood", states: ["destroyed", "smouldering"] },
  { id: "smashed-pane", name: "a smashed window pane", size: "small", material: "glass", states: ["destroyed"] },
  { id: "broken-jug", name: "a broken water jug", size: "small", material: "liquid", states: ["destroyed"] },
  { id: "smashed-statue", name: "a smashed statue", size: "medium", material: "stone", states: ["destroyed"] },
  { id: "torn-sack", name: "a torn sack", size: "small", material: "cloth", states: ["destroyed"] },
  { id: "smashed-crate", name: "a smashed crate", size: "medium", material: "wood", states: ["destroyed"] },
]);

const TINTS = row(35, 3, 2, [
  { id: "scorched-plank", name: "a scorched plank", size: "small", material: "wood", states: ["scorched"] },
  { id: "oiled-pan", name: "an oiled pan", size: "small", material: "iron", states: ["oiled"] },
  { id: "wet-coat", name: "a wet coat", size: "small", material: "cloth", states: ["wet"] },
  { id: "frozen-pail", name: "a frozen pail of water", size: "small", material: "liquid", states: ["frozen"] },
  { id: "poisoned-cup", name: "a poisoned cup", size: "tiny", material: "iron", states: ["poisoned"] },
  { id: "bloody-apron", name: "a bloodied apron", size: "small", material: "cloth", states: ["bloodied"] },
  { id: "rotten-apple", name: "a rotten apple", size: "tiny", material: "flesh", states: ["rotten"] },
  { id: "broken-chair", name: "a broken chair", size: "medium", material: "wood", states: ["broken"] },
  { id: "damaged-table", name: "a damaged table", size: "medium", material: "wood", states: ["damaged"] },
  { id: "empty-sacks", name: "a pile of empty sacks", size: "medium", material: "cloth", states: ["empty"] },
]);

const DOORS: ThingSpec[] = [
  { id: "open-door", name: "an open door", kind: "feature", in: "hall-of-looks", at: feet({ x: 4, y: 8 }), size: "medium", material: "wood", tags: ["door"], states: ["open"] },
  { id: "shut-door", name: "a shut door", kind: "feature", in: "hall-of-looks", at: feet({ x: 6, y: 8 }), size: "medium", material: "wood", tags: ["door"], states: ["closed"] },
  { id: "locked-door", name: "a locked door", kind: "feature", in: "hall-of-looks", at: feet({ x: 8, y: 8 }), size: "medium", material: "wood", tags: ["door"], states: ["closed", "locked"] },
  { id: "barred-door", name: "a barred door", kind: "feature", in: "hall-of-looks", at: feet({ x: 10, y: 8 }), size: "medium", material: "wood", tags: ["door"], states: ["closed", "barred"] },
  ...row(4, 10, 2, [
    { id: "overturned-table", name: "a table", size: "medium", material: "wood", tags: ["furniture"], states: ["overturned"] },
    { id: "overturned-chair", name: "a chair", size: "medium", material: "wood", tags: ["furniture"], states: ["overturned"] },
    { id: "overturned-barrel", name: "a barrel", size: "medium", material: "wood", states: ["overturned"] },
    { id: "overturned-bucket", name: "a bucket", size: "small", material: "wood", states: ["overturned"] },
    { id: "overturned-cup", name: "a cup", size: "tiny", material: "iron", states: ["overturned"] },
    { id: "open-hatch", name: "a cellar hatch", kind: "feature", size: "medium", material: "wood", states: ["open"] },
  ]),
];

const LIGHTS = row(19, 9, 2, [
  { id: "lit-lantern", name: "a lantern", size: "small", material: "iron", tags: ["light"], states: ["lit"] },
  { id: "dark-lantern", name: "another lantern", size: "small", material: "iron", tags: ["light"], states: [] },
  { id: "candle", name: "a candle", size: "tiny", material: "wood", tags: ["light"], states: ["lit"] },
  { id: "wet-torch", name: "a torch in a bracket", size: "small", material: "wood", tags: ["light"], states: ["lit", "wet"] },
  { id: "lamp-post", name: "a lamp post", kind: "feature", size: "medium", material: "iron", tags: ["light"], states: ["lit"] },
]);

const MOTION: ThingSpec[] = [
  { id: "sparrow", name: "a sparrow", kind: "creature", in: "hall-of-looks", at: feet({ x: 39, y: 9 }) },
  { id: "swinging-sign", name: "a shop sign on a bracket", in: "hall-of-looks", at: feet({ x: 41, y: 9 }), size: "small", material: "wood", states: ["hanging"] },
  { id: "midges", name: "a swarm of midges", kind: "creature", in: "hall-of-looks", at: feet({ x: 43, y: 10 }) },
  { id: "smouldering-log", name: "a smouldering log", in: "hall-of-looks", at: feet({ x: 45, y: 9 }), size: "medium", material: "wood", states: ["smouldering"] },
  { id: "glass-bottle", name: "a glass bottle", in: "hall-of-looks", at: feet({ x: 47, y: 9 }), size: "tiny", material: "glass" },
  { id: "duck", name: "a duck on the pond", kind: "creature", in: "hall-of-looks", at: feet({ x: 35, y: 10 }) },
];

const DOWN = row(3, 15, 2, [
  { id: "sleeping-dog", name: "a sleeping dog", kind: "creature", states: ["asleep"] },
  { id: "dead-rat", name: "a dead rat", kind: "creature", states: ["dead"] },
  { id: "drunk", name: "a drunk, out cold", kind: "person", states: ["unconscious"] },
  { id: "juggler", name: "a stunned juggler", kind: "person", states: ["stunned"] },
  { id: "flat-porter", name: "a porter, flat on his back", kind: "person", states: ["prone"] },
  { id: "snoring-watchman", name: "a snoring watchman", kind: "person", states: ["asleep"] },
]);

const HANGING = row(19, 15, 3, [
  { id: "hanging-sign", name: "a sign hanging from a bracket", size: "small", material: "wood", states: ["hanging"] },
  { id: "bunting", name: "bunting", size: "medium", material: "cloth", states: ["overhead"] },
  { id: "hiding-cat", name: "a cat, hiding", kind: "creature", states: ["hidden"] },
  { id: "fallen-picture", name: "a picture that has fallen off the wall", size: "small", material: "wood", states: ["fallen"] },
]);

const CROWDS: ThingSpec[] = [
  { id: "pigeons", name: "a flock of pigeons", kind: "creature", in: "hall-of-looks", at: feet({ x: 35, y: 15 }) },
  { id: "onlookers", name: "a crowd of onlookers", kind: "person", in: "hall-of-looks", at: feet({ x: 41, y: 15 }) },
  { id: "bees", name: "a swarm of bees", kind: "creature", in: "hall-of-looks", at: feet({ x: 46, y: 15 }) },
  { id: "dogs", name: "a pack of dogs", kind: "creature", in: "hall-of-looks", at: feet({ x: 51, y: 15 }) },
];

const INVENTED = row(3, 20, 3, [
  { id: "orrery", name: "a brass orrery", size: "small", material: "brass" },
  { id: "eel-jar", name: "a jar of pickled eels", size: "small", material: "glass" },
  { id: "velocipede", name: "a velocipede", size: "medium", material: "iron" },
  { id: "owl", name: "a stuffed owl in a waistcoat", size: "small", material: "cloth" },
  { id: "theodolite", name: "a theodolite", size: "small", material: "brass" },
]);

/** The waxworks: the arc's cast in a row, each in their letter and colour. */
const WAXWORKS = ["kell", "cob", "moll", "tull", "nan-quill", "arlo", "dilly", "hobb", "saul", "duchess", "hep", "scrope", "sallow", "crake", "king", "holt", "page", "lantern-boy"];

/** What the stage manager makes at the inventor's bench, one after another. */
const NEW_THINGS = ["a clockwork lobster", "a portable sundial", "a hat with a candle in it", "a phrenology bust"];

const SURFACES: Array<[string, Tile2]> = [["water", { x: 41, y: 20 }], ["oil", { x: 44, y: 20 }], ["spirits", { x: 47, y: 20 }], ["ale", { x: 50, y: 20 }], ["blood", { x: 53, y: 20 }], ["grease", { x: 41, y: 22 }], ["ice", { x: 44, y: 22 }], ["ash", { x: 47, y: 22 }]];
const NAMED_SURFACES: Array<[string, string, Tile2]> = [["slops", "a puddle of slops", { x: 50, y: 22 }], ["mud", "a patch of mud", { x: 53, y: 22 }]];

const WEATHERS: Weather[] = ["clear", "drizzle", "rain"];

const sign = (id: string, mark: string, title: string, shows: string[], text: string, triggers: Trigger[] = [], extra: Partial<Exhibit> = {}): Exhibit =>
  ({ id, title, shows, sign: at[mark]!, text, triggers, ...extra });

const station = (name: string, glyph: string, color = "#c8b28a") => ({ name, glyph, color });

const exhibits: Exhibit[] = [
  sign("looks", "A", "The Hall of Looks", ["The cast's letters and colours"],
    "How everything is drawn, from what the world says it is: a thing's name, what it's made of and its states. Nothing here is painted on; set fire to a scene's chair and it's drawn burning by the same rules. The map is the explore screen's; v looks down from above, as a scene's stage does, with the hall's weather, haze and coloured light."),
  sign("flames", "a", "The fire row (burning things)", ["Burning things", "Lights on and off"],
    "Anything burning and not wet flickers in flame colours over an ember background, its glyph taking turns with flame tongues, and lights what's round it by its size. Colour words set the flame: blue driftwood burns blue (the Drowned Rat's hearth), a green witch-fire green, a violet fire violet; spilled spirits burn blue. Throw the spirits on the floor and light them.",
    [{ id: "light-spirits", label: "Pour out the gin and light it", at: { x: 15, y: 5 }, station: station("a bottle of gin and a match", "ô", "#cfe0d8"), expect: ["ignite"], when: z => !Object.values(z.world.entities).some(e => e.kind === "surface" && e.tags.includes("spirits") && e.states.includes("burning")),
      run: z => {
        const pool = spill(z.world, "spirits", point({ x: 15, y: 3 }), 3, z.turn).surface;
        const lines = ignite(z.world, pool, z.turn);
        return { text: `You pour the gin out on the flags and drop the match in it. ${lines.join(" · ")}: it burns blue, as gin does, which is the gin's fault.`, lines };
      } }]),
  sign("wrecks", "b", "The scrapyard (wrecks and smouldering)", ["Wrecks and smouldering", "Debris and smoke"],
    "A destroyed thing is drawn as what's left of it, by what it was made of: char % if it burned, shards ' for glass, a puddle ~ for a liquid, rubble , for stone and metal, scraps , for cloth, gore % for flesh, splinters % for wood. A burnt wreck burns on a turn, then smoulders, its ember glow pulsing and lighting the ground a little."),
  sign("tints", "c", "The paint shop (marks of what happened)", ["Marks of what happened (state tints)"],
    "States tint what they're on: scorched, burnt, singed or charred go sooty; oiled has a slow rainbow sheen; wet or soaked goes blue-grey with glints; frozen goes ice-white (a frozen liquid is ▒); poisoned pulses green; bloodied is red; rotten, broken and damaged go dimmer; empty sacks and barrels sag. In a fight, the badly hurt are drawn bloodied."),
  sign("doors", "d", "The door wall (doors, hatches and furniture)", ["Doors, hatches and furniture states"],
    "A door reads open (') or shut; locked, barred or bolted it's a bold +. An open hatch is a dark ■. An overturned table or chair is ╨, an overturned barrel, bucket or cup a ○. In the story the authored states show at once (the Heron's land door barred, its river door bolted); the stage manager changes them.",
    [
      { id: "open-shut-door", label: "Open the shut door", at: "shut-door", when: z => z.thing("shut-door").states.includes("closed"), run: z => stage(z, [{ op: "state", what: "shut-door", add: ["open"], remove: ["closed"] }], "You open the door. It goes nowhere, which is a door's privilege.") },
      { id: "right-table", label: "Set the table back on its legs", at: "overturned-table", when: z => z.thing("overturned-table").states.includes("overturned"), run: z => stage(z, [{ op: "state", what: "overturned-table", remove: ["overturned"] }], "You right the table.") },
    ]),
  sign("lights", "e", "The lamplighter's row (lights on and off)", ["Lights on and off", "Coloured light and the time of day"],
    "Lamps, lanterns, candles, braziers and hearths glow and flicker when lit and go dim when not; a wet flame goes out. The town's lamp posts light at dusk (the hall's clock gets you there). The pole lights and puts out.",
    [
      { id: "light-lantern", label: "Light the dark lantern", at: at.l!, station: station("the lamplighter's pole", "╿", "#e8d8a0"), when: z => !z.thing("dark-lantern").states.includes("lit"), run: z => stage(z, [{ op: "state", what: "dark-lantern", add: ["lit"] }], "You light the lantern.") },
      { id: "snuff-candle", label: "Snuff the candle", at: at.l!, when: z => z.thing("candle").states.includes("lit"), run: z => stage(z, [{ op: "state", what: "candle", remove: ["lit"], add: ["unlit"] }], "You snuff the candle.") },
      { id: "dry-torch", label: "Dry the torch, and light it", at: at.l!, when: z => z.thing("wet-torch").states.includes("wet"), run: z => stage(z, [{ op: "state", what: "wet-torch", remove: ["wet"], add: ["lit"] }], "You dry the torch on your sleeve and light it. Your sleeve is now the wet thing.") },
    ]),
  sign("motion", "f", "The pond (idle motion)", ["Idle motion"],
    "Only living, burning or glinting things move: water and glass shimmer as they catch the light, birds flutter (v and V), hanging things sway, things on water bob, embers pulse, insects swarm, smoke and steam drift. Everything else is still, as things are."),
  sign("down", "g", "The dormitory (beings down, asleep and dead)", ["Beings down, asleep and dead", "Life in the air on the stage"],
    "People and creatures who are down, unconscious, prone, asleep or stunned are drawn dimmer (in the kingmaker glyphs they lie down, and dogs curl up). The dead are %. From above, z and Z drift over the sleepers. The rat is not asleep."),
  sign("hanging", "h", "The rafters (hanging, overhead, hidden and fallen)", ["Hanging, overhead, hidden and fallen"],
    "Hanging things are raised seven feet and sway (Prout on the hoist; the Heron's lanterns). Overhead things are raised and faint: bunting, a washing line. Hidden things are faint and grey: the cat is hiding, and would like that respected. Fallen things lie on the ground."),
  sign("crowds", "i", "The square (groups and crowds)", ["Groups and crowds"],
    "A flock, crowd, swarm, pack, gang, mob or throng is drawn as several glyphs round its spot (a flock six, a crowd five, a swarm eight), each on its own beat: the Rat's regulars, the Heron's gang, the town's pigeons, and any flock of pigeons the GM makes."),
  sign("invented", "j", "The inventor's bench (looks for anything the GM invents)", ["Looks for anything the GM invents"],
    "A thing is drawn from its name by about two hundred rules: the head noun, colour and state words, and phrases like \"a jar of\" and \"a flock of\". A name the rules don't know gets a guess while one small background call asks the model for a glyph, a colour and how it moves, and the answer is kept for good (runs/look-cache.json; KM_LOOK_MODEL=off keeps the guesses). The bench has the stage manager make something new.",
    [{ id: "invent", label: "Have the stage manager make something new", at: at.n!, station: station("the inventor's bench", "╤", "#a07a52"), expect: ["poof"], when: z => !!nextThing(z),
      run: z => { const name = nextThing(z)!; return stage(z, [{ op: "create", name, kind: "object", to: "theodolite" }], `"Enter: ${name}." The look layer has never heard of one, and has a go.`); } }],
    { needsModel: true }),
  sign("waxworks", "k", "The waxworks (the cast's letters and colours)", ["The cast's letters and colours"],
    "One cast table gives everyone in the story the same letter and colour on the map, the stage, the battlefield and in the transcript: Kell a blue K, Cob c, Moll m, Tull T, Nan N, Arlo A, Dilly D, Hobb H, Saul S, Duchess d, Hep G, Scrope s, Sallow $, a Crake C, the King ♔, the Marshal M, the palace page p, the lantern-boy l, and you @. They're wax. Kell's is a good likeness; she disapproves of it."),
  sign("surfaces", "o", "The spill floor (surfaces on the ground)", ["Surfaces on the ground", "Clouds and haze"],
    "Patches lie over the ground and under people: water ~, oil ≈ with a rainbow sheen, spirits (a faint shimmer, and blue when they burn), ale, blood (dark and still), grease and ice (slick), scorch marks, slops, mud. New ones come from the world's physics: in a scene, from the rules or the stage manager."),
  sign("ground", "q", "The sample floor (living ground and walls)", ["Living ground and walls"],
    "Ground is drawn fresh each frame: water runs with its current, puddles hold the sky's colour, grass moves in gusts; cobbles, flags, boards, carpet, steps and bridges each have their look. Walls have their style: stone, brick, timber, plaster, bank, palace, hedge, tar and glass. From above (v), each scene's dressing gives its floors, walls and windows."),
  sign("xray", "x", "The shed (x-ray, and roofs off)", ["X-ray", "Roofs off and cutaways"],
    "Anyone behind a nearer building, roof or tree shows through it in a soft patch, a little greyer, with the building's outline kept: there's a woman behind the shed, and a man inside it. Walk into the shed and its roof comes off and its front walls are cut down to a ledge so you can see in; outdoors nothing is cut."),
  sign("coloured-light", "t", "The lamp room (coloured light)", ["Coloured light and the time of day", "Burning things"],
    "Light is Brogue-style: daylight by the time of day, dimmer indoors; coloured sources fall off softly and walls stop them. The lamp room is dark but for three coloured fires. People take only half a light's colour and never drop below a 3.5:1 contrast with their ground, so they can be found at night. The hall's clock moves the hour."),
  sign("weather", "u", "The weather vane (weather)", ["Weather (gallery only)"],
    "Drizzle and rain streak the outdoor cells and ring the puddles, in the view from above. No scene of the story has weather; the Theatre's belfry booth has drizzle, and so has this hall, when the vane says so. Turn it, then press v.",
    [{ id: "vane", label: "Turn the weather vane", at: at.v!, station: station("a weather vane", "↑", "#c8c0b0"),
      run: z => {
        const d = DRESSINGS[z.wing.id]!;
        const next = WEATHERS[(WEATHERS.indexOf(d.weather ?? "clear") + 1) % WEATHERS.length]!;
        d.weather = next;
        return { text: next !== "clear" ? `The vane swings round. It's ${next === "rain" ? "raining" : "drizzling"} in the Hall of Looks, from above (v).` : "The vane swings round. The weather stops, as if it had somewhere to be." };
      } }], { tour: ["vane", "vane", "vane"] }),
  sign("clouds", "y", "The smoke pot (clouds and haze)", ["Clouds and haze"],
    "Smoke, steam, dust, fog and poison gas veil what's under them, translucent, drifting with the wind. Something burning makes smoke where it stands; a douse leaves steam; clouds drift off after a few turns (the sand-glass in the Works). From above, the lamp room hangs with dust and the far corner with fog.",
    [
      { id: "smoke-pot", label: "Light the smoke pot", at: at.s!, station: station("a smoke pot", "♨", "#9a9890"), run: z => ({ text: "The pot smokes, theatrically.", lines: spill(z.world, "smoke", point(at.s!), 5, z.turn).lines }) },
      { id: "kettle", label: "Boil the kettle by it", at: at.s!, run: z => ({ text: "The kettle boils. Steam, briefly, and a whistle.", lines: spill(z.world, "steam", point({ x: at.s!.x, y: at.s!.y + 1 }), 4, z.turn).lines }) },
    ]),
  sign("stage", "z", "The stage (a scene's place from above)", ["The stage: a scene's place from above", "Life in the air on the stage", "Weather (gallery only)"],
    "A scene's world drawn top-down beside its transcript, Caves of Qud style: its floors, walls, windows and river; things by the look's rules; people where they are mid-walk; effects, barks and damage numbers; then the light; and a legend of who's there and what's spilled. Over it, embers and smoke rise from what burns, steam from the stew pots, dust motes hang in the air and z drifts over sleepers. v here shows the hall that way."),
];

/** The next of the inventor's things that isn't on the bench yet. */
function nextThing(z: Ctx): string | undefined {
  return NEW_THINGS.find(n => !Object.values(z.world.entities).some(e => e.name === n && !e.states.includes("gone")));
}

export const looks: Wing = {
  id: ID,
  name: "the Hall of Looks",
  about: "How everything is drawn, from what the world says it is: fire, wrecks, tints, doors, lights, motion, the fallen, crowds, the cast, ground, surfaces, light, weather and x-ray.",
  entry: at.E!,
  cast: Object.fromEntries(WAXWORKS.map(id => [id, { name: `the waxwork of ${id === "crake" ? "a Crake" : id.replace(/-/g, " ")}`, description: "A waxwork, very lifelike, very still. It has been dusted recently." }])),
  map: {
    grid: GRID,
    legend: {
      "#": T("wall", { style: "civic", height: 3 }), "%": T("wall", { style: "stone", height: 1 }), ".": FLOOR, X: T("door", { style: "stone", height: 1 }),
      w: T("wall", { style: "plaster", height: 2 }), "+": T("door", { style: "plaster", height: 2 }), "~": T("water"),
      C: COBBLES, F: FLOOR, B: T("boards"), G: T("grass"), D: T("dirt"), W: T("water"), K: T("floor", { style: "carpet" }), S: T("stairs"), Y: T("bridge"),
      "1": T("wall", { style: "stone", height: 2 }), "2": T("wall", { style: "brick", height: 2 }), "3": T("wall", { style: "timber", height: 2 }), "4": T("wall", { style: "plaster", height: 2 }),
      "5": T("wall", { style: "bank", height: 2 }), "6": T("wall", { style: "palace", height: 2 }), "7": T("wall", { style: "hedge", height: 2 }), "8": T("wall", { style: "tar", height: 2 }), "9": T("window"),
      P: T("wall", { style: "plaster", height: 2 }), r: T("boards", { roof: "tar", roofHeight: 2 }),
      L: T("wall", { style: "brick", height: 2 }), m: T("floor", { style: "flags", roof: "plaster", roofHeight: 2 }),
      ...floorFor(MARKS, FLOOR),
    },
    regions: [
      { id: "zoo-looks-shed", name: "the shed", rect: { x: 25, y: 26, w: 5, h: 3 }, description: "A small tarred shed, with a man inside counting spoons." },
      { id: "zoo-looks-lamps", name: "the lamp room", rect: { x: 35, y: 26, w: 9, h: 4 }, description: "A dark room lit only by three coloured fires." },
    ],
    exits: [{ at: { x: 0, y: 32 }, to: toHall(ID), label: "Back to the hall" }],
  },
  world: {
    name: "The Hall of Looks", description: "A long hall of things set out to be looked at, in rows, with signs.",
    size: { w: 56 * 5, h: 34 * 5 },
    areas: [
      { id: "hall-of-looks", name: "the Hall of Looks", rect: rect(0, 0, 56, 34) },
      { id: "shed", name: "the shed", rect: rect(25, 26, 5, 3) },
      { id: "lamp-room", name: "the lamp room", rect: rect(35, 26, 9, 4) },
      { id: "foggy-corner", name: "the foggy corner", rect: rect(46, 18, 9, 6) },
    ],
    things: [
      ...FIRES, ...WRECKS, ...TINTS, ...DOORS, ...LIGHTS, ...MOTION, ...DOWN, ...HANGING, ...CROWDS, ...INVENTED,
      { id: "spoon-man", name: "a man counting spoons", kind: "person", in: "shed", at: feet({ x: 27, y: 27 }), description: "He's counting the spoons. He's got to forty and lost his place twice." },
      { id: "shed-woman", name: "a woman behind the shed", kind: "person", in: "hall-of-looks", at: feet(at.H!), description: "She's waiting for the man counting spoons, and has been for some time." },
      { id: "blue-brazier", name: "a blue fire in a brazier", in: "lamp-room", at: feet({ x: 36, y: 26 }), size: "medium", material: "iron", tags: ["fire", "light"], states: ["burning"] },
      { id: "green-brazier", name: "a green fire in a brazier", in: "lamp-room", at: feet({ x: 39, y: 26 }), size: "medium", material: "iron", tags: ["fire", "light"], states: ["burning"] },
      { id: "violet-brazier", name: "a violet fire in a brazier", in: "lamp-room", at: feet({ x: 42, y: 26 }), size: "medium", material: "iron", tags: ["fire", "light"], states: ["burning"] },
      { id: "stew-pot", name: "a stew pot on the boil", in: "lamp-room", at: feet({ x: 39, y: 29 }), size: "medium", material: "iron" },
    ],
    people: {
      player: { in: "hall-of-looks", at: feet(at.E!) },
      ...Object.fromEntries(WAXWORKS.map((id, i) => [id, { in: "hall-of-looks", at: feet({ x: 19 + i, y: 21 }) }])),
    },
  },
  setup: (world: SceneWorld) => {
    for (const [stuff, tile] of SURFACES) spill(world, stuff as Parameters<typeof spill>[1], point(tile), 3, 0);
    for (const [id, name, tile] of NAMED_SURFACES) world.entities[id] = { id, name, kind: "surface", parent: "hall-of-looks", at: point(tile), radius: 3, tags: [], states: [], notes: [] } satisfies Entity;
    world.entities["fog-bank"] = { id: "fog-bank", name: "a cloud of fog", kind: "surface", parent: "foggy-corner", at: point({ x: 50, y: 21 }), radius: 8, tags: ["cloud"], states: [], notes: [] };
  },
  dressing: {
    ground: { "hall-of-looks": "flags", shed: "boards", "lamp-room": "flags", "foggy-corner": "flags" },
    indoor: ["shed", "lamp-room"],
    haze: [{ area: "lamp-room", kind: "dust", density: 0.25 }, { area: "foggy-corner", kind: "fog", density: 0.5 }],
    wind: { dir: 0.3, strength: 0.4 },
  },
  exhibits,
};
