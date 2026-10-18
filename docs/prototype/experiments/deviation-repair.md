# Experiment: resolving deviations from the authored scene, within a 5-second budget

**Question.** When play doesn't go where the scene was prepped, can the GM still find a satisfying solution, and what does that cost the player in waiting time? The user's framing comes from Gnome Stew's ["When Play Does Not Go to Prep"](https://gnomestew.com/when-play-does-not-go-to-prep/): move elements around, make soft corrections, improvise forward. The budget is a resolving reply within 5 s. Holding beats that serve the story may buy time; canned responses may not.

## Setup

Ten off-graph cases (`src/eval/cases/repair.ts`), each played as a whole scene by a simulated player (Luna) with a persona that pursues the deviation:

| kind | cases | what's off the graph |
|---|---|---|
| **ablated** (`scenes/holed.ts`) | `rp-ablated-idol`, `-tree`, `-toll` | The route to a common ending was removed. The ending itself, with its world script, still exists. |
| **dreamed** | `rp-dreamed-guarantor`, `-skids`, `-workdetail` | Luna invented an approach that none of the routes covers. |
| **deviation** (essentials) | `dv-ignore-tam`, `dv-no-rowan`, `dv-ignore-door`, `dv-no-search` | The player avoids exactly where an essential (clue, insight, evidence) was placed. |

Each case declares the endings that mean the player's approach worked (`targetExits`). The judge is Luna at high reasoning. There were 2 samples per case and condition, so n = 20 per condition.

Conditions (`src/runtime/approaches.ts`):

| condition | essentials in GM prep | relocation | co-GM | timing |
|---|---|---|---|---|
| `gm-rigid` | no | – | – | – |
| `gm` | yes | the GM itself | – | – |
| `gm-fast` | yes | the GM itself | – | speculative replies |
| `gm-nudge` | yes | + per-turn decider picks a carrier | – | – |
| `gm-repair` / `-low` | yes | + co-GM (medium / low) | full review | background, lands next turn |
| `gm-repair-stall` / `-stall-low` | yes | + co-GM | full review | holding beat now, follow-up when the co-GM returns |
| `gm-stall-quick` | yes | + decider + quick co-GM | compact, 3 s deadline | holding beat, follow-up within budget; speculative replies |
| `gm-repair-blocking` | yes | + co-GM | full review | before every reply |

## Results (first run, before the ending fix)

| condition | target ending | scene ended | judge criterion | progress | turns | resolving text p50 | within 5 s |
|---|---|---|---|---|---|---|---|
| `gm-rigid` | 12/20 | 15/20 | 10/20 | 3.85 | 8.7 | 1.40 s | 99% |
| `gm` | 16/20 | 19/20 | 14/20 | 4.20 | 7.8 | 1.35 s | 97% |
| `gm-fast` | 15/20 | 18/20 | 11/20 | 4.00 | 9.4 | 1.07 s | 99% |
| `gm-nudge` | 11/20 | 16/20 | 14/20 | 4.20 | 8.4 | 1.23 s | 100% |
| `gm-repair` | 15/20 | 18/20 | 16/20 | 4.10 | 8.0 | 1.35 s | 100% |
| `gm-repair-low` | 15/20 | 18/20 | 11/20 | 3.95 | 8.1 | 1.33 s | 99% |
| `gm-repair-stall` | 14/20 | 18/20 | 14/20 | 4.10 | 8.1 | 1.36 s (follow-ups ~19.6 s) | 91% |
| `gm-repair-stall-low` | 17/20 | 20/20 | 14/20 | 4.35 | 6.8 | 1.37 s (follow-ups ~10.8 s) | 92% |
| **`gm-stall-quick`** | **18/20** | **20/20** | 13/20 | 4.10 | 7.0 | 1.15 s (follow-ups ~4.2 s) | **97%** |
| `gm-repair-blocking` | 15/20 | 20/20 | 15/20 | 4.35 | 6.3 | **12.5 s** | **0%** |

"Within 5 s" is the share of turns whose resolving text (the follow-up after a holding beat, otherwise the first text) started within 5 s.

## What it shows

