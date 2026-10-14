# Kingmaker V2 PoC: findings

What the overnight experiment of 2026-10-14 learned about GM-run scenes. The brief is [Kingmaker V2 prototype.md](../Kingmaker%20V2%20prototype.md). How to run everything is in the [README](../README.md). The blow-by-blow is in [LOG.md](LOG.md), the blind QA write-ups are in [qa/](qa/), and the background research is in [research/](research/).

**Caveats first.** Most numbers come from LLM judges (GPT-6 Sol, medium reasoning) scoring simulated or Claude-played sessions, with small samples: 2–4 per case, and 6–25 for trajectories. Treat differences under about 0.4 on a 5-point scale as noise. Blind QA was qualitative: 7 Claude players across 2 rounds.

## TL;DR

1. **The hypothesis holds.** When the GM knows the possible endings of a scene, and also what the scene can't offer, it improvises freely and stays honest about the world. The V1 failure ("find another route for the cart") became a clean "no, but" in every run once the scene said so concretely: "Fetching extra people to help (the dwarves…): nobody can be brought in time, because…" (0/6 → 6/6).
2. **Single-turn improvisation was good from the start.** The hard problems were all at the joints: when a scene ends, what carries into the next scene, when to roll, when the world should push, and what happens when the player finds an ending nobody wrote. Most of the night went on runtime structure at those joints, not prompt wording.
3. **One GM voice (`gm`) beats per-character actors (`actors`) for multi-character scenes.** It is more coherent, paces better, and makes fewer calls. Actors give more truthful, isolated characters, but needed extra machinery (presence, momentum) to stop stalling, and still lose on three-NPC scenes.
4. **Use Luna's decision mode (`openai/gpt-6-luna-decisions`) as the director.** It scored 93–100% on the labelled decision suite at about 0.25 s, against Jev's 73–81% at about 0.3 s and Luna structured output's 90% at about 1.2 s. Over whole scenes the difference between Luna decisions and Jev is within noise.
5. **The background co-GM repair agent showed no measurable benefit** once the in-scene GM had good per-turn context. The ideas that helped came from its design work, now done synchronously by the cheap decider: status, "no, but", held endings and momentum.
6. **Rolls belong on scene edges, and must say why.** This was your steer, and blind QA agreed. Freeform "risky attempt" rolls are now off by default. Every roll shows its reason: `🎲 Persuasion check to calm Tam and earn his trust: 20 + 2 = 22 vs DC 10: success`.
7. **The authored beat sequence matters less than expected.** The same scene written as a *situation* (cast, secrets, limits, endings, one pressure, no beats) scored as well as the beat graph for the single GM voice, and reached endings faster.
8. **Phase 2 works as a stub.** A scribe agent writes `update(world)` scripts against a bounded DSL. They compiled 26/26 on the first attempt, with fidelity about 4.1–4.25/5 and boundedness about 5/5. Its `unsupported(...)` escape hatch is a good way to grow the DSL from real play.
9. **More GM reasoning doesn't help.** Luna as GM at `low` / `medium` reasoning showed no measurable quality gain over `none` (81/88/81% criterion pass), and `medium` more than doubled time to first text (1.6 → 3.7 s median). Keep `none`. A Luna-high *judge* agreed with Sol on 80% of verdicts at about 1/15 of the cost, which makes it good for cheap screening.
10. **It's snappy and cheap.** First text arrives at about 1.1 s median (p90 about 1.7 s). The decision call takes about 0.28 s. A turn costs under $0.001 in game calls. The night's total of about $25 was mostly the judge model.

## Afternoon round (2026-10-14): absurdity, pressure, techniques, continuity

- **Comic house style.** The steer was Pratchett / Monty Python silliness around a good story, with real repercussions. `v2` now uses [prompts/tone-comic.md](../prompts/tone-comic.md): the world plays it straight, people argue *inside* the bit, and daft acts send a bill. A decider flag tells the GM to follow a consequential daft act through. Over 8 blind players in 2 rounds:
  - humour stayed at about 4/5;
  - mean consequences rose from 2.5 to 3.25;
  - a straight control player said it "never made the danger feel fake".
  
  Bills are still too gentle, and the bill that comes due later needs memory across turns and scenes. See [experiments/absurdity.md](experiments/absurdity.md).
