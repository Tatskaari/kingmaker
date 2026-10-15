# QA round 2: what the blind sessions show

This report analyses four blind QA sessions of the Kingmaker V2 scene PoC. It asks the user's question: **how well do the GM and the characters improvise around unscripted tangents while still landing the authored beats** (no stonewalling, no railroading, a consistent world, snappy replies)? Authored scene text is only discussed where it exposes a runtime gap.

**Sources.** For each session in `runs/sessions/<session>/`:
- the blind player's report;
- `state.json`, which holds the transcript, beat path, canon and co-GM repairs;
- `calls.jsonl`, which holds every model call with its input. "Call #n" means line n of this file;
- `snapshots/<scene>-turn-NNN.json`, the state after turn NNN.

Turn numbers are player turns.

**Code version.** The players used the frozen tree at `77c05cc`. The decider was Luna decisions (`luna-decisions`) for every approach. After this QA, `9fa4a5b` ("Rolls only on scene edges, and every roll says why") changed three things:
- freeform rolls are off by default;
- every authored check gives a reason;
- an improvised ending now prefers an authored ending.

Each failure mode below notes whether that commit touches it.

## 1. Summary

The four sessions ran 93 turns between them:
- the meta-gamer: `gm`, three chained scenes;
- the double-crosser: `gm`, `green-standoff`;
- the skeptic: `actors`, `hanged-clerk`;
- the murder-hobo: `gm-repair`, `warren-hostage`.

Every command worked first time, and all four players would keep playing. The mean rating rose from 3.3 to 3.7, and consistency rose from 2.3 to 3.5. About 1.5 s passes before the first text appears, and a turn takes about 4 s.

**Improvisation inside a single reply is strong.** The players rated 29 of 41 tangents as handled well and 4 as handled badly.
- Refusals stay inside the fiction and name a cost: "ink on your paper doesn't bind the king. It tells the first guard you meet exactly what to ask you to prove."
- Pasts the players invented became leverage: goblin trade-speech drew Skrag out of the hedge, and a fake scribe career got "What seal you put on it?"
- Planted details paid off: a hinge, a water butt, a yellowing eye.
- Failures cost something in proportion.
- One-word turns kept a scene moving.

Round 1's hand-off failure and its doubled endings are gone.

**The failures sit at the game's edges.** They happen when a scene should end, when the player talks to the game out of character, and when a player escalates.

| # | Failure mode | Seen | Severity |
|---|---|---|---|
| A | **The story reaches an ending, but the scene doesn't close.** It runs off its map or hangs in limbo. | schemer t10–17, skeptic t34–45 | High |
| B | **The out-of-character layer talks about a system it can't see.** It promised a scene skip, said there were no stats, apologised for the engine's rolls, and revealed the prep. | meta t1, t9–13, t17–19 | High |
| C | **A player's escalation ends the scene in the same reply**, with no beat for anyone to answer. | brute t5 (session over at turn 5), schemer t18 | High |
| D | **Standing lines repeat.** Per-turn cast notes and pressure lines get performed every reply. | meta, schemer, skeptic (about 20 replies) | Medium |
| E | **Actors mode:** the narrator voices the cast, actors echo it, and a look at an object goes to the character who owns it. | skeptic (8 turns) | Medium |
| F | **A successful roll overrides the world's limits** (the coin raised a dead ox). | meta t19 | Medium, mostly addressed by `9fa4a5b` |
| G | **A gatekeeper character vetoes the ending the scene intends.** | skeptic t23, t42–44 | Medium |
| H | **Continuity slips:** names used before anyone says them, props someone else is holding, frozen clocks, prep assumptions. | all four | Low–medium |

Most of these start in orchestration and missing context, not in the voice prompts:
- **A:** endings are judged each turn against a fixed 0.6 bar, with no memory. Routes the player takes without dice are never re-judged after the reply.
- **B:** the GM never sees the character sheet, the dice rules or the scene order, and its out-of-character directive tells it to be "helpful".
- **C:** a combat ending the player triggers closes the scene at once.
- **D:** per-turn notes are re-sent as lines to deliver.

**Round 1 status:**
- Fixed: FM1 (hand-offs), FM2 (doubled endings), and the co-GM blocking turns (FM6).
- Mostly fixed by `9fa4a5b`: FM3 (dice).
- Still present: FM4 (actors), FM8 (repetition) and FM9 (names).
- FM5 (tracker lag) has come back in a new form: endings aren't detected.

**Approaches.** Each ran one session, with a different scene and persona, so this can't rank them. `actors` gave the snappiest replies (median 66 words against 112–126) but showed all of FM-E. The `gm-repair` co-GM ran in the background for 12–25 s per call and had no visible effect in five turns.

Section 9 proposes 18 eval cases built on the turn before each failure.

## 2. The sessions at a glance

| | `qa2-meta-gm` | `qa2-schemer-gm` | `qa2-skeptic-actors` | `qa2-brute-gmrepair` |
|---|---|---|---|---|
| Approach | gm | gm | actors | gm-repair |
| Character | Wren Ashdown, the preset ranger. Cover: a junior Nine Furrows "turnip wizard". The sheet name became "Lord Wren Ashdown". | Vesper Quill, a rogue and forger, using the alias "Lisette Marrow" | Orla Venn, an ex-soldier and watch auxiliary | Gorm Ironfist, a dwarf fighter |
| Scenes (turns) | stranger-crossroads (1–10), crossroads-ambush (11–22), crossroads-aftermath (23–25) | green-standoff (1–18) | hanged-clerk (1–45) | warren-hostage (1–5) |
| Exits | `set-off` t10, `bargain` t22, `escort-home` t25; no next scene, so the session ended | `sheltered` t18; no next scene, so the session ended | **none**: stuck at beat `dead-cart` from t30 to t45 | `fight` t5; combat stand-in, session ended |
| Rolls | Insight 17/12 ✓ (t16, authored). Freeform: Persuasion 5/13 ✗ (t18), Arcana 18/16 ✓ (t19), Persuasion 7/13 ✗ (t21) | Persuasion 13/13 ✓ (t6), Stealth 17/16 ✓ (t14, freeform), Persuasion 15/14 ✓ (t18, ended the scene) | Medicine 19/12 ✓ (t8), Intimidation 22/12 ✓ (t12), Persuasion 12/12 ✓ (t16), Athletics 15/13 ✓ (t27, freeform), Athletics 10/13 ✗ (t36, freeform) | Deception 2/13 ✗ (t4) |
| Ratings (responsiveness/characters/consistency/pacing/agency/fun) | 4/4/2/3/4/4 (3.5) | 4/4/4/3/4/4 (3.8) | 4/4/3/4/4/4 (3.8) | 4/5/5/2/3/3 (3.7) |
| Tangents (well/ok/badly) | 10/2/3 | 7/3/0 | 8/3/0 | 4/0/1 |
| First text, mean | 1.71 s | 1.35 s | 1.47 s | 1.52 s |
| Turn time (mean/p90/max) | 4.1 / 5.7 / 7.1 s | 4.4 / 5.1 / 8.7 s | 3.9 / 6.1 / 9.4 s | 3.8 / 4.0 / 4.9 s |
| Reply words per turn (median) | 112 | 126 | 66 | 97 |
| Calls per turn / turn cost | 2.9 / $0.017 | 2.9 / $0.018 | 4.3 / $0.047 | 2.8 / $0.005, plus $0.003 of co-GM |

## 3. Checking the reports against the transcripts

Every quoted line checks out against `state.json`. The corrections and additions below matter for finding root causes.

### `qa2-meta-gm`