1. **The biggest single lever is telling the in-scene GM what the scene needs.** Going from `gm-rigid` to `gm` took the target ending from 12 to 16 and the judge's criterion from 10 to 14, at zero latency cost. With the essentials in its prep and the instruction to move them when play goes elsewhere, the GM relocates clues on its own, as the article recommends.
2. **The co-GM adds a little, and only off the critical path.** A background co-GM (`gm-repair`) never delays a reply (100% within budget). It had the best judge criterion (16/20), but no better target-ending rate than `gm`.
3. **Blocking is the accuracy upper bound but breaks the budget.** It ended every scene, fastest (6.3 turns), but at 12.5 s median and 0% within 5 s. It isn't usable as is.
4. **Stalling works once it's budgeted.** Without a deadline, the follow-up arrives 10–20 s after the holding beat. With a compact quick co-GM and a 3 s deadline (`gm-stall-quick`), follow-ups start at ~4.2 s. 97% of turns stay within budget, and it had the best target-ending rate (18/20) with every scene ending.
5. **Speculative replies are free latency:** median first text 1.38 → 1.10 s with no quality loss. Half of turns keep the speculative reply.
6. **Bug found: a holed scene ended in the improvised ending instead of its authored one.** The improvised ending's "prefer authored" check only saw authored endings that still had routes. Fixed: it now defers to any authored ending the ending-state question finds plausible (`f072557`). A re-run of the leading conditions follows below.

## Qualitative investigation

Four Claude analysts each read the transcripts for one group of conditions. Their full reports are in [deviation-investigation.md](deviation-investigation.md). The headline findings:

- **With the essentials in its prep, the in-scene GM relocates naturally.** Holt passes on Rowan's diagnosis and Mags names the fix; Skrag answers a player who talks to the hedge; Cob offers to open his own boot; Garrow's fear leaks into the argument. Without the essentials (`gm-rigid`), the hedge stays silent until a scripted cue, the toll truth stays buried, and Kell keeps pointing at the boot. On the four placement cases the criterion passed 2/8 for `gm-rigid`, 6/8 for `gm` and 7/8 for `gm-nudge`.
- **Decider relocation lands every essential, but often as an info dump.** 47 of 56 relocations were early reveals through the *original* carrier, 24 of them on turn 1. Garrow volunteers his Clause; Cob recites a page he can't read. It had the lowest consistency score. It needs restraint: wait until the player has had a fair chance at the original placement, use a carrier the player is actually engaging with, and move one thing at a time.
- **Plausible plans the prep didn't foresee get refused without dice.** Lifting the tree off and the skids plan were turned down in-story, and the GM steered back to the authored routes (skids passed 0/8). With rolls tied to edges, the fix is for the co-GM to *add an edge with a roll* (and a reason) for such plans. That's what the blocking co-GM did, and why it scored better on dreamed plans (judge 5/6 against 2/6).
- **Holding beats served the story but were too long, and the seam with the follow-up was poor.** Of 35 holds, about 26 were real beats (a hesitation, a tell, an action set in motion) and none were canned. But they ran at ~62 words against the 1–2 sentences asked, a quarter already answered the attempt, and only ~40% of follow-ups continued cleanly: a third repeated or rewound the beat. Part of the cause is that the co-GM starts before the beat exists. And with the quick co-GM (~2–3 s), the follow-up arrives while the player is still reading the beat, so the hold buys little that a single 3–4 s reply couldn't.
- **The background co-GM's status trigger never fired.** The after-reply status said "drifting" or "uncovered" on 0 of 322 turns, so the co-GM ran on its 3-turn timer and missed the moments that define a deviation. When its output arrived, it was used, often nearly verbatim. Its routes fired in 14 sessions and helped in 12. It hurt when it pushed essentials the player's plan didn't need (Corvin's book: 3 of 3 such sessions ended "To find Corvin"), added dice to problems already solved, or whispered the same thing twice.
- **Blocking isn't worth 12 s.** It rated roughly the same as `gm-stall-quick` (3.7 vs 3.5). What it buys is routes with rolls for new plans before the reply, and a budgeted quick co-GM can do that too.

