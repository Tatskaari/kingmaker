# Kingmaker Authoring: the game's campaign in Obsidian

An Obsidian plugin for writing the game's campaign. Its vault is the campaign folder itself, [campaigns/caerwyn](../../campaigns/caerwyn/), and it edits the game's own files there, as the game loads them: the scenes (`scenes/<id>.kmscene`, the scene format: [docs/scene-format.md](../../docs/scene-format.md)), and the scenario, its maps and its places (`caerwyn.kmscenario`, `maps/<id>.kmmap`, `places/<key>.kmplace`, the scenario format: [docs/scenario-format.md](../../docs/scenario-format.md)), every one version 2. There's no export: the game loads the file the plugin saves, as it is, and the plugin holds each file to the same rules as `npm run campaign -- check` while you write. The lore is the vault's Markdown, edited in Obsidian's own editor.

The plugin's own version 1 files (its old scene graphs, scenarios and maps) aren't the game's: a version 1 scene or scenario opens read-only, and a version 1 map opens with the offer to migrate it.

## Setting up the vault

```sh
cd tools/authoring
npm ci
npm run build
npm run install:vault -- ../../campaigns/caerwyn
```

Then in Obsidian: **Open folder as vault**, and choose `campaigns/caerwyn` in your checkout. If Restricted mode is on, allow community plugins in Settings → Community plugins; Kingmaker Authoring is already in the vault's list of enabled plugins. Open `caerwyn.kmscenario` for the story's flow, `scenes/hanged-clerk.kmscene` for the worked example of a scene, or `maps/caerwyn.kmmap` for the town, from the file explorer (or the ribbon icon, or **Kingmaker Authoring: Open scene, scenario, map or place**).

`install:vault` copies `main.js`, `styles.css` and `manifest.json` into the vault's `.obsidian/plugins/kingmaker-authoring/` (the files it replaces are backed up under `dist/install-backups/`) and adds the plugin to `.obsidian/community-plugins.json`. It writes nothing else. Run it again after `npm run build` to update the plugin, and reload Obsidian.

What's shared and what's yours: the vault's `.obsidian/app.json` (a new note goes in `lore/`) and `community-plugins.json` (the plugin is on) are the campaign's, in git. Everything else Obsidian keeps in `.obsidian` (the workspace, the cache, the installed plugin itself, appearance, hotkeys, the core plugins) and the `.trash` folder are each author's own, and [campaigns/caerwyn/.gitignore](../../campaigns/caerwyn/.gitignore) keeps them out of git. The game never reads them: the campaign check, the install and the web build all leave hidden files out.

In the vault you see the campaign as the game has it: `arc.md`, the scenario (`caerwyn.kmscenario`), the scenes in `scenes/`, the maps in `maps/`, the places in `places/`, and the lore in `lore/` (the world, the places, and each person's public and private notes). Each of the game's files opens in its editor. The JSON files (`builds.json`, `looks.json`, `vocabulary.json`) are there too, hidden from Obsidian's file explorer unless you turn on Settings → Files and links → Detect all file extensions; they aren't authored in the plugin yet.

### Moving from the old vault

Until now the plugin was installed in your checkout's `lore/` folder, the prototype's copy of the lore, with the imported version 1 scenes, the scenario and the maps. That vault is left as it is. To move:

1. Install the plugin into the campaign folder and open it as a vault (above). Your own settings (theme, hotkeys, open tabs) don't come with it: set them again, or copy `appearance.json` and `hotkeys.json` from the old vault's `.obsidian/` into the new one's (they're ignored by git there).
2. Your version 1 draft of the clerk, `Scenes/The Hanged Clerk v2.kmscene`, became the game's `campaigns/caerwyn/scenes/hanged-clerk.kmscene`: M2 re-authored it in the scene format as the worked example (its start, its three discoveries, the dead-cart and its three graded endings), so edit that one.
3. The old vault's other version 1 scenes (the imported `Scenes/*.kmscene`) were snapshots of the prototype's scenes. If the new plugin is installed there, they open read-only, with a note that the format has moved on: the campaign's own scenes are in `scenes/` of the new vault.
4. The old vault's scenario (`Scenarios/Caerwyn.kmscenario`) is a version 1 file: it opens read-only. The campaign's scenario is the new vault's `caerwyn.kmscenario`. The old vault's maps (`Maps/*.kmmap`) are version 1 maps: copy one into the new vault's `maps/`, named for its id (`maps/harbour-study.kmmap`), open it, and migrate it (below).
5. The old vault's lore notes are the prototype's copy. The game's lore is the new vault's `lore/`, which M1 brought up to date with the prototype's last edits.

