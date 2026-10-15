# src/app: the playable game

The OpenTUI React terminal app that runs the whole story (docs/design/playable.md): make a character, walk Caerwyn on the isometric map, play the GM-run scenes, fight at the Heron on the map, report to the King, The End.

```sh
npm run game        # node --experimental-ffi --no-warnings --import tsx src/app/main.tsx
```

It needs a real terminal and `OPENROUTER_API_KEY` (or `~/secrets/kingmaker-dev-openrouter.txt`). The world is lit in 24-bit colour: where `COLORTERM` isn't set (macOS Terminal, and ssh doesn't pass it on), OpenTUI falls back to 256 colours and the lamplight goes grey, so set `COLORTERM=truecolor` if the terminal can take it. Saves go under `runs/sessions/<id>/`, and `KM_RUNS_DIR` moves them:

- `game.json`: the game core's save, with the mode, the story, the map (where the player stands, what scenes did to their places) and the fight.
- `state.json`: the runtime's session.
- `app.json`: the app's notebook and messages.

## Playing

The game is mostly played with the mouse. On the map, click somewhere to walk there, a step at a time, round whatever's in the way (through it, if it's a door; as near as you can get, if you can't); any key or click stops you. Right-click someone or something for what you can do with them: talk, look, go through, step in, walk over. The sidebar's Nearby list works the same way, and the tile under the pointer lights up while the bottom line says what's there. In a scene, the place on the right works the same way: point at someone or something in it (or in the list under it) and it lights up while the line under the conversation says what it is; click someone to talk to them, or something to look at it; right-click for what you can do with it. In a fight, click a blue tile to move there, click someone on the other side to aim at them, and click the one you're aiming at to attack. Everywhere, the key hints at the bottom (and a fight's options) are buttons, and the title's and the End's choices take a click. Every key still works.

| where | keys |
|---|---|
| title | ↑↓ and Enter; Continue resumes the latest game (or click one); x deletes the game picked out (x again to be sure: its folder goes to runs/deleted/) |
| character | Tab between name and concept; Enter; on the sheet, r makes them again (or click the buttons) |
| the sheet | ←→, Tab or 1–9 turn its pages (or click a tab); ↑↓, PgUp/PgDn or the wheel scroll a long page; Esc, or a click outside it, puts it away |
| explore | arrows or WASD walk (they move with the screen: up is up; the map's north is up-left); e or Enter interact; g walk to the lead (any key stops); c sheet; j notebook; ? help; Esc menu |
| scene | type and press Enter: plain words are said, `*asterisks*` or `(brackets)` are done; 1–9 (or a click) chooses one of the core's choices, when there are any (a talk's lines, its goodbye, walking on); `/sheet` `/map` `/journal` `/help` (any time, even with the GM mid-sentence) `/save` `/quit` (typed, or clicked at the bottom; the old `#sheet` still works); PgUp/PgDn or the wheel scroll; a scene that's over waits for an Enter of its own or a click; Tab (or ↑↓ with nothing typed) goes through what's in the place, Enter (with nothing typed) opens its menu (↑↓ and Enter or its number, → and ← in and out of what to give or which spell, Esc never mind, anything typed goes in the box), Esc lets go of it; Esc menu |
| between scenes | Enter (or a click) hurries Kell along, then goes on to the map; Esc menu |
| combat | arrows move 5 ft; Tab or 1–9 pick a target; a attack; z close in; c cast (Enter at the target, t on yourself); u knock over a lantern or brazier; d dash; g dodge; x disengage; f let the dice decide; m every option; e end turn; s sheet; when it's over, Enter (or a click) |
| the end | Enter (or a click) back to the title; q quit |
| anywhere | Ctrl+C saves and quits |

A way on (a scene that's over, the moment between scenes) takes an Enter of its own, or a click. Typed characters never go on, and the Enter that ends a line typed at it only ends that line ("that went unsaid"; `wayOnKey` in `ui/common.tsx`, `typing` in `game.ts`): a line being typed as a scene ends doesn't carry the player past its last word, through Kell and onto the map, where the rest of it would walk.

For testing, in a scene, `/exits` lists the endings and `/end <id>` takes one now.

### A scene, on screen

- Each exchange is a turn in its own box: the player's line under their name, with a bar down its side, then everything that answered it. The latest turn is the brightest.
- The rules' lines keep the dice (🎲) when there's a roll in them. The rest are news, marked ⓘ in their own colour: what you carry ("You no longer have your javelin"), what's burning, what you are now (`isRoll` in `game.ts` tells them apart).
- When a scene ends, its last reply stays up, and the box becomes the way on: an Enter of its own, or a click. Into a fight, to the next scene (a summons), to The End, or to whoever walks with the player: Kell reads the notebook's new entry back, says how the time went (the story's own lead, when the hand-off wrote one) and where the story goes next, and then it's the map. Where next is the core's lead in the map's own words (`leadWay` in `story.ts`), drawn in her notebook's margin: the sidebar says the same, arrow and paces. With nobody walking with you, it's the card.
- The core can offer choices in scene mode: a talk's lines to say and its goodbye (kind `say`: the label is the line), and walking on. They're listed over the box, to click or pick with 1–9; a short screen lists fewer lines, never fewer ways out. A line goes through as if typed; walking on is straight back to the map.
- The box submits what it holds as Enter comes, not the draft of the render before: letters and their Enter in one read (a paste, a fast typist, the browser's terminal) arrive whole.
- The conversation's scrollbar is laid over a column kept for it (`SCROLLBAR` in `ui/common.tsx`). A scrollbar that takes its own room narrows the text when it first appears, and OpenTUI doesn't re-wrap text already laid out: each line lost its last character under it.
- A click on the conversation leaves the box with the keys (its scrollbox isn't focusable): OpenTUI gives a left click's focus to what's under it, and the next words typed went nowhere.

### The scene's place

On the right is the scene's place, drawn from above (`stageView`), and under it who's there and what's spilled (a narrow panel at 80 columns, where the place is small and the box's own hint stands in for "How to talk"). It's played like the map:

- **Pointing.** Point at someone or something in the place, or at a line of the list, and it lights up (every cell drawn for it, as the map lights a tile) while the line under the conversation says what it is: the name (or what they're called, until the player has heard it: "the boy in the too-big boots"), what they're doing or how it is (the world's notes and states: burning, open, asleep), who has it or what it's in, on or hanging from, and what a click does. The floor says what it is ("The yard · cobbles, and a puddle"); a wall the dressing draws is the world's wall ("the yard wall"), the river the river. The stage records what it drew where, as the map does (`StagePicks` in `src/game/look/stage.ts`: whose each cell is, what's under them there, and the floor), so pointing agrees with drawing.
- **A click** does the most natural thing: talk to someone (their name starts your line in the box, "Cob, ", before whatever you'd typed; another's name takes its place), look at something.
- **A right-click** (or Enter, with nothing typed, on what Tab picked out) opens a menu of what you can do with it, in the map menu's style and inside the panel: it never covers the conversation's words. What it offers is `src/game/scene-menu.ts` (`thingActions`), and only what fits:
  - someone: talk to them, look, give them something you carry (which), go over (if they're not beside you), attack them, cast one of your spells at them (which: only the ones the rules have ready, and only those that reach someone else, so no Shield);
  - you: look at yourself (what you carry, how you are), cast on yourself (nothing that harms or goes out from you);
  - a thing: look, take it (if it's small and loose: not fixed, chained, burning, hanging, a body or furniture; from whoever or whatever has it), what it's for (open or try a door, close it, look inside a container, light or put out a lamp, put out what's burning, go through a passage, get down what hangs, cut a rope with something on it, read a book or a sign, examine evidence or a body closely), give it to someone or put it down if it's yours, go over to it, attack it (if it can break), cast at it what works on things;
  - a spill (oil, a puddle, smoke): look, put it out if it's burning, go over, cast at it;
  - the floor: look, and go over there if it's another part of the place (or by something, in yours).
  - Whatever else is drawn in the same cell comes last, with its own menu: the hoist rope and the beam, under Prout.
- **Looking** is instant and isn't a turn: what the world knows of it (its description, states and notes, who has it), a quiet note in the conversation (◉), which the GM never hears.
- **Deeds** go as your turn, as if you'd typed them, in brackets: "(I pick up Prout's satchel)", "(I give the boy in the too-big boots one of my pennies)", "(I try to open the loft door)", "(I cast Fire Bolt at the hoist rope)", "(I cast Cure Wounds on Sergeant Agnes Kell)". The director, the rules and the GM take them as they take typed ones. While the GM has the floor, only looking and starting a line are offered; once the scene is over, only looking.
- **The box keeps its keys.** Tab, which it has no use for, goes through what's in the place (the people first, nearest first, then things, then what the place is built of); ↑↓ and Enter do only while nothing's typed; Esc lets go of what Tab picked out before it opens the game's menu. With the menu open, anything typed (a letter, a space, Backspace) puts it away and goes in the box.

## How it fits together

The app is a view over the game core, `src/game/play.ts`, the same one the headless QA console (`npm run qa`) plays. The core owns the story flow:

- exploring, scenes, fights and The End;
- chaining scenes and skipping interludes (walking the map stands in for them);
- a fight's end, then its aftermath back in its scene;
- the King's summons.

Exploration and fights plug into the core, and the app uses the real modules:

- **`src/game/town.ts`:** the map module's exploration (src/game/map) as the core's Explorer. Its state is the map's `ExploreState`, kept in the game.
- **`src/game/fights.ts`:** tactical combat (src/game/combat) on the scene's own place, with everyone where the scene's world has them.
- **`src/game/views.ts`:** every picture the game draws (the town, a scene's place on the map and from above, a fight), through the look layer (src/game/look): things by the rules, living ground, coloured light, effects. The screens draw them as live canvases, about twelve frames a second.

`game.ts` is the app's controller, and the screens in `ui/` subscribe to it. It adds what a terminal needs:

- the GM's reply streaming in;
- a scene that's over staying up until the player goes on, then the moment between scenes (Kell telling the news, or the card) and the notebook (the exit scripts' journal lines);
- the look of each scene and fight: one set of effects and a director, so spells, fires, damage numbers and barks show in the world as they land;
- overlays: the sheet, help, the scene's place on the map (/map), the spell picker, a fight's every option;
- the character sheet: the rules engine's sheet as data (`sheetData` in src/rules/dnd.ts), laid out for the screen by `ui/sheet-layout.ts` (a page at a time on a small screen, all of it in columns on a big one), with a portrait for each class (`ui/portraits.ts`), shown by `ui/sheet.tsx` after character creation and over the game (c, s, /sheet). In a fight it reads the fight's own campaign, so it's as the fight has left you;
- walking a step at a time, to the lead or wherever you clicked, and the map's right-click menu (what's at a tile: the town explorer's `actionsAt`, picked from what the renderer drew where);
- the scene's right-click menu (what's in its place: `thingActions` in `src/game/scene-menu.ts`, picked from what the stage drew where), its quiet notes of what was looked at, and the deeds it sends as the player's turn (`sceneMenu`, `lookNote`, `deed` in `game.ts`; the menu box is `ui/menu.tsx`);
- the fight's target, picked by a click the same way (the battlefield's `Picks`), and a beat between the other side's turns;
- side panels laid out a row at a time in the rows they have (the map's and the fight's): what's needed first, then what fills the room. A squeezed box draws its lines over each other.

Every action goes through the core by the same action ids the QA console uses (`walk_northeast`, `interact`, `talk_kell`, `attack_crake-1`, `cast_fire-bolt_sallow`, `end_turn`, `continue`). The screens draw from the core's state: the map module's explore state, the scene's world, and the fight's controller.

Talking to someone who walks with the player between scenes (`talk_kell`, e beside Kell, or a right-click on her, on the map or in the Nearby list) opens a talk ([src/runtime/talk.ts](../runtime/talk.ts)): a scene in the core's scene mode, with the story's own scene set aside until it's over. The core's observation offers its dialogue choices as actions: `say_1`… and `say_goodbye` are of kind `say` (the label is the line, and `act(id)` is the same as `say(label)`), and `walk_on` ends the talk without a word. The app lists them all over the box; a line is said as if typed, and walking on acts `walk_on`. When the talk ends the core is back in explore mode where the player was, with the same lead; `talkOf(sceneId)` ([scenes/talk.ts](../../scenes/talk.ts)) tells a talk's scene from a scene of the story, and the app goes straight back to the map from it: no moment between scenes after a talk. A talk that ends on her last word (a goodbye) keeps it up until the player goes on, as a scene does; walking on is back on the map at once. A greeting that never came (offline, or the GM gave up) isn't saved by the core: the talk is still on screen, to walk on from.

## Smoke tests

```sh
python3 src/app/smoke/smoke.py                # the real TUI under a pty, the whole arc offline (about 2 min)
python3 src/app/smoke/smoke.py --live         # real GM turns, quit and resume, /map, a real scene boundary, Kell after it, and a talk with her
python3 src/app/smoke/smoke.py --live-fight   # a live-built wizard through to the Heron, casting from the spell picker
KM_RUNS_DIR=runs/check node --experimental-ffi --no-warnings --import tsx src/app/smoke/scene-check.tsx   # the scene screens at 80 to 160 columns: every character drawn; the keys and clicks on them
KM_RUNS_DIR=runs/check OPENROUTER_API_KEY=offline node --experimental-ffi --no-warnings --import tsx src/app/smoke/screens-check.tsx   # the map and the fight at 80x24 and up, a scene's place at 80x24 and 130x42, the title, the End: side panels whole, the mouse
KM_RUNS_DIR=runs/live-check node --experimental-ffi --no-warnings --import tsx src/app/smoke/scene-menu-live.tsx   # the scene's menu with the real GM: a penny given and a Fire Bolt cast from it, as turns
KM_RUNS_DIR=runs/app-test OPENROUTER_API_KEY=offline node --no-warnings src/app/smoke/flow.ts   # the core with the map and fights, no UI
KM_RUNS_DIR=runs/app-test node --no-warnings src/app/smoke/caster.ts                            # casting in a fight, headless
```

The offline run uses an invalid API key, so the GM can't speak, and it ends scenes with `/end`. It covers:

- character creation (New game by a click), walking, overlays, and g walking to the later leads (across town, through the Rat's door, along the wharves);
- the mouse, as xterm reports it (SGR 1006): pointing at Kell, a click that walks, a right-click menu closed with Esc, and Kell's scene opened from hers; the map's keys at the bottom clicked;
- every scene, its place drawn beside the transcript, the slash commands (and one old `#`, written with its Enter in one go), clicks on the way on, a command and outside an overlay;
- the clerk's yard by mouse: Kell pointed at in the list under the place, right-clicked (her menu), looked at (the quiet note), Esc, a click that starts the line with her name, and Tab picking her out;
- each scene staying up once it's over, typing on as it ends going nowhere (and walking nobody), Kell telling the news between scenes (typing at her going nowhere either) with the way the map's lead gives, and the notebook;
- a talk with Kell between scenes (right-clicked in the Nearby list), its choices listed, walking on by a click, and straight back to the map;
- save, quit and Continue (on the map, by a click, and mid-fight);
- a whole tactical fight on the Heron's floor (a click on a blue tile, on someone to aim at, on the end-turn button, and on the way on), the aftermath, the summons, and The End (and back to the title by a click).

The live run plays a real talk with Kell too: one of her suggested lines clicked, then the goodbye, and back to the map with no card between.

Each step's screen is saved under `runs/app-smoke/<run>/`. `smoke/vt.py` is the small VT screen it reads, and sends the keys and the mouse with.

`rules-repair.ts` is a stop-gap for a rules-layer bug, and the report proposes the real fix. A spell attack logs the spell's id as `weaponInstanceId`, and the engine then refuses to reload the campaign. The app repairs the campaign after each turn and on resume.
