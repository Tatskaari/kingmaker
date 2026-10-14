import type { Interaction, MapActor, Region, StoryState, StyledLine, Terrain, Tile, Tile2, TileMap } from "../../game/types.ts";
import { heldBy, positionOf, type Entity, type SceneWorld } from "../../world/scene-world.ts";
import type { CombatField, Dir, MapAdapter, MapView, Position, StepResult } from "../adapters.ts";
import { add, chebyshev, same, STEP } from "../geometry.ts";
import { C, glyphOf, PEOPLE } from "../theme.ts";

/**
 * Stand-in for src/game/map: Caerwyn as one small top-down tile map with the four places of the
 * story as regions (the granary yard, the Drowned Rat, the Heron warehouse, the palace), who's
 * about at each time of day, walking, and a plain renderer (two terminal cells a tile). The real
 * module replaces all of it (isometric view, interiors, scene-world reconciliation) through the
 * MapAdapter interface.
 */

const TOWN = "caerwyn";
const W = 76, H = 34;

const BLOCKS: Partial<Record<Terrain, boolean>> = { wall: true, "deep-water": true, fence: true, tree: true, window: true, void: true };
const OPAQUE: Partial<Record<Terrain, boolean>> = { wall: true, tree: true };

function grid(w: number, h: number, terrain: Terrain): Tile[][] {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => tile(terrain)));
}

function tile(terrain: Terrain, extra: Partial<Tile> = {}): Tile {
  return { terrain, ...(BLOCKS[terrain] ? { blocks: true } : {}), ...(OPAQUE[terrain] ? { opaque: true } : {}), ...extra };
}

function fill(t: Tile[][], x: number, y: number, w: number, h: number, terrain: Terrain, extra: Partial<Tile> = {}): void {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (t[j]?.[i]) t[j]![i] = tile(terrain, extra);
}

/** A building: walls round the edge, floor inside. */
function building(t: Tile[][], x: number, y: number, w: number, h: number, floor: Terrain = "floor"): void {
  fill(t, x, y, w, h, "wall", { height: 2 });
  if (w > 2 && h > 2) fill(t, x + 1, y + 1, w - 2, h - 2, floor);
}

function door(t: Tile[][], x: number, y: number, locked = false): void {
  t[y]![x] = tile("door", locked ? { blocks: true } : {});
}

/** Where things are in town: the places of the story and their doors. */
const PLACES = {
  start: { x: 8, y: 18 },
  yardGate: { x: 8, y: 16 },
  ratDoor: { x: 16, y: 26 },
  heronDoor: { x: 62, y: 26 },
  palaceGate: { x: 60, y: 13 },
};

const REGIONS: Region[] = [
  { id: "granary-yard", name: "the granary yard", rect: { x: 3, y: 10, w: 14, h: 6 }, sceneId: "hanged-clerk", worldOrigin: { x: 3, y: 10 } },
  { id: "granary", name: "the King's Granary", rect: { x: 2, y: 2, w: 16, h: 8 } },
  { id: "lane", name: "the lane by the granary gate", rect: { x: 1, y: 17, w: 21, h: 2 } },
  { id: "watch-house", name: "the watch house", rect: { x: 2, y: 19, w: 8, h: 2 } },
  { id: "corn-exchange", name: "the Corn Exchange", rect: { x: 24, y: 2, w: 13, h: 6 } },
  { id: "market", name: "the market square", rect: { x: 22, y: 8, w: 23, h: 13 } },
  { id: "palace", name: "the palace on the rise", rect: { x: 47, y: 1, w: 28, h: 12 }, sceneId: "kings-morning" },
  { id: "palace-approach", name: "below the palace gate", rect: { x: 45, y: 13, w: 30, h: 8 } },
  { id: "quay", name: "the quay", rect: { x: 1, y: 21, w: 74, h: 3 } },
  { id: "river-stairs", name: "the river stairs", rect: { x: 14, y: 24, w: 2, h: 5 } },
  { id: "drowned-rat", name: "the Drowned Rat", rect: { x: 17, y: 25, w: 7, h: 2 }, sceneId: "drowned-rat", worldOrigin: { x: 17, y: 25 } },
  { id: "foreshore", name: "the foreshore (mostly mud)", rect: { x: 1, y: 25, w: 13, h: 4 } },
  { id: "heron", name: "the Heron warehouse", rect: { x: 63, y: 23, w: 10, h: 8 }, sceneId: "heron-warehouse" },
  { id: "barge", name: "the barge Patience", rect: { x: 48, y: 29, w: 11, h: 3 } },
  { id: "wharves", name: "the wharves", rect: { x: 14, y: 25, w: 48, h: 4 } },
  { id: "river", name: "the river", rect: { x: 0, y: 29, w: W, h: 5 } },
];

