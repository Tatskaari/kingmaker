# Fights in the story

A fight that breaks out in a scene is fought on the board, as the zoo's combat ring fights one (docs/combat-design.md, M6: the map's own tiles, a turn at a time, every move played out), and the scene picks up from how it went. The user (2026-10-18): "The turn based combat we have is really good. Can you get that in the game and give the GM the ability to trigger combat with a `roll_for_initiative()` tool", and "make sure the BBEG fight at the end triggers properly". Then, as it was built: "when you roll for initiative, the GM should make each character pick a side or flee", "each scene should have a set of characters that appear on scene when you start a fight so if you attack Cob or whatever, the guards come after a few turns or a round", "make it so the GM still narrates what happens in the log, and if I click on it, I can still narrate what I do", and "how do I use a bonus action? I think I have second wind".

A first cut fought the story's fights in the conversation instead, the GM narrating every turn through tools (perform_action, move_towards, end_turn, end_combat): it's on branch `claude/combat-in-conversation` (b3c2915), with its four QA rounds below. What it built that the board's fights keep: the GM's roll for initiative, the sides, the prep's fight on an event, the scene's reinforcements, who the story needs, and the fixes its rounds found in the GM.

## How a fight goes

1. **It breaks out.** Three ways:
   - **The GM rolls for initiative in a reply.** The mouthpiece's reply has a `roll_for_initiative` field, decided before its narration as `check` is: `{ foes, allies, flee, why, on }`, everyone here in one of the three by their ids (the cast, a group's members such as the Crakes, and the people and creatures in the world with no card: the re-sacking gang, Duchess). The player is always in it; the companion is beside them unless the GM sets them against them or has them run. It's a field of the reply rather than a function call because the reply is a JSON answer streamed as it's written: the same job as a `roll_for_initiative()` tool, with no extra model call. Its narration takes the fight up to its first blow and ends on "Roll for initiative!". A reply that says so in so many words with no field set starts it too (QA round toll2-1018), and so does one the scene closes on (it reopens: hobo1-1018). `on`, with a check, says which of its outcomes come to blows.
   - **A fight the prep planned.** An event with a `fight` (the Heron's "Blades out": Sallow and both Crakes against the player, Kell beside them) has its line-up told to the GM on every route into it; a reply's fight while one is open is that one (the scene goes there by its route), and the co-GM's move into it starts it after the settle. This is the BBEG fight.
   - **A combat exit** (the format still has the kind; no scene of the story uses one now): the companion beside the player, everyone else here against them.
2. **Everyone takes a side or runs.** Whoever the reply placed is placed; whoever reacted to the player's violence this turn keeps the side their reaction took (who went for the player is against them, who took their side is beside them, who fled or ran for help runs); the rest are the GM's to place before the fight is set out, in one call (the sides step, POST /v1/turns/sides: `pick_sides({ sides: [{ id, side }], narration })`, with_player, against_player or flee, held to the list; its narration is under the reply). Whoever the story needs never leaves: the companion, and whoever holds a discovery the scene can't end well without that the player hasn't made yet (shared/scene/beats.ts `storyNeeds`) keep clear of it instead. The scene's transcript says who's where: "Roll for initiative! Against you: … Beside you: … Running from it: … Keeping clear of it: …", and the scene is at its fight (`fighting`): no line is taken until it's fought.
3. **On to the fight.** The card under the reply ("Roll for initiative!", To the fight: fight_it_out) sets it out on the board (simulation/src/fight/scene.ts):
   - **the map** is the one that lays the scene's place (the region with its sceneId and worldOrigin), the region the player is in (the hanged clerk has the yard and the tally loft);
   - **everyone** where the place's world has them now, on a tile of their own, as the player knows them (by what they call them until they've heard the name), the scene's people as the rules' own characters when the rules have made them already (hurt as they are), anyone else from their card's statblock;
   - **how each is played** by the ring's AI: beside the player an ally (Kell puts the irons on the beaten); against them the leader of a group whose people fight with them the villain (when he yields, his people yield with him: Sallow and the Crakes), a bow an archer, a commoner a brawler (who gives up hurt), anyone else a bruiser; running from it a coward, who runs for the way out on their turn and is gone from the scene once off the board; keeping clear a bystander, who stays out of it;
   - **the place's** lit lanterns and braziers as what a fight can knock over, its dusty floors (the Heron's grain dust) and what burns (sacks, straw), and its ways out: the map's own exits, or a region of a bigger map's doorways (the yard's gate);
   - **the player's** hit points, slots and conditions kept: what the fight does to them stays.
4. **It's fought on the board**, a turn at a time, as the ring is: the player's turns from the action menu (or headless: `attack@x,y`, `cast_<spell>@x,y`, `walk@x,y`, `feature_<id>`, `dash`, `dodge`, `disengage`, `end_turn`, `yield`, `leave`, `auto`), everyone else's by the AI, each move played out. Class features are the engine's own options (the user: "how do I use a bonus action? I think I have second wind"): Second Wind, Cunning Action's dash and disengage, Rage and the rest are the menu's Bonus action lines, those that take the action (Lay on Hands, Turn Undead) its Action lines, and Action Surge (another action, for nothing) a Your turn line; each uses the engine's planner (its uses, the turn's action or bonus action) and is a moment of its own ("You use Second Wind: 8 hit points back.").
5. **The scene picks up from how it went.** Out (Enter on the end, headless `out`) goes back to the scene (simulation/src/story/fight.ts): who went down is down in the place's world, who's hurt hurt, who gave up has, who's in irons is, who ran off the board is gone from the scene (bar those the story needs), everyone where they ended up, the lights the fight broke out; "The fight: <how it went>" in the transcript and the notebook; "The fight is over: <how it went>" settled; then the GM's aftermath (the opening's think with how it went, gm.aftermath) on a turn of its own, and the scene is live, the co-GM taking it on from there (the Heron to "Caught in the act" when Sallow's taken).

