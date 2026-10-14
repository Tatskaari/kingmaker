# src/game/map/generate: places from a description

Can the game's fast model make a place like the hand-made Rat or Heron mid-story ("a chandler's shop on the wharves")? **Yes, at runtime**, if the model never draws the map. It writes a semantic plan, and a deterministic compiler lays the plan out. On the four places measured, 20 of 20 passed every check (19 on the first try). A place took a median 19 s, almost all of it the one model call, and cost about a tenth of a cent. Ten places the compiler had never seen passed 10 of 10 on the first try.

The catch is the wait: a median of 14 to 25 s depending on the place, and 30 s at worst with a repair. That's fine if the place is generated when the GM first mentions it, ahead of the player getting there. It's too slow to block a turn on. "Passed" means the map is sound and does what the plan says. It doesn't mean the place is as good as a hand-made one (see [What doesn't work](#what-doesnt-work-yet)).

## Run it

```sh
# Measure: each place 5 times, with every round's plan and problems kept, and pictures by day and night
# beside the hand-made Rat and Heron. It costs about $0.03.
node --no-warnings src/game/map/generate/bench.ts --runs 5 --out runs/generate
node --no-warnings src/game/map/generate/bench.ts --only tannery,watch,bathhouse,stables,bakery --runs 2 --out runs/generate-unseen
node --no-warnings src/game/map/generate/bench.ts --effort none --no-pictures --out runs/generate-none
node --no-warnings src/game/map/generate/bench.ts --text "a tannery by the river" --runs 1 --out runs/generate-try

# Recompile the saved plans and draw them again, after a change to the compiler. No model calls.
node --no-warnings src/game/map/generate/bench.ts --redraw --out runs/generate

# Tests: hand-written plans, nine real plans from the model (model-plans.json), the repair loop, install.
node --test --no-warnings src/game/map/generate/*.test.ts
```

```ts
const { ok, place, problems } = await generatePlace("a chandler's shop on the wharves, cluttered with rope and lamp oil", { id: "chandler", sceneId: "chandler" });
installPlace(place!, { present: ["kell"], time: "evening" });  // now getMap, regionForScene, sceneStart and renderExplore all know it
```

## How it works

**1. The plan (`plan.ts`).** One `respondJson` call (the default model, Luna, with reasoning `low`) asks for a strict JSON schema. The plan contains:

- the building's footprint in feet, its storeys, and what its walls and floor are;
- its rooms, each with a size and a side or corner ("the scullery, north-east, 15 by 15"), with one main room that takes what the others leave;
- the outside, side by side: the street, a quay, a walk on piles, the river, a boat in it;
- doors that join two named things, with a wall;
- windows by room and wall;
- 6 to 20 things, placed by relation (against a wall, in a corner, near, beside, behind, between, by a door, on, in, under, overhead), with the scene world's sizes, materials, tags and states;
- the people the text names.

The model never gives coordinates. A repair round sends the same conversation back with the plan as the compiler understood it, plus the problems.

**2. Cleaning (`normalize.ts`).** The model's plans get cleaned up before layout:

- Ids are made safe and unique, and a reference by name ("the shop") is matched to its id.
- There's exactly one main room.
- Doors must join a room to something, and relations must have what they need.
- A thing tagged "door" loses the tag (the plan's doors are the doors), and a dead rat "in" a jar becomes an item.

Whatever the cleaner had to guess becomes a problem for the repair round. The plan still compiles, so there's always a map.

**3. Facing the camera (`orient.ts`).** The viewer stands to the south-west, so the south and west sides of a building are its front. The compiler picks one of the eight turns and mirror images that puts the street door (and as much of the outside as possible) in front, then relabels every direction in the plan. Problems are told back in the model's own compass.

**4. Layout (`layout.ts`).** This is a small, plan-driven BSP:

- **The footprint.** If the model's footprint is too small for its rooms and things at 5 ft a square, the building grows (up to 1.5 times each way, and deep enough for a 3-square main room). 18 of the 20 measured places were grown.
- **The rooms.** Each room is a rectangle anchored to its side or corner. A room on a side goes into that side's back corner first, which leaves the main room an L rather than a U. It's stretched to close a one-square gap, and shrunk if it doesn't fit.
- **The walls.** Outer walls are 3 rows high (4 for three storeys, 2 for a burrow in a bank, the way the town draws them). Walls between rooms are 2 rows, like the Heron's counting-box. From above, a full-height partition would hide the two squares behind it.
- **Doors and windows.** Doors go in the middle of the wall the two sides share. Windows are spaced along outer walls.
- **The outside.** Strips go round the building, nearest first. Water has its shallows by the bank. A boat gets a hull rail and a gangplank, out of the building's shadow if it's behind.

**5. Furnishing (`furnish.ts`).** Things are placed by relation, with hard rules:

- one thing to a square;
- door aprons (the squares either side of a door) kept clear;
- nothing that blocks may cut off a pocket of floor or wall in something placed earlier;
- every thing keeps a free square beside it;
- one actor to a screen cell (render.ts draws column x + y, row y − x − lift, so a lantern hung 2 rows up lands on the cell of the square behind it).

Some fixtures are built as terrain:

- **Long fixtures** (a bar, a counter, pews) are runs of low wall, like the Rat's skiff-hull bar. A bar stands a square off its wall, with room behind it to serve from.
- **Huge things** take three squares in a row, laid the way `actorsFromWorld` will spread them.
- **Crowds** ("the gang") are placed where the game's own crowd spread will put their members, which the furnisher simulates.

Among the placements that are allowed, the relation decides, along with how much room there is in front of a thing against a wall. A square the camera can't see scores very badly.

**6. Output (`compile.ts`, `install.ts`, `dressing.ts`).** The compiler produces:

- a `TileMap`, which is what `buildMap` makes from a hand-drawn grid;
- a `WorldSpec` lined up with it: the world's (0, 0) feet is tile (0, 0), at 5 ft a square;
- the scene's region, plus a region for each room and outside area;
- a dressing for the look layer's top-down stage, which the hand-made worlds have written by hand.

`installPlace` puts the place into `MAPS`, the reconcile registry and `PLACES`, without editing any of them. After that, the game's own `regionForScene`, `sceneStart`, `enterScene` and `renderExplore` treat it like the Rat.

**7. Checks and repair (`validate.ts`, `generate.ts`).** The world is built and drawn by the game's own code (`buildWorld`, `actorsFromWorld`) and looked at through the game's own renderer (`render.ts`, unchanged). A place passes when there are no errors:

| check | an error when |
|---|---|
| reach | a room, or an outside area with something in it, can't be walked to from the street (doors open, furniture in the way) |
| access | a thing has no square beside it that can be walked to |
| overlap | two things share a square or a screen cell, something stands in a wall, the water or a doorway, or a thing hung up hides another |
| door | a door isn't in a straight wall between two floors, or doesn't join what the plan said |
| relation | the plan's relation doesn't hold: it's nowhere near its wall, its corner, what it's near, beside or behind, or it isn't between its two things. A wrong wall or an off-centre "centre" is only a warning. |
| hidden | in the scene view (roofs off, the rooms people are in opened up, as `renderExplore` draws a scene), a thing isn't drawn on its own cell when the player is in its room. People are also checked from the scene's opening view. |
| world | the world's feet don't land on the square a thing was put on |
| plan, fit | the cleaner had to guess, or there was no room for something |

Errors go back to the model in words it can act on ("the store's back door can't open from the store onto the street: the store doesn't touch the building's south wall, where the street is. Move the room to that side, or the door to a room that's there."), at most twice. The best round is kept.

## Measurements

The default model (`openai/gpt-6-luna`) with reasoning `low`, 5 runs of each place. The Rat and the Heron were generated from their scenes' setting paragraphs only (`scenes/drowned-rat.ts`, `scenes/heron-warehouse.ts`). The times include the model calls and the compile-and-check, which takes a median 13 ms a round. Pictures are not included.

**Final run** (`runs/generate`, with the compiler as committed):

| place | passed | first try | mean repairs | median time (s) | max time (s) | mean cost ($) |
|---|---|---|---|---|---|---|
| the Drowned Rat (setting text) | 5/5 | 4/5 | 0.2 | 16.8 | 30.0 | 0.0012 |
| the Heron (setting text) | 5/5 | 5/5 | 0.0 | 25.3 | 27.8 | 0.0015 |
| a chandler's shop on the wharves | 5/5 | 5/5 | 0.0 | 20.0 | 21.6 | 0.0011 |
| a small chapel off the market square | 5/5 | 5/5 | 0.0 | 14.2 | 15.8 | 0.0008 |

| run | passed | first try | repairs | median / p90 / max time (s) | output tokens per call (median) | mean cost ($) |
|---|---|---|---|---|---|---|
| batch 1, low (before the last two compiler fixes) | 19/20 | 17/20 | 5 | 18.0 / 45.8 / 50.4 | 1946 | 0.0014 |
| final, low | 20/20 | 19/20 | 1 | 18.9 / 27.8 / 30.0 | 2122 | 0.0012 |
| final, reasoning none | 20/20 | 19/20 | 1 | 12.8 / 22.3 / 31.0 | 1641 | 0.0010 |
| unseen places, low (tannery, watch house, bathhouse, stable yard, bakery, 2 each) | 10/10 | 10/10 | 0 | 13.4 / 21.8 / 21.8 | 1405 | 0.0008 |

All of these were measured in October 2026, and the 70 measured generations cost $0.08 in total.

- **The failures were compiler bugs, not model mistakes.** Batch 1 failed on two:
  - the drowned rat was planned as a dead creature in the gin jar, and creatures are drawn wherever they are held (here, on the shelf's low wall);
  - a grille tagged "door" was pulled onto the river door's square.

  An earlier development batch, which isn't in the tables, had found three more: a hung lantern drawn over a crowd, two hung things at different heights on one screen cell, and a blocker walling in a fire. All of them are fixed, and the final run is the same prompts measured again.
- **Repairs now mostly answer genuine "no room" problems.** One example: the card table "near the fire" when the fire's corner was full. The model fixes these in one round.
- **The plans keep the text.** A keyword checklist of what each setting names was all there in all 10 final plans. For the Rat: the skiff bar, the rat in gin, the fire, the champion's chair, the rules board, eel traps, the scullery, the card table, Arlo, Nan, the big man, the stairs and the river. For the Heron: both doors, the sentry box, the brazier, Duchess, the plank walk, the hoist, the barge, both kinds of sack, the chute, the heap of empties, the sign, the counting-box, the true book, Scrope and the gang. Every Rat puts its fire in a corner, as the text does. This is presence only: nothing checks the plan against the text automatically.
- **Reasoning `none` is a third faster and passed as often.** Its plans are shorter (1641 tokens against 2122). The pipeline defaults to `low`; `none` looks like the better choice for runtime.
- **The hand-made places wouldn't all pass these checks either** (`sceneCamera` on them):
  - the Rat stacks Manners under Nan, and the gin jar on the keg's square;
  - the granary yard's loft is out of sight from the yard until you walk in;
  - the Heron and the King's room are clean.

## Pictures

The bench writes these files to `runs/generate/`, which isn't committed. Each place `<place>-<n>` gets:

- `-scene-day.png` and `-scene-night.png`: the scene view, with the roof off, as a scene draws it;
- `-outside-day.png`: from the street, roofs on;
- `-stage-night.png`: the look layer's top-down stage, from the generated dressing.

The hand-made Rat and Heron are drawn the same way, as `handmade-rat-*` and `handmade-heron-*`. The contact sheets are `sheet-rat.png`, `sheet-heron.png`, `sheet-chandler-chapel.png`, `sheet-outside.png` and `sheet-stage.png` (made with `tools/sheet.py`). The unseen places are in `runs/generate-unseen/sheet-unseen.png`.

What the pictures show:

- **The Rats** look like the hand-made one in every view: a burrow in a grassy bank with a turf roof, a fire-lit corner, steps down to the river in front.
- **The Herons** look like the hand-made one too (tar walls, a lantern-lit floor, sacks, braziers, the barge and the sentry box). They are smaller, and the river is behind the building rather than in front (see below).
- **The chandlers** at night are warm and cluttered, with boats moored alongside.
- **The chapels** read as stone, but they're small, so their striped civic walls fill most of the picture.

## What doesn't work (yet)

- **Passing isn't the same as good.**
  - The checks compare the map with the plan and with the game's rules. They don't compare the plan with the text, and nothing judges how the place looks.
  - "The stable yard behind a coaching inn" came out as a roofed building, because a plan is always a building with outside strips round it. Yards, squares, camps and gardens with no building aren't expressible yet.
  - There are no upper floors either: a stair up is a thing.
  - Rooms are rectangles carved out of a rectangle, and there's one building per place.
- **The models plan small.** They give 30 to 40 ft for a tavern, which is 6 to 8 squares. The compiler grows buildings, but rooms stay cramped (a 3-row taproom when the scullery spans the back), and a small chapel is mostly wall in the iso view.
- **The Heron's river is behind it.** Every Heron plan put the wharf and the river on opposite sides, which is a fair reading of "half on the wharf and half on piles". One of them has to be behind the building:
  - the barge is drawn out of the building's shadow, so it's seen;
  - the plank walk right behind the wall is hidden, and so is anyone on it.
  - The furnisher keeps things out of that shadow and the checks report anything left in it. The real fix is the occlusion work in `render.ts`: buildings going semi-transparent, and whoever's behind them drawn greyer.
- **Rooms nobody is in stay shut in the scene view.** `render.ts` opens the room you're in and the rooms people are in, so the things in an empty back room are hidden behind its walls until you walk in. The check looks at each room from inside it, and at people from the scene's opening view. The hand-made granary loft behaves the same way.
- **Night is as dark as the plan.** The Rat's text lights it only by the fire, so the far end of a generated taproom (bigger than the hand-made one) is dark at night. Nothing adds lamps.
- **The checks are lenient on purpose.** "Near" means within 2 squares, "behind" means not in front, and a wrong wall or an off-centre "centre" is only a warning. Doors always go in the middle of a shared wall, which sometimes leaves no room for a long bar.
- **Latency is the cost.** About 70% of a plan is structural JSON (`"wall": "none", "target": ""` on every thing) and 30% prose. A terser plan format, or reasoning `none`, would roughly halve the wait. Streaming the plan and compiling the rooms before the things arrive would hide more of it. None of these has been built.
- **Install only half connects it.** `installPlace` makes the game able to play a scene in the place. It doesn't add a way in from the town: a lead marker, a door on Caerwyn's map and an exit target are the caller's job.
- **The top-down stage view** imports the look layer's `renderStage`, which other work is changing. It lives in `dressing.ts` alone, so it's easy to drop if that API moves.

## The files

| file | what it does |
|---|---|
| `plan.ts` | The semantic plan: types, the strict JSON schema, the prompt, and `modelPlanner` (first plan and repairs). |
| `normalize.ts` | Cleans a model's plan: ids, references, one main room, door and relation sanity. It also defines `Problem`. |
| `orient.ts` | Turns the plan to face the camera, and says problems back in the plan's compass. |
| `layout.ts` | The footprint, the rooms by side and corner, walls, doors, windows, outside strips and boats. |
| `furnish.ts` | Things and people placed by relation, with collision, access, pocket, door-apron, screen-cell and visibility rules. |
| `compile.ts` | Plan in, `TileMap` + `WorldSpec` + regions out. |
| `validate.ts` | The checks, and `sceneCamera` (the default camera, through render.ts). |
| `generate.ts` | The pipeline: plan, compile, check, repair (twice at most), keep the best. |
| `install.ts` | Puts a generated place into play (and takes it out again). |
| `dressing.ts` | The look layer's dressing for a generated place, and a top-down stage picture. |
| `pictures.ts` | Scene and outside views through render.ts, and PNGs via `tools/preview.py`. |
| `sketch.ts` | A plain top-down grid, for tests and logs. |
| `bench.ts` | The measurement: runs, rounds, time, cost, pictures, summaries. |
| `fixtures.ts`, `model-plans.json` | Hand-written plans (a tavern, a warehouse with a barge, a muddle), and nine real first-round plans from the model. |
| `generate.test.ts` | The tests. |