### Changes made from the investigation (`1331525`)

- Decider relocation only after 3+ player turns, through someone the player is engaging with, one essential per reply.
- The quick co-GM can open a route **with a roll and a reason** for plausible plans no route covers.
- **`gm-quick-block`:** on off-graph turns only, wait up to 3 s for the quick co-GM, then give one coherent reply. That fits the 5 s budget with no beat/follow-up seam.
- Holds only on genuinely off-graph turns, capped at 1–2 sentences.
- Off-graph turns trigger the background co-GM, and whispers are used once.


## Re-run after the ending fix (leading conditions, n = 20 each)

| condition | target ending | scene ended | judge criterion | progress | turns | resolving text p50 | within 5 s |
|---|---|---|---|---|---|---|---|
| `gm` | 16/20 | 18/20 | 12/20 | 3.95 | 8.8 | 1.22 s | 99% |
| `gm-nudge` | 14/20 | 17/20 | 12/20 | 3.85 | 8.2 | 1.15 s | 99% |
| `gm-stall-quick` | **17/20** | **20/20** | 13/20 | 3.95 | **6.8** | **1.09 s** | **100%** |

No run ended in the improvised "ending of their own" any more (0/60, against several before): authored endings win when they fit. `gm-stall-quick` remains the best within-budget option: it always reaches an ending, in the fewest turns, with every resolving reply inside 5 s.

## Round 3, after the investigation's fixes (n = 20 each)

| condition | target ending | scene ended | judge criterion | progress | turns | resolving text p50 / p90 | within 5 s |
|---|---|---|---|---|---|---|---|
| `gm` | 14/20 | 18/20 | 10/20 | 3.90 | 8.8 | 1.53 / 2.76 s | 98% |
| `gm-nudge` (restrained) | 14/20 | 17/20 | **15/20** | 4.10 | 8.7 | 1.39 / 3.32 s | 93% |
| `gm-repair` (off-graph-gated background) | 15/20 | 19/20 | 11/20 | 3.95 | 7.7 | 1.43 / 2.96 s | 97% |
| `gm-stall-quick` | 17/20 | 20/20 | 13/20 | 4.05 | 8.2 | 1.21 / 3.24 s | 97% |
| **`gm-quick-block`** | **19/20** | **20/20** | 14/20 | **4.15** | **6.8** | 1.29 / 4.18 s | 95% |

