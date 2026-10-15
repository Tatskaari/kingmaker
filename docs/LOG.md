# V2 PoC lab notebook

Running log of hypotheses, experiments and results. Newest entries at the bottom.

## 2026-10-14 — Setup

- Repo cleared on `claude/kingmaker-v2-poc`; V1 is at commit `a6cb07f`, PR #649 at branch `pr-649`.
- Node 26 runs `.ts` directly (type stripping), so no build step. `npm run typecheck` uses TypeScript 7.
- Model probes (single calls, cold):
  - Luna (`openai/gpt-6-luna`, reasoning `none`, Responses API, streaming): first text ~1.3 s, total ~1.5 s for one line. ~$0.00001 per short call.
  - Jev (`typesafe/jev-1.13`, `POST /api/alpha/decisions`): 0.2–0.45 s for two questions. ~$0.00002 per call. Returns probabilities + confidence.
  - Luna as a decider (strict JSON schema enum, reasoning `none`): ~1.1 s for the same two questions.
  - The Decisions endpoint rejects `openai/gpt-6-luna`; Responses `reasoning.mode` only accepts `standard|pro`. So "Luna decision mode" is implemented as Luna + strict structured output (`src/llm/decide.ts`), same interface as Jev.
- User steer during setup: judge runs on how the GM and characters improvise around unscripted tangents, not on scene authoring polish; build multiple runnable PoCs that demonstrate the different approaches.

## 2026-10-14 — Runtime skeleton and first evals

Built one runtime with interchangeable approaches (`src/runtime/approaches.ts`): `gm` (one GM voice, Jev director), `gm-luna` (Luna director), `gm-repair` (+ background co-GM), `actors` (decider picks speakers, per-character Luna actors), `actors-repair`. Scenes are TS modules (`scenes/`): cast, beats with direction/cast notes/pressure, transitions (`attempt` / `cue` judged before the reply, `outcome` after), edge-gated checks, exits with world scripts.

