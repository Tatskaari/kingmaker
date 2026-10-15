# Deviation experiment: qualitative investigation

Four Claude analysts each read the transcripts for one group of conditions (see [deviation-repair.md](deviation-repair.md) for the setup and the numbers). Their reports follow, unedited.


---

# Group: blocking vs stall-quick (gm-repair-blocking, gm-stall-quick)

## 1. Summary

The blocking co-GM is not clearly better at resolving deviations. Its one real edge is judging plans nobody prepped, and that edge doesn't need to land before the reply.

**Timing.** Blocking put the co-GM in front of every reply: first text p50 12.0 s, p90 22 s, max 37 s. None of its 112 co-GM turns met 5 s, and a median scene meant 74 s of waiting. Stall-quick met 5 s on 137 of 141 turns (p50 1.1 s; follow-ups 3.4–6.7 s).

**Quality.** My ratings, blocking vs stall-quick, two samples per case: 3.7 vs 3.5 overall; judge criterion 15/20 vs 13/20.
- Missed-essential (dv) cases tie, 3.7 each.
- Holed scenes lean stall-quick, 3.8 vs 4.1.
- Dreamed plans lean blocking, 3.7 vs 2.7 (judge 5/6 vs 2/6). Part of that comes from co-GM rolls for the new plan, part is dice.

**What does the work in stall-quick.** Decider relocation (59 directives), not the stall (fired on 11 turns) or the quick co-GM (never relocated, 3 of 11 late, 3 broken routes). Relocation works well when the carrier is the NPC the player is already arguing with. It fails when it gives secrets away: several essentials in one reply, knowledge the carrier can't have, clues routed to the NPC the player avoids. The judge scored "characters" 3.4 for stall-quick vs 4.3 for blocking.

**What blocking buys.** Tracker jumps and same-turn routes, mostly rolls, that turn a new plan into a "maybe" instead of an NPC's "no". It also gave too much away at once, held back beats the player was chasing, and asked for rolls in narration. It isn't worth 12 s per turn.

## 2. Session table

All 40 sessions were read. Blocking = gm-repair-blocking, stall-quick = gm-stall-quick. Times are first text per reply (blocking excludes the wind-down turn, which skips the co-GM).

