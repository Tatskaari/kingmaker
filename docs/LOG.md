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

## 2026-10-15 — The GM's markup: each speaker in their colour, and notes on why, what you'd know and what you did

- **The user's ask:** break the GM's text up. Speech in each character's colour, matching their glyph; highlighted references to what the player knows or did; and when someone refuses because of the player's rudeness, a faction or a prejudice of the world, a highlight that explains it. Their format: markdown-ish `(text)[explanation]`, with the GM keeping secrets out of it.
- **What it is:** `[Kell] “…”` before a line; `(words)[why|know|you: note]` on the words a moment turns on. Parsed as it streams (src/runtime/markup.ts), kept on the transcript entry beside the words, drawn in the scene's transcript with each speaker's colour, paragraphs, underlined marks and a popover (src/app/reply.ts, ui/reply.tsx, ui/popover.tsx). The GM is given every fact still, and a "What the player knows" section in its prep (src/runtime/knowledge.ts).
- **Tokens, measured** (reply suite, 82 cases × 1, judged by Sol at medium; the prose judged as the player reads it):
  - The user's shape, `(words)[why: …]`, against Markdown's, `[words](why: …)`: lines tagged 13% / 15%, marks 0.06 / 0.05 a reply, the judge's mean 3.97 / 3.97 (baseline samples 3.96 and 4.17). The same, so the sketch's shape stays and the parser takes both.
  - The fixtures' histories have no markup, and the model writes as its last replies were written: tagging their lines from the prose took tagging from 13% to 33%.
  - A one-line reminder just before "For this reply" took marks from 0.06 to 0.49 a reply, but the model then wrote labels after finished sentences ("…again.” (the goblins scatter)[why: …]", read as words: craft 3.66) and sentences written to carry a note ("(He refuses)[why: …]"). The parser now puts a stray label's note on the sentence it's about, and the prompt says to mark words you'd write anyway: marks 0.07–0.10 a reply, the mean back within noise (4.02, 4.01).
  - A note straight after a line with no words of its own (`“Not you, now.”[why: …]`, seen in the ferry booth) is on the line: parsing the raw replies again finds about twice the marks (0.12 a reply).
- **The prompt, settled** (2 samples, 164 replies each; two runs of the code before the markup as the baseline):

  | | criterion | intent | consistency | characters | steering | craft | mean |
  |---|---|---|---|---|---|---|---|
  | baseline, run 1 | 72.6% | 4.16 | 4.04 | 4.02 | 3.98 | 4.10 | 4.06 |
  | baseline, run 2 | 69.5% | 4.13 | 4.13 | 3.95 | 3.99 | 4.07 | 4.05 |
  | why on refusing lines | 67.7% | 4.16 | 4.04 | 3.95 | 4.01 | 4.07 | 4.05 |
  | … and a know on every first mention (twice) | 64.6% / 64.6% | 4.05 / 4.09 | 3.95 / 4.12 | 3.77 / 3.90 | 3.93 / 3.95 | 3.98 / 3.95 | 3.94 / 4.00 |
  | **adopted:** why on refusing lines, the safer note | 67.7% | 4.11 | 4.10 | 3.95 | 3.96 | 4.01 | 4.03 |

  Pushing for a know on every first mention drew more of them (the onboarding the user wants), but cost the prose twice running, so it went. Single samples of the baseline differ by 0.21 (3.96 and 4.17), so the adopted prompt's 4.03 is within noise. Criterion passes are a few points down in every markup run; per case they move both ways (33 better, 39 worse).
