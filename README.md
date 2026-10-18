# Kingmaker

A D&D game for one player, run by an AI game master. You make a character from a sentence, walk the town of Caerwyn on an isometric map drawn in characters, and play its scenes in plain English: the GM improvises around each scene's prep, and the D&D 5.5e rules settle anything that takes dice. This repo is the game, and its review starts at [ARCHITECTURE.md](ARCHITECTURE.md).

**Play it.** `npm ci`, then `npm run dev -- --fake` (the fake GM: no key, no cost; leave out `--fake` for real models and an OpenRouter key), and in another terminal `npm run client -- --session <you>` ([Running it](#running-it)). Or in a browser, with no server: `npm run build:web && npm run web:serve` and open the address it prints ([In a browser](#in-a-browser)), or main's build at <https://tatskaari.github.io/kingmaker/play/>.

**Around it.** The pitch and the roadmap, the published pages the game is built to, are [web/site/](web/site/), and the site Pages publishes puts them in front of the game (`npm run build:site`). The Obsidian authoring plugin is [tools/authoring/](tools/authoring/README.md), a package of its own: the campaign folder is its vault, and it edits the scenes as the game reads them; the glyph font's tools are [tools/glyphs/](tools/glyphs/README.md).

**History.** The game was built in this repo as `v2/`, a vertical at a time ([docs/verticals.md](docs/verticals.md)), beside the prototype it was ported from (the "Kingmaker V2 PoC"). On 2026-10-17 the prototype was retired and `v2/` became the root ([docs/migration-log.md](docs/migration-log.md)). The last commit with the prototype is `bc2ab1f`: `git show bc2ab1f:<path>` for a file of it, or check that commit out to run it. Its docs are archived in [docs/prototype/](docs/prototype/README.md). The design docs and live records in [docs/](docs/) were written while the game lived in `v2/`, so read their `v2/x` paths as `x`; a copied file's first line names its source in the prototype's tree, and the code's comments that cite `src/`, `scenes/` or `lore/` mean that tree (git history has it).

## The parts

The production build of Kingmaker, as the design has it ([the roadmap](web/site/roadmap/index.html)): a client, a simulation and a stateless AI service.

- **The client** is the prototype's OpenTUI screens, in a terminal: the title, character creation, the sheet, the town's map and the scene. It talks only to the simulation. The same game also plays in a browser tab with no server at all: the client in one worker of the page, and the simulation and the AI service in another, the game kept in IndexedDB ([In a browser](#in-a-browser)).
- **The simulation** is a SpacetimeDB module, the authority on everything that happens: the moves, the world, every die.
- **The AI service** (`kingmaker-ai`) is an HTTP service that does all the model work and keeps the words: the prompts, the lore and each game's documents. It holds nothing between requests, since each one carries the working set it needs, so it runs as a local process or a container for now, and on Cloud Run or as a Lambda later. It's the only part that calls OpenRouter. The simulation calls it from a scheduled procedure, and it streams the GM's words back through a reducer only it may call.

It was built a vertical at a time ([docs/verticals.md](docs/verticals.md)): a slice of the game end to end through the parts, with the prototype ([docs/prototype/ARCHITECTURE.md](docs/prototype/ARCHITECTURE.md)) playable beside it until it was retired.

## What you can play

Walk Caerwyn, the town's map between scenes ([docs/map-design.md](docs/map-design.md)), with its action menu, talks with Kell and invented looks ([docs/town-design.md](docs/town-design.md)), the whole story ([docs/story-design.md](docs/story-design.md)) with its scenes written as beats ([docs/scene-format.md](docs/scene-format.md)) and played by the two-part GM ([docs/two-part-design.md](docs/two-part-design.md)), the world bridge ([docs/world-bridge-design.md](docs/world-bridge-design.md)), V1, who you are ([docs/v1-design.md](docs/v1-design.md)), V5, the reply as drawn ([docs/v5-design.md](docs/v5-design.md)), and V0, a line in a scene ([docs/v0-design.md](docs/v0-design.md)): the title, a character made from a sentence, the town on the prototype's isometric map, and every scene of the arc from the hanged clerk to The End, walked to on the map, each with its place drawn beside the talk, its replies drawn as the prototype draws them, its GM in two parts (a mouthpiece that voices the scene and asks for the dice when a roll should settle something, and a co-GM that keeps each person's role and moves the scene along its beats), and the world kept in step with what's said, end to end.

- **The title:** carry on one of your games (the three played last), start a new one, or delete one (x twice).
- **A character from a sentence:** a name and who they are, and the GM offers three builds of three classes, each made legal by the rules engine and shown as a card; or make your own from the SRD's species, classes, subclasses and backgrounds.
- **A backstory:** write it, have the GM draft one or work your notes in, and the GM checks it against Caerwyn's lore: what doesn't fit comes with a fix to accept or rewrite. Or skip it.
- **The sheet the engine made**, before you set off: choose again, or set off into Caerwyn. `/sheet` (or `/c`) shows it over the scene; `/quit` goes back to the title, the game kept.
- **The scene, as the two-part GM plays it:** talk with Kell, Cob and Moll. When you try something whose outcome is uncertain and matters, the GM sets it up and calls a check: it's rolled through the rules engine on your sheet, and you read the dice line (how far you made or missed it: badly, narrowly, only just, cleanly, with room to spare, or a natural 20 or 1) and the one of its five outcomes that came up. Behind the screen a co-GM gives each person a role before your next line (what they're doing, how they feel, what they could let slip and what they hold back), and moves the scene on along its routes when what one describes has happened: a discovery lands, the dead-cart comes up the lane, an ending is reached and the next reply winds the scene down. The GM knows your backstory. A second terminal can watch the scene, row for row.
- **The plumbing holds:** kill the AI service mid-turn, or SpacetimeDB, start it again, and the turn (or the character) finishes. A daily ceiling on what the models cost (`KM_AI_DAILY_USD`, $5) fails a move in the game's words once it's spent.

The town between scenes (Walk Caerwyn), the prototype's map code dropped in on both sides:

- **A game begins in the granary lane in the morning,** on the isometric map, the side panel saying where you are, the hour, the lead ("The Hanged Clerk", just south) and who's about.
- **Walk the town** with the arrows or WASD (up is up the screen, steered along the streets), a click (a step at a time: any key stops it), or `g` for the lead. Walk into a wall and the wall wins. The people about go by the hour (the pie-seller, the goose and the sweeper in the morning), talk when you talk to them, and go by what you'd call them. Doors keep their hours: the Drowned Rat's opens at dusk, and the palace guards cross their halberds.
- **Talk to Kell, or walk into the yard,** and the hanged clerk opens, as V0 opens it. A second terminal watches the map and follows into the scene.
- **After the scene,** Enter takes you back to the map, where the scene left you, Kell beside you. The yard stays as play left it, and once you're out it's locked. Kell has read the entry back first, between scenes; from here the next lead (the Drowned Rat, down the river stairs at evening) is a walk away, `g` walks it, and stepping in opens it.
- **Headless,** `observe` on the map is the QA console's (`MODE: explore`, the map as text, `ACTIONS:`), and `act --id` takes any of its ids: `talk_kell`, `go_to_lead`, `walk_north`, `walk@30,22`, and `out` from a scene that's over.

The town between scenes, complete (the action menu, talks with Kell, invented looks: [docs/town-design.md](docs/town-design.md)), the prototype's code dropped in on both sides, so the client offers and greys out by the same checks the simulation refuses by:

- **The action menu,** `m` on the map (or a right-click's "Do something…", aimed already): your spells by level with the slots left, your class features and the actions anyone has, each with what it does; what can't be done now is dimmed and says why (Shield: a reaction, only in a fight; the rests: nothing to rest off). Aim with Tab, the arrows or the mouse: the bottom line names what's there and how far, an area shows what it covers and whom it catches, and an aim that can't be done says why (out of reach, no clear line) and does nothing. Enter or a click does it.
- **The rules on the town:** from the street outside the watch house (22,8), Fire Bolt at its door and the door catches (a miss is a miss: cast it again). The people about react by the town's table: pigeons run, a man up a ladder runs off shouting for the watch, the palace guards shout at you to stop it. Hurt someone and the guards come at you: "Fight it out" tells it as won, the stand-in, as at the Heron. Hide (a Stealth check against the sharpest eyes about), rest, leap, throw, shove, grab, lift a purse or use what you carry.
- **The fire burns on the clock** while you're on the map, a round every 6 s (the scenes' own fire): the door burns down to a smouldering wreck, smoke, and What happens says so as it comes.
- **An act at a waiting scene's people opens it:** Ray of Frost at Kell in the yard opens the hanged clerk as walking in does, and after the opening your act is your first turn, "(I cast Ray of Frost at Sergeant Kell)", resolved by the scene's rules from where you stood.
- **A word with Kell between scenes:** `t` on the card (or `e` beside her on the map): her greeting, two to four lines to choose by number, "I'll leave you to it.", and walking on without a word. On real models she opens up about one thing at most, a piece at a time as you earn it, and never tells it twice; the deepest of her story waits for a third talk. The talk is played by the two-part GM, as a scene is: its co-GM keeps her role, and "I'll leave you to it." closes it with her last word. Walking on puts you back on the map, the waiting scene exactly as it was.
- **Invented looks:** something the GM makes up ("a disgruntled swan") gets a glyph and colour of its own a moment after, for everyone who sees it, and the next thing of that name has it at once.
- **Headless,** `observe` on the map lists the menu after `ACTIONS:`, each line with its ids, and `act --id` takes the prototype's: `cast_<spell>`, `cast_<spell>_self`, `cast_<spell>@x,y` (and the same for `feature_<id>`), `attack@x,y`, `throw@x,y`, `shove@x,y`, `grapple@x,y`, `lift@x,y`, `jump@x,y`, `hide`, `rest_short`, `rest_short_recover`, `rest_long`, `use_<item>`; and in a talk (`talk_kell` once Kell walks with you) `say_1`…, `say_goodbye` and `walk_on`. A refusal comes back in the prototype's words: "(Fire Bolt (cantrip): no clear line to there.)".


The reply as drawn (V5), in every scene:

- Each speaker's lines in their own colour as the reply is written (Kell, Cob and Moll each have theirs), your own words in yours, and a voice nobody can place in gold italics.
- Three to five suggested lines over the box after each reply: things to say, a deed, a risky try in yellow, a way out near an ending. A number or a click puts one in the box, to send or change. `/suggestions off` and `/suggestions on`.
- A spectator sees the same colours, and no suggested lines: they're the lead's.
- Headless: `ACTIONS:` lists the lines, `act --id say_2` says one, `suggestions on|off`; who says what prints as a `⟨…⟩` line.
- The notes on marked words that V5 drew (a phrase underlined, a card behind it) went in M2: the user found them not well tuned ([docs/migration-log.md](docs/migration-log.md)).

What the GM keeps behind the screen:

- **People remember what you did.** The GM keeps a note on each person, in the game's copy of the lore: how they stand with you and why, what they've seen you do, what they've learned, the promises made by them or to them, and what they did. After each of your lines, in the background, the GM's memory reviews bring the notes on whoever was there up to date (a line rewritten, or one added), and a scene's end adds what its ending says of each of them. The two-part GM's co-GM reads the notes on everyone on stage, so their roles carry the story so far: give Cob a coin and promise Kell the children won't be blamed, and at the Rat both are in the notes the co-GM reads for her role. A talk with Kell between scenes reads them too. Nothing shows on screen; the reviews never hold a turn.
- **`npm run status -- --game <n>`** shows the GM's side of a game, as the prototype's `scene status` does: the stage, what's reached and the path (each of the co-GM's moves), each person's role, a closing on its way; `--notes` prints the GM's notes on each person.
- The old pipeline's ruling on a risky act and its co-GM's reviews are gone with its scene steps, and walking out on an ending of your own plays no part in a scene any more (the two-part GM asks for the dice itself, and its co-GM moves the scene), and talks between scenes are the two-part GM's too ([docs/migration-log.md](docs/migration-log.md)).

Spells and blows, and the scene's place drawn (the world bridge), as the prototype plays them:

- **The place, drawn beside the talk:** the granary yard from above in the side panel, with the prototype's look layer: the lane and the old elm, the yard wall with Moll on it, the gate with Kell by it, Prout hanging from the hoist, Cob under him, you, in the morning's light. It plays what changed: a spell's darts or cone, a number floating up, a rope breaking, a body falling, a fire, smoke, a splash, someone running off, and who's speaking over their heads. A spectator's terminal draws the same.
- **Point at it:** the mouse, or Tab through the place (↑↓ and Enter). The bottom line names what's there; a click talks to someone or glances at a thing (a quiet note in the talk, no turn); a right-click opens its menu: look, take, give, cut, and cast a spell at it (only the spells that fit), which says the deed as your line, in brackets. Deeds wait while the GM has the floor.
- **What you do, the GM plays, and the world keeps up:** the stage manager reads each reply and keeps the place in step with it, so things move, change hands, burn, break, get wet and fall, and people come and go. Things have an AC and hit points.
- **The rules resolve an act before the GM says a word** when it comes from the map's action menu: a spell at a waiting scene's people from the street (Ray of Frost at Kell in the yard) opens the scene, and once its opening is in, the act is your first turn, its dice lines first and the reply playing exactly that; your slots go from the status line. A deed said in words in a scene is the GM's to play: the two-part GM has no decider to read a mechanic out of words, so the old pipeline's spells and blows resolved from a line, the people reacting to them by the rules, and a blow left hanging don't happen in a scene: they're parked for combat ([ai/README.md](ai/README.md), "Parked for combat"; [docs/migration-log.md](docs/migration-log.md)).
- **Fire burns on:** what's burning burns again as your next line begins, spreads to what burns within five feet, and smokes, before the GM speaks. Water puts it out.
- **Headless:** `npm run play -- map` draws the place as the player sees it, then from above with what's what; `say` prints the dice lines before the reply.

The whole story, from the yard to The End, as the prototype plays it:

- **Every scene of the arc:** the hanged clerk, the Drowned Rat at evening, the Heron warehouse at night and the King's morning, with the afternoon and the wharf at night between them (interludes the story passes over). A scene ends through any of its endings, and each ending writes what it means: a quest moved on, a flag, a line in the notebook, how someone stands towards you, who walks with you, what it puts in your hands (the Heron's true book) and who it takes off the scene (Hobb, to his night's work).
- **The story moves on as the prototype's does:** at a scene's end the GM writes the hand-off, checks the scenes to come against what happened (one play has overtaken is skipped), rewrites the next one's opening where the story has moved, and gives you the lead; the world's fronts move on, people remember how the scene ended, and anything you were owed (the page in Cob's boot) goes with whoever has it, as what you carry goes with you. "Continue, once the story has moved on" while it does (about 10 s on real models); if it gets stuck, "try again".
- **Between scenes:** Kell, a line at a time, reads the entry back and walks on with you ("The Drowned Rat, then."), or a card says how the time passed. Enter goes back to the map, where the scene left you, Kell beside you, and you walk to the lead (`g`, or walk there yourself): its scene opens as you step in. `/journal` (`j` between scenes) is the investigator's notebook, `/quests` the quests.
- **The fight is a stand-in:** at the Heron, once the co-GM takes the scene to its fight, the next reply ends on it breaking out ("Roll for initiative!"); "Fight it out" tells it as won, and the GM plays the aftermath. The notebook says the fight wasn't played.
- **A summons:** the Heron's end brings the King's morning at once, with no card between. Its ending is The End: how it went, scene by scene, and the GM's bar tab.
- **A spectator** follows the lead from scene to scene: "Watching: Wren Ashdown goes on when ready".
- **For testing,** `/end <exit>` (or `npm run play -- end --exit <exit>`) ends a scene at once as the dev stack's owner; `/end` alone lists the endings. `npm run status` shows what each boundary handed on, the chapters, quests and flags.

Between scenes the rules pass the time as the prototype's do (the world bridge's): a spell runs out, you come round if you were down, and the King's morning brings a level and a long rest.

**Not yet ported from the prototype** ([docs/verticals.md](docs/verticals.md) §4): the fight played on the map a turn at a time (V12: at the Heron, and the fights that break out in town, which the stand-in tells as won meanwhile) and words typed in a fight (V13). `npm run arc` passes 15 of its 16 checks; the one left is V12's.

Recorded runs with real models are in [docs/live/](docs/live/): V0's four lines, V5's twelve, V1's characters made from a sentence, the map's opening started by talking to Kell, beside the prototype's, the full GM's seven lines, the first three beside the prototype's, the world bridge's spells and blows beside the prototype's on the same lines, and the whole story from the yard to The End, beside the prototype's QA console; the page in a browser, with no server ([browser.md](docs/live/browser.md)); and the town's action menu and a talk with Kell ([town.md](docs/live/town.md)).

## The layout

| Folder | What it is |
|---|---|
| [shared/](shared/) | Plain TypeScript the other three run: the requests and answers between the simulation and the AI service ([protocol/ai.ts](shared/protocol/ai.ts)), the idempotency keys, the refusals in the game's words, the markup's types, the dice, the scene's types, loader and graph, the GM's bookkeeping (`GmState`) and its row, the world with its rows, the rules code its hosts hand the engine ([rules/](shared/rules/), with the shim the engine needs) and character creation's types and text helpers ([creation/](shared/creation/)), and the prototype's map code ([map/](shared/map/): the tiles, the walking, who's about, the town's actions, the action menu's geometry and aiming, `menu.ts`, and the town's world), which the simulation and the client both run on the same rows; doing a menu act (`menu-acts.ts`) and the catalogue (`rules/actions.ts`) are the simulation's |
| [simulation/](simulation/) | The SpacetimeDB module: [schema.ts](simulation/src/schema.ts) (every table), [index.ts](simulation/src/index.ts) (every reducer, procedure and view), the moves (a scene's, character creation's and the map's) and the job loop, each a plain function over the tables, the GM's bookkeeping and the co-GM's merge (gm/), the rules engine loaded and pinned and the rules' acts on the scene's world at a turn's start and for the map's act (rules/; the reactions step, parked for combat), the story between scenes (story/: a scene's end and its effects, the boundary as a job, the lead, the fight's stand-in; world/cross.ts moves people and things between places), the town (map/: the action menu's seven moves, the town's clock `tick_place`, a fight on the map, a talk as a scene of kind `talk`), invented looks (moves/looks.ts), and the memory host that runs them in the tests |
| [ai/](ai/README.md) | The AI service: its HTTP server and stores (service/), the GM pipeline ported from the prototype (gm/), and the model client, prompts and docs service, which the prototype shared until it was retired |
| [client/](client/) | The client: the screens (ui/: the title, character creation, the sheet, the map, the scene and its place), the models over the rows that pick and feed them (app/, title/, creation/, explore/, scene/, sheet/), the prototype's look layer that draws a place and plays what changed, and its map renderer (look/, map/), the connection that follows the player's seat (net/), the demo, the headless verbs, and the bindings the CLI generates from the module ([module_bindings/](client/module_bindings/), committed) |
| [campaigns/caerwyn/](campaigns/caerwyn/) | The campaign as data ([campaigns/README.md](campaigns/README.md): what's in it, and how to write and check a scene): campaign.json (with the world a backstory is written for, the quests, and where a game starts on the map), every scene of the arc as one `.kmscene` file ([docs/scene-format.md](docs/scene-format.md): the hanged clerk, the Drowned Rat, the Heron warehouse, the King's morning and the two interludes, re-authored in M2 as beats, each ending's effects as data), their places as worlds (the granary yard, the Rat, the Heron, the dressing room), the talk template (scenes/talk.kmscene, filled for whoever walks with you), the arc (arc.md), the ready-made characters (builds.json: a concept and a build each), the cast's looks, and the 154 lore docs |
| [vendor/](vendor/) | Vendored code, as it is but for what its README says: the D&D rules engine made ready for a SpacetimeDB module, its content pack, and the SRD's spell texts |
| [hosts/](hosts/) | The composition roots, the only code that reads env or argv: the AI service, the client and the headless client, the dev stack ([hosts/dev/README.md](hosts/dev/README.md)), the doctor, the campaign tool and its install, the local host, the e2e and the live run, the GM loop's commands and its stack ([loop.ts](hosts/loop.ts), [loop/](hosts/loop/)), and the page's ([hosts/web/](hosts/web/): its two workers, its build, its server for trying it, its browser check and the screen check on the JS OpenTUI) |
| [web/](web/README.md) | The browser platform the page's workers are made of ([docs/browser-design.md](docs/browser-design.md)): the JS OpenTUI the client draws with in a page ([tui/](web/tui/), the prototype's), the page and its key form ([page/](web/page/)), the glyph fonts ([fonts/](web/fonts/)), the page host's parts ([server/](web/server/): its database in IndexedDB, the saves written behind, the rows pushed to a client, the moves it takes, the job loop, the tab's lock, the model's key) and the few Node modules the bundles still name ([node/](web/node/)); and the site's own pages around it, the pitch and the roadmap ([site/](web/site/)) |
| [docs/](docs/) | The plan ([verticals.md](docs/verticals.md)), the blueprints with how each was built ([v0-design.md](docs/v0-design.md), [v5-design.md](docs/v5-design.md), [v1-design.md](docs/v1-design.md), [full-gm-design.md](docs/full-gm-design.md), [world-bridge-design.md](docs/world-bridge-design.md), [story-design.md](docs/story-design.md), [map-design.md](docs/map-design.md), [browser-design.md](docs/browser-design.md), [town-design.md](docs/town-design.md)) and the recorded live runs ([live/](docs/live/)); the research behind the game ([research/](docs/research/)), the prototype's blind QA reports ([qa/](docs/qa/)), the productionising brief ([code.md](docs/code.md)), the user's notes (the `.txt` files), the migration log ([migration-log.md](docs/migration-log.md)) and the prototype's docs, archived ([prototype/](docs/prototype/README.md)) |
| [qa/](qa/) | The GM loop's QA rounds ([qa/loop/README.md](qa/loop/README.md), the `kingmaker-gm-loop` skill): blind persona testers play the game's scenes on a dev stack through the headless client, blind reviewers judge each game against one rubric from a pack of the scene's prep as the GM had it, and a report shows the arms, the endings, the triaged findings and every model call; the rubric, the briefs, the personas and the truth sheets beside the code |
| [tools/](tools/) | The tools beside the game: the Obsidian authoring plugin ([authoring/](tools/authoring/README.md), its own package), the glyph font's build ([glyphs/](tools/glyphs/README.md), from the bitmaps in [assets/glyphs/](assets/glyphs/)) and the SRD spells' build ([srd-spells/](tools/srd-spells/build.py), into [vendor/srd-spells/](vendor/srd-spells/README.md)) |
| `dist/` | Build output, never committed: the page (`dist/web`, `npm run build:web`) and the site Pages publishes (`dist/site`, `npm run build:site`: the pitch, the roadmap and the page at play/) |
| `runs/` | Run output, never committed: the stacks' data, keys and logs, the client's sessions, the live run's rehearsals, the CLI's config for building, the browser check's screens (`runs/web/`), the GM loop's rounds (`runs/loop/`) and its stack (`runs/loop-stack/`) |

The game never imported the prototype, which is retired now ([docs/migration-log.md](docs/migration-log.md)): what it needed of it was copied, and each copy's first line names its source at the commit it came from and the edits made.

## Running it

### What you need

- **Node 26.9.** The repo's proto pins it: run from inside the repo.
- **The SpacetimeDB CLI 2.12.0:** `curl -sSf https://install.spacetimedb.com | sh`, then `spacetime version install 2.12.0 --use`. The stack finds it on the PATH or in `~/.local/bin`, and keeps its own config in its folder: it never reads or writes `~/.config/spacetime`.
- **pasta** (the passt package) for namespace mode, or the one `sudo` line for host mode (below).
- **An OpenRouter key** for real models: `OPENROUTER_API_KEY`, or `~/secrets/kingmaker-dev-openrouter.txt`. Without one, run on the fake model with `--fake`.
- **podman**, only for `--container`.
- **The Kingmaker Glyphs font**, for people and creatures drawn as sprites in a terminal: `npm run glyphs` installs it for this user (without it the terminal draws letters; [tools/glyphs](tools/glyphs/README.md)).

### The stack

```sh
npm ci
npm run dev              # SpacetimeDB, the module, the AI service and the campaign, on real models
npm run dev -- --fake    # the same on the fake model: no key, no cost
```

The fake model plays [hosts/dev/fake.json](hosts/dev/fake.json): the GM's four golden replies in turn (whatever you say, so they won't always answer it), each written over two seconds with Kell, Cob and Moll in their colours, and twelve suggested lines, four offered after each reply (those offered last time, and the last three you said, are screened out). Its co-GM walks each scene to its first good ending, a route a line (the discoveries it needs first), so the hanged clerk closes after four lines and winds down on the fifth. `KM_AI_FAKE` (JSON) goes on top of the file: with `KM_AI_FAKE='{"mouthpiece":{"check":{"skill":"medicine","dc":12}}}' npm run dev -- --fake` the GM calls a Medicine check on every reply, so every line rolls; `'{"coGm":{"still":true}}'` keeps the co-GM from moving the scene, and `'{"coGm":{"endings":["suspicious"]}}'` walks it to another ending. The whole story's recipe walks each scene to the ending the story goes on from (murder by persons unknown, Hobb talking, the true book taken out, the King's justice):

```sh
KM_AI_FAKE='{"coGm":{"endings":["murder-unknown","hobb-talks","proof-taken","justice"]}}' npm run dev -- --fresh --fake
```

On the fake, every scene's opening and reply is one of the yard's golden replies, and the boundary's verdict is the least it can be (the next scene on, nothing rewritten, no lead), so Kell says the afternoon went in paperwork. [hosts/dev/README.md](hosts/dev/README.md) has more.

It brings everything up, installs the campaign in both services, checks that each can reach the other, and prints where things are. Then it takes keys while you play:

| Key | What |
|---|---|
| `k` | kill the AI service, as a crash would |
| `s` | start it again: a turn waiting for it goes on at once |
| `r` | restart it: what's in flight is finished and answered first |
| `f` | make it exit right after it stores its next reply, before sending it; `s` then starts it, and the kept reply lands at once, from the store |
| `p` | build and republish the module (the data kept) |
| `d` | run the doctor |
| `q`, Ctrl+C | stop everything |

Its flags (`--port`, `--ai-port`, `--root`, `--fresh`, `--mode`, `--container`, `--gm canned`, `--no-keys`), its folder and what to do when it won't start are in [hosts/dev/README.md](hosts/dev/README.md). `npm run doctor` checks a running stack from another terminal.

### Playing

In another terminal, while the stack runs:

```sh
npm run client -- --session tamsin       # the title: New game makes a character, Continue carries one on
npm run client -- --session wren --join 1     # watch game 1: the number in its player's side panel
```

The session (`runs/play/<name>`) keeps one identity, so `--session tamsin` comes back to the same games. `--new "Name: concept"` goes straight to making that character; `--new "Name: concept" --build cleric|fighter|ranger|rogue|wizard` starts a ready-made one at once. `npm run client -- --demo` plays the title, a character, the map and a scene on canned rows with no server at all. `/help` in a scene says how to play and lists its commands; `/quit` goes to the title; Ctrl+C leaves.

Headless, for agents and QA (the prototype's QA verbs, one a process):

```sh
npm run play -- builds --session t --as "Tamsin Vell: a disgraced palace auditor with a ledger-keeper's eye"
npm run play -- new --session t --as "Tamsin Vell: a disgraced palace auditor with a ledger-keeper's eye" \
  --build 2 --backstory "I'm the King's nephew. I owe Fat Jory three crowns." --accept-fixes
npm run play -- sheet --session t
npm run play -- observe --session t                # on the map: MODE: explore, the map as text, ACTIONS
npm run play -- act --session t --id talk_kell     # over to Kell: the hanged clerk opens, and waits for the opening
npm run play -- say --session t "Sergeant, who found him?"
npm run play -- act --session t --id say_2         # say the second suggested line
npm run play -- suggestions --session t off        # or on: asks for this moment's at once
npm run play -- map --session t                  # the scene's place: as the player sees it, then from above
npm run play -- act --session t --id walk@22,8     # up the street to the watch house
npm run play -- act --session t --id cast_fire-bolt@25,6   # the action menu's ids (observe lists them): the door catches
npm run play -- act --session t --id hide          # rest_short, jump@x,y, use_<item>…: refused in the prototype's words when they can't be
npm run play -- act --session t --id out           # once the scene is over: back to the map
npm run play -- act --session t --id talk_kell     # between scenes, Kell walking with you: a talk; then say_1…, say_goodbye, walk_on
npm run play -- end --session t --exit open-case   # testing, as the dev stack's owner: end the scene now (no --exit: the endings)
npm run play -- journal --session t                # the notebook, the quests, the flags, the attitudes
npm run play -- go --session t                     # on to the lead, walked to on the map (act --id go_to_lead walks one move); at the Heron's fight, act --id fight
npm run play -- --help      # builds, new, sheet, games, continue, delete, begin, join, observe, say, act, suggestions, retry, transcript, map, end, go, journal
```

`observe` says `MODE: between` (Kell's talk or the card, and the way on), `MODE: fight` and `MODE: end` between scenes, as the prototype's QA console does.

### Host mode and namespace mode

SpacetimeDB won't let the module call loopback or a private address. So the module always calls the AI service at `http://11.0.0.1:8787` (11.0.0.1 is a public address, kept on this machine), and `npm run dev` picks how that address reaches it:

| Mode | When | How |
|---|---|---|
| namespace | 11.0.0.1 isn't on this machine (the default) | SpacetimeDB runs inside `pasta`, which maps 11.0.0.1 to the host's loopback, where the AI service listens, and forwards SpacetimeDB's port to the host's `127.0.0.1`. No root needed |
| host | 11.0.0.1 is on one of this machine's interfaces | Everything runs on the host. The AI service listens on 11.0.0.1 and 127.0.0.1 |

For host mode, once per boot:

```sh
sudo ip addr add 11.0.0.1/32 dev lo
```

For good, a dummy interface: `sudo nmcli connection add type dummy ifname km0 con-name km0 ipv4.method manual ipv4.addresses 11.0.0.1/32 ipv6.method disabled`. CI runs host mode; `--mode` overrides the choice.

## In a browser

The game also plays in a browser tab, with no server at all (V14: [docs/browser-design.md](docs/browser-design.md)). The page draws the game in xterm.js, and two Web Workers on the page, joined by a MessageChannel, do the rest:

- **The client worker** runs the client's App, as the terminal client does, on a JS stand-in for OpenTUI ([web/tui/](web/tui/), the prototype's), over a Replica of the rows that the port link (`client/net/port.ts`) keeps, in place of SpacetimeDB's connection.
- **The server worker** is the page host ([hosts/web/page-host.ts](hosts/web/page-host.ts)): the simulation on the memory host, its tables kept in IndexedDB, and the AI service in the same worker, its stores kept there too. With a key, the model calls go from it straight to OpenRouter. The two speak the wire in [shared/protocol/port.ts](shared/protocol/port.ts): moves in, a snapshot of the rows and then each commit's changes out.

```sh
npm ci
npm run build:web      # dist/web: the page, its two workers and content.json (a second)
npm run web:serve      # http://127.0.0.1:7311/kingmaker/pr-preview/pr-0/play/, served as GitHub Pages serves a preview
npm run build:site     # dist/site: the site Pages publishes, the pitch, the roadmap and the page at play/
```

The site is the game's front door: the pitch at its root, the roadmap at `roadmap/` and the page at `play/` (`npm run build:site`, [hosts/web/build-site.ts](hosts/web/build-site.ts), which points the pitch's and the roadmap's links at the site's own pages). Main's is at `https://tatskaari.github.io/kingmaker/`, the game at `https://tatskaari.github.io/kingmaker/play/`, and each PR's preview carries the same site at `https://tatskaari.github.io/kingmaker/pr-preview/pr-<N>/`, its comment linking `play/` and `play/?fake`. To look the whole site over locally: `npm run web:serve -- --dir dist/site --base /kingmaker/pr-preview/pr-0/`.

- **The key or the fake GM.** The page asks for an OpenRouter key, kept in this browser only (the prototype's previews shared it), and checked with OpenRouter before it's kept; or **Play with the fake GM**: no key and no cost, [hosts/dev/fake.json](hosts/dev/fake.json)'s canned replies, which don't answer what you say. `?fake` goes straight to the fake GM; `?fake=arc` plays the whole story's recipe, so each scene ends on its second line and the arc can be walked to The End. The bar under the game changes or forgets the key.
- **Then it plays as the terminal client does:** the title, a character from a sentence, the sheet, the town's map with its action menu and its fire on the clock (the page host runs `tick_place` every 6 s, as SpacetimeDB's schedule does), every scene of the arc with its place drawn, spells and fire, the full GM, between scenes and a word with Kell, The End. The fight is still the stand-in. `/end <exit>` ends a scene, as on the dev stack (the page host makes it as the owner).
- **It keeps the game.** Reload, and the title's Continue carries it on. A second tab is told the game is open in the first, and can take it over (the first saves it and lets go). A browser that won't keep anything (a private window) plays on, and the bar says the game won't be kept.
- **Not yet:** the doors and lamps pictures over the map, problem reports, several players in one browser, a browser tab against a SpacetimeDB server. The page host sends a client every row (full push, not subscriptions), which suits one player in one browser.

The terminal client and the SpacetimeDB stack are unchanged: `Connection` is the same Replica over SpacetimeDB's connection (`SpacetimeLink`).

## Testing it

| Command | What it checks | Takes |
|---|---|---|
| `npm run check` | The type check (the repo's, and the module's under its own lib); the unit tests: shared, the simulation on its memory host, the AI service and its prompt parity with the prototype, the client, the hosts, the hanged clerk's endings and suggested lines played on the local host (and the campaign's own, on the two-part GM), and the page host's parts with the contract test (a Replica over the port link against the page host, over a real MessageChannel, carried on after a rebuild from what it kept); then the client's screen check | about 45 s |
| `npm run e2e` | A line in a scene, a character made, the map, the GM, the world and the whole story, end to end on a real SpacetimeDB (ports 3310 and 8797, `runs/e2e`), the scenes on the two-part GM: two clients, a spectator's refusals, the AI service killed mid-reply, restarted mid-reply and gone after it kept an answer, SpacetimeDB restarted in the settle, and an ending the co-GM walks the scene to (a route a line, then the mouthpiece's closing); the reply as drawn: who says each line as it streams, a spectator joining once the opening is in, a line said while the world settles (and the co-GM's note it reads), the suggested lines (a spectator gets none, `act` says one, a late set is dropped, off and on), and the lines kept by the AI service as it died; then a concept to the opening, the AI service gone after it kept the lore check, SpacetimeDB restarted while the builds are made, a character made and checks rolled beside another game's stream, the daily ceiling, continue and delete; the map: each game starts in the granary lane and is talked or walked into its scene (a spectator seeing the same walk), back to the map after the ending, the story on to the Rat and the yard locked once you're out, and the map moves' times; then the GM: the GM's notes on Kell written after a line, the co-GM steering (its roles in the next reply's note, its moves on the rows, the dead-cart moving the stage and Tull brought on and shown), and a risky act the mouthpiece calls a check on (the dice line with its band, the outcome that came up, the co-GM told); then the world: a spell from the lane at Kell resolved by the rules before the GM speaks (its dice rows before the reply's first draft for both clients, Kell hurt in the world rows, the slot gone), fire burning on at the next line's start, and the spectator's world row for row the lead's; then the whole story: one game from the yard to The End with a spectator, the co-GM walking each scene to its ending, each scene's end crossing the boundary (its chapter, the endings' rows, the hand-off, the verdict and the fronts asked once), the lead walked to with the story so far in its opening, the next scene's co-GM given the GM's notes on Kell, a scene ended by the owner, the fight's stand-in and its aftermath, a summons, The End; then the town: the action menu's Fire Bolt refused with no clear line from the lane and writing nothing, then catching the watch house door from the street, the guards shouting, a spectator's map drawing it and `tick_place` burning it on; Ray of Frost at Kell opening the yard with the act as turn 1, its mechanic on the turn's row; an invented look; and a talk with Kell between scenes, told the GM's notes on her, that leaves the waiting Rat's rows as they were | about 7 min |
| `npm run arc` | The prototype's whole-arc check on a stack of its own (3320 and 8807, `runs/arc`): the checks the verticals so far turn on (15 of 16: the character is built by the rules engine; the story starts in the morning, heading for the granary; observe in the lane, Kell to talk to; the granary yard opens the hanged clerk; the scene's place is drawn with the player in it; then the story from the yard to The End as the flow takes it, each scene ended through its exit as the owner and the next lead walked to on the map), the one left (Sallow and the Crakes in the fight) skipped with the unit that brings it | about 40 s |
| `npm run live -- --script v5` | A new game and V5's twelve lines against the running dev stack, with real models, recorded in `docs/live/` with each turn's speakers and lines (stops before $0.10); `--script gm` is the full GM's eight, with each line's ruling, memory review and co-GM review (the old pipeline's: on a two-part scene those columns are empty); `--script world` the world bridge's spells and blows (five lines unless told), with each line's dice, what the world showed after and who reacted (the same); `--lines 4` without `--script` is V0's; `--creation` is V1's: three concepts' builds, then a character made through the lore check to the opening and a line (about $0.02); `--script map` is the map's: the opening started by talking to Kell in the lane, then three lines. Every script starts on the map and opens its scene by talking to Kell; `--script story` is the whole story from the yard to The End, each scene ended as the owner, so every boundary and opening is the models' (about $0.035). None writes over a record: a second run the same day goes beside the first (`v5-<date>-2.md`), and `--rehearse`, on the fake model, writes to `runs/live/` | about 90 s, $0.06 |
| `npm run web:check` | The page's build (`npm run build:web` first) held to its rules, then served as GitHub Pages serves a preview and played in headless Chromium on the fake GM: the key form (OpenRouter faked), both workers started on the page's channel (the key to the server worker only), the title, a character, the map and its action menu (`m`, then Esc), the yard's opening streamed, a line and its reply, the saves in IndexedDB, a reload carrying the game on, Play again after Ctrl+C, a second tab, a browser that keeps nothing; no request leaves the origin, and a made-up key is in no URL, console line, record or screen | about 40 s |
| `npm run web:screens` | The client's screen check (as `npm run screens`) on the JS OpenTUI the page draws with | about 20 s |
| `npm run campaign -- check campaigns/caerwyn` | The campaign folder is fit to install: every scene held to the scene format's rules ([campaigns/README.md](campaigns/README.md)) | a second |
| `npm run loop -- <command>` | The GM loop's QA rounds on a dev stack of their own (`stack up`, on real models or `--fake`): a round of persona testers and blind reviewers, run by the `kingmaker-gm-loop` skill and its workflow, then triage and a report ([qa/loop/README.md](qa/loop/README.md)) | minutes a round; about $0.09 a 20-turn game |
| `npm run simulation:generate` | Regenerates `client/module_bindings` from the module: run it after any change to a table, reducer or view, and commit the result (CI checks) | seconds |


## The rules

- **Imports.** `shared/` imports only itself (no `node:`, no packages), and the rules engine's typings from `vendor/` as types only: it's handed the engine. `ai/` imports `node:`, itself, `shared/` and `vendor/`, never a package. `simulation/src` imports `shared/`, `vendor/`, `spacetimedb`, `spacetimedb/server` and itself, but only `index.ts` and `schema.ts` import `spacetimedb/server` at run time (it doesn't load in Node), so every move also runs on the memory host in the tests. `client/` imports `shared/`, its packages and the bindings, never the engine. `web/server` imports itself, `shared/`, `simulation/src`, `ai/` and the SDK's classes, and `web/tui` itself and its packages (React, its reconciler, Yoga): neither imports `client/`, `hosts/` or `node:`, since both run in a browser's worker. `hosts/` may import anything in the repo. `qa/` (the GM loop) imports `node:`, itself, `client/`, `ai/` and `shared/`, and reads no environment: `hosts/loop.ts` hands it what it needs ([qa/imports.test.ts](qa/imports.test.ts)). Tests hold all but the client's ([shared/imports.test.ts](shared/imports.test.ts), [ai/imports.test.ts](ai/imports.test.ts), [simulation/src/imports.test.ts](simulation/src/imports.test.ts), [web/server/imports.test.ts](web/server/imports.test.ts), [web/tui/imports.test.ts](web/tui/imports.test.ts)).
- **The hosts configure; the code is handed its config.** Nothing in `client/`, `ai/` or `simulation/src` reads the environment or touches a file system as it's imported, and none decides for itself where its files are: a host hands in what each needs (the client reads only the files a host names, a terminal's session and the owner's key). The client's glyph set, looks' store and pace come from `hosts/terminal.ts` in a terminal and from the client worker in a page; the AI service's docs volumes, prompt source and stores from `hosts/ai.ts` (folders) or the page host (memory, kept in IndexedDB); the memory host's clock, log and saved rows from whoever starts it. The one exception is the model client's process-wide mode, the prototype's way (`KM_CALL_LOG`, `KM_COST_LEDGER`, the dev key file, in `ai/llm/openrouter.ts`), which a request with its own call context, as every one of the AI service's is, never uses.
- **ES2021 in `shared/`,** the module's lib: no `.at`, `findLast`, `Object.hasOwn`, `structuredClone` or `toSorted`. The module's own type check (`tsc -p simulation`) catches them.
- **Erasable syntax, and `.ts` on every relative import.** `ai/`, `shared/` and `hosts/ai.ts` also run under plain `node` (the AI service's container), so no JSX, enums or parameter properties there, and JSON only as a module with `with { type: "json" }`, which Node takes (the simulation imports the rules' JSON the same way, so a bundle of both holds one copy).
- **The simulation is deterministic.** No `Math.random`, `Date.now()` or `new Date()` in `simulation/src` or `shared/`: time is the transaction's, and every die comes from the game's `dice` row, so a game replays. The rules engine reads a clock and makes random ids, so the simulation runs it pinned to both ([shared/rules/shim.ts](shared/rules/shim.ts), the one file that touches them).
- **A test never rolls real dice.** A game's `dice` row is seeded once, as it's made, from the host's randomness: the memory host's is a fixed sequence (its `seed`), the page host's tests give it a seed of their own (`HostConfig.seed`), and on SpacetimeDB the owner fixes it with `set_dice_seed` ([simulation/src/dice-seed.ts](simulation/src/dice-seed.ts)), which the e2e does in its first step and again for a step that checks what its own dice gave. A test asserts what its seed rolls, and never retries a roll or takes whichever outcome came.
- **The bindings are the module's.** After any change to a table, reducer or view, run `npm run simulation:generate` and commit `client/module_bindings`.