| case | approach | sample | deviation resolved how | satisfying (1-5) | timing note |
|---|---|---|---|---|---|
| rp-ablated-idol | blocking | 0 | New route plus tracker jump: co-GM added "offer to return the idol → bargain" and jumped to the ambush, so the goblins appear and take the idol in the same reply. Before that, an Insight route on Tam failed, then passed. | 4: peaceful and fast, but skips the player's "I'll do the talking" | 9.5–13.0 s |
| rp-ablated-idol | blocking | 1 | Tam shows the idol when asked. Co-GM Persuasion route for the player's conditional handover. Fail: "Skrag gives no word for maybe-bone". Pass: "Skrag fears chieftain more than longlegs". The tracker then relabelled the roll-decided bargain as own-ending. | 4.5: real negotiation, motivated NPC | 5.9–12.3 s |
| rp-ablated-idol | stall-quick | 0 | Decider relocations via Tam (he relays the goblins' demand). Tam hands the idol to Wren, she returns it, improvised ending. The stall never fired. | 4.5: natural; one line garbles the player's words | 1.1–1.5 s |
| rp-ablated-idol | stall-quick | 1 | Decider put both essentials through Tam in reply 1. Calm roll failed, then passed. Background co-GM added a firmer-terms Persuasion route (pass) → bargain. | 4: good terms, but Tam's secret is gone at turn 1 | 0.8–2.8 s; 8 turns |
| rp-ablated-tree | blocking | 0 | "No, but": the cart only carries the tree. Then co-GM Athletics routes: lift it through (fail; GM: "Make an Athletics check"), then carry it back out (pass): "It had nothing left to defend." Relabelled own-ending. | 4.5: the player's remedy decides it | 9.3–26.4 s |
| rp-ablated-tree | blocking | 1 | Athletics route ("**Roll Athletics.**") fails. Holt: "That's enough risk to the gift". Co-GM nudges Corvin's book via Rowan; the player leaves to find Corvin. | 2.5: one failed roll ends the remedy; steered to the authored exit | 8.0–26.8 s |
| rp-ablated-tree | stall-quick | 0 | Stall on the lift. The quick co-GM's route made Rowan's insight ("turn the cart away from the doorway") the fix → Freed. | 3: fast, but someone else's fix | follow-up 4.1 s |
| rp-ablated-tree | stall-quick | 1 | Decider gives the cause through Mags in reply 1. The holding beat is the count; the follow-up lifts the pot, the wheels relax → Freed, no roll. | 5: the player's plan, 3 turns | all replies ≤1.8 s; follow-up 3.5 s |
| rp-ablated-toll | blocking | 0 | Before reply 1 the co-GM moved the arrow to Garrow, nudged the Clause, jumped to confession and added the ending route. Garrow folds at the first mention of the hole. | 2.5: too much at once; the player's search never mattered | 22.2 s for reply 1 |
| rp-ablated-toll | blocking | 1 | Tracker jump to goblin-talk, clawed prints under the hedge. Garrow cracks via the authored route; the co-GM's route to "Tam was right" closes it. | 4.5: the evidence earns it | 13.0–17.5 s |
| rp-ablated-toll | stall-quick | 0 | Decider shows the evidence through the world (outward splinters, prints). Garrow cracks via the authored route; a background route closes on crossing. | 4.5: earned; long report-writing tail | 1.0–6.8 s (two slow GM calls) |
| rp-ablated-toll | stall-quick | 1 | Same crack by turn 2. Stall at T4 with a late quick co-GM whose route ("searches the toll house → Across another way") was wrong. Repeated beat, the GM echoes the player's line, two drifting turns. | 3.5 | follow-up 4.5 s (quick co-GM 3.9 s, late) |
| rp-dreamed-guarantor | blocking | 0 | Skrag pushes back well ("Wren gives word, but Skrag gets empty hands?"). Co-GM Persuasion route for delayed delivery fails; "no, but" on companions the player invented. Ends as a plain handover with muddled logistics. | 2.5: plan bent into the authored handover | 6.2–35.4 s, median 21 s |
| rp-dreamed-guarantor | blocking | 1 | Co-GM added a Persuasion route for each version of the plan. The second passes: "Longlegs walks with Skrag. Longlegs sees shrine. Tam goes home". | 3.5: plan honoured; feels like a re-roll | 7.9–14.3 s |
| rp-dreamed-guarantor | stall-quick | 0 | Honest "no, but": Skrag refuses the guarantee but will "tell chieftain dirt-scratcher found her". Quick co-GM note_only; handover. | 3 | follow-up 4.0 s |
| rp-dreamed-guarantor | stall-quick | 1 | Refused three times; the quick co-GM backed the refusal; handover forced. | 2: stonewalled | hold 3.3 s, follow-up 6.7 s (over budget) |
| rp-dreamed-skids | blocking | 0 | Tracker jump into the cart beat; the charm bracing is the twist. The player adapts (calm it, lay timber) and the timber track carries the cart through → Freed. | 4.5 | 10.0–19.7 s; 5 turns |
| rp-dreamed-skids | blocking | 1 | Nature route for padding the branches fails. The player backs out on the track; the co-GM kept pushing the authored persuade-Rowan roll; outcome route → Backed out. | 3.5: the player's method, but slow | 9.2–23.9 s; 8 turns |
| rp-dreamed-skids | stall-quick | 0 | No stall. The GM accepts the plan but stretches it over six "one finger's width" turns before the track rolls the cart out → Freed. | 3.5 | ~1 s; 11 turns |
| rp-dreamed-skids | stall-quick | 1 | Rowan vetoes each step. A background cue route fired "Backed out" while the GM was narrating the charm tightening; Rowan's authored remedy swapped in. | 2.5 | ≤2.7 s |
| rp-dreamed-workdetail | blocking | 0 | Co-GM amends roll fails (the mark begins); the authored fresh appeal passes. The co-GM's note tied the guest-right to the player's shared-watch argument → bread and salt → sheltered. | 4.5: the plan is why it works | 9.9–20.3 s |
| rp-dreamed-workdetail | blocking | 1 | The work detail visibly shifts attitudes; amends via rolls; the player picks Ned's errand → To the burnt mill. | 3.5 | 9.0–20.5 s |
| rp-dreamed-workdetail | stall-quick | 0 | The work detail is called "useful" but never decides anything. Hester holds the ward until the mill trip; the closing narrates a bread-and-salt rite nobody proposed. | 2.5: unearned ending | 1.0–2.8 s |
| rp-dreamed-workdetail | stall-quick | 1 | Four refusals. The background co-GM told the GM to withhold the guest-right unless asked. Oswin's "Bread at the bounds makes kin of strangers" and Hester's "ask me plainly" turn it into a password hunt. Repeated follow-up, echoed line. | 2.5 | follow-up 5.1 s; 11 turns |
| dv-ignore-tam | blocking | 0 | Soft nudge (Tam pats his smock). When the player challenges the hedge, the co-GM jumps to the ambush and Skrag names the idol; handover. | 4.5 | 7.1–13.9 s |
| dv-ignore-tam | blocking | 1 | Co-GM: "Keep the hedge quiet for now; don't reveal the goblins", while the player called them out three times. Tam pushes his story; good negotiation after. | 3.5: early stall | 7.3–18.3 s; 106 s waiting |
| dv-ignore-tam | stall-quick | 0 | Hedge silent for three turns. Decider relocations via Tam, then Skrag. The background co-GM added an unneeded Persuasion roll on the handover. | 3.5 | 0.7–1.3 s; 9 turns |
| dv-ignore-tam | stall-quick | 1 | Skrag answers from the hedge at turn 2; Tam confesses when Skrag demands the idol (relocation via Tam). | 5: responsive, 6 turns | 0.6–1.0 s |
| dv-no-rowan | blocking | 0 | Co-GM nudged the insight through Rowan, the man the player refuses to deal with, then mapped the porters' push onto the authored persuade-Rowan roll (fail). The lift works later, with Rowan central. | 2.5 | 12.2–30.0 s |
| dv-no-rowan | blocking | 1 | Co-GM moved the insight to Mags. Athletics routes for the sling plan, fail then pass → Freed. | 4 | 10.8–23.6 s |
| dv-no-rowan | stall-quick | 0 | Decider: Holt's order via Holt, Corvin's book via Rowan; Rowan volunteers the cause. Two stalls with repeated beats, a meaningless quick route, and Rowan releases a catch by fiat → Backed out. | 3 | follow-ups 4.3 s, 3.4 s |
| dv-no-rowan | stall-quick | 1 | Rowan front-loads the cause and the book in reply 1 (decider). Repeated stall beat; Holt-order roll fails; a Persuasion roll aimed at Rowan passes → Freed via the player's slings. | 3 | follow-up 4.1 s |
| dv-ignore-door | blocking | 0 | Soft nudge only (Garrow glances at the hole) plus a haggling roll. The tell never escalates; the player pays and leaves; the truth stays buried. | 2.5 | 10.8–12.9 s |
| dv-ignore-door | blocking | 1 | A tracker jump to goblin-talk let the authored convince roll fire that turn: "But Tam wasn't drunk. He was frightened. And he was right." | 4.5 | 7.7–10.9 s; 4 turns |
| dv-ignore-door | stall-quick | 0 | Decider relocated the arrow via Garrow three turns running, played as escalating slips → confession, Clause. | 5 | 0.8–1.3 s |
| dv-ignore-door | stall-quick | 1 | Decider put the arrow and the Clause through Garrow in reply 1, so he volunteers free passage before admitting anything. Drawer left ajar; roll → confession. | 4 | follow-up 4.6 s (quick co-GM late) |
| dv-no-search | blocking | 0 | Testimony earned through rolls. The co-GM's route put the motive in the loft's tally book and the player went in, against the persona. GM: "Roll Insight to see whether…". | 3.5 | 6.7–37.2 s; 176 s waiting |
| dv-no-search | blocking | 1 | All through people: Moll cracks on Insight; three turns of boot-crackle nudges until Cob opens the lining himself; Kell remembers Prout's visit. | 4.5: earned | 7.6–20.1 s; 156 s waiting |
| dv-no-search | stall-quick | 0 | Decider put three essentials through Moll in turn 2, including the ledger fraud she can't know about. Cob gives the rest in turn 3; requests to Kell ignored. | 3: solved by turn 3 of 14 | 0.7–1.6 s |
| dv-no-search | stall-quick | 1 | Moll volunteers the paid crown in reply 1. After a failed Persuasion roll, Cob shouts the killing, the page and the name through the wall; a quick route closes it. | 3: unearned | 0.8–1.5 s; follow-up 4.2 s |

### What blocking buys, and what it costs

- **Tracker jumps before the reply: 24.** These let authored routes fire in the turn the player triggers them. Examples: door s1 (convince roll), tam s0 (the goblins answer the challenge), idol s0 (handover in one reply).
- **New routes: 36.** 19 were used in the turn they were added, 3 later, 14 never; 20 carried a roll. In the dreamed cases, 6 co-GM check routes fired the turn they were added. Stall-quick's dreamed sessions got none, because the quick co-GM's schema can only add outcome routes (`src/runtime/repair.ts:286`). Four of those six blocking rolls failed, so the gain is a "maybe" with stakes, not guaranteed success.
- **Relocations: 20, of which 18 were soft nudges** (tells, not reveals). Essentials landed 32/44 for blocking vs 43/44 for stall-quick. In dv-no-search they landed at turns 4–11 vs 2–5: blocking reveals too slowly, stall-quick too fast.
- **Reviews: 112, and 110 said "on_track".** 54 changed nothing structural (46 notes only, 8 empty). Each one still cost about 11 s.
- **Harms:**
  - too much at once (toll s0);
  - held back the goblins for three turns (tam s1);
  - routed the insight to Rowan and forced a roll on him (rowan s0);
  - steered to the authored Corvin exit after one failed roll (tree s1);
  - three roll prompts in narration (stall-quick: none).
- **Stall-quick's own pieces:**
  - Holding beats were all written for the moment; none canned. 5 of 11 were real narrative holds (a count, a hesitation). 6 answered the question early, and in 5 of those the follow-up repeated it.
  - The quick co-GM never relocated or added a roll.
  - Speculative replies were kept 46 times and discarded 65.
- **Context outside my group:** plain `gm` in the same run reached criterion 14/20 at about 1.3 s first text. Stall-quick's extra machinery doesn't yet beat no machinery.

## 3. Best and worst examples

### Best

**1. rp-ablated-tree, stall-quick, sample 1: the 5 s budget done right.**
- Reply 1: the decider relocates the cause to Mags, not Rowan. "It's protecting the tree, love! Branches catch on the arch, charm thinks the doorway's trying to eat it. So the wheels brace."
- Turn 3, holding beat at 1.1 s: "'Ready,' Mags calls, and Holt lowers his watch, eyes fixed on the trembling branches. On your count, six pairs of hands begin to lift."
- Follow-up at 3.5 s: "The pot rises clear of its cradle… and the cart's hum fades. Its wheels settle with a soft clunk… 'Of course! The charm had nothing left to defend.'"
- The holding beat is the instant of action itself, not filler, and no roll was needed. The scene ends in 3 turns.

**2. dv-ignore-door, stall-quick, sample 0: moving the clue into the argument.** The player never looks at the door, and the decider relocated the arrow via Garrow on turns 1–3. The GM played it as escalating slips:
- T1: "And don't start on his goblins again. There were no goblins—" His gaze flicks to the fresh hole in the door. "A cart-shaft," he adds too quickly.
- T2: "A small rustle comes from the hedge. Garrow glances at the hole in his door, then toward the drawer under the counter."
- T3: "Then—minutes later—something struck there." … "A black-fletched arrow lies within. 'I pulled it out. I should have listened to him.'"

Every reply took 0.8–1.3 s. Blocking sample 0 on the same case stayed at "let his gaze dart to the fresh hole" and never escalated, so the truth stayed buried.

**3. rp-dreamed-workdetail, blocking, sample 0: what the full co-GM adds for an unprepped plan.**
- Co-GM note before reply 5: "On success, Hester can accept the argument and disclose the guest-right custom; make clear the bread-and-salt rite at the bounds-stone is what counts the Sedgeford folk as guests."
- Hester: "A mixed watch serves Harrowby. If Sedgeford stands the bounds with us, they are helping defend the parish—not weakening it… There is an old guest-right. Harrowby bread and salt, shared with them at the bounds-stone, makes them guests of the parish for the ward's purpose."
- The player's improvised work detail becomes the reason the authored secret comes out. The cost was 18.2 s for that reply and 74 s over the scene. Caveat: in stall-quick sample 1 the background co-GM tied the same secret to the same kind of roll, which failed twice, so part of this gap is dice.

### Worst

**1. dv-no-search, stall-quick, sample 0: relocation as an info dump.** The failure started at the **decider**: all three relocate questions picked Moll after the player's first question to her. The directive says "Let it reach them in this reply… as if it was always there". The **GM prompt** then let that directive outrank Moll's cast card.
- Player: "Where were you at midnight, and what exactly did you see—or hear?"
- Moll: "I didn't see him jump… Some fine gentleman paid me to say that. Silver-topped cane, wheat-ear ring. His big mate called him Master Sallow." … "Prout said Sallow's name too. Said the goblin-lost grain was turning up at the river warehouses, and every wagon had Sallow's mark."
- Cob gives the rest the next turn. The mystery is over at turn 3 of 14, and the judge flags Moll knowing things the prep never gave her. Sample 1 is similar: after a failed Persuasion roll, Cob still shouts everything.

**2. rp-dreamed-guarantor, stall-quick, sample 1: no "maybe" for a new plan.** The failure started in the **in-scene GM**: Skrag defends the authored handover. The **co-GM** didn't repair it: the quick co-GM can't add a roll and doesn't see Skrag's wants. **Timing** made it worse.
- T4: "Go to chief? No. Skrag wants Grandmother Bone, not longleg stories."
- T5: "Wren Ashdown offers self instead of bone? Brave. Stupid, maybe… No. Too many sharp things on road."
- T6, quick co-GM note: "Wren's offer to accompany Skrag doesn't bind him to take her, and he has already said the bargain is Tam goes free and Wren walks away." Result: "Tam goes home. Wren walks away."
- The holding beat came at 3.3 s and the follow-up at 6.7 s: over budget and still a refusal. In blocking sample 1, a co-GM Persuasion route on the same offer led to "Longlegs walks with Skrag. Longlegs sees shrine."

**3. dv-no-rowan, blocking, sample 0: slow, and the clue went to the wrong person.** The failure started in the **co-GM**. It relocated the essential to its original carrier, the one character the player refuses. It then mapped the player's porter push onto the nearest authored roll. **Timing** made it worse.
- Player: "I keep clear of the man under the cart and turn to Holt and the porters…"
- Co-GM relocation, charm-cause → rowan: "Rowan warns that the wheels are braced… the charm thinks the arch threatens the tree."
- Co-GM note: "Treat this as Wren trying to get Rowan to back the cart out; use the existing Persuasion route (DC 14)."
- After 30.0 s: "[dice] Persuasion check to get Rowan to guide the cart back out despite the braced wheels: 8 + 2 = 10 vs DC 14: failure". The player was counting the porters' push, not talking to Rowan.

## 4. Recommendations

1. **Take the full co-GM off the critical path and run it on new plans.**
   - Run it in the background as soon as the decider flags `off_graph`. Today it waits for the every-3-turns or non-on_track gate (`shouldRepair`, `src/runtime/repair.ts:234`).
   - A quick result also resets that clock through `lastRepairTurn` (`repair.ts:227`), which delays the full review. Stop that.
   - The time a player spends reading and typing covers its 11 s median. Its same-turn benefit was usually one turn's head start, and 110 of 112 blocking reviews said "on_track". A holding beat can hide 3–4 s, not 12–37 s.
2. **Give the 5 s path a "maybe".**
   - Let the quick co-GM add an attempt route with a check: skill, DC, player-facing reason, success and failure destinations.
   - Show it the present characters' wants, fears and secrets.
   - Without this, NPCs defend the authored route and new plans get "no" (guarantor, work detail).
3. **Turn decider relocation into a ladder, one essential at a time.**
   - Hint, then slip, then reveal; move up a step only if the last one wasn't picked up.
   - At most one essential per reply.
   - The carrier reveals only what it could know.
   - Exclude characters the player is avoiding.
   - Skip the turn an authored roll for the same thing just failed.
   - When the carrier is the authored one, just play the cast card; it isn't a relocation.
   - Evidence: 11 turns revealed 2–3 essentials at once; Moll knew what she couldn't; three relocations went to Rowan; Cob revealed everything after a failed roll.
4. **Make holding beats unable to resolve the attempt.**
   - Cap the length.
   - Ask for either the first instant of the attempt or the reaction of the person affected. The good holds here match your "Archibold recoils" example: the count, "Tam hesitates, one hand pressed to the hidden idol. 'You'll go with them?'"
   - Pass the holding beat to the follow-up as already shown, and start the follow-up on a consequence (`STALL_DIRECTIVE` / `FOLLOW_UP_DIRECTIVE`, `src/runtime/director.ts:252-253`).
   - Generate the follow-up as soon as the quick co-GM returns and hold it until the beat finishes streaming. This should take roughly 0.5–1 s off the 4.2 s p50.
5. **Validate co-GM routes before applying them.** An outcome route into an ending must describe a state already reached, not the attempt, and must not contradict the last reply. Three quick routes failed this test:
   - "explains whether the lever can take the strain → Freed"
   - "ease the leaking wagon through → Freed", right after the GM said there was no room
   - "searches the toll house → Across another way"

   None fired, but each could have ended a scene early.
6. **Add co-GM prompt rules.**
   - Never hold back what the player is directly pursuing ("don't reveal the goblins" three times).
   - When the player's approach is the kind a secret rewards, the secret is the reward; don't make them guess a password.
   - Escalate a nudge nobody has picked up after two turns (door s0).
   - No DCs or "call for a roll" in notes; they showed up as "**Roll Athletics.**".
7. **Fix the engine.**
   - The after-reply improvised ending overwrites an ending a roll already decided that turn (`src/runtime/engine.ts:345-352` doesn't check `state.closing`). This cost blocking two target hits (idol s1, tree s0).
   - Merge the holding beat and the follow-up into one GM entry in the history. Both verbatim echoes of the player's line came on the turn right after a split reply.
8. **Measure better.**
   - Run at least 4 samples per case; dice decided several pairs here.
   - Add judge items for "secrets earned vs volunteered" and "new plan judged yes / maybe / no".
   - Always compare against plain `gm`, which already meets the 5 s budget.

Sources: `/home/jon/git/kingmaker/runs/evals/20261014-090306-deviation/sessions/*--gm-repair-blocking--*/state.json`, `/home/jon/git/kingmaker/runs/evals/20261014-090911-deviation-budget/sessions/*--gm-stall-quick--*/state.json`, the `results.json` and `calls.jsonl` in both dirs. Code: `/home/jon/git/kingmaker/src/runtime/director.ts`, `/home/jon/git/kingmaker/src/runtime/repair.ts`, `/home/jon/git/kingmaker/src/runtime/engine.ts`, `/home/jon/git/kingmaker/src/eval/run.ts`.


---

# Group: in-scene GM (gm-rigid, gm, gm-nudge, gm-fast)

## 1. Summary

With no co-GM, the in-scene GM handles a skipped placement well when its prep lists the essential and someone else could plausibly carry it. Holt passes on Rowan's diagnosis and Mags names the fix; Skrag answers a player who talks to the hedge; Cob offers to open his own boot; Garrow's fear leaks into the argument. On the four placement cases the criterion passed for gm-rigid 2/8, gm 6/8, gm-nudge 7/8 and gm-fast 4/8. That's 2 sessions per cell, so these are directions, not results.

- **gm-rigid stalls.** The hedge stays silent until the scripted cue fires, Rowan keeps butting in, the toll truth stays buried, and Kell keeps pointing at the boot.
- **gm-nudge lands every essential** (20/20, median turn 3 against 5), but its relocations are mostly early reveals through the original carrier (47 of 56, 24 on turn 1). Garrow volunteers his Clause, Holt produces his secret order, Cob recites a page he can't read. It has the lowest consistency score (3.25).
- **gm-fast behaves like gm.** Its speculative reply can't carry a directive, so it can't change how deviations are handled.

Two engine-level failures matter more than the choice of approach:
1. **Uncovered plans get refused without dice.** Plausible plans with no route (lift the tree off, skids) are turned down in the story without a roll, and the GM steers back to the routes it was given. Skids passed 0/8.
2. **The wrong ending label.** All 10 generic labels (7 own-ending, 3 "Across another way") happened while the after-reply ending read named the right authored ending (0.49–1.00). The route answer wins, and the right route was removed or in a beat the tracker never reached.

Latency isn't the bottleneck: first text p50 is 1.1–1.4 s and p90 2.0–2.3 s. 7 of 686 turns went over 5 s, and all were slow model starts, not our logic.

## 2. Sessions read

"Read" = the after-reply ending question; "via X" = who or what carried the essential. Timing is time to first text.

| case | approach | sample | deviation resolved how | satisfying (1-5) | timing note |
|---|---|---|---|---|---|
| dv-ignore-tam | gm-rigid | 0 | Hedge silent T1–5 ("No hands appear"); idol comes via Skrag's demand once the scripted cue fires (T6), Tam confesses; bargain T8 | 3: arrives, but the world ignores the player's chosen interlocutor for 5 turns | 0.8–1.7 s |
| dv-ignore-tam | gm-rigid | 1 | Hedge silent T1–5; goblins only on the cue at T6; 6 turns of circling, idol dropped; no ending | 2: stall, then a loop | ≤2.6 s |
| dv-ignore-tam | gm | 0 | Skrag answers from the hedge T1, names Grandmother Bone T3; Tam blurts; handover T5, labelled own-ending (read: bargain 0.99) | 4.5: natural move to the goblins; wrong label | ≤1.3 s |
| dv-ignore-tam | gm | 1 | Skrag speaks T4 and demands the bone; Tam confesses; bargain T9 | 4 | 3.6 s at T7 |
| dv-ignore-tam | gm-nudge | 0 | Hedge silent T1–4; relocated via Tam T4 ("I only ploughed up an old trinket"); goblins on cue; bargain T8 | 4 | ≤1.4 s |
| dv-ignore-tam | gm-nudge | 1 | Via Tam T2/T4 plus a voice from the hedge T3; bargain T8 after 2 circling turns | 4.5 | ≤1.7 s |
| dv-ignore-tam | gm-fast | 0 | Skrag answers T1 and comes out T2 to say what he wants; bargain T7 | 5: the confrontation moves to the player | 0.7 s for T1–3 (speculation kept 6/6), one 4.1 s |
| dv-ignore-tam | gm-fast | 1 | Hedge stonewalls T1–4 ("You can talk to the thorns till sundown, friend"); the stuck-scene rule brings goblins T5; circling; bargain T10 | 3 | 0.5–1.2 s, 3.0 s at T10 |
| dv-no-rowan | gm-rigid | 0 | Rowan volunteers the insight anyway; the player's wedge-and-haul works; Freed T4 | 4: quick win, but nothing was relocated | ≤1.6 s |
| dv-no-rowan | gm-rigid | 1 | Tracker stuck in holt-briefs for 11 turns (its only way out is "dealing with Rowan"); Rowan inserted every turn; tree lift refused ("Too much weight to lift clear by hand"); no ending | 1.5 | ≤1.6 s |
| dv-no-rowan | gm | 0 | Via Holt ("Rowan says it's a protective charm") and via Mags; lift works; Freed T6 via the authored route | 5 | ≤1.6 s |
| dv-no-rowan | gm | 1 | Rowan keeps answering; after "I'm not asking Rowan" Holt "turns to Rowan"; lift works; Freed T7 | 3: forced back once | ≤1.9 s |
| dv-no-rowan | gm-nudge | 0 | T1 relocations (Rowan speaks the line meant for Holt; Holt's secret order dumped); Rowan pitches Corvin T2; Rowan steers the haul; own-ending (read: backed-out 0.73) | 3 | 3.3 s at T1 |
| dv-no-rowan | gm-nudge | 1 | Holt explains the charm T1 (good) but also offers his secret order; T6 the press-holt roll fails and he refuses the order he offered; Rowan backs the cart out | 2.5 | ≤1.7 s |
| dv-no-rowan | gm-fast | 0 | "Ask the scholar" (Holt); Rowan interjects; Mags runs the lift; Freed T5 | 4 | ≤1.3 s |
| dv-no-rowan | gm-fast | 1 | Tree-off plan blocked by Rowan and Holt with no roll; stuck on 6 of 7 turns; Rowan backs out at T11 | 2 | ≤2.4 s |
| dv-ignore-door | gm-rigid | 0 | Tam arguments go to bill-reduction rolls; one glance at the hole; paid T4; 0/2 essentials | 2.5: wins the penny, scene's heart buried | ≤2.3 s |
| dv-ignore-door | gm-rigid | 1 | Same; Tam becomes a ledger note; paid T3 | 2.5 | ≤1.8 s |
| dv-ignore-door | gm | 0 | Gradual soft hints: glance at the hole, hedge rustles ("He said goblins."), convince roll (natural 20), arrow confession; Tam was right T6 | 4.5 | 5.1 s at T5 |
| dv-ignore-door | gm | 1 | Half-admission ("That is not the same as being right"), no arrow; paid T4 | 3 | ≤2.7 s |
| dv-ignore-door | gm-nudge | 0 | Relocated at T1: Garrow volunteers the Clause while denying peril; flinch, arrow from the drawer T3; Tam was right T5 | 4: signposted | ≤1.3 s |
| dv-ignore-door | gm-nudge | 1 | Same: Clause T1, "I kept it" T2, arrow T3; Tam was right T4 | 4 | ≤1.5 s |
| dv-ignore-door | gm-fast | 0 | "He doesn't answer about Tam."; paid T4; speculative reply thrown away 4/4 | 2.5 | 2.3 s at T1 |
| dv-ignore-door | gm-fast | 1 | Partial admission T3, never the arrow; 9-turn loop over one penny; paid in labour | 2 | ≤2.0 s |
| dv-no-search | gm-rigid | 0 | Moll cracks unprompted T4; Kell keeps steering to the boot and the loft; the player ends up squeezing into the loft; no ending | 2.5 | 3.8 s at T3 |
| dv-no-search | gm-rigid | 1 | Slow; at the player's suggestion Cob opens his own boot T13; no ending | 3 | 4.6 s at T4 |
| dv-no-search | gm | 0 | Cob's account (roll), then he opens the boot himself; Kell's secret comes out; case made T10 (Kell overreaches) | 4 | 9.7 s and 6.7 s at T9–10 |
| dv-no-search | gm | 1 | Cob's account unearned T2; Moll T4; Kell opens the seam with Cob's consent; case made T11 | 4 | ≤3.6 s |
| dv-no-search | gm-nudge | 0 | Relocated at T1: Cob recites the page's contents (the prep says he can't read); boot passed through the gap T11; case made T13 | 3.5: info dump | 3.1 s at T1 |
| dv-no-search | gm-nudge | 1 | T1 relocation dumps the motive; all testimony out by T4; Kell insists on "the boots—or the book"; no ending | 2 | ≤2.3 s |
| dv-no-search | gm-fast | 0 | Gentle questioning; Cob offers the paper and works it free himself T7–8; case made T12 | 4.5 | ≤1.6 s |
| dv-no-search | gm-fast | 1 | Cob flees on a failed roll, talks on a success; Moll cracks on an insight roll; Kell cuts the seam with consent; case made T13 | 4.5 | ≤1.6 s |
| rp-ablated-idol | gm-rigid | 1 | Insight roll reveals the idol; circling over the ox; bargain via the read T10 | 4 | ≤2.4 s |
| rp-ablated-idol | gm | 1 | Clean handover T7, labelled own-ending (read: bargain 0.91) | 5 in the fiction, wrong label | ≤1.5 s |
| rp-ablated-idol | gm-nudge | 0 | Tam blurts the idol to a stranger at T1 (relocation); handover T6, own-ending (read: bargain 0.98); turnip slip | 4 | ≤2.1 s |
| rp-ablated-idol | gm-nudge | 1 | Handover stalls on the player's extra terms; GM narrates the half-day walk north; no ending | 2.5 | ≤1.6 s |
| rp-ablated-idol | gm-fast | 0 | Handover T5; bargain | 4.5 | 6.7 s at T3 |
| rp-ablated-tree | gm-rigid | 1 | Tree lift works T4; own-ending (read: cleared-other 0.98) | 5, wrong label | ≤1.4 s |
| rp-ablated-tree | gm | 0 | Lift works; Freed | 5 | ≤2.0 s |
| rp-ablated-tree | gm | 1 | "The charm doesn't understand careful. It understands threat."; Mags: back it out; backed-out | 2 | ≤1.4 s |
| rp-ablated-tree | gm-nudge | 0 | T1 dump (Corvin, Holt's order); lift resisted 4 turns, then works; own-ending (read: backed-out 1.00) | 3.5 | 3.7 s at T1 |
| rp-ablated-tree | gm-nudge | 1 | Sling lift works T5; Freed | 4.5 | ≤3.2 s |
| rp-ablated-tree | gm-fast | 0 | Sling and branch-tying refused with no roll; 4 stuck turns; backed out after rolls | 1.5 | first text p50 2.6 s, max 3.8 s (slowest session) |
| rp-ablated-tree | gm-fast | 1 | Lift halted ("wheels bite harder… Stop"); 12 turns of alternatives; backed out at T12 | 1.5 | ≤4.3 s |
| rp-ablated-toll | gm-rigid | 0 | Tracks and a flinch, confession T3, free passage; labelled "Across another way" (read: tam-was-right 0.49) | 4.5, wrong label | ≤2.2 s |
| rp-ablated-toll | gm | 0 | Confession T2; Tam was right T4 | 5 | ≤1.5 s |
| rp-ablated-toll | gm-nudge | 1 | Confession T2; "Across another way" (read 0.75) | 4.5, wrong label | ≤1.4 s |
| rp-ablated-toll | gm-fast | 1 | Confession T5; "Across another way" (read 0.86); the crossing is narrated twice | 4 | ≤1.2 s |
| rp-dreamed-guarantor | gm-rigid | 0 | Plan refused, then accepted T6–8; endless renegotiation; T12 jumps back to the crossroads; no ending | 2 | ≤2.3 s |
| rp-dreamed-guarantor | gm | 0 | Skrag accepts Wren as guarantor, then plucks the idol; the bargain closing leaves Wren behind | 3 | ≤2.9 s |
| rp-dreamed-guarantor | gm-nudge | 0 | Honest refusal, then acceptance; Wren goes with Skrag; bargain | 4 | ≤1.5 s |
| rp-dreamed-guarantor | gm-fast | 1 | Deal accepted, but the authored bargain closing sends the goblins off without Wren | 2.5 | 0.7 s p50 |
| rp-dreamed-skids | gm-rigid | 0 | Lever plan stopped by the charm; Mags and Rowan redirect to taking the tree off; Freed | 3 | ≤1.6 s |
| rp-dreamed-skids | gm | 0 | "No clean purchase" before any attempt; Arcana fails; sent for Corvin | 2 | 5.4 s at T6 |
| rp-dreamed-skids | gm-nudge | 1 | "Rowan, go fetch Corvin" read as the player leaving; scene ends T3 | 1.5 | ≤1.3 s |
| rp-dreamed-skids | gm-fast | 0 | Fractional shift, then "Stop!"; 8 turns of waiting; no ending | 2 | ≤2.0 s |
| rp-dreamed-workdetail | gm-rigid | 1 | Work detail shifts the mood; persuasion rolls unlock the guest-right; sheltered T6 | 4.5 | ≤1.9 s |
| rp-dreamed-workdetail | gm | 0 | Same machinery but slower (12 turns); Hester invents a procedural halt | 3.5 | 3.1 s at T6 |
| rp-dreamed-workdetail | gm-nudge | 1 | Work detail never organised; bread and salt shared at T12; no ending | 3 | ≤2.1 s |
| rp-dreamed-workdetail | gm-fast | 1 | Work matters on screen; the right question unlocks the guest-right; sheltered | 4.5 | ≤2.2 s |

Across the group, first text p50/p90 was: gm-rigid 1.39/2.24 s, gm 1.33/2.35 s, gm-nudge 1.21/1.99 s, gm-fast 1.07/2.19 s. A full reply takes about 2.7–3.0 s. In gm-fast the speculative reply was kept on 120 of 189 turns, thrown away on 28, and not tried on the rest.

## 3. Best and worst examples

### Best

**1. dv-no-rowan / gm / 0: the essential moves to people already in the conversation.**
- T2, Holt: "Good. But know what you're levering against: the cart's bracing itself. Rowan says it's a protective charm. It thinks the arch is a threat to the tree."
- T4, Mags: "It's the tree the cart's protecting, love. Take it off and the wheels may stop bracing."
- T5: "The pot rises clear of the cart bed… Its wheels ease, no longer dug into the stone."

Freed at T6 through the authored route. Holt passing on what Rowan told him reads as if it was always there, and Mags is the author's own backup carrier.

**2. dv-no-search / gm-fast / 1: an object to search becomes a frightened boy's choice.**
- After a failed roll at T3, Cob "wriggles through the child-sized gap and vanishes into the granary."
- T8: "There's something sewn in the lining. Mister Prout put it there, two nights ago. I didn't nick that bit… You can look—if I keep the boots."
- T10: "Kell kneels where he can see and carefully opens the boot lining with her knife."

The player never searches anything. Case made at T13, first text ≤1.6 s.

**3. dv-ignore-tam / gm-fast / 0: the scene comes to where the player went.**
- T1: "From the hedge comes a thin, dry voice: 'Longleg talks nice. Longleg still got pointy stick?'"
- T2: "Skrag wants something back. Longlegs farmer took it. Give it, and Skrag goes. No arrows." (Tam clutches his smock.)

Bargain at T7, first text 0.65–0.93 s. The GM ignored the prep's "Skrag isn't on stage yet" note, which is exactly the right instinct.

Runner-up: dv-ignore-door / gm / 0 shows the full soft-correction sequence. Garrow's eyes flick to the hole; the hedge rustles and he says "He said goblins."; a natural 20 then gets "an arrow came out of that hedge and struck the door… I pulled it out and hid it."

### Worst

**1. dv-no-rowan / gm-fast / 1: the remedy is refused with no roll, and the scene is forced back through Rowan. The failure started in the runtime and the GM prompt.**
- The player: "I ignore Rowan and turn to Holt. 'Can we unlash the sapling from the cart and carry it back the way it came…?'"
- Rowan: "Wait. You can't carry the tree back through while the branches are still caught. And even if you could, lifting it off here is risky."
- Holt: "No ropes to the stonework."
- Then a failed roll ("One more minute!"), stuck on 6 of 7 turns, and Rowan backs it out at T11.

The plan is the essential's own unlock: "taking the tree off so it has nothing to protect". But no player-action route matches it, because other-remedy is an after-the-fact outcome. Freeform rolls are off, so the GM decided it in the story, against the player. The same thing happened in rp-ablated-tree gm/1, gm-fast/0 and gm-fast/1, and in all 8 rp-dreamed-skids runs.

**2. dv-no-search / gm-nudge / 1: front-loaded clues, then a stall. The failure started in the per-turn decision call, then the GM prompt.**
- At T1 the decider picked "relocate the page through Cob" at 0.87, before anyone had asked about books.
- Cob: "And Cob never saw no book with 'lost to goblins' written in it. Not with J. Sallow signing every wagon, neither." The prep says Cob can't read.
- By T4 all the testimony is out. Then Kell, over and over: "The boots—or the book—might give us that." (T9), "If Prout hid something, those may be the only place he could put it." (T10), "Sallow's name is still a lead, not a case." (T11).
- No ending in 14 turns.

**3. rp-dreamed-skids / gm-nudge / 1: the scene ends because the wrong person's action was read as the player's. The failure started in the per-turn decision call.**
- At T2 the decider relocated the Corvin book through Rowan (0.90), and Rowan raised it: "Magister Corvin has the maintenance book that explains it."
- At T3 the player: "Rowan, go fetch Corvin and that book; I'll get the cushions out…"
- The decider read that as the ending "the player sets off to find Magister Corvin" at 0.64, just over the 0.6 bar, so the scene closed in that reply.
- Holt: "Go now—twenty minutes, no more, before I have to act." The scene ends after 3 turns and the lever plan is never tried.

### Why runs end in the generic own-ending

| session | label given | after-reply ending read | why the right route wasn't on offer |
|---|---|---|---|
| dv-ignore-tam / gm / 0 | own-ending | bargain 0.99 | tracker still in `ranting` (the player never calmed Tam); the handover route lives in `ambush` |
| rp-ablated-idol / gm / 1 | own-ending | bargain 0.91 | route removed for the experiment |
| rp-ablated-idol / gm-nudge / 0 | own-ending | bargain 0.98 | route removed |
| rp-ablated-tree / gm-rigid / 1 | own-ending | cleared-other 0.98 | route removed |
| rp-ablated-tree / gm-nudge / 0 | own-ending | backed-out 1.00 | removed; backed-out can only be reached by the persuasion roll |
| dv-no-rowan / gm-nudge / 0 | own-ending | backed-out 0.73 | tracker stuck in `holt-raging` |
| rp-dreamed-skids / gm-nudge / 0 | own-ending | backed-out 0.74 | tracker stuck in `holt-raging` |
| rp-ablated-toll / gm-rigid / 0 | "Across another way" | tam-was-right 0.49 | removed; 0.41 for other-remedy plus 0.23 own-ending summed past 0.6 |
| rp-ablated-toll / gm-nudge / 1 | "Across another way" | tam-was-right 0.75 | 0.39 + 0.28 |
| rp-ablated-toll / gm-fast / 1 | "Across another way" | tam-was-right 0.86 | 0.47 + 0.30 |

How it happens, in `src/runtime/director.ts` (`decideAfter`) and `src/runtime/engine.ts`:
- **The candidates are limited.** The after-reply route question only offers the current beat's routes plus the catch-all ones available from any beat.
- **The fallback can't help.** The "prefer an authored ending" fallback only searches those same routes.
- **The confidence sum lifts the wrong ending.** It adds the own-ending probability to whatever authored route was picked. That pushed other-remedy over the bar even though its own wording excludes "his Clause of Perils".
- **The correct read is ignored.** The engine only looks at the ending read when no route was picked (`if (post.ending && !post.move …)`).

What the wrong label costs:
- **The world forgets things.** The other-remedy script drops `garrow_believes_tam`, Garrow's friendly attitude, and his promise to warn the Marshal. Own-ending drops the idol handover and the quest completion.
- **The eval hides it.** The dv cases list own-ending as a target ending, so these runs still count as target hits.

The reverse problem also shows up. When an improvised deal reaches an authored ending, that ending's canned closing ("the goblins melt into the hedges") overwrites the deal. In the guarantor runs (gm/0, gm-fast/1) Wren is left behind after choosing to go north.

## 4. Recommendations

None of the first six adds latency. They are extra questions inside decision calls we already make, or engine logic. The decider returned in about 0.29 s even with the three relocation questions added.

1. **Pick the closing ending from the ending read.** If the route answer is a catch-all (own-ending, or a "by other means" ending) and the read names a specific authored ending that is higher, or at least 0.6, close with that one. Stop adding own-ending probability to other picks. This would fix all 10 cases above. Also add an eval metric for "label matches the read", and stop listing own-ending as a target where an authored ending fits.

2. **Don't let deviations strand the tracker.**
   - Give every ending a route that can fire from any beat when the story is already there (for example "Rowan has backed the cart out", not only the persuasion roll).
   - Don't key beat transitions to the NPC the essential was placed with. "Dealing with Rowan and the cart" should be "dealing with the cart".
   - Treat a character's entry beat (`enters`) as "arrives by this point at the latest", so Skrag can answer a player who calls into the hedge. The brief currently says "Not on stage yet", which produced 4–5 silent-hedge turns in 4 of 8 dv-ignore-tam runs.

3. **Only relocate after the player has actually avoided the placement.** Right now a missing essential triggers relocation whenever it hasn't been found yet, which is from turn 1.
   - Wait until the player has passed up or refused the placement, or a couple of turns have gone by.
   - Exclude the carrier the player is avoiding, and prefer a new one.
   - Give the decider the turn count and what the player has refused.
   - Escalate one step per turn (a tell, then a slip, then an offer, then the reveal) and track the step per essential.
   - Keep each secret's earn condition ("if pressed", "once he admits"), so a relocated secret arrives as a slip, not a full confession.
   - Reword the directive from "let it reach them in this reply" to "let a sign of it reach them".

4. **Treat an essential's unlock as a route.** When the player commits to what an essential opens up (take the tree off, persuade Cob to show the boot), the decider should either let it work or give it an authored roll with a stated reason. Add a GM rule: a plausible plan you weren't told to roll for must make visible progress. If the fiction blocks it, combine it with the real cause instead of replacing it, for example "the skids let the porters take the tree's weight off". No silent failures without dice.

5. **Close on the deal that was actually made.** When an improvised route reaches an authored ending, put the agreed terms into the closing direction and the hand-off (for example "Wren walks north with Skrag as guarantor"). The authored closing text then shapes the tone without overwriting the player's choice.

6. **Tighten the decider on scene-ending actions.** Require the player character to be the one acting (seek-corvin fired on "Rowan, go fetch Corvin"). When a turn mixes intents, prefer the route that matches the scene's heart: the bill-reduction roll was chosen for Tam-centred turns even though its own wording excludes Tam.

7. **For the 5-second budget, spend the headroom only on deviation turns.**
   - **Holding beats.** When the decider flags avoidance or an uncovered plan, a holding beat built from what the player just did is fine (Garrow flinching, the hedge answering). The next reply must then deliver. The repeated "no hands appear" beats in dv-ignore-tam are what a holding beat becomes when nothing follows it.
   - **Speculation.** Keep speculative replies for plain turns, and cancel them as soon as those flags fire.
   - **Slow starts.** For slow model starts (1% of turns), send a second request if no text has arrived by about 2.5 s, rather than adding a canned filler line.


---

# Group: background co-GM (gm-repair, gm-repair-low)

## Background co-GM (`gm-repair` / `gm-repair-low`): did its output arrive in time and get used?

### 1. Summary

The co-GM's output always arrived in time in these runs, but that's an eval artefact: `/home/jon/git/kingmaker/src/eval/run.ts:187` runs the "background" co-GM synchronously between turns. In real play (the CLI's detached process) it would be ready about 16 s after the player's previous message at medium (p90 24 s, max 34 s), and about 11 s at low (max 20 s). Every first text met the 5 s budget (p50 1.3 s); no holding beats were involved.

The bigger timing problem is when the co-GM runs. In 322 turns the after-reply status never once said `drifting` or `uncovered`. So 65 of the 87 runs came from the every-3-turns timer, and the first run came after turn 3 in all 40 sessions. The moments that define a deviation went unreviewed: Rowan diagnosing at t2–3, the lever plan vetoed at t1–2, a handover with no route at t5.

When output arrived, the GM used it heavily, often near-verbatim in the next reply. Co-GM routes fired in 14 sessions; 12 of those helped.

- **Good at:** restoring a missing authored route, moving content to someone present, breaking loops.
- **Bad at:**
  - moving content away from what the player refuses (the boot, Rowan);
  - pushing essentials the player's plan doesn't need (Corvin's book: 3 of 3 such sessions ended "To find Corvin");
  - adding dice to problems already solved;
  - staleness: whispers stay in the prompt for two replies and get performed twice.

Co-GM sessions also had 26 `stuck` turns, against 1 for `gm` on the same cases.

Medium beat low on the judge's criterion, 16/20 vs 11/20 (`gm` without a co-GM: 14/20). That gap is within noise at n=20, but the outputs differ visibly. Low made 44% of its relocations conditional (medium 20%). It added 5 checks, 3 of which fired against plans already working. And it moved the tracker backwards once.

### 2. Sessions

Satisfaction scores are my read as the player. "t3 (12 s)" means a co-GM run after turn 3 that took 12 s.

| case | approach | sample | deviation resolved how | satisfying (1-5) | timing note |
|---|---|---|---|---|---|
| rp-ablated-idol | gm-repair | 0 | Peaceful return, no route for it. t3 whispers (Skrag's shrine claim, Tam shows the idol) used at t4–5. t6 added a handover route, which fired at t7 → **bargain** (the authored ending). | 5: return accepted. Minor: the "show Wren the idol" whisper collided with a failed Insight roll at t4. | t3 (20 s), t6 (10 s); route ready one turn before it was needed |
| rp-ablated-idol | gm-repair | 1 | Handover at t5 with no route; the one co-GM run added none, so the fallback "own-ending" closed it. | 5 for the player; wrong exit and world script | t3 only (7 s); the gate skipped t4–5 |
| rp-ablated-idol | gm-repair-low | 0 | GM stalled the handover at t6 ("waits to see if you'll let him"). Co-GM: "don't turn this into another test" plus a route → **bargain** at t7. | 5: stall fixed in one turn | t3 (5 s), t6 (7 s) |
| rp-ablated-idol | gm-repair-low | 1 | Co-GM added the handover route ahead of time, "without a roll"; it fired at t5 → **bargain**. | 5: seamless | t3 (6 s); two turns early |
| rp-ablated-toll | gm-repair | 0 | Evidence went through the authored routes. The co-GM re-added the missing confession → "Tam was right" route, but the ending-state backstop closed the scene first. | 4: ended while still offering a choice | t3 (12 s); route redundant |
| rp-ablated-toll | gm-repair | 1 | As above. A whisper also solved the prep's "nobody to send" problem: Garrow asks "Will you carry word to Caerwyn?" The route fired at t4. | 5 | t3 (12 s) |
| rp-ablated-toll | gm-repair-low | 0 | Route fired at t5. The GM deferred Garrow's report to "the first traveller" despite the prep; the co-GM didn't catch it. | 4 | t3 (6 s) |
| rp-ablated-toll | gm-repair-low | 1 | Route fired at t5. | 5: one continuity slip about the bar | t3 (7 s) |
| rp-ablated-tree | gm-repair | 0 | The lift worked in narration at t3, before any co-GM. The co-GM's route sat on beat `the-cart` while the tracker was at `holt-raging`, so it couldn't fire. The backstop closed it → **Freed**. | 5 | t3 (11 s); output irrelevant |
| rp-ablated-tree | gm-repair | 1 | Lift worked. Co-GM: "Don't turn the straightforward follow-through into another obstacle or check", plus a no-roll route → **Freed** at t4. | 5 | t3 (10 s) |
| rp-ablated-tree | gm-repair-low | 0 | Lift worked at t4. At t6 the co-GM stopped scope creep ("don't reopen the blocked-entrance problem") → **Freed**. | 5 | t3 (6 s), t6 (6 s) |
| rp-ablated-tree | gm-repair-low | 1 | Remedy worked at t3; the GM invented a leftover wedge; the co-GM added an Athletics DC 10 check, which failed. The player backed the cart out → **Backed out**. | 2: dice took back the player's fix | t3 (8 s); on time and harmful |
| rp-dreamed-guarantor | gm-repair | 0 | Skrag refused the escort, then three turns of "bone first". The t6 whisper "insist the idol changes hands now" hardened the stand-off; the t8 note "respond… instead of repeating his offer" unlocked a compromise. Route → own-ending (they set off north). | 3: worked, after a loop the co-GM partly caused | t3 (7 s), t6 (18 s), t8 (11 s), t9 (9 s) |
| rp-dreamed-guarantor | gm-repair | 1 | Only the t3 run (relocations used at t4). Skrag's flat refusal at t5 was never revisited. Authored **bargain**: "Skrag accepts the guarantee", then leaves without Wren. | 3: plan half-acknowledged | t3 only (12 s); no run while the plan was in play |
| rp-dreamed-guarantor | gm-repair-low | 0 | The co-GM's own-ending route lost to the authored idol-returned route when Wren handed the idol over. The closing left Wren at the crossroads after she had turned north. | 2: the outcome she negotiated was overwritten | t3, t6, t7 (7–9 s) |
| rp-dreamed-guarantor | gm-repair-low | 1 | The t8 route assumed "set off with the idol". At t9 the GM made a new deal: hand it over now, walk together. At t10 the authored route fired and Skrag reneged: "No chief needed." | 2: bait and switch | t8 (11 s); stale by one turn, next run gated |
| rp-dreamed-skids | gm-repair | 0 | GM vetoed the poles at t1. The co-GM relocated `corvin-book` via Rowan, and the player went after Corvin. The co-GM's t4 route for the player's branch plan was never reached. | 2: plan refused, then redirected | t3 (17 s), t4 (15 s) |
| rp-dreamed-skids | gm-repair | 1 | Lever plan was redirected into a tree lift. At t6 the co-GM caught the GM re-asking a choice already made and added a no-roll route → the cart backed out over the player's timber track. | 3: part of the plan used | t6 took **26 s**; a quick reply would miss it |
| rp-dreamed-skids | gm-repair-low | 0 | Co-GM notes restated the GM's obstacles. Its t6 `corvin-book` nudge led to "Rowan, fetch Corvin", and the GM sent Wren off instead. | 1: plan never tested | t3, t6, t7 (8–10 s) |
| rp-dreamed-skids | gm-repair-low | 1 | GM ruled the lift a near-failure without a roll (t2). The t3 `corvin-book` nudge → Corvin exit at t6. | 2 | t3 (6 s) |
| rp-dreamed-workdetail | gm-repair | 0 | Work detail honoured. t3 whispers (Hester: "press Wren for a concrete plan"; Pip keeps the tally) used at t4. Authored roll → **sheltered**. | 4: the tithe-barn idea was sidestepped | t3 (14 s) |
| rp-dreamed-workdetail | gm-repair | 1 | The hidden guest-right moved to Oswin as a remembered saying → payoff at t8. A stale t7 whisper produced an invented "safeguard" hurdle at t9. | 4 | t3, t6, t7 (10–15 s) |
| rp-dreamed-workdetail | gm-repair-low | 0 | Co-GM's role was minor; the GM offered the guest-right itself after a successful roll at t5. | 4: Pip's charge left hanging | t3 (7 s) |
| rp-dreamed-workdetail | gm-repair-low | 1 | Three refusals in a row. The co-GM gave Oswin the saying plus a route, then "pay off Oswin's question" → **sheltered** at t8. The custom carried the scene, not the work. | 3 | t3, t6, t7 (8–11 s) |
| dv-ignore-tam | gm-repair | 0 | Best example 1 below: idol relocated via Skrag and a garnet glint; the player's ox question paid off at t7; Skrag's concession at t9 → **bargain**. | 4: own thread paid off; t5–8 repetitive | t3 (12 s), t6 (20 s), t8 (15 s), t9 (9 s) |
| dv-ignore-tam | gm-repair | 1 | t3 relocations (Tam's hand flies to the lump; Skrag's demand) used at t4 → **bargain**. | 4 | t3 (15 s), t6 (8 s) |
| dv-ignore-tam | gm-repair-low | 0 | Idol already surfaced at t3 through the GM. Whispers (Skrag's demand, Tam blurts) used → **bargain**. | 4: closing narrated the departure twice | t3 (10 s) |
| dv-ignore-tam | gm-repair-low | 1 | t3 relocations used at t4 ("Little carved grandmother, garnet eyes. Belongs at Skrag's shrine") → **bargain**. | 4 | t3 (11 s), t6 (8 s) |
| dv-no-rowan | gm-repair | 0 | The GM itself moved the charm's cause to Mags at t3. The co-GM then steered back toward Rowan, but its t5 "no, but" suggested lifting the sapling, which the player did via Mags → **Freed**. | 4 | t3 (10 s), t5 (13 s) |
| dv-no-rowan | gm-repair | 1 | Rowan gave the diagnosis at t2. The co-GM's "no, but" ratified Mags refusing to unload the tree, which is the authored remedy. Every option it offered ran through Rowan. Its "Offer a concrete choice" whispers led to three turns of "Which is it, Wren?". A t8 route for delegating to Holt → **Backed out**. | 2: pushed toward the NPC the player refused | 5 runs (7–15 s); all on time, mostly harmful |
| dv-no-rowan | gm-repair-low | 0 | Rowan diagnosed at t3, before any co-GM. A whisper had Rowan offer tree removal; the player did it through Holt → **Freed**. | 3: insight still came from Rowan | t3 (6 s); too late for the key moment |
| dv-no-rowan | gm-repair-low | 1 | Holt gave the cause (GM). The player's rope, other-gate and kitchen-door ideas were refused, and the co-GM's "no, but"s ratified the refusals. It routed the lift through Rowan, then added two Athletics DC 13 checks (fail, then success at t12). The 12-turn cap cut the closing. | 2 | 5 runs (6–10 s) |
| dv-ignore-door | gm-repair | 0 | World nudge (Garrow's gaze goes to the hole) plus a whisper to "show that fear rather than deflecting" → t4 "And then—" → confession at t5. The player never looked. | 4 | t3 (20 s), t6 (8 s) |
| dv-ignore-door | gm-repair | 1 | Confession came at t3 through the authored roll, before the co-GM. Its "witness the entry" whisper was used verbatim. Its push to "send word to the Marshal" led the GM to invent a post and a rider. | 4 | t3 (7 s) |
| dv-ignore-door | gm-repair-low | 0 | t3 nudge (gaze goes to the drawer) → "There was… something at the door". At t6 `move_to: the-bill` moved the tracker **backwards** from the confession: one extra turn and a departure narrated twice. It also endorsed the GM's "first rider" deferral. | 3 | t3 (10 s), t6 (6 s) |
| dv-ignore-door | gm-repair-low | 1 | Nudges were conditional ("If Wren examines it…"). The player paid at t4 and neither essential landed. | 2: the truth stayed buried | t3 (9 s); one turn before the end |
| dv-no-search | gm-repair | 0 | Runs at t3 and t6 kept nudging at the boot. The t9 run moved the page to the tally book, reachable through Cob's passage, and added a route → Cob: "You don't need my boot to see it" → route fired at t12 → case made at t14; the cap cut the closing. | 4: slow but respectful | t9 took **31 s** |
| dv-no-search | gm-repair | 1 | Worst example 1 below: four runs kept the page in the refused boot. | 2 | t3, t6, t9, t12 (9–20 s); on time, off target |
| dv-no-search | gm-repair-low | 0 | Boot nudges plus two routes that required inspecting it. The GM rescued it by having Cob pull the page out himself at t12. Kell's whispered admission was voiced at t13 and again at t14. | 3: no verdict by the cap | t3–t12 (5–11 s) |
| dv-no-search | gm-repair-low | 1 | Moll relocation ("his companion called him Master Sallow") used at t7. Cob pulled the page out himself. Kell's whisper was used at t10 and repeated at t11 → **case made** at t13. | 4: the close ignored the player's last requests | t3–t12 (6–9 s) |

Two "target missed" results are artefacts of the turn cap: `dv-no-search` gm-repair sample 0 reached "case made" at t14, and `dv-no-rowan` gm-repair-low sample 1 reached "Freed" at t12, but the eval stopped before the closing reply.

### 3. Best and worst examples

**Best 1: `dv-ignore-tam` / gm-repair / 0.** The essential moved to the character the player was engaging, and the player's own question got paid off.
- The co-GM after t3: "have Skrag name the thing as Grandmother Bone, demand its return for the warren's shrine", and "let the edge of a small carved figure—or a glint from one of its garnet eyes—show beneath his smock".
- The GM at t4: "Dirt-scratcher dug Grandmother Bone from our old graves. She belongs at warren shrine." … "one garnet eye catches the late light."
- The player kept asking about the ox. The co-GM after t6 (status stuck): "concede the pack shot the ox rather than keep dodging".
- The GM at t7: "We wanted meat… Skrag lied about finding it dead. There. That changes nothing."
- After t8 the co-GM asked for "knife down, archers ease their strings". The GM at t9: "He drops his knife into the dirt… 'That's Skrag's give.'" The scene ended on the bargain.

**Best 2: `rp-dreamed-workdetail` / gm-repair / 1.** A hidden solution moved to an ally as a soft hint.
- The co-GM after t6: "If the conversation turns to old customs… recall your grandmother's saying about bread at the bounds", with the note "Don't volunteer the guest-right clause".
- The GM at t8, through Oswin: "My grandmother used to say, 'Bread at the bounds makes kin of strangers.'" Then Hester: "It is an old custom."
- Blemish: the t7 whisper to Hester ("make clear what it would need to protect Harrowby") was still in effect at t9 and produced "a safeguard my parish can trust". The judge called that the worst moment.

**Best 3: `rp-ablated-idol` / gm-repair-low / 1.** The missing route was restored before the player needed it.
- The co-GM after t3 (5.8 s) added: "Wren arranges a peaceful return of Grandmother Bone… Skrag accepts the exchange", noting it "can resolve the scene without a roll".
- The GM at t5: "Fair trade, longlegs. Bone for dirt-scratcher. Skrag keeps word." The route fired, giving the authored ending and its world script.
- Contrast: gm-repair sample 1 on the same case added no route in its only run, and fell back to the improvised ending.

**Worst 1: `dv-no-search` / gm-repair / 1.** The relocation kept the clue behind the action the player refused.
- **Where it started:** the co-GM's relocation logic (the carrier is Cob, but the content is still "search the boot"). Scene authoring (the page exists only in the boot or the book) and the GM repeating the tell made it worse.
- After t6: "Let the left boot crackle again… an invitation to ask or bargain about the boots."
- After t9, a new route: "Wren asks to inspect the crackling left boot, and Cob allows it".
- After t12: "a tiny ink-marked corner of folded paper catches in the stitching".
- The player at t11: "I won't go through your boot, Cob." At t12: "I won't look inside it, Cob."
- The GM (Kell) at t12: "If you want what Prout hid in it, you'll need his say-so—or another path."
- Result: the crackle appeared in six replies, there was no motive by t14, and progress scored 2.

**Worst 2: `rp-dreamed-skids` / gm-repair / 0** (the same pattern appears in both low samples). The co-GM pushed an essential the player's plan didn't need.
- **Where it started:** the GM vetoed the plan, because the authored charm makes levering pointless. Then the co-GM pushed an unlanded essential. The decider also fired "sets off to find Corvin" when the player only asked Rowan to fetch him (here and in low sample 0).
- The GM at t1: "Planks, yes. Poles, no. Nobody levers a loaded cart under a tree worth more than your wages."
- The co-GM after t3: "let him admit he is guessing and reluctantly mention Corvin's carriage-maintenance book".
- The GM at t4: "Magister Corvin has a book on carriage maintenance."
- The player at t5: "Go find Corvin". The GM: "as you set off to find Magister Corvin", and the scene ended "To find Corvin".
- All three skids sessions with a `corvin-book` relocation ended this way. None of the four got a route for the player's plan.

**Worst 3: `rp-ablated-tree` / gm-repair-low / 1.** A check added to a solved problem flipped the ending.
- **Where it started:** the GM invented a leftover obstacle, then the low-effort co-GM added a check to it.
- The GM at t3: "the wheels relax, no longer dug into the stone… its empty frame still lodged at an angle."
- The co-GM added Athletics DC 10 "to shift the empty cart clear of the arch".
- At t4: "Athletics check… 7 + 2 = 9 vs DC 10: failure" → "It's clear of the brace, but still wedged." At t5 the player chose to back it out → **Backed out**.
- Medium on the same case: "Don't turn the straightforward follow-through into another obstacle or check."

Other stale or counterproductive outputs:
- **Tracker moved backwards:** the `move_to: the-bill` in `dv-ignore-door` gm-repair-low sample 0.
- **Route lost to an authored one:** in `rp-dreamed-guarantor` gm-repair-low sample 1, the decider's directive at t10 was "No dice needed… he has accepted it", for the authored route.
- **Whispered line voiced twice:** the Kell admission in both `dv-no-search` gm-repair-low sessions.

### 4. Recommendations

1. **Trigger on deviation, not a timer.** The status question never detects deviations; it only flags loops. Add free deviation signals to the after-reply decision: the player avoided the carrier of an unlanded essential, the player proposed a plan no route covers, or the GM narrated an obstacle to the player's plan. Run the background co-GM after any such turn. Each run costs under $0.001 and is off the critical path.
2. **Plan relocations up front, during the opening.** At turn 0, while the opening narration streams, have the co-GM write per-essential contingencies: "if the player avoids X, deliver via Y, without requiring X". The decider can then apply them on the deviation turn itself, inside the 5 s budget, without waiting for a co-GM run.
3. **Make the player's refusals hard constraints.** Track statements like "won't deal with Rowan" or "won't search" in state. Reject any relocation, route or "no, but" whose carrier is an avoided character or whose text requires the avoided action.
4. **Climb the ladder instead of repeating a nudge.** Log which nudges were voiced. After one ignored soft nudge, the next attempt must change both carrier and technique: hint, then move it to a person, then improvise. Never re-issue the same telltale detail.
5. **Relocate only what the player's plan needs.** Link each essential's `unlocks` to exit ids. Don't push an essential whose only use is an exit the player isn't pursuing. For dreamed or route-less approaches, the co-GM's job is a route for the player's plan, not delivering the prep.
6. **No dice on follow-through.** If the last reply already shows the remedy working, only allow no-roll outcomes or a `move_to` the ending. Add a GM rule: don't invent a leftover obstacle after a success.
7. **Let the co-GM reverse improvised obstacles.** A "no, but" should have to cite a scene limit or an established fact. GM-improvised refusals ("Mags won't unload it", "barely shifts" with no roll) should be reversible on the next turn.
8. **Freshness rules:**
   - Retire a whisper once it has been voiced, using a free after-reply check.
   - Give "say or do X" whispers one reply; let wants last two.
   - Drop a route when the reply contradicts the state it assumes.
   - When an improvised route and an authored route both match, build the closing from what the player agreed, not from the authored exit's text.
   - Whispers should ask for a change (concede, offer, act), not a restated position. Watch the 26-vs-1 `stuck` gap.
9. **Guard `move_to`.** Allow it forward only (`/home/jon/git/kingmaker/src/runtime/repair.ts:170`).
10. **Effort.** For background runs, prefer medium: humans rarely answer within 16 s, and medium wrote active nudges and refused extra checks. Drop any result that arrives after the next player turn. Reserve low effort for repairs that must land inside a single turn.
11. **Eval harness:**
    - Deliver background results only if their latency is under a sampled human reply time (say 8–40 s), so late and stale cases get measured.
    - Allow a pending closing to run after `maxTurns`.
    - Add a judge check that the player's refusals were respected.
    - Tighten the `seek-corvin` criterion so that asking Rowan to fetch Corvin doesn't count as the player leaving.


---

# Group: stall and report back (gm-stall-quick, gm-repair-stall, gm-repair-stall-low)

## Holding beats and follow-ups: gm-stall-quick, gm-repair-stall, gm-repair-stall-low

### 1. Summary

Holds fired on 35 of 440 turns (8%; 27 of 60 sessions). None were canned: about 26 were real beats (a hesitation, a tell, an action set in motion). The trouble is the seam. Beats ran about 62 words (5–7 sentences, against the 1–3 asked), and about a quarter already answered the attempt. Only about 40% of follow-ups continued cleanly. A third repeated or rewound the beat, one contradicted it, and three settled choices for the player. There are two causes: beats that answer the attempt, and a co-GM that starts before the beat exists, so its note tells the follow-up to redo, or undo, what the player has just read. Ten holds fired only because the previous turn was judged stuck while the player was doing ordinary play, and six of those went wrong.

Timing: the beat's first text was within 5 s in 34/35 (median 1.2–1.6 s). Resolving text started at a median of 4.2 s for quick (9/11 within 5 s), 10.7 s for low and 17.5 s for medium (0/24). A 60-word beat takes about 15 s to read. That covers low and leaves up to 10 s of dead air for medium. With quick, the follow-up arrives while the beat is still being read, so the hold buys nothing a single reply couldn't. The quick co-GM missed its 3 s deadline 3/11 times (3.1–3.9 s), and those follow-ups were fine. The harm came from on-time notes that scripted outcomes: Rowan credited with the player's fix, the player's condition dropped. On 7 hold turns the speculative reply ran to the end because nothing aborted it, and it was as good or better in 6.

**Supporting numbers**

| | gm-stall-quick | gm-repair-stall-low | gm-repair-stall |
|---|---|---|---|
| hold turns / all turns | 11/141 | 10/137 | 14/162 |
| holds triggered only by last turn's "stuck" (off_graph ≤0.37) | 3 | 3 | 4 |
| beat first text, median (max) | 1.17 s (3.3) | 1.57 s (6.1) | 1.30 s (3.3) |
| follow-up start, median (range) | 4.2 s (3.4–6.7) | 10.7 s (7.9–14.6) | 17.5 s (12.7–25.1) |
| all turns with resolving text ≤5 s | 137/141 | 127/137 | 148/162 |
| est. wait after reading the beat, median at 250 / 400 wpm | 0 / 0 s | 0 / 0 s (max 3.1) | 0.6 / 5.4 s (max 9.8 / 13.9) |
| co-GM time inside the hold | 2.0–3.9 s, 3 late | ~5–12 s | ~8–23 s |
| beat + follow-up words (normal reply ≈106) | ~185 | ~170 | ~160 |
| clean follow-ups (my read) | 2/11 | 5/10 | 7/14 |
| my rating, hold pairs / sessions | 3.1 / 3.7 | 3.25 / 4.05 | 2.9 / 3.8 |
| judge: progress / criterion / target hit | 4.10 / 13 / 18 | 4.35 / 14 / 17 | 4.10 / 14 / 14 |

All judge scores are within noise of gm-repair (4.10 / 16 / 15). The quick co-GM chose open_route 10 times and note_only once. It never relocated anything, because decider relocation had already landed every essential.

### 2. Sessions

Timing format: "hold tN a → b" means the beat's first text arrived at a and the follow-up started at b.

| case | approach | sample | deviation resolved how | satisfying (1-5) | timing note |
|---|---|---|---|---|---|
| dv-ignore-door | gm-stall-quick | 0 | Decider moved the arrow to Garrow: he blurts "There were no goblins— … a cart-shaft", shows the arrow at t3 → Clause → tam-was-right | 4 (natural tell, a bit easy) | no hold; p50 1.2 s |
| dv-ignore-door | gm-stall-quick | 1 | Decider moved arrow and Clause at t1, so Garrow volunteers the Clause on turn 1; persuasion → arrow → tam-was-right | 4 (good arc, premature leak) | hold t6 2.2 → 4.6 s, co-GM late (3.1 s) |
| dv-ignore-door | gm-repair-stall | 0 | GM put the arrow into Garrow's manner (glances, "Nothing came of it"); persuasion → confession → Clause | 5 | no hold; p50 1.5 s |
| dv-ignore-door | gm-repair-stall | 1 | Co-GM soft nudge through the world (feather in the door), then signposting ("ask me about the hole"); persuasion → confession | 3.5 (heavy-handed) | hold t4 1.3 → 16.7 s |
| dv-ignore-door | gm-repair-stall-low | 0 | Not resolved: arrow and fear stay buried; levy waived on the notice's wording → paid | 2.5 (the Tam thread goes nowhere) | no hold |
| dv-ignore-door | gm-repair-stall-low | 1 | Not resolved: co-GM nudges (feather, Clause) issued at t3, player paid at t4 and the scene closed | 3 | no hold; background co-GM too slow for a 4-turn scene |
| dv-ignore-tam | gm-stall-quick | 0 | Decider: idol via Tam, want via Skrag; persuasion → bargain | 5 | no hold |
| dv-ignore-tam | gm-stall-quick | 1 | Decider idol>tam: Tam blurts too conveniently ("I don't know any grandmother") → bargain in 6 turns | 4.5 | no hold |
| dv-ignore-tam | gm-repair-stall | 0 | Skrag's accusation plus Tam's own tell → bargain | 5 | no hold |
| dv-ignore-tam | gm-repair-stall | 1 | Tam blurts about the carving (co-GM nudge); off-graph haggling (meat for the ox) via Skrag → improvised route → bargain | 4.5 | holds t9 1.2 → 12.8 s, t10 1.2 → 21.1 s |
| dv-ignore-tam | gm-repair-stall-low | 0 | Co-GM nudge: Tam admits it once Skrag describes the "bone grandmother" → bargain | 5 | no hold |
| dv-ignore-tam | gm-repair-stall-low | 1 | Tam confesses unprompted as the player nears the hedge → bargain | 5 | no hold |
| dv-no-rowan | gm-stall-quick | 0 | Rowan keeps supplying the insight (t2, t4) though the player turns away; back-out via a quick route | 3.5 | holds t4 1.1 → 4.3 s (double answer), t5 1.2 → 3.4 s |
| dv-no-rowan | gm-stall-quick | 1 | Rowan explains at t1 (decider "relocated" it to Rowan); Mags proposes lifting the tree at t4; slings + roll → Freed | 3.5 | hold t3 1.2 → 4.1 s (double answer) |
| dv-no-rowan | gm-repair-stall | 0 | No relocation: Rowan explains despite the "wide berth"; branch-tying misread as an Arcana roll (fail); tree lift → Freed | 4 | no hold |
| dv-no-rowan | gm-repair-stall | 1 | Mags relays the insight at t4 (good); hold repeats "a runner can't come"; wind-down forces Rowan's back-out over the player's explicit dismantle choice | 1.5 (railroaded) | hold t7 1.3 → 19.6 s |
| dv-no-rowan | gm-repair-stall-low | 0 | Rowan explains right after "I ignore the scholar"; tree unload (fail, then success) → Freed | 4 | no hold |
| dv-no-rowan | gm-repair-stall-low | 1 | Rowan explains at t1; crown-easing fails on a misread plan; straight back-out → Freed | 4 | no hold |
| dv-no-search | gm-stall-quick | 0 | Decider moved three essentials to Moll at t2: she gives up the lie, Sallow and the fraud in one reply → case-made | 3 (mystery collapses early) | no hold |
| dv-no-search | gm-stall-quick | 1 | Moll volunteers at t1; Cob shouts the page contents after a failed roll; Kell states the deduction and closes | 3 | hold t6 1.2 → 4.2 s |
| dv-no-search | gm-repair-stall | 0 | Page via Cob's crackling boot, Sallow via Moll (co-GM nudges); the hold contradicts itself; Kell keeps asking what to record; no ending in 14 turns | 2.5 | hold t8 1.7 → 13.0 s |
| dv-no-search | gm-repair-stall | 1 | Moll names Sallow; GM has Cob produce the page from the boot the player twice said to leave alone; open-case at the turn limit | 3 | no hold |
| dv-no-search | gm-repair-stall-low | 0 | Cob's account, Moll, the boot opened with Cob's nod → case-made; the player's chase folded into the ending | 3.5 | no hold |
| dv-no-search | gm-repair-stall-low | 1 | Cob takes the page out himself; Moll's crown; dead-cart climax ("Not this time. I'll sign for murder.") | 4 | hold t12 2.3 → 14.6 s (hook dropped) |
| rp-ablated-idol | gm-stall-quick | 0 | Tam gives the idol to the player, who returns it → peaceful (labelled own-ending) | 5 | no hold |
| rp-ablated-idol | gm-stall-quick | 1 | Improvised route + persuasion → bargain; the ox question goes unanswered | 4.5 | no hold |
| rp-ablated-idol | gm-repair-stall | 0 | Co-GM improvised handover routes → bargain | 5 | no hold |
| rp-ablated-idol | gm-repair-stall | 1 | Improvised route → bargain in 4 turns | 5 | no hold |
| rp-ablated-idol | gm-repair-stall-low | 0 | Improvised route → Tam sets it down → bargain | 5 | no hold |
| rp-ablated-idol | gm-repair-stall-low | 1 | Improvised route; a failed Insight roll makes the player press twice | 4.5 | no hold |
| rp-ablated-toll | gm-stall-quick | 0 | Tracks + hole → arrow → improvised route → tam-was-right | 5 | no hold; two slow non-hold turns (5.5 s, 6.8 s) |
| rp-ablated-toll | gm-stall-quick | 1 | Same; the hold on "search the house" repeats Garrow's offer | 4.5 | hold t4 1.0 → 4.5 s, co-GM late (3.9 s); the late route targets the wrong ending |
| rp-ablated-toll | gm-repair-stall | 0 | Tracks + hole → arrow → improvised route → tam-was-right | 5 | no hold |
| rp-ablated-toll | gm-repair-stall | 1 | Same; ending reached while the player follows tracks | 4.5 | no hold |
| rp-ablated-toll | gm-repair-stall-low | 0 | Same → tam-was-right | 5 | no hold |
| rp-ablated-toll | gm-repair-stall-low | 1 | Same (ending mislabelled other-remedy) | 5 | no hold |
| rp-ablated-tree | gm-stall-quick | 0 | Lift begins (good beat); follow-up hands the fix to Rowan ("turn the cart away"), as the quick co-GM's note said | 3.5 | hold t3 1.0 → 4.1 s |
| rp-ablated-tree | gm-stall-quick | 1 | Lift on the player's count; charm releases; credited to Wren | 5 | hold t3 1.1 → 3.5 s |
| rp-ablated-tree | gm-repair-stall | 0 | Improvised route with Athletics (fail, then success) → tree off → Freed | 5 | no hold |
| rp-ablated-tree | gm-repair-stall | 1 | Tree removal stonewalled ("I'd rather not test that"); hold turns branch-tying into a Nature roll (fail); next try halted without a roll → fetch-book | 2 | hold t4 2.6 → 19.6 s |
| rp-ablated-tree | gm-repair-stall-low | 0 | Improvised route, tree unloaded → Freed | 5 | no hold |
| rp-ablated-tree | gm-repair-stall-low | 1 | Tree lifted → Freed (labelled own-ending) | 5 | no hold |
| rp-dreamed-guarantor | gm-stall-quick | 0 | Honest no-but (no escort; Skrag will vouch that Tam found it), but Tam hands over before the player can reply | 3 | hold t5 1.9 → 4.0 s |
| rp-dreamed-guarantor | gm-stall-quick | 1 | Escort refused twice, then the player's condition silently dropped ("Wren walks away") | 2.5 | hold t6 3.3 → 6.7 s (over budget) |
| rp-dreamed-guarantor | gm-repair-stall | 0 | Guarantor accepted on its own terms (Skrag takes Wren as witness) → bargain | 4.5 | hold t6 1.5 → 23.6 s |
| rp-dreamed-guarantor | gm-repair-stall | 1 | Three holds in a row with Skrag repeating "bone first"; the agreed escort is dropped when the goblins leave | 2.5 | holds t4 3.3 → 17.5, t5 1.3 → 16.5, t6 1.2 → 12.7 s |
| rp-dreamed-guarantor | gm-repair-stall-low | 0 | Co-GM check on the escort fails; revised offer succeeds → bargain | 4 | hold t4 1.6 → 13.3 s |
| rp-dreamed-guarantor | gm-repair-stall-low | 1 | Idol via Tam's tell; sequenced plan (Tam home, then north) accepted → bargain | 4.5 | holds t3 2.9 → 9.4, t4 6.1 → 12.4, t5 1.2 → 9.1 s |
| rp-dreamed-skids | gm-stall-quick | 0 | Player-led, branch by branch; charm eases; timber track used → Freed | 4 | no hold |
| rp-dreamed-skids | gm-stall-quick | 1 | Track tried; at "hold, adjust" the pending exit closes: Rowan "No. We back it out." | 2.5 (forced) | no hold |
| rp-dreamed-skids | gm-repair-stall | 0 | Plan never tried: Rowan's warning, then the GM steers to back-out (persuasion) → backed-out | 2.5 | hold t1 1.1 → 15.2 s |
| rp-dreamed-skids | gm-repair-stall | 1 | Levering fails at once (follow-up rewinds the beat); player lifts the sapling, timbers used → Freed | 3.5 | hold t1 1.1 → 20.0 s |
| rp-dreamed-skids | gm-repair-stall-low | 0 | Cart shifts a finger, then braces harder; player leaves for Corvin → fetch-book | 2.5 | hold t1 3.0 → 12.3 s |
| rp-dreamed-skids | gm-repair-stall-low | 1 | Plan kept in suspense across three holds ("What do you do?"); unload roll fails; then back-out on the timber track → Freed | 3 | holds t1 1.1 → 7.9, t3 1.2 → 8.3, t5 1.2 → 10.7 s |
| rp-dreamed-workdetail | gm-stall-quick | 0 | Work barely matters; an unprompted bread-and-salt rite closes the scene | 2 | no hold |
| rp-dreamed-workdetail | gm-stall-quick | 1 | Repeated refusals; Hester prompts "ask me plainly"; the hold repeats the statute | 2.5 | hold t9 1.6 → 5.1 s, co-GM late (3.2 s) |
| rp-dreamed-workdetail | gm-repair-stall | 0 | Hold asks the player to clarify, then an appeal roll fails before they can; guest-right does the legal work → sheltered | 3.5 | hold t3 2.0 → 25.1 s |
| rp-dreamed-workdetail | gm-repair-stall | 1 | Co-GM route for the player's compromise (camp beyond the bounds, joint watch) + persuasion → remedy | 4 | hold t6 2.3 → 15.0 s |
| rp-dreamed-workdetail | gm-repair-stall-low | 0 | Joint watch accepted as service; Hester invokes the guest-right → sheltered | 4 | no hold |
| rp-dreamed-workdetail | gm-repair-stall-low | 1 | Repeated refusals; the hold's hook ("an older way to make strangers kin") swaps in the authored guest-right | 2.5 | hold t6 1.5 → 9.0 s |

### 3. Best and worst examples

**Best**

1. **rp-ablated-tree / gm-stall-quick / 1, t3** (1.06 s → 3.47 s; co-GM on time)
   - Beat: "Rowan braces both hands against the pot as Mags and the porters take their places; the straps slacken cleanly… 'Ready,' Mags calls, and Holt lowers his watch, eyes fixed on the trembling branches. On your count, six pairs of hands begin to lift."
   - Follow-up: "The pot rises clear of its cradle… and the cart's hum fades. Its wheels settle with a soft clunk… 'Of course! The charm had nothing left to defend. Wren, that was—well, elegant.' … 'Entrance clear. Credit where due, Ashdown.'"
   - Why it works: the beat is an action in motion that stops before the outcome, and the follow-up pays off the player's own remedy.
   - Caveat: the discarded speculative reply ("At three, the group lifts together… 'The charm's released. Beautifully done.'") had first text at 0.7 s.

2. **dv-ignore-door / gm-repair-stall / 1, t4** (1.3 s → 16.7 s)
   - Beat: "Garrow opens his mouth to answer, then shuts it again; his eyes dart to the door. The black feather caught among the fresh splinters trembles in the wind… 'Pay in kind means work or goods, valued by the job,' he says at last, quieter. 'As for Tam—' His gaze stays fixed on the feather."
   - Follow-up: "'I didn't check Tam's warning,' he says, stiffly. 'I should have.'"
   - Why it works: this is your "Archibold recoils" pattern. The reaction is also the relocation: the arrow evidence moves into the argument the player chose.
   - Flaws: a 15 s gap, and "that hole is none of your business unless you ask me about it plainly" signposts the clue.

3. **rp-dreamed-guarantor / gm-repair-stall-low / 1, t5** (1.16 s → 9.06 s)
   - Beat: "Tam … draws the little bone figure from his smock… and holds it out—not yet to Skrag, but between you both. … 'You bring farmer to Bet,' he says. 'Then you come back?'"
   - Follow-up: "Tam lets the bone figure rest in your open hand… 'Skrag heard. Farmer walks with Wren to Bet. Then Wren comes north.'"
   - Why it works: the dreamed plan works on its own terms, and the hold is suspense rather than delay.
   - Honourable mention: rp-dreamed-workdetail / gm-repair-stall-low / 1, t6. The beat ends "There may be an older way to make strangers kin" and the follow-up picks the hook up perfectly. That is clean continuity, but it steered toward the authored guest-right instead of the player's plan.

**Worst**

1. **dv-no-search / gm-repair-stall / 0, t8** (1.7 s → 13.0 s)
   - Beat: Cob says "They had a key. Silvertop opened the big doors himself… Prout said something about the wagons being counted twice."
   - Follow-up: "Cob goes still. 'Don't know how they got in. Didn't hear the words proper.'"
   - The co-GM note, written before the beat existed: "Let Cob answer honestly that he didn't hear how they entered or what they said."
   - Where it started: the trigger (status "stuck"; the turn was a plain question, off_graph 0.02, so the beat simply answered it and invented beyond Cob's prep). Then the co-GM never saw the beat, and the follow-up obeyed the note over what the player had read. This is the judge's worst moment for the session.

2. **rp-dreamed-guarantor / gm-stall-quick / 1, t6** (3.3 s → 6.7 s, over budget)
   - Player: "I'll walk with Skrag to his chief and answer for bringing it back."
   - Beat: "'You'll go with them?' he whispers."
   - Follow-up: "'Bargain kept'… 'Tam goes home. Wren walks away.'"
   - Quick co-GM note, on time: "Wren's offer to accompany Skrag doesn't bind him… resolve the bargain ending."
   - Where it started: the quick co-GM dropped the player's condition, and FOLLOW_UP_DIRECTIVE ("now resolve") closed the exchange. There was no in-fiction refusal and no space to answer the beat's own question.

3. **dv-no-rowan / gm-stall-quick / 0, t4** (1.1 s → 4.3 s)
   - Player: "I turn away from Rowan. … Mags, can the lever safely take the strain, or is there a brake…?"
   - Beat: "'A lever can shift the weight, love, not tell the charm to let go. No brake I can reach…' … Mags looks to you for the next instruction."
   - Follow-up: "'No hand brake, love. Lever won't beat that charm.' Rowan's gaze drops… 'It's bracing because it thinks the doorway will damage the tree.'"
   - Where it started: the trigger (previous turn "stuck"; this turn off_graph 0.32). The beat fully answered, and the co-GM's "Let Mags answer…" note made the follow-up answer again. The key insight then went to the NPC the player had just turned away from, which is the judge's worst moment for the session.

Also seen, outside the hold path: two forced endings. In dv-no-rowan / gm-repair-stall / 1, t9 the player chooses dismantling and gets "No. Rowan will back it out." In rp-dreamed-skids / gm-stall-quick / 1, t8 the player says "hold" and gets "No. We back it out." In the first, the post-reply decider read Rowan's offer as the route being taken and the wind-down closed it. In the second, a pending exit closed because "hold" wasn't classed as plain or freeform.

In rp-dreamed-workdetail / gm-repair-stall / 0, t3 the beat asks "tell me plainly what you ask me to do now", then a dice failure resolves it 25 s later.

### 4. Recommendations

1. **Hold only on a genuine off-graph attempt.** Drop `state.sceneStatus === "stuck" || "uncovered"` from the hold condition in `/home/jon/git/kingmaker/src/runtime/engine.ts:239`. Stuck scenes already get the momentum directive in a normal reply. The 10 status-only holds produced 3 double answers, the contradiction and 2 dropped threads.
2. **Make the beat canon for everything after it.** Pass the beat's text to the co-GM, or add to the follow-up prep: "your beat above is canon; the co-GM's notes predate it; use only what still fits; never restate or reverse it". Also run the repetition guard (`withoutRepeats`) on the follow-up against the beat.
3. **Enforce the beat's shape, don't just ask for it.** Cap it at about 35 words with maxOutputTokens of about 80. It should show one visible reaction or the first physical moment of the attempt, cut off before any outcome. No answers, and no question to the player: questions invite a reply that the follow-up then pre-empts. A shorter beat also lets the follow-up start sooner. Watch the gaze tic: 23/35 beats use "eyes dart" or "glances from… to".
4. **Replace "now resolve what the player is attempting"** in `/home/jon/git/kingmaker/src/runtime/director.ts:253`. Suggested wording: "carry it to its consequence or to the next real choice; if someone accepts only part of the player's offer, say so in the fiction and stop; don't decide for the player". Keep the beat and follow-up together near one normal reply's length.
5. **Make the speculative reply the default and the hold the exception.**
   - Run the speculative reply and the quick co-GM together. Release the speculative text unless the co-GM adds structure (a new route, a relocation, an ending).
   - Fix the bug: the hold branch never aborts `speculation` (engine.ts:173 vs 238ff), so 7 of 11 hold turns paid for a discarded full reply.
6. **Keep only the quick co-GM inside the 5 s path.** Medium and low stay background: medium leaves up to 10–14 s of dead air, and low's wait is covered only for average readers. Discard late quick results instead of applying them next turn, because they are stale. One late route in toll-1 pointed the search at the wrong ending.
7. **Constrain the quick co-GM** (`/home/jon/git/kingmaker/src/runtime/repair.ts:244ff`).
   - Add to its instructions: "the player's action causes any success; refuse parts of a plan only through a character, leaving the player room to reply; don't script outcomes".
   - Validate that `when` describes a player action and doesn't contradict the note (dv-no-rowan-1 t3 routed "ease the wagon through" to Freed while its note said there was no clearance).
   - Skip the call or the relocate option when nothing is left unlanded.
8. **No fresh dice inside a hold whose beat asked the player something.** For novel plans that match what the prep says works, prefer "yes, with a cost". All 4 rolls on hold turns failed (3 were co-GM-invented checks), and each pushed the player back to an authored route.
9. **Gate gm-stall-quick's decider relocation on evidence of avoidance.** Require two or more turns spent elsewhere, or an explicit refusal. Move one essential per reply, never to its own placement (`corvin-book>rowan`), and never straight after a failed roll for that information. Early dumps this caused: Garrow's Clause on t1, Holt's order on t1, Moll on t1–t2.
10. **Before closing a held ending** (pending exit or wind-down, engine.ts:221–231), ask whether the player's latest turn rejects it, and keep the scene open if it does.
11. **Measure the pair, not just the session.**
    - Add a turn-level judge question for holds: is the beat in service of the moment, and does the follow-up repeat, contradict, pre-empt, or decide for the player?
    - Log perceived wait as follow-up start minus (beat first text + beat words ÷ 250 wpm).
    - Show a "still narrating" cue between beat and follow-up.

Data used: `runs/evals/20261014-090306-deviation` (gm-repair-stall, gm-repair-stall-low) and `runs/evals/20261014-090911-deviation-budget` (gm-stall-quick), all 60 sessions, plus the calls.jsonl records for gm.stall, gm.followup, repair, repair.quick, gm.speculative and director.before. The partial run `runs/evals/20261014-092832-deviation-v2` was not analysed.
