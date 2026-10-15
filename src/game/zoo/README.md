# src/game/zoo: the zoo

Every feature of the game, laid out to see and try. In game development a zoo is a level where every feature stands still long enough to be looked at; this one is walked on the map like Caerwyn, with a sign by each exhibit (what it is, how to set it off, in the house's voice) and, where the player sets it off, a lever, bell, chalk circle, plate or person at hand.

```sh
npm run game        # then "The zoo" on the title screen (or z)
npm run qa -- new --session my-visit --zoo      # the same zoo by action id (qa observe / qa act --id use_fireball-scarecrow ...)
node --no-warnings src/game/zoo/tour.ts         # the headless tour: every exhibit, offline
```

A visit is a game of its own (`game.hub = "zoo"`), kept apart from the story: it's never offered as a game to Continue (the title's zoo carries on the latest visit instead), it has no lead and plays nothing on, and nothing done in it reaches Caerwyn's saves, arc or state. The visitor comes in as Wren Ashdown, a level-five wizard (the Burning Gallery's fire is in the wizard's robes); the hall's wardrobe makes them anyone else.

## Getting about

- **Signs.** Right-click one (or face it and press e) to read it. Reading a sign, or setting its exhibit off, marks the exhibit seen.
- **The next exhibit.** g walks you to the next exhibit you haven't seen, through the hall's doors; the sidebar names it and the way, and a gold marker floats over it.
- **Setting things off.** Every trigger is in its tile's right-click menu (and the QA console's `use_<id>`): it walks you over first. You stand on a chalk circle to cast from it; a plate goes off when you walk onto it.
- **From above.** v shows the wing's world as a scene's stage draws its place: people mid-walk, fires, haze, weather, effects.
- **What happens.** What a trigger did is played on the map as a scene's turn would be: its rules lines through the director (a Fireball from you to the scarecrow, damage numbers), what changed in the wing's world (fires catching, splashes, debris, puffs), and a few cues for effects nothing in the game sets off yet (a goose's "!", a thrown ball, embers).
- **The wings' worlds are live on the map.** Each wing has a scene world lined up with its map, always about: its people stand in the way and can be looked at, its puddles and fires lie on its ground. Each wing's "put everything back" lever starts it again.

## The wings

The hall's doors, round the walls: A the Burning Gallery, B the Works, C the Hall of Looks, D the Town Annexe (and through its east door, Mother Tallow's chandlery), E the Theatre, F the Rules Room, G the Arena, H Kell's Corner.

### The Front Hall (`zoo-hall`)

The screens, explained, and the things outside the world: the welcome; the story's first morning; the title screen; the wardrobe (seven ready-made builds made by the rules engine, and the tailor, who makes you from a sentence with the model); the mirror (your sheet in short); the explore and scene screens; slash commands; a scene that's over and the way on; overlays; the notebook; the combat keys; The End; saving and resuming; the mouse; the browser; settings; the clock (the time of day, everywhere); the glyph lever (ascii, nerd, plain, kingmaker); and the workshop's tools (the look gallery, headless frames, the QA console, the scene harness, places from a description, smoke tests, evals, the unused stand-ins).

### The Burning Gallery (`zoo-fire`)