- **Adherence of the adopted prompt:** on the fixtures 48% of lines tagged (their history has none) and a speaker found for 87%; marks 0.12 a reply (why 12, know 6, you 2), none malformed. Its notes, judged against the prep: 2 of 14 leak something (a character's private reason; detail from the prep), 12 of 14 true, 13 of 14 the right kind. In fresh play (24 whole scenes with a simulated player, 266 replies): 79% of lines tagged, a speaker found for 96%, marks 0.08 a reply (why 13, know 8, you 0). Marks come where a moment turns on a reason, so ordinary play has few; the ferry booth, built to draw them, drew 16 in 17 replies over three live plays (why 8, know 7, you 1).
- **Whole scenes against the baseline** (six scenes three times each way, run at the same time, judged by Sol): mean 3.27 with the markup and 3.17 without (intent 3.72 / 3.62, consistency 2.93 / 2.58, characters 3.17 / 3.22, steering 3.27 / 3.15, craft 3.25 / 3.30), criterion 8 of 18 and 6 of 17. Single runs of the six moved between 3.17 and 3.57 either way, so no drop shows.
- **Shapes found in live play, and read now:** a tag before a marked line, `[Peg] (“…”)[why: …]`, had been read as Markdown's order and lost the line; a note in round brackets after a line, or in both, `“…”(why: …)`, `“…”[(why: …)]`, showed as written; `[Warden’s Book][know: …]` lost its words as a stray tag; a phrase just said written again as a label (`“…in the tally loft.” [The tally loft][know: …]`) would have shown twice; a tag after its line went unused. Over all 1,681 replies of these runs the parser now shows no markup.
- **Cost and time:** on the reply suite, run beside the baseline, a GM call takes 11% more input (8,690 → 9,640 tokens: the markup section, the knowledge brief, the reminder, the history's tags) and 2% more output (147 → 150); its cost +7% ($0.00046 → $0.00049), a whole turn's calls +1% ($0.00148 → $0.00150), and its first text is unchanged (mean 1,691 → 1,673 ms, p50 1,248 → 1,227). The adopted prompt, in another hour: $0.00052 a call, $0.00153 a turn, first text 1,756 / 1,242 ms. In whole scenes, run beside the baseline, the input is 2% more (14,982 → 15,221 tokens, the history dominating), a GM call costs less ($0.00088 → $0.00077), and its first text came later (mean 1,489 → 1,712 ms, p50 1,133 → 1,315), the call itself, not the parser; with the reply suite's runs showing none, it's either the hour's routing or up to a fifth of a second. What's shown first also waits a few tokens behind a tag.
- **Tried and dropped:** a screen that left out a note using a word of the prep the player hadn't come across. Against the judge's verdicts on 70 notes it caught 9 of 25 bad ones and dropped 13 good ones (ordinary words: "demand", "struck", "pride"), so it went.
- **Live:** the Theatre's live tour, on the final code, drew every kind in the Ferry Stairs: a know on "yard" (an eel's a penny a yard, against the seller's arm, King's face up), a you on the eel-wife's “Now it’s Sergeant Kell? You called me an old trout…” and a why on the ferryman's “No. I don’t carry the watch, or anyone who comes in its name.”, both linked to the player's turn; the pie stall drew a why on “You threaten my dog at my counter?”. Played on its own, the booth drew a why on “Old trout, am I?” and a know on the ferryman's “Penny. King’s face up.” linked to Caerwyn's lore; the story's yard drew a know on "Centennial Assembly" linked to its lore; the static build in Chromium drew Kell's, Cob's and the girl's lines in their glyphs' colours from real replies.

## 2026-10-15 (evening) — The notes, written from what the player knows; the markup after its QA

- **What the QA found** (76 live replies and the reply suite, on the markup above):
  - **Notes from behind the screen.** About one in five of the GM's notes told the player something the prep keeps back: 9 of 48 across three reply-suite runs, among them the page sewn into Prout's boot ("Something stiff is tucked inside its lining"), Prout's visit to Kell three days before (the motive), and Kell's private reason for letting Cob go; live, Saul's note came from his private doc, with the story backwards. The prompt was the only guard. A popover's cards were clean.
  - **Whys missing.** Of about 49 moments where someone refused, bristled or came round for a reason the player could know, 10 carried a why (Moll's "You threaten him, now you want him to lead you…" after "gutter rat", the user's own example, wasn't one).
  - **Minor:** a marked line drawn in its mark's colour, not its speaker's (18 of 211 lines); 8 of 211 lines given the wrong speaker; a tag that was its sentence's subject losing its name, with `**` shown raw; the unplaced voice's gold, and the marks' colours, close to some people's; the popover over the words clicked and the frame's border, and the bottom line describing the pointer's mark after Tab; a `[` that could be taken back as a reply streamed.
- **The notes, rewritten** (src/runtime/notes.ts, prompts/notes.md). The GM still marks the moments as it writes, with its prep in view; what the player reads is written after the reply by a call that's told only what the player knows: the scene's hook and `known`, its public lore docs whole (without their pointers to GM docs, their "If…" lines or the hours that aren't the scene's), the people here by their public faces, a line on each other public doc, who the player is and what they've lived, this scene as they saw it, and the reply with its lines numbered and the GM's marks (where and what kind, never its notes); names they haven't heard, as what they'd call their owners. It can't tell a secret it was never told. The same call writes a why for each line where someone refuses, bristles or comes round for a reason it can see. Luna, no reasoning, JSON; about 2 s after the reply, beside the after-reply decision and the stage manager, so the turn isn't longer.
- **On the QA's 67 stored live replies** (each session's replies re-noted in order, judged by Sol at medium): 106 notes (why 60, know 44, you 2), 1.6 a reply against the GM's 24 marks. The judge first called 22 of 103 notes leaks, but they were public lore it couldn't see ("the Heron is the last warehouse at the downriver end of the wharves"), so `judgeNotes` now sees what the player knows beside the prep. Judged that way: the writer's 3 of 106 leaks were all names (two the GM's own reply had just said, one a surname from a public doc), 4 untrue, 4 the wrong kind; the GM's own notes on the same replies, 3 or 4 of 24 leaks. The prompt went round four times: whys that only repeated the refusal ("Hobb refuses to show it"), "in turn 3" in a note, three whys on one insult, the Heron explained in every reply, an eel's "yard" called a small boat (the booth's customs weren't in what it knew: they're the scene's `known` now).
- **On the reply suite's cases whose notes leaked** (9 cases, 2 samples, judged by Sol at medium): 22 notes on 18 replies (13 on the GM's marks, 9 added; why 15, know 5, you 2), none leaking, 22 true, 21 the right kind; the notes 2.1 s after the reply (p90 3.6 s). The boots cases' notes are about the player hitting Cob ("You hit Cob, and Moll is keeping herself between him and you"), not the lining.
- **Live, 20 replies** (the ferry booth in the terminal app under a pty at 130x42, colour per cell; the Drowned Rat and the Heron in the scene harness, with the QA's own lines):
  - **Speakers:** 52 lines, 43 tagged by the GM (83%); the speaker right for 51 as played, and for 52 with the last fix (a name after "on the" is only looked at). In the terminal every line was in its speaker's colour, the place panel's (the eel-wife #b8d870, the ferryman #e8c170), whole marked lines too, on their kind's tint. Run again over the QA's 211 lines, the speaker fixes put right the 7 of its 8 that were in its saved sessions and moved no other line.
  - **Marks:** 32 in 20 replies, 1.6 a reply (the ferry 12 in 6, the Rat 11 in 7, the Heron 9 in 7): why 18, know 12, you 2.
  - **Whys:** 27 moments where someone refused, bristled or came round for a reason the player could know; 18 carried a why or a you on their words (67%), 21 a note of some kind (78%). The QA's count before: 10 of 49. Not marked: some that the same reply's other note explained, a bristle at a knock during the count, a lighterman's "Easy, champ."
  - **Leaks:** judged against the prep with what the player knows beside it, 32 notes: none from behind the screen (one flagged: Hep's surname, from her public doc once "Hep" had been heard), 31 true, 30 the right kind. The cards: lore by its first sentence or two, people by the names heard.
  - **Breaks:** no markup shown, no words lost, nothing taken back as the replies streamed (every cut). Tab picked a mark out in reverse, the bottom line said it, Enter opened it.
  - **Time and cost:** the notes came 2.2 s after the reply (p90 3.9 s, 19 calls; the Heron's opening had nothing to note), $0.00024 each, about 6% of a turn's $0.0040; the stage manager still ends the turn later. First text from Enter: p50 2.0 s, p90 2.9 s over 17 turns (the GM's prompt is the one measured above).
- **Also:** the static build plays the notes in its worker (`notes` among the live check's calls, the marks drawn on the granary's first reply); the Theatre's live tour passes (15 exhibits, 32 steps), its ferry drawing a why on "Old trout, is it? No, my duck. Not for you.", a know on "Stairs carry their own." and a why on "No. I don't carry the watch."
- **Still open:** a why sometimes only says what the line says ("Hobb refuses to show it"), and a know sometimes sits on the wrong words of a line; a reply's notes can repeat what someone in it claims, and a claim can be a lie the writer can't know of; whose name counts as heard is still any part of it (hearing "Hep" puts Hepzibah Grist on her card); and the GM's narration still names people before anyone says their name now and then, as it did before the markup.
