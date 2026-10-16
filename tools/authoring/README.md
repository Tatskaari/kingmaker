# Kingmaker Authoring — Obsidian file editor

An Obsidian community plugin for editing real `.kmscene`, `.kmmap` and `.kmscenario` files inside a lore vault. Scenes expose named start/exit ports; scenario graphs wire those ports together using the original files. Click a file in Obsidian's file explorer to open it in a normal tab. Graphs are not stored in plugin settings, and there is no separate story library inside the editor.

## Install locally

```sh
cd tools/authoring
npm ci
npm run build
npm run install:vault -- /home/jon/git/kingmaker/lore
```

The target must already contain `.obsidian/`. Installation copies `main.js`, `styles.css` and `manifest.json` into `.obsidian/plugins/kingmaker-authoring/`, adds this plugin to the enabled list without removing other plugins, and adds the four example files only if their names do not already exist. Existing plugin files are backed up under `dist/install-backups/`. Existing scene files and notes are never overwritten by the installer.

Reload Obsidian. If Restricted mode is on, allow community plugins in Settings → Community plugins, then enable **Kingmaker Authoring**. Open **Scenarios/Caerwyn.kmscenario** or **Scenes/The Hanged Clerk.kmscene** from the main lore vault. The ribbon icon and **Kingmaker Authoring: Open scene, map or scenario** command also find these files.

Right-click any folder in Obsidian's file explorer for **New Kingmaker scene**, **New Kingmaker map** or **New Kingmaker scenario**. You can also use the corresponding command-palette commands. Creation asks for a filename and opens the new file, with no seeded content. Existing names are rejected. Map files currently define named flow ports only: spatial layout, input spawn positions, and output door/trigger bindings are future work.

## Journeys

1. **Open real content.** Open `Scenarios/Caerwyn.kmscenario`. Its graph reads source scenes/maps and follows exit destinations. Double-click The Hanged Clerk, or use **Open source file**, to open its separate scene file. The old Granary Yard Markdown reference is visibly unresolved as a flow file; it is not presented as a fabricated playable map.
2. **Shape a scene.** Select a beat, press **A**, choose Beat or Exit, and edit its name and direction. The new node connects automatically to the selection. With nothing selected it is independent. Double-click any node, or use its inspector's **Open node in modal editor** expand button, for a larger editor. Changes autosave immediately; closing the modal is not a discard action.
3. **Inspect transitions.** The graph draws one edge per directed source→target pair, labelled with its number of transitions. Click the edge to see every transition's complete condition and check/outcome summary. **Edit transition** edits one without affecting its siblings; **Add transition** adds another without drawing a duplicate edge. Dragging between the same nodes twice selects their existing transitions. **Remove transition** deletes one; **Delete transitions** removes all transitions between those nodes in one undoable action. Changing the endpoints moves the whole group, merging with an existing group for that pair if necessary. Self-transitions have visible loop paths; reverse-direction transitions remain separate. All transitions are shown by default; optional **Focus transitions** limits them to the selected node.
4. **Use the actual lore.** Choose **Add from lore**, search for a character, object or place, and link it. Cast folders offer their `public.md` card once; Objects, Places and other Markdown notes are available too. A linked note opens in Obsidian's ordinary editor. These are paths to original notes, not embedded copies.
5. **Wire a scenario.** The single permanent **Start** node represents the point after character creation. Drag its output to a scene's named input, or select Start and choose the destination file and entry. Press **A** to show an existing scene/map or create a new file. Each source file exposes its starts on the left and its exits on the right. Drag an exit to another file's input, or click the transition and edit its destination in the inspector. Existing destinations require confirmation before replacement/removal. These edits save to the original source exit, not a second scenario transition graph. Double-click opens the source file. Missing files, ambiguous IDs, and missing entry points remain visible as unresolved destinations rather than guessed content.
6. **Undo and reopen.** Move, duplicate or delete nodes, edit text or transitions, then undo/redo. Deleting a node removes incident transitions in the same action. Graph changes go immediately into the file view's save buffer; Obsidian debounces disk writes and flushes on unload. Reopening reads the actual file. Malformed files show an error and retain their original bytes.
7. **Author named inputs and outputs.** Within a scene, **A → Start** adds a named input and **A → Exit** adds an output. Connect a start to its first beat. Starts have outgoing internal transitions; exits have incoming internal transitions and an external destination. **Choose scene or map input** picks an exact destination file and start. The old destination ID/file fields remain available for unresolved references. The imported opening beat remains an explicit legacy input, even when other starts are added, so old links do not silently break. Each exit card shows **Leads to**. The imported Hanged Clerk exits all lead to `caerwyn-afternoon`, which does not yet have a corresponding authoring file in the sample vault.

## Controls

**A** add; **F** fit; **Shift-click** multi-select; **Ctrl/Cmd+D** duplicate; **Delete** delete; **Ctrl/Cmd+Z** undo; **Ctrl/Cmd+Shift+Z** or **Ctrl+Y** redo; **Enter** open the selected linked file; **double-click** open the larger node/transitions editor; **?** shortcuts; **Escape** dismiss menus. Both node and transitions inspectors have an expand button. The modal traps keyboard focus, shares the same undo history, and allows opening a lore picker on top without closing the editor. Scroll or middle/right drag pans. Ctrl-scroll zooms. Commands are scoped to this editor and leave typing fields alone.

Undo holds up to 100 graph actions while the file is open. Text changes during one field focus form a single graph action. Closing/reloading the file resets undo history; saved content persists. Creating a separate file is not undone by graph undo: removing its scenario reference intentionally leaves the new file safe in the vault.

