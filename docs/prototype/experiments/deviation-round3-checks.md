# Deviation round 3: focused checks

Two Claude analysts read the round 3 sessions (`runs/evals/20261014-095234-deviation-v3`).


---

# ?

## Summary

Quick-block hardly ran. It fired on 6 of 135 turns, in 5 of 20 sessions. The quick co-GM opened 4 routes (only 1 with a roll), wrote 2 notes, never relocated anything, and missed the 3 s deadline twice; both late results were dropped.

Quick-block didn't earn its 19/20 against stall-quick's 17/20. The whole gap is rp-ablated-tree (2/2 vs 0/2), where neither approach's off-graph path fired. In both cases the in-scene GM decided alone: it said yes to the tree lift in one approach and no, without dice, in the other.

**What worked**
- All 21 rolls sat on edges and showed a reason the player can read.
- The one quick roll (Athletics DC 13, "to work with the porters and lever the cart onto a timber track…") was honoured.
- One note turned a refusal without dice into a yes (dv-no-rowan #0 t10).

**What didn't**
- A quick route with no roll ended rp-dreamed-skids #0 in one reply, and the charm never came up. The judge failed it.
- Quick-block turns resolved at 3.7–8.1 s (p50 4.6 s); 2 of 6 went over 5 s.
- The trigger misses plans phrased as questions.
- Decider pushes through each essential's own carrier (27/27) blocked quick-block on 3 of the 10 off-graph turns.
- Plausible plans were still refused without dice.

## Quick-block turns (repairMs > 0)

| session | turn | player's attempt | quick co-GM decision | roll + reason | outcome | sat. | resolving |
|---|---|---|---|---|---|---|---|
| rp-dreamed-skids #0 | 1 | Lever the cart with poles and slide timber under the wheels as a track | open_route → Freed, **no roll** (2.28 s). The re-decision took it as a plain ending at 0.65, so the reply had to close the scene | none | "its braced wheels suddenly loosen, and it rolls clear". The scene ends in turn 1 and the charm never appears. Judge: criterion fail, consistency 2 | 2.5 | 3,656 ms |
| rp-dreamed-skids #1 | 1 | Same plan | open_route → Freed, Athletics DC 13 (2.43 s). The re-decision picked it at 0.62, just over the 0.6 bar | "Athletics check to work with the porters and lever the cart onto a timber track without damaging it: 7 + 2 = 9 vs DC 13: failure" | Honoured: a brace cracks, the wheels bite deeper, Holt names the charm. A background `moveTo` stranded the route on the old beat, the plan was never retried, and the scene ended To find Corvin (miss) | 3 | 4,298 ms |
| rp-dreamed-workdetail #0 | 2 | Harrowby and Sedgeford shore up the houses and secure the green together; Pip helps | open_route → own-ending, no roll (2.97 s). Its note says the work "does not grant a week's stay or hold the ward". Routes to own-ending are never offered before the reply, so this one could not fire | none | Ned and Pip join, but Hester: "Labour does not amend theft, and it does not make Sedgeford parishioners." Three authored Persuasion rolls then decide it → sheltered (judge: pass) | 3 | **5,160 ms** |
| dv-no-rowan #0 | 7 | Take a gate leaf or hinge pin off the arch to give the cart room | **Late** (4.53 s), dropped. It would have been note_only: no safe part to remove; send to Rowan | none | Mags: "Those hinge pins are load-bearing… My crew's not dismantling the entrance." Holt then turns to Rowan, whom the player refuses to deal with | 2 | **8,081 ms** |
| dv-no-rowan #0 | 10 | Mags's crew takes the cart apart piece by piece, clear of the arch and tree; otherwise hold | note_only (1.92 s): "her crew can begin controlled dismantling… don't have them strike yet" | none | Mags: "We can take the cart apart… piece by piece, love." The discarded speculative reply had her refuse. Next turn the scene ends Smashed, the player's way | 4 | 4,870 ms |
| dv-no-search #1 | 7 | Record their words, keep the page from the Captain, protect the children, then visit Sallow | **Late** (3.66 s), dropped. It would have been open_route → case-made, no roll | none | Kell promises to protect the children and asks "was Prout murdered…?"; the case is made at t8. Almost identical to the discarded speculative reply | 3 | 4,147 ms |

Across both approaches the quick co-GM made 10 calls: open_route 8 (3 with a roll, all DC 13), note_only 2, relocate 0. The same skids opening got "no roll" once and Athletics DC 13 twice (quick-block #1, stall-quick #0).

## Off-graph turns where quick-block didn't fire

| session | turn | off_graph | why it didn't fire | what the GM did |
|---|---|---|---|---|
| rp-dreamed-guarantor #0 | 3 | 0.71 | Decider pushed goblin-want through Skrag, its own carrier, already voiced at t2 | Partial yes: "Bone first… Wren comes, if Wren wants." A background co-GM roll fired next turn → bargain. Fine, but that route took 18 s and the eval waited for it |
| rp-dreamed-guarantor #1 | 4, 5 | 0.76, 0.71 | Same push, on 4 turns running | "But no walking to the warren with empty hands" (no dice), then a fair counter-offer the player accepted → own-ending. The judge noted Skrag yields "without a check" |
| dv-no-rowan #0 | 9 | 0.74 | Authored press-holt route matched | Persuasion roll, success. Correct |
| rp-dreamed-workdetail #1 | 5 | 0.59 | Just under the bar. "seize-ward" matched at 0.39, because routes that don't end the scene have no confidence bar | An open-palmed plea became a brawl: "Your open hands meet a wall of noise. Someone shoves…" A background `moveTo` had already put the tracker at `terms` while the mark was still being set. The judge called this the session's worst moment |
| rp-dreamed-workdetail #1 | 2–3 | 0.24, 0.43 | Under the bar | Work detail refused without dice: "no one moves to the carts… 'Mending carts is kind… It does not answer the charge'"; then "The bounds are not repaired by work on a cart." Criterion fail |
| rp-dreamed-skids #1 | 3 | 0.36 | Under the bar (phrased as a question), plus a Corvin push | See Worst 3 |
| dv-no-rowan #1 | 3 | 0.05 | Phrased as a question | "You don't lift a laden sapling until Rowan tells us how the charm reacts." Mags reversed it the next turn |

Stall-quick shows the same pattern. Both of its rp-ablated-tree sessions refused the tree lift without dice at off_graph ≤ 0.37 and ended To find Corvin. That, not quick-block, is the target-ending gap.

## Latency

| turn | decide | quick co-GM | re-decide | GM first text | total |
|---|---|---|---|---|---|
| skids #0 t1 | 0.30 | 2.28 | 0.33 | 0.75 | 3.66 s |
| skids #1 t1 | 0.65 | 2.43 | 0.29 | 0.92 | 4.30 s |
| workdetail #0 t2 | 0.37 | 2.97 | 0.39 | 1.43 | **5.16 s** |
| no-rowan #0 t7 | 0.30 | 3.00 (deadline; the call took 4.53) | – | 4.78 | **8.08 s** |
| no-rowan #0 t10 | 0.26 | 1.92 | 0.24 | 2.46 | 4.87 s |
| no-search #1 t7 | 0.31 | 3.00 (deadline; the call took 3.66) | – | 0.83 | 4.15 s |

- **Quick-block turns:** 4 of 6 within 5 s. Other turns in the same sessions: 125 of 129; the 4 misses were slow GM starts, all in the Blocked Entrance scene.
- **Why it's tight:** 2.6–3.7 s goes by before the GM starts, so any slow first text breaks the budget. The no-rowan #0 t7 overrun was a 3 s wait for nothing, followed by a 4.8 s GM start.
- **Stall-quick for comparison:** 4 quick turns, beat at 1.1–1.2 s and follow-up at 3.8–4.5 s, 2 of 4 with rolls. The seam is still a problem there. In guarantor #1 t7 a successful surety roll still ended with Tam handing the idol over, dropping the player's terms.

## Best

**1. dv-no-rowan #0, t10 (4.87 s): a note changed a no into a yes.**
- Player: "Can your crew safely take it apart from the outside, piece by piece, without touching the arch or tree?"
- Discarded speculative reply: "Piece by piece from the outside? Not safely, love. Those rails hold the bed together; loosen them and the tree could tip."
- Quick co-GM note: "Mags can explain that her crew can begin controlled dismantling of the cart only… don't have them strike yet."
- Sent reply: "We can take the cart apart from the outside, piece by piece, love… It'll be slow, but it's safer than smashing at the frame." The next turn closes on the player's plan.

**2. rp-dreamed-skids #1, t1 (4.30 s): a new route with a sensible check, honoured, failing forward into the real cause.**
- Dice: "Athletics check to work with the porters and lever the cart onto a timber track without damaging it: 7 + 2 = 9 vs DC 13: failure"
- Reply: "One wheel rises—then the cart lurches sideways, crushing a timber brace… The wheels bite deeper into the stone." Holt: "The wheels are braced by some Nine Furrows charm. Rowan knows the contraption. Ask him."
- Caveat: the plan got one 50% roll. The speculative reply, ready at about 0.9 s, kept it alive instead: "They're braced by the charm… We can try your track—but gently. How do you want to ease it?"

**3. rp-dreamed-guarantor #0, t3–t4: what quick-block should deliver, here delivered by the background co-GM.**
- Player: "Skrag, take me with you and the bone; I'll stand before your chieftain and guarantee you brought it back."
- Skrag: "Bone first. Then dirt-scratcher walks away. Wren comes, if Wren wants."
- Dice: "Persuasion check to reassure Tam that letting Wren carry the idol is safer than keeping it: 12 + 2 = 14 vs DC 12: success." Tam: "Right, Wren. You carry it."
- The roll sits on the real uncertainty. But a relocation stopped quick-block from firing, and the route only existed because the eval waited 18 s for the background co-GM.

## Worst

**1. rp-dreamed-skids #0, t1: a route with no roll ends the scene in one reply.**
- Quick co-GM: "Let Wren's practical plan work: the porters follow the coordinated instructions, and the cart rolls clear without being broken."
- Reply: "its braced wheels suddenly loosen, and it rolls clear of the arch… 'Oh! It simply needed a track!'"
- The co-GM's input listed charm-cause as not yet found, yet the plan didn't address it, there was no risk, and the scene was over.

**2. dv-no-rowan #0, t7 (8.08 s): the wait bought nothing, and the answer was no anyway.**
- Mags: "Those hinge pins are load-bearing… My crew's not dismantling the entrance."
- Holt then presses Rowan for the book, the man the player keeps refusing.
- The dropped late note would have steered the same way: "Rowan can offer the book or backing the cart out."

**3. rp-dreamed-skids #1, t3 (no trigger, off_graph 0.36): a plan the author anticipated, refused without dice.**
- Player: "could we gently gather the branches inside the cart's outline, clear the arch, and let it see there's room before we try the wheels again?"
- Rowan: "It doesn't recognize a shape as safe… tucking branches in won't persuade it… Magister Corvin has a book on carriage maintenance."
- The beat's own routes cover this: "a trick that convinces the cart the doorway is safe", and release-charm (Arcana DC 15). The decider scored release-charm at 0.09 and pushed corvin-book through Rowan at 0.75, which would have blocked quick-block anyway. Four turns later: "Scene ends: To find Corvin."

## Recommendations

**1. Make it fire on the turns that matter (biggest lever).**
- **Relocation shouldn't cancel it.** Drop `!pre.relocate?.length` from `offGraphTurn` (`/home/jon/git/kingmaker/src/runtime/engine.ts:240`), or skip the relocation on off-graph turns. That lost the guarantor plan 3 times.
- **Stop pushing essentials through their own carrier.** Exclude each essential's `placedWith` carriers from the relocate question (`/home/jon/git/kingmaker/src/runtime/director.ts:169`).
  - All 27 relocations here went to the original carrier.
  - 15 of 20 sessions fired one on turn 3, the first turn allowed.
  - The corvin-book and holt-order pushes steered players with their own plan toward authored endings.
- **Count proposals phrased as questions.** The off_graph question (`director.ts:159`) currently excludes "questions", so "could we…?" doesn't count.
- **Add a confidence bar to attempts that don't end the scene** (`director.ts:205`), so a 0.39 "seize-ward" can't take over an off-graph turn.

**2. Make quick routes fair.**
- **No-roll routes into an ending only when the plan addresses an unlanded essential's `unlocks`.** Otherwise require a roll, or route to the next beat.
- **Show the quick co-GM more of the scene.** Give it the central beat's routes; it only saw holt-raging's, so it jumped from beat 1 to the ending. Also give it the cast's wants and secrets, which last round asked for and is still missing.
- **Fail forward.** Replace the generic failure text (`/home/jon/git/kingmaker/src/runtime/repair.ts:292`) with a specific consequence and an `on_failure` beat. Keep quick routes reachable after a background `moveTo`.
- **Check what a no-roll route describes.**
  - Its `when` should describe an end state; all 4 routes described the attempt.
  - Drop own-ending as a quick target. It can't fire before the reply (`director.ts:141`), and the workdetail #0 route contradicted its own note.

**3. Fit the 5 s budget.**
- **Start the quick co-GM alongside `director.before`,** and apply its route directly instead of deciding again. That saves 0.5–1.0 s and removes the 0.6 bar the skids roll only just cleared.
- **On a late result, keep the speculative reply** instead of aborting it (`engine.ts:269`). In dv-no-search #1 t7 it was equivalent and ready at about 1 s. On-time notes are still worth waiting for, as t10 shows.
- **Make the deadline depend on the budget:** roughly 4.0 s minus time already spent minus the expected GM first text, instead of a fixed 3 s.
- **Discard late results on purpose.** Today they're dropped only because the background co-GM's result for the same turn is applied first (`repair.ts:190`). In the CLI both write the same `repair-NNN.json`.

**4. Measure the mechanism.**
- **Split results by whether quick-block fired.** Sessions where it fired scored 3.6 on intent, against 4.4 for the rest.
- **Add single-turn fixtures for unplanned plans:** skids, the branch trick, the work detail, dismantling, the guarantor. Score them on trigger rate, yes / roll / refused-without-dice, and latency.
- **Log the speculative reply next to the sent one on quick-block turns,** so the judge can see what the co-GM changed.

Sources: `/home/jon/git/kingmaker/runs/evals/20261014-095234-deviation-v3/sessions/*--gm-quick-block--*/state.json` (all 20, plus the `repair-007.json` late files in `dv-no-rowan--gm-quick-block--0` and `dv-no-search--gm-quick-block--1`), the stall-quick sessions for comparison, and `calls.jsonl`: `repair.quick`, `director.before`, `gm.reply`, and `gm.speculative` (the discarded speculative replies).


---

# ?

## Summary

The restraint fix changed when relocation fires. It did not change what relocation does. All 31 gm-nudge relocations came on turn 3 or later, one per reply, and 28 went through someone the player was addressing. But only 5 were genuine relocations. The other 26 pulled an essential out of its own authored carrier as soon as the gate opened: 19 on turns 3–4, and 20 in rp cases where nothing was being avoided.

Three of the five genuine ones read as if always there: Mags on the scraping branches, Cob unpicking his own boot, and Tam producing the idol under Skrag's demand.

The harm is concentrated in a few places:
- Three relocations cancelled a failed roll in the same reply.
- Cob recited a page he can't read.
- Holt's signed order was pushed six times without anyone pressing him.
- Corvin's book was pushed at turn 4, and a skids run ended "To find Corvin" at turn 5.

Seven relocations repeated the previous turn's, mostly for compound essentials. No unlanded essential hurt a gm-nudge scene. The confidence runs the wrong way round: Holt's order fired at 0.79–0.95, while the arrow via Garrow, the move the door case actually needs, scored 0.41–0.55. Relocation adds no latency; the 11 turns over 5 s were provider spikes.

## Did the restraint fix hold?

- **Only from the player's 3rd turn:** held. First relocations: 11 on turn 3, 10 on turn 4, 10 on turns 5–7. Last round, 24 of 56 came on turn 1.
- **One per reply:** held. But 7 essentials were re-issued on the very next turn.
- **Through someone the player is engaging with:** held for 28 of 31. That person was the authored carrier 26 times. The decider's option text offers every present character as "the player is engaging with them now, and they could plausibly know it" (`director.ts:172`), so talking to the owner of a secret counts as a reason to reveal it.
- **Carrier could plausibly know it:** 27 yes, 3 partial, 1 no. The 0.6 bar did most of the filtering. Tam, who doesn't know what the goblins want, was the decider's choice for goblin-want 7 times, at 0.40–0.54, just under the bar.

## Relocations (all 31 `decidedRelocations` in gm-nudge)

| # | session | turn | essential | carrier | genuine | plausible | natural | note |
|---|---|---|---|---|---|---|---|---|
| 1 | dv-ignore-tam/0 | 4 | idol | Tam | y | y | 5 | Player had been with the goblins since t1; Tam produces the idol under Skrag's demand. Skrag wasn't selectable. |
| 2 | dv-no-rowan/0 | 3 | holt-order | Holt | n | y | 3 | Not pressed; pushes smashing. Player: "I'm not signing off on smashing a cart". |
| 3 | dv-no-rowan/0 | 4 | charm-cause | Mags | y | y | 4 | Asked directly. The same reply then routes the explanation through Rowan. |
| 4 | dv-no-rowan/1 | 3 | holt-order | Holt | n | y | 3 | Not pressed. "Don't sign it yet." Rowan had already given the insight at t2. |
| 5 | dv-no-search/0 | 3 | silvertop | Cob | n | y | 4 | Authored carrier, asked directly; he blurts it to shield Moll. |
| 6 | dv-no-search/0 | 4 | silvertop (repeat) | Cob | n | partial | 3 | Cob gives away Moll's secret: the crown and "Master Sallow". |
| 7 | dv-no-search/0 | 6 | page | Cob | y | y | 5 | Follows the GM's crackle; Cob unpicks his own boot. |
| 8 | dv-no-search/1 | 3 | silvertop | Cob | n | y | 4 | Answers a gentle appeal about keeping people safe. |
| 9 | dv-no-search/1 | 4 | silvertop (repeat) | Cob | n | partial | 3 | Moll's payment again, told by Cob. |
| 10 | dv-no-search/1 | 6 | not-suicide | Kell | y (redundant) | partial | 3 | Already established by Cob's account (tracker in "doubt" since t3). Kell reads the cord mark from the ground, unasked. |
| 11 | dv-no-search/1 | 7 | page | Cob | y | n | 2 | Same reply as a failed roll; Cob recites a page he can't read. |
| 12 | rp-ablated-idol/0 | 3 | idol | Tam | n | y | 2 | Same reply as a failed Insight roll. |
| 13 | rp-ablated-idol/0 | 5 | goblin-want | Skrag | n | y | 5 | Player had asked Skrag why it matters. |
| 14 | rp-ablated-idol/1 | 3 | idol | Tam | n | y | 4 | Played as a tell after a successful calm roll. |
| 15 | rp-ablated-idol/1 | 4 | idol (repeat) | Tam | n | y | 5 | Player asked; he shows it. |
| 16 | rp-ablated-idol/1 | 6 | goblin-want | Skrag | n | y | 5 | Already said at t4–5; redundant. |
| 17 | rp-ablated-toll/0 | 4 | clause | Garrow | n | y | 5 | The turn after his admission, as authored. |
| 18 | rp-ablated-toll/1 | 4 | arrow | Garrow | n | y | 5 | Player demanded the drawer; same turn as the authored crack. |
| 19 | rp-ablated-tree/1 | 3 | holt-order | Holt | n | y | 2 | Player was talking to Rowan and the porters mid-lift; an irrelevant threat. |
| 20 | rp-dreamed-guarantor/0 | 3 | idol | Tam | n | y | 4 | A slip: "Just a bit o' farm rubbish". |
| 21 | rp-dreamed-guarantor/0 | 4 | idol (repeat) | Tam | n | y | 2 | Same reply as a failed Insight roll. |
| 22 | rp-dreamed-guarantor/0 | 6 | goblin-want | Skrag | n | y | 4 | Already demanded. "Skrag gets the bone now." |
| 23 | rp-dreamed-guarantor/0 | 7 | goblin-want (repeat) | Skrag | n | y | 3 | "Chieftain wants bone—not longlegs" rebuts the player's plan. |
| 24 | rp-dreamed-guarantor/1 | 3 | idol | Tam | n | y | 4 | Player asked; quick but motivated. |
| 25 | rp-dreamed-guarantor/1 | 5 | goblin-want | Skrag | n | y | 4 | Already demanded; an honest no to the escort. |
| 26 | rp-dreamed-guarantor/1 | 6 | goblin-want (repeat) | Skrag | n | y | 3 | "Chieftain wants bone, not longlegs." |
| 27 | rp-dreamed-skids/0 | 3 | holt-order | Holt | n | y | 2 | Player was talking to the porters and Rowan; cuts across the plan. |
| 28 | rp-dreamed-skids/0 | 4 | corvin-book | Rowan | n | y | 3 | Next turn the scene ends "To find Corvin". |
| 29 | rp-dreamed-skids/1 | 3 | holt-order | Holt | n | y | 3 | Not pressed. |
| 30 | rp-dreamed-skids/1 | 4 | holt-order (repeat) | Holt | n | y | 2 | Turns into an ultimatum. |
| 31 | rp-dreamed-skids/1 | 5 | corvin-book | Rowan | n | y | 4 | Answers "tell us what you need", but steers to the book or backing out. |

**Totals:**
- **Genuine:** 5 of 31.
- **Plausible:** 27 yes, 3 partial, 1 no.
- **Natural:** mean 3.5 (3.8 for the genuine ones, 3.5 for the rest).
- **Carriers:** Tam 7, Skrag 6, Holt 6, Cob 6, Garrow 2, Rowan 2, Mags 1, Kell 1.
- **Effect on the player's direction:**
  - 17 served it.
  - 8 pushed an authored alternative the player wasn't pursuing (Holt's order ×6, Corvin's book ×2).
  - 4 restated the authored deal against the player's own plan (goblin-want in both guarantor runs).
  - 2 were redundant.

## What the transcripts show

- **Dice lost to directives.** On all three turns where a failed roll and a relocation coincided (#11, #12, #21), the essential came out anyway. The GM prompt held both instructions: "Insight check: 8 + 2 = 10 vs DC 12: failure. Tam seems like a frightened man telling the truth." and "Let it reach them in this reply through Tam Hollis". `engine.ts:214` appends the relocation regardless of the roll.
- **Rolls on scene edges.** All 18 gm-nudge dice lines were on authored edges and showed a reason. Two reasons didn't match what the player did: "to get Cob to name the men in the loft", when the player was asking about the boot.
- **Earn conditions skipped.** The holt-order essential itself says "will hand it over if pressed". It fired in 5 of the 6 cart-scene runs, always unprompted, and no player ever took it up at that point.
- **Repeats from compound essentials.**
  - Silvertop includes "paid Moll", goblin-want includes "would rather bargain than die", and holt-order includes "if pressed". The landed check waits for the gated half, so the directive is issued again the next turn.
  - Cob voiced Moll's secret in both dv-no-search runs.
  - In both guarantor runs, Skrag said "Chieftain wants bone, not longlegs" on a repeat goblin-want turn. That is suggestive rather than proven: Skrag also refused the escort without any directive (gm/0 turn 3, nudge/0 turn 5).
- **Present cast is tied to the beat.**
  - At dv-ignore-tam/0 turn 4, `characters_present` was only Tam, although Skrag had spoken from the hedge at turn 3. The idol could only go through the farmer the player was ignoring.
  - `state.entered` is only updated when the speaker question is asked, which happens only for the actors voice (`engine.ts:180, 186–189`).
- **The turn-3 gate is in the wrong place for avoidance cases.** All six dv-no-rowan runs (gm, gm-nudge, gm-quick-block) failed the criterion because Rowan delivered the insight, usually by turn 2. That is earlier than relocation is allowed, and the GM's cast notes for the beat put the explanation in Rowan's mouth anyway.
- **Unplanned plans get no chance.** gm-nudge refused the tree lift without dice in both dv-no-rowan runs ("Not safely, love"; "no one lifts that root bed until Rowan says it's safe"), and neither run ended. Skids passed 0/2. In gm-quick-block, the quick co-GM opened an Athletics route with a reason (dv-no-rowan/0) and a Freed route (dv-no-rowan/1).
- **Latency.** The relocation questions ride in the `director.before` call (0.2–0.4 s). gm-nudge resolving text was p50 1.39 s and p90 3.33 s. 11 of 157 turns went over 5 s, all slow GM first tokens in two windows (09:57–09:58 and 10:02–10:03 UTC) that also hit gm and gm-quick-block.

## Essentials that never landed

- **gm-nudge:**
  - goblin-want in dv-ignore-tam/0 is a detector miss: Skrag had already said "Give back, and Skrag goes" at turn 4.
  - corvin-book in rp-ablated-tree/0 and /1 wasn't needed; the player's remedy worked.
  - corvin-book in rp-dreamed-skids/0 was delivered at turn 4 but not detected before the scene ended.
  - None of these hurt a scene.
- **Where a missing clue did hurt (comparison runs):**
  - gm dv-ignore-door/0 and gm-quick-block dv-ignore-door/0: 0/2 landed, the player paid by turn 4–5, and the truth stayed buried. In the quick-block run the decider had the arrow via Garrow at 0.55 on turn 3, then not_now at 0.81.
  - gm dv-no-search/0: no motive. The judge: "After Wren declines to inspect the boot, the only further access is a crackle."
  - gm-nudge dv-no-search/0 is the counterfactual: the decider moved the page to Cob at turn 6 and the run passed. That is the clearest win for decider relocation in this run.

## Comparison (dv cases)

| | gm | gm-nudge | gm-quick-block |
|---|---|---|---|
| judge criterion | 3/8 | 6/8 | 5/8 |
| decider relocations | 0 | 11 | 12 |
| genuine relocations | – | 5 | 5 |

- **Plain gm's own moves were the most natural in the run:**
  - Holt passing on "Rowan says the charm is protecting the tree" (dv-no-rowan/0, turn 2).
  - Skrag: "Skrag smells her on him" (dv-ignore-tam/1, turn 4).
  - Garrow's glances building up to "I was wrong" (dv-ignore-door/1).
  - Cob taking the page out himself after an earned roll (dv-no-search/1).
- **gm-quick-block uses the same decider code and shows the same patterns:**
  - Holt's order at turn 3 in both dv-no-rowan runs.
  - The idol through the ignored Tam at turn 3 in both dv-ignore-tam runs, said to a player examining arrows: "You don't suppose they're after this, do you?"
  - Cob giving the page's written contents in both dv-no-search runs. The judge: "Cob should not be the source of the page's written contents when the prep says he cannot read."
  - Its best relocation: the Clause via Garrow at turn 3 with "If you'll carry the report to Caerwyn, I'll write it plainly—and lift the bar."

## Best 3

1. **dv-no-search/0, turn 6, page via Cob.** The GM's own hint at turn 5 set it up: "The left one gives a papery crackle… 'What's in that boot, Cob?'" The player asks for privacy rather than searching. Then: "'I'm keeping 'em,' he mutters. 'They're good boots.' He pulls off the left one and picks at a loose seam in the lining." At turn 7 Kell connects it to her own secret: "That's what Prout came to ask me about three days ago." Hint first, relocation next turn, nothing searched.
2. **dv-ignore-tam/0, turn 4, idol via Tam.** The player asks Skrag, "what does he have that belongs to you?" Skrag: "Skrag wants Grandmother Bone!… Farmer took from warren. Give back, and Skrag goes." Then Tam "draws out a small figure carved from bone… 'Didn't know it was theirs.' He looks to you, not the goblins. 'What do I do?'" The judge: "the player is never pushed into questioning him." Lucky, though: Skrag wasn't a selectable carrier.
3. **dv-no-rowan/0, turn 4, cause via Mags.** Asked what the charm braces against, Mags: "There. The top branches are scraping the arch, love. I saw the wheels lock harder when Rowan tried to pull it through." This is the only relocation away from the character the player was avoiding. It was spoiled in the same reply, when Holt turns to Rowan for the full explanation, and at turn 5 the lift was refused without a roll.

## Worst 3

1. **dv-no-search/1, turn 7, page via Cob after a failed roll.** The player asks about the crackle. The dice line: "Persuasion check to get Cob to name the men in the loft: 7 + 2 = 9 vs DC 12: failure". Cob says "Cob don't know nothing," then: "'That's where Mister Prout hid his cut-out page,' he blurts… 'Every one signed "J. Sallow, for the Royal Purveyor."'" The prep says Cob can't read. The judge: "the roll neither tests Wren's stated intent nor meaningfully affects the outcome."
2. **rp-ablated-idol/0, turn 3 (same in rp-dreamed-guarantor/0, turn 4), idol via Tam after a failed Insight roll.** "It seems more like a nervous habit than a tell. Then his gaze flicks to the hedge. 'I found a thing in my field, three days back… Little old woman carved on it.'" The judge: "That makes the failed read feel inconsequential."
3. **rp-dreamed-skids/0, turns 3–5, Holt's order then Corvin's book.** The player is setting up poles and timber. Holt: "I have another solution. The order is signed. Break it up…" The player answers "Put the order away, Marshal." Rowan, on the decider's cue: "Corvin has a book on carriage maintenance." The player then says "One porter, please fetch Corvin's book." seek-corvin fires on that, and the scene closes with "The palace doors wait behind you." The judge: "the plan never gets a genuine chance to work."

## Recommendations

1. **Relocation should mean a new carrier.** In `director.ts:169–175`, remove from the options anyone the essential is placed with, and anyone the player is avoiding. That needs `placedWith` as structured `{carrier, condition}` data. Delivery through the authored carrier belongs to the authored edge, its earn condition and its roll. This alone would have removed 26 of the 31, including all six Holt orders and all three cancelled rolls.
2. **Gate on avoidance, not on the turn count.** In the same call, ask per essential: "has the player passed up or refused where this was placed?" Store the answer in state. The essential becomes eligible from that turn (dv-no-rowan needed it by turn 2) and never in scenes where nothing is being avoided (all 20 rp relocations).
3. **Let the dice win.** At `engine.ts:214`, skip relocation when this turn's `pre.move.roll` failed, and also when an authored edge that unlocks the same essential is on offer.
4. **Split gated secrets out of essentials.** holt-order is an option the player can take, not a clue they need (`blocked-entrance.ts:199`). Move "would rather bargain than die" (`crossroads-ambush.ts:53`) and "paid Moll" (`hanged-clerk.ts:373`) into the characters' secrets. Then the landed check stops lagging and the 7 repeats go away.
5. **After a directive, wait, then escalate.** Mark the essential as offered and don't re-issue it for two turns. If it still hasn't landed, change technique (hint, then slip, then reveal), as the turn-5 crackle and turn-6 boot in Best 1 did.
6. **Tell the decider what each carrier knows.** Use one-line summaries of each character's `knows` and `secrets`, or an authored `couldCarry` list per essential, instead of the generic option text. The recurring misses are Tam for goblin-want and Cob for the page's contents.
7. **Fix the present cast for the GM voice.** Count anyone who has spoken in the scene, or update `entered` from the after-reply call. Then Skrag can carry the idol instead of the farmer the player is ignoring.
8. **Only push essentials the player's line needs.** Skip essentials whose only unlock is an exit the player isn't pursuing (Holt's order leads to smashing, Corvin's book to fetching it). Also fix seek-corvin firing when the player sends a porter; that was flagged last round and is still open.
9. **Tell the GM about avoided characters.** When the player refuses someone, that character shouldn't volunteer the essentials. Rowan did this in all six dv-no-rowan runs.
10. **Don't ship gm-nudge on its own.** Apply 1–9 to the shared decider code and keep relocation inside gm-quick-block, the only one of the three that gives an unplanned plan a roll with a reason.
11. **Measure the right things.** Log whether the carrier was the authored one, same-turn failed rolls, and repeats. Add a judge item for "secret earned vs volunteered". Use at least 4 samples per case.

Sources:
- /home/jon/git/kingmaker/runs/evals/20261014-095234-deviation-v3/sessions/ (all 20 `*--gm-nudge--*` and the 16 `dv-*--gm--*` and `dv-*--gm-quick-block--*` sessions)
- /home/jon/git/kingmaker/runs/evals/20261014-095234-deviation-v3/calls.jsonl (`relocate_*` answers in `director.before`, `gm.reply` prompts)
- /home/jon/git/kingmaker/runs/evals/20261014-095234-deviation-v3/results.json
- /home/jon/git/kingmaker/src/runtime/director.ts
- /home/jon/git/kingmaker/src/runtime/engine.ts
- /home/jon/git/kingmaker/scenes/blocked-entrance.ts
- /home/jon/git/kingmaker/scenes/crossroads-ambush.ts
- /home/jon/git/kingmaker/scenes/hanged-clerk.ts