The look layer's effects, set off as the game sets them off, with your own spells through the rules: Fireball at a scarecrow (straw and hay burn, the stone fireman is unharmed, the puddle hisses, the oil catches); bolts at targets of straw, wood and tin (Fire Bolt, Ray of Frost, Magic Missile's darts); Lightning Bolt up a line of posts, Shocking Grasp on the rod; Thunderwave at a gong (a shockwave); Sleep on a night-watchman (a flash); the colour chart (a bolt of every element's colour); the frost basin and Detect Magic (sparks); the numbers board (every damage colour, a heal, "unharmed"); barks (a crier, a woman in a hat, a parrot); the goose (an alert, on a plate); the coconut stall (a thrown ball, and a bottle as an improvised weapon); dust and embers (the two unused effect kinds); the magician's cabinet (poofs: appear, hide, faint, vanish, a sandbag cut down); the porter and his crate (walks and slides); the flour store (a dust explosion, with your own save if you're standing in it); the sand-glass (fire over time).

### The Works (`zoo-works`)

The world's physics and bookkeeping on benches, through the stage manager's operations and the rules for things: catching fire by material (wood, an iron stove, a wet rug, an oiled pan) and a bucket over it; burning oil, and water on it; six jugs to pour (water, oil, gin, ale, blood, grease); containers breaking open (a water butt, an ale keg, the gin jar with the drowned rat in it, a crate of apples); cold (a puddle to ice, a bonfire out); blood (the butcher's boy); the chandelier brought down; the testing rig (one dose of fire, bludgeoning, poison or thunder to stone, iron, wood, water and a sack: immunities, damaged and destroyed); Burning Hands' cone and a patch of Grease; the pay desk (coin that splits and joins); the cloakroom (gear leaving and rejoining your sheet); the stage manager's desk (move, place behind, create, something invented, a refusal, remove); the GM's ledger; the delegates' bell (an entrance with a group); the sand-glass; and signs for afterwards, exit scripts and the dust in a scene.

### The Hall of Looks (`zoo-looks`)

How everything is drawn, from what the world says it is: the fire row (flames by colour word: blue driftwood, a green witch-fire, violet, spirits burning blue); the scrapyard (a wreck of every material, one smouldering); the paint shop (every state tint); the door wall (open, shut, locked, barred; overturned furniture, an open hatch); the lamplighter's row (lights on and off, a wet torch); the pond (idle motion); the dormitory (down, asleep, dead); the rafters (hanging, overhead, hidden, fallen); the square (a flock, a crowd, a swarm, a pack); the inventor's bench (looks for things nobody planned); the waxworks (the whole cast in their letters and colours); the spill floor (every surface); the sample floor (every ground and wall style); the shed (x-ray behind a building, and a roof that comes off); the lamp room (coloured light in the dark); the weather vane (drizzle and rain, from above); the smoke pot (clouds); the stage.

### The Town Annexe (`zoo-annexe`)

A street in the manner of Caerwyn, for the map itself: walking and the squeeze; the bump alley (the house's line for every kind of wall, the goose, the pigeons, the cabbage cart); locked doors with something to say; the pie shop's opening hours (shut until the Theatre's pie booth has been played); looking around; interact; the right-click menu, hover and Nearby; the lead; the street by the hour (a sweeper, a pie-seller, the lamplighter and the lamps, a watchman, a crowd); the street furniture's lines; the lost-property office (take, give, open a chest, coin, a bench that won't move); roofs off; and the ways out.

### Mother Tallow's chandlery (`zoo-chandlery`)

A place compiled by src/game/map/generate from a plan written by hand, in the shape the fast model writes one, with no model: read the plan, and the compiler's notes and sketch.

### The Theatre (`zoo-theatre`)

Short scenes with the real GM, in booths round a courtyard: step through a booth's door (or talk to whoever's waiting) and its scene opens on its own place.

- **The Last Pie**: authored checks, the method deciding the roll, things that simply happen, outcome routes, an earned payoff, consequences for daft acts, a "no, but", an out-of-character question, a pacing cue.
- **The Noon Bell**: pacing cues and endings that close, escalate and give a last chance; a freeform risky roll and a threat left hanging; walking out; the drizzle.
- **The Silver Dice**: a name held back, staged secrets, pressure rolls, bystanders reacting to violence.
- **The Lost Ledger**: an essential that relocates, the co-GM, memory (Madam Crust remembers the pie stall), an entrance with a group.
- **The Practice Yard**: the rules read from what you say: casting, a blow, grapple and shove, a jump, class features, a rest.
- **The Cracked Tankard**: a brawl that ends in "Roll for initiative!", fought on the tavern's floor, then its aftermath.
- **The repertory board**: any scene of the story's or the scene harness's, rehearsed out of order on its own place (the arc's on the story's maps), and nothing reaching the story.
- Signs for the GM's turn, the boundary and fronts, memory, the co-GM, approaches, and places as their scenes left them (with a lever to put the booths back).

Offline the GM can't speak: each scene still opens on its place, and `/exits` then `/end <id>` takes any of its endings (its exit script writes the notebook).

### The Rules Room (`zoo-rules`)

D&D as the scenes use it, without the GM: skill checks; your own spells (and a fizzle for someone else's), a ritual; a spell running out; class features from the costume rail (Second Wind, Rage, Bardic Inspiration, Innate Sorcery); blows at a dummy and at Big Rodney, a thrown chair; grapple and shove; long jumps over two ditches; the trapdoor (knocked out) and the smelling salts (coming to); short and long rests; the milestone bell (a level); bystanders caught by a spell.

### The Arena (`zoo-arena`)

Fights on the map, started by a ring's bell, on the arena's own map with everyone where its world has them; each ring starts fresh every time and stays as the fight left it:

- **The grain floor**: the Heron's fight rehearsed (Sallow, the Crakes, the lantern-boy, Kell), with grain dust, lanterns, a brazier and sacks.
- **The porters' floor**: Hep Grist's brawlers.
- **The goblin pit**: archers keeping their distance behind rocks (ranged attacks, cover).
- **The wolf run**: Pack Tactics.
- Signs for the battlefield on screen, pacing and targeting, the turn's options, after the fight, resuming, headless fights, death saves, leaving, and the story's fights.

### Kell's Corner (`zoo-kell`)

Sergeant Kell walks with you through the zoo when asked (and waits when asked); a word with her is a talk (her greeting, lines to choose, her story a piece at a time; it needs the model); her desk is a short scene, and if she's walking with you she reads its notebook entry back.

## The tour

`src/game/zoo/tour.ts` goes round every wing headless: it stands by each sign and reads it, sets off every exhibit's triggers in turn (or the exhibit's own `tour` order), plays each scene to an ending (the exhibit's or trigger's `plan`), fights each fight to its end (saving and loading the game partway, as Continue would), and checks what the view played against each trigger's `expect` (effect kinds, damage numbers, barks, a walk; "fight" and "scene" for what they open). It saves what the screen showed at each step and writes a report.

```sh
node --no-warnings src/game/zoo/tour.ts [--live] [--only fire,arena] [--no-png] [--out dir] [--seed n]
```

- **Offline (the default).** `OPENROUTER_API_KEY=offline`: the scenes open on their places with the GM silent and take their endings at once.
- **`--live`.** The scenes' lines are said to the real GM first. The game reads `OPENROUTER_API_KEY` or `~/secrets/kingmaker-dev-openrouter.txt`; the tour never prints it.
- **What it writes** (to `runs/zoo-tour/<stamp>/`):
  - `report.txt` and `report.json`: every exhibit, what each step said and played, and the failures;
  - one folder per wing, with each picture three ways: `.txt`, `.ansi` (cat it) and `.png` (tools/ansi2png.py, when Python has Pillow; `--no-png` skips them);
  - `runs/`: the visit's saves.
- **Exit code.** It exits 1 on any failure.
- **Defaults.** `KM_GLYPHS=ascii` and `KM_LOOK_MODEL=off` unless set.

## How it's built

- **`model.ts`:** wings, exhibits and triggers, and what a trigger did (`Outcome`: words, rules lines, cues, a scene to open, a fight to start).
- **`wings/*.ts`:** one file a wing. Each has:
  - a grid drawn by hand, with marker letters for spots that the code reads (`marks`), or a compiled place;
  - a world lined up with the map, 5 ft to a tile from (0, 0);
  - its exhibits.
- **`install.ts`:** puts a wing among the game's maps:
  - its own region over the whole map, as its world's place;
  - its signs and stations as decor;
  - a dressing for the view from above, read off the map.
- **`explorer.ts`:** the zoo behind the game core's Explorer.
  - It's a hub: it opens any of its scenes, each ending back on the map with nothing chained on, and fights start from the map.
  - Walking, looking, doors and talk are the town's own (src/game/town.ts).
  - It adds the triggers, the next exhibit, scenes opened from their rooms, and plates.
- **`world.ts`:** the wings' worlds.
  - A trigger runs with the player in the wing's world where they stand on the map, carrying what they carry, and with the session's world the wing's for the while, so the rules reach it as they reach a scene's.
  - Gear that changes hands changes the sheet.
- **`fights.ts`, `arenas.ts`:** the arena's rings as fights on the arena's own map. The scenes' fights are the story's own (src/game/fights.ts).
- **`look.ts`, `pictures.ts`:** playing a trigger's news on a view's effects, and pictures without a terminal.
- **`touring.ts`, `tour.ts`:** the tour.
- **`scenes/zoo/`:** the zoo's scenes, authored like the story's (beats, checks, cues, exits with scripts), each on a booth's world.

The game core supports hubs for the zoo, and the story never takes these paths:

- **`play.ts`:**
  - an explore action can `open` any scene or start a `fight` from the map;
  - a hub's scene ends back on the map (`backToHub`);
  - a fight from the map ends there (`fromMap`).
- **`runtime/engine.ts`:** `openHubScene` and `closeHubScene` open a scene afresh and close it without a hand-off.
- **The map module:**
  - worlds live on maps outside scenes (`ExploreState.roam`);
  - places and presence registered from outside (`registerPlace`, `addPresence`);
  - locked doors with their own line (`PlaceRegion.locked`);
  - Kell following by a story flag (`flags.kell === true`).
- **The app** (src/app):
  - the title's zoo;
  - the zoo's explorer and fights for a zoo visit;
  - its news played on the map;
  - the view from above (v);
  - a fight from the map;
  - the card after a zoo scene.

To add an exhibit, give it a marker in its wing's grid and a sign (what it is, how to set it off; dry is the house style), and a trigger whose `run` does what the game does (a stage op, a spell through the rules, a world physics verb), with `expect` naming what the view should play, so the tour checks it.

## What's only a sign

Every feature in the inventory has an exhibit. Some can't be shown in the zoo itself, so their exhibit is a sign that says what it is and where to see it:

- **The story's own.** A new game's start, The End, and the scene boundary and fronts (zoo scenes end on the map with nothing handed on). The town by the hour is shown in miniature in the annexe.
- **Tools outside the game.** The look gallery, headless frames, the QA console, the scene harness, approaches, evals, smoke tests, the browser, settings, and the unused stand-ins. The tour and `qa new --zoo` are the zoo's own uses of two of them.
- **The model.** Offline, the GM's own work shows only as the scene opening on its place and taking its endings by `/end`: the Theatre's booths, rehearsals, a word with Kell, Kell's desk, the tailor, and the inventor's bench's invented looks. `--live` plays them.
