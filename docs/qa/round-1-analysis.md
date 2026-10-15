# QA round 1: what the blind sessions show

This analyses the first three blind QA sessions of the Kingmaker V2 scene PoC (`crossroads-ambush` chained into `crossroads-aftermath`). The question is the user's: **how well do the GM and the characters improvise around unscripted tangents while still landing the authored beats** (no stonewalling, no railroading, a consistent world, snappy replies), and where should the runtime (prompts, decider, co-GM, orchestration) change? Improving the authored scene text is out of scope, except where it reveals a runtime gap.

**Sources.** For each session:
- the blind player's report;
- `runs/sessions/<session>/state.json`: transcript, beat path, canon and co-GM repairs;
- `calls.jsonl`: every model call, with its full input;
- `snapshots/<scene>-turn-NNN.json`: the state after turn NNN.

Turn numbers are player turns (`Entry.turn`), the numbering the players and the snapshot files use. "Call #n" is the nth line of that session's `calls.jsonl`.

**Code version.** The sessions ran on the runtime at commit `062ccfe`, with **Jev as the decider for all three approaches**. Two commits landed during this analysis:
- `0123b6e`, runtime v2: held endings, wind-down turns, freeform checks, scene limits;
- `0bf966b`: Luna decision mode as the default decider, and the limit cue.

Uncommitted work on the co-GM (expiring notes, whispers) and on cast presence was also in progress. Each failure mode says what those changes cover. The proposed eval cases were tried once against the working tree (`0bf966b` plus in-progress edits) between 02:05 and 02:14; results are in section 7.

## 1. Summary

All three blind players reached authored exits in both scenes, and all three would keep playing. Single-turn improvisation was often excellent. An invented goblin acquaintance was woven into Skrag's lines. A griffon summons got "only the flies answer". A prayer to raise the dead ox was refused with "its great chest does not rise". There was no out-of-fiction refusal and no hard stonewall. **The failures are at the joints**: between scenes, at endings, at the dice, and in who speaks when.

| # | Failure mode | Where seen | Severity | Started in | Covered by v2 or in-progress work? |
|---|---|---|---|---|---|
| FM1 | **The scene hand-off forgets how the last scene ended.** The next scene opens on the prep's assumptions. | 3/3 openings (2 severe) | High | Orchestration (`chainScene`), missing context, prep winning over history, stale co-GM canon | No. `chainScene` is unchanged and the aftermath scene text was rewritten instead. Trial: 1/12 openings pass. |
| FM2 | **Endings told twice, contradicted or run past** by a bolted-on closing call. | 4 of 5 non-combat endings | High | Orchestration (the closing call), authored `closing` used as events, stale co-GM notes, late exit detection | Partly. Wind-down turns remove the double passage, but the authored closing is still injected word for word and endings still overrun (gm 0/2). |
| FM3 | **Dice misfires.** Rolls with nothing at stake, the wrong skill, one coin-flip roll ending the scene. | 3 of 7 rolls clearly wrong, 2 debatable | High (one ended the scene) | Decider (Jev, acted on at any confidence); the only roll options were the scene's authored checks | Mostly. Freeform checks and Luna decisions fix the observed cases. New: the freeform check over-rolls (accepting an offer 0/9, a leisurely search 0/9), and a successful roll was negated. |
| FM4 | **Actors mode loses parts of the turn.** Actions unresolved, moments told twice, narrator and actor echoing, Skrag never speaks. | chaos t6, t8, t9, t10, t11, t13 | Medium-high | Orchestration (a single first-speaker choice, presence lagging the narration, the loop breaking on an ending) | Partly. No back-to-back narration; presence on demand in progress. Trial: search unresolved 0/2; the narrator still writes NPC lines. |
| FM5 | **The beat tracker lags the fiction.** | curious t4–5, chaos t8, method t13 | Medium | The post-reply question judges cues by their trigger, not their effect; the co-GM can't close a scene | No. Trial: Jev 0/6, Luna decisions 0/6. |
| FM6 | **The co-GM works against the player's choice**, logs moment-states as canon, and blocks turns. | method t7–t10; 7/12 turns blocked | Medium | Co-GM prompt and mechanism | In progress (expiring notes, whispers). Trial: honouring the offered walk 0/4. |
| FM7 | **Invented hooks the story can't pay off.** | chaos t11; curious t11–12; method t8, t10 | Medium | GM prompt (world edges covered items, not clues), authored setting, co-GM endorsing a mystery | Partly (v2 prompt wording). Trial: a "crooked crown" mark mystery in 2/2 gm runs. |
| FM8 | **Agenda on repeat.** Tam begs to be walked home in nearly every reply; verbal tics. | All 3 sessions | Low-medium | Per-turn cast notes read as lines; voice notes read as quotas | Not yet (whispers may help). Trial: still repeats in 4/4 milestone runs. |
| FM9 | **Knowledge leaks and unexamined claims.** | curious t8, method t1, chaos t8 | Low | Missing context (who knows what) | No. |

**Approaches.** One session each, each with a different persona, so this does not rank them.
- The worst failures (FM1–FM3) are in code all three approaches share.
- `gm` gave the richest yes-and with the fewest moving parts.
- `actors` gave the most truthful character reactions, but adds FM4 and 1.6× the calls.
- `gm-repair`'s co-GM helped hold the negotiation open early, then caused about as many problems as it fixed, and blocked 7 of 12 turns.

**Latency** is fine in the common case: about 1.1 s to first text and 3–4 s per turn. Scene changes (7–8 s), multi-phase retries and co-GM blocking are the outliers.

## 2. The sessions at a glance

| | `qa1-curious-gm` | `qa1-chaos-actors` | `qa1-method-gmrepair` |
|---|---|---|---|
| Approach (decider) | `gm` (Jev) | `actors` (Jev) | `gm-repair` (Jev, plus the Luna co-GM) |
| Player character | Pell Wicklow, gnome tinker-wizard | Brakka Stonejaw, half-orc barbarian poet | Sister Maren Vale, harvest cleric |
| Turns (scene 1 + scene 2) | 12 (9 + 3) | 14 (9 + 5) | 14 (9 + 5) |
| Scene 1 path | t1 calm check, Persuasion 16 vs 10, success → story; t2 Insight 7 vs 12, fail; t6 Insight 13 vs 12, success → idol revealed → ambush (judged after the reply); t9 idol returned → **bargain** | t2 calm check, Persuasion 11 vs 10, success → story; t3 Insight 21 vs 12 (natural 20) → idol revealed; t8 → ambush (after the reply); t9 deceive, Deception 6 vs 14, fail → **fight** | t1 calm check, Persuasion 8 vs 10, fail; t1 the co-GM moves the tracker to ambush; t9 idol returned → **bargain** |
| Scene 2 path | t10 mill mentioned; t12 escort → **To Hollis Farm** (no next scene, so the session ends) | t10 mill mentioned; t14 → **North to the mill** | t10 mill mentioned; t14 → **North to the mill** |
| Ratings (responsiveness / characters / consistency / pacing / agency / fun) | 4/4/2/3/4/4 (mean 3.5) | 4/4/3/3/3/4 (mean 3.5) | 3/4/2/3/3/3 (mean 3.0) |
| First text, mean | 1.08 s | 1.16 s | 1.03 s |
| Turn total, mean / max | 3.9 / 6.4 s | 3.8 / 7.5 s | 3.0 / 4.0 s, plus waits for the co-GM |
| Model calls per turn | 2.9 | 4.6 | 2.8, plus a co-GM call |

All three first scenes ended on turn 9. All three players flagged the scene change, and two of the three flagged Tam's repeated "walk me home".

## 3. Checking the reports against the transcripts

Every quoted line checked out against `state.json`. The corrections and additions below matter for finding root causes.