function buildTown(): TileMap {
  const t = grid(W, H, "cobbles");
  // The city wall, and the river along the south.
  fill(t, 0, 0, W, 1, "wall", { height: 2 });
  fill(t, 0, 0, 1, 29, "wall", { height: 2 });
  fill(t, W - 1, 0, 1, 29, "wall", { height: 2 });
  fill(t, 0, 29, W, 5, "deep-water");
  // The King's Granary, and the yard behind it with its shoulder-high wall and gate.
  building(t, 2, 2, 16, 8);
  door(t, 10, 9, true);
  fill(t, 2, 10, 1, 7, "wall", { height: 1 });
  fill(t, 17, 10, 1, 7, "wall", { height: 1 });
  fill(t, 2, 16, 16, 1, "wall", { height: 1 });
  door(t, PLACES.yardGate.x, PLACES.yardGate.y);
  t[17]![19] = tile("tree");
  // Porters' lodgings, the watch house, the Corn Exchange and the houses round the square.
  fill(t, 19, 2, 3, 13, "wall", { height: 2 });
  building(t, 2, 19, 8, 2);
  door(t, 5, 19, true);
  building(t, 24, 2, 13, 6);
  door(t, 30, 7, true);
  fill(t, 38, 2, 7, 5, "wall", { height: 2 });
  // The market square: a well and the stalls.
  fill(t, 33, 14, 1, 1, "wall", { height: 1 });
  for (const [x, y] of [[25, 11], [26, 11], [40, 11], [41, 11], [25, 18], [26, 18], [40, 18], [41, 18]] as const) t[y]![x] = tile("fence");
  // The palace on the rise: gardens, a garden wall with the gate, the palace itself.
  fill(t, 47, 1, 28, 12, "grass");
  fill(t, 46, 1, 1, 13, "wall", { height: 1 });
  fill(t, 46, 13, 29, 1, "wall", { height: 1 });
  door(t, PLACES.palaceGate.x, PLACES.palaceGate.y);
  building(t, 54, 2, 17, 7);
  door(t, 62, 8, true);
  fill(t, 59, 9, 5, 4, "cobbles");
  for (const [x, y] of [[49, 3], [51, 6], [49, 10], [72, 4], [72, 10], [57, 11], [66, 11], [53, 11]] as const) t[y]![x] = tile("tree");
  fill(t, 48, 15, 6, 4, "wall", { height: 2 });
  fill(t, 66, 15, 8, 4, "wall", { height: 2 });
  // The embankment, the river stairs, the Drowned Rat dug into the bank, the foreshore and the wharves.
  fill(t, 1, 24, 74, 1, "wall", { height: 1 });
  fill(t, 1, 25, 13, 4, "dirt");
  fill(t, 14, 24, 2, 5, "stairs");
  fill(t, 57, 24, 2, 1, "stairs");
  building(t, 16, 24, 9, 4);
  door(t, PLACES.ratDoor.x, PLACES.ratDoor.y);
  fill(t, 25, 25, 37, 3, "boards");
  fill(t, 14, 28, 48, 1, "boards");
  // The Heron at the downriver end, half on the wharf and half on piles over the river.
  building(t, 62, 22, 12, 10, "boards");
  door(t, PLACES.heronDoor.x, PLACES.heronDoor.y);
  fill(t, 74, 22, 1, 7, "wall", { height: 2 });
  // The Saltmere barge Patience, moored with a gangplank.
  fill(t, 48, 30, 11, 2, "boards");
  t[29]![53] = tile("bridge");
  return { id: TOWN, name: "Caerwyn", width: W, height: H, tiles: t, regions: REGIONS, exits: [] };
}

/** Words painted over the map (tile coordinates; one character a cell). */
const LABELS: Array<{ at: Tile2; text: string }> = [
  { at: { x: 3, y: 5 }, text: " KING'S GRANARY " },
  { at: { x: 25, y: 4 }, text: " CORN EXCHANGE " },
  { at: { x: 58, y: 5 }, text: " THE PALACE " },
  { at: { x: 28, y: 9 }, text: "MARKET SQUARE" },
  { at: { x: 2, y: 20 }, text: " WATCH HOUSE " },
  { at: { x: 16, y: 24 }, text: " DROWNED RAT " },
  { at: { x: 64, y: 22 }, text: " THE HERON " },
  { at: { x: 34, y: 26 }, text: "THE WHARVES" },
  { at: { x: 22, y: 32 }, text: "~ the river, high and cold ~" },
];

// ---------------------------------------------------------------------------------------------
// Heron interior: the battlefield for "Roll for initiative".

