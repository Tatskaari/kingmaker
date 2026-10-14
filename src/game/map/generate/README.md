# src/game/map/generate: places from a description

Can the game's fast model make a place like the hand-made Rat or Heron mid-story ("a chandler's shop on the wharves")? **Yes, at runtime, on today's mainline** (the look layer drawing the map), if the model never draws the map. It writes a terse semantic plan, which streams in. A deterministic compiler lays the building out as soon as the rooms have arrived, and furnishes it when the things do. The game's own renderer then checks it, and problems go back to the model for repair.

**The numbers.** The four places measured as the spike measured them took a median of 5.8 to 7.5 s, depending on the run (the spike took 18.9 s), at $0.0004 to $0.0005 a place, including the look layer's model calls. The building is laid out at a median of 2.1 to 2.6 s. Over the seven runs of those places while this version was finished:

- 137 of 140 generations passed, 132 of them on the first try.
- The five unseen places passed 30 of 30 over three runs, 27 on the first try.
- Every failure was a gap in the compiler, not a model mistake. Each was fixed, and the fix was checked against every plan the model had written: 155 of the 156 first plans logged in these runs pass with the code as committed.

"Passed" means the map is sound and does what the plan says. It doesn't mean it's as good as a hand-made place: see [What doesn't work](#what-doesnt-work-yet).

## What changed since the spike

The spike passed 20 of 20 on its own base. A review found six things to change before it was usable, and on the mainline its camera check failed every place. In the order the review gave them:

1. **The camera check is a render diff** (`camera.ts`). An actor counts as seen if taking it away changes the picture: the view is drawn with and without it, as `src/game/map/xray.ts` `findHidden` does. The spike compared the drawn glyph with the actor's own glyph, which stopped working once the look layer drew different glyphs.
   - Actors are taken away in batches whose drawings can't touch, so a view costs one render per batch, not one per actor.
   - Something drawn exactly like the ground under it (a "~" in the shallows) is asked about again with other ground under it.
   - The furnisher still predicts where the renderer paints, so that it can avoid collisions: an actor's own cell, a hanging thing's rope, the top of a stack, the flame over a fire. It follows render.ts's rule for how high a thing is drawn (the map's raise where it has one, else the look's lift). The mainline changed that rule while this work was in progress, and the furnisher was updated to match.
2. **The scene's cast.** The planner is told the scene's cast (`castMember` turns each cast card into an id, a name and a line on who they are), and the plan's people take those ids.
   - People the plan writes differently are matched by name: "Dilly Sparrow" with id dilly-sparrow becomes dilly, and "Hep Grist" becomes hep.
   - Anyone the plan leaves out is placed by relation, near what their line mentions or else by the door you come in by, not dropped by buildWorld's spread.
   - People outside the game's cast table get their own letters and colours, distinct within the place (`people.ts`). `installPlace` registers them in the one cast table (`CAST`), so the map, the look layer and the app all draw them the same way, and `uninstallPlace` takes them out again.
   - In the final runs the model used every cast id by itself in 34 of 40 Rat and Heron plans. Sallow, who arrives later, was left out three times and placed by the compiler. One degenerate plan had no rooms and no people.
3. **Things get the look layer's glyphs**, so the look layer's rules had to read the names generated places produce. Small rule fixes in `src/game/look`:
   - an oven, a stove or a kiln is a warm dome (∩), not a blaze, and its peel is a paddle;
   - a lime pit is a pit, not a lime tree;
   - a sign showing a lamp is a sign, and oil tins aren't oil;
   - a plunge pool is a pool, and a compound is its last part (a rope-counter is a counter);
   - hay bales are grain, and kneelers, mats, sinks and worktables have rules;
   - a name ends at across, along, beyond, past, through, among or around (the city's bells across the water are bells, not water);
   - a person with a name of their own is their initial, not their surname (Dilly Sparrow isn't a bird, Mara Wick isn't a candle), unless the name has an article (a Sea Captain is a guard).

   Names the rules still don't know cost a look-layer model call. A generation now asks for them itself and counts the call in its own time and cost (`looks.ts`, using `inventNow` in `invent.ts`, which returns what the call cost). The call starts as soon as the plan's things have streamed in, so it mostly overlaps the model writing the people. The final run made 6 such calls for 20 places, costing $0.0007 in all.
4. **Composition** (`layout.ts`, `orient.ts`):
   - The outside runs along the building's frontage and a square past each corner. A street is three squares deep at most and a river three (more where things stand in them), and a whole side six (plus a boat's berth).
   - A burrow is timber-walled inside its bank, as the Rat is, with panelled partitions (timber in a burrow).
   - The footprint grows before carving, so the main room has five clear squares each way. Room sizes are checked after carving, and the building grows again if the rooms took that space.
   - A seed varies what the plan leaves open, so two runs of one plan differ: which end of its side a room takes, where along its wall a door goes (not always the middle), and sometimes a back corner left out, so the building is an L.
   - Water goes round to a side the camera sees, as the hand-made Heron has it. When the wharf is in front and the river behind, the river and its plank walk and boats move to the other front side.
   - One-storey walls are two rows high, so they don't swallow a small room in the scene view. The neighbours behind a building, and a burrow's bank, are two squares deep, so they read as houses or a hillside.
   - An outside area cut off from the way in (the quay above a burrow, the landing below it) gets a way round the building, cut through the bank as steps.
   - A boat with anything aboard gets a deck two squares wide.
5. **Light.**
   - A fire lights its room's timber walls, not turf. A test walks every light's line as render.ts does and checks that nothing lit inside reaches turf (bank or grass) outside.
   - Windows don't look into a bank or a neighbour's wall.
   - A big room (30 squares or more) where the scene is gets lanterns hung where it's darkest, clear of the walls, until a light reaches 80% of it, three at most. That covers a room lit by one fire and a room lit by nothing. Each light counts by its own reach: an oven glows, it doesn't light a kitchen.
6. **Latency.**
   - Reasoning `none` is the default.
   - The plan is terse (`compact.ts`): each entry is a list of fields inside strict JSON. That's 47% of the old plan's length on the stored plans, and a median of 524 to 703 output tokens a call against 1592 to 2215. Fields a model leaves out, or splits, are read by what they look like.
   - It streams: the building is laid out when the things begin (`onShell`), and the look layer is asked about the things when the people begin.
   - Measured on the same day and with the same compiler, the old plan took a median 21.5 s with reasoning low and 19.1 s with none. The terse, streamed plan took 5.8 s in that session.

## Run it

```sh
# Measure: each place 5 times, every round's plan and problems kept, pictures by day and night beside
# the hand-made Rat and Heron, contact sheets per place. About $0.01.
node --no-warnings src/game/map/generate/bench.ts --runs 5 --out runs/generate
node --no-warnings src/game/map/generate/bench.ts --only cooper,harbour,pawnshop,herbalist,kitchen --runs 2 --out runs/generate-unseen
node --no-warnings src/game/map/generate/bench.ts --format verbose --effort low --no-pictures --out runs/generate-verbose-low   # the old plan
node --no-warnings src/game/map/generate/bench.ts --text "a tannery by the river" --runs 1 --out runs/generate-try

# Recompile the saved plans and draw them again, after a change to the compiler. No model calls.
node --no-warnings src/game/map/generate/bench.ts --redraw --out runs/generate

# Tests: hand-written plans, real plans from the model (both formats), streaming, the cast, composition, light, the repair loop, install.
node --test --no-warnings src/game/map/generate/*.test.ts
```

```ts
const { ok, place, problems, shellMs, looks } = await generatePlace("a chandler's shop on the wharves, cluttered with rope and lamp oil", {
  id: "chandler", sceneId: "chandler", cast: scene.cast.map(castMember),
  onShell: (shell, ms) => { /* the building, laid out from its rooms, while the things are still being written */ },
});
installPlace(place!, { present: ["kell"], time: "evening" });  // now getMap, regionForScene, sceneStart and renderExplore all know it, and its people their letters
```

## How it works

1. **The plan** (`plan.ts`, `compact.ts`). One streamed `respondJson` call: the default model, Luna, with reasoning `none` and a strict schema. Each section is a list of entries, and each entry is a list of fields:
   - `place`: the name, what it's like, its size in feet, storeys, walls, floor and surroundings;
   - `outside`: the street, quay, river or boat, each by side, depth and ground, nearest first;
   - `rooms`: one is `main`, and each of the others goes on a side or in a corner, with a size;
   - `doors`: from a room to a room or an outside area, with its wall and state;
   - `windows`;
   - `things`: an id, a name, kind, size and material, the area it's in, and where it is ("against north", "corner north-east", "near bar", "between bar front-door", "on bar", "overhead"); then, only if it has them, a length, tags, states and a description;
   - `people`: placed the same way, using the scene's cast ids;
   - the area the player starts in.

   The model never gives coordinates. A repair round sends the same conversation back, with the plan as the compiler understood it and the problems. The old one-object-per-entry plan is still there: `modelPlanner({ format: "verbose" })`.
2. **Cleaning** (`normalize.ts`):
   - Ids are made safe and unique, the cast's first. A reference by name is matched; on a tie, what a thing is (its head noun) wins: "the bar" is the skiff-hull bar, not the shelf behind the bar.
   - There's exactly one main room, and a plan with no rooms is one room.
   - Doors must join a room to something. A door between two outside areas becomes a way round the building.
   - Near misses are read as what they mean: boards-over-water is planks-over-water, wood is timber, "earth-bank, water" is earth-bank.
   - Something on, in, under or behind a door stands by it.
   - The cast the plan left out are placed by relation.

   Whatever had to be guessed becomes a problem: an error for the repair round, or a warning when the guess is good enough.
3. **Facing the camera** (`orient.ts`). The viewer stands to the south-west. One of the eight turns and mirror images puts the way in in front, and the water then goes round to the other front side if it's behind. Problems are told back in the model's own compass.
4. **Layout** (`layout.ts`):
   - The footprint, grown for the rooms and for the dozen or so things a plan puts on the floor.
   - The rooms by side and corner.
   - The main room's five squares each way, checked after carving.
   - Walls and partitions, doors and windows.
   - Outside strips along the frontage, the ways round, and boats with a gangplank.
   - The seed's choices.

   `compileShell` lays a building out from the structure alone, so a streaming plan has its building before its things arrive. In the last batch it was the building that got furnished in 14 of 19 first-try runs; the other five grew to make room for more things.
5. **Furnishing** (`furnish.ts`). Things are placed by relation under hard rules:
   - one thing to a square;
   - the squares either side of a door are kept clear;
   - nothing blocks off a pocket of floor or walls in a thing;
   - every thing keeps a free square beside it;
   - nothing's own cell is painted by anything else.

   Long fixtures are runs of low wall (the Rat's skiff-hull bar), huge things take three squares as the map spreads them, and crowds go where the game's crowd spread will put them. A square the camera can't see scores very badly. Lanterns go up last.
6. **Output** (`compile.ts`, `install.ts`, `dressing.ts`, `people.ts`):
   - a `TileMap`;
   - a `WorldSpec` lined up with it (the world's (0, 0) feet is tile (0, 0), at 5 ft a square);
   - the scene's region and one per area;
   - a dressing for the look layer's top-down stage;
   - letters and colours for people outside the cast table.
7. **Looks** (`looks.ts`). The names the look layer only has a guess for are asked about in one call (`inventNow`), started while the plan is still streaming, and the result is cached on disk as the look layer always caches.
8. **Checks and repair** (`validate.ts`, `camera.ts`, `generate.ts`). The world is built and drawn by the game's own code. A place passes when there are no errors:

| check | an error when |
|---|---|
| reach | a room, or an outside area with something in it, can't be walked to from the street |
| access | a thing has no square beside it that can be walked to |
| overlap | two things share a square; something stands in a wall, the water or a doorway; or something is drawn over someone else's cell |
| door | a door isn't in a straight wall between two floors, or doesn't join what the plan said |
| relation | the plan's relation doesn't hold. "Near" means within 2 squares, or as near as the thing's own area comes; a wrong wall is only a warning. |
| hidden | in the scene view (roofs off, the rooms people are in opened up), taking the thing away doesn't change the picture. Each thing is checked from its own room, and people also from the scene's opening view. |
| world | the world's feet don't land on the square a thing was put on |
| plan, fit | the cleaner had to guess something it can't stand by, or there was no room for something |

Errors go back to the model at most twice, and the best round is kept. Compiling and checking take a median 30 ms a round (84 ms at most). That's up from the spike's 13 ms, because the render diff draws each view once per batch.

## Measurements

All of these runs were made on 14 October 2026 with the default model, `openai/gpt-6-luna`, and reasoning `none`, using the compact, streamed plan. Each run directory had its own look cache, so the first places paid for the looks. The Rat and the Heron were generated from their scenes' setting paragraphs and casts (`scenes/drowned-rat.ts`, `scenes/heron-warehouse.ts`). Times include the model calls, the look calls that didn't overlap them, and the compile-and-check. Pictures are not included.

**The last run of the four places** (`runs/generate`, at 7c958c3, on today's mainline):

| place | passed | first try | mean repairs | median time (s) | max time (s) | building laid out at, median (s) | mean cost ($) | look calls |
|---|---|---|---|---|---|---|---|---|
| the Drowned Rat (setting text and cast) | 5/5 | 5/5 | 0.0 | 8.7 | 9.7 | 2.8 | 0.0005 | 4 |
| the Heron (setting text and cast) | 4/5 | 4/5 | 0.4 | 10.3 | 24.8 | 3.6 | 0.0008 | 0 |
| a chandler's shop on the wharves | 5/5 | 5/5 | 0.0 | 5.2 | 6.9 | 2.2 | 0.0003 | 1 |
| a small chapel off the market square | 5/5 | 5/5 | 0.0 | 4.8 | 6.4 | 2.2 | 0.0002 | 1 |
| all | 19/20 | 19/20 | 0.1 | 7.5 (p90 10.3) | 24.8 | 2.6 | 0.0005 | 6 |

The Heron that failed had one large thing aboard a barge with a deck one square wide, and the model's two repairs didn't help. This was fixed afterwards (92f9af5). The median plan was 672 output tokens, and the 20 places cost $0.0092.

**Every run of the four places** (five each, 20 generations a run). Each run found a gap, which was fixed before the next:

| run | code | passed | first try | median / p90 / max time (s) | output tokens (median) | cost ($) | what failed or needed a repair, and the fix |
|---|---|---|---|---|---|---|---|
| 1 | 0229530 | 20/20 | 20/20 | 5.8 / 7.9 / 9.6 | 678 | 0.0084 | nothing |
| 2 | 0274e50 | 19/20 | 19/20 | 6.9 / 10.0 / 24.9 | 643 | 0.0098 | a barge deck too narrow for its cargo (f1cf9fa) |
| 3 | f1cf9fa | 20/20 | 17/20 | 6.4 / 16.7 / 19.8 | 678 | 0.0104 | twice, a barge and no river (the building stood in the water); once, "the city's bells across the water" drawn like the river (db92fea) |
| 4 | db92fea | 20/20 | 20/20 | 6.8 / 8.8 / 9.2 | 647 | 0.0087 | nothing |
| 5 | f7fa564 | 20/20 | 19/20 | 6.1 / 8.4 / 15.9 | 703 | 0.0089 | a brazier with no room beside a door: a real "no room", repaired |
| 6 | 7e49151, after merging today's mainline | 19/20 | 18/20 | 6.3 / 8.0 / 19.4 | 524 | 0.0098 | sacks on the barge "by the river door", and a plan with no rooms (7c958c3) |
| 7 | 7c958c3 | 19/20 | 19/20 | 7.5 / 10.3 / 24.8 | 672 | 0.0092 | a barge deck too narrow for one large thing (92f9af5) |
| **all** | | **137/140** | **132/140** | | | **0.065** | |

**Five unseen places** (two runs each; none had been run before the first of these runs): a cooper's workshop, the harbourmaster's office, a pawnbroker's shop, a herbalist's cottage and the guildhall kitchen. Each run found one gap:

| run | code | passed | first try | median / p90 / max time (s) | output tokens (median) | cost ($) | the repair, and the fix |
|---|---|---|---|---|---|---|---|
| 1 | 0229530 | 10/10 | 9/10 | 5.2 / 6.9 / 7.8 | 513 | 0.0038 | a coat "behind the pier door" (b86f6e7) |
| 2 | db92fea | 10/10 | 9/10 | 5.6 / 6.3 / 8.6 | 461 | 0.0038 | kind, size and material written as three fields (8511460) |
| 3 | f7fa564 | 10/10 | 9/10 | 5.2 / 6.7 / 7.1 | 473 | 0.0039 | a material not on the list ("chalk") as a field of its own (dece984) |

**The old plan, on the same day** (the same compiler, at b86f6e7, four places three times each, no pictures):

| plan | reasoning | passed | first try | median / p90 / max time (s) | output tokens (median) | mean cost ($) |
|---|---|---|---|---|---|---|
| verbose (the spike's) | low (the spike's default) | 12/12 | 12/12 | 21.5 / 38.1 / 38.3 | 2215 | 0.0013 |
| verbose | none | 12/12 | 12/12 | 19.1 / 24.9 / 29.6 | 1592 | 0.0009 |
| compact, streamed (run 1) | none | 20/20 | 20/20 | 5.8 / 7.9 / 9.6 | 678 | 0.0004 |

- **The terse plan is about 3.3 times faster than the old one with reasoning none**, or 3.7 times faster than with low. That's more than its token count alone would give (2.3 times fewer tokens). On this day the old plan was slower than in the spike's measurement (19.1 s against 12.8 s with reasoning none), so the same-day comparison is the fair one.
- **The look layer's calls are small.** Each run started with an empty look cache and made 5 to 8 calls for its 20 places, 1.2 to 2.3 s each and about $0.0001 each.
- **Everything measured today**, including the development batches, the seven runs, the unseen runs and the baselines, cost $0.13.
- **The plans keep the text, and the cast.** In the last run's ten plans:
  - Every Rat has its fire in a corner, the skiff bar, the rat in the gin, the eel traps and oars, the rules board, the champion's chair (twice called "the Rat's only armchair") and the card table. Its cast are in their places: Nan behind the bar, Dilly by the fire, Arlo by the door, Hobb in the corner.
  - Every Heron has the land door with Saul's sentry box and brazier and Duchess, the plank walk and river door, the barge, both kinds of sack, the hoist, the counting-box with Scrope and the true book, and Hep at the work.

  This is presence only, checked with a keyword list against the plans: nothing compares the plan with the text automatically.

## Pictures

`bench.ts` writes these to `runs/generate/`, which isn't committed. For each place (`<place>-<n>`):

- `-scene-day.png` and `-scene-night.png`: the scene view, roof off, as a scene draws it;
- `-outside-day.png`: from the street, roofs on;
- `-stage-night.png`: the look layer's top-down stage.

The hand-made Rat and Heron are drawn the same way (`handmade-*`). The contact sheets are `sheet-<place>-night.png` and `sheet-<place>-day.png`, each with both hand-made places alongside the runs. People are drawn as letters (KM_GLYPHS=ascii), because `tools/preview.py` has no Kingmaker Glyphs sprites.

What they show:

- **The Rats** are burrows in a turf bank:
  - timber walls inside the bank, in most runs the quay up behind, and the way down to the landing, the steps and the river in front;
  - the fire in its corner, burning blue where the plan calls it blue (two of five in the last run) and lighting its corner that colour, with lanterns warming the rest of the long room;
  - the cast in their letters and colours, as in the hand-made Rat.
  
  They are bigger than the hand-made one, which is 10 by 6 inside, and the bank shows mostly behind them.
- **The Herons** look like the hand-made one:
  - a tall tarred warehouse lit by lanterns, its sacks, the hoist and the counting-box with Scrope;
  - the river, the plank walk and the barge in front on one side, and the wharf in front on the other, with Saul, his brazier and sentry box, Duchess, and Sallow at the land door.
- **The chandlers** are warm, cluttered timber shops on a quay over the harbour.
- **The chapels** are small stone rooms with an altar, a statue, a bell rope and candles, among the neighbours' roofs. They're all much alike.
- **The unseen places** read as what they are: a cooper's barrels and shavings, the harbourmaster's charts and telescope on the pier, a brick pawnshop in a lane among timber neighbours, a herbalist's cottage on the marsh, and a kitchen with three ovens drawn as warm domes.

I looked at all of these at full size by night and by day, and fixed what looked wrong while it could still be fixed:

- the fire's glow on the bank's turf;
- partitions of pale civic stone;
- one-tile slivers of neighbouring walls, and plaster's salmon roofs outshining a brick shop;
- three-row walls swallowing small chapels;
- lanterns hung against walls, and kitchens left dark;
- a shop sized for twice its things;
- a burrow whose bank was a one-square kerb.

## What doesn't work (yet)

- **Passing isn't the same as good.**
  - The checks compare the map with the plan and with the game's rules. They don't compare the plan with the text, and nothing judges how a place looks except someone looking at it.
  - Yards, camps and squares with no building still can't be expressed: a plan is always a building with outside strips round it.
  - There are no upper floors (a stair up is a thing), and there's one building per place.
- **About one generation in twenty still needs a repair, or fails.** Every run so far found a new rare gap, such as a narrow barge or a field the model wrote in its own way. Each was fixed, but the next run may find another.
  - With the code as committed, 155 of the 156 first plans in this version's runs pass. The one that doesn't is a Rat with Dilly's barge moored by the stairs, where the layout puts the shelf in front of the bar rather than behind it. That's what a repair round is for.
  - A failure after two repairs takes up to 25 s.
- **The building laid out early isn't always the one furnished.** It's sized for about a dozen things on the floor, and plans with more (a Heron has around 20) grow when their things arrive: 5 of 19 in the last run. That's still faster than waiting for the whole plan, but a game that drew the early building would see it grow.
- **Places are bigger than the hand-made ones.** The main room's five squares each way and the sizing for a dozen things make a generated Rat or chapel larger than its hand-made equal. Chapels in particular all come out alike: one or two rooms in a square, with their variety only in the doors. The seed's L-shapes need a building 11 squares across, and side rooms only vary where the plan has them.
- **Night is better, not solved.**
  - Lanterns go only into big rooms where the scene is, never into a storeroom nobody's in.
  - Lit windows spill light onto the ground outside them, as render.ts means them to. Windows never look into a bank, though.
  - A rising ember from a fire can light a single cell of turf. That's the renderer's embers (render.ts), not the place.
- **People outside the cast table are put into it** while their place is installed (`registerPeople`). That's global state. Two installed places that both have someone with the same id share the later one's look until it's uninstalled.
- **The look layer's model answers aren't reviewed**, as before: a bad look stays cached until the cache is edited.
- **Install still only half connects a place.** `installPlace` makes the game able to play a scene in the place, but a way in from the town (a lead marker, a door on Caerwyn's map) is the caller's job, and this work deliberately didn't wire places into the town.
- **The furnisher copies render.ts's rule for how high things are drawn.** It changed once while this work was in progress, and the furnisher was updated. The checks ask the renderer itself, so they keep being right if it changes again, but until the copy is updated the furnisher would place things the checks then reject.

## The files

| file | what it does |
|---|---|
| `plan.ts` | The semantic plan: types, the verbose schema and prompt, the cast (`castMember`, `castBrief`), and `modelPlanner` (compact and streamed by default, reasoning none). |
| `compact.ts` | The terse plan: its schema and prompt, reading it (fields by what they look like), writing it (for repairs), and `partialPlan` (what has arrived of a streaming plan). |
| `normalize.ts` | Cleans a model's plan: ids (the cast's first), references, one main room, doors, near misses, the cast it left out. It also defines `Problem`. |
| `orient.ts` | Turns the plan to face the camera, puts the water in front, and says problems back in the plan's compass. |
| `layout.ts` | The footprint, the rooms by side and corner, walls, partitions, doors, windows, the outside strips, the ways round, boats, and the seed's variety. |
| `furnish.ts` | Things and people placed by relation, with collision, access, pocket, door-apron, screen-cell and visibility rules, and lanterns for dark rooms. |
| `compile.ts` | Plan in, `TileMap` + `WorldSpec` + regions + people's looks out; `compileShell` for a plan's structure alone. |
| `camera.ts` | The render-diff camera (`sceneCamera`), and where render.ts draws an actor (`liftOf`, `rowsOf`). |
| `validate.ts` | The checks. |
| `generate.ts` | The pipeline: a streamed plan, the building, the looks, compile, check, repair (twice at most), keep the best. |
| `looks.ts` | The look layer's model call for the names it doesn't know, counted in the generation. |
| `people.ts` | Letters and colours for people outside the cast table, and putting them into it. |
| `install.ts` | Puts a generated place into play, and takes it out again. |
| `dressing.ts` | The look layer's dressing for a generated place, and a top-down stage picture. |
| `pictures.ts` | Scene and outside views through render.ts, and PNGs via `tools/preview.py`. |
| `sketch.ts` | A plain top-down grid, for tests and logs. |
| `bench.ts` | The measurement: runs, rounds, time to the building, looks, cost, pictures, contact sheets, summaries. |
| `fixtures.ts`, `model-plans.json`, `model-compact-plans.json` | Hand-written plans (a tavern, a warehouse with a barge, a muddle), nine first-round plans from the spike in the old format, and nine raw first-round compact plans from this version's final runs. |
| `generate.test.ts` | The tests. |

The look layer's part of this work is in `src/game/look`:

- `roles.ts`: the oven, the pit, and words added to existing rules;
- `names.ts`: piles, trailing clauses, and the pool;
- `appearance.ts`: proper names;
- `invent.ts`: `inventNow`, which invents looks at once and says what they cost.
