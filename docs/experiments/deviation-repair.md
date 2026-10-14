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

Four Claude analysts read the transcripts by condition group; the summary follows below.