function buildHeron(): TileMap {
  const t = grid(26, 14, "boards");
  fill(t, 0, 0, 26, 1, "wall", { height: 2 });
  fill(t, 0, 13, 26, 1, "wall", { height: 2 });
  fill(t, 0, 0, 1, 14, "wall", { height: 2 });
  fill(t, 25, 0, 1, 14, "wall", { height: 2 });
  door(t, 12, 0);
  door(t, 6, 13);
  // Sack stacks (cover), the scales, the counting-box up its stair.
  fill(t, 3, 3, 4, 1, "fence");
  fill(t, 3, 9, 4, 1, "fence");
  fill(t, 15, 10, 3, 1, "fence");
  fill(t, 9, 6, 2, 1, "fence");
  fill(t, 20, 1, 5, 3, "wall", { height: 2 });
  t[2]![20] = tile("door");
  fill(t, 21, 2, 3, 1, "floor");
  t[1]![14] = tile("stairs");
  return {
    id: "heron-floor", name: "The Heron's re-sacking floor", width: 26, height: 14, tiles: t, exits: [],
    regions: [
      { id: "floor", name: "the re-sacking floor", rect: { x: 1, y: 1, w: 24, h: 12 }, sceneId: "heron-warehouse" },
      { id: "counting-box", name: "the counting-box", rect: { x: 21, y: 2, w: 3, h: 1 } },
    ],
  };
}

const HERON_LABELS: Array<{ at: Tile2; text: string }> = [
  { at: { x: 2, y: 4 }, text: "grain sacks" },
  { at: { x: 20, y: 0 }, text: " counting-box " },
  { at: { x: 4, y: 13 }, text: " river door " },
];

const MAPS: Record<string, TileMap> = { [TOWN]: buildTown(), "heron-floor": buildHeron() };
const MAP_LABELS: Record<string, Array<{ at: Tile2; text: string }>> = { [TOWN]: LABELS, "heron-floor": HERON_LABELS };

// ---------------------------------------------------------------------------------------------
// Who's about: it depends on the time of day and where the story is heading.

const scene = (sceneId: string, verb: "talk" | "enter" | "open" | "examine", label: string): Interaction => ({ kind: "scene", sceneId, verb, label });
const look = (text: string, label = "Look"): Interaction => ({ kind: "examine", text, label });

function person(id: string, name: string, glyph: string, at: Tile2, interaction?: Interaction, extra: Partial<MapActor> = {}): MapActor {
  return { id, name, kind: "person", glyph, color: PEOPLE[id] ?? C.neutral, map: TOWN, at, blocks: true, ...(interaction ? { interaction } : {}), ...extra };
}

function thing(id: string, name: string, glyph: string, at: Tile2, interaction?: Interaction, extra: Partial<MapActor> = {}): MapActor {
  return { id, name, kind: "object", glyph, color: C.text, map: TOWN, at, blocks: false, ...(interaction ? { interaction } : {}), ...extra };
}

