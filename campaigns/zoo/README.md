# The zoo

Every feature of the game laid out to see and try, an exhibit at a time. The user's note: "Can you build zoos that help demonstrates every feature in the game e.g. all the world effects, and interactions, scenes, combat etc." It's for QA and demos as much as for play, so its exhibits change as the game does.

The zoo is a campaign of its own, beside Caerwyn, in the same format, so an exhibit is authored as the story's scenes, maps and places are: in this folder, which is an Obsidian vault (`npm run install:vault -- ../../campaigns/zoo` from `tools/authoring`). Nothing done in the zoo reaches the story's games.

## Opening it

| Where | How |
|---|---|
| The title | `z`, or the line "The zoo": the exhibits, then who to be (the ready-made fighter, wizard or rogue) |
| A terminal | `npm run zoo` (the title with the zoo's menu open), `npm run zoo -- ring` (straight into the combat ring as the fighter), `--build wizard`, `--foes dogs`, `--session <name>` (`zoo` unless said), `--stack <dir>` for a stack other than `runs/dev` |
| A page | `?zoo` (the menu), `?zoo=ring` (the ring at once), with `&build=wizard`, `&foes=dogs`; the zoo needs no GM, so it plays on the fake one unless `?fake` says otherwise |
| Headless | `npm run play -- new --session <you> --zoo ring [--build wizard] [--foes dogs] [--fast]`, then `observe` and `act --id …` as in any fight, with `again` and `foes_<id>` among its actions |

A visit is a game of the zoo's campaign, one a player at a time: opening an exhibit makes a new visit and the last one goes. The title doesn't offer a visit to carry on.

## The exhibits

### The combat ring (`ring`)

A fight on the map, a turn at a time: you and Sergeant Kell against the foes you pick, on raked sand inside a low stone wall, with two stone pillars to put between you and trouble, an iron brazier to kick over and one gate to leave by. Entering the ring rolls initiative, and the other side's moves play out on the board one at a time.

- **The foes** (`o` in the fight, or `--foes`): Sallow and the Crakes (the first, and the Heron's fight: Master Sallow's sword-cane behind the two river-bruisers), the Crakes alone, or a pack of three mastiffs off the wharves.
- **Fight it again** in one key: `n` (or Enter once it's over), the same foes, everyone whole. `again` headless.
- **Who you are** is picked as you open it (the fighter, the wizard or the rogue, level 3, rested at every fight). To be someone else, open the ring again from the title.

Its files:

| File | What it holds |
|---|---|
| `zoo.kmscenario` | the exhibit (`exhibits`): its scene, who fights beside you (`allies`) and its line-ups of foes (`foes`), each fighter by cast id with how the fight's AI plays them (`ally`, `bruiser`, `villain`, `coward`, `brawler`, `archer` or `bystander`) |
| `scenes/ring.kmscene` | the cast: Kell, Sallow, the talking and the silent Crake and the three mastiffs, each with their statblock and weapon and their notes on how they fight (in `attitude` and `limits`); a short scene a GM could play into the fight, with its "Roll for initiative" ending |
| `places/ring.kmplace` | where everyone starts (in feet, five to a tile), the sand and the gate, the pillars, and the brazier (a thing tagged `fire` or `light` that's `lit` is something a fight can knock over) |
| `maps/ring.kmmap` | the ring's tiles (a floor of style `sand`, stone walls, the pillars as one-tile walls, the gate as the way out) and the region that lays the ring's place over it |
| `builds.json`, `looks.json` | who a visitor can be, and how the cast are drawn |

## Making an exhibit

1. A map (`maps/<id>.kmmap`) with a region that plays the exhibit's scene and lays its place (`sceneId` and `worldOrigin`).
2. A place (`places/<id>.kmplace`) that starts everyone the exhibit names, and the player.
3. A scene (`scenes/<id>.kmscene`) whose cast are the people, each with a `statblock` (an SRD statblock, or one of the fight's own: `sword-cane-duellist`, `river-bruiser`, `lantern-boy`, `porter`) and a `weapon`, and the notes on how they behave.
4. An entry in the scenario's `exhibits`: its `id`, `title`, `description`, `scene`, and for a fight its `fight` (`allies` and `foes`). List the scene, place and map in the scenario too.

Then `npm run campaign -- check campaigns/zoo` holds it to its files (everyone in each line-up is in the cast with a statblock, started by the place on a tile of their own that a person can stand on, playing a role the AI knows), and the dev stack installs it as it starts (or `npm run install-campaign -- campaigns/zoo` into a running one); the page takes it from its build (`npm run build:web`). The scenario's `gm` is `none`: no GM plays the zoo's scenes, so the install gives the AI service none of its words (it serves one campaign at a time, the story's).

The authoring plugin edits the ring's map, place and scene as it does Caerwyn's, and keeps the scenario's `exhibits` as it is (it has no editor for them yet: edit them as JSON).

## Next exhibits

What the user's note asks for beyond the ring, each a small setup on the same files when its kind of exhibit is built (only fights are, so far):

- **The arena's other rings:** the wolf run (Pack Tactics), the goblin pit (archers and cover), the porters' floor (a brawl) and the grain floor (the Heron rehearsed, with its dust, lanterns and fire). They're code in `shared/zoo/rings.ts` for now (`npm run play -- ring --ring wolves`): each becomes a map, a place, a scene and a line-up here.
- **World effects:** fire catching by material and spreading, water putting it out, things breaking, smoke, the grain dust going up; set off with your own spells from the action menu, as the prototype's Burning Gallery and Works had them.
- **Interactions:** talking to someone, taking, giving, looking, opening, lifting a purse; the map's right-click menu and the action menu at the things and people of a small place.
- **Scenes:** short scenes with the GM on their own places (the prototype's Theatre: authored checks, pacing, staged secrets, endings), and the ring's own talk before the fight. These need the AI service to serve the zoo's words beside the story's.
- **Looks:** how everything is drawn from what the world says it is (fire by colour, states, surfaces, the cast's looks, invented looks).
- **The rules:** checks, spells and a ritual, class features, rests, death saves and coming round.
- **The map:** walking, doors and their hours, the lead, people by the hour.

And around them: the zoo as a place to walk between its exhibits (a hall with a door to each), and a tour that opens every exhibit and checks what it did, in CI (V19's).
