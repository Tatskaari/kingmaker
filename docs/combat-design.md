# A fight on the map

A note for the user to react to (M6): how a fight should play and look, and what changes from the prototype's. The base under it and the screen that plays it are built (§7): the screen is the place to iterate.

## 1. The turn flow

- **Roll for initiative.** A fight starts from a setup: who's in it (statblocks and sides), the map, where everyone stands. The rules engine rolls initiative for everyone, and that order holds, round after round.
- **Your turn:** move up to your speed, a tile at a time, and take one action (attack, cast, dash, dodge, disengage, shove, grab), plus a bonus-action spell if you have one. Leaving someone's reach gives them a swing at you, unless you Disengage. Everything is aimed with the map's own action menu: the act, then the target or the tile. The turn ends when you end it; with nothing at all left (no action, movement or bonus action) it ends by itself and says so.
- **Their turns** are played by the simulation, one turn at a time, each a step of its own, scheduled once the turn before has had time to play on screen. The AI is the prototype's: hired hands gang up on one target, archers keep their distance, cowards run, Kell backs you up. Every move, attack and spell is written as an event, which the screen plays in order.
- **At 0 hit points** you make death saves at the start of your turns: a natural 20 gets you up, three failures and you "very nearly died" (nobody dies in this story's fights). Everyone else is out cold, unless the damage was massive.

## 2. What the screen shows

- **The battlefield:** the place's own map, roofs off, everyone in their letter and colour; the active combatant's tile framed.
- **A turn-order bar** across the top: each fighter's letter, name and hit-point bar in initiative order, the round, the active one lit, anyone down or gone crossed out.
- **Hit points for everyone,** numbers and a bar: BG3 shows them, and the prototype's words for the other side's ("hurt", "badly hurt") made a blow hard to judge.
- **Your options** on your turn, as a short menu (Move, Attack, Cast, Dash, Dodge, Disengage, Shove, Grab, Yield, End turn), what can't be done dimmed with why, and your action, bonus action and feet left.
- **Targets and ranges:** aiming shows the reach ring, the targets in range (the rest dimmed), an area's tiles and the line to the target, red if something's in the way; moving shows the tiles you can reach and which would draw a swing.
- **A caption for each move,** one line under the map in the house style: "The talking Crake steps in and swings: 7 damage." The dice lines go to the log beside it.

## 3. How every NPC move is animated

Each event plays in order, its caption up while it plays:

| Event | On screen |
|---|---|
| A turn begins | The bar moves on, the camera eases to them, their tile pulses |
| A move | Steps along the path, a tile at a time (about a tenth of a second each) |
| A melee attack | A short lunge at the target and back; a flash on a hit, "miss" puffing up on a miss |
| A shot or a spell bolt | The projectile travels to the target in its element's colour |
| An area spell | Its tiles light up, then the blast plays on everyone caught |
| Damage | The number pops up over the target in its damage type's colour; their bar drops |
| A condition | A small tag on the fighter: prone, grappled, dodging |
| A fall | Their letter tips to "x", greys, and stays where they fell |
| An opportunity attack | The move stops, the swing plays, the move goes on: three events |

How long each takes is one table (`shared/fight/pace.ts`), which the simulation also spaces the other side's turns by, so a spectator sees the same pace.

## 4. How a fight ends

Victory when nobody on the other side can fight; they yield when their leader puts their hands up or the hired hands walk off unpaid; defeat when nobody on your side can fight; you yield with Yield; you flee by standing on a way out with 5 ft to spare and leaving. A line or two says how it went (who went down, ran or gave up), and "out" goes back to the map.

## 5. Handing back to the story (later)

The fight ends with a result (the outcome, a summary, everyone's fate and where they stood), which a scene's aftermath picks up from as it does from the stand-in today. The Heron's fight and the town's brawls become setups built from their places (the people where its world has them, its lanterns, its dust), and your hit points, slots and conditions are written back to the sheet. The stand-in stays until you've iterated on this.

## 6. What was confusing in the prototype's fight, and what this one does

From its code (`git show bc2ab1f:src/game/combat/`, `src/app/ui/combat.tsx`, `src/game/views.ts`):

1. **The other side's turns came all at once.** One call resolved every NPC turn, then the screen redrew: people jumped across the floor. Only bolts, sparks and numbers played, found by matching log lines against patterns, so a line worded otherwise played nothing. *Here* each NPC turn is a step of its own, each act an event with its path, target, roll and damage, and the board moves only as the events play.
2. **One log for everything:** dice, flavour, turn headers and notices in a small box under the map, nothing tying a line to who did it. *Here* each move's caption shows on the board as it plays.
3. **Two ways to aim and sixteen keys:** a target cursor (Tab, 1–9), a key per act, and a click that aimed first and attacked second. *Here* there's one way, the action menu, with the reach and area shown before you commit.
4. **Reach was learnt by trial** ("out of reach (z closes in)"). *Here* aiming shows the ring, the line and the targets in range.
5. **The turn could end by itself, unannounced,** once nothing worth doing was left. *Here* only once nothing at all is left, and it says so.

Not yet: typing in a fight (V13); the story's fights (§5); class features, hiding, jumping and thrown weapons, which a fight refuses with a reason, as the prototype's did; and, of §2, the line to an aimed target drawn red when something's in the way. The hazards (grain dust, fire, lanterns) keep the prototype's own rules until fights share the scenes' world (V18).

## 7. As built (M6)

The fight is rows: `fight` (the board, whose turn, your options), `fight_rules` (the engine's campaign), `fight_event` (the moments, in order) and `fight_clock`, the schedule whose `fight_step` plays the next of the other side's turns. The board's rules, the AI and the flavour are the prototype's, ported to `simulation/src/fight/` without boardgame.io. `startFight(tx, player, setup)` is the one way in; for now the zoo calls it: its combat ring ([campaigns/zoo](../campaigns/zoo/README.md), an exhibit authored as data: you and Kell against Sallow and the Crakes, the Crakes alone or a pack of dogs, on sand with two pillars and a brazier), opened from the title (`z`), `npm run zoo -- ring`, the page's `?zoo=ring` or `npm run play -- new --session <you> --zoo ring`, `n` fighting it again and `o` picking other foes; and the arena's rings (the practice ring's one bandit, the wolf run, the goblin pit, the porters' floor, the grain floor): `npm run play -- ring --session <you> --ring wolves`. On your turn the map's own moves are fight moves (`attack@4,3`, `cast_fire-bolt@4,3`, `walk@6,2`), with `dash`, `dodge`, `disengage`, `end_turn`, `yield`, `leave` and `auto` beside them, and headless `observe` says `MODE: fight`. The migration log (M6) has the detail and the judgement calls.

**The screen** (`client/ui/fight.tsx` over `client/fight/model.ts`, the terminal client's and the page's alike) is up whenever the game has a fight on. The turn-order bar is across the top: each fighter a portrait in their own glyph and colour, whose turn marked (▶, gold), a hit-point gauge each, conditions as tags, anyone down or gone crossed out. Under it the board, the ring's own map drawn by the map's renderer (`client/fight/draw.ts`); the caption line; the log; and beside the board whose turn it is, with one clear YOUR TURN on yours and your action, bonus action and movement left.

**The moves play out** (`client/fight/script.ts`, `client/fight/player.ts`): each moment is a script of beats laid out by the pace table's parts (`shared/fight/pace.ts partsOf`, which the simulation's spacing reads too): a beat between combatants; the bar moving on; a walk a tile at a time (110 ms a tile); a blow's flash between them (a blade's sweep, a club's knock, a bite) or a shot or a bolt crossing the floor; the one hit flickering, its number popping up and drifting, or "miss"; a fall tipping their letter over to an x. The look is procedural, in the look layer (`client/look/fight.ts`, and the effects' new slash). Space finishes the move playing; F skips to your turn (`hurry`, a new `fight_turn` act, makes the simulation play the rest of their turns at once). Reduced motion shows each move's end at once with its caption (`KM_REDUCED_MOTION=1`, the browser's own setting, or the fight's Esc menu).

**Your turn** is the action menu (m or Enter), its lines by what they spend (action, bonus action, movement, your turn), its attacks and spells aimed on the board with their reach and targets lit before you commit, Tab between targets. A click on a blue tile walks there; rust tiles draw a swing. A click on someone opens what can be done to them. The options say what the menu needs: each one's name, cost, aim, reach and area, and which tiles draw a swing. Headless, under each moment's caption, a `▸` line says what the screen plays of it.