function townActors(story: StoryState): MapActor[] {
  const lead = story.lead;
  const played = new Set(story.played);
  const out: MapActor[] = [];
  // The granary yard: the morning's business.
  if (lead === "hanged-clerk") {
    const yard = (label: string) => scene("hanged-clerk", "talk", label);
    out.push(
      person("kell", "Sergeant Agnes Kell", "K", { x: 9, y: 15 }, yard("Talk to Sergeant Kell")),
      person("moll", "a girl on the yard wall", "m", { x: 13, y: 16 }, yard("Shout up at the girl on the wall")),
      person("cob", "a boy in enormous boots", "c", { x: 12, y: 12 }, yard("Ask the boy what he thinks he's doing")),
      thing("prout", "a hanged man", "&", { x: 12, y: 10 }, scene("hanged-clerk", "examine", "Take a closer look at the hanged man"), { color: C.danger }),
    );
  } else if (played.has("hanged-clerk")) {
    out.push(thing("yard-butt", "the water butt", "o", { x: 4, y: 14 }, look("The water butt in the granary yard. Behind it, if you know where to look, a loose board. You know where to look.")));
  }
  // The river stairs and the Drowned Rat: the evening.
  out.push(thing("rat-door", "the Drowned Rat's door", "+", PLACES.ratDoor, lead === "drowned-rat"
    ? scene("drowned-rat", "enter", "Go down into the Drowned Rat")
    : played.has("drowned-rat")
      ? look("The Drowned Rat. You have been thrown out of better places, though not recently.")
      : look("The Drowned Rat, dug into the bank halfway down the river stairs. Shut till evening. A board says NO CREDIT, which is also the whole of its menu."), { color: C.warn }));
  out.push(thing("rules-board", "the rules board", "=", { x: 15, y: 25 }, look("THE DROWNED RAT. RULES OF THE HOUSE. 1. No credit. 2. No blades out. 3. No fighting indoors. 4. No watch on duty. 5. No singing before the ninth bell. Someone has added, in chalk: 6. No.", "Read the rules board"), { color: C.dim }));
  // The Heron: the night.
  out.push(thing("heron-door", "the Heron's land door", "+", PLACES.heronDoor, lead === "heron-warehouse"
    ? scene("heron-warehouse", "enter", "Try the Heron's land door")
    : story.time === "evening"
      ? look("The Heron warehouse: lantern light in the cracks and a hoist working, late, on the eve of a holiday. Somebody is very busy.")
      : look("A tarred warehouse with a painted heron on its signboard. Locked, and the heron looks smug about it."), { color: C.warn }));
  if (lead === "heron-warehouse") {
    out.push(
      { id: "duchess", name: "Duchess, the watchman's dog", kind: "creature", glyph: "d", color: "#c8a070", map: TOWN, at: { x: 61, y: 25 }, blocks: true,
        interaction: look("A dog the size of a bad decision, snoring across the way in. Her collar says DUCHESS. She is not, you suspect, a duchess.", "Look at the dog") },
      thing("brazier", "the watchman's brazier", "*", { x: 61, y: 27 }, look("A brazier by an empty sentry box. Warm. The chair beside it is still warm too."), { color: C.warn, blocks: true }),
    );
  }
  out.push(thing("barge", "the barge Patience", "B", { x: 53, y: 30 }, look(story.time === "night"
    ? "The Saltmere barge Patience, broad and low, hatches open, her bargees waiting for the ebb and singing about it."
    : "A broad Saltmere barge called the Patience, moored off the wharves. Her bargees regard Caerwyn the way the river does."), { color: "#a8875a" }));
  // The palace: the next morning.
  if (lead === "kings-morning") {
    out.push(
      person("page", "a palace page", "p", { x: 59, y: 14 }, scene("kings-morning", "talk", "Follow the palace page: the King will see you"), { color: C.lead }),
      thing("palace-gate", "the palace gate", "+", PLACES.palaceGate, scene("kings-morning", "enter", "Go in to see the King"), { color: C.warn }),
    );
  } else {
    out.push(thing("palace-gate", "the palace gate", "+", PLACES.palaceGate, look("The palace gate. A guard explains, with real regret, that the palace is shut to anyone without business until the Assembly. You do not, he gathers, have business. Yet."), { color: C.warn }));
  }
  // Sergeant Kell keeps the investigator company once the morning is over (the King lent her to the case).
  const kellAt: Record<string, Tile2> = { "drowned-rat": { x: 17, y: 23 }, "heron-warehouse": { x: 58, y: 26 }, "kings-morning": { x: 61, y: 14 } };
  const kellSays: Record<string, string> = {
    "drowned-rat": "Go down to the Rat with Kell",
    "heron-warehouse": "Ask Kell what she makes of the Heron",
    "kings-morning": "Walk up to the palace with Kell",
  };
  if (lead && kellAt[lead]) out.push(person("kell", "Sergeant Agnes Kell", "K", kellAt[lead]!, scene(lead, "talk", kellSays[lead]!)));
  // The town going about its business.
  out.push(...townsfolk(story));
  return out;
}

function townsfolk(story: StoryState): MapActor[] {
  switch (story.time) {
    case "morning":
    case "afternoon":
      return [
        person("bunting-man", "a man up a ladder", "b", { x: 30, y: 10 }, look("A man up a ladder is hanging bunting with the grim concentration of someone who was told it would be straight. It will not be straight.")),
        person("crier", "a crier", "r", { x: 31, y: 8 }, look("A crier is reading out today's bread prices to a crowd that already knows them and is angry anyway.")),
        { id: "goose", name: "a goose", kind: "creature", glyph: "g", color: "#f0f0f0", map: TOWN, at: { x: 36, y: 16 }, blocks: true,
          interaction: look("A goose stands in the middle of the procession route as if it has been invited. Nobody present has the authority to move it.", "Regard the goose") },
        person("porter", "a porter with a sack", "q", { x: 15, y: 18 }, look("A porter shoulders past with a sack of something. 'Granary's shut,' he says. 'Clerk's hanging in the yard. Mind the step.' There is no step.")),
      ];
    case "evening":
      return [
        person("eel-seller", "an eel-seller", "e", { x: 30, y: 22 }, look("An eel-seller is packing up. She offers you the last eel at a price that suggests it is the last eel in Caerwyn.")),
        person("lamplighter", "a lamplighter", "l", { x: 46, y: 21 }, look("A lamplighter works along the quay, always exactly one lamp behind the dark.")),
        { id: "goose", name: "a goose", kind: "creature", glyph: "g", color: "#f0f0f0", map: TOWN, at: { x: 24, y: 20 }, blocks: true,
          interaction: look("The goose has moved to the quay. It appears to be following the case.", "Regard the goose") },
      ];
    case "night":
      return [
        person("night-porter", "night porters", "n", { x: 40, y: 22 }, look("Night porters go down to the shift in a silent line, like monks who have been told about overtime.")),
        person("eel-seller", "an eel-seller, asleep", "e", { x: 30, y: 22 }, look("The eel-seller has fallen asleep on her empty basket. The eel, presumably, sold.")),
      ];
    case "next-morning":
      return [
        person("marshal", "a procession marshal", "M", { x: 34, y: 12 }, look("A marshal with a list is telling a delegation from Kläggenheim that their axes are lovely but must walk behind the wheat-sheaves.")),
        person("delegate", "a dwarf with an axe", "x", { x: 36, y: 12 }, look("A Kläggenheim delegate is polishing a ceremonial axe and taking the order of procession personally.")),
        { id: "goose", name: "a goose with a ribbon", kind: "creature", glyph: "g", color: "#f0f0f0", map: TOWN, at: { x: 38, y: 16 }, blocks: true,
          interaction: look("The goose has been given a ribbon. Nobody will say who by.", "Regard the goose") },
      ];
  }
}