- **Characters as the GM's mouthpiece (playtest 1).** Co-GM whispers that set terms, such as "Wren must say specifically how Cob will be kept safe", were recited as dialogue.
  - Fixed at the source: whispers are now what's on someone's mind.
  - In the GM: people voice worries, not deals; cards are marked as unspoken prep; hinted clues are tracked so they aren't pushed again.
  - Coaching lines in fresh sessions went from 4/49 to 0/52. Once coaching is in the history, the GM still imitates it.
- **Pressure rolls (`v2-pressure`, opt-in).** The ruling follows researched DC guidance ([research/dc-guidance.md](research/dc-guidance.md)): what telling costs the holder × the player's leverage × how the holder feels gives a yes, a no, or a roll at DC 12/15/18. It includes let-it-ride, success rides, "no, but" and "no, and" bands, and a player-facing gloss on the dice line. Luna decisions scored 92% on the labelled cases, Jev 75–83%. Jev rolls when the person would tell anyone. Whole-scene validation is still to do. See [experiments/pressure-rolls.md](experiments/pressure-rolls.md).
- **The six techniques** (move the clue, soft correction, preserve intent, NPC initiative, fail forward, rejoin later): 12 cases from [research/gm-techniques.md](research/gm-techniques.md).
  - Soft correction and fail forward pass.
  - Preserve intent failed 0/4 on a real gap: a threat was rolled on the authored Persuasion route. Now a social attempt rolls the player's own method, and the case passes 3/3.
  - NPC initiative and rejoin-at-a-later-node are weak (about 1/4).
- **Continuity research** ([research/compaction.md](research/compaction.md)):
  - No built-in compaction is usable through OpenRouter. `/responses/compact` returns 404, and the encrypted summaries are unreadable to the rest of our pipeline.
  - Context size isn't the problem anyway; state is. Props, clocks and agreements drift.
  - Design: a background world-state tracker re-injected as "how things stand", a rolling story-so-far after about 20 exchanges, and decision-mode note selection to re-hydrate (V1-style progressive disclosure). Agreements must always be included, not selected.
- **Two runtime fixes.** A route already won in this beat isn't offered again: absurd QA had Cob take back what he'd said after a re-rolled check failed. The decider is slower today: Luna decisions took 0.5–1.4 s per call, against 0.2–0.35 s earlier.

## Recommended configuration: `v2`

The single GM voice with essentials in its prep, in the comic house style with the consequence flag, Luna decision mode, speculative replies, the quick co-GM on off-graph turns (3 s deadline, one coherent reply), and the full co-GM in the background. It's the CLI default. `v2-straight` is the same without the comic style (the configuration of the deviation experiment); `v2-pressure` adds pressure rolls. On the off-graph experiment (pooled, quick co-GM variants): ~90% of scenes ended the way the player's approach should lead, 95–99% of scenes reached an ending, and 95–99% of replies resolved within 5 s at a median of ~1.2 s. See [experiments/deviation-repair.md](experiments/deviation-repair.md).

## Resolving deviations within a 5 s budget

Full write-up: [experiments/deviation-repair.md](experiments/deviation-repair.md). 10 off-graph cases (routes removed, invented approaches, players avoiding where a clue was placed) × 10 conditions × 2 samples.

- **Telling the in-scene GM what the scene needs is the biggest lever.** That means essentials: what the player must come across, where it was placed, what it unlocks, and that it can be moved. It took the target ending from 12/20 to 16/20 and the judge's criterion from 10/20 to 14/20, at no latency cost.
- **Blocking on the co-GM is the accuracy upper bound but breaks the budget.** It ended every scene in the fewest turns, but at a 12.5 s median reply and 0% of turns within 5 s.
- **Stall-and-report-back works once it's budgeted.** On an off-graph turn, a generated holding beat streams at ~1 s while a *quick* co-GM (compact output, no reasoning, 3 s deadline) decides. The follow-up starts at ~4.2 s, 97% of turns resolve within 5 s, and it scored the best target-ending rate (18/20). Without the deadline, follow-ups took 10–20 s.
- **A background co-GM never costs latency** (100% within budget). It lands next turn and adds a little.
- **Speculative replies** start the GM alongside the decision and keep the reply when the decision changes nothing. That cuts median first text from 1.38 s to 1.10 s for free.
- **Pooled over 4 rounds:** target endings were 60% with no essentials and no co-GM, 72% with essentials, 75% adding the background co-GM, and **89–90% adding the quick co-GM** (stall or single-wait variants), with 95–99% of replies within 5 s. Leave relocation to the GM and the quick co-GM: the per-turn decider either dumped secrets early or, once restrained, never fired.
- **Best design so far: `gm-quick-block` (now `v2`).** Ordinary turns reply at once. On a turn the decider judges off the graph, it waits up to 3 s for the quick co-GM: it opens a route (with a roll and a reason when the outcome should be uncertain) or relocates a missed essential. Then it sends one coherent reply. Intended ending 19/20, every scene ended, fewest turns (6.8), 95% of replies within 5 s (median 1.3 s). The holding-beat variant (`gm-stall-quick`) works (17/20). Claude analysts found the beats were real story beats, never canned, but often too long, and the follow-ups repeated or rewound them. A single short wait reads better.

