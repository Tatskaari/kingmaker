# Combat in the conversation

A fight played the way the rest of a scene is: in the conversation, the GM narrating every turn, the rules' dice deciding what lands. The user's design (2026-10-18): "it basically works the same way as the current conversational GM, but we have the GM narrate every turn of combat. The GM can call a tool roll_for_initiative(), which switches the mode: instead of player → GM → player turns, it now goes through the initiative order, passing back to the player. The GM gets tools to perform_action(action, target, narration) to e.g. cast or similar + end_turn(narration)." Then: "The GM should also be able to end combat", and "the GM will want a move_towards() tool as well". The tactical fight on the map (docs/combat-design.md, M6) is a separate thing and stays as it is.

## How a fight goes

1. **It breaks out in a reply.** The mouthpiece's reply has a `roll_for_initiative` field, decided before its narration as `check` is: `{ foes, allies, why }`, the cast against the player and beside them (the player is always in it; a companion is on their side unless the GM sets them against them). It's a field of the reply rather than a function call because the reply is a JSON answer streamed as it's written; it does the same job. Its narration takes the fight up to its first blow and ends on "Roll for initiative!".
2. **Initiative.** The simulation rolls a d20 plus each fighter's initiative modifier (the engine's sheet, the cast by their SRD statblocks) from the game's dice, writes a dice line each and "Combat! In initiative order: …", and the order holds every round.
3. **Turns, in order.** Each turn is a combat step (POST /v1/turns/combat) on whoever's turn it is. The GM plays it through its tools, one call an answer:
   - `move_towards(target, narration, away?)`: up to their speed, towards someone or something in the place's world (stopping beside them) or away. Once a turn; a second is a dash, which takes the action.
   - `perform_action(action, target, narration, spell?, weapon?, feature?, skill?, dc?)`: `attack`, `cast`, `grapple`, `shove`, `feature`, `check` (a stunt the dice decide), `flee`, `surrender` or `other`. Its narration is the attempt, up to the moment the dice decide it.
   - `end_turn(narration)`: what came of the turn, as the rules decided it.
   - `end_combat(outcome, narration)`: `won`, `lost`, `yielded`, `fled` or `stopped`.

   The tool loop stops at each call that passes its checks (a wrong one is answered in the loop, so the GM can put it right: Cob can't cast, a turn's action is used once). The simulation resolves an action with the rules on the scene's world (the dice lines written at once), and asks the GM again with what came of it and where the target stands now. Out of reach is refused before anything's rolled ("Cob is 30 ft away, and a melee blow reaches 5 ft. move_towards first").
4. **The player's turn** hands the scene back: "Your turn." Their next line is their turn, and the GM turns what they said into actions as their character can (the rules refuse what the sheet can't do), then ends it.
5. **The end.** The rules end the fight when the player is down or gone, or nobody on the other side can fight on: one more combat step, for the GM's end_combat. The GM may end it sooner (a surrender, the player getting away, everyone backing off). The scene goes back to conversation through the settle, so the stage manager keeps the world in step and the co-GM takes the scene on from how it went.

## Where it is

| Part | Where |
|---|---|
| The fight's state (gm_state's `combat`, JSON) and its rules: whose turn next, whether a side is beaten | shared/gm/combat.ts |
| The rules: initiative, a blow between anyone in the fight, standings, reach and speed | shared/rules/acts.ts (the end) |
| The protocol: the combat step, its request and answer, the reply's `initiative` | shared/protocol/ai.ts, keys.ts (`combat-<k>`, the k-th step of the turn) |
| The combat GM: its tools, its fight note, the loop that stops on each call | ai/gm/combat.ts, ai/service/endpoints/combat.ts |
| Its instructions | the user's two-part prompt with the scene's prep and people, then **ai/prompts/combat-gm.md** (a draft for the user to rewrite), then who says each line and what the player sees |
| The mouthpiece's side | ai/gm/two-part.ts: `roll_for_initiative` in the schema, "When a fight breaks out", `fightOf` |
| The simulation's | simulation/src/moves/combat.ts: the fight started from the reply, each action resolved, the turn passed on, the player's turn, the end into the settle |
| The tool loop's stop | ai/llm/tools.ts `stop`, `parallel: false` |
| The fake model's fights | ai/llm/fake-openrouter.ts: `mouthpiece.fight` rolls for initiative on a cue word; its combat GM moves, attacks, ends the turn |

## The zoo's exhibit

The Crakes' toll (`?zoo=toll`, `npm run play -- new --session <you> --zoo toll`, the title's zoo menu): the Crake brothers have the ring's gate and want a shilling each to let you and Kell out. Pay, talk them down, or fight. Its endings follow how it went: talked out of it, paid, the Crakes beaten, beaten back. To play it, the zoo is now played by the two-part GM, the AI service serves every installed campaign (each game reads its own campaign's lore; the 409 for a second campaign is gone), and the page serves the zoo beside the build's campaign. The GM loop plays it as `--scene zoo/toll`.

## What's not done

- The NPCs' actions are their statblock's weapon, a move, fleeing, giving up or something else: no NPC spells, grapples or features yet.
- Ranges are the world's feet: a melee blow needs 5 ft; spells' ranges and cover aren't checked; no opportunity attacks.
- No death saves: the player at 0 hit points loses the fight (knocked senseless, as outside a fight).
- The Heron's story fight still goes to the board (its ending's `combat` kind); a reaction that would fight in a scene can now become a fight in the conversation through the reply.
- Pace: each tool call is a model call (1.6 to 1.9 s on real models), so an NPC's turn of move, attack and end is 5 to 6 s, its lines appearing as each lands.

## QA

Two blind rounds on the toll, 6 persona games each on real models, played by the GM loop (`--scene zoo/toll`), reports archived in `kingmaker-scratch/loop`:

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