// ---------------------------------------------------------------------------------------------
// Walking.

const inRect = (p: Tile2, r: Region["rect"]) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

function regionAt(mapId: string, at: Tile2): Region | undefined {
  // The smallest region containing the point (the Rat inside the wharves).
  return MAPS[mapId]?.regions.filter(r => inRect(at, r.rect)).sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)[0];
}

const CLOSED: Record<string, { closed: string; done: string }> = {
  "hanged-clerk": { closed: "The yard gate is shut. Over the wall, someone is swearing in two languages.", done: "The yard has been swept again. Even the pigeons have moved on." },
  "drowned-rat": { closed: "The Drowned Rat is shut until evening. The door does not so much refuse you as fail to notice you.", done: "You have had quite enough of the Drowned Rat, and it of you." },
  "heron-warehouse": { closed: "The Heron's doors are barred. The heron on the signboard looks smug about it.", done: "Whatever happened at the Heron, it's not happening any more." },
  "kings-morning": { closed: "A guard at the gate explains, with real regret, that the palace is shut to anyone without business until the Assembly.", done: "The King has seen you. The palace, like a cat, has gone back to ignoring you." },
};

const BUMPS: Partial<Record<Terrain, string[]>> = {
  wall: ["A wall. It has seen off better investigators than you.", "The wall declines to be investigated.", "Solid. Caerwyn builds its walls the way it builds its grudges."],
  "deep-water": ["The river is high, fast and cold, and has never once given anything back.", "You consider the river. The river considers you right back."],
  fence: ["A stall in the way, its owner already looking at you as a customer."],
  tree: ["A tree. It was here first."],
  door: ["Locked. Of course it is."],
};

let bump = 0;
function blocked(t: Tile): string {
  const lines = BUMPS[t.terrain] ?? ["You can't go that way."];
  return lines[bump++ % lines.length]!;
}

function step(pos: Position, dir: Dir, actors: MapActor[], story: StoryState): StepResult {
  const map = MAPS[pos.map]!;
  const to = add(pos.at, STEP[dir]);
  const stay = { ...pos, facing: dir };
  const t = map.tiles[to.y]?.[to.x];
  if (!t) return { pos: stay, message: "That way lies the rest of the kingdom, which is not your problem today." };
  if (t.blocks) return { pos: stay, message: blocked(t) };
  const who = actors.find(a => a.blocks && a.map === pos.map && same(a.at, to));
  if (who) return { pos: stay, message: `${capital(who.name)} is in the way.${who.interaction ? ` (e: ${who.interaction.label})` : ""}` };
  const here = regionAt(pos.map, pos.at);
  const there = regionAt(pos.map, to);
  if (there?.sceneId && there.id !== here?.id) {
    if (there.sceneId === story.lead) return { pos: { map: pos.map, at: to, facing: dir }, trigger: scene(there.sceneId, "enter", `Enter ${there.name}`) };
    const words = CLOSED[there.sceneId];
    return { pos: stay, message: story.played.includes(there.sceneId) ? words?.done ?? "Nothing more for you there." : words?.closed ?? "Not now." };
  }
  return { pos: { map: pos.map, at: to, facing: dir } };
}

function nearby(pos: Position, actors: MapActor[], radius = 9): Array<{ actor: MapActor; distance: number }> {
  return actors.filter(a => a.map === pos.map && a.kind !== "player")
    .map(actor => ({ actor, distance: chebyshev(actor.at, pos.at) }))
    .filter(x => x.distance <= radius)
    .sort((a, b) => a.distance - b.distance || a.actor.name.localeCompare(b.actor.name));
}

function reachable(pos: Position, actors: MapActor[]): MapActor[] {
  const ahead = add(pos.at, STEP[pos.facing]);
  return actors.filter(a => a.map === pos.map && a.interaction && chebyshev(a.at, pos.at) <= 1)
    .sort((a, b) => Number(same(b.at, ahead)) - Number(same(a.at, ahead)) || chebyshev(a.at, pos.at) - chebyshev(b.at, pos.at));
}

