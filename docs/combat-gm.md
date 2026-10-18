# Combat in the conversation

A fight played the way the rest of a scene is: in the conversation, the GM narrating every turn, the rules' dice deciding what lands. The user's design (2026-10-18): "it basically works the same way as the current conversational GM, but we have the GM narrate every turn of combat. The GM can call a tool roll_for_initiative(), which switches the mode: instead of player → GM → player turns, it now goes through the initiative order, passing back to the player. The GM gets tools to perform_action(action, target, narration) to e.g. cast or similar + end_turn(narration)." Then: "The GM should also be able to end combat", and "the GM will want a move_towards() tool as well". The tactical fight on the map (docs/combat-design.md, M6) is a separate thing and stays as it is.

## How a fight goes

1. **It breaks out in a reply.** The mouthpiece's reply has a `roll_for_initiative` field, decided before its narration as `check` is: `{ foes, allies, flee, why, on }`, everyone here in one of the three, by their ids (the cast, a group's members such as the Crakes, and the people and creatures in the world with no card: the re-sacking gang, Duchess). The player is always in it; a companion is on their side unless the GM sets them against them or has them run. It's a field of the reply rather than a function call because the reply is a JSON answer streamed as it's written; it does the same job as a `roll_for_initiative()` tool, with no extra model call. Its narration takes the fight up to its first blow and ends on "Roll for initiative!".
   - **A fight the prep planned.** An event with a `fight` (the Heron's blades out: Sallow and both Crakes against the player, Kell beside them) has its line-up told to the GM on every route into it. A reply that has a fight break out while one is open is that one: the scene goes to the event by its route, and its line-up fights beside whoever the reply named. If the reply doesn't start it but the co-GM takes a route into it, it breaks out after the settle, and if it's over on the same turn its settle is the turn's second (`settle-2`). Reached, nothing leads back into it.
   - **Everyone picks a side or runs** (the user's, 2026-10-18: "when you roll for initiative, the GM should make each character pick a side or flee"). Whoever the reply put on neither side, and anyone a words-only "Roll for initiative!" left unplaced, is the GM's to place before the first turn: a combat step whose only tool is `pick_sides({ sides: [{ id, side }], narration })`, `with_player`, `against_player` or `flee`. Those who join roll for initiative and take their place in the order (the round goes on from its top); those who run are gone from the scene, as a reaction's flight is. Words alone send them all running. One the story needs doesn't leave, though: whoever walks with the player, and whoever holds a discovery the scene can't end well without that the player hasn't made yet, keeps clear of the fight close by ("Keeping clear of it: …", the world's "cowering"), here when it's over, and the GM's fight note says so (the first smoke test on real models put Kell to flight in the yard, gone from the scene she was still talking in). Nobody stands by: the instructions put whoever steps in to stop the player against them. Whoever the reply left unplaced who reacted to the player's violence this turn (#674's reactions) keeps the side their reaction took: who went for the player is against them, who took their side is beside them, who fled or ran for help is gone; who cowered or stepped in is the GM's to place.
   - **Who comes** (the user's: "each scene should have a set of characters that appear on scene when you start a fight so if you attack Cob or whatever, the guards come after a few turns or a round"). A scene's `reinforcements` (docs/scene-format.md) come in at the way in at the top of the round after their `after` rounds of fighting, one of the cast (there from now: gm_state's new `entered`) or someone new with a statblock of their own, and the GM picks their side as they come, with why they came. In the story: the granary porters and Old Wat after two rounds in the yard, three dockers off the night shift after two at the Rat, two palace guards at the Marshal's shout after one in the King's dressing room. The Heron has none (everyone who'd fight is there), and the zoo's toll none ("anyone else coming: it's after hours").
2. **Initiative.** The simulation rolls a d20 plus each fighter's initiative modifier (the engine's sheet, the cast by their SRD statblocks) from the game's dice, writes a dice line each and "Combat! In initiative order: …", and the order holds every round.
3. **Turns, in order.** Each turn is a combat step (POST /v1/turns/combat) on whoever's turn it is. The GM plays it through its tools, one call an answer:
   - `move_towards(target, narration, away?)`: up to their speed, towards someone or something in the place's world (stopping beside them) or away. Once a turn; a second is a dash, which takes the action. One on the ground (prone) gets up first, for half the move.
   - `perform_action(action, target, narration, spell?, weapon?, feature?, skill?, dc?)`: `attack`, `cast`, `grapple`, `shove`, `feature`, `check` (a stunt the dice decide), `stand` (up off the ground: half the move), `flee`, `surrender` or `other` (the player's only: on anyone else's turn what they say or how they hold their ground is `end_turn`'s, and giving up is `surrender`, so the rules know). Its narration is the attempt, up to the moment the dice decide it. A feature that's one of the player's spells is cast as that spell, and a bonus-action spell (a smite: "your next hit") goes beside the turn's action, once a turn, before the blow it goes with. Something small after the turn's action ends the turn on its words.
   - `pick_sides(sides, narration)`: the only tool while someone here has no side (as the fight breaks out, or as they arrive).
   - `end_turn(narration)`: what came of the turn, as the rules decided it.
   - `end_combat(outcome, narration)`: `won`, `lost`, `yielded`, `fled` or `stopped`.

   The tool loop stops at each call that passes its checks (a wrong one is answered in the loop, so the GM can put it right: Cob can't cast, a turn's action is used once). The simulation resolves an action with the rules on the scene's world (the dice lines written at once), and asks the GM again with what came of it and where the target stands now. Out of reach is refused before anything's rolled ("Cob is 30 ft away, and a melee blow reaches 5 ft. move_towards first").
4. **The player's turn** hands the scene back: "Your turn." Their next line is their turn, and the GM turns what they said into actions as their character can (the rules refuse what the sheet can't do), then ends it.
5. **The end.** The rules end the fight when the player is down or gone, or nobody on the other side can fight on: one more combat step, for the GM's end_combat. The GM may end it sooner (a surrender, the player getting away, everyone backing off). The scene goes back to conversation through the settle, so the stage manager keeps the world in step and the co-GM takes the scene on from how it went.

## Where it is

| Part | Where |
|---|---|
| The fight's state (gm_state's `combat`, JSON: the order, who has no side yet, who ran, who has come) and its rules: whose turn next, whether a side is beaten | shared/gm/combat.ts |
| A fight the prep planned (an event's `fight`) and who comes (the scene's `reinforcements`): the format, the check, the open routes into one | shared/scene/document.ts, rules.ts, beats.ts `fightsAhead` |
| The rules: initiative, a blow between anyone in the fight, standings, reach and speed | shared/rules/acts.ts (the end) |
| The protocol: the combat step, its request and answer, the reply's `initiative` | shared/protocol/ai.ts, keys.ts (`combat-<k>`, the k-th step of the turn) |
| The combat GM: its tools (`pick_sides` alone while someone has no side), its fight note, the loop that stops on each call | ai/gm/combat.ts, ai/service/endpoints/combat.ts |
| Its instructions | the user's two-part prompt with the scene's prep and people, then **ai/prompts/combat-gm.md** (a draft for the user to rewrite), then who says each line and what the player sees |
| The mouthpiece's side | ai/gm/two-part.ts: `roll_for_initiative` in the schema, "When a fight breaks out", `fightOf` |
| The simulation's | simulation/src/moves/combat.ts: the fight started from the reply or the settle, the sides picked, who comes at a round's top, each action resolved, the turn passed on, the player's turn, the end into the settle |
| Authoring them | the Obsidian plugin: an event's Fight (who's against the player, who's beside them) in its inspector, and "Who comes when a fight breaks out" in the Scene view's world |
| The tool loop's stop | ai/llm/tools.ts `stop`, `parallel: false` |
| The fake model's fights | ai/llm/fake-openrouter.ts: `mouthpiece.fight` rolls for initiative on a cue word; its combat GM moves, attacks, ends the turn |

## The zoo's exhibit

The Crakes' toll (`?zoo=toll`, `npm run play -- new --session <you> --zoo toll`, the title's zoo menu): the Crake brothers have the ring's gate and want a shilling each to let you and Kell out. Pay, talk them down, or fight. Its endings follow how it went: talked out of it, paid, the Crakes beaten, beaten back. To play it, the zoo is now played by the two-part GM, the AI service serves every installed campaign (each game reads its own campaign's lore; the 409 for a second campaign is gone), and the page serves the zoo beside the build's campaign. The GM loop plays it as `--scene zoo/toll`.

## What's not done

- The NPCs' actions are their statblock's weapon, a move, getting up, fleeing or giving up: no NPC spells, grapples or features yet.
- The rules have no Reckless Attack or Savage Attacker choice, no non-lethal blow and no disarm: the GM narrates them, and the dice go as an ordinary blow (QA round hobo1-1018).
- Ranges are the world's feet: a melee blow needs 5 ft; spells' ranges and cover aren't checked; no opportunity attacks.
- No death saves: the player at 0 hit points loses the fight (knocked senseless, as outside a fight).
- The map's fights (a combat ending's `startFight`: the zoo's ring) are the board's still; the story's are all in the conversation now (the Heron's blades out is an event).
- Pace: each tool call is a model call (1.6 to 1.9 s on real models), so an NPC's turn of move, attack and end is 5 to 6 s, its lines appearing as each lands.