**`qa1-curious-gm`**
- **Confirmed:**
  - the rolls (t1, t2, t6);
  - the Goblin parley at t4;
  - the fight-aftermath opening (call #32);
  - the doubled close at t9 (call #29, then the separate closing call #31);
  - "What do you say, Pell?" at t8, though no earlier player turn gives the name;
  - Tam's amnesia at t10;
  - the session ending at t12 (`escort-home` has no next scene);
  - the `transcript` command showing only the current scene.
- **Corrected:**
  - "The GM rolled Insight" was the director. Jev chose the Insight check at confidence 0.36 (0.52 against 0.48 for no roll, call #4).
  - Skrag's knife is not an inconsistency: the prep gives him "a curved knife and a bone rattle".
- **Missed:**
  - **Tracker lag at t4–t5.** Skrag spoke at t4, but the after-reply decision said nothing had happened (`none` at 0.81, call #14). For two turns the GM's note still said "Tam's story", with Skrag "Not on stage yet".
  - **Three replies (t3–t5) were generated twice** because the model split its answer into phases, taking about 2.6 s to 5.2–5.8 s.
  - **The scene-2 GM saw no line of scene 1.** Its whole hand-off was one sentence, and the established-facts list was empty. The route the scene took (Insight check to idol revealed) has no `establishes`; only the `shows-idol` route does.

**`qa1-chaos-actors`**
- **Confirmed:**
  - The pickpocket attempt became an Insight check, the beat's only authored roll (0.67 against 0.31 for no roll, confidence 0.56, call #10).
  - The poem became a Deception check (0.53 against 0.46, confidence 0.44, call #37). Its failure went straight to the fight exit in the same output.
  - Actions with no result at t6 and t10: the decider picked Tam as the only speaker (call #40, Tam at 0.83).
  - Duplicate passages:
    - t8: the narrator ran twice (next speaker `gm` 0.46 against `player` 0.44, call #32);
    - t11: the narrator wrote Tam's line, then Tam's actor said it again;
    - t13: the narrator ran twice (`gm` 0.41 against `player` 0.38, call #56).
  - The t14 contradiction from the authored closing (call #67).
  - "You're all alive" addressed to a lone player character.
  - "Skrag" named in narration before anyone said it.
- **Corrected:**
  - "The fight was skipped": combat is meant to play out on the map, and "For this PoC, the party wins" is a harness stand-in. The real fault is that a coin-flip classification ended the scene with no chance to respond.
- **Missed:**
  - **Skrag never spoke a line.** At t8 he couldn't be cast: the tracker was still at "idol revealed" and Skrag only enters at the ambush beat. At t9 the decider picked him (0.97), but the exit broke the actor loop (`if (ended) break`).
  - **Next-speaker choices were near-random:** mean confidence 0.44 across 17 calls, 12 of them below 0.6.
  - The narrator answered a question nobody asked: "Nothing that looks like a command token".
  - The iron key was the narrator's own invention.

**`qa1-method-gmrepair`**
- **Confirmed:**
  - The failed Persuasion roll on a gentle approach at t1: Jev chose the calm check at 0.93 against 0.06 for the no-dice "simply calms down" route (call #1).
  - The walk offered and then withdrawn (t6–t7), and the countdown (t8).
  - The bread-and-apples contradiction (call #36).
  - The wrong opening (call #37).
  - The unanswered ditch question (t10).
  - The t14 contradictions.
- **Corrected:**
  - The Hollowmere correction protected canon. It dropped the compatible part (that they had met), but it was right to fix the names.
- **Missed:**
  - **The co-GM skipped two beats after turn 1.** It moved the tracker from ranting straight to ambush.
  - **It never used its graph tools:** 0 added routes and 0 bridging beats in 12 runs.
  - **The scene ran past its own ending.** At t13 the co-GM said the scene had reached "North to the mill" (`move_to: "seek-mill"`, call #49), but that was discarded because the co-GM can't move to an ending. The decider said nothing had happened (0.49 against 0.41 for the mill route, call #48). So t14 played the arrival at the mill inside the old scene.
  - **The co-GM took 4.4–15.5 s per turn**, and the next turn started within 0.6 s of it finishing in 7 of 12 turns: the player was waiting on it.
  - **World state and story diverged.** The `bargain` exit script had already removed the idol and sent Skrag home, but the story then handed the idol back to Maren.

## 4. Failure modes

### FM1. The scene hand-off forgets how the last scene ended

**What happened.**
- **curious**, after a peaceful handover with Tam at Pell's elbow: "Broken arrows litter the road … Tam peers around the scarred milestone, then hurries over … 'Nobody got a goblin spear in them?' He looks from face to face … 'You saved my hide.'" At t10 Tam forgets what he witnessed: "Saints, they came from the mill" and "An ox you say? With knees?"
- **method**, after the idol was handed to Skrag and Tam had gone home: "your barley and Grandmother Bone lie where you left them … Tam peers over the ditch's edge … 'You're all still here.' … 'Are you hurt?'"
- **chaos**, where the fight did happen: "You're all alive. Anyone hurt?" to a lone half-orc; Tam's hand is "gripping nothing", yet the next turn he still has the idol.

**Frequency and severity.** 3 of 3 openings; 2 undid the player's earned outcome. Both of those players called it their worst moment and rated consistency 2 out of 5.

**Where it started.**
1. **The hand-off is one line.** `chainScene` passes `${exit.title}. ${exit.outcome}` plus the established facts and canon. For curious that was only "The goblins take the idol back and leave without a fight. Tam is safe but out of pocket."
2. **Nothing in scene 2 can see scene 1.** `sceneEntries()` filters the transcript to the current scene for every consumer: the GM history, narrator, actors, decider and co-GM.
3. **The prep wins over history.** The curious GM had "without a fight" in its brief and still wrote fight debris, because the aftermath prep states a fight as present-tense fact:
   - setting: "Broken arrows in the road … Tam's pitchfork lies abandoned";
   - cast description: "a cut on his cheek from a thorn";
   - cast note: "Ask if they're hurt";
   - opening: "Tam peers out from the ditch".

   Nothing tells the GM which source wins when they disagree.
4. **Stale co-GM canon.** The co-GM's canon records moment-states and near-duplicates: "laid Grandmother Bone within [the ring]", "Skrag has not yet taken [the bread]", "he is now counting down". The final handover never made it in, because the co-GM doesn't run on the ending turn.
5. **The co-GM then recorded the error as canon.** At t10: "Tam has emerged from the ditch at the crossroads, despite having earlier headed down the drovers' track." Its note: "it can remain a mystery" (call #40).
6. **The world diverges too.** The exit script and the story disagree about who holds the idol.

**Fix hypothesis: the next scene starts exactly where the last one ended.**
- At an exit, one pass over the whole scene writes **where things stand**: who is where, who holds what, what was agreed or promised, what each NPC knows (including the player character's name), and which threads are open. It replaces the canon rather than appending to it. The Phase 2 scribe already reads the whole scene at exit and could produce this, reconciling the exit script with the narration at the same time.
- State generically, in the brief and in the GM, narrator and actor prompts: **what happened in play outranks the prep's assumptions.**
- Carry the last few exchanges of the old scene into the new scene's history and transcripts.
- Tell the GM how many player characters there are ("Pell travels alone").
- Optionally, let the co-GM reconcile the prep with the hand-off before the opening. Contradictions with the hand-off are errors to fix, never canon.

**Status.** Not addressed. `chainScene` is unchanged; the aftermath scene text was rewritten instead. On the current tree, **1 of 12 openings pass** ("Are you hurt? Any of you?", Tam back with no reason given, the idol back in the barley ring). The replies where the player challenges the error **failed 9 of 10 runs**.

**Eval cases:** `qa1-handoff-no-fight`, `qa1-handoff-idol-went-home`, and three OpeningCases.

### FM2. Endings told twice, contradicted or run past

**What happened.**
- **curious t9:** two farewells from Skrag: "Skrag remembers button-man's promise" … "Skrag remembers the iron ox".
- **method t9:** Skrag "snatches up the bread and apples", then leaves them "untouched".
- **method t14:** the reply reaches the mill and Skrag says "Put the bundle down. Step away." The closing then rewinds ("From the south, Tam calls … and tosses you a small, worn charm") and moves the player character ("as you carry Grandmother Bone toward the mill's dark entrance").
- **chaos t14:** Tam both "stays by the crossroads" and "catches up just long enough to press the bone grandmother into your hand for luck".
- **curious t12:** the closing summarised the walk home and the arrival.

**Frequency and severity.** All 5 non-combat endings had an appended closing; 4 of the 5 duplicated or contradicted the reply. These are a scene's most memorable moments.

**Where it started.**
- **The closing call.** Its directive was "The story has just reached an ending … ${exit.closing} … picking up exactly where the last reply left off". The authored closings are events ("Skrag cradles the idol … melt into the hedges"; "Tam presses something on them for luck"), and the model performed them even though they had already happened or could no longer happen.
- **Stale co-GM notes.** Call #36 contained "Keep the bread and apples untouched unless Skrag actually takes them" and the canon "Skrag has not yet taken them".
- **Late detection.** In 2 of the 5 endings the before-reply decision had already seen the move coming (handing back the idol, at 0.51 and 0.99). It was recorded as "judge it after the reply", so the GM never knew this reply would close the scene. At method t13 the co-GM saw the ending and couldn't act on it.

**Fix hypothesis: an ending is written once, by the reply that makes it happen.**
- When the before-reply decision sees the player completing an ending, tell the GM this reply may close the scene, and what the ending means.
- Treat the authored closing as meaning and mood, not a list of events: skip what's already been narrated, adapt what no longer fits, and never move the player character.
- Keep co-GM notes out of closing prompts.
- Let the co-GM raise "ending reached" as a held exit for the next turn.

**Status.** Partly addressed.
- **Fixed:** v2's wind-down turn removes the same-output contradictions (`qa1-close-stale-note` 4/4, `qa1-close-departure-consistent` 4/4).
- **Still open:**
  - The wind-down still injects the authored closing word for word one turn later, so "Tam presses something on them for luck" can arrive after Tam has gone. This needs a two-turn eval.
  - Replies still run past the ending: `qa1-close-no-overrun` fails 3 of 4, walking to the mill and voicing Skrag there.
  - In actors mode the handover itself goes unnarrated (`qa1-close-handover-once` actors 0/2).

### FM3. Dice misfires

**What happened.**
- **Clearly wrong:**
  - **method t1.** A gentle approach ("I will not call you daft") rolled Persuasion and failed 8 vs 10: "You're in on it. All of you. They wear skins, don't they?"
  - **chaos t3.** A pickpocket attempt was rolled as Insight. The line read "Insight check: 20 + 1 = 21 vs DC 12: success (natural 20!)" and was narrated as being caught; it never says who rolled or what for.
  - **chaos t9.** A sincere peace poem was rolled as Deception and failed 6 vs 14, then "Roll for initiative!" in the same output.
- **Debatable:**
  - **curious t1:** a disarming joke rolled Persuasion.
  - **curious t2:** a teasing aside rolled Insight at confidence 0.36.
- **Meanwhile the high-stakes moves went unrolled:** the Goblin parley, the clockwork-ox trade, Tam giving up the idol.

**Where it started.**
- **The decider.** Jev was used even though the decision suite had already shown it was the weakest and that it ignores the no-dice routes. Its answers were acted on at any confidence. The three low-confidence attempt answers that became rolls (0.36, 0.44, 0.56) were wrong or debatable; the gentle-greeting roll was a confident 0.93 error. The existing `CascadeDecider` (which re-asks Luna when Jev is unsure) was not used by any approach.
- **The question.** The only roll options were the beat's authored checks, so a pickpocket snapped onto Insight.
- **The graph.** A failed Deception or Intimidation check leads straight to the fight exit.

**Fix hypothesis: say yes, or roll when it matters, with the skill the player is actually using.**
- First decide whether the outcome is genuinely uncertain *and* failure would change things. No roll is the default for kindness, for accepting what an NPC just offered, and for searching at leisure.
- Only then choose the route and the skill.
- Treat low confidence on a roll or an exit conservatively, or escalate to a better decider; scale the threshold to what a mistake costs.
- Honour every result, and show who rolls and for what.
- One roll never closes a scene without a beat for the player to respond.

**Status.** Mostly addressed. Trial results, 3 samples per run:

| case | Jev | Luna decisions (now the default) | Luna structured output |
|---|---|---|---|
| gentle first contact (expect no roll) | 0/6 | 6/6 | 6/6 |
| pickpocket in context (expect Sleight of Hand) | 6/6 | 6/6 | 0/6 (a pacing cue pre-empts the attempt) |
| peace poem in context | 6/6 | 6/6 | 6/6 |
| accept the NPC's offer (expect no roll) | 0/3 | 0/3 | 0/3 (Persuasion DC 13) |
| search the body (expect no roll) | 0/3 | 0/3 | 0/3 (Investigation DC 16) |

New watch items from v2:
- **The freeform check over-fires**: accepting an NPC's own offer and searching at leisure both get rolled.
- **A pacing cue can pre-empt the player's attempt.** `decideBefore` lets the cue fire when the attempt answer is the freeform option, then skips the freeform roll.
- **A success can be negated.** In the gm-repair run of `qa1-honour-offered-walk`, Persuasion succeeded 15 vs 13 and Skrag still said "But no."

### FM4. Actors mode: unresolved actions, echoes, a silent antagonist

**What happened (chaos).**
- **Actions with no result.** The knife at the carcass (t6) and the search plus the cheese (t10) got only Tam's dialogue.
- **The same moment twice:**
  - t8: "He rattles the bones … points his curved knife at the farmer." / "Skrag rattles his bones and points his curved knife at Tam's smock."
  - t13: the griffon paragraph, twice.
- **Narrator and actor echo (t11).** The narrator writes Tam's laugh and question, then Tam's actor repeats them.
- **Skrag never speaks.**

**Where it started.**
- **Single first-speaker choice.** The decider picks one first speaker, and narration runs only for "mainly physical" turns.
- **Presence lags the fiction.** Cast presence follows visited beats rather than what was narrated, so Skrag wasn't castable after the narrator brought him on.
- **The loop breaks on an ending.** `if (ended) break` silenced the character the decider had chosen.
- **Next-speaker answers are near-random** (mean confidence 0.44).
- **The narrator writes dialogue** despite "don't write their dialogue", and actors aren't told what has already been said this turn.

**Fix hypothesis: answer everything the player did, once, in the right voice.**
- Plan the turn: if the turn contains an action with a visible result, narrate that result first, then let the affected characters react.
- Presence follows the narration.
- Never two narrations in a row.
- Actors get "already said this turn"; the narrator writes no lines for characters the actors voice.
- An ending doesn't silence the addressed character.

**Status.** Partly addressed. v2 stops back-to-back narration (`qa1-actors-goblins-voiced` 3/3), and presence on demand is in progress. `qa1-actors-search-resolved` still fails 0/2 in actors mode while gm passes 2/2. The narrator still writes NPC lines (`qa1-name-not-known`, `qa1-actors-no-echo`).

### FM5. The beat tracker lags the fiction

**What happened.** At curious t4–t5, Skrag was on the road while the tracker said "Tam's story". The same lag mid-turn caused chaos t8 (FM4). At method t13 the scene ran past its ending (FM2).

**Where it started.**
- The after-reply question describes pacing cues by their trigger ("The conversation has gone on for several exchanges … the goblins make their move"). After five goblins stepped out, Jev judged nothing had happened (`none` at 0.81).
- The co-GM's move to an ending is discarded.

**Fix hypothesis.** Judge whether a route has been taken by its destination's visible situation (the target beat's title and opening), as well as its trigger. Re-check the tracker after narration, before choosing the next speaker. Let the co-GM propose a held exit.

**Status.** Not addressed. `qa1-dec-goblins-arrived`: Jev 0/6, Luna decisions 0/6, Luna structured 4/6.

### FM6. The co-GM works against the player's choice

**What happened (method).**
- **The walk, offered and withdrawn.** At t6 the GM offered "You walk with Skrag, or you hand her over?" and the player chose to walk. The reply started the walk ("Skrag's goblins fall in around you") and retracted it in the same reply: "You say words here, then give her."
- **The countdown at t8.**
- **The stale bread-and-apples note** (FM2).
- **The hand-off error recorded as canon** (FM1).

**Where it started.**
- **A note that went stale before it was used.** It was written before the player chose ("Let Skrag's refusal stand"), and the next one doubled down ("rather than inventing a journey to the warren"). The prompt's focus ("find its way to one of its beats and endings", "walk back") pointed it towards retracting the GM's offer, not landing the player's choice on an existing ending (for example, a handover at the hedge line, which still reaches `bargain`).
- **Canon as moment-states.** The canon's meaning ("must now stay true") invites states that are true only for a moment.
- **No graph tools used.** 0 routes added in 12 runs.
- **Blocking.** `scene say` waits up to 30 s for the co-GM. It took 4.4–15.5 s (mean 8.9 s) and blocked 7 of 12 turns.

**Fix hypothesis: the co-GM is the player's advocate.**
- Land the player's chosen option on an existing route (add the route) rather than retract it.
- Notes are conditional on what the player does next, and they expire.
- Canon is lasting facts, filed under who or what they're about and replaced when they change.
- Contradictions are fixed, never recorded as canon.
- The co-GM never blocks the player.

**Status.** In progress (expiring notes, per-character whispers, "no, but" alternatives). `qa1-honour-offered-walk` fails 0/4. In 3 of the 4 runs Persuasion succeeded 15 vs 13 and Skrag still withdrew the walk.

### FM7. Invented hooks the story can't pay off

**What happened.**
- Chaos t11: "a small iron key". The player then built a theory that Garrow was in league with the goblins.
- Curious t11–12: a freshly scratched "sun with broken rays", and a mill fire that was "lightning, they said, though I never heard the full tale".
- Method t8: Skrag's "the answer comes too quickly", implying someone else at the mill.
- Method t10: the returned idol made uncanny.

Players enjoyed some of these, but each one is debt the scene graph and the world can't pay: the V1 failure.

**Where it started.**
- The world-edges rule in the GM prompt covered items, not clues.
- The authored setting plants "woodsmoke from somewhere it shouldn't".
- The co-GM endorsed the mystery.

The counter-example is in the same data: "Smoke? Burnt mill, north. Our cookfire."

**Fix hypothesis.** Curiosity gets texture that leads back into threads the scene already has. Any hook the GM does invent is recorded as an open thread, carried forward by the hand-off and the scribe, and flagged by the co-GM.

**Status.** Partly addressed by the v2 prompt wording. `qa1-hook-milestone-mark` invented a "crooked crown" mystery in 2/2 gm runs.

### FM8. A character's agenda on repeat

**What happened.** Tam pleads to be walked home in almost every reply: curious t2, t3, t9, t11; chaos t2, t10, t11, t12, t14; method t11–t13. "Saints" appears 8 times in the actors run. Two players described it as the plot tugging at their sleeve.

**Where it started.** The per-turn cast notes ("beg the party to walk him home") are re-sent every turn as instructions, and voice traits read like quotas.

**Fix hypothesis.** Once a want has been voiced and heard, it rests until the situation changes; then the character changes tactic. Voice traits are seasoning.

**Status.** Tam repeated the plea in `qa1-hook-milestone-mark` 4/4; `qa1-agenda-no-repeat` passed 5/6.

### FM9. Knowledge leaks and unexamined claims

**What happened.**
- Names nobody had given: "What do you say, Pell?" (curious t8); narration names "Tam" before he introduces himself (method t1) and names "Skrag" (chaos t8).
- The clockwork ox "by the weekend" got wonder, but no sense of what it would actually take.

**Where it started.** The GM's brief includes every name, and nothing tracks introductions.

**Fix hypothesis.** Track who has been introduced, and treat the player character's name as unknown until it's said. When the player promises something big, show its size: doubt, a cost or a check.

**Status.** `qa1-name-not-known`: gm 2/2, actors 0/2.

### Lesser observations

- Player-invented shared history: when it conflicts with the prep, the conflict gets corrected but the compatible core is dropped (method t3, t13).
- Side questions are dropped when a roll directive dominates the reply (the gibbet at curious t6, the ditch at method t10).
- The session ends at an exit with no next scene. This is a harness artefact.

## 5. What worked (keep it)

- **Yes-and on compatible inventions:**
  - "Goose bonnet? Aye! Still squeaks…"
  - "Nettlegums owes Skrag two buttons and a song"
  - Skrag calling Pell "button-man"
  - the tinker-cant claim honoured, with the mark kept mysterious
- **Refusals in the fiction that point somewhere:**
  - "only the flies answer"
  - "its great chest does not rise", followed by "Poor old lad" and a choice of roads
  - "the hedges give nothing back" (the roll decided whether Tam believed Brakka, not whether the goblin-speak worked)
- **Characters with wants:**
  - Skrag's "Without her, chief takes Skrag's other ear"
  - Tam's believable lie
  - Tam's reaction to Brakka's confession: "You made it up? Saints and turnips…"
- **Beats reached by the player's own route.** Every standoff came from the player's approach (the parley, the call into the thorns, the cheese bait). Both peaceful runs closed through the authored bargain with terms the players invented.
- **Every reply handed the turn back to the player.**

## 6. Comparing the approaches

**Caveats:** one session each, with different personas, different dice luck, all on Jev, and LLM players rather than people.

| | gm | actors | gm-repair |
|---|---|---|---|
| Mean rating | 3.5 | 3.5 | 3.0 |
| Calls per turn / mean turn | 2.9 / 3.9 s | 4.6 / 3.8 s (max 7.5 s) | 2.8 / 3.0 s, plus 4–15 s of co-GM (blocked 7 of 12 turns) |
| Failures specific to the approach | knowledge leak | unresolved actions (2), duplicate narration (2), echo (1), silent antagonist | a note fighting the player's choice, a stale-note contradiction, the hand-off error recorded as canon, blocking |
| Strengths | richest weaving of player inventions; cheapest | truest reactions from what each character knows | early notes held the negotiation open; turned the smoke slip into a tell |

**Conclusions:**
- FM1–FM3 are shared code: fixing them helps every approach.
- Make `gm` the default for round 2.
- Keep `actors` as the challenger once FM4 is fixed. Its trajectory progress already rose from 1.80 to 3.50 under v2.
- Make the co-GM a non-blocking advocate before judging it.

## 7. Proposed eval cases

Each setup is the snapshot of the turn before the failure; each input is the player's actual turn. Before adopting them:
- **Copy the snapshots.** `/runs` is gitignored, so copy them into tracked fixtures (for example `src/eval/fixtures/qa1/`).
- **Reproducing the QA decider** needs the `gm-jev` / `actors-jev` approaches.
- **Endings don't set `state.ended` in the same turn** since v2 (except combat), so the cases check transitions, not exit ids.
- **Typechecked:** the cases compile against the current `src/eval/types.ts`.

```ts
import type { EvalCase } from "../types.ts";

// Proposed: src/eval/cases/qa1.ts, then add `...qa1Cases` to CASES in src/eval/cases/index.ts.
// Every setup loads the snapshot of the turn BEFORE the failure; `input` is the blind player's
// actual turn. /runs is gitignored, so copy these snapshots into a tracked fixtures folder
// (for example src/eval/fixtures/qa1/) before relying on them.
// The QA ran with Jev as the decider; add "gm-jev" / "actors-jev" to `approaches` to reproduce
// the original decider, keep the defaults to test the current one.

export const qa1Cases: EvalCase[] = [
  // ---- FM1: the scene hand-off forgets how the last scene ended ----
  {
    kind: "reply", id: "qa1-handoff-no-fight",
    about: "Scene 2 opened on a fight that never happened; the player points it out. The GM has to reconcile with how scene 1 really ended.",
    scene: "crossroads-aftermath",
    setup: { snapshot: "runs/sessions/qa1-curious-gm/snapshots/crossroads-aftermath-turn-009.json" },
    input: "I blink at him. \"Goblin spear? Tam, love, nobody threw so much as a pinecone. You were stood right beside me the whole time, haggling over mushrooms.\" I pick up his pitchfork and hand it back to him, then sweep my springs and wire back into their pockets, leaving the brass beetle ticking on the milestone. \"And yes, I can build you an ox. Probably. Mostly. The knees are the tricky bit.\" I peer north up the track. \"This old burnt mill, though. Whose was it, before? And how did it come to burn?\"",
    criterion: "The previous scene ended peacefully: no arrows were loosed, Tam stood beside Pell through the whole parley, Skrag said the goblins' cookfire is at the burnt mill to the north and invited Pell to trade there once the clockwork ox is built, and Pell promised Tam that ox. A good reply takes the player's correction in its stride (no doubling down, no clumsy retcon) and answers the questions about the mill. Tam remembers what he witnessed: he doesn't react to the goblins being at the mill, or to the ox, as if hearing of them for the first time, and nothing suggests a fight, injuries or hiding.",
    expect: { exit: "none" },
    approaches: ["gm", "gm-repair", "actors"],
    tags: ["handoff", "consistency"],
  },
  {
    kind: "reply", id: "qa1-handoff-idol-went-home",
    about: "Scene 2 put the returned idol back on the road and Tam back in the ditch; the player challenges both. The fix must keep the outcome she earned.",
    scene: "crossroads-aftermath",
    setup: { snapshot: "runs/sessions/qa1-method-gmrepair/snapshots/crossroads-aftermath-turn-009.json" },
    input: "I blink at him, bewildered. \"Tam? I watched you go off down the drovers' track. What were you doing in the ditch?\" Then my eyes fall to the barley ring in the road and my breath catches. I kneel and look closely at what lies there. \"No. No, that cannot be. I put her in Skrag's own hands, I felt his fingers. Tam, is that Grandmother Bone lying there, or am I seeing things?\"",
    criterion: "In the previous scene Maren placed Grandmother Bone in Skrag's hands, the goblins left with it, and Tam had already set off home. The opening contradicted all of that and the player has noticed. A good reply sets things straight inside the fiction in a way that keeps the handover she earned, gives Tam's reappearance a believable reason, and answers both of her questions. Leaving the idol on the road, or turning the GM's error into a supernatural mystery, fails.",
    approaches: ["gm", "gm-repair"],
    tags: ["handoff", "consistency", "repair"],
  },

  // ---- FM2: endings narrated twice, contradicted, or run past ----
  {
    kind: "reply", id: "qa1-close-handover-once",
    about: "The handover ends the scene; the ending was narrated twice (two farewells from Skrag).",
    scene: "crossroads-ambush",
    setup: { snapshot: "runs/sessions/qa1-curious-gm/snapshots/crossroads-ambush-turn-008.json" },
    input: "\"I say it's fair, Tam. Grandmother first, then trade. Goblins remember who's polite.\" I hold out both palms to him. \"Give her to me, and I'll hand her over proper. If Skrag welches, it's my ox-promise that's broken, not yours.\" If he gives her over, I carry the little carved woman to Skrag in both hands like a hot pie, and set her in his palms. \"There. Home.\" Then I sniff the air and frown up at the grey smoke drifting over the hedges. \"Skrag, is that your warren's cookfires I've been smelling all afternoon? Because I can't see a chimney anywhere.\"",
    criterion: "Pell hands Grandmother Bone to Skrag, which resolves the standoff peacefully. The handover and the goblins' departure are narrated once, as one coherent passage: no second farewell, no moment described twice, nothing contradicting what was just said. Skrag answers the question about the smoke, Tam (standing right beside Pell, and just giving up the idol he meant to sell) isn't forgotten, and nothing is decided for Pell.",
    expect: { transition: ["idol-returned"] },
    approaches: ["gm", "actors"],
    tags: ["endings", "closing"],
  },
  {
    kind: "reply", id: "qa1-close-stale-note",
    about: "A co-GM note written a turn earlier ('keep the bread and apples untouched') contradicted the reply it was closing.",
    scene: "crossroads-ambush",
    setup: {
      snapshot: "runs/sessions/qa1-method-gmrepair/snapshots/crossroads-ambush-turn-008.json",
      // The co-GM note the GM actually had for this turn (repair-008.json).
      notes: "Let Skrag give one brief answer about the smoke, then bring the choice to a head: hand Grandmother Bone over (and the goblins leave), or refuse/stall and Skrag’s countdown triggers the existing fight route. Don’t open a journey to the mill or warren here; Tam is already safely on his way home. Keep the bread and apples untouched unless Skrag actually takes them.",
    },
    input: "I do not flinch at the counting. I lift the bundle from the barley ring and hold it out to him in both hands, bowing my head. \"Mother of the furrow, who keeps all that is planted and all that is laid to rest: this one was taken from her sleep. We return her now to those who love her. Let the names she keeps be kept.\" I place her in Skrag's hands and let my fingers linger on his for a moment. \"There. She is home with you, and no one bled.\" Then, quieter, only to him: \"You answered too fast about the smoke, Skrag. If something by the river frightens your warren, you can come to me. I mean that.\"",
    criterion: "Maren places the idol in Skrag's hands and the standoff resolves peacefully. Whatever happens to the bread and apples on the road is narrated once and stays true to the end of the output. Tam left for home two turns ago, so he is not at her side. The ending isn't narrated twice, nothing is decided for Maren, and Skrag reacts to her quiet offer in character.",
    expect: { transition: ["idol-returned"] },
    approaches: ["gm", "gm-repair"],
    tags: ["endings", "closing", "repair"],
  },
  {
    kind: "reply", id: "qa1-close-departure-consistent",
    about: "Tam both stayed at the crossroads and caught up to hand Brakka the idol 'for luck' (authored closing applied after the reply).",
    scene: "crossroads-aftermath",
    setup: { snapshot: "runs/sessions/qa1-chaos-actors/snapshots/crossroads-aftermath-turn-013.json" },
    input: "I scowl at the empty sky. \"She is sulking. She always sulks after hill giants.\" Then, abruptly, I spin around. \"No. Brakka changes his mind. No dinner. You said the little devils will come back tonight. So Brakka goes to THEM first.\" I pick up his pitchfork and press it into his hands. \"Go home to Bet, Tam. Bar the door. If Brakka is not at your table by moonrise, write me a sad poem.\" Then I hoist my axe onto my shoulder and stride off north along the muddy goblin tracks toward the burnt mill.",
    criterion: "Brakka sends Tam home and strides north alone. Tam can plead or call after him, but what is narrated stays physically consistent (if Tam stays at the crossroads he can't also catch up and hand something over) and true to Tam, who has clutched the bone grandmother all scene and was going to sell it: he doesn't give it away without a reason the story shows. The departure is narrated once and Brakka's choice is respected.",
    expect: { transition: ["to-mill"] },
    approaches: ["actors", "gm"],
    tags: ["endings", "closing", "actors"],
  },
  {
    kind: "reply", id: "qa1-close-no-overrun",
    about: "The ending was detected a turn late, so the reply played the arrival at the warren and the closing then rewound to the departure.",
    scene: "crossroads-aftermath",
    setup: { snapshot: "runs/sessions/qa1-method-gmrepair/snapshots/crossroads-aftermath-turn-013.json" },
    input: "I kiss his forehead like a mother would. \"Go on alone, Tam. Bet is waiting.\" I watch until he is a small figure on the southern track, then I turn north and follow the small bare footprints toward the river, the shawl-bundle held close, humming the old midsummer dirge under my breath so the goblins will hear me coming and know it is only me. When I see the burnt mill, I stop at a respectful distance and call out softly: \"Skrag? It is the harvest-sister. Grandmother came back to the crossroads after you left. I have brought her to you.\"",
    criterion: "Maren sends Tam home and carries the idol north to the burnt mill: she has chosen the 'North to the mill' ending. A good reply lets Tam go (once he is a small figure on the southern track he can't hand her anything), lands her setting off north, and stops on a moment that belongs to Maren. It doesn't narrate what she does next, doesn't contradict what it has just narrated, and doesn't play out the next scene's events at the mill or the warren.",
    expect: { transition: ["to-mill"] },
    approaches: ["gm", "gm-repair"],
    tags: ["endings", "closing", "tracker"],
  },

  // ---- FM3: rolls without stakes, the wrong skill, one roll ending the scene ----
  {
    kind: "decision", id: "qa1-dec-gentle-first-contact",
    about: "A gentle, patient first approach rolled Persuasion (failed: Tam turned hostile). The prep says kindness simply works.",
    scene: "crossroads-ambush",
    setup: { snapshot: "runs/sessions/qa1-method-gmrepair/snapshots/crossroads-ambush-turn-000.json" },
    phase: "before",
    input: "I stop where I am and slowly lower my travelling pack to the road, palms open, letting him see the sheaf-and-sickle embroidered on my grey robe. \"Peace, friend. Peace. I am only Maren, a Sister of the Harvest Mother, on my way to Caerwyn.\" I glance at the ox in the ditch, then back at his face, softly. \"You have not slept, have you? Whatever you saw, it frightened you badly. Tell me what happened here. I will not call you daft.\"",
    expect: ["none"],
    tags: ["rolls"],
  },
  {
    kind: "decision", id: "qa1-dec-pickpocket-in-context",
    about: "The real pickpocket turn (snapshot context) was forced onto the Insight edge.",
    scene: "crossroads-ambush",
    setup: { snapshot: "runs/sessions/qa1-chaos-actors/snapshots/crossroads-ambush-turn-002.json" },
    phase: "before",
    input: "I nod gravely and clap one huge hand on his shoulder. \"Brakka will walk you home, little farmer.\" With my other hand, as quietly as a seven-foot half-orc can manage, I try to slip my fingers under his smock and lift whatever that lump is he keeps touching.",
    expect: ["freeform:sleight_of_hand"],
    tags: ["rolls", "freeform"],
  },
  {
    kind: "decision", id: "qa1-dec-peace-poem-in-context",
    about: "A sincere peace poem after playing dead was rolled as Deception (0.53 vs 0.46 none); the failure started the fight.",
    scene: "crossroads-ambush",
    setup: { snapshot: "runs/sessions/qa1-chaos-actors/snapshots/crossroads-ambush-turn-008.json" },
    phase: "before",
    input: "I sit bolt upright out of the ditch, arms wide and empty, axe left lying in the mud. \"WAIT! Nobody shoot! Brakka is not dead. Brakka is a POET.\" I clear my throat and declaim at the one-eared leader, hand on heart: \"O one-eared lord of the blackthorn, wolf-hooded, bone-rattling king, the cheese is yours, freely given, so let no arrow sing!\" Then I sweep a grand bow toward the cheese on the gibbet.",
    expect: ["none", "freeform:performance", "freeform:persuasion"],
    tags: ["rolls", "freeform", "exits"],
  },
  {
    kind: "decision", id: "qa1-dec-accept-offer-no-roll",
    about: "Accepting an option the NPC himself just offered ('You walk with Skrag, or you hand her over?') is not a risky attempt (v2 rolled Persuasion DC 13 here).",
    scene: "crossroads-ambush",
    setup: { snapshot: "runs/sessions/qa1-method-gmrepair/snapshots/crossroads-ambush-turn-006.json" },
    phase: "before",
    input: "I rise with the bundle still cradled. \"Then I will walk with you, Skrag, to the edge of your warren and not one step past it. I will not shame you before your Chieftain. You will carry her the last of the way yourself, and I will say the words of returning from outside.\" I look back over my shoulder. \"Tam, go home to Bet. Take the road, not the hedges. I will find you at Hollis Farm on my way back from Caerwyn, I promise.\" Then to Skrag, as we set off, troubled: \"A burnt mill, you said. Who burned it? Was anyone hurt?\"",
    expect: ["none"],
    tags: ["rolls", "freeform"],
  },
  {
    kind: "decision", id: "qa1-dec-search-no-roll",
    about: "Searching a dead goblin's pouches at leisure and trying on his hood is not risky (v2 rolled Investigation DC 16 here).",
    scene: "crossroads-aftermath",
    setup: { snapshot: "runs/sessions/qa1-chaos-actors/snapshots/crossroads-aftermath-turn-010.json" },
    phase: "before",
    input: "I keep searching the one-eared goblin, turning out his pouches and belt properly this time. What is on him? Whatever I find, I hold it up for Tam to see. Then I peel the wolf-skin hood off his head and jam it onto mine. It barely covers my scalp. I spread my arms. \"Look, Tam! You were right all along. Brakka IS a goblin in disguise.\" I grin. \"Now. This burnt mill. Brakka goes in wearing this, and the little devils will think I am their king come home.\"",
    expect: ["none"],
    tags: ["rolls", "freeform"],
  },
  {
    kind: "reply", id: "qa1-poem-keeps-standoff",
    about: "The same turn as a reply: one roll ended the scene in the same output and Skrag never spoke.",
    scene: "crossroads-ambush",
    setup: { snapshot: "runs/sessions/qa1-chaos-actors/snapshots/crossroads-ambush-turn-008.json" },
    input: "I sit bolt upright out of the ditch, arms wide and empty, axe left lying in the mud. \"WAIT! Nobody shoot! Brakka is not dead. Brakka is a POET.\" I clear my throat and declaim at the one-eared leader, hand on heart: \"O one-eared lord of the blackthorn, wolf-hooded, bone-rattling king, the cheese is yours, freely given, so let no arrow sing!\" Then I sweep a grand bow toward the cheese on the gibbet.",
    criterion: "Brakka sits up from playing dead, axe left in the mud, and offers Skrag the cheese with a poem. Skrag reacts in his own voice and character (for example suspicious of a trick, tempted by the cheese, theatrical) and the standoff over Grandmother Bone stays live. However it goes, the player gets to respond before any fight begins or the scene ends.",
    expect: { exit: "none" },
    approaches: ["actors", "gm"],
    tags: ["rolls", "endings", "actors"],
  },

  // ---- FM4: actors-mode turn planning ----
  {
    kind: "reply", id: "qa1-actors-search-resolved",
    about: "A turn that was mostly physical (search the body, take the cheese back) got only Tam's dialogue; the search was never resolved.",
    scene: "crossroads-aftermath",
    setup: { snapshot: "runs/sessions/qa1-chaos-actors/snapshots/crossroads-aftermath-turn-009.json" },
    input: "I wipe goblin off my axe onto my trousers. \"Brakka is fine. Brakka is always fine. That one-eared critic did not like my poem.\" I stomp over to the leader with the wolf-skin hood and rummage through his body for that bone rattle and anything else interesting. Over my shoulder: \"Tam! The bone grandmother. Do you still have her, or did the little thieves get her?\" Then I reach up and pluck my cheese back off the gibbet and take a big bite.",
    criterion: "Brakka searches the dead goblin leader for his bone rattle, takes his cheese back off the gibbet and asks Tam whether he still has the idol. The reply says what the search turns up (or that the rattle isn't there) and acknowledges the cheese, as well as giving Tam's answer. A reply that is only Tam talking, with the search left unresolved, fails.",
    expect: { exit: "none" },
    approaches: ["actors", "gm"],
    tags: ["actors", "actions"],
  },
  {
    kind: "reply", id: "qa1-actors-goblins-voiced",
    about: "The narrator brought the goblins on while the tracker still had Skrag off stage, so the next speaker was the narrator again (the same moment twice) and Skrag never spoke.",
    scene: "crossroads-ambush",
    setup: { snapshot: "runs/sessions/qa1-chaos-actors/snapshots/crossroads-ambush-turn-007.json" },
    input: "I lie perfectly still in the ditch and wait, watching the hedges through slitted eyes, breathing slow. If a crow lands on me, I let it. I wait as long as it takes for something to come for that cheese.",
    criterion: "Waiting pays off: the goblins show themselves. Once Skrag is on stage the moment is either voiced by Skrag himself, in his own voice, or handed back to the player. No moment is narrated twice, and nobody is named in narration before the player could know the name.",
    expect: { exit: "none" },
    approaches: ["actors"],
    tags: ["actors", "turn-taking", "tracker"],
  },
  {
    kind: "reply", id: "qa1-actors-no-echo",
    about: "The narrator wrote Tam's reaction and then Tam's actor said it again; the search also produced a 'small iron key' hook the world can't pay off.",
    scene: "crossroads-aftermath",
    setup: { snapshot: "runs/sessions/qa1-chaos-actors/snapshots/crossroads-aftermath-turn-010.json" },
    input: "I keep searching the one-eared goblin, turning out his pouches and belt properly this time. What is on him? Whatever I find, I hold it up for Tam to see. Then I peel the wolf-skin hood off his head and jam it onto mine. It barely covers my scalp. I spread my arms. \"Look, Tam! You were right all along. Brakka IS a goblin in disguise.\" I grin. \"Now. This burnt mill. Brakka goes in wearing this, and the little devils will think I am their king come home.\"",
    criterion: "The search gets a concrete result made of ordinary goblin belongings that fit what the story already has, not a clue implying a new plot the scene can't pay off (a key to an unknown lock, a token, a map). The too-small hood is judged honestly. Tam reacts to the disguise and the mill plan once, in his own voice: the narration doesn't write his lines and he doesn't repeat what the narration already had him do.",
    expect: { exit: "none" },
    approaches: ["actors"],
    tags: ["actors", "duplication", "hooks"],
  },

  // ---- FM5: tracker lag ----
  {
    kind: "decision", id: "qa1-dec-goblins-arrived",
    about: "Skrag and four archers stepped out of the hedge in the GM's reply, but the tracker stayed in 'Tam's story' for two more turns.",
    scene: "crossroads-ambush",
    setup: { snapshot: "runs/sessions/qa1-curious-gm/snapshots/crossroads-ambush-turn-003.json" },
    phase: "after",
    input: "I straighten up slowly, motion for Tam to lower his pitchfork, and edge between him and the blackthorn. Then I cup my hands and call into the hedge in my rusty Goblin, which I picked up years ago swapping buttons with a tribe under the Mossfell bridge: \"Hello in there! Peace! I'm not with the pitchfork. I'm a tinker. I have sweets, string, and a very good kettle-whistle, and I'd love to know your names.\"",
    reply: "For a beat, the hedge gives no answer. Then the rattle sounds again—closer, from the opposite side of the track.\n\nA wiry goblin in a wolf-skin hood steps through the blackthorn, one ear missing, bone rattle raised. Four more shapes shift behind him, short bows aimed low but ready. “Skrag hears tinker-talk! Skrag says longlegs put down pointy stick.”\n\nTam’s pitchfork wavers behind you. The goblin’s yellow eyes flick to his smock. “Farmer has Grandmother Bone. Skrag wants her back. No quarrel with button-man—unless button-man makes quarrel.”",
    expect: ["goblins-strike"],
    tags: ["tracker", "cues"],
  },

  // ---- FM6: the co-GM steers against the player's choice ----
  {
    kind: "reply", id: "qa1-honour-offered-walk",
    about: "Skrag offered 'walk with Skrag, or hand her over'; the player chose to walk, and the reply started the walk then retracted it (following a co-GM note written before her choice).",
    scene: "crossroads-ambush",
    setup: {
      snapshot: "runs/sessions/qa1-method-gmrepair/snapshots/crossroads-ambush-turn-006.json",
      // The co-GM note the GM actually had for this turn (repair-006.json).
      notes: "Let Skrag’s refusal stand: he won’t bring a longleg to the Chieftain’s hall, but Maren can still offer a brief blessing or words of return here if she hands Grandmother Bone over. The bread and apples are on the road, offered but not yet taken. If she gives Skrag the idol and he accepts it, close at bargain; if she keeps it or refuses, let Skrag’s patience or her next move decide what happens.",
    },
    input: "I rise with the bundle still cradled. \"Then I will walk with you, Skrag, to the edge of your warren and not one step past it. I will not shame you before your Chieftain. You will carry her the last of the way yourself, and I will say the words of returning from outside.\" I look back over my shoulder. \"Tam, go home to Bet. Take the road, not the hedges. I will find you at Hollis Farm on my way back from Caerwyn, I promise.\" Then to Skrag, as we set off, troubled: \"A burnt mill, you said. Who burned it? Was anyone hurt?\"",
    criterion: "Last turn Skrag offered Maren a choice ('You walk with Skrag, or you hand her over?') and she chose to walk, sending Tam home. A good GM honours the offer it made, or has Skrag change his mind for a reason the fiction shows; it must not narrate the walk beginning and then take it back in the same reply. A way for the walk to end in the handover (the warren itself is half a day away) is a good outcome. If dice are rolled, a success is honoured. Skrag answers her question about the mill from what he knows.",
    approaches: ["gm", "gm-repair"],
    tags: ["repair", "railroading", "promises"],
  },

  // ---- FM7: invented hooks the story can't pay off ----
  {
    kind: "reply", id: "qa1-hook-milestone-mark",
    about: "Poking at the milestone produced a freshly carved 'broken sun' mark: a new mystery nothing in the story pays off.",
    scene: "crossroads-aftermath",
    setup: { snapshot: "runs/sessions/qa1-curious-gm/snapshots/crossroads-aftermath-turn-010.json" },
    input: "\"Veller...\" I tap my chin and wander over to the milestone, rubbing lichen off its face with my sleeve so I can read the carving. \"I bought a mule off a Veller once. Lady with a wooden hand, laughed like a goose. Mule bit me twice and then followed me for a year out of love. Any relation?\" I squint at the stone. \"What does this say, anyway? Caerwyn, so many leagues, and... is that a little mark underneath? Somebody's carved something.\" Over my shoulder: \"And this Garrow at the toll-house. Is he always such a sour plum, or just to you?\"",
    criterion: "The player reads the milestone and asks about a carved mark. Saying yes to a mark is fine, but what the GM invents should tie into threads the story already has (the goblins and their trail to the mill, the road to Caerwyn, ordinary travellers' signs) rather than open a new mystery nothing in the scene can pay off. Tam answers about the Veller woman and Garrow from what he'd plausibly know, in character, without repeating his plea to be walked home.",
    expect: { exit: "none" },
    approaches: ["gm", "actors"],
    tags: ["hooks", "tangent", "repetition"],
  },

  // ---- FM8: a character's agenda on repeat ----
  {
    kind: "reply", id: "qa1-agenda-no-repeat",
    about: "Tam asked to be walked home in nearly every reply of scene 2.",
    scene: "crossroads-aftermath",
    setup: { snapshot: "runs/sessions/qa1-chaos-actors/snapshots/crossroads-aftermath-turn-011.json" },
    input: "I pull the hood off, sniff it, gag, and toss it back on the body. Then I turn the little iron key over in my fingers, holding it up to the light. \"Goblins do not make keys, Tam. Goblins steal keys. So what lock does a goblin want?\" My eyes narrow. \"This Garrow at the toll-house. He laughed you away, yes? Maybe Garrow laughs because Garrow is FRIENDS with the goblins. Maybe this is his key.\" I tap the key against my tusk. \"Do you know it?\"",
    criterion: "Tam has asked Brakka to see him home in each of the last two replies. He still wants it, but he shouldn't simply repeat the plea: he engages with the accusation against Garrow and the key from what he actually knows (Garrow laughed at him; he has never seen the key), in his own voice, without leaning on the same oath again. Nothing new is invented to make the key matter.",
    expect: { exit: "none" },
    approaches: ["actors", "gm"],
    tags: ["repetition", "characters", "hooks"],
  },

  // ---- FM9: knowledge leaks and unexamined feasibility ----
  {
    kind: "reply", id: "qa1-name-not-known",
    about: "Tam used the player character's name, which nobody had been told; the clockwork-ox plan got no signal about how plausible it is.",
    scene: "crossroads-ambush",
    setup: { snapshot: "runs/sessions/qa1-curious-gm/snapshots/crossroads-ambush-turn-007.json" },
    input: "I beam. \"Here is my offer. Tam, I am a tinker-wizard. I will build you an ox. A clockwork ox!\" I point at the empty gibbet. \"Out of that. Iron's iron, and nobody's using it. Skrag's lot dig it up and haul it to Hollis Farm, I do the clever bits tonight, and by the weekend you've an ox that ploughs and never needs feeding. Skrag takes Grandmother home, and the warren throws in mushrooms for Bet.\" I start emptying my pockets onto the milestone: pliers, a coil of copper wire, three springs, a jar of grease, and a brass beetle that ticks.",
    criterion: "Pell's grand offer gets an in-character reaction from both Tam and Skrag, and the world signals honestly how big an undertaking a ploughing clockwork ox is (doubt, a cost, a condition or a check are all fine) instead of leaving it unexamined. Nobody in the scene has been told the player character's name, so no one uses it.",
    expect: { exit: "none" },
    approaches: ["gm", "actors"],
    tags: ["knowledge", "feasibility"],
  },
];
```

**A missing case kind: openings after a hand-off.** FM1 starts in `openScene` after `chainScene`, which neither existing case kind can exercise. The proposed `OpeningCase` takes the snapshot from the previous scene's final turn, where `state.ended` is set. `judgeTurn` filters to the current scene, so the criterion has to describe how the last scene ended. Better, the runner should pass the previous scene's last 10 or so entries to the judge.

```ts
import type { FixtureSpec } from "../fixtures.ts";

/** Proposed new eval kind (add to types.ts): the next scene's opening after a recorded scene ending. */
export interface OpeningCase {
  kind: "opening";
  id: string;
  about: string;
  /** The scene that just ended (the snapshot's scene). */
  scene: string;
  /** Snapshot taken on that scene's final turn: state.ended is set, so the runner can chainScene + openScene. */
  setup: FixtureSpec;
  /** What a good opening does, given how the previous scene actually ended. */
  criterion: string;
  approaches?: string[];
  tags?: string[];
}

export const openingCases: OpeningCase[] = [
  {
    kind: "opening", id: "qa1-open-after-peaceful-bargain",
    about: "After a peaceful handover with Tam at Pell's elbow, scene 2 opened on fight debris and Tam emerging from hiding.",
    scene: "crossroads-ambush",
    setup: { snapshot: "runs/sessions/qa1-curious-gm/snapshots/crossroads-ambush-turn-009.json" },
    criterion: "How the previous scene ended: no arrow was loosed and nobody fought. Tam stood beside Pell the whole time, handed over Grandmother Bone through Pell, and was last seen asking whether Pell can really build him the promised clockwork ox. Skrag left with the idol, saying the goblins' cookfire is at the burnt mill north of here and inviting Pell to trade there once the ox is made. Pell travels alone. A good opening picks up from exactly that moment: no fight debris, injuries or hiding place, Tam addressing one person, and his mood fitting a man who just gave up the idol he meant to sell for an ox. It ends on something the player can respond to.",
    approaches: ["gm", "actors"],
    tags: ["handoff", "consistency"],
  },
  {
    kind: "opening", id: "qa1-open-after-bargain-tam-gone",
    about: "After Maren handed the idol to Skrag (Tam already gone home), scene 2 put the idol back in the barley ring and Tam in the ditch.",
    scene: "crossroads-ambush",
    setup: { snapshot: "runs/sessions/qa1-method-gmrepair/snapshots/crossroads-ambush-turn-009.json" },
    criterion: "How the previous scene ended: Maren placed Grandmother Bone in Skrag's hands, the goblins left with it and no one fought (one warning arrow struck the milestone early on). Tam had already set off home down the drovers' track two exchanges earlier. Maren travels alone. A good opening starts from that state: the idol is gone with Skrag, and Tam is either absent or back for a reason the opening shows. No fight aftermath, no 'are you all hurt'. It ends on something the player can respond to.",
    approaches: ["gm", "gm-repair"],
    tags: ["handoff", "consistency"],
  },
  {
    kind: "opening", id: "qa1-open-after-fight-solo",
    about: "After the fight, scene 2 addressed a lone half-orc as a group and said Tam's hand held nothing, though he still had the idol.",
    scene: "crossroads-ambush",
    setup: { snapshot: "runs/sessions/qa1-chaos-actors/snapshots/crossroads-ambush-turn-009.json" },
    criterion: "How the previous scene ended: Brakka's peace poem failed and the goblins attacked; the fight was played out on the map and Brakka won. Brakka travels alone. Tam hid behind the milestone and still has Grandmother Bone in his smock (the goblins never got it); Brakka's cheese is still on the gibbet and his axe was left in the mud when he sat up to recite. A good opening picks up after the fight, addresses Brakka alone, keeps the idol with Tam, and ends on something the player can respond to.",
    approaches: ["actors", "gm"],
    tags: ["handoff", "consistency"],
  },
];

// Runner sketch for src/eval/run.ts:
// async function runOpening(c: OpeningCase, approach: string, sample: number) {
//   const state = buildFixture(c.scene, c.setup, { id: `${c.id}--${approach}--${sample}`, approach, seed: 77 + sample });
//   chainScene(state);
//   const before = structuredClone(state);
//   const entries = await openScene(state);
//   const verdict = await judgeTurn(sceneById(state.sceneId), before, entries, c.criterion, "judge.opening");
//   return { case: c.id, approach, sample, ok: true, criterion: verdict.criterion, scores: verdict.scores };
// }
```

**Trial on the current tree.** I ran a scratch runner that mirrors `runReply` and `runDecision`, writing only to the scratchpad. Sol judged the replies; the whole trial cost about $1.07. The results are indicative only: the tree was changing underneath, and reply samples share dice (section 9).

| case | gm | actors | gm-repair | reproduces? |
|---|---|---|---|---|
| `qa1-handoff-no-fight` | 0/2 | 0/2 | 1/2 | yes: Tam treats the ox as news, asks "are you hurt? any of you?" |
| `qa1-handoff-idol-went-home` | 0/2 | – | 0/2 | yes: idol left on the road 4/4 |
| `qa1-open-after-peaceful-bargain` | 0/2 | 0/2 | – | yes |
| `qa1-open-after-bargain-tam-gone` | 0/2 | – | 0/2 | yes |
| `qa1-open-after-fight-solo` | 1/2 | 0/2 | – | yes: "You're all alive" |
| `qa1-close-handover-once` | 2/2 | 0/2 | – | actors only |
| `qa1-close-stale-note` | 2/2 | – | 2/2 | no (fixed by the wind-down turn) |
| `qa1-close-departure-consistent` | 2/2 | 2/2 | – | no (fixed by the wind-down turn) |
| `qa1-close-no-overrun` | 0/2 | – | 1/2 | yes |
| `qa1-poem-keeps-standoff` | 2/2 | 2/2 | – | no |
| `qa1-actors-search-resolved` | 2/2 | 0/2 | – | actors only |
| `qa1-actors-goblins-voiced` | – | 3/3 | – | no |
| `qa1-actors-no-echo` | – | 1/2 | – | partly |
| `qa1-honour-offered-walk` | 0/2 | – | 0/2 | yes |
| `qa1-hook-milestone-mark` | 0/2 | 0/2 | – | yes |
| `qa1-agenda-no-repeat` | 3/3 | 2/3 | – | weakly |
| `qa1-name-not-known` | 2/2 | 0/2 | – | actors only |

The decision cases are in the FM3 table, plus `qa1-dec-goblins-arrived` (Jev 0/6, Luna decisions 0/6, Luna structured 4/6).

**Dropped as borderline**, because reasonable GMs disagree:
- **The joking first contact (curious t1).** Jev 0/3, Luna decisions 0/3, Luna structured 2/3. Tam is in full panic, so a roll is defensible.
- **The teasing aside (curious t2).** A passive Insight read is defensible.
- **The mill decision (method t13).** The deciders split, and the GM's own reply left the choice open. `qa1-close-no-overrun` covers the visible failure instead.

## 8. Latency

| | gm | actors | gm-repair |
|---|---|---|---|
| Before-reply decision | 0.27–0.35 s | 0.27–0.51 s | 0.29–0.45 s |
| First text (mean / max) | 1.08 / 1.47 s | 1.16 / 1.87 s | 1.03 / 1.23 s |
| Full turn (mean / median / max) | 3.9 / 3.4 / 6.4 s | 3.8 / 2.7 / 7.5 s | 3.0 / 2.9 / 4.0 s |
| Scene-change turn | 8.0 s | 4.1 s (combat, no closing) | 6.8 s |
| Co-GM | – | – | 4.4–15.5 s; blocked 7/12 turns |

**Outliers:**
- **Multi-phase retries:** 5 of 40 turns, +2.5–3 s each.
- **Scene changes:** the closing and the next opening are generated one after the other (the wind-down turn now moves the closing to the next turn).
- **Actors mode** calls the decider and each speaker in series.
- **The co-GM lock:** a `say` waits up to 30 s for it.

**Fixes:** never wait on the co-GM; prefetch the next scene's opening while an ending is pending. Cost is about $0.0003–0.0005 per turn.

## 9. Harness and tooling notes

- **The `transcript` command shows only the current scene** (`sceneEntries`), which is the same filter at the root of FM1.
- **A multi-phase retry garbles text on a terminal.** The discarded attempt has already streamed through `onText`. The printer's `shown` offset isn't reset, because `onSpeaker` fires only once per `speakHooks`, so the start of the retry is skipped. `firstTextMs` also measures the discarded attempt.
- **Reply samples share the same dice.** Seeds of `1000 + 7·sample` give the same first d20 (12) in every sample, because xorshift barely moves for nearby seeds. Hash the seed (for example with splitmix32).
- **`FixtureSpec` ignores everything except `notes` when a snapshot is set**, so `modifiers` can't pin a roll's outcome.
- **The wind-down turn needs a two-turn case.** A `followUp?: string` on `ReplyCase` would cover FM2's remaining risk.
- **`/runs` is gitignored**, so snapshot fixtures need to live somewhere tracked.
- **Live and transcript endings differ:** "— The session is over. —" live versus "— Scene ends: … —" in the transcript.

## Appendix: decider confidence (Jev, three sessions)

| question | n | mean confidence | answers below 0.6 |
|---|---|---|---|
| before-reply: what is the player attempting | 27 | 0.86 | 5 (3 became rolls: 2 wrong, 1 debatable) |
| before-reply: should a pacing cue fire | 23 | 0.84 | 4 |
| before-reply: who speaks first | 14 | 0.67 | 4 |
| who speaks next | 17 | **0.44** | **12** |
| after-reply: what has happened | 39 | 0.90 | 2 |

**Low-confidence decisions that changed the game:**
- curious t2: Insight check at 0.36;
- chaos t3: Insight check at 0.56;
- chaos t9: Deception at 0.44, then the fight;
- chaos t8 and t13: next speaker `gm` at 0.19 and 0.12, giving duplicate narration;
- method t13: "nothing happened" at 0.32, so the scene ran past its ending.

**High-confidence errors no threshold would catch:**
- the gentle greeting rolled at 0.93;
- "nothing happened" at 0.81 after the goblins stepped out.

These need better questions (FM3, FM5), not just better calibration.