# The scenario, its maps and its places (.kmscenario, .kmmap, .kmplace: version 2)

The whole campaign is authored in Obsidian. Every file the plugin edits is a file the game loads, as it is. Nothing is exported, imported or kept in two copies. The campaign folder is the vault (`campaigns/<id>/`):

```
campaigns/caerwyn/
  caerwyn.kmscenario          the campaign: its start, its scenes and maps, the purse, the quests (was campaign.json)
  scenes/<id>.kmscene         a scene (docs/scene-format.md)
  maps/<id>.kmmap             a map: the town, the Rat's cellar… (was maps/<id>.json)
  places/<key>.kmplace        a scene's place: its areas, things and where people start (was places/<key>.json)
  lore/                       the lore notes (Markdown, as now)
  builds.json, looks.json, vocabulary.json   unchanged (not authored in the plugin yet)
```

Every file has the same envelope as a scene: `format: "kingmaker"`, `version: 2`, `kind`, `id`, `title`, `description`. Unknown keys are kept on save.

## The scenario (`<campaign>.kmscenario`)

These are the old campaign.json's fields, under the envelope:

```ts
interface ScenarioDocument {
  format: "kingmaker";
  version: 2;
  kind: "scenario";
  /** The campaign's id: "caerwyn". */
  id: string;
  title: string;
  description: string;
  /** The campaign's own version ("0.1.0"); the envelope's `version` is the format's (see the note below). */
  campaignVersion: string;
  firstScene: string;
  startPlace: string;
  /** When the story starts, and where the player starts walking: a map and a tile on it (the plugin's spawn point). */
  start: { day: number; time: TimeOfDay; map?: string; at?: [number, number] };
  level: number;
  rulesPack: string;
  /** The story's scenes in order, and the talk template. */
  scenes: string[];
  talk?: string;
  places: string[];
  maps: string[];
  startingPurse: Array<{ name: string; quantity: number; description: string }>;
  creation: CreationWorld;
  quests?: Record<string, string>;
  /** Where each scene and map sits on the scenario's diagram (the plugin's layout, nothing the game reads). */
  layout?: Record<string, { x: number; y: number }>;
}
```

**The version clash:** the envelope's `version` (2, the format) and the campaign's own version ("0.1.0") share a name. The campaign's moves to `campaignVersion`, and the loader reads either. A campaign's id for installs is still `<id>@<campaignVersion>`.

**The flow is derived, never stored.** The diagram's edges come from the files that own them, and the plugin edits each edge in its owner:
- A scene's ending goes to `next`, in the scene's file.
- A map region plays a scene (`sceneId`), in the map's file.
- A map exit leads to another map, in the map's file.
- The start map and tile live in the scenario file.

The diagram shows scenes and maps as nodes, laid out by `layout`.

## A map (`maps/<id>.kmmap`)

These are the game's map fields (shared/map/tiles.ts `MapFile`), under the envelope. The grid is rows of legend characters, north at the top. Each map defines its own legend:

```ts
interface MapDocument {
  format: "kingmaker";
  version: 2;
  kind: "map";
  id: string;
  /** The map's name as the game shows it. */
  title: string;
  description: string;
  grid: string[];
  /** Legend character → the tile: terrain, its overrides (style, height, roof, roofHeight, blocks, opaque) and the decor that stands on it. */
  legend: Record<string, LegendEntry>;
  /** Named parts of the map (a street, a yard). One with a sceneId is where that scene is played. Its trigger, label, shut/opensFor/lockedAfter, exteriorOf and locked are as now. Its worldOrigin pins the scene's place to the map (in tiles, 5 ft each). */
  regions: PlaceRegion[];
  /** Doors and paths to other maps. */
  exits: Array<{ at: { x: number; y: number }; to: { map: string; at: { x: number; y: number } }; label: string }>;
  /** Who's about at which hours. */
  people?: MapPerson[];
}
```

**The plugin's painter paints legend entries.**
- The palette is the map's legend.
- A new map starts from a default legend: the plugin's current palette and clutter, which already use the game's terrains (stone and timber walls, doors, windows, a roofed floor, a lamp, a crate…).
- The author can add entries: a terrain with a style, a height or a roof, and optional decor (name, glyph, colour, states, text, blocks).
- Unknown characters are refused.
- Sizes go up to 160 by 120 (the town is 64 by 46). The game's renderer draws the preview, as it already does since M1.

**The plugin's map features map onto the game's fields:**
- **The spawn point** is the scenario's `start` (map and tile), set from the start map.
- **An interaction that plays a scene** is a region with a `sceneId`, a trigger (enter or interact) and a label.
- **An interaction that leads to another map** is a map exit with its label.
- **People by the hour** are markers with the hours they're about.

**The user's v1 maps migrate.** Each `.kmmap` v1 (a palette id per cell, clutter, features) migrates on open to v2:
- each palette id or clutter pair used becomes a legend character;
- the spawn becomes the scenario's start;
- interactions become regions or exits.

The plugin offers the migration and writes v2 back. The original stays in the vault's history (Obsidian's file recovery, and git).

## A place (`places/<key>.kmplace`)

These are the game's place fields (shared/world/scene-world.ts `WorldSpec`, as places/<key>.json has them), under the envelope. The place's coordinates are feet in the scene's world:

```ts
interface PlaceDocument {
  format: "kingmaker";
  version: 2;
  kind: "place";
  /** The place's key: what a scene's `place` names. */
  id: string;
  /** The place's name. */
  title: string;
  description: string;
  size: WorldSpec["size"];
  areas: WorldSpec["areas"];
  /** The things here: what the scenes' clue paths and effects name (the boot, the page, the cleat). */
  things: WorldSpec["things"];
  /** Where people start: cast id → area and spot (and the player). */
  people: WorldSpec["people"];
}
```

**The plugin edits a place as a layer on its map.**
- Select a region that plays a scene, and its scene's place is drawn over the map at the region's `worldOrigin`.
- Its areas are drawn as rectangles, its things as markers and its people as their glyphs.
- Each can be moved, added or removed, and edited in an inspector: a thing's name, kind, material, size, states, tags, what it contains, and its description.
- A place with no region yet is edited on its own grid.

**The scene links to it.** A scene's inspector shows its place's things. The clue paths' `via` can be picked from them, and the authoring check warns when a path names a thing the place doesn't have.

## What the game and the check do

- The game reads the scenario, maps and places from these files wherever it read campaign.json, maps/*.json and places/*.json:
  - the simulation's pack;
  - the AI service's campaign;
  - the in-process and browser hosts;
  - the browser's content allowlist;
  - the campaign check.
- The campaign check adds these checks:
  - every scene, map and place the scenario lists exists;
  - every `next`, `sceneId`, exit target and start points at something real;
  - every legend character used is defined, and every defined one is a known terrain;
  - every region with a scene has a `worldOrigin` and its scene's place fits inside the map;
  - every person a place starts is in its scene's cast, or is the player;
  - every scene is reachable on the maps from the start: a region or the story's flow plays it.