## What was built

One runtime (`src/runtime/`) where each orchestration choice is a preset, so every approach is a runnable PoC on the same scenes:

| approach | voice | decider | co-GM |
|---|---|---|---|
| `gm` | one GM narrates and voices everyone | Luna decisions | – |
| `gm-jev`, `gm-luna` | one GM | Jev / Luna structured output | – |
| `gm-repair` | one GM | Luna decisions | background, gated |
| `actors` | the decider picks the speaker; per-character Luna actors; GM narrates | Luna decisions | – |
| `actors-jev`, `actors-repair` | actors | Jev / Luna decisions | – / background |

Nine scenes cover a range of shapes: character creation chained into an ambush and its aftermath, a 1:1 toll negotiation, a hostage negotiation with a would-be usurper, V1's three-agenda cart standoff, a four-faction village standoff, an investigation, and a situation-format variant. There is a headless CLI for blind play, and an eval harness with decision, reply, trajectory, opening and world suites (95 cases). QA failures become eval cases through per-turn snapshots.

## The turn loop that emerged

```
player turn
  └─ decide (Luna decisions, one call, ~0.28 s), all questions in parallel:
       attempt?   an authored route (maybe with a roll), something that simply happens (no dice), or nothing
       cue?       should the world push now (pacing)
       limit?     is the player reaching for something the scene can't offer
       ooc?       is this out of character
       speaker?   (actors only)
  └─ reply (Luna, reasoning none, streamed): prep + "for this reply" directions
  └─ decide again (~0.27 s, after the text is shown):
       outcome?   has something happened; for cues, has the next beat begun
       status?    on track / drifting / stuck / uncovered  → momentum rule, co-GM gate
  └─ endings:  chosen → close now · not chosen → held one turn · happened → wind-down turn
  └─ exit:     hand-off for the next scene · authored world script · (Phase 2) scribe
```

## Findings in detail

### 1. Improvisation: what failed and what fixed it

Single replies were good from the first run: about 4.2–4.5/5 on every dimension, with player inventions woven in. For example, a player-invented goblin acquaintance "Nettlegums" became a debt in Skrag's lines. Multi-turn play exposed the real problems. Each fix below is general, not a scene patch. Before/after numbers come from the eval named.