Scenario undo/redo also restores changes made to source-file exits. It compares the source with the expected version first: if another editor changed it meanwhile, it reports a conflict instead of overwriting that work. The overview reads unsaved open source buffers and refreshes when source files change. Applying a scenario edit to an open source remounts that source editor (its local undo history resets); the scenario retains the cross-file undo action. Source-file autosave checks for outside disk edits before writing.

Deleting nodes or transitions and unlinking lore each ask for confirmation, whether started in the inspector, the expanded editor, or by a canvas shortcut. The prompt names the target and explains cascading removals, including incident transitions or removal of an edge after its final transition is deleted. **Cancel** is focused by default; Escape or clicking outside the prompt cancels without saving or changing undo history. Linked notes and scene files are never deleted by these graph actions. Confirmed changes remain undoable.

## Files and provenance

The Hanged Clerk example is imported from the existing v2 authored source: five beats, five exits, and 51 transitions (36 beat transitions, 10 check-failure branches, five instances of one anytime rule), grouped into 24 directed node pairs. Grouping is derived UI state: the file still stores each transition and its metadata independently, with no migration or merging of authored conditions. The original scene JSON, Markdown prose and place data are preserved as an explicitly historical `source` snapshot. Edits affect the graph, not that snapshot.

The existing Caerwyn scenario preserves its earlier Granary Yard/Hanged Clerk sketch as legacy data. Those old sketch edges are no longer used as runtime-looking transitions. Choose its first scene using Start; the rest of the graph is derived from source exits. Merely opening it does not rewrite the file. The two Objects notes contain existing source material about Prout's body and the ledger page.

To regenerate the examples from another checkout:

```sh
node scripts/import-hanged-clerk.mjs /path/to/kingmaker-v0/v2/campaigns/caerwyn
```

The rest of the Caerwyn arc is authored in the main game's `scenes/*.ts`, not the v2 single-scene campaign. Import its five continuation scenes with Node 26 (or a Node version that supports TypeScript type stripping):

```sh
node scripts/import-main-campaign.mjs /home/jon/git/kingmaker /home/jon/git/kingmaker/lore
node scripts/import-main-campaign.mjs /home/jon/git/kingmaker /home/jon/git/kingmaker/lore --write
```

The first command previews the import. `--write` exclusively creates missing scene files; it never overwrites existing scenes, scenarios or lore notes. The report identifies existing exits whose destination input still needs linking. Imported starts retain the authored opening beat's ID. Both interludes remain scenes: they represent downtime that the playable game's map normally replaces, not invented spatial maps. Original TypeScript, complete scene data, world data and exit scripts are preserved as inert source snapshots, with source hashes; scripts are not run and the import is not an executable game export. Runtime-generated companion talks, improvised endings, zoo scenes and repair experiments are excluded.

All three extensions contain readable JSON with `format: "kingmaker"`, `version: 1`, the document kind, nodes, edges and vault-relative lore paths. Starts/exits have stable node IDs. Exit data stores `file` (destination path), `next` (destination document ID), `entry` (named start node ID), and `destinationKind`. Scenario configuration stores only `entry: {file, entry}`, optional included `files`, and diagram `positions`; the pseudo Start is derived and cannot be duplicated or deleted. `.md` files keep Obsidian's normal Markdown editor. `registerExtensions` selects the custom `TextFileView`; React supplies its graph UI. No localhost server is needed in Obsidian.

## Prototype boundaries

### Authoring checkpoint and map-editor next step

The current scenario diagram follows the scene harness's authored `exit.next` chain. **It is not the playable game's scene-to-map routing.** In the playable game, scenes return to map exploration; the map supplies the intervening travel and replaces the two downtime interludes. Importing those interludes preserves the source material, but does not implement those maps or their spatial transitions.

The editable checkpoint is in the repository's `lore/Scenes`, `lore/Scenarios` and `lore/Objects` directories, copied from the main lore vault without replacing its content. `examples/` remains a separate, reproducible test/install fixture, not the latest edited vault state.

Next: build the map editor inside the same Obsidian file view, starting from the actual maps in `src/game/map/maps/` and the scene locations/arrival/return positions in `src/game/map/places.ts`. First support viewing a real map, placing named arrival ports, and attaching departure ports to doors or trigger areas, with selection, editing, undo/redo and destructive-action confirmations. Then represent the actual scene → map → scene transitions in the scenario view. Game-runtime integration remains a separate step; do not silently reinterpret the current imported scene chain as spatial routing.

This is a working file-backed authoring prototype, not an engine integration. It does not publish content, call models, export runnable campaign data or edit spatial maps. Map inputs will eventually correspond to spawn points and map outputs to doors/trigger volumes; no such placements or triggers are implemented here. Sections are omitted for now. JSON references do not gain Obsidian's automatic Markdown backlink/rename rewriting: if a linked file is renamed or moved, update its graph reference. Concurrent edits are detected, not merged. Unlink/relink via the picker repairs lore links. Removing a start leaves any external references unresolved until explicitly rewired.

The previous prototype's hidden `data.json` and disposable demo vault are not read or deleted. The browser entry point is now only an isolated automated-test harness; its localStorage data is not your vault.

## Checks

```sh
npm run typecheck
npm run test:host
npm test
npm run build
```

`test:host` uses a mocked public Obsidian API to test extension registration, file lifecycle and corruption safeguards. Playwright exercises the shared editor and a per-file harness. These are not a claim of native desktop UI verification. On a fresh machine, install the test browser with `npx playwright install chromium`.