## The scene editor

A scene file opens as a graph, with an inspector beside it.

### The graph

- **The kinds, at a glance.**
  - The **start** (green) is where the scene opens: one in every scene, with how many people are here at the start.
  - A **discovery** (purple) is a beat with a revelation, something the player can come to understand. Its card counts its paths and marks a **required** one.
  - An **event** (amber, dashed) is a beat without one, a turn the scene takes. Its card names who arrives there.
  - An **ending** (red) is one of the only ways the scene can end. Its card shows its result (good, mixed or bad), its exit kind, and the scene the story goes on to.
- **Routes.** The routes from one node to another are one connection on the graph, labelled with the route's name or "n routes", dashed when they're cues, and marked "dice" when one has a check. Click a connection to see each of its routes in the inspector, each its own.
- **Adding.** **A** (or **Add node**) adds a discovery, an event or an ending: you give its title, and its id is a slug of that title, free in the scene. With a node selected, a route from it comes too. Draw a route by dragging from a node's right edge to another node's left edge, or with **Add route to…** in a node's inspector. A new route's id is made from where it goes (`find-murder` into a discovery, `to-cart-arrives` otherwise); into an event it's a cue.
- **Ids are stable.** A node's, a route's or a person's id is made once and never changes with its title: game state keys on it. The inspector shows each id.
- **Deleting** asks first. A node takes its routes with it, and what named it: a route's requires and its on failure, and who arrived there. The start can't be deleted.
- **Undo and redo** (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z) last while the file is open; typing in one field, from its focus to its blur, is one step. **F** fits the graph, **?** lists the shortcuts, and a double-click opens a node's or a connection's larger editor.

### The inspector

Its tabs are what's selected on the graph, the Scene, the Cast and the Problems.

