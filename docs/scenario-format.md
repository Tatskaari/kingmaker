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

### As built (M4, the game's side)

- **The code:** [shared/scene/scenario.ts](../shared/scene/scenario.ts) has the three documents, their parses (the shape the game reads, unknown keys kept) and the game's own shapes made from them: the campaign, map and place the game kept before M4 (`CampaignFile`, `MapFile`, `PlaceFile`), each the old file's fields in their order, so what's installed and kept in the rows is unchanged. [shared/scene/scenario-rules.ts](../shared/scene/scenario-rules.ts) has the check's rules, each problem with its file and where in it, for the plugin to run too.
- **The files** are written as the scenes are: `JSON.stringify` with two spaces and a closing newline, so the plugin can save them byte for byte. A campaign folder has one scenario, at its root, named for its id.
- **The loader reads either:** the campaign's version is `campaignVersion`, or a string in `version` with no `campaignVersion` (a scenario written before the rename); the check asks for `campaignVersion`.
- **A region with a scene lays it or opens it.** One with a `worldOrigin` is where the scene's place is laid, and the place must fit on the map from there (its feet in tiles of five, rounded up). One with a `trigger` and no `worldOrigin` opens a scene laid by another region (the town's wharf end opens the Heron, whose own map lays it): its scene must be laid somewhere. A region with a scene and neither is a problem.
- **Everyone a place starts is its scene's cast** was already a scene rule: the check says it at the scene (`<place>'s people: <id> isn't in the cast`).
- **Reachable:** from the start map through the maps' exits, every scene a region of those maps plays (`sceneId`), and from each of those every ending's `next`, again and again; with no start map, from the first scene. A start on a map the scenario hasn't got, or a map on the way that doesn't build, is its own problem, and nothing is said of what's beyond it.
- **Also checked:** each file's id is its name and it has a title and a description; the scenario lists nothing twice and its talk template isn't one of its scenes; a map is 160 by 120 tiles at most; a region's `opensFor` and `exteriorOf` name the scenario's scenes too; and a place's areas, its things' spots and its people's starts are on its floor (from 0 up to its width and depth in feet, since the game lays it on its map from its corner and what's past its edges stands off its tiles).

### As built (M4, the plugin's side)

- **The editors:** the scenario opens as a diagram of its scenes and maps ([tools/authoring/src/scenario](../tools/authoring/src/scenario/)), each map on an isometric painter whose palette is its legend ([src/map](../tools/authoring/src/map/)), and each place on its map, over the region that lays it, or on its own grid ([src/place](../tools/authoring/src/place/)). The plugin's README says what each does ([tools/authoring/README.md](../tools/authoring/README.md)).
- **Written as the game writes them:** a file is changed a value at a time and written as `JSON.stringify` with two spaces and a newline, so an untouched one saves to the same bytes and an edit changes only what it changed. A map's grid is written a row at a time: a row nothing was painted on is the same row, and a painted row keeps its own length where what's past it is the void (the game pads a short row with it).
- **The layout's keys** are `start`, `scenes/<id>` and `maps/<id>` (a scene and a map can share an id: the Drowned Rat is both), each a point in whole pixels. A card the layout doesn't place goes where the default puts it (the story's scenes along the top, the maps beneath).
- **The flow edited in its owners:** an ending's `next` in its scene's file, a region's `sceneId` and a map's `exits` in the map's file, `start` and `firstScene` in the scenario. The exits that lead to the same map with the same label are one port. A way into a map lands just inside its way back to where it came from (the standable tile nearest it that isn't a way out, a step straight out before one aslant), or nearest its middle.
- **The default legend** (a new map's, and a migrated one's characters): `,` grass, `:` dirt, `.` cobbles, `_` boards, `~` water, `w` deep water, `=` bridge, `#` a stone wall, `W` a timber wall, `+` a timber door, `o` a stone window, `r` boards under a brick roof (height 3), `t` a tree, `f` a fence, `v` stairs; and on cobbles `l` a lamp, `s` a sign, `k` a crate, `b` a barrel, `n` a bench. Each entry writes only what differs from its terrain's defaults (a wall's height 3 isn't written).
- **The start set on a map** lists the map in the scenario's `maps` when it isn't, if the file is `maps/<id>.kmmap` (a map elsewhere can't be the start). A resize of a north or west edge moves what other files say of the map's tiles with them: the start, and the exits of other maps that land on it.
- **A place on its map:** a spot in feet falls on the tile `worldOrigin + floor(feet / 5)`, as the game lays it; a thing or someone moved there keeps where in its tile it was, and goes into the area under it (a held thing stays held).
- **A path naming a thing the place hasn't got** is a warning in the scene editor, not a problem, and not in the campaign check: a via of more than one word that names neither someone of the cast (id, name, called, also known as) nor a thing or an area of the scene's place (id or name), compared as words (no case, no leading article, nothing in brackets). A scene with no place has nothing to check.
- **A version 1 map migrates** to a map whose id is its file's name: each palette id, and each pair of a palette id and the clutter on it, a legend character (the default legend's; clutter on anything but cobbles a character of its own, its clutter's in capitals); a spawn point the scenario's start when the author says so, else a region of one tile named for it; an interaction an exit (its exit led to a map), a region that plays a scene (to a scene, opened by interacting), or a region of one tile (its event message its description, its script notes kept as `notes`, a key the format keeps). The rest of the file's own keys are kept.