**`gm-quick-block` is the best design within the 5 s budget.** On ordinary turns it replies at once, speculatively. When the decider judges the player has gone off the graph, it waits up to 3 s for the quick co-GM: a compact, no-reasoning call that opens a route (with a roll and a stated reason when the outcome should be uncertain) or relocates a missed essential. Then it sends one coherent reply. It reached the intended ending 19/20 times, ended every scene in the fewest turns, and scored highest on "intent" (the player's idea taken seriously, 4.2). Because the wait only happens on the few off-graph turns, the median reply stays at 1.3 s.

### Round 3 checks (2 Claude analysts; [deviation-round3-checks.md](deviation-round3-checks.md))

The analysts tempered the round 3 headline:

- **Quick-block barely ran.** It fired on 6 of 135 turns. Its 19/20 against stall-quick's 17/20 comes down to one case where neither off-graph path fired and the in-scene GM decided alone. So that gap is noise. Three causes:
  - plans phrased as questions ("could we…?") didn't count as off-graph;
  - the decider's relocations pre-empted it;
  - the quick co-GM only saw the current beat's routes.
- **Relocation still wasn't relocation.** Only 5 of 31 were genuine. The other 26 pulled the essential out of *its own authored carrier* as soon as the turn gate opened, including in scenes where the player wasn't avoiding anything. Holt's signed order was pushed six times; Corvin's book was pushed and steered a player to "To find Corvin". Those two are options, not clues.
- **What worked:** all 21 rolls sat on edges and showed a readable reason, and one quick-co-GM note turned a refusal without dice into a yes ("We can take the cart apart from the outside, piece by piece, love").

Changes for round 4 (`2350645`):
- Essentials list their authored carriers, and decider relocation excludes them: relocation means someone *else*.
- Relocation is framed on avoidance ("has the player passed up where it was placed?"), skips a turn whose roll failed, and never pre-empts the quick co-GM. Options and secrets moved out of essentials.
- Off-graph detection counts plans put as questions. Attempts that don't end the scene need 0.45 confidence.
- The quick co-GM sees every beat's routes plus the cast's wants and secrets. It gives uncertain plans a roll with a specific failure consequence, and adds scene-wide routes.
- Quick-block starts the quick co-GM alongside the decision, with a deadline from the start of the turn. A late result keeps the speculative reply.

## Round 4 and the pooled picture

Round 4 (`2350645`, n = 20 each): `gm` 12/20 target endings, `gm-nudge` 18/20, `gm-stall-quick` 19/20, `gm-quick-block` 17/20. Every roll showed a reason (100%). The tightened relocation (new carriers only, on avoidance) **never fired** (0 relocations), an over-correction from the 26/31 early reveals before it. Without it, the in-scene GM still landed the essentials on 12–14 of 16 placements in the deviation cases, so the essentials in the prep do that job.

Single rounds of 20 are noisy: the same `gm` configuration scored 16, 16, 14 and 12. Pooled across rounds:

| condition | runs | target ending | scene ended | judge criterion | within 5 s |
|---|---|---|---|---|---|
| `gm-rigid` (no essentials, no co-GM) | 20 | 60% | 75% | 50% | 99% |
| `gm` (essentials in prep) | 80 | 72% | 88% | 60% | 97–99% |
| `gm-nudge` (decider relocation, as it evolved) | 80 | 71% | 86% | 69% | 93–100% |
| `gm-repair` (background co-GM) | 40 | 75% | 92% | 68% | 97–100% |
| **`gm-stall-quick`** (holding beat + quick co-GM) | **80** | **89%** | **99%** | 62% | 96–97% |
| **`gm-quick-block`** (quick co-GM, one reply) | **40** | **90%** | **95%** | 70% | 95–99% |
| `gm-repair-blocking` (full co-GM before every reply) | 20 | 75% | 100% | 75% | **0%** |

## Conclusions

1. **Tell the GM what the scene needs.** Essentials (what the player must come across, where it was placed, that it can move) let the in-scene GM relocate missed clues itself, at no cost: 60% → 72% target endings. Analysts saw it move clues to whoever the player was engaging with, in ways that "felt like they were always there".
2. **A quick co-GM inside the budget is the repair step that reliably helps:** ~89–90% target endings and 95–99% of scenes ending, against ~72–75% without one. It's a compact, no-reasoning call that opens a route (with a roll and a reason when uncertain) or relocates a missed essential. With a 3 s deadline it keeps 95–99% of replies within 5 s.
3. **The full co-GM belongs in the background.** It never delays a reply and adds a little, from canon and routes for later turns. Blocking on it buys nothing over the quick co-GM and makes replies take 12.5 s.
4. **Hold beats or a single wait both work.** Holding beats served the story (never canned) but tended to run long and pre-resolve the attempt, and the follow-up sometimes rewound them. A single wait of up to 3 s on the rare off-graph turn (~5% of turns) gives one coherent reply and still keeps the median at ~1.2 s.
5. **Leave relocation to the GM and the quick co-GM, not the per-turn decider.** The decider either dumped secrets early through their own carrier, or, once restrained, never fired.
6. **Rolls stay on edges and always say why.** That includes the quick co-GM's new routes: "Athletics check to work with the porters and lever the cart onto a timber track…".

**Recommended configuration: `v2`** (now the CLI default). Single GM voice with essentials in its prep, Luna decision mode, speculative replies, the quick co-GM on off-graph turns with a 3 s deadline, and the full co-GM in the background.

**`v2` on its own (n = 20):** target ending 15/20, scene ended 19/20, judge criterion 15/20 (the highest criterion score of any condition), progress 4.00, 8.2 turns, resolving text p50 1.16 s / p90 3.00 s, **100% within 5 s**. The quick co-GM was waited for on 13 turns. The target-ending figure is within round-to-round noise of the pooled quick co-GM results.