- **The start:** its opening (the situation, the suggested ways in, how to play the people here, an opening image), and a conversation role for each person here at the start (the co-GM's first note).
- **A discovery:** its revelation, how to play it, whether it's required, its **paths** (each with who or what holds it, typed or picked from the cast and the place's things and parts, and a note under it when it names neither someone of the cast nor a thing of the place; the clue; what earns it; how strong it is; and a check, a skill and a DC, when a roll suits it), the facts it establishes, and whether the story **carries** it (what it unlocks, what later needs it, and the things of the place it's in).
- **An event:** what happens, its pressure, **who arrives here** (each person's `enters`), a conversation role for each person while the scene is here, and the facts it establishes.
- **An ending:** what's true, its closing, its result and exit kind, the **next scene** (one of the campaign's), its **effects**, and its ways in with what each requires. The common effects (quest, flag, attitude, remember, journal, follow, promise) are forms, with their conditions on the scene's facts; any other op (a world op, the combat ending's `startFight`) is JSON, saved only once it's an object with an `op`.
- **A connection:** each route's label, condition, phase (outcome, or a cue the co-GM brings about), **requires** (the beats reached first: an ending's evidence), dice (a skill and a DC, and where a failure goes), and the facts it establishes. Add another route between the same two nodes, or remove one, and the others stay as they are; **Move these routes** gives all of them another node to leave from or go to, their ids kept (into a pair that has routes already, they join them).
- **Scene:** its id (its file's name), title, description, hook, setting, premise, truth and clock; when and where (time, rest, its place among the campaign's with the place's things listed and a link to open it, interlude, milestone); limits and what locals know; its **facts** (an id and the sentence the GM is told; removing one takes it out of every beat's and route's establishes); background, assumes and overtaken; the effects on every ending (onEnd) and the world ops afterwards; the fronts doc; and its lore.
- **Cast:** a card for each person with every field of one: name, called, also known as, their lore note, look, voice, wants, fears, why here, knows, secrets, attitude, limits, the **roles** palette (characterise, inconsistency, hooks), where they enter, group and members, statblock and weapon. **Add a person** with a name and an id (a slug; short, like `kell`).
- **Problems:** the game's own rules for a scene ([shared/scene/rules.ts](../../shared/scene/rules.ts), what the campaign check runs), run as you edit against the campaign around the file. Each problem says where it is, and clicking it takes you there: the node, the route, the person's card, or the scene's field. It also says when the scene isn't one of the scenario's scenes yet (`caerwyn.kmscenario`'s `scenes`: the game doesn't install it until it's listed). Below the problems, and not counted with them, are the **warnings**: each clue path whose via, of more than one word, names neither someone of the cast (by id, name, what they're called or also known as) nor a thing or part of the scene's place (by id or name, as words: no case, no leading article, nothing in brackets). The game takes a via as words, so it isn't a problem; but the GM is told the clue is with something the scene hasn't got. The toolbar counts both.

### Lore

Lore paths in a scene are the game's: relative to the campaign's `lore/` (`Cast/Cob/public.md` is the vault's `lore/Cast/Cob/public.md`). The plugin offers the campaign's notes that way (each person's public card once, the places, the world and the rest; a person's private notes and memories are the game's), and a link opens the note in Obsidian's own editor. A scene can link lore for itself, for each node, for each person (their card) and its fronts doc. Obsidian doesn't rewrite these paths when a note is renamed or moved: the problems panel names a link whose note isn't there.

### A new scene

Right-click a folder (the campaign's `scenes/`) for **New Kingmaker scene**, or run **Kingmaker Authoring: Create new scene**. Give it a title: its file is named for the slug of the title, which is its id (`The Lamplighter` is `scenes/the-lamplighter.kmscene`). It starts as a skeleton: a start, a discovery and an ending, and a route from the start into the discovery, with the problems panel listing what's left to write. List its id in the scenario's `scenes` (`caerwyn.kmscenario`) for the game to install it: the scenario editor's Scenario tab lists it, or makes the scene and lists it at once. **New Kingmaker map** and **New Kingmaker place** work the same way (in `maps/` and `places/`: a map from the default legend on grass, a place of one area), and **New Kingmaker scenario** makes a campaign folder's scenario, refused where there's one already.

## The scenario editor

`caerwyn.kmscenario` opens as a diagram of the story: the start, the scenario's scenes (along the top, in the story's order) and its maps (beneath them), each a card, with an inspector beside it.

- **The flow is the files'.** Nothing of it is stored in the scenario: each edge is drawn from the file that owns it, and edited there.
  - A scene's card has a port for each of its endings, whose edge goes to its `next` (in the scene's file).
  - A map's card has a port for each region that plays a scene (`sceneId`, in the map's file: solid when the region lays the scene's place, dashed when it opens a scene laid elsewhere) and for its ways out, grouped by where they lead and what they say (the town's four tiles along the wharf to the Heron are one port, its exits in the map's file).
  - The start has two: the map the player starts walking on (`start.map` and `start.at`) and the first lead (`firstScene`), in the scenario.
- **Wiring.** Drag from a port's handle to a card, or click a port, an edge or a card and choose in the inspector: an ending's next scene, a region's scene (every region of a map is listed, not only those that play one), a way out's map (it lands just inside the target map's way back, or nearest its middle: the tile is in the inspector, or the map), the start's map. Taking a destination away (the Delete key on an edge, or the inspector's own choice for it) asks first, but for an ending set to go nowhere in its select: an ending then ends the story, a region stops playing its scene, a way out is deleted, and the start without a map opens the first scene at once.
- **Writes are safe.** An edit of another file is refused, with nothing overwritten, unless that file is what the editor read: on disk, or in an editor that has it open, which is given the new text as if it changed outside it. Undo (Ctrl/Cmd+Z) writes each file back the same way.
- **The layout** is the scenario's own `layout` (nothing the game reads): a card dragged keeps its place, by `scenes/<id>`, `maps/<id>` or `start`. A card that has none goes where the default puts it.
- **The Scenario tab** has the scenario's own fields: its title, description, campaign version, level and rules pack; the start (first scene, start place, day, time, map and tile); the story's scenes in order (move them up and down, take one out, list one the folder has, or make a new one), the talk template, the maps and the places (the same); the starting purse; the quests (a quest's key is made once from its title); the world a backstory is written for (its premise, primer, the docs that aren't canon, and the places' docs with the words that call them up); and the layout, to forget.
- **The Problems tab** is the campaign check's rules for the scenario, its maps and its places ([shared/scene/scenario-rules.ts](../../shared/scene/scenario-rules.ts)), with every file as it is now; each takes you to its field, or opens its file.

## The map editor

A map (`maps/<id>.kmmap`) opens on an isometric painter, with its legend as the palette, an inspector on the right, and the **Game preview**, the game's own renderer ([client/map/render.ts](../../client/map/render.ts)) drawing the map as the game builds it, with its decor and the people about at the hour you choose.

- **Painting.** The palette is the map's legend: each entry its character, a swatch in the game's colours for its terrain and look, its name, and how many tiles it covers. Paint with the brush (**B**), rectangle (**R**) and fill (**G**), erase (**E**) with the Erase material (Ctrl/Cmd-drag too), sample with the eyedropper (**I**), pan (**H**), and **[ ]** size the brush; **X** swaps the paint and erase materials. The void (no tile) is painted like any entry. Only the rows a stroke changes are written, each its own length where what's past it is void, so a painted map's file changes where it was painted and nowhere else.
- **The legend.** **New entry** opens the entry's editor: its character (one you can see, not in the legend yet), its terrain, look (style), height, roof and roof height, whether it blocks or is opaque (or as its terrain), and the decor that stands on it (its name, glyph, colour, kind, states, look-at text, whether it's in the way, and a stable id for one of a kind), from scratch or from one of the default legend's entries. ✎ beside an entry edits it in the inspector; deleting one that's painted asks what replaces it.
- **A new map** starts from the default legend, the plugin's version 1 palette (grass, dirt, cobbles, boards, water, deep water, bridge, stone and timber walls, a door, a window, a roofed floor, a tree, a fence, stairs) and its clutter (a lamp, a sign, a crate, a barrel, a bench, on cobbles), on a grid of grass.
- **Regions, exits and people.** Right-click a tile (or a marker) for what's there and what can be added: **Add region here…** (or draw one with the region tool, **N**), **Add exit here…** (its label, the map it leads to and the tile it lands on), **Add person here…** (a name and a glyph). The inspector edits each: a region's name, rect, scene, whether its scene's place is laid there (its `worldOrigin`), its trigger and label, and what it says when shut, opens for, says once locked after, the scene it's the outside of, what its locked doors say, and its description; an exit's tiles, map and label; someone's name, glyph, colour, kind, tile, text, states, whether they're out of the way, and the hours they're about. Exits and people are markers on the map: drag one to move it. The Map tab lists them all, with the map's title and description.
- **The story's start.** **Start the story here** on a tile writes the scenario's start (`start.map` and `start.at`, listing the map in the scenario if it's the campaign's and isn't yet); the flag on the map is it, to drag.
- **Places.** Select a region that lays a scene's place and the place is drawn over the map at the region's `worldOrigin`, five feet to a tile: its areas as rectangles, its things where they stand, and its people where they start, in their looks. Drag a thing, someone or an area's label to move them; right-click a tile to add a thing, an area or someone of the scene; select one to edit it in the inspector (a thing's name, kind, where it is, its spot, size, material, states, tags, what's in it, and its description). Each edit is written to the place's file. The Place tab has the place's own fields and lists its parts.
- **Resizing** (**S**): drag an edge's handle, or focus it and press **+** or **−**, up to 160 by 120. New tiles are the Erase material. A north or west edge moves the regions, exits and people with their tiles, and what other files say of them: the scenario's start, and the ways from other maps that land here. Cropping asks first, and says what goes.
- **Problems.** The Problems tab has the campaign check's problems for this map (and the place shown on it), each taking you to its region, exit, person or legend entry; and says when the map isn't one of the scenario's, or its file isn't `maps/<id>.kmmap`.
- The painter uses PixiJS (WebGL) and touches only the tiles a stroke changes: the town (64 by 46, 52 legend entries, 21 regions, 30 people) and a 160 by 120 map paint at once. `canvas.__kmPixi.stats` in the developer tools has its counts.

## Places

A place (`places/<key>.kmplace`) opened by itself is drawn on its own grid, from above, five feet a square: its areas, its things and where its people start, moved by dragging, added from a right-click and edited in the inspector, as on a map. Its header names the regions that lay it on a map, to open. The scene editor's Scene tab lists its place's things, and opens the place.

## Version 1 maps

A version 1 map (the plugin's own, a palette id a tile, clutter, spawn points and interactions) opens with what it holds and the offer to migrate it. Migrating writes the file as a map of the format, tile for tile: each palette id and each pair of a palette id and the clutter on it is a legend character (the default legend's, so a migrated map paints like a new one; clutter on anything but cobbles gets a character of its own, its clutter's in capitals); a spawn point becomes the scenario's start if you say so (only on one of the campaign's maps, `maps/<id>.kmmap`), and otherwise a region of a tile named for it; an interaction whose exit led to a map becomes an exit, one whose exit led to a scene a region that plays it, and any other a region of a tile (its event message its description, its script notes kept as `notes`). Its id is its file's name. The original stays in the vault's history (Obsidian's file recovery, and git).

## Files

What follows holds for every file the plugin edits: a scene, the scenario, a map and a place.

- **Exactly the game's file.** A file is opened with the game's parse ([shared/scene/document.ts](../../shared/scene/document.ts) for a scene, [shared/scene/scenario.ts](../../shared/scene/scenario.ts) for the rest) and written back as the same JSON, indented by two spaces with a closing newline, as every file of the campaign is. Opening and saving one with no edit gives the same bytes. An edit changes one value where it is: unknown keys are kept in their places, and a key the format knows that wasn't there goes where the format puts it. An optional field left empty is taken out of the file. A map's grid is written a row at a time: a row nothing was painted on is the same row.
- **Never a file the game can't load.** An edit that would leave a file without its format's shape (a route to a node that isn't there, a fact settled that the scene hasn't got, an exit to no map) is refused with a note, and taking things out takes out what named them (a thing of a place takes what's in it; an area goes only once it's empty).
- **Other files, safely.** An editor that edits another file (the scenario setting an ending's next, a map setting the scenario's start or moving a place's thing) writes it only if it's what the editor read: on disk, or in an editor that has it open, which is given the new text and starts again from it. Otherwise nothing is written and the editor says so. Writes go one after another, and undo spans every file an edit wrote.
- **Version 1 files** (the plugin's old graph files) are never written as they are: a scene or a scenario opens read-only, with a note that the format has moved on, and a map opens with the offer to migrate it, which writes it as a map of the format only when asked.
- A file that isn't one of the game's that the plugin can read opens as an error naming each problem, and its bytes are left as they are. The file is the source of truth: edits go to the file view's save buffer at once, Obsidian writes them, and a save that would overwrite a change made outside the editor is refused.

## Checks

```sh
npm run typecheck
npm run test:host
npm run build
npx playwright test --workers=1
```

On a fresh machine, install the test browser first: `npx playwright install chromium`.

- `typecheck`: the plugin's sources, and the game's shared code they import (`shared/scene`, `shared/map`, and the renderer's palette), under the plugin's compiler options. The Game preview reaches the game's renderer through a JS module with a declaration (`src/map/render.js`), so the client's code is checked under the game's own options, not the plugin's.
- `test:host` (Node's test runner, `tests/*.test.mjs`): the models on the campaign's real files: the scene model (every scene round-trips byte for byte; what isn't a scene is refused, naming why; key order through edits; slug ids; what a removal takes with it; the skeleton; the campaign around a scene; the problems, which are the campaign check's; the via warnings), the map model (every map round-trips; the grid as cells and back a row at a time; the legend; regions, exits and people; resizing; the default legend; what isn't a map), the place model (feet and tiles as the game converts them; moving, adding and removing), the scenario model (the flow drawn from the files; the layout; the rules with a draft; landing tiles) and the migration (a copy of the user's own harbour study, `tests/fixtures/v1-study`, tile for tile). And the plugin's host against a small implementation of Obsidian's public API: every real scene, the scenario, every map and every place opens in its editor with nothing written; saves, conflicts and late callbacks; a version 1 scene and scenario read-only and a version 1 map migrated; new files of each kind; the campaign and its lore; and writes to other files (an open editor's draft read and updated, stale or outside edits refused, atomic writes, a closed editor's writes cancelled).
- `build`: the plugin (`dist/plugin`), and the browser test harness (`dist/app.js`, `dist/fixtures.json`).
- Playwright (`tests/*.spec.ts`), in the browser test harness, whose vault is the real campaign: its scenario, scenes, maps, places, looks and lore (`KINGMAKER_CAMPAIGN` names another campaign folder), beside the plugin's version 1 files in `tests/fixtures/v1`. Every journey asserts the files as saved. The scene journeys edit the real hanged clerk: a discovery's path and its check, a discovery added and routed from the start, an ending's requires and next, a person's roles and limits and their lore note, a problem appearing and clearing and taking you there, several routes between two nodes and moving them, a drawn route, effects as forms and as JSON, deleting and undoing, a reload that finds it all saved, and a via picked from the place's things with the warnings. The scenario journeys: the flow as the files have it; the wiring edited in its owning files (an ending's next set and drawn, a way out and a region in the town's file, a problem appearing) and undone; the scenario's own fields, a new map made and listed, and the layout kept. The map journeys: every map opening clean and the town painted a row at a time with Pixi's counts; painting with a new legend entry, the eyedropper, the eraser, the entry edited and deleted; an exit and a person added and moved, and the start set; a region tied to a scene with its place's thing moved and renamed, the yard shown and a thing added on the town; resizing with the start and other maps' exits moving too; the Game preview; a 160 by 120 map; and the user's harbour study migrated with its spawn the scenario's start. The place journey: a place on its own grid, a thing moved, added and its fields set. `bundle.spec.ts` loads the built bundle as Obsidian loads a plugin (CommonJS, with a mock of the `obsidian` module in a page) and opens every scene, the scenario, every map and every place of the vault in its editor; `KINGMAKER_PLUGIN` and `KINGMAKER_VAULT` point it at an installed copy and its vault.

None of this is the Obsidian desktop app: the host tests and the bundle check stand in for Obsidian's API. `npm run dev` serves the harness (on port 4177) to look at by hand.

CI runs these on every PR ([check.yml](../../.github/workflows/check.yml)'s `authoring` job).