A fight that breaks out on the town's map (hurting a palace guard in the street: town-design §3.3) is set out on the board the same way, on the town's map where everyone stood; out goes back to the map, the town's people as the fight left them until the clock moves on.

**Who comes** (the scene's `reinforcements`, docs/scene-format.md: the granary porters and Old Wat after two rounds in the yard, three dockers off the night shift after two at the Rat, two palace guards at the Marshal's shout after one in the King's dressing room) are authored, and the GM's sides step sees them; on the board they come in at the way in when their round comes (M3, next).

## Where it is

| Part | Where |
|---|---|
| A fight in a scene, between its breaking out and its end (gm_state's `fight`: what started it, everyone's side, who's to pick, the board's row) | shared/gm/fight.ts |
| A fight the prep planned (an event's `fight`) and who comes (the scene's `reinforcements`): the format, the check, the open routes into one, who the story needs | shared/scene/document.ts, rules.ts, beats.ts `fightsAhead`, `storyNeeds` |
| The protocol: the reply's `initiative`, the sides step | shared/protocol/ai.ts, keys.ts (`sides`, once a turn) |
| The GM's side: `roll_for_initiative` in the reply's schema, "When a fight breaks out", `fightOf`; the sides | ai/gm/two-part.ts; ai/gm/sides.ts, ai/prompts/fight-sides.md, ai/service/endpoints/sides.ts |
| Breaking out: the sides from the reply, the line-up, the reactions and the companion, the GM's pick, the scene at its fight | simulation/src/moves/fight.ts |
| The board from the scene, and how it went back into the world | simulation/src/fight/scene.ts |
| On to the fight, and the scene picking up after it | simulation/src/story/fight.ts; fight/moves.ts (out) |
| The town's fights | simulation/src/map/fight.ts |
| The board itself (rules, AI, moments, the screen) | docs/combat-design.md |
| Authoring them | the Obsidian plugin: an event's Fight (who's against the player, who's beside them) in its inspector, and "Who comes when a fight breaks out" in the Scene view's world |

## The zoo's exhibit

The Crakes' toll (`?zoo=toll`, `npm run play -- new --session <you> --zoo toll`, the title's zoo menu): the Crake brothers have the ring's gate and want a shilling each to let you and Kell out. Pay, talk them down, or fight: a fight is set out on the ring's own sand, and the scene's endings follow how it went (talked out of it, paid, the Crakes beaten, beaten back). The GM loop plays it as `--scene zoo/toll`.

## What's not done yet

- **The GM's voice on the board** (M2, the user's ask): the GM narrating each turn in the fight's log, and a click on the log to type what you do, read into the board's actions.
- **Who comes, on the board** (M3).
- **The GM loop's testers playing fights** (M4): the loop sees a fight through by the dice for now (auto), so a round tests what starts fights and what comes after them, not the fight itself.

## QA of the first cut, in the conversation

Four blind rounds on real models, reports archived in `kingmaker-scratch/loop`: two on the toll (6 games each), then two on the story's scenes with murder hobos and an avenger (the user's "play a murder hobo run and verify the GM uses this appropriately to trigger combat").

| Round | Build | Came to blows | Endings | Penalty / 10 replies | Overall |
|---|---|---|---|---|---|
| toll1-1018 | 1a6a4dd | 2 of 6 | 6 good | 15.1 | 3.5 |
| toll2-1018 | 3e5733e | 3 of 6 | 6 good | 10.0 | 3.8 |
| hobo1-1018 (report https://claude.ai/artifact/TowDeepFPx1H3c5rdM6goc) | 1b31991 | 6 of 8 (8 fights) | 2 good, 1 mixed, 5 bad | 20.5 | 2.6 |
| hobo2-1018 (report https://claude.ai/artifact/2tw86Z6otBCAyBXdRLY2QD) | e08ebe6 | 7 of 8 (9 fights) | 2 good, 1 mixed, 4 bad, 1 out of turns | 22.7 | 3.0 |

What still holds for the board's fights, since it's about what starts them:
- **Fights broke out when someone fought back, and not before**: a threat, or a blow that felled someone who couldn't answer it, started none.
- **The BBEG fight triggered in all six Heron games**, each with Sallow and both Crakes, from the player going for him or from Sallow drawing as he was exposed, from the reply or the settle.
- Fixed then and kept: threats read as blows by the act step; the closing reply that couldn't start a fight or resolve an act (it reopens the scene); the stage manager's copies of the cast (two Sallows; people who'd run come back as themselves); the initiative line giving a name away; reactions and fights sending away the people the story needs; the player's own words echoed as someone else's line.
- Still open from them: talk around a fight gives secrets up without a check (Hobb names Sallow at axe-point); the Rat's last resort ends the scene on "Hobb hurt" even with the lead in hand (a scene-authoring call); picks that go against the cards' limits.