const LOCATIONS: Record<string, { at: Tile2; name: string; outside: Tile2 }> = {
  "hanged-clerk": { at: PLACES.yardGate, name: "the granary yard, where a sergeant is waiting", outside: { x: 8, y: 17 } },
  "drowned-rat": { at: PLACES.ratDoor, name: "the Drowned Rat, halfway down the river stairs", outside: { x: 15, y: 26 } },
  "heron-warehouse": { at: PLACES.heronDoor, name: "the Heron warehouse, at the downriver end of the wharves", outside: { x: 60, y: 26 } },
  "kings-morning": { at: PLACES.palaceGate, name: "the palace, where the King is waiting", outside: { x: 60, y: 15 } },
};

/** After a scene the player steps back outside the place it was played in. */
function afterScene(sceneId: string, before: Position): Position {
  const place = LOCATIONS[sceneId];
  return place ? { map: TOWN, at: { ...place.outside }, facing: "s" } : before;
}

// ---------------------------------------------------------------------------------------------
// Drawing: two terminal cells a tile, so the town isn't squashed flat.

interface Cell { ch: string; fg: string; bg?: string; bold?: boolean }

function terrainCells(t: Tile, x: number, y: number): [Cell, Cell] {
  const speckle = ((x * 7 + y * 13) % 5) === 0;
  switch (t.terrain) {
    case "cobbles": return [{ ch: speckle ? "·" : " ", fg: "#45414d", bg: "#1d1c22" }, { ch: " ", fg: "#45414d", bg: "#1d1c22" }];
    case "grass": return [{ ch: speckle ? "\"" : " ", fg: "#4c7a3d", bg: "#16251a" }, { ch: " ", fg: "#4c7a3d", bg: "#16251a" }];
    case "dirt": return [{ ch: speckle ? "." : " ", fg: "#6b5338", bg: "#2a2117" }, { ch: " ", fg: "#6b5338", bg: "#2a2117" }];
    case "water": return [{ ch: "~", fg: "#4a7fb5", bg: "#12304d" }, { ch: " ", fg: "#4a7fb5", bg: "#12304d" }];
    case "deep-water": return [{ ch: (x + y) % 3 === 0 ? "≈" : " ", fg: "#2f5f94", bg: "#0c2240" }, { ch: (x * 3 + y) % 4 === 0 ? "~" : " ", fg: "#2f5f94", bg: "#0c2240" }];
    case "wall": return (t.height ?? 2) >= 2
      ? [{ ch: "█", fg: "#7d7362" }, { ch: "█", fg: "#7d7362" }]
      : [{ ch: "▒", fg: "#8c826f", bg: "#2a2722" }, { ch: "▒", fg: "#8c826f", bg: "#2a2722" }];
    case "floor": return [{ ch: speckle ? "·" : " ", fg: "#4d4337", bg: "#241f1a" }, { ch: " ", fg: "#4d4337", bg: "#241f1a" }];
    case "boards": return [{ ch: "═", fg: "#5e4630", bg: "#21180f" }, { ch: "═", fg: "#5e4630", bg: "#21180f" }];
    case "door": return [{ ch: "[", fg: t.blocks ? "#8a6a3a" : "#d4a05a", bg: "#3a2a18" }, { ch: "]", fg: t.blocks ? "#8a6a3a" : "#d4a05a", bg: "#3a2a18" }];
    case "fence": return [{ ch: "▓", fg: "#b89c6a", bg: "#2a2117" }, { ch: "▓", fg: "#b89c6a", bg: "#2a2117" }];
    case "tree": return [{ ch: "♣", fg: "#5aa04a", bg: "#16251a" }, { ch: " ", fg: "#5aa04a", bg: "#16251a" }];
    case "stairs": return [{ ch: "≡", fg: "#c8bfa8", bg: "#2a2722" }, { ch: "≡", fg: "#c8bfa8", bg: "#2a2722" }];
    case "bridge": return [{ ch: "═", fg: "#a8875a", bg: "#2b2016" }, { ch: "═", fg: "#a8875a", bg: "#2b2016" }];
    case "window": return [{ ch: "▫", fg: "#9ab", bg: "#222" }, { ch: "▫", fg: "#9ab", bg: "#222" }];
    case "void": return [{ ch: " ", fg: C.bg }, { ch: " ", fg: C.bg }];
  }
}