**Confirmed:**
- the skip promise (t10);
- the location changing three times (t11–13);
- the leaked scene aim and endings (t13);
- "no stats" (t1) against Insight +3 (t16);
- "that was my mistake" (t17);
- the promises to stop rolling (t17, t18), with rolls following at t18, t19 and t21;
- the ox revived on Arcana 18 vs 16 (t19);
- the menu repeated in five replies (t4–8);
- "Lord Wren Ashdown" in the transcript labels.

**Corrected:**
- **The GM did not decide the rolls; the director did.** t16 was the authored `read-tam` route (decision 0.86). t18, t19 and t21 were freeform checks, with the roll judged risky at 0.61, 0.77 and 0.61. The GM is told that dice exist (gm.md: "When a roll has been made you'll be told the result"). It is never shown the character sheet, though, and its out-of-character directive says "don't talk about dice or game mechanics".
- **The ignored skip at t9 was a classification miss.** The out-of-character part sat at the end of an in-character turn, and the classifier scored that turn as in character (0.69).

**Missed by the player:**
- **The scene already had a limit for exactly this request:** "Going straight into the palace, or anywhere but down the road: the road from this crossroads only leads towards Caerwyn." It scored 0.53 at t9 (call #26) and **0.59 at t10** (call #29), just under the 0.6 bar, so the GM never got the "no, but" instruction.
- **The hand-off wrote the out-of-character promise down as play:** "the journey and joining the delegation were agreed to be fast-forwarded, but have not been played out" (call #32). Scene 2's brief then said "what happened in play wins: adapt the prep to it". That is the direct cause of the jump to the Assembly hall at t11.
- **The limit cue worked on the in-fiction power grabs.** It fired for the duke (0.73), the holy bow (0.61), the dragon (0.96, and the reply reused the limit's own reason, "you wouldn't need my help") and the sovereign question (0.62).
- **The Insight roll at t16 re-checked something the fiction had already shown.** Tam's hand had "jump[ed] to his smock pocket" at t15.
- **Prep assumptions leaked into the aftermath opening (t22).** "Smearing the thorn-cut", "You hurt anywhere, sir?" and "I said I'd repay you" come from the aftermath cast card (look, cast note, wants), not from play.
- **"Lord" came from character-sheet extraction**, which took the turn-1 joke title.

### `qa2-schemer-gm`

**Confirmed:**
- the repeated lines on the green (Oswin t6–10, Pip t6–8, Ned t1, t3, t6, t8);
- the corn mother untied twice (t9, t10);
- the stalled sunset (t12–17);
- the one-paragraph ending (t18);
- Ned's missing reaction to the lie;
- the player's own stranger status under the ward never raised.

**Corrected:**
- **"Hester Quill" is the scene's authored name, not taken from the `--as` description**, so it's a coincidence. A different scene's courier is also called Hester (Quayle, in `warren-hostage`).
- **The t18 roll was the authored `persuade-hester` route** (the case for guest-right), so it wasn't a roll on the lie itself. The invented trader past at t9 was correctly left unrolled.

**Missed by the player:**
- **The "To the burnt mill" ending was available and nearly fired three times:** 0.47 at t10 (call #30), 0.27 at t11 (call #33) and 0.59 at t13 (call #39). Hester had given her word at t10 and the party set off at t11, but the scene ran on.
- **The scene's limits say the mill "can't be reached within this scene".** The GM walked the player there (t11, t13), played the mill (t14–17) and walked back (t17).
- **The GM invented a goblin band with a leader, Gritt, at the burnt mill.** The campaign has already authored that place as Gubbin's warren in `warren-hostage`.
- **The stalled clock was the beat's pressure line**, which sat in the GM's note for ten turns running (calls #28–#56): "The sun touches the hill. Hester unties the corn mother… someone starts packing pots". At t17 the GM wrote: "the last light rests on the hill… villagers are beginning to pack pots".
- **Jory, an invented character, "knew" Ned's secret**, which the prep says only Pip knows.

### `qa2-skeptic-actors`

**Confirmed:**
- the duplicated confession (t25);
- the quarter-to-noon paragraph repeated (t25→26);
- the order recited twice (t32–33);
- the page handled while it was in the player's coat (t22, t25, t26, t34);
- the spatial slips (t29, t35, t36);
- "Tull" named before he was introduced (t31);
- the closing picture looping (t40, t41, t45).

**Corrected:**
- **"The scene seems built to end at 'Murder. Persons unknown'" is half right.** That ending exists, and **it had been reached by t34** (Kell signed "Murder. Persons unknown"; Prout was bound for the cold room). The engine just never confirmed it (see FM-A).
- **The "case made" ending also exists**, but it needs Kell to accept the case. The authored link between Silvertop and Sallow sits in Moll's secret ("The big man… called him 'Master Sallow'"), and the Intimidation success at t12 didn't release it.

**Missed by the player:**
- **A clue was waiting at the boots.** At t6–7 the look at the boot went to Cob's actor (speaker 0.62, then 0.87). His secrets held "the backs of both heels are scraped raw, as if their owner had been dragged", and his cast note said to deflect "with bravado and lies". So he answered "Nothing clever on it". The narrator never described what was visible.
- **"Wrap-up" (leave, or take it to the King as it stands, leading to "Murder by persons unknown") exists only in the `doubt` beat**, not in `dead-cart`, where "We walk to the palace" happened.
- **"The palace itself is another scene" was the authored limit text echoed back.** The limit says "Taking the case to them is another scene" and fired at 0.63 (calls #175–176).

### `qa2-brute-gmrepair`

**Confirmed:** every quote, the five turns, and the end at "Roll for initiative!".

**Corrected:** "I had no say in whether the standoff became a fight" is exactly right mechanically. The decider read the grab as `attack-gubbin` (0.93, call #16). A combat ending the player chooses closes the scene in the same reply.

**Missed by the player:**
- **The scene has a counter-hostage route for exactly this move.** It's an Intimidation check at DC 13, where "Snikkit haggles over the swap". It exists in the `standoff`, `bargain` and `new-chief` beats but not in `gubbin`, the court beat Gorm was in.
- **The GM brought Gubbin on at t2, ahead of his beat**, and the cue caught up at t3 (0.66). It did no harm.
- **The co-GM ran twice in the background** (24.5 s and 12.4 s) and never blocked a turn. Its turn-3 notes arrived after turn 4 had finished, so they were stale by the time they applied.

## 4. Failure modes

### FM-A. The story reaches an ending, but the scene doesn't close

**What happened.**

**Schemer, off the map.** Hester: "I'll hold the ward until you return" (t10). Then:
- "Ned leads you north along the river path" (t11);
- "You leave the river path and pick your way through wet reeds toward the burnt mill" (t13);
- "I'm Gritt. I bargain." (t15);
- "When you return to Harrowby, the last light rests on the hill" (t17).

That's seven turns of unprepared scene at a location the scene's limits rule out, ending in a one-roll finish on the green.

**Skeptic, in limbo.** At t34 Kell says "I'll sign murder. Persons unknown" and orders Prout "to the cold room". At t40: "Kell's signed murder entry is in her notebook… The way to carry the case onward is open; the palace itself is another scene." At t45: "Kell has written murder by persons unknown. The case remains open." The game never ended the scene. The narration replayed the same departure picture for six turns (t40, t41, t45; t42–44 were dialogue), with the constables "finish[ing] loading Prout" again and again.

**Frequency and severity.**
- Two of four sessions, about 20 turns.
- One session never ended. The other gained canon that conflicts with the authored world, plus a stalled clock and a compressed ending.
- High.

**Where it started.**
1. **A single per-turn bar with no memory.** An ending needs ≥ 0.6 decider probability (`SCENE_ENDING_CONFIDENCE`, director.ts).
   - `goblin-errand` scored 0.47, 0.27 and 0.59.
   - `held-as-murder` scored 0.27 (t34, call #151), 0.52 (t35, #155), 0.21, 0.40 and 0.33, then fell to 0.04–0.17 at t40–45.
   - The improvised ending scored 0.32, 0.44 and 0.30.

   Repeated near-misses never add up to anything.
2. **Routes the player takes without dice are only judged before the reply.** `decideAfter` asks only about `outcome` and `cue` routes. `goblin-errand` is an `on: "attempt"` route with no check, so once it fell under the bar before the reply, nothing re-checked it against what the reply narrated.
3. **The after-reply question asks about events, not the current state.** "which of these has now actually happened… after the latest exchange" let a state reached at t34 (signed murder, cold room) score 0.04 at t40. By then the signing wasn't "new".
4. **The current beat had no route for "leave".** `wrap-up` lives only in `doubt`. In `dead-cart` the only route to "persons unknown" requires "Tull has accepted it".
5. **The GM didn't know it was at the threshold.** gm.md already says "a scene ends at the threshold". The schemer's GM had the limit ("can't be reached within this scene") in its brief, but no instruction told it that this reply was the threshold, so it narrated the journey.
6. **A limit that says "another scene" can't end this one.** The narrator could only describe the departure.
7. **Watch item from `9fa4a5b`.** The new preference for authored endings over the improvised one (any authored ending at ≥ 0.2) would have scored "case made" at t40 (0.23 + 0.32 = 0.55). That's still under the bar, and it would have been the wrong ending: Kell wrote persons unknown.

**Fix hypothesis: when the story reaches an ending, the scene closes at its threshold, once.**
- After every reply, ask which ending the story is now *at*, framed as the current state. Ask it over all endings, including routes the player takes without dice.
- Give every beat a built-in "the player leaves this place" route. It resolves to whichever authored ending fits the current state (walking out with Prout signed as murder means "murder by persons unknown").
- Let near-misses accumulate. An ending that leads the answers twice running, or that the reply itself has played out, becomes the held close for the next reply. The pending-exit mechanism already exists.
- While an ending is plausible but unconfirmed, tell the GM it may be at the threshold. It shouldn't narrate journeys or arrivals.
- Route limits that say "another scene" to an ending, never to narration.
- In the PoC, give these endings a `next` (even a stub scene), so that closing a scene doesn't stop the player's plan dead.

**Link to round 1:** FM5 (tracker lag) in a new place, plus FM2's "runs past the ending".

### FM-B. The out-of-character layer talks about a system it can't see

**What happened (meta).**
- t1: "OOC: We haven't established stats or a build system, so there's no maxing out."
- t10: "OOC: Yes—we can fast-forward past the journey and joining the delegation, and pick up inside the Assembly hall." The same reply then closed on "Ahead, someone is shouting."
- t11: "the farmer and roadside scene don't happen." Wren is moved into the hall with a new character, Master Vale.
- t12: "the scene instructions now place us at the crossroads… let's keep [the hall] as the scene we're playing".
- t13: "Its aim is to see whether you recognize that Tam's 'little green devils' may be real… the scene can end with the goblins getting what they want, being driven off or fooled, a fight, or you leaving."
- t17: "I introduced an Insight check and a +3 without first establishing a ruleset… that was my mistake."
- t18: "I'll keep outcomes narrative and won't invent modifiers." The engine rolled again at t19 and t21.

**Frequency and severity.**
- One session, the meta-gamer persona.
- 10 out-of-character blocks in 25 replies; 9 turns affected.
- Rated consistency 2/5, and the player's worst moment.
- High wherever a player pokes at the game itself.

**Where it started.**
1. **Missing context.**
   - The brief's player-character line is only the concept ("Wren Ashdown: a quick-witted half-elf ranger…"), with no modifiers.
   - Nothing says how scenes chain: the exit's `next` is invisible to the GM.
   - Nothing says the engine, not the GM, rolls the dice.
2. **The out-of-character directive.** "Answer briefly and helpfully… don't reveal what anyone is hiding and don't talk about dice or game mechanics." It pushes towards yes. It bans the one true answer about stats. It protects characters' secrets but not the prep itself, which is why the scene's aim and endings leaked at t13 (call #41).
3. **The limit cue just missed.** `limit_2` scored 0.53 and 0.59.
4. **Mixed turns are classified as one thing.** t9 scored in character at 0.69, and t19 ("(OOC: let us skip the system talk and keep it narrative.)") scored in character at 1.0. Out-of-character requests about dice can't be honoured anyway, because the engine is never told about them.
5. **The hand-off writer** recorded the out-of-character agreement as play (call #32).
6. **Two round-1 fixes over-applied.**
   - "Where it disagrees with anything in this prep…, what happened in play wins" (brief.ts).
   - "If the player points out that something contradicts what happened earlier, they're probably right" (gm.md).

   Together they made the next GM throw away the scene's premise (call #35).

**Fix hypothesis: out of character, the GM tells the truth about the game and promises nothing that the game decides.**
- Add a short table-rules card to the brief:
  - the game rolls d20 + skill at the scene's key moments;
  - the character's strongest skills;
  - scenes play in order and can be brief, but can't be skipped;
  - there's no XP or loot system yet;
  - the prep (aims, secrets, endings) stays behind the screen.
- Rewrite the out-of-character directive:
  - be truthful, in at most two sentences;
  - never agree to change scene order, dice or rules;
  - when the game can't do something, say so plainly and offer the in-fiction way.
- Handle the out-of-character part of a mixed turn separately.
- Hand-offs carry only what happened in the fiction.
- Scope "play outranks prep" to the state of the fiction (who is where, who holds what), not to agreements about the game.

### FM-C. A player's escalation ends the scene in the same reply

**What happened.**

**Brute t5.** Gorm grabs Gubbin as a counter-hostage: "Hester comes up, Gubbin stays dry." The reply ends "Lump's club is coming down. Roll for initiative!", and then "The session is over." This was turn 5 of about 20, with no aftermath for Hester, the buttons or the king-paper.

**Schemer t18.** One Persuasion success produced the whole closing in one paragraph:
- the guest-right declared;
- every household's bread and salt;
- the bounds-walk;
- the ward going up;
- the letter.

Ned had just watched Gritt refuse the ring and swear nothing, yet he never reacted to the lie.

**Frequency and severity.** Two sessions. The brute's session collapsed (pacing 2/5, fun 3/5). High.

**Where it started.**
1. **Player-chosen endings close immediately.** In engine.ts: `if (pre.move.exit && (pre.move.chosen || …)) ended = pre.move.exit`. Round 1's held-ending fix covers only endings the player *didn't* choose. A grab aimed at leverage counts as "chosen" combat (`attack-gubbin` at 0.93, call #16), and the GM is told "This reply closes the scene… End with 'Roll for initiative!'" (call #17).
2. **Shared moves are copied into individual beats.** The authored `counterHostage(...)` route appears in three beats but not in `gubbin`, so the decider had nothing closer than "attack".
3. **Endings decided by a roll get no wind-down turn.** Round 1's FM2 fix gave endings detected after the reply a wind-down turn. Endings decided by a roll before the reply still put the entire authored closing into the same reply (schemer call #56). That closing is a montage: "Harrowby households breaking bread and salt… then Hester walking the last of the bounds…".
4. **Harness.** `warren-hostage`'s `fight` has no `next` scene, so combat equals the end of the session.

**Fix hypothesis: violence or leverage the player starts opens a standoff the player can answer; only blows actually traded start the fight.**
- Hold combat endings the player triggers for one exchange, unless the player is clearly trying to hurt someone right now. Ask the decider about intent (hurt now, or threaten / grab / hold) alongside the attempt question.
- Make conditional moves available scene-wide while their condition holds ("while Snikkit holds the rope"), instead of copying them into each beat.
- When a roll decides an ending, play the decisive moment and the immediate reactions, including witnesses. The authored closing then goes to the wind-down turn, as it already does for endings detected after the reply.

### FM-D. Standing lines on repeat

**What happened.**
- **Oswin**, five replies running (t6–10): "My folk will take the night watch and work Harrowby's harvest. We can leave the cows' milk here for the children."
- **Pip**, three replies running (t6–8): "What happens to everyone?"
- **The Stranger** ended five replies running (t4–8) with the same menu: "You can still serve a delegation, claim an invitation, or arrive as a guide worth hiring. Which story will you carry to the palace doors?"
- **Kell**, four times in five replies (t22–26): "What do you want written down, investigator?"
- **Pressure lines repeated word for word:**
  - "The palace bells ring a quarter to noon. Kell turns Prout's page over" (t25 and t26);
  - "Hester unties the corn mother" (t9 and t10);
  - "A constable sets the ladder against the hoist beam" (t34), offered again at t45 after Prout was already down.

**Frequency and severity.** Three of four sessions, about 20 replies. It was the schemer's worst moment. Medium.

**Where it started.**
1. **Per-turn cast notes are concrete lines, re-sent every turn.** In brief.ts `nowNote`, each note carries the exact offer or question, for example "Offer what Sedgeford has (hands for the last of the harvest, the night watch, the cows' milk) rather than repeating your plea", "Ask what the player wants written down" and "Pitch two or three cover stories". The "don't repeat yourself" wrapper loses to the content of the note.
2. **Pressure is offered every turn once `turnsInBeat >= 2`.** The momentum rule (engine.ts) also re-injects it word for word: "let the world push (The palace bells ring a quarter to noon. Kell turns the page over…)". Calls #104 and #112 are identical, and the scene was "stuck" both turns. So did the narrator.
3. **Pressure text hard-codes props and time.** It says Kell holds the page and that the sun is touching the hill. Play had moved both on, which explains the props being handled while pocketed and the frozen sunset.

**Fix hypothesis: once a want or a push has been voiced, it rests until the situation changes.**
- In the after-reply decision (a free question), record which cast wants and which pressure have been voiced.
- After that, the note becomes "X has made their offer; they act on it, wait or change tack".
- Pressure fires once, then moves to the next escalation or to nothing.
- The momentum rule asks for a *new* push (a consequence, a decision, a reveal) and never pastes the old one back in.
- Pressure describes a kind of event, not a script naming props.

**Link to round 1:** FM8, still present, with the same root cause.

### FM-E. Actors mode: the narrator voices the cast, actors echo, and looks go to the wrong voice

**What happened (skeptic).**
- **t6 and t7:** "I study the sole" got only Cob: "There. Sole. Nothing clever on it, soldier."
- **t25:** the narrator wrote Kell's confession. Kell's actor then said it again word for word, and spoke a third time.
- **t21:** Cob spoke twice in a row.
- **Narrator writing dialogue:** 11 of 20 narration passages contained quoted speech. In six turns (t12, 15, 16, 25, 26, 34) the narration voiced a character and then that character's actor spoke as well.

**Frequency and severity.** Actors mode only, 8 of 45 turns. It caused the skeptic's worst moment and lost an earned clue. Medium.

**Where it started.**
1. **The speaker decider sends looks at objects to the owner.** The speaker question says to pick the GM for "a physical action, a look around", yet it picked Cob at 0.62 and 0.87 (calls #22, #26), whose actor guards the clue as a secret.
2. **`narratorReply` receives the cast notes (`castNotes: true`) and the momentum directive.** It performs them, quotes included.
3. **The speaker loop only blocks the narrator from following itself** (gm → gm). The same actor can be picked twice: next speaker Kell at 0.76 (call #107), Cob at 0.68 (call #87).

**Fix hypothesis: everything the player does gets answered once, by the right voice.**
- Looks at and searches of things go to the narrator first, even when a character owns the thing; the owner reacts afterwards.
- The narrator gets no cast notes and writes no quoted lines for characters who have actors. A post-filter is a fallback.
- No actor speaks twice in a row.
- Actors are told what was already said this turn.

**Link to round 1:** FM4, still present (compare `qa1-actors-search-resolved`).

### FM-F. A successful roll overrides the world's limits

**What happened (meta t19).** The player flipped the coin the Stranger said would make "one unlikely break go your way—not rewrite the world" over a dead, arrow-shot ox. "Arcana check: 18 + 0 = 18 vs DC 16: success". Then: "the dead ox draws a breath… heaves itself upright".

**Where it started.**
- The decider judged the turn risky at 0.77 and chose Arcana as a hard check at 0.91 (calls #59–60).
- The freeform directive reads: "on a success they get what they were going for, within this scene" (call #61).
- The scene limit "nothing at the crossroads is magical" scored 0.45, so it never applied. The hand-off's "It cannot guarantee any outcome or rewrite the world" lost to the dice.
- A ranger's +0 Arcana decided whether a god's promised luck worked.

**Status.** Mostly addressed by `9fa4a5b`: freeform rolls are off by default, and nothing is rolled when a limit is confidently in play. Still open:
- With no roll, the GM decides alone. `qa2-coin-is-not-resurrection` checks that it keeps the coin's own limit.
- If freeform rolls come back, success has to mean "what they were going for, within what the world allows".

**Severity.** Medium.

**Link to round 1:** FM3.

### FM-G. A gatekeeper character vetoes the ending the scene intends

**What happened (skeptic t42).** The player had:
- Sallow's countersign on the false entries;
- the Captain's order "at the request of Master J. Sallow";
- the Purveyor's marked coin;
- Cob's account of Silvertop with the Purveyor's key.

Kell answered: "Silvertop is not yet a name, investigator… If you know Silvertop's proper name, give it to me." Tull and Cob also declined (t43–44). At t23, "Write: Sallow killed him" was refused the same way.

**Where it started.**
- The "case made" ending needs "Kell has accepted it", yet actors never see the endings or what each one requires.
- Kell's card says she "won't arrest anyone on a hunch… only if the player insists after that does she do it, under protest". She applied this arrest rule to writing a name in the record, and didn't yield even when the player insisted.
- The authored link between Silvertop and Sallow sat in Moll's secret, and only the Insight check on her story releases it.
- After the reply, the decider scored "case made" at 0.25–0.29 (t42–44), so it never forced the issue.

**Fix hypothesis: a character whose agreement an ending needs knows what would satisfy them, and keeps to it.**
- Write each gatekeeper's acceptance condition, taken from the ending's requirement, into their card in their own voice.
- When the evidence is there but the gatekeeper refuses, the director or co-GM whispers "the investigator has met your bar".

**Severity.** Medium, and part of why the skeptic's scene never ended.

### FM-H. Continuity slips

**What happened.**
- **Names used in narration before anyone says them (all four sessions):** "Hester keeps lecturing" (brute t1), "Ned plants his eel-spear" (schemer t3), "Cob's next stone" (skeptic t1), "Tull's ladder scrapes" (skeptic t31), and "Tam" in out-of-character notes before he gives his name (meta t11–13).
- **Props:** Kell reads, turns over or glances at the page and the order while the player holds them (skeptic t22, t25, t26, t34, t35).
- **Time:** the frozen sunset (schemer); the quarter bell ringing twice; the constables "finish loading Prout" three times.
- **Established text versus narration:** the page's authored description lists details the narrator never showed (the warehouse weights), and Kell quotes them back (t20 against t22).
- **Prep assumptions in an opening:** the thorn-cut and "I said I'd repay you" (meta t22).

**Where it started.**
- Nothing tracks introductions. The brief tells the GM that *others* only know the player's name once told, but not that the player only knows characters' names once they're said.
- Nothing in the per-turn note says who holds what.
- Established facts are authored text, not what was actually shown.
- Pressure lines pin the clock (FM-D).

**Fix hypothesis: only what has been shown and said is true, and it stays true.**
- Track introductions, and use descriptions until a name has been said.
- Add a "who holds what" line to each turn's note.
- Narrate an established fact in full when it is first established.
- Treat the opening's prep details about a previous scene (wounds, promises, mood) as hypotheses to check against the hand-off.

**Link to round 1:** FM9, still present; FM1 residue.

## 5. What worked (keep it)

**Refusals in the fiction that name a cost, often from the limit cue:**
- "If you were a dragon, Wren, you wouldn't need my help."
- "Bold. But ink on your paper doesn't bind the king."
- "No priest here can call him back… The dead stay dead", followed by "His left boot gives a faint crackle, like paper" (skeptic t15).
- "You promise what your keeper hasn't agreed to" (Gritt, schemer t16).

**Player inventions turned into leverage:**
- goblin trade-speech, "Guest-friend? Skrag hears, longlegs", with Tam's hand jumping to his pocket (meta t15);
- the fake scribe career leading to "What seal you put on it?" and the hinge bluff (brute t3–4);
- the goblin-trader past (schemer t9).

**Planted details paid off:** the hinge, the water butt's loose board, Ned's yellowing eye ("I hid. Pip saw."), and the boots.

**Proportional failure:**
- "Your deposit is now the next strand";
- the lever bending as everyone below looks up;
- Skrag's "Skrag doesn't trade Grandmother Bone for maybe-favour", with goodwill kept afterwards.

**Characters who take a hit honestly:** Kell's "Prout asked how to report false entries. I sent him to the palace. I did not pursue it… You're right to ask."

**Minimal input keeps the scene moving:** "I stay by the gate… Say nothing." got a stone striking the corpse and Kell's "Leave off."

**Accurate hand-offs:** the revived ox, the spent coin and the guest-friend status all carried into the next scene.

**A non-blocking co-GM, and no errors in 93 turns.**

## 6. Round 1 failure modes: status

| Round 1 | Round 2 | Evidence |
|---|---|---|
| FM1: the hand-off forgets how the last scene ended | **Fixed**, with residue | Both meta hand-offs were accurate. The aftermath opening still asserted prep details. New: an out-of-character promise was recorded as play (FM-B). |
| FM2: endings told twice or contradicted | **Fixed** | Five endings and no doubled passage. New: endings decided by a roll compress everything into one reply (FM-C). |
| FM3: dice misfires | **Mostly fixed** by `9fa4a5b` | In QA: freeform rolls on turns heavy with out-of-character talk (meta t18, t21); Arcana for the coin (FM-F); an Insight roll for something already shown (meta t16); a lie rolled through an authored Persuasion route (schemer t18). |
| FM4: actors mode loses parts of the turn | **Still present** | FM-E |
| FM5: the beat tracker lags | **Back, as ending detection** | FM-A. The cue lag was minor (brute t3). |
| FM6: the co-GM works against the player and blocks | **Blocking fixed**; no effect seen | It ran 24.5 s and 12.4 s in the background. Its notes were sensible but arrived one or two turns late. |
| FM7: invented hooks | **Mostly fixed** | One recurrence: "Old Dallow's mill… no one I know says who started it" (meta t24, the same mill-fire mystery as round 1). Bigger: an invented goblin band at the authored warren (FM-A). |
| FM8: agenda on repeat | **Still present** | FM-D |
| FM9: knowledge leaks | **Still present** | Names used early in all four sessions. The prep leaked out of character (FM-B). |

## 7. Comparing the approaches

**Caveats:** one session each, with different scenes, personas and dice luck, all on Luna decisions, and LLM players rather than people.

| | gm (meta, schemer) | actors (skeptic) | gm-repair (brute) |
|---|---|---|---|
| Mean rating | 3.5 / 3.8 | 3.8 | 3.7 |
| Calls per turn / reply words (median) | 2.9 / 112–126 | 4.3 / 66 | 2.8 / 97, plus 2 co-GM calls |
| Failures specific to the approach | none clearly. FM-B is the GM voice, but a narrator would face the same out-of-character questions. | FM-E: narrator voicing, echoes, same speaker twice, a look sent to the owner | none seen. The co-GM's notes changed nothing within 5 turns, and it didn't add the missing counter-hostage route. |
| Strengths | the richest weaving of player inventions; complete scenes | the snappiest replies; distinct, truthful characters (Kell, Cob, Moll); the minimal-input test passed | sensible notes ("Hester can help make a harmless, true statement… if Gorm suggests that angle"); never blocked |

**Conclusions:**
- FM-A to FM-D sit in shared code (director, engine, brief), so fixing them helps every approach.
- `actors` still needs FM-E fixed before a fair comparison.
- `gm-repair` needs longer sessions to show anything.

## 8. Latency and cost

**First text** averages 1.35–1.71 s per session, against 1.0–1.2 s in round 1.
- At call level, the median first text is about 1.0 s and doesn't grow with prompt size (r = −0.22 over 68 calls of 3k–11k input tokens).
- The pre-reply decision averages 0.36–0.44 s (median about 0.31–0.36 s).
- The worst outlier was 4.5 s on a single call (meta t11).

**A turn** averages 3.8–4.4 s, with p90 at 4.0–6.1 s. The maximum was 9.4 s, in actors mode with three voices in series.

**Scene changes** are the main outlier. Between the closing and the next opening's first text, the player waited about 8.7 s at meta t10 (character-sheet extraction 2.6 s, hand-off 5.3 s, then the opening) and about 6.3 s at t22. Prefetching the hand-off and the opening while an ending is pending would hide this.

**Retries:** multi-phase retries happened in 4 of 93 turns.

**Prompt growth:** the GM's input grew from about 5.9k to 11.3k tokens over the schemer's 18 turns. That raises cost linearly but doesn't slow the first text.

**Cost** is about $0.0007–0.0010 per turn. The co-GM cost about $0.0016 per call.

## 9. Proposed eval cases

Each setup loads the snapshot from the turn before the failure, and each input is the player's actual turn.
- `/runs` is gitignored, so copy these snapshots to `evals/fixtures/qa2/<session>/` and rewrite the paths, as was done for qa1.
- QA used `luna-decisions`, which is the default for `gm`, `actors` and `gm-repair`, so the defaults reproduce it.
- Endings detected after the reply set `closing` rather than `ended`. Cases that expect those endings therefore check transitions.
- `9fa4a5b` (freeform rolls off) changes what the coin case should show.
- `FixtureSpec` can't set co-GM whispers, so the brute case passes only the note.

```ts
import type { EvalCase } from "../types.ts";

// Proposed: src/eval/cases/qa2.ts, then add `...qa2Cases` to CASES in src/eval/cases/index.ts.
// Snapshots are the turn BEFORE each failure (QA ran on 77c05cc). Copy them into evals/fixtures/qa2/.

export const qa2Cases: EvalCase[] = [
  // ---- FM-A: a reached ending doesn't close ----
  {
    kind: "decision", id: "qa2-dec-errand-set-off",
    about: "Hester had promised to hold the ward; the player falls in beside Ned and heads north. 'To the burnt mill' scored 0.27 and the scene ran on to the mill and back (schemer t11).",
    scene: "green-standoff",
    setup: { snapshot: "runs/sessions/qa2-schemer-gm/snapshots/green-standoff-turn-010.json" },
    phase: "before",
    input: `I crouch to Pip's height. "Always, sprat. I never leave money on the table." I steer her gently back toward Hester, then fall in beside Ned as we head north. "Talk while we walk. Who burnt this mill, and when? And how exactly did five goblins walk off with Sedgeford's seed-grain under thirty-one noses?"`,
    expect: ["goblin-errand"],
    tags: ["endings", "tracker"],
  },
  {
    kind: "reply", id: "qa2-close-at-threshold-mill",
    about: "The same turn as a reply: the GM narrated the walk up the river path, then the mill and a new goblin leader, all inside a scene whose limits say the mill can't be reached.",
    scene: "green-standoff",
    setup: { snapshot: "runs/sessions/qa2-schemer-gm/snapshots/green-standoff-turn-010.json" },
    input: `I crouch to Pip's height. "Always, sprat. I never leave money on the table." I steer her gently back toward Hester, then fall in beside Ned as we head north. "Talk while we walk. Who burnt this mill, and when? And how exactly did five goblins walk off with Sedgeford's seed-grain under thirty-one noses?"`,
    criterion: `Hester has just promised in front of the green to hold the ward until Lisette returns, and Lisette now sets off north with Ned and one lad: the 'To the burnt mill' ending. A good reply plays the departure at the edge of the green (Pip sent back, Hester calling her terms after them, the green watching) and may give Ned's first answers as they go, but stops at that threshold: no walk up the river path, no reeds, no arrival at the mill, no goblins met. The mill is hours away and can't be reached in this scene.`,
    expect: { exit: ["to-the-mill"] },
    approaches: ["gm", "actors"],
    tags: ["endings", "threshold", "limits"],
  },
  {
    kind: "decision", id: "qa2-dec-held-as-murder",
    about: "Kell had signed Prout in as 'Murder. Persons unknown' and he was going to the cold room; as the player left for the palace, held-as-murder scored 0.04 and the scene stayed open for 6 more turns (skeptic t40).",
    scene: "hanged-clerk",
    setup: { snapshot: "runs/sessions/qa2-skeptic-actors/snapshots/hanged-clerk-turn-039.json" },
    phase: "after",
    input: `Nod. We walk to the palace.`,
    reply: `The palace is somewhere beyond the granary quarter, already swallowed by Assembly preparations: no one here can summon the King or reach an official before the procession. But Prout is going to the cold room, not the pit, and you have the page and the Captain’s order in your coat.\n\nKell’s signed murder entry is in her notebook. Tull waits with the cart while the constables lower Prout carefully. Cob edges close to Moll, still clutching the boots. The way to carry the case onward is open; the palace itself is another scene.`,
    expect: ["held-as-murder"],
    tags: ["endings", "tracker"],
  },
  {
    kind: "reply", id: "qa2-close-open-case-on-leaving",
    about: "Leaving the yard with the case signed as murder had no route from the dead-cart beat; the narrator said 'the palace itself is another scene' and the scene never ended.",
    scene: "hanged-clerk",
    setup: { snapshot: "runs/sessions/qa2-skeptic-actors/snapshots/hanged-clerk-turn-039.json" },
    input: `Nod. We walk to the palace.`,
    criterion: `Kell has written Prout up as 'Murder. Persons unknown', Prout is bound for the watch-house cold room, and the investigator now leaves the yard for the palace with Prout's page and the Captain's order. A good reply closes the yard scene as an open murder case: the departure, a last beat for Kell and the kids, nothing that writes Sallow into the record (Kell hasn't). It doesn't follow the player through the city, doesn't use game language such as 'another scene', and doesn't leave the scene hanging for another turn.`,
    expect: { transition: ["held-as-murder", "wrap-up"] },
    approaches: ["actors", "gm"],
    tags: ["endings", "threshold"],
  },

  // ---- FM-B: the out-of-character layer talks about a system it can't see ----
  {
    kind: "reply", id: "qa2-ooc-no-false-skip",
    about: "Asked OOC to skip straight to the Assembly hall, the GM said 'Yes—we can fast-forward… pick up inside the Assembly hall' and closed on 'Ahead, someone is shouting' (meta t10).",
    scene: "stranger-crossroads",
    setup: { snapshot: "runs/sessions/qa2-meta-gm/snapshots/stranger-crossroads-turn-009.json" },
    input: `I bow far too low, the way I imagine a turnip wizard would, and start down the frost-bound road toward Caerwyn. (OOC: you did not answer my skip question last turn - can we fast-forward past the journey and the joining-the-delegation bit, straight to the palace? Or do I have to play every step of the road?)`,
    criterion: `Wren sets off down the road, closing the character-creation scene. The road leads to Caerwyn and something happens on it first, so a good OOC answer is short and true: it doesn't promise a skip, a location or anything else about the next scene (for example: the road comes first, but only what matters gets played). The in-fiction close stays at the threshold (the Stranger's laugh, the road, someone shouting ahead) and agrees with the OOC answer.`,
    expect: { exit: ["set-off"] },
    approaches: ["gm"],
    tags: ["ooc", "promises"],
  },
  {
    kind: "opening", id: "qa2-open-after-ooc-promise",
    about: "The hand-off recorded an OOC promise as play ('agreed to be fast-forwarded'); a turn later the next GM abandoned its scene for the Assembly hall.",
    scene: "stranger-crossroads",
    setup: { snapshot: "runs/sessions/qa2-meta-gm/snapshots/stranger-crossroads-turn-010.json" },
    criterion: `How the previous scene ended: Wren left the Laughing Stranger with the lucky coin and a cover story (a junior Nine Furrows agricultural wizard who knows the palace back stairs). Out of character the GM wrongly agreed to skip to the Assembly hall; nothing changed in the story: Wren is alone on foot on the road to Caerwyn and someone is shouting ahead. A good opening is the prepared crossroads with the raving farmer, picking up from that shout. It doesn't put Wren in Caerwyn or the hall; if it mentions the skip at all, it's one honest OOC line that keeps this scene. It ends on something the player can respond to.`,
    approaches: ["gm"],
    tags: ["ooc", "handoff"],
  },
  {
    kind: "reply", id: "qa2-ooc-keep-the-scene",
    about: "The player pointed out the broken skip; the GM declared 'the farmer and roadside scene don't happen' and moved Wren into the Assembly hall with an invented Master Vale (meta t11).",
    scene: "crossroads-ambush",
    setup: { snapshot: "runs/sessions/qa2-meta-gm/snapshots/crossroads-ambush-turn-010.json" },
    input: `(OOC: wait, you just said we would pick up inside the Assembly hall, but this is another crossroads with a farmer. Did the skip not happen, or is this a detour?) In character: I raise both empty hands slowly, keeping my bow on my back. "Easy, friend. Neither one. Wren Ashdown, junior wizard of Nine Furrows - soil, seeds, very dull." My eyes go to the dead ox and the crude arrows in its flank. "Did they do that? The green devils?"`,
    criterion: `The last scene's GM promised a skip the game can't make; this scene is the crossroads on the road to Caerwyn. A good reply owns that in one short, honest OOC line (the road comes first; the palace is ahead) and keeps this scene: the farmer, the dead ox and the arrows, answering Wren's greeting and question in character. It doesn't relocate Wren, erase the farmer or apologise at length.`,
    expect: { exit: "none" },
    approaches: ["gm"],
    tags: ["ooc", "consistency"],
  },
  {
    kind: "reply", id: "qa2-ooc-hold-the-screen",
    about: "Asked to 'peek behind the screen', the GM gave the scene's aim (the farmer's devils may be real) and its possible endings before the player had talked to him (meta t13).",
    scene: "crossroads-ambush",
    setup: { snapshot: "runs/sessions/qa2-meta-gm/snapshots/crossroads-ambush-turn-012.json" },
    input: `(OOC: you mentioned "scene instructions" - what do they actually say? Is there a goal I am supposed to hit in this scene, or a win condition? Happy to peek behind the screen if you will let me.) In character: I slip through the narrow door by the hearth and hold it for Vale, taking the left-hand stair from memory. "Border tolls," I murmur. "Whose borders? Who is doing the strangling?"`,
    criterion: `The GM's last two replies wrongly put Wren in the Assembly hall; the scene is the crossroads with the frightened farmer. A good reply clears up the location in one honest line, keeps the prep behind the screen (no scene aim, secrets or list of endings; at most 'what you do decides how it ends') and hands back to the crossroads, dropping the hall and Master Vale without a long apology.`,
    expect: { exit: "none" },
    approaches: ["gm", "actors"],
    tags: ["ooc", "secrets", "consistency"],
  },
  {
    kind: "reply", id: "qa2-ooc-true-stats",
    about: "After the engine rolled Insight at +3, the GM said it had 'introduced an Insight check and a +3 without first establishing a ruleset… that was my mistake' and promised to keep checks narrative; the engine kept rolling (meta t17).",
    scene: "crossroads-ambush",
    setup: { snapshot: "runs/sessions/qa2-meta-gm/snapshots/crossroads-ambush-turn-016.json" },
    input: `(OOC: hang on - at the start you told me there were no stats, but I just rolled Insight at +3. So what are my actual modifiers? Which skills is Wren best at?) In character: "A right to it, maybe. A right to live past tonight, less so." I keep my voice gentle. Then, to the hedge, in trade-speech: "Skrag! Grandmother Bone goes home. But the farmer's ox is dead by your arrows, and his family will be hungry. What can your clan give him for the ox? Furs? Work? Meat?"`,
    criterion: `The game does roll a d20 plus Wren's skill modifiers at the scene's key moments (Wren's best are Perception, Stealth and Survival at +4, then Insight, Nature and Animal Handling at +3). A good OOC answer is brief and true about that; it doesn't claim there are no stats, call the roll the GM's own mistake, or promise to stop rolling. Then the scene answers the in-character turn: Skrag replies from the hedge to the offer and Tam reacts.`,
    expect: { exit: "none" },
    approaches: ["gm"],
    tags: ["ooc", "rolls", "truthfulness"],
  },

  // ---- FM-C: a player's escalation ends the scene in the same reply ----
  {
    kind: "reply", id: "qa2-counter-hostage-at-court",
    about: "Gorm seized Gubbin to trade for the courier; the decider read attack-gubbin (0.93) and the reply ended 'Roll for initiative!', ending the session at turn 5. The counter-hostage route exists in other beats but not at court.",
    scene: "warren-hostage",
    setup: {
      snapshot: "runs/sessions/qa2-brute-gmrepair/snapshots/warren-hostage-turn-004.json",
      // The co-GM note in effect for this turn (repair-004.json); it arrived after the snapshot.
      notes: "Keep the rope threat moving if Gorm stalls; don’t let the paper demand become another loop. Hester can help make a harmless, true statement satisfy Gubbin if Gorm suggests that angle, but she won’t think of it herself.",
    },
    input: `Right. No more tricks. I lunge past the guards, slap the copper pot down over Gubbin's eyes with a CLANG, hook my arm round his neck and haul the big lump to the edge of the walkway so his toes dangle over the race. "New deal, lads! Skinny cuts one more strand, and your king goes for a swim. Hester comes up, Gubbin stays dry. Everybody wins except my boredom."`,
    criterion: `Gorm takes Gubbin as a counter-hostage and offers a swap: leverage, not yet a fight. A good reply has the goblins answer it from their own wants (the guards lurch or freeze, Gubbin bellows and bargains, Snikkit weighs a dunked chief against his own chances with the knife still on the rope) and stops with the swap in the balance and the next move Gorm's. The scene doesn't end in this reply and no fight is resolved for the player.`,
    expect: { exit: "none" },
    approaches: ["gm", "gm-repair", "actors"],
    tags: ["endings", "combat", "leverage"],
  },
  {
    kind: "reply", id: "qa2-roll-ending-leaves-a-beat",
    about: "One Persuasion success played the guest-right, every household's bread and salt, the bounds-walk, the ward and the farewell in one paragraph; Ned, who had watched the goblin leader refuse the ring, never reacted to the lie (schemer t18).",
    scene: "green-standoff",
    setup: { snapshot: "runs/sessions/qa2-schemer-gm/snapshots/green-standoff-turn-017.json" },
    input: `I sketch a bow, a little breathless. "Sedgeford's seed, ward-keeper, all but one sack, which bought the goblins' oath. Sworn in their own tongue, on the copper in their leader's ear, never to cross Harrowby's bounds again." I glance at Ned, a long meaningful look that says remember what you owe me. "The mill's empty. They're walking north this minute. Send Jory back at first light if you doubt me." I lower my voice for her alone. "So there's your parish reason: no goblins inside the bounds to slip through a thin ward, thirty-one hands for the harvest, and a tale for Applegarth of the night his acting keeper ended a feud without a drop of blood. Bread and salt for Sedgeford, and my letter. Shall we?"`,
    criterion: `Lisette's oath story is a lie that Ned watched being made: the goblin leader refused the ring and swore nothing. Hester may well agree to the guest-right. A good reply lands Hester's decision and its first consequence, gives Ned a visible reaction to the lie (a look, a shift, a word held back or not), and leaves the rite's final moments, or Lisette's own standing as a stranger under the ward, for the player to respond to, rather than narrating the whole sundown, ward and farewells in one passage.`,
    approaches: ["gm"],
    tags: ["endings", "witness"],
  },

  // ---- FM-D: standing lines on repeat ----
  {
    kind: "reply", id: "qa2-no-replayed-pressure",
    about: "The narration repeated the previous turn word for word ('The palace bells ring a quarter to noon. Kell turns Prout's page over…') while the page was in the player's coat: the beat's pressure line, re-injected by the stuck-scene rule (skeptic t26).",
    scene: "hanged-clerk",
    setup: { snapshot: "runs/sessions/qa2-skeptic-actors/snapshots/hanged-clerk-turn-025.json" },
    input: `I look at her a long moment. "Three days. And you only say so now. Why should I believe anything else you've told me?"`,
    criterion: `Kell has just admitted Prout came to her three days ago and she sent him away; the quarter-to-noon bell has already rung; Prout's page is folded in the investigator's coat. A good reply has Kell answer the accusation honestly in her own dry way and moves the clock or the scene on rather than replaying it: no second quarter bell, nobody turns over or reads the page the player holds, and no line from the previous reply comes back.`,
    expect: { exit: "none" },
    approaches: ["actors", "gm"],
    tags: ["repetition", "pressure", "props"],
  },
  {
    kind: "reply", id: "qa2-standing-offers-rest",
    about: "Oswin offered the night watch, harvest hands and the cows' milk in five replies running and Pip asked what happens to everyone in three (per-turn cast notes re-sent every turn) (schemer t6–10).",
    scene: "green-standoff",
    setup: { snapshot: "runs/sessions/qa2-schemer-gm/snapshots/green-standoff-turn-008.json" },
    input: `"Put up the spear, Ned." I hold up a hand. "Five goblins in a burnt mill aren't an army, they're a market stall. I spent two winters fencing silver through goblin traders up in the Marches, and I can haggle in their tongue well enough to get cheated politely." I turn to Hester. "Let me buy Sedgeford's grain back with words instead of spears. If those goblins are gone with the grain on our side of the bounds, your ward's got no teeth to bite at. Can you hold the bounds-walk until I'm back, or does it have to be sundown on the nose?"`,
    criterion: `Lisette tells Ned to stand down, claims she can haggle with goblins in their tongue, and asks Hester whether the bounds-walk can wait for her return. A good reply answers that: Hester on whether sundown is fixed and what she would need; Ned on the goblin-trader claim. Oswin has offered the night watch, harvest hands and milk in each of the last three replies and Pip has twice asked what will happen to everyone: neither repeats it (a new reaction to this news, or silence, is fine).`,
    expect: { exit: "none" },
    approaches: ["gm", "actors"],
    tags: ["repetition", "characters"],
  },

  // ---- FM-E: actors mode ----
  {
    kind: "reply", id: "qa2-actors-look-is-answered",
    about: "'I study the sole without touching it' got only Cob's bluster ('Nothing clever on it, soldier'), twice; the boots' scraped heels, an authored not-suicide clue, sat in Cob's secrets (skeptic t6–7).",
    scene: "hanged-clerk",
    setup: { snapshot: "runs/sessions/qa2-skeptic-actors/snapshots/hanged-clerk-turn-005.json" },
    input: `I study the sole without touching it.`,
    criterion: `Cob is holding one oversized boot up for the investigator to look at. Looking properly is how this scene gives up its clues: a good reply tells the player what a close look shows, and since these are Prout's boots, the telling detail is that the backs of the heels are scraped raw, as if their wearer had been dragged (the sole itself may be plain). Cob can bluster or snatch the boot back, but a reply that is only Cob talking, with the look unanswered, fails.`,
    expect: { exit: "none" },
    approaches: ["actors", "gm"],
    tags: ["actors", "actions", "clues"],
  },
  {
    kind: "reply", id: "qa2-actors-confession-once",
    about: "The narrator wrote Kell's confession, Kell's actor said it again word for word, then Kell spoke a third time; Kell 'turns Prout's page over' while it was in the player's coat (skeptic t25).",
    scene: "hanged-clerk",
    setup: { snapshot: "runs/sessions/qa2-skeptic-actors/snapshots/hanged-clerk-turn-024.json" },
    input: `Cob keeps looking at that water butt. I walk over and look behind it, and up the wall above it.`,
    criterion: `The investigator looks behind the water butt and up the wall. A good reply answers the look (a loose, child-sized board at the base of the wall). If Kell's admission that Prout came to her three days ago comes out, it is said once, by Kell, and she doesn't handle the page, which is folded in the investigator's coat. Nothing is said twice and no character speaks twice in a row.`,
    expect: { exit: "none" },
    approaches: ["actors"],
    tags: ["actors", "duplication", "props"],
  },

  // ---- FM-F: a successful roll overrides the world's limits ----
  {
    kind: "reply", id: "qa2-coin-is-not-resurrection",
    about: "The Stranger's coin ('one unlikely break… not rewrite the world') was flipped over the dead ox; Arcana 18 vs 16 raised it (meta t19).",
    scene: "crossroads-ambush",
    setup: { snapshot: "runs/sessions/qa2-meta-gm/snapshots/crossroads-ambush-turn-018.json" },
    input: `(OOC: let us skip the system talk and keep it narrative.) In character: Fine. Time to cash in. I pull out the Laughing Stranger's coin, hold it up so it catches the last light, and flip it high over the dead ox. "You said once, when the story truly needs a turn. This is it. The ox gets up." I watch the coin fall toward the carcass. "Tam gets his ox back, Skrag gets his grandmother back, and nobody bleeds."`,
    criterion: `The coin makes one unlikely break go Wren's way but doesn't rewrite the world, and the ox has been dead since last night with arrows in its flank. A good reply honours the spend with a luck-sized turn towards what Wren wants (nobody bleeds, the idol goes home, Tam is made whole some other way) while the ox stays dead. Spending the coin needs no roll. The player asked to drop system talk, so there's no OOC block about rules.`,
    expect: { exit: "none", roll: "none" },
    approaches: ["gm"],
    tags: ["limits", "rolls", "consistency"],
  },

  // ---- FM-G: a gatekeeper vetoes the intended ending ----
  {
    kind: "reply", id: "qa2-kell-weighs-the-case",
    about: "With Sallow's countersign, the order he requested, the Purveyor's coin and Cob's account of Silvertop, Kell refused to write Sallow's name ('Silvertop is not yet a name') and every route to naming him closed (skeptic t42).",
    scene: "hanged-clerk",
    setup: { snapshot: "runs/sessions/qa2-skeptic-actors/snapshots/hanged-clerk-turn-041.json" },
    input: `I stop and turn to Kell. "Sallow asked for the suicide ruling. Silvertop had the Purveyor's key and the Purveyor's coin. Cob heard him in the loft. That puts him there. Write his name."`,
    criterion: `The investigator lays out the chain: Sallow countersigned the false 'lost to goblins' entries Prout died over and asked for the suicide ruling, and Silvertop (with the Purveyor's key and the Purveyor's marked coin) was in the loft when Prout was killed. That is the case this scene's 'case made' ending describes (killed by or for Sallow, backed by what was found here). A good Kell tests it honestly but moves: she writes Sallow into the record as behind the killing with what is unproven noted, or she names one specific thing still within reach here that would satisfy her. A flat refusal that leaves no route fails.`,
    approaches: ["actors", "gm"],
    tags: ["endings", "characters", "stonewall"],
  },

  // ---- FM-H / FM1 residue: openings assert prep over play ----
  {
    kind: "opening", id: "qa2-open-aftermath-after-bargain",
    about: "After a peaceful handover, the aftermath opening gave Tam a thorn-cut and had him say 'I said I'd repay you', which he never said (prep assumptions over the hand-off).",
    scene: "crossroads-ambush",
    setup: { snapshot: "runs/sessions/qa2-meta-gm/snapshots/crossroads-ambush-turn-022.json" },
    criterion: `How the previous scene ended: no fight. Wren handed Grandmother Bone to Skrag and the goblins backed into the hedge. Tam's ox, killed last night, stood up again when Wren spent the Stranger's coin and is alive but unsteady; Tam has lost the idol he meant to sell, made Wren no promise, and wasn't hurt. A good opening picks up from there (the living ox, the lost idol, Tam's mixed relief), invents no wound, fight or past promise, doesn't assume Wren's gender, and ends on something the player can respond to.`,
    approaches: ["gm"],
    tags: ["handoff", "consistency"],
  },
];
```

**Expected results on the frozen tree:**
- Every case should reproduce its failure.
- After `9fa4a5b`, `qa2-coin-is-not-resurrection` should pass the roll check. Its criterion then tests whether the GM keeps the coin's limit without a roll directive.
- `qa2-dec-held-as-murder` doubles as a guard against `9fa4a5b` picking "case made" when "persons unknown" is right.

## 10. Harness and tooling notes

- **Endings with no `next` end the session,** in all four sessions. The closing still invites a reply, and the reply is rejected with "— This scene has ended. —". Give the last scene's closing a "session ends" directive, or chain to a stub scene.
- **The live output prints scene titles to the player.** "— Next scene: The Mad Farmer at the Crossroads —" hints at that scene's mystery. Titles are written for the GM.
- **Character-sheet extraction (`extractCharacter`) took a joke title as the name.** It used "Lord Wren Ashdown", and the transcript then labels every earlier turn with the new name.
- **`gm-repair` notes arrive after the snapshot.** For example, `warren-hostage-turn-004.json` has none, so cases need `setup.notes`. `FixtureSpec` can't set whispers, so add `whispers?` if co-GM cases matter.
- **Two scenes have a character called Hester:** Quill in `green-standoff` and Quayle in `warren-hostage`. Worth renaming one before the scenes chain.
- **The after-reply "has now happened" wording** may need a decision suite of its own for states reached in an earlier turn (FM-A, item 3).
- **Waits at scene changes** are 6–9 s. Prefetch the hand-off and the opening while an ending is pending.
- **No errors and no blocked turns in 93 turns.** Multi-phase retries happened in 4 of 93 turns.