# Kingmaker Authoring: the game's scenes in Obsidian

An Obsidian plugin for writing the game's campaign. Its vault is the campaign folder itself, [campaigns/caerwyn](../../campaigns/caerwyn/), and its scene editor edits the game's own scene files, `scenes/<id>.kmscene`, in the scene format ([docs/scene-format.md](../../docs/scene-format.md), version 2). There's no export: the game loads the file the plugin saves, as it is, and the plugin holds the scene to the same rules as `npm run campaign -- check` while you write. The lore is the vault's Markdown, edited in Obsidian's own editor.

The plugin also still has its first editors, for its own version 1 files: the isometric map painter (`.kmmap`) and the scenario graph (`.kmscenario`). M4 replaces them ([the migration log](../../docs/migration-log.md)).

## Setting up the vault

```sh
cd tools/authoring
npm ci
npm run build
npm run install:vault -- ../../campaigns/caerwyn
```

Then in Obsidian: **Open folder as vault**, and choose `campaigns/caerwyn` in your checkout. If Restricted mode is on, allow community plugins in Settings → Community plugins; Kingmaker Authoring is already in the vault's list of enabled plugins. Open `scenes/hanged-clerk.kmscene`, the worked example, from the file explorer (or the ribbon icon, or **Kingmaker Authoring: Open scene, map or scenario**).

`install:vault` copies `main.js`, `styles.css` and `manifest.json` into the vault's `.obsidian/plugins/kingmaker-authoring/` (the files it replaces are backed up under `dist/install-backups/`) and adds the plugin to `.obsidian/community-plugins.json`. It writes nothing else. Run it again after `npm run build` to update the plugin, and reload Obsidian.

What's shared and what's yours: the vault's `.obsidian/app.json` (a new note goes in `lore/`) and `community-plugins.json` (the plugin is on) are the campaign's, in git. Everything else Obsidian keeps in `.obsidian` (the workspace, the cache, the installed plugin itself, appearance, hotkeys, the core plugins) and the `.trash` folder are each author's own, and [campaigns/caerwyn/.gitignore](../../campaigns/caerwyn/.gitignore) keeps them out of git. The game never reads them: the campaign check, the install and the web build all leave hidden files out.

In the vault you see the campaign as the game has it: `arc.md`, the scenes in `scenes/`, and the lore in `lore/` (the world, the places, and each person's public and private notes). The JSON files (`campaign.json`, `places/`, `maps/`, `builds.json`, `looks.json`, `vocabulary.json`) are there too, hidden from Obsidian's file explorer unless you turn on Settings → Files and links → Detect all file extensions; the scene editor reads them for what a scene can name.

### Moving from the old vault

Until now the plugin was installed in your checkout's `lore/` folder, the prototype's copy of the lore, with the imported version 1 scenes, the scenario and the maps. That vault is left as it is. To move:

1. Install the plugin into the campaign folder and open it as a vault (above). Your own settings (theme, hotkeys, open tabs) don't come with it: set them again, or copy `appearance.json` and `hotkeys.json` from the old vault's `.obsidian/` into the new one's (they're ignored by git there).
2. Your version 1 draft of the clerk, `Scenes/The Hanged Clerk v2.kmscene`, became the game's `campaigns/caerwyn/scenes/hanged-clerk.kmscene`: M2 re-authored it in the scene format as the worked example (its start, its three discoveries, the dead-cart and its three graded endings), so edit that one.
3. The old vault's other version 1 scenes (the imported `Scenes/*.kmscene`) were snapshots of the prototype's scenes. If the new plugin is installed there, they open read-only, with a note that the format has moved on: the campaign's own scenes are in `scenes/` of the new vault.
4. The scenario (`Scenarios/Caerwyn.kmscenario`) and the maps (`Maps/*.kmmap`) still open in the old editors. Keep them in the old vault, or copy them into the new one, until M4 brings the scenario and the maps to the campaign's own files.
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
- **A discovery:** its revelation, how to play it, whether it's required, its **paths** (each with who or what holds it, picked from the cast or the place's things and parts or typed; the clue; what earns it; how strong it is; and a check, a skill and a DC, when a roll suits it), the facts it establishes, and whether the story **carries** it (what it unlocks, what later needs it, and the things of the place it's in).
- **An event:** what happens, its pressure, **who arrives here** (each person's `enters`), a conversation role for each person while the scene is here, and the facts it establishes.
- **An ending:** what's true, its closing, its result and exit kind, the **next scene** (one of the campaign's), its **effects**, and its ways in with what each requires. The common effects (quest, flag, attitude, remember, journal, follow, promise) are forms, with their conditions on the scene's facts; any other op (a world op, the combat ending's `startFight`) is JSON, saved only once it's an object with an `op`.
- **A connection:** each route's label, condition, phase (outcome, or a cue the co-GM brings about), **requires** (the beats reached first: an ending's evidence), dice (a skill and a DC, and where a failure goes), and the facts it establishes. Add another route between the same two nodes, or remove one, and the others stay as they are.
- **Scene:** its id (its file's name), title, description, hook, setting, premise, truth and clock; when and where (time, rest, its place among the campaign's, interlude, milestone); limits and what locals know; its **facts** (an id and the sentence the GM is told; removing one takes it out of every beat's and route's establishes); background, assumes and overtaken; the effects on every ending (onEnd) and the world ops afterwards; the fronts doc; and its lore.
- **Cast:** a card for each person with every field of one: name, called, also known as, their lore note, look, voice, wants, fears, why here, knows, secrets, attitude, limits, the **roles** palette (characterise, inconsistency, hooks), where they enter, group and members, statblock and weapon. **Add a person** with a name and an id (a slug; short, like `kell`).
- **Problems:** the game's own rules for a scene ([shared/scene/rules.ts](../../shared/scene/rules.ts), what the campaign check runs), run as you edit against the campaign around the file. Each problem says where it is, and clicking it takes you there: the node, the route, the person's card, or the scene's field. It also says when the scene isn't one of `campaign.json`'s scenes yet (the game doesn't install it until it's listed).

### Lore

Lore paths in a scene are the game's: relative to the campaign's `lore/` (`Cast/Cob/public.md` is the vault's `lore/Cast/Cob/public.md`). The plugin offers the campaign's notes that way (each person's public card once, the places, the world and the rest; a person's private notes and memories are the game's), and a link opens the note in Obsidian's own editor. A scene can link lore for itself, for each node, for each person (their card) and its fronts doc. Obsidian doesn't rewrite these paths when a note is renamed or moved: the problems panel names a link whose note isn't there.

### A new scene

Right-click a folder (the campaign's `scenes/`) for **New Kingmaker scene**, or run **Kingmaker Authoring: Create new scene**. Give it a title: its file is named for the slug of the title, which is its id (`The Lamplighter` is `scenes/the-lamplighter.kmscene`). It starts as a skeleton: a start, a discovery and an ending, and a route from the start into the discovery, with the problems panel listing what's left to write. List its id in `campaign.json`'s `scenes` for the game to install it.

### Files

- **Exactly the game's file.** A scene is opened with the game's parse ([shared/scene/document.ts](../../shared/scene/document.ts)) and written back as the same JSON, indented by two spaces with a closing newline, as every scene of the campaign is. Opening and saving a scene with no edit gives the same bytes. An edit changes one value where it is: unknown keys are kept in their places, and a key the format knows that wasn't there goes where the format puts it. An optional field left empty is taken out of the file.
- **Never a file the game can't load.** An edit that would leave the scene without the format's shape (a route to a node that isn't there, a fact settled that the scene hasn't got) is refused with a note, and taking things out takes out what named them.
- **Version 1 scenes** (the plugin's old graph files, with their imported snapshot) open read-only, with a note that the scene format has moved on. They're never written.
- A file that isn't a scene the game can read opens as an error naming each problem, and its bytes are left as they are. The file is the source of truth: edits go to the file view's save buffer at once, Obsidian writes them, and a save that would overwrite a change made outside the editor is refused.

## The map and scenario editors (version 1, until M4)

These edit the plugin's own version 1 files, which nothing of the game loads yet.

- **Maps** (`.kmmap`): an isometric painter for terrain and clutter, with spawn points and tile interactions as named ports, and a **Game preview** drawn by the game's own renderer ([client/map/render.ts](../../client/map/render.ts)). Paint with brush (**B**), rectangle (**R**), fill (**G**), eraser (**E**) and eyedropper (**I**); **[ ]** size the brush; drag the edge handles (**S**) to resize from 4 to 64 tiles a side; right-click a tile to add a spawn point or an interaction. Paint uses PixiJS (WebGL) and touches only the tiles a stroke changes; `canvas.__kmPixi.stats` in the developer tools has its counts.
- **Scenarios** (`.kmscenario`): a graph of scene and map files, wiring each file's named exits to another's named inputs, with one Start (after character creation). A version 2 scene is listed as one the scenario editor doesn't read: M4 brings the scenario to the campaign's own files.

## Checks

```sh
npm run typecheck
npm run test:host
npm run build
npx playwright test --workers=1
```

On a fresh machine, install the test browser first: `npx playwright install chromium`.

- `typecheck`: the plugin's sources, and the game's shared code they import (`shared/scene`), under the plugin's compiler options.
- `test:host` (Node's test runner, `tests/*.test.mjs`): the scene model on the campaign's real scenes (every one round-trips byte for byte; what isn't a scene is refused, naming why; unknown keys and the format's key order kept through edits; slug ids; what a removal takes with it; the skeleton; the campaign around a scene; the problems, which are the campaign check's), and the plugin's host against a small implementation of Obsidian's public API (every real scene opens in the scene editor with nothing written; saves, conflicts and late callbacks; a version 1 scene read-only; new scenes; the campaign, its lore by the game's paths, and another open scene's draft; the scenario editor's port edits on its own files). Also the version 1 model, scenario and map tests.
- `build`: the plugin (`dist/plugin`), and the browser test harness (`dist/app.js`, `dist/fixtures.json`).
- Playwright (`tests/*.spec.ts`), in the browser test harness, whose vault is the real campaign: its scenes, places, `campaign.json` and lore (`KINGMAKER_CAMPAIGN` names another campaign folder), beside the old editors' version 1 files in `tests/fixtures/v1`. The scene journeys edit the real hanged clerk and assert the file each time: a discovery's path and its check, a discovery added and routed from the start, an ending's requires and next, a person's roles and limits and their lore note, a problem appearing and clearing and taking you there, several routes between two nodes, a drawn route, effects as forms and as JSON, deleting and undoing, and a reload that finds it all saved. `bundle.spec.ts` loads the built bundle as Obsidian loads a plugin (CommonJS, with a mock of the `obsidian` module in a page) and opens every scene of the vault in its scene editor; `KINGMAKER_PLUGIN` and `KINGMAKER_VAULT` point it at an installed copy and its vault. The map and scenario journeys are the old editors'.

None of this is the Obsidian desktop app: the host tests and the bundle check stand in for Obsidian's API. `npm run dev` serves the harness (on port 4177) to look at by hand.

CI runs these on every PR ([check.yml](../../.github/workflows/check.yml)'s `authoring` job).