| failure (where it started) | fix | evidence |
|---|---|---|
| **One roll ends the scene before the player can respond** (exit fired on a failed check). | Endings the player didn't choose are held for one last response. The same reply can't confirm a held ending. | Failed-threat case 2/6 → 6/6. Trajectory progress 3.3 → 3.5 (gm), 1.8 → 3.5 (actors). |
| **Closing call bolted on after the reply** (narrated twice, spoke for the player). | Outcome endings get a wind-down turn. The authored closing is "what the ending should feel like". "Stay in the moment: a scene ends at the threshold". | QA ending cases fixed (handover once 4/4, departure 3/3, overrun 0/4 → 3/3). |
| **Nearest-edge forcing** (a pickpocket rolled as Insight). | Risky actions no edge covers are resolved in the fiction (freeform rolls tried, then turned off on your steer). | QA case resolves in story ("Tam's hand snaps down over yours"). |
| **Rolls with nothing at stake** (the decider only saw roll-gated options). | "Simply happens, no dice" alternatives shown to the decider, and "none" described positively. | Kind greeting no longer rolls; decisions 91% → 100%. |
| **Invented allies or routes** (V1's "find another route"). | Scene `limits`, phrased as *the thing: why not*, plus a limit cue that gives the GM a "no, but" directive. | Dwarves 0/6 (vague limit) → 6/6 (concrete limit). |
| **Invented hooks** (an iron key in a goblin's pouch, a fresh mystery carving). | GM principle: tie improvised details to threads already in play. | Improved but not solved: the milestone-mark case is still weak. |
| **Probes end scenes** ("I study the runes" solved the cart). | Scene-ending attempts need a committed attempt and ≥ 0.6 decider confidence. | Entrance consistency 3.25 → 4.17. |
| **Next scene forgets the last** (an opening on a fight that never happened). | A hand-off of how things stand, written at the exit, plus the last moments verbatim. Prep is told "play outranks prep". | Openings 1/12 → mostly passing (3/4, 3/4, 1/4). |
| **Actors stall** (a character never spoke because "presence" lagged the narration; NPCs deferred to each other). | Off-stage characters can be called in. Momentum rule: a "stuck" status makes the next reply break the loop. | Actors entrance progress 2.2 → 3.9. |
| **Tracker lag** (the GM brought the goblins on, the cue fired a turn late). | After the reply, cues are judged by their *effect* (the next beat began). | Goblins-arrived 0/2 → 2/2. |
| **An improvised offer with no exit gets retracted** (the GM offered "walk with Skrag", then took it back). | A built-in "ending of their own" in every scene; the scribe makes it true. Authored endings are preferred when plausible. | Offered walk honoured whenever the roll succeeds; no premature own-endings in trajectories. |
| **Out-of-character questions leak secrets** ("what are my options?" revealed Skrag's willingness to bargain). | OOC question in the decision → an out-of-character answer with no secrets and no dice talk. | Meta case 2/9 → mostly passing. |

Reply suite at its best: gm 94%, actors 96% criterion pass (16 crossroads and entrance cases × 3).

### 2. Who speaks: one GM voice vs actors

- **gm is the better default.** It's coherent, it paces well, it voices whoever is needed (including people "not on stage yet"), and it makes about 3 calls per turn against about 4.7.
- **actors** isolate knowledge well (no "longlegs" voice bleed) and often give more truthful character reactions. But they need a director to keep pace. Before the presence and momentum fixes they stalled badly on three-NPC scenes (progress about 2.2). After them they're close to gm on the crossroads (3.8 vs 4.0) and still behind on the larger casts.
- Cast notes written as imperatives ("beg them to walk him home") turn into repetition. They work better framed as "what they're after; pursue it naturally; don't repeat yourself".

### 3. Deciders: Jev vs Luna's decision mode

| decider | labelled decision suite | latency |
|---|---|---|
| Luna decisions (`openai/gpt-6-luna-decisions`) | 93–100% | 0.17–0.33 s |
| Jev 1.13 | 73–81% | 0.23–0.34 s |
| Luna structured output (`luna-none`) | 90–100% | 1.0–1.3 s |

- Jev reads loosely worded criteria liberally. Its misses usually had lower confidence. A Jev → Luna cascade on low confidence reached 82%.
- In play the difference is within noise (pooled trajectory progress about 4.04 vs 4.17). Jev rolled freeform checks 3× more often, which the judge seemed to like for pacing but blind players disliked.
- Classifier design lessons:
  - Every option needs a positive description; a bare "none" loses to plausible-sounding edges.
  - Adding a near-duplicate option splits the vote.
  - Show the decider the alternatives (no-dice routes), not only the roll-gated ones.
  - Cost-scale the threshold: ending the scene or saying "no" needs ≥ 0.6.

### 4. The co-GM (background repair agent)

It was built from the PR #649 lessons:
- gated on a per-turn status question rather than every turn;
- scene-enum ids, so it can only point at real beats and exits;
- whispers to individual characters (Versu-style desire tweaks);
- mandatory "no, but" alternatives;
- additive routes only;
- notes that expire after 3 turns (Friends & Fables found persistent plans made their GM railroady);
- never blocks a turn.

It produced sensible notes, but trajectories showed **no measurable gain** (entrance: gm 4.0 vs gm-repair 3.5; crossroads: 3.5 vs 3.67), and in round 1 it once worked against the player's choice with a stale note. The cheap per-turn decider now does most of what we wanted from it: status, "no, but", held endings, momentum. The co-GM's remaining niche is long-horizon work: lagging trackers over many turns, canon, and adding a route with a roll for a genuinely new approach. Evaluate it again on longer scenes before investing more.

### 5. Rolls tied to plot beats

Your steer was: "rolls should be tied to plot beats… and it should say why you're rolling". Round 1's blind players independently called out "dice with nothing at stake". Now:
- only authored edges (or edges the co-GM adds) roll;
- every check has a player-facing `reason`, shown on the dice line and given to the GM so the narration shows the stakes;
- a failed roll complicates things and never takes back what was already offered;
- one roll rarely ends a social scene: authored failures stay in the beat, and endings not chosen by the player are held.

### 6. Scene representation: beat graph vs situation

| format (gm, 3 personas × 3) | progress | criterion | turns to an ending |
|---|---|---|---|
| beat graph | 4.10 | 8/9 | 9.0 |
| situation (no beats) | 4.57 | 9/9 | 7.2 |

What actually carried the scene was the cast cards (wants, fears, what they know, secrets), the endings, concrete limits, and a pressure for stalls. Beats are still useful for actors (who lack a central pacer) and for authors who want guaranteed moments. But the minimum viable scene is smaller than a conversation tree.

Authoring rules that fell out of the evals (also in `src/runtime/scene.ts` comments and the authoring prompt):
- Never author an option with no exit.
- Write limits as concrete things with in-fiction reasons.
- Put "clever solutions" in a character's secrets.
- Don't describe the next beat inside a beat's direction.
- Settings mustn't presume how the previous scene ended.

### 7. Phase 2: world updates

`src/world/dsl.ts` is a stub world API bounded by an asset catalogue, scene anchors, known locations and the cast. The scribe (Luna, medium reasoning) writes `function update(world)`. It's typechecked with `tsc` and run in a `vm` against a recording world. `npm run scene -- world <session>` does it for a played session.

| run | compiled first try | coverage | fidelity | bounded | restraint |
|---|---|---|---|---|---|
| append to authored script (10 endings) | 10/10 | 4.0 | 3.9 | 5.0 | 4.1 |
| reconcile with authored defaults (10) | 10/10 | 3.8 | 4.1 | 5.0 | 4.2 |
| reconcile, later scenes (16) | 16/16 | 4.0 | 4.25 | 4.94 | 4.5 |

- **Authored exit scripts drift from what was narrated.** "Tam moves to Hollis Farm" when he's still on the road; "goblins will return" when they only might. So the authored script should be a default the scribe reconciles, not ground truth.
- **`world.unsupported(...)` grew the DSL from play.** The first runs asked for improvised props (a ticking brass beetle), marks (a carved broken-sun), promises ("goblins owe Tam two days' work") and places outside the scene. All four are now first-class (`improvisedProp`, `mark`, `promise`, `location`).
- **Still missing:** group members (Skrag's four goblins leave too), in-transit locations, changes to an existing prop's state (a sapling lifted off a cart), and what the player learned.

## Recommendations for V2

1. **Adopt the scene manifest:** cast cards, endings with world scripts, concrete limits, a pressure, a built-in "ending of their own", and optional beats. Author situations first and add beats only where an author wants a guaranteed moment.
2. **Default to one GM voice with Luna's decision mode as director.** Keep actors as an option for scenes with one or two NPCs, where knowledge isolation matters more.
3. **Keep the joints in code, not prompts:**
   - held endings and wind-down turns;
   - hand-offs between scenes;
   - committed-attempt and limit confidence thresholds;
   - the momentum rule;
   - cue effects judged after the reply;
   - OOC handling.
4. **Rolls only on edges, always with a reason.** Let the co-GM propose new edges with rolls when the player finds a genuinely new approach.
5. **Phase 2:**
   - make authored exit scripts defaults that the scribe reconciles;
   - keep `unsupported(...)` and review it periodically;
   - add groups and transient states next.
6. **Don't invest more in the co-GM** until it's evaluated on longer scenes. Make sure it stays non-blocking and its notes stay ephemeral.

## Open questions

- The judge is an LLM. It mostly agreed with the blind players, but sometimes it rewards eventfulness (more rolls) that players dislike.
- Long sessions (20+ turns) still show continuity slips: positions, sums, who is on the rope. A per-scene canon log written by the after-reply decision (cheap) might do better than the co-GM.
- The secret-giveaway pressure is real: when the player gets close, characters sometimes volunteer the hidden solution. Isolating knowledge per NPC (actors) helps, at a coherence cost.