## QA

Two blind rounds on the toll, 6 persona games each on real models, played by the GM loop (`--scene zoo/toll`), then two on the story's scenes with murder hobos and a knight who confronts the guilty (`--personas murderhobo,murderhobo,murderhobo,avenger`: the user's "play a murder hobo run and verify the GM uses this appropriately to trigger combat", "make sure the BBEG fight at the end triggers properly"), reports archived in `kingmaker-scratch/loop`:

| Round | Build | Came to blows | Endings | Penalty / 10 replies | Overall | Cost / game |
|---|---|---|---|---|---|---|
| toll1-1018 | 1a6a4dd | 2 of 6 | 6 good | 15.1 | 3.5 | $0.033 |
| toll2-1018 | 3e5733e, the testers set on refusing the toll and fighting it out | 3 of 6 | 6 good | 10.0 | 3.8 | $0.021 |

What they found in the fight, each fixed:
- A fight that broke out on the player's own blow left the world's player where they stood, 25 ft off: it now starts with them beside the blow's target.
- A check whose outcome called for initiative started nothing: `roll_for_initiative`'s `on` says which outcomes start it, and a reply whose words (or the outcome that came up) end on "Roll for initiative!" with none set starts the fight anyway, everyone here against the player but the companion.
- "Slug him" didn't go to the rules: more blows are blows.
- Moments told twice and lines repeated: the combat prompt says each moment is told once.

Still open:
- the "Someone" speaker tags on the talking Crake's lines (the mouthpiece's tagging, not the fight's; the cards' other names didn't cure it);
- the told-once rule hasn't fully taken (a surrender in the attempt and again in end_turn);
- the combat GM can play someone against their card's "when they stop" (the silent Crake giving up while his brother fought on).
