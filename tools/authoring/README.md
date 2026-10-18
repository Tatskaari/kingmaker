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

A scene file opens with its title, a line under it saying how many problems it has (click it for the Problems view), and a bar of views: **Graph**, **Scene**, **Cast**, **Facts** and **Problems**. The Graph has the scene's nodes and routes, with an inspector beside it for whatever is selected on it; the other four are the scene's own, each in the main area. The bar is keyboard-reachable (Tab to it, then the arrow keys, Home and End), and the view you're on is remembered for the file while it's open (open another file and come back, and you're where you were; the graph keeps its pan and zoom too). The editor follows its pane's width rather than the window's: from a half-screen pane up the inspector sits beside the graph, and narrower it lies over the graph's right side while something is selected; the Cast view's list goes above the card.

### The graph

- **The kinds, at a glance.**
  - The **start** (green) is where the scene opens: one in every scene, with how many people are here at the start.
  - A **discovery** (purple) is a beat with a revelation, something the player can come to understand. Its card counts its paths and marks a **required** one.
  - An **event** (amber, dashed) is a beat without one, a turn the scene takes. Its card names who arrives there.
  - An **ending** (red) is one of the only ways the scene can end. Its card shows its result (good, mixed or bad), its exit kind, and the scene the story goes on to. The result's badge is a button: it opens the ending with its result chosen, to change it.
- **Routes.** The routes from one node to another are one connection on the graph, labelled with the route's name or "n routes", dashed when they're cues, and marked "dice" when one has a roll. Click a connection to see each of its routes in the inspector, each its own.
- **Adding.** **A** (or **Add node**) adds a discovery, an event or an ending: you give its title, and its id is a slug of that title, free in the scene (or one you type). With a node selected, a route from it comes too. Draw a route by dragging from a node's right edge to another node's left edge, or with **Add route to…** in a node's inspector. A new route's id is made from where it goes (`find-murder` into a discovery, `to-cart-arrives` otherwise); into an event it's a cue.
- **What a new one starts as** is shown, and every part of it changeable: a discovery has an empty revelation and no paths; an event only its title; an ending is a good progress ending (its result and exit kind are at the top of its inspector); a route has no condition and no roll (the file keeps a DC of 12 beside it, used once it has a roll).
- **Deleting** asks first. A node takes its routes with it, and what named it: a route's requires and its on failure, and who arrived there. The start can't be deleted.
- **Undo and redo** (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, or the arrows on the bar) last while the file is open, in every view; typing in one field, from its focus to its blur, is one step. **F** fits the graph, **?** lists the shortcuts, and a double-click opens a node's or a connection's larger editor. **A**, **F** and **Delete** are the graph's, and do nothing in the other views.

### The inspector: what's selected, and its + add flows

The inspector is only ever what's selected on the graph: a node, or a connection's routes. With nothing selected it says so (in a narrow pane it gets out of the way). Every list in it works the same way: what's there as cards or chips, each removable (and the cards that have an order, paths and effects, moved up and down), and a **[+ Add …]** button that opens a short list to pick from in place, searchable when it's long, with Esc to close it. An optional part is a [+ Add …] button until it's there, then a section with a remove button; a text that's optional, emptied and left, is taken out of the file.

- **Every node:** its **id**, with **Rename** (a slug, not taken; renaming asks, and everything in the file naming it follows: its routes' ends, what requires it, where a failed roll goes, who arrives there), its title, its **lore** (link and unlink notes), its routes in and out, **Add route to…** and **Delete node**.
- **The start:** its opening, and its **conversation roles**: a card for each person with a role as the scene opens (their note, the co-GM's first), and **[+ Add role]** to give one to anyone else of the cast. A role is written once it has words.
- **A discovery:** **Required**, its revelation, how to play it, its **paths** (cards, each with who or what holds it, picked from the cast or the place's things and parts or typed; the clue; what earns it; its strength, one of hook, suggestive, strong or proof, with a line on each; and **[+ Add a roll]** for a skill and a DC when a roll suits it), the **facts settled here** (**[+ Add fact]**), and **[+ The story carries it]** (what it unlocks, what later needs it, and the things of the place it's in, **[+ Add thing]**).
- **An event:** what happens; **[+ Add pressure]** (what the world does if the scene stalls here: a section, removable); **who arrives here**, as chips (**[+ Add person]** picks someone of the cast: one who arrives at another event says so, and moves here; removed, they're here from the start); **conversation roles here**, as at the start (only the people with a role are listed); the facts settled here; and the story carrying it.
- **Its kind:** a beat is a discovery or an event, switched at the top of its inspector. A discovery made an event loses its revelation, paths and required mark; an event made a discovery loses its pressure, its roles and its arrivals (it's never the stage). Either asks first when it would take something out.
- **An ending:** its **result** at the top (Good, Mixed or Bad, with a line on what each means for the story and for QA) and its **exit kind** (each in full: combat ends in a fight played out on the map; the others are labels the effects give meaning to); what's true; its closing; the next scene (one of the campaign's, or nowhere, and a link to open it); its **effects**; and its ways in, each with what it requires.
- **A connection:** each route's **id** (Rename), label, condition, **phase** (Outcome or Cue, with a line on each), **requires** as chips (**[+ Add beat]**: the beats reached first, an ending's evidence), **[+ Add a roll]** (a skill, a DC, and where a failure goes; removing the roll takes the failure with it), and the facts settled when it's taken. Add another route between the same two nodes, or remove one, and the others stay; **Move these routes** gives all of them another node to leave from or go to, their ids kept.
- **Effects** (an ending's, and every ending's in the Scene view) are cards, in order, each a form for its op: the story's (quest, flag, attitude, remember, journal, follow, promise), the world's (move, place, give, drop, create, state, note, forget, remove, destroy, break, ignite, douse, chill, bleed, spill: what it acts on, picked from the cast, the place's things and parts or typed, and the fields that op has) and a fight's set-up (startFight: its enemies, allies and where). **[+ Add effect]** lists every op with a line on it. Each effect's **condition** is under "When": **[+ Only if a fact is settled]** and **[+ Unless a fact is settled]**, each picked from the scene's facts or a new one made there (one fact is written as its id, several as a list, none as no condition). Changing an effect's op keeps what the two share (who, what, the text) and its conditions. Anything a form doesn't show is named under it; **Edit as JSON** edits the whole effect, kept only once it's whole, and an op there's no form for (one the story doesn't know yet) is JSON.

### The Scene view

The scene's own fields, grouped as an author thinks of them, each group a card (and a row of links at the top to jump to one):

- **The scene:** its title, its **id** (its file's name: Rename asks, and says to rename the file to match, since campaign.json and the endings that go on to it name it too; the problems say until they agree) and its one-line description.
- **What the player knows:** the hook.
- **The prep:** setting, premise, truth and clock.
- **When and where:** time, place (one of the campaign's), rest, interlude and milestone.
- **The world:** limits and what locals know, each a list.
- **The story:** background, assumes, overtaken, the effects **on every ending** (onEnd: effect cards with conditions, as an ending's), **afterwards** (the world ops applied to the place as it ends, whatever the ending: world op cards without conditions; a new one is a draft until it says what it acts on, and is saved, in the same card, the moment it does), the fronts doc, and the talk template's companion.
- **Lore:** the GM's always-in docs.

### The Cast view

The people of the scene in a list (each with what the player calls them, their id and where they arrive), beside the chosen person's card, roomy, with every field of one: who they are (name, called, also known as, their lore note), how they come across (look, voice, attitude), what drives them (wants, fears, why here), what they know (knows, secrets), playing them (the roles palette: characterise, inconsistency, hooks; and limits), and in the scene (enters, group, members, statblock, weapon). Above the fields, **In this scene** says where the scene uses them: where they arrive, the nodes where they have a conversation role, the paths via them and the effects naming them, each a link there. Their **id** has Rename (the roles, paths and effects naming them follow; the place's people and looks.json name them too, which the problems say). **[+ Add person]** asks a name and an id (a slug; short, like `kell`).

### The Facts view

A fact is a sentence the GM is told once it's settled: a beat settles it when it's reached, a route when it's taken (a roll's on a success), and an ending's effects test it. The Facts view lists each fact with its id, its sentence (edited there), **settled by** (each beat or route, a link that selects it on the graph with its facts focused) and **tested by** (each effect, only if or unless, a link that opens it). **[+ Add fact]** makes one: its sentence, and an id that's a slug of it unless you type one. A fact can also be made in place from any [+ Add fact] (a beat's, a route's) or an effect's condition, and is settled or tested there in the same step of undo. **Rename** gives a fact a new id, and every establishes and condition naming it follows. Removing one asks, saying what settles and tests it, and takes it out of every establishes and condition (a condition left with no fact goes: an effect that ran only if it was settled runs whatever happens).

### The Problems view

The game's own rules for a scene ([shared/scene/rules.ts](../../shared/scene/rules.ts), what the campaign check runs), run as you edit against the campaign around the file. Each problem says where it is, down to the field ("Node · Failed · Closing", "Route · Last resort · Condition", "Cast · Corporal Abner Tull · Why here"), and clicking it takes you there with the field focused: the node or route selected on the graph, the person's card in the Cast view, the fact in the Facts view, or the field in the Scene view. It also says when the scene isn't one of `campaign.json`'s scenes yet (the game doesn't install it until it's listed).

### Every value, and where it's edited

Every value a scene file can hold is created, changed and taken out in the editor; none is fixed by it. `format`, `version` and `kind` (a scene of version 2) and the envelope's `type`s (`story`, `smoothstep`) are the format's own, and the same in every scene. Keys the format doesn't have are kept where they are, untouched (an effect's are named under its form, and edited as its JSON).

| Field | Where it's edited |
| --- | --- |
| **The scene** | |
| `id` | Scene view, The scene: Scene id, Rename (its file's name) |
| `title`, `description` | Scene view, The scene |
| `hook` | Scene view, What the player knows |
| `setting`, `premise`, `truth`, `clock` | Scene view, The prep (`clock` emptied is taken out) |
| `time`, `place`, `rest`, `interlude`, `milestone` | Scene view, When and where (each "Not set", "None" or unticked takes it out) |
| `limits`, `known` | Scene view, The world: lists, each item added, edited, moved, removed |
| `background`, `assumes`, `overtaken` | Scene view, The story |
| `onEnd` | Scene view, The story: On every ending (effect cards, with conditions) |
| `afterwards` | Scene view, The story: Afterwards (world op cards) |
| `fronts` | Scene view, The story: Fronts (choose, unlink) |
| `companion` | Scene view, The story (the talk template's, or any scene that has one) |
| `lore` | Scene view, Lore |
| `facts` | Facts view: each fact's id (Rename), sentence, [+ Add fact], remove; and [+ Add fact] anywhere a fact is chosen |
| `cast` | Cast view |
| `nodes`, `edges` | The graph and its inspector (below) |
| **A person of the cast** | |
| `id` | Cast card: Id, Rename; a new person's with their name ([+ Add person]) |
| `name`, `called`, `aka`, `lore` | Cast card, Who they are |
| `look`, `voice`, `attitude` | Cast card, How they come across |
| `wants`, `fears`, `whyHere` | Cast card, What drives them |
| `knows`, `secrets` | Cast card, What they know: lists |
| `roles` (`characterise`, `inconsistency`, `hooks`), `limits` | Cast card, Playing them (each emptied is taken out) |
| `enters` | Cast card, In the scene: Enters; and an event's Who arrives here ([+ Add person], remove) |
| `group`, `statblock`, `weapon` | Cast card, In the scene |
| `members` (`id`, `name`, `statblock`, `weapon`, `look`) | Cast card, In the scene: Members ([+ Add member], each a card, removable) |
| **A node** | |
| `id` | Inspector: Id, Rename; a new node's in the Add node dialog |
| `position` | Dragging it on the graph |
| `data.kind` | Chosen when it's added (discovery, event or ending); a beat's discovery or event at the top of its inspector |
| `data.title`, `data.lore` | Inspector: Title; Lore (link, unlink) |
| **The start** | |
| `description` | Inspector: Opening |
| `cast` | Inspector: Conversation roles at the start ([+ Add role], each a card, removable) |
| **A beat** | |
| `description` | Inspector: How to play it (a discovery), What happens (an event) |
| `revelation` | Inspector: Revelation (a discovery's; switching to an event takes it out) |
| `paths` | Inspector: Paths (a discovery's: [+ Add path], each a card, moved, removed; an event's are shown to remove, as the rules don't allow them) |
| `required` | Inspector: Required (a discovery's; shown on an event that has it, to take out) |
| `establishes` | Inspector: Facts settled here ([+ Add fact], remove) |
| `carry` (`unlocks`, `later`, `things`) | Inspector: [+ The story carries it], a section with Unlocks, Later and Things ([+ Add thing], remove); removable |
| `cast` | Inspector: Conversation roles here (an event's; [+ Add role]) |
| `pressure` | Inspector: [+ Add pressure] (an event's), a section, removable |
| **A path** | |
| `via`, `clue`, `earn` | Path card: Via (picked from the cast and the place, or typed), Clue, Earn |
| `strength` | Path card: Strength (Hook, Suggestive, Strong, Proof) |
| `check` (`skill`, `dc`) | Path card: [+ Add a roll], a section with Skill and DC, removable |
| **An ending** | |
| `result`, `exitKind` | Inspector, at the top: Result (Good, Mixed, Bad), Exit kind; the result's badge on the graph opens them |
| `description`, `closing` | Inspector: What's true, Closing |
| `next` | Inspector: Next scene (one of the campaign's; "Nowhere" takes it out) |
| `effects` | Inspector: Effects ([+ Add effect], each a card, moved, removed) |
| **A route** | |
| `id` | Route card: Id, Rename |
| `source`, `target` | Drawn on the graph; Move these routes |
| `label`, `data.condition` | Route card: Label, Condition |
| `data.phase` | Route card: Phase (Outcome, Cue) |
| `data.requires` | Route card: Requires ([+ Add beat], remove) |
| `data.skill`, `data.dc`, `data.onFailure` | Route card: [+ Add a roll], a section with Skill, DC and On failure; removing it takes the skill and the failure out (the format keeps a `dc` with no roll: it's the roll's when one is added) |
| `data.establishes` | Route card: Facts settled when it's taken ([+ Add fact], remove) |
| **An effect** | |
| `op` | Effect card: Op (changing it keeps what the two ops share, and the conditions) |
| `if`, `unless` | Effect card, When: [+ Only if a fact is settled], [+ Unless a fact is settled], each fact picked, made new, or removed |
| quest: `quest`, `do`, `title`, `stage`, `text` | Effect card: Quest (campaign.json's), Step, Quest title, Stage, Journal text |
| flag: `name`, `value` | Effect card: Flag name, Flag value |
| attitude: `who`, `to`, `text` | Effect card: Who, Attitude, Text |
| remember: `who`, `text`; journal: `text`; follow: `who` | Effect card: Who, What they remember; Text; Who |
| promise: `by`, `to`, `text` | Effect card: Promised by, Promised to (the player or the cast), The promise |
| a world op: `what`, `to`, `how`, `feet`, `name`, `kind`, `text`, `add`, `remove`, `quantity` | Effect card: the fields that op has (what it acts on, where or to whom, how and how far, a name and kind for what's created, its text, the states it gains or loses, how many) |
| startFight: `enemies` (`asset`, `count`, `leader`), `allies`, `at` | Effect card: Enemies (each a card: Led by, Statblock, How many), Allies ([+ Add person]), Where |
| anything else | Effect card: named under the form; Edit as JSON |

### Lore

Lore paths in a scene are the game's: relative to the campaign's `lore/` (`Cast/Cob/public.md` is the vault's `lore/Cast/Cob/public.md`). The plugin offers the campaign's notes that way (each person's public card once, the places, the world and the rest; a person's private notes and memories are the game's), and a link opens the note in Obsidian's own editor. A scene can link lore for itself, for each node, for each person (their card) and its fronts doc. Obsidian doesn't rewrite these paths when a note is renamed or moved: the Problems view names a link whose note isn't there.

### A new scene

Right-click a folder (the campaign's `scenes/`) for **New Kingmaker scene**, or run **Kingmaker Authoring: Create new scene**. Give it a title: its file is named for the slug of the title, which is its id (`The Lamplighter` is `scenes/the-lamplighter.kmscene`). It starts as a skeleton: a start, a discovery and an ending, and a route from the start into the discovery, with the Problems view listing what's left to write. List its id in `campaign.json`'s `scenes` for the game to install it.

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
- `test:host` (Node's test runner, `tests/*.test.mjs`): the scene model on the campaign's real scenes (every one round-trips byte for byte; what isn't a scene is refused, naming why; unknown keys and the format's key order kept through edits; slug ids; what a removal takes with it; a fact renamed or removed in every establishes and condition, and where each is settled and tested; a node, a route or a person renamed with everything naming them; a beat's kind switched; the skeleton; the campaign around a scene; the problems, which are the campaign check's, each with the part it's about), and the plugin's host against a small implementation of Obsidian's public API (every real scene opens in the scene editor with nothing written; saves, conflicts and late callbacks; a version 1 scene read-only; new scenes; the campaign, its lore by the game's paths, and another open scene's draft; the scenario editor's port edits on its own files). Also the version 1 model, scenario and map tests.
- `build`: the plugin (`dist/plugin`), and the browser test harness (`dist/app.js`, `dist/fixtures.json`).
- Playwright (`tests/*.spec.ts`), in the browser test harness, whose vault is the real campaign: its scenes, places, `campaign.json` and lore (`KINGMAKER_CAMPAIGN` names another campaign folder), beside the old editors' version 1 files in `tests/fixtures/v1`. The scene journeys edit the real hanged clerk and assert the file each time: the layout (the inspector only what's selected; the views on the bar, reached by the keyboard and remembered for the file), an ending's result set at the top of its inspector and from its badge, an event's arrival, role and pressure added and removed, a fact made in place from an event and found in the Facts view where it's settled (one undo taking both), a fact renamed and removed everywhere it's named, the Scene view's groups and fields (afterwards' draft saved in place), a problem clicked for each kind of place (the scene's field, a node's, a route's and a person's, focused), a discovery's path and its roll, a discovery added, switched to an event and back, and its id renamed, a route's requires, roll and facts, an effect's conditions picked or made new and world ops as forms, the Cast view's card, several routes between two nodes and moving them, a drawn route, deleting and undoing, and a reload that finds it all saved. `bundle.spec.ts` loads the built bundle as Obsidian loads a plugin (CommonJS, with a mock of the `obsidian` module in a page) and opens every scene of the vault in its scene editor; `KINGMAKER_PLUGIN` and `KINGMAKER_VAULT` point it at an installed copy and its vault. The map and scenario journeys are the old editors'.

None of this is the Obsidian desktop app: the host tests and the bundle check stand in for Obsidian's API. `npm run dev` serves the harness (on port 4177) to look at by hand.

CI runs these on every PR ([check.yml](../../.github/workflows/check.yml)'s `authoring` job).