function render(view: MapView): StyledLine[] {
  const { map, centre, width, height } = view;
  const tilesW = Math.max(1, Math.floor(width / 2));
  const origin = {
    x: map.width <= tilesW ? -Math.floor((tilesW - map.width) / 2) : Math.max(0, Math.min(map.width - tilesW, centre.x - Math.floor(tilesW / 2))),
    y: map.height <= height ? -Math.floor((height - map.height) / 2) : Math.max(0, Math.min(map.height - height, centre.y - Math.floor(height / 2))),
  };
  const cells: Cell[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => ({ ch: " ", fg: C.bg })));
  const put = (tx: number, ty: number, pair: [Cell, Cell]) => {
    const sx = (tx - origin.x) * 2, sy = ty - origin.y;
    if (sy < 0 || sy >= height) return;
    if (sx >= 0 && sx < width) cells[sy]![sx] = pair[0];
    if (sx + 1 >= 0 && sx + 1 < width) cells[sy]![sx + 1] = pair[1];
  };
  for (let sy = 0; sy < height; sy++) for (let tx = origin.x; tx < origin.x + tilesW + 1; tx++) {
    const t = map.tiles[sy + origin.y]?.[tx];
    if (t) put(tx, sy + origin.y, terrainCells(t, tx, sy + origin.y));
  }
  // Labels go under people.
  for (const label of MAP_LABELS[map.id] ?? []) {
    const sy = label.at.y - origin.y;
    if (sy < 0 || sy >= height) continue;
    [...label.text].forEach((ch, i) => {
      const sx = (label.at.x - origin.x) * 2 + i;
      if (sx >= 0 && sx < width) cells[sy]![sx] = { ...cells[sy]![sx]!, ch, fg: C.title };
    });
  }
  const lead = view.story.lead;
  const highlight = new Set((view.highlight ?? []).map(p => `${p.x},${p.y}`));
  const order = (a: MapActor) => (a.kind === "player" ? 3 : a.kind === "person" || a.kind === "creature" ? 2 : 1);
  for (const a of [...view.actors].filter(a => a.map === map.id).sort((x, y) => order(x) - order(y))) {
    const sx = (a.at.x - origin.x) * 2, sy = a.at.y - origin.y;
    if (sy < 0 || sy >= height || sx < 0 || sx >= width) continue;
    const under = cells[sy]![sx]!;
    const isLead = !!lead && a.interaction?.kind === "scene" && a.interaction.sceneId === lead;
    const down = a.states?.some(s => ["down", "dead", "fled", "surrendered", "destroyed"].includes(s));
    const bg = a.kind === "player" ? C.playerBg : isLead ? C.leadBg : under.bg;
    cells[sy]![sx] = { ch: down ? "%" : a.glyph, fg: a.kind === "player" ? "#ffffff" : down ? C.dim : a.color ?? C.text, ...(bg ? { bg } : {}), bold: a.kind !== "object" };
    if (sx + 1 < width) {
      const right = cells[sy]![sx + 1]!;
      cells[sy]![sx + 1] = isLead ? { ch: "!", fg: C.lead, bg: C.leadBg, bold: true } : a.kind === "player" ? { ch: " ", fg: "#ffffff", bg: C.playerBg } : right;
    }
  }
  for (const key of highlight) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    const sx = (x - origin.x) * 2, sy = y - origin.y;
    for (const dx of [0, 1]) if (cells[sy]?.[sx + dx]) cells[sy]![sx + dx] = { ...cells[sy]![sx + dx]!, bg: C.highlightBg };
  }
  if (view.target) {
    const sx = (view.target.x - origin.x) * 2, sy = view.target.y - origin.y;
    for (const dx of [0, 1]) if (cells[sy]?.[sx + dx]) cells[sy]![sx + dx] = { ...cells[sy]![sx + dx]!, bg: C.targetBg };
  }
  return cells.map(row => {
    const line: StyledLine = [];
    for (const cell of row) {
      const last = line.at(-1);
      if (last && last.fg === cell.fg && last.bg === cell.bg && !!last.bold === !!cell.bold) last.text += cell.ch;
      else line.push({ text: cell.ch, fg: cell.fg, ...(cell.bg ? { bg: cell.bg } : {}), ...(cell.bold ? { bold: true } : {}) });
    }
    return line;
  });
}

/**
 * A scene's world drawn top-down at the largest scale that fits (a 5 ft square is two cells wide
 * and one row tall, or four by two, or six by three): areas as floors, people by initial, things as
 * marks, what's burning or broken shown as such.
 */