Smoke-test findings:
- Luna (reasoning none) sometimes splits a reply into a `commentary` message plus a `final_answer` that critiques it ("'Tam Hollis awaits your response' is GM-facing text…"). The final_answer alone is then wrong. Fix: detect multi-phase output and retry once; always give the model a user turn.
- GM voicing everyone bleeds voices: Tam says "longlegs" (Skrag's word for humans).
- The GM rushes several beats into one reply when the beat direction mentions the next event. Directive now says "play the start of this, let the rest unfold".
- Tracker lag: the GM brought the goblins on itself; the cue then fired a turn later. Post-reply judging now considers cues as outcomes too.

### Decision suite (11 cases × 3 samples, `--suite decision`)

| decider | accuracy | mean latency |
|---|---|---|
| Jev | 73% | 241–253 ms |
| cascade (Jev, Luna when Jev confidence < 0.8) | 82% | 571 ms |
| Luna none (strict JSON enum) | 91% → 100% after fix | ~1.0–1.1 s |
| Luna low | 91% | 1.45 s |

- All deciders rolled persuasion on a kind greeting, because the pre-reply question only listed the roll-gated "attempt" edges. Showing no-roll outcome edges as "simply happens, no dice needed" alternatives fixed Luna (100%) but not Jev.
- Jev reads loosely-worded criteria liberally ("presses him about why the goblins are after him" matched "who else knows about the goblins?"). Its wrong answers had lower confidence (0.66–0.72 vs ~1.0), but not always below the threshold.

### Reply suite baseline (8 improvisation cases × 3 samples, Sol judge)

| approach | criterion pass | intent | consistency | characters | steering | craft |
|---|---|---|---|---|---|---|
| gm | 83% | 4.26 | 4.70 | 4.09 | 4.30 | 4.22 |
| actors | 88% | 4.50 | 4.58 | 4.25 | 4.38 | 4.04 |

Single-turn improvisation is already decent. Failures: threatening to smash the idol fires the intimidation edge → one roll ends the scene (tension never rises); "what are my options?" leaks Skrag's secret willingness to bargain; one blunt out-of-fiction "you can't teleport".

## 2026-10-14 — Trajectories, QA round 1, runtime v2, Luna decision mode

### Multi-turn trajectories (simulated players) expose what single replies hide

Baseline trajectories (3 personas × gm/actors/gm-repair × 2, Sol judge) scored progress 1.8–3.3 and steering 2–3, far below single-turn scores. Recurring failure: **premature endings**. One roll or outcome closed the scene before the player could respond: a failed intimidation went straight to "arrows, roll initiative", and the separate closing call added a second passage that answered questions for the player. **Actors stalled**: they leave pacing entirely to the decider, Jev missed the "set off → ambush" cue, and the goblins never came.

Blind QA round 1 (3 Claude players: curious/gm, chaos/actors, method/gm-repair; all reached exits in both scenes). Strong single-turn improv (griffon request → "only the flies answer"; invented goblin contact woven into Skrag's lines; Tam correcting a misremembered farm name in character). Failures seen in transcripts:
- **Nearest-edge forcing**: a pickpocket attempt rolled as Insight, a peace poem as Deception (failed → combat).
- **Invented hooks**: the GM put "a small iron key" in Skrag's pouch; the player spent turns theorising about a lock the world doesn't have (the V1 failure again).
- Duplicate narrator passages in actors mode; an aftermath opening that assumed a fight after a bargain (authoring: the setting text presumed the fight).

### Runtime v2 (commit 0123b6e)

Pending endings (exits the player didn't choose are held for one last response; the post-reply pass can't confirm a held exit in the same reply), wind-down turns instead of closing calls, freeform checks for risky attempts outside the routes, scene `limits`, pressure only after a stall, no back-to-back narration, clue/mystery wording in the GM prompt.

| approach | progress base → v2 | criterion pass | tangents handled badly |
|---|---|---|---|
| gm | 3.33 → 3.50 | 4/6 → 5/6 | 3/17 → 0/18 |
| actors | 1.80 → 3.50 | 0/5 → 4/6 | 4/17 → 4/17 |
| gm-repair | 3.00 → 3.67 | 3/6 → 4/6 | 5/19 → 1/14 |

Consistency rose the most (gm 3.50 → 4.17, gm-repair 3.50 → 4.67), plausibly from the limits list. The failed-threat ending case went from 2/6 to 6/6 once the held exit couldn't be confirmed by the same reply.

Known limitation: creative variants of an authored edge get the edge's authored outcome. Threatening to smash the idol maps to the intimidation edge ("they scatter"), which doesn't fit holding their sacred idol hostage. The repair agent is the mechanism meant to add a better route; it doesn't act in time for a single turn.

### Luna decision mode (`openai/gpt-6-luna-decisions`)

Found by the research agent: same Decisions endpoint and schema as Jev, different slug.

| decider | accuracy (14 cases × 3) | latency |
|---|---|---|
| Jev 1.13 | 79% | 334 ms |
| **Luna decisions** | **93%** | **267 ms** |
| Luna structured output (none) | 90% | 1269 ms |

Luna decisions is now the default decider for all approaches; `gm-jev` / `actors-jev` keep Jev for comparison.

### Phase 2 scaffolding

`src/world/scribe.ts`: Luna (medium) writes `function update(world)` against the stub DSL. It's typechecked with tsc (TS 7 has no JS API, so the CLI runs on a temp dir, ~0.3 s) and run in a `vm` against a recording world. World suite baseline (10 recorded endings): 10/10 compiled first try; coverage 3.9, fidelity 3.8, bounded 5.0, restraint 4.3. Two findings:
- Many "wrong" changes came from the **authored exit scripts**, not the scribe: "Tam moves to Hollis Farm" while he's still on the road, "goblins will return" when they only might. Static exit scripts drift from narration; the scribe should reconcile them, not just append.
- `world.unsupported(...)` is collecting DSL gaps: improvised props with no catalogue asset (a ticking brass beetle, cheese left as bait), carved marks, future obligations ("goblins owe Tam two days' work"), places outside the scene (the mill).

## 2026-10-14 — Limits that work, momentum, presence, repair v2

### Limits need to be concrete and carry an in-fiction reason

`be-dwarves` (player: "fetch a dozen Kläggenheim dwarves to wrestle it out") failed 0/6 on both voices: Holt sent for the dwarves even though the scene's limits said "No one else is coming to help". The limit cue (a `limit` question in the before-reply decision, same call, no added latency) didn't fire either: "no one else is coming" scored 0.39 against "none". Rephrasing each limit as *the thing the player reaches for + why not in the fiction* ("Fetching extra people to help (the dwarves or any other delegation, the guards…): nobody can be brought in time. The delegations are at the opening reception…") took it to **6/6**, and the cue fired every time. Authoring rule: a limit is only enforceable if a classifier can recognise the player reaching for it and the GM has a reason to give.

### Probes shouldn't end scenes

On the entrance scene, "I study the runes" or "I reassure the cart" fired the Arcana release edge, and a success ended the scene with a hand-wavy mechanism. Edges that would end the scene now need a committed attempt (marked as such in the criteria) and ≥ 0.6 decider confidence. Entrance trajectories, gm: progress 4.0 → 4.5, consistency 3.25 → 4.17, tangents handled badly 1/9 → 0/19.

### The actors stall was presence, not improvisation

Rowan was authored to "enter" at beat 2, but the opening narration put him under the cart. The tracker never left beat 1, so the speaker decider could never pick him. Holt asked Rowan to "point to the snag" for 14 turns while Rowan stayed silent. The single GM voice just voiced him anyway. Fixes: characters not yet on stage can be chosen when the player's turn would plausibly bring them in; and a **momentum rule**: when the after-reply status (a free extra question) says the scene is stuck, the next reply must break the loop (actors hand the narrator the floor first). All trajectories (5 cases × 2): **gm 4.10 progress, actors 3.90** (actors were 2.17 on the entrance scene before the fix).

### Repair v2 (co-GM)

Gated on that same status question (or every 3 turns); scene-enum ids; whispers to individual characters (desire tweaks, Versu-style); mandatory "no, but" alternatives; notes expire after 3 turns (Friends & Fables found persistent plans made Franz railroady). On entrance trajectories it showed **no measurable benefit** (gm 4.00 vs gm-repair 3.50; actors 3.50 vs actors-repair 3.50; n=4). The in-scene GM with good per-turn context (limits, held endings, momentum) is doing most of the work. Repair's remaining job is longer-horizon: lagging trackers, routes for genuinely new approaches, canon.

### Decisions

Luna decisions 100% (172 ms) vs Jev 81% (290 ms) on the 16-case suite after the committed-attempt change.

### Phase 2: append vs reconcile

Reconciling the author's default exit script (the scribe writes the whole update) vs appending to it: fidelity 3.9 → 4.1, coverage 4.0 → 3.8, restraint 4.1 → 4.2. Marginal. The remaining "missing" items are DSL granularity: groups (Skrag's four goblins leave too), "in transit" locations, and what the player learned.

## 2026-10-14 — QA round 1 analysis, fixes

The round 1 analyst (blind QA, 3 sessions; full write-up in `docs/qa/round-1-analysis.md`, reports in `docs/qa/round-1-reports.json`) found the worst problems at the **joints between turns and scenes**, not in single replies:

- **FM1 hand-offs:** scene 2 forgot how scene 1 ended (3/3 openings; 1/12 on the then-current tree). Fix: an exit writes a hand-off (the state of things as played) plus the last moments verbatim; the next scene's prep says *what happened in play outranks the prep*; it also states there is one player character. Openings now mostly pass (peaceful bargain 3/4, after fight 3/4, Tam-gone 1/4).
- **FM2 endings run past the threshold:** fixed by framing the authored closing as "what the ending should feel like", a "stay in the moment / a scene ends at the threshold" GM principle, and closing the scene in the same reply when the player simply does the scene-ending thing (no dice). The no-overrun case still failed until I found my own authored closing said "narrate the first glimpse of the mill"; after fixing that, 3/3.
- **FM3 roll hygiene:** the "none" option is now described positively (talk, accept an offer, search at leisure). Search no longer rolls; accepting an offer that adds conditions still rolls persuasion (defensible). A failed roll must not take back an offer already made.
- **FM5 tracker lag:** after the reply, cues are judged by their *effect* (the next beat has begun), not their trigger text. Goblins-arrived 0/2 → 2/2.
- **FM6 co-GM blocking:** the CLI no longer waits for the co-GM; notes yield to choices the player has made since.
- **FM7–9:** prompts now ask for improvised details that tie into existing threads, no repeated pleas, no names that weren't told; plus OOC handling (an `ooc` question in the before-reply decision → an out-of-character answer with no secrets and no dice talk; `xr-meta-options` went from 2/9 to mostly passing).

New structural idea: **every scene gets a built-in "ending of their own"** (`own-ending`). It's an exit for resolutions the prep didn't foresee, at the same 0.6 confidence bar, and the world scribe makes them true afterwards. Motivation: the GM improvised "walk with Skrag to the warren", no exit covered it, and the limit "the warren isn't reachable in this scene" made it retract its own offer. The limit cue also now needs 0.6 confidence and respects what a limit allows ("can set off for it").

Reply suite after OOC + say-yes directives: gm 94%, actors 96% criterion pass (16 cases × 3).

### Representation experiment: beat graph vs situation

`crossroads-situation` reuses the crossroads cast, secrets, limits and endings, but replaces the four-beat graph with a single "situation" beat. That beat holds every route to an ending, one escalating pressure ("the hedges rustle… then Skrag steps out"), and no beat-to-beat transitions (rolls on uncovered attempts become freeform checks).

| format (gm voice, 3 personas × 3) | progress | criterion | turns to an ending | consistency |
|---|---|---|---|---|
| beat graph (`crossroads-ambush`) | 4.10 | 8/9 | 9.0 | 3.57 |
| situation (`crossroads-situation`) | **4.57** | **9/9** | **7.2** | 3.77 |

With good cast cards, limits, endings and a pressure, the authored beat sequence adds little for the single-GM voice. It may even slow scenes down (the GM waits for beat transitions the tracker hasn't confirmed). The beats still help the *actors* approach, which has no central narrator to pace things.

### Bug worth remembering: plain actions suppressed pacing cues

Adding the built-in improvised ending as an "outcome" also made it appear as a "simply happens" option in every before-reply decision. When the player walked off with Tam, the decider half-picked it (below the ending threshold). That counted as "the player simply did something", and my rule "the player's action outranks a pacing cue" then suppressed the goblins' cue for eight turns. The GM voice hid it by bringing the goblins on itself; actors couldn't, and actors endings fell to 1/9. Fix: the improvised ending is only judged after the reply, and only a real *attempt* outranks a cue. Actors endings came back to 7/10 (progress 3.8; gm 4.0).

## 2026-10-14 — Decider in play; rolls tied to plot beats

### Does decider accuracy matter in play?

Trajectories (5 cases), single GM voice, Luna decisions vs Jev as the director:

| run | gm (Luna decisions) progress / criterion | gm-jev progress / criterion |
|---|---|---|
| n=10 each | 3.70 / 7 of 10 | 4.50 / 9 of 10 |
| n=15 each (repeat) | 4.27 / 13 of 15 | 3.93 / 10 of 14 |
| pooled | ~4.04 | ~4.17 |

Within noise. Behaviourally, Jev called "risky, roll for it" on 27% of turns vs 8% for Luna decisions (18 freeform rolls vs 5). Each roll hands the GM a decisive "success means they get it" directive, which the judge seems to like for pacing. Classification accuracy on labelled cases (where Luna decisions leads 93–100% vs 73–81%) doesn't translate into a visible quality gap over whole scenes. Luna decisions stays the default: it's more accurate, and it's faster (~0.25 s).

### User steer: rolls belong to plot beats, and must say why

"The automatic skill check thing wasn't very good fun for players because we didn't really see why the roll was necessary. I think rolls should be tied to plot beats, i.e. be triggered by edges in the scene conversation graph. And it should say why you're rolling."

That matches round 1's blind players ("dice with nothing at stake"). Changes:
- Freeform rolls are off by default (`freeformChecks` approach flag). A risky action that no edge covers is resolved by the GM in the story (the pickpocket attempt: "Tam's hand snaps down over yours"). The co-GM can still add an edge with a roll when a genuinely new approach deserves one.
- Every authored check has a `reason`, player-facing and generated once per scene, then reviewed in the source. It's shown on the dice line and given to the GM: `🎲 Persuasion check to calm Tam and earn his trust: 20 + 2 = 22 vs DC 10: success (natural 20!)`.
- Decision suite with edge-only rolls: 100% (38 cases).

### Judge cost: Luna-high vs Sol (user question: is Sol worth it?)

Clarification: the GM has always been Luna (reasoning none). Sol is only the eval judge, and it was ~85% of dev spend. I re-judged 40 replies that Sol had already scored, using Luna at reasoning `high` (`src/eval/rejudge.ts`). Pass/fail agreement was 32/40 (80%), mean-score correlation 0.48 (scores cluster at 4–5, so correlation is range-limited), at about 1/15 of the cost ($0.03 vs ~$0.48 for 40). Six of the eight disagreements were one case (the gibbet tangent, where Luna is stricter about answering "who was hanged here"). Luna-high is fine for cheap screening; keep Sol, or two judges, for headline numbers.

### Challenge: Luna as GM with more reasoning

`gm-low` / `gm-medium` presets (voices use the approach's effort). Reply suite, 16 crossroads and entrance cases × 1 sample, Luna-high judge:

| GM effort | criterion pass | first text median / p90 | reply cost |
|---|---|---|---|
| none | 81% | 1.64 s / 2.3 s | $0.00022 |
| low | 88% | 1.90 s / 3.4 s | $0.00024 |
| medium | 81% | 3.70 s / 7.3 s | $0.00032 |

There's no measurable quality gain from reasoning, and medium more than doubles time to first text. Luna `low` usually doesn't reason at all (median 0 reasoning tokens), so it behaves like `none` with a worse tail. Keep `none` for the in-scene voice. Runtime cost is negligible at every level (< $0.001 per turn including both decision calls).

Note: OpenRouter account credit ran out (~$0.70 left of $110) partway through the `edge-rolls` regression; its judge calls returned HTTP 402 and need re-running after a top-up.

## 2026-10-14 — QA round 2, and resolving deviations from the authored scene

### QA round 2 (4 blind Claude players; `docs/qa/round-2-analysis.md`)

Meta-gamer through character creation and two more scenes (gm); double-crosser in `green-standoff` (gm); terse skeptic in `hanged-clerk` (actors); murder-hobo in `warren-hostage` (gm-repair). All would keep playing. Mean rating 3.3 → 3.7, consistency 2.3 → 3.5. Of 41 tangents, 29 were handled well and 4 badly. Round 1's hand-off and doubled-ending failures are gone. The failures moved to the game's edges:

- **A. The story reaches an ending but the scene doesn't close** (endings judged per turn against 0.6 with no memory; no-dice routes never re-checked after the reply; "what just happened" framing misses states). Fix: an after-reply *ending-state* question over all endings; near-misses accumulate (a leader twice running at ≥ 0.35 closes); threshold hints tell the GM not to narrate journeys.
- **B. OOC answers about a system the GM can't see** (promised a scene skip, denied stats exist, leaked the prep). Fix: a table-rules card in the prep, plus the player's skills; OOC answers truthful, ≤ 2 sentences, never agree to change the game; hand-offs exclude OOC.
- **C. A player's escalation ends the scene in the same reply** (taking a hostage read as an attack, so combat ended the session at turn 5). Fix: combat routes need intent to hurt *now*; roll-decided endings play the decisive moment and wind down next reply.
- **D. Standing lines repeat** (cast notes and pressure re-sent every turn get performed every reply). Fix: cast notes only while a beat is fresh, then "already voiced: act, wait, give ground"; pressure fires once; the momentum rule asks for a new push.

### User steer: resolve deviations from the authored scene

The article "When Play Does Not Go to Prep" (Gnome Stew). We author situations; exits move between them; when play doesn't follow the authored path, the GM should find satisfying solutions. *"The detectives decide not to interview the bartender… you move that clue to another NPC."* The article's ladder: move elements around → soft corrections (hints, NPC dialogue, a check that tells them what their character knows) → hard corrections → toss the notes.

Implemented:
- **Essentials** (`Scene.essentials`): what the scene needs the player to come across, where the author placed it, and what it unlocks. The GM's prep frames them as movable ("players often go elsewhere: move it to whatever they're engaging with, or nudge softly"). A free after-reply question tracks which have landed.
- **Co-GM relocations:** move / soft nudge / improvise, to a character (as a whisper) or the world (as a GM note). It can also add a route with a roll when noticing or recalling should be uncertain.
- **Four co-GM timings** to weigh repair against snappiness: none, background (lands next turn), **stall** (your suggestion: when the player goes off the graph, a quick holding beat streams at once while the co-GM works in parallel, then a follow-up resolves the attempt), and blocking (co-GM before every reply, the accuracy upper bound). Medium and low effort for the co-GM.
- **Experiment cases:** 3 holed scenes (routes removed but their endings kept), 3 "dreamed" approaches Luna invented that no route covers, and 4 deviations where the player avoids exactly where an essential was placed (ignores Tam, won't talk to Rowan, never looks at the toll house, won't search the body). Baseline `gm-rigid` hides the essentials.

Smoke test latencies: blocking puts the co-GM on the critical path (10–15 s to first text, unacceptable); stall keeps first text at ~1.4 s, but the medium co-GM makes the follow-up arrive ~20 s later.


## 2026-10-14 (afternoon) — absurdity, pressure rolls, techniques, the mouthpiece failure

- **User steers:** test the six deviation techniques with QA guided to solve scenes the prep didn't plan for. Pressure on secrets should be rolled, with the DC from the secret's value and the roleplay. Continuity via a background tracker and compaction. Evals are information, not targets. Prefer absurdity (Pratchett / Monty Python), with real repercussions.
- **Research workflow** (3 agents): `docs/research/dc-guidance.md`, `docs/research/compaction.md`, `docs/research/gm-techniques.md` and `src/eval/cases/techniques.ts`.
- **Absurd QA round 1** (`v2`, 4 blind players): silliness was enabled and turned into plot, with deadpan wit, but daft acts never sent a bill. Characters graded bits from outside ("as a joke, not as proof").
  - Added `prompts/tone-comic.md` and the consequence flag.
  - A/B on the 7 gap moments: 67% → 79% (comic), 62% → 76% (flag). Noisy; I read the replies.
- **Bug found by absurd QA:** a won check stayed on offer in a self-looping beat. The re-roll failed and Cob took back what he'd said. Fixed: routes achieved in this beat visit are no longer offered.
- **Absurd QA round 2** (`v2-comic-bill`, new personas and scenes, plus a straight control): consequences 3.25 vs 2.5, humour about 4, the straight player happy. Remaining: gentle bills, continuity slips, a repeated line.
- **Pressure rolls:** first a placeholder DC, then the researched ruling (yes / no / roll at 12/15/18). Luna 92%, Jev 75–83% on 12 decision cases. The details moved to a second call, made only when someone is pressed.
- **Decider latency today:** 0.5–1.4 s for Luna decisions (it was 0.2–0.35 s). A same-input A/B shows it isn't the extra question.
- **Playtest 1 (the user):** characters voiced the GM's plan. The cause was co-GM notes and whispers setting terms, plus a soft-nudge relocation repeating the boot crackle. Fixed in the co-GM prompt, the GM prompt, the card labels and hint tracking. Fresh-session coaching went from 4/49 to 0/52. Imitation persists once it's in the history.
- **Techniques:** preserve intent failed 0/4 (a threat rolled as Persuasion). A social attempt now rolls the player's method: 3/3.
- **`v2` now has the comic style plus the consequence flag.** `v2-straight` keeps the old v2, and `v2-pressure` is opt-in.

## 2026-10-14 (evening) — a javelin that rolled Medicine

- **The user's turn:** "Threw my javelin to knock the body down and it gave me a medicine check to examine Prout for signs he was killed before he was hung." The background co-GM had added a route, "Kren gets Prout down or otherwise close enough to examine his neck, head, or hands", with a Medicine check: the precondition bundled with the skilled act. The throw matched it at 0.88. The rules' attack read 0.59 and missed the 0.6 bar, so the rules never saw the throw.
- **Fixes:**
  - The co-GM writes a route with a roll as the act the roll tests, and a bundled `when` is restated from the check's reason.
  - The decider sees what each check route's roll is for.
  - On a turn the rules resolve the player's act, a route's check is rolled as well only if the player is also doing that act. The question rides in the act's details call. No freeform check rides along, and there's no quick co-GM hold on top of the act.
  - The attack criterion names throws and things.
  - Two routes for the same check share the read.
  - A one-option question (a fighter's only class feature) is answered locally; the Decisions API rejected it, so Second Wind crashed the turn.
  - Speech/action convention, from the user: talking is normal; *asterisks* or (parentheses) mark actions. It's in the GM, narrator and actor prompts, and in the three decider questions it decides. Put in every decision's state instead, it tipped unrelated borderline judgements (earned, cues): 82/86 then, against 86/86 in the questions.
- **Replays of turn 16, from the turn-15 snapshot, live (9 runs: old co-GM patch ×4, co-GM re-run ×5, varied seeds):**
  - The throw was an attack on the hoist rope every time (8 hits, 1 natural 1). Never Medicine, never an extra freeform roll.
  - Examining the body afterwards rolled Medicine in 8 of 9. Two runs only did so once same-check routes shared the read: the co-GM had refreshed the route after the fall, and the read split 0.57/0.43. The ninth had no examination route in the beat at all (the co-GM added none, and the authored one lives in the yard beat). Base code reads that moment the same way.
- **Suites:**
  - Decision suite 82/86 → 86/86 (mean latency 410 → 387 ms).
  - Roll-related reply cases (20 × 2, `v2`): criterion 70% → 70%, mechanical 100% → 100%.
  - The moment is now a fixture (`evals/fixtures/playtest-2`). `hc-javelin-at-rope` went 0/3 → 3/3 on both the criterion and the mechanical checks; `hc-dec-javelin-not-exam` went 0/2 → 2/2. Decision cases now see a snapshot's co-GM routes, as play does; none of the older decision fixtures has any.
- **Still open:**
  - The co-GM's improvised check routes often lead back to a beat the story has left (motive → doubt), copying the authored route's target.
  - A rope cut by the rules draws the violence reactions: Kell intervenes, and once Moll fled.

## 2026-10-15 — why we're going to the Rat

- **The user's turn**, on the card between the Hanged Clerk and the Drowned Rat: "not sure I follow why we're going to the rat? Who's this porter? Why is he connected to the case? I would say kell maybe saw him talking to Sallow?" The card had Kell find "Big Hobb Mallory" in "the old arrest book" and lean on "Tull's order". In that game Cob's roll never happened, so the player had never heard of a big man with a bandaged hand.
- **Cause:** the boundary's verdict writes the lead from play and the coming scenes' prep. It had no account of the time between (Kell's afternoon was only in her lore), no idea whose names the player had heard (the prep lists "Big Hobb Mallory"), and an instruction that invited "a message, gossip, something they found". So it made up a source and used the name. Replayed with the old code, 8 leads for the first two cases below: Hobb named in two, a source made up in four ("inquiries" twice, the girl on the wall, "word at the stairs"), and the grain, the Heron, its book or the Crake brothers given away in four.
- **Fixes:**
  - The user's idea, in the lore: at the noon break Kell sees a gentleman with a silver-topped cane beside the Purveyor's flour wagons, and a big dock-man at his elbow nursing a bandaged hand and calling him "Master". She knows neither, follows the big man down the river stairs to the Rat, and comes back for the investigator. Her `gm.md`, the Rat's card, hook and background, the interlude's card and lead, and Sallow's and Hobb's lore agree. Cob's lore says where he goes if nobody won him over or frightened him off (Nan's pot-boy for the night, as the Rat's card already had it).
  - The verdict is given what the last scene's people who go on into the coming scenes do in the time between (`errandsOf`: their `gm.md`'s "What they do next") and whose names the player hasn't heard (`strangers`), with the prep labelled the GM's. It writes nothing that play or those errands don't have, and the lead says why in the player's own terms and names nobody they haven't heard.
- **Replays** of the game's own crossing (`chainScene` with `skipInterludes`, from QA-console snapshots), 45 leads with the final prompt: (a) the player learned nothing of the big man, (b) Cob's account, (c) Moll's, and the Rat to the Heron after Dilly's word or Hobb's confession. No lead named anyone unheard or made up a source, and every lead for the Rat gave Kell's sighting as the reason, mostly with her reasoning (a rope strips the palm of whoever hauls a man up on it). Four of the 45 still let something of the prep or the fronts slip ("where the King's grain is going"). At medium effort none did, but the call took 44 s instead of 12; a lead written by a call of its own, without the prep, lost the player's reason about one time in five.
- **Still open:** the residual slip above. In-scene, the GM's narration called Hobb by name before anyone had said it, and the map's actions name people the player hasn't heard of ("Talk to Moll").

## 2026-10-15 — considered rolls (a spike)

- **The user's steer:** "the game needs to be a bit more dynamic with how it does rolls for persuasion/intimidation etc. … maybe the Jev thing can flag it and it go to the GM for review before we do the roll, but the roll should make a meaningful transition in the scene. … a few longer thinking turns that have real consequences is okay, and this should replace the stall for time stuff." Plus a "The GM is considering the ramifications of your actions" line that moves on at each step, like Claude Code's.
- **Baseline: three QA players** in hanged-clerk on `v2` as it was (sideways asks of Cob, pressure on Moll, a bard's bluffs): 37 attempts a table would roll for, 8 rolled (7 on authored routes, 1 on a co-GM route a turn late). Why: the attempt read split between "none" and broad routes and rarely cleared 0.6; off-graph called those routes "covered"; the quick co-GM took a median 4.4 s against its 3 s deadline (2 of 20 calls in time in one run), and its late result was overwritten by the background review's file of the same name; every lie got the consequence flag and failed by fiat; a forged writ tripped the "no royal warrant" limit; a roll that fired played the nearest route's payoff, or landed on the wrong child.
- **Built:** a `roll_call` question in `director.before` (route / new / none, the two yeses pooled at 0.7; an earned payoff, the rules' act, a limit and out-of-character turns aren't flagged); `consider.ts`, the GM's review (Luna, reasoning none, the whole prep, strict JSON on the scene's ids: the guidance's stakes, approach and disposition or a feat's difficulty, the dice line's reason, and each outcome's happening, target, the authored outcome route it counts as, facts, essentials revealed and ways of trying closed); the verdict in code; the ruling settled as a route (`considered-N`, per-outcome `Check.establishes`, beat-scoped close patches) through the same `resolve`, `applyMove` and `moveDirective` as an authored route. `v2` = considered rolls + background co-GM; `v2-quick` = the old `v2`. The app deals `GM_BUSY` (now 25 lines) like cards and moves the status line on at each `onStep`.
- **Replays from the QA snapshots** (15 turns, several rounds):
  - Flag reads: every roll-worthy turn 0.79–0.99; small honest asks and making the case 0.62–0.65; the case also read "earned" at 0.70. Hence the 0.7 bar and "earned wins".
  - The guidance's yes/no thresholds, made for pressure on secrets, sent half the flagged turns to no-roll rulings (two bluffs failed by fiat again). The verdict now leans to the dice: yes only when overwhelming or free (never for a lie), no only for a lever that can't move them or the same push again, a long shot at 18.
  - `opens` (a ruling's new route) was written as "Pell can still make the case…", which the after-reply decider judged as having happened: two scenes jumped to their endings. Dropped. `closes` once hit the motive beat's exit route: now only ways of trying with a roll.
  - `use_route` let the review roll an authored route as written; it chose win-cob for "let me see your heels", and the loft account came out instead (the QA's T7 again). Dropped: a turn reaches the review because no route settles it.
  - Reasoning `low` vs `none`: 9.9 s vs 4.3 s median review (15 at once), rulings of the same quality. `none`.
  - The ten turns the QA expected a roll for all rolled (0/10 before); each outcome moved the scene, revealed something, or left a fact someone acted on.
- **Live** (the QA console, a fresh bard; the real TUI under a pty; the static build in Chromium): an ordinary turn's first text 1.5–1.8 s; considered turns: review 3.2–3.8 s, first text 5.0–7.3 s, $0.0035–0.0066 a turn ($0.0006–0.0018 the review). Performance DC 15 won Moll's joke, Athletics DC 16 failed on the drainpipe (the bracket's loose, on record), Sleight of Hand DC 13 lifted the crown (the world moved it), Intimidation DC 15 failed (Moll drops between the player and Cob), Persuasion DC 18 failed (hostile now: Cob won't show the loft). Kell's "why does this matter to you" stayed under the bar and she answered freely, as her card says. In the Drowned Rat (the scene harness, a rogue): palming an ace at Dilly's table rolled Sleight of Hand DC 10 and nobody noticed, as decided; a penny wager on Arlo was ruled yes without dice (his card: a wager opens him) and the rope burn came out. OpenRouter was slower then: reviews 7.9–9.1 s, first text 11.6–12.0 s. The TUI's status line: the turn's line, then "The GM is considering the ramifications of your actions…" at 0.4 s, four more lines, then "The GM is speaking…" at 5–6 s; the browser build showed the same.
- **Fixed after live play:** an Investigation roll withheld the hanged man's missing stool (now: what the scene needs never hangs on the dice; looking properly isn't flagged); a pickpocket's success had Moll notice a beat later (a success has no sting); the reply once undid the decided outcome (told it stands).
- **Still open:** the bar and wording want the decision suite (cases from the QA turns); a ruling can't do the rules' work (no damage for a fall); the review's dice-line reason can use a name the player hasn't heard if it ignores the list; the full co-GM still writes improvised routes beside the rulings; `v2-quick`'s quick and background co-GM still share a repair file name.
