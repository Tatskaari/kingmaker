# Campaigns

A campaign is a folder of data that the game installs in both of its services: the simulation gets the structure and the scenes, the AI service everything, the lore too. Caerwyn ([caerwyn/](caerwyn/)) is the only one so far.

| Path | What it is |
|---|---|
| `campaign.json` | The campaign: its id and version, its first scene and place, where a game starts on the map, its scenes in story order, its places and maps, the talk template's id, the starting purse, the world a backstory is written for, the quests' titles |
| `scenes/<id>.kmscene` | One file a scene, in the scene format ([docs/scene-format.md](../docs/scene-format.md)): its prep, its people, its beats and endings as a graph, and its routes. The game loads it as it is, and the Obsidian plugin ([tools/authoring](../tools/authoring/README.md)) edits it as it is: this folder is the plugin's vault |
| `scenes/talk.kmscene` | The talk template: a word with whoever walks with the player between scenes, `{name}` and `{companion}` filled in for them |
| `places/<key>.json` | A scene's place as a world: its areas, its things, and where its people start |
| `maps/<key>.json` | The town's maps, walked between scenes |
| `builds.json`, `looks.json` | The ready-made characters, and how the cast look on screen |
| `vocabulary.json` | The prototype's scenes the campaign doesn't install, a few fields each, which the suggested lines are vetted against |
| `lore/` | The lore: the world, the places, the cast's public and private notes, and the fronts |
| `arc.md` | The arc, scene by scene: the lead each hands on, the quests, the proof chain |

## Writing a scene

1. Read [docs/authoring-scenes.md](../docs/authoring-scenes.md) (how to write prep the two-part GM plays well) and [caerwyn/arc.md](caerwyn/arc.md) (what the scene must hand on). The hanged clerk ([caerwyn/scenes/hanged-clerk.kmscene](caerwyn/scenes/hanged-clerk.kmscene)) is the worked example.
2. Write `scenes/<id>.kmscene` as [docs/scene-format.md](../docs/scene-format.md) has it, in Obsidian with the authoring plugin (this folder is its vault: [tools/authoring/README.md](../tools/authoring/README.md) says how to set it up), or as JSON: the prep at the top (hook, setting, premise, truth, the clock, limits, what locals know, the cast with their roles), then the graph: one start, the discoveries (beats with a revelation and the paths that bring it out), the events (beats without one, reached by a cue with an outer limit), the endings (good, mixed or bad, each with what it does to the story), and the routes between them, with what each ending needs in its routes' `requires`. Facts are named once in `facts`, settled by beats and routes, and tested by the endings' effects.
3. Give it a place in `places/` if it has one of its own, and list the scene in `campaign.json`'s `scenes` (an ending's `next` names the scene the story goes on to).

The file's id is its name: never rename a scene, a node or a route that a game has played, since the game's state keys on them.

## Checking it

```sh
npm run campaign -- check campaigns/caerwyn
```

It holds every scene to the format's rules (docs/scene-format.md, "Rules the campaign check enforces"): its shape, ids, prose and lore, that every node can be reached and the scene can end well, what its discoveries and good endings need, the people, places and facts it names, and its effects; then the talk template, the story between scenes, the places, builds, looks, maps and vocabulary. It prints what's there and "no problems", or each problem with the file it's in, and exits 1 on any. The scene rules are shared code ([shared/scene/rules.ts](../shared/scene/rules.ts)): the authoring plugin's problems panel runs them on a scene as it's edited, each problem taking you to where it is. `npm test` loads every scene as both services do (shared/scene/load.test.ts) and plays the play semantics on the hanged clerk (shared/scene/beats.test.ts).

Then play it: `npm run dev` (or `npm run dev -- --fake`) installs the campaign as it starts, and `npm run install-campaign -- campaigns/caerwyn` installs it again into a running stack. The page plays the campaign as the build found it (`npm run build:web`).

The tests of the code that plays scenes have a hanged clerk of their own ([shared/scene/testdata/hanged-clerk.kmscene](../shared/scene/testdata/hanged-clerk.kmscene), the campaign's before M2 re-authored it), so changing the campaign's scenes doesn't change what those tests play.