function sceneView(world: SceneWorld, view: { width: number; height: number }): StyledLine[] {
  const root = world.entities[world.root]!;
  const size = root.rect ?? { x: 0, y: 0, w: 50, h: 40 };
  const tilesW = Math.ceil(size.w / 5) + 1, tilesH = Math.ceil(size.h / 5) + 1;
  const sy = [3, 2, 1].find(s => tilesW * 2 * s <= view.width && tilesH * s <= view.height) ?? 1;
  const sx = tilesW * 2 * sy <= view.width ? 2 * sy : 1;
  const w = Math.min(view.width, tilesW * sx), h = Math.min(view.height, tilesH * sy);
  const cellAt = (feet: { x: number; y: number }) => ({ col: Math.floor(((feet.x - size.x) / 5) * sx), row: Math.floor(((feet.y - size.y) / 5) * sy) });
  const areas = Object.values(world.entities).filter(e => e.kind === "area" && e.rect).sort((a, b) => a.rect!.w * a.rect!.h - b.rect!.w * b.rect!.h);
  const shades = ["#26231f", "#1f2326", "#24201f", "#1f2421", "#25222a", "#20201c"];
  const shade = new Map(areas.map((a, i) => [a.id, a.tags.includes("outside") ? "#1b1d22" : shades[i % shades.length]!]));
  const grid: Cell[][] = Array.from({ length: h }, (_, row) => Array.from({ length: w }, (_, col) => {
    const feet = { x: size.x + ((col + 0.5) * 5) / sx, y: size.y + ((row + 0.5) * 5) / sy };
    const area = areas.find(a => feet.x >= a.rect!.x && feet.x < a.rect!.x + a.rect!.w && feet.y >= a.rect!.y && feet.y < a.rect!.y + a.rect!.h);
    return area ? { ch: (col * 7 + row * 13) % (sy > 1 ? 29 : 11) === 0 ? "·" : " ", fg: "#4a453d", bg: shade.get(area.id)! } : { ch: " ", fg: C.faint };
  }));
  // Marks keep the floor colour under them.
  const put = (feet: { x: number; y: number }, c: Cell) => {
    const { col, row } = cellAt(feet);
    const under = grid[row]?.[col];
    if (!under) return;
    grid[row]![col] = { ...c, ...(c.bg ?? under.bg ? { bg: c.bg ?? under.bg! } : {}) };
  };
  // Room enough: name the areas in their top-left corners.
  if (sy >= 2) for (const a of areas) {
    const { col, row } = cellAt({ x: a.rect!.x, y: a.rect!.y });
    const room = Math.max(0, Math.floor((a.rect!.w / 5) * sx) - 1);
    [...a.name.replace(/\s*\(.*\)$/, "").slice(0, room)].forEach((ch, i) => { const cell = grid[row]?.[col + i]; if (cell) grid[row]![col + i] = { ...cell, ch, fg: "#7a6f5c" }; });
  }
  const gone = (e: Entity) => e.states.includes("gone");
  const things = Object.values(world.entities).filter(e => (e.kind === "object" || e.kind === "item" || e.kind === "feature") && !gone(e) && !heldBy(world, e));
  for (const t of things) {
    const at = positionOf(world, t.id);
    if (!at) continue;
    const burning = t.states.includes("burning"), broken = t.states.includes("destroyed");
    put(at, { ch: burning ? "^" : broken ? "x" : t.kind === "feature" ? "▪" : t.kind === "item" ? "*" : "■", fg: burning ? C.danger : broken ? C.dim : t.tags.includes("evidence") ? C.lead : "#9a8f7a" });
  }
  for (const p of Object.values(world.entities).filter(e => (e.kind === "person" || e.kind === "creature") && !gone(e))) {
    const at = positionOf(world, p.id);
    if (!at) continue;
    const down = p.states.some(s => ["down", "unconscious", "dead"].includes(s));
    put(at, p.player
      ? { ch: "@", fg: "#ffffff", bg: C.playerBg, bold: true }
      : { ch: down ? "%" : glyphOf(p.cast ?? p.id, p.name), fg: PEOPLE[p.cast ?? p.id] ?? C.neutral, bold: true });
  }
  return grid.map(row => {
    const line: StyledLine = [];
    for (const c of row) {
      const last = line.at(-1);
      if (last && last.fg === c.fg && last.bg === c.bg && !!last.bold === !!c.bold) last.text += c.ch;
      else line.push({ text: c.ch, fg: c.fg, ...(c.bg ? { bg: c.bg } : {}), ...(c.bold ? { bold: true } : {}) });
    }
    return line;
  });
}

function combatField(sceneId: string): CombatField {
  void sceneId; // One battlefield in the stand-in: the Heron's floor (the arc's only fight).
  return {
    map: MAPS["heron-floor"]!,
    spots: {
      player: { x: 12, y: 1 },
      allies: [{ x: 11, y: 1 }, { x: 13, y: 1 }, { x: 10, y: 2 }],
      enemies: [{ x: 18, y: 6 }, { x: 13, y: 7 }, { x: 15, y: 8 }, { x: 11, y: 9 }, { x: 8, y: 8 }, { x: 17, y: 11 }],
      neutrals: [{ x: 22, y: 2 }, { x: 3, y: 11 }, { x: 21, y: 11 }, { x: 7, y: 1 }, { x: 2, y: 6 }],
    },
  };
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export const standInMap: MapAdapter = {
  start: () => ({ map: TOWN, at: { ...PLACES.start }, facing: "n" }),
  map: id => {
    const map = MAPS[id];
    if (!map) throw new Error(`No map ${id} (the stand-in has ${Object.keys(MAPS).join(", ")})`);
    return map;
  },
  actors: (mapId, story) => (mapId === TOWN ? townActors(story) : []),
  step,
  nearby,
  reachable,
  regionAt,
  sceneLocation: sceneId => {
    const place = LOCATIONS[sceneId];
    return place ? { map: TOWN, at: place.at, name: place.name } : undefined;
  },
  afterScene,
  render,
  sceneView,
  combatField,
};
