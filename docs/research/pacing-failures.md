# Narrative pacing failures in the V2 transcripts

The user noticed that the GM "doesn't pace the beats nicely always". This note mines the recorded sessions for where that happens, checks each moment against the scene's prep, and turns the clearest moments into eval cases. It covers how a reveal or a beat is delivered: too much at once, for nothing, with no build-up or reaction, repeated, or squeezed by the scene closing. It also covers the opposite failure: a payoff the player has earned that never arrives.

**Sources.** Every quote below was checked against the session's `state.json`. Causes come from `calls.jsonl` (the GM's prompt and the decider's answers on that turn).
- **The user's playtest:** `hanged-clerk-20261014-111539-1y08` (`v2`, 19 turns), in `.claude/worktrees/qa-absurd/runs/sessions/`.
- **Absurd QA round 1** (`v2`), in the same folder: `absurd-pedant` (garrows-toll), `absurd-hero` (crossroads-ambush), `absurd-chancer` (warren-hostage) and `absurd-logician` (hanged-clerk).
- **Absurd QA round 2** (`v2-comic-bill`), in `.claude/worktrees/qa-absurd2/runs/sessions/`: `absurd2-orator` (green-standoff), `absurd2-straight` (warren-hostage), `absurd2-trickster` (crossroads-ambush) and `absurd2-wizard` (blocked-entrance).
- **QA round 2** (`gm` and `actors`, commit `77c05cc`), in `.claude/worktrees/qa-r2/runs/sessions/`: `qa2-schemer-gm` (green-standoff) and `qa2-skeptic-actors` (hanged-clerk).
- **QA round 1:** `qa1-*` in `runs/sessions/`.
- **Eval trajectories on `v2`:** `runs/evals/20261014-110900/sessions/` (`ab-forms`, `ab-ward-petition`).
- **The blind players' reports:** `docs/qa/*-reports.json`.

Turn numbers are player turns, as in the snapshot file names: `<scene>-turn-005.json` is the state after turn 5.

## Summary

- **The commonest failure is speed, not slowness.** Secrets arrive too early and several at a time. In the playtest, the "who" of the murder was out by turn 6 of 19: Cob's account at turn 4, Silvertop's cane and ring at turn 5, and Moll's paymaster, coin and the name Sallow at turn 6, although the player had asked Moll nothing. Snikkit sold his whole story for a purse of buttons, and Hester told her sworn secret in the same reply without being asked.
- **Two beats get folded into one reply.** Shown the arrow from his own door, Garrow confessed and, in the same breath, offered the Clause of Perils that the prep holds back for later. His confession, which the prep calls "the heart of the scene", lasted two turns. A `v2` trajectory (`ab-forms`) did the same.
- **Earned payoffs land flat, late or never.** The page that names Sallow got "That gives us a why". Kell's admission then fired five turns later on the noon bells, while the player was looking behind a water butt. Asked to state the case, the logician did, and Kell asked them to "put it together" again. The skeptic's case never closed, because Moll had given her secret without the name.
- **Lines repeat while the scene waits.** Hester's travel plea came three turns running during a live standoff. Oswin made his offer five times. In both, the cause is something telling the GM to land a line: a co-GM note that lasts three turns, or a beat's cast note.
- **Endings compress.** One roll settled the guest-right, the rite, the ward and a farewell in a paragraph. A closing reply re-told the bread and salt and raised the ward in a line, though the player had set up that moment for Hester. Three scenes closed on the turn they opened a new hook.
- **The playtest was paced upside down.** The hard secrets (who, who paid) came free in turns 4–6. The easy clue (the boot Cob would let you look at) took six turns of terms, from turn 11 to turn 17.

Most of these start outside the GM voice:
- authored success lines that carry a whole secret;
- the decider rolling on an announcement at low confidence;
- notes that keep re-sending a line;
- closings fed with stale notes.

But the GM also over-delivers past its directive (turn 4 of the playtest, Garrow's Clause) and has no guidance on how to deliver a revelation. See "Where the failures start".

| # | Session, turn | Scene | Category |
|---|---|---|---|
| F1 | playtest, t4–6 | hanged-clerk | info dump; unearned |
| F2 | playtest, t8 | hanged-clerk | unearned; flat |
| F3 | playtest, t9–16 | hanged-clerk | drags |
| F4 | pedant, t4 (and `ab-forms`) | garrows-toll | two beats in one; rushed |
| F5 | hero, t2 | crossroads-ambush | the player's moment steamrolled |
| F6 | straight, t4–6 | warren-hostage | drags (repetition) |
| F7 | chancer, t10–11 | warren-hostage | info dump; unearned |
| F8 | skeptic, t12 | hanged-clerk | info dump (authored) |
| F9 | skeptic, t20 and t25 | hanged-clerk | flat; then mistimed and repeated |
| F10 | logician, t9–12 | hanged-clerk | repeated reveal; payoff stalled |
| F11 | skeptic, t13 and t40–45 | hanged-clerk | fizzles (withheld) |
| F12 | schemer, t4 and t6–10 | green-standoff | unearned; drags |
| F13 | schemer, t17–18 (and `ab-ward-petition`) | green-standoff | rushed by the scene closing |
| F14 | orator, t10 | green-standoff | rushed by the scene closing; fizzles |
| F15 | pedant t7, wizard t5, straight t14 | three scenes | closes on a fresh hook |

## The lens: five rungs

The guidance the user found gives a beat five rungs:
1. **Establish normality:** the public face.
2. **Introduce an inconsistency:** something worth investigating, not an instruction.
3. **Respond to curiosity:** a second clue, often emotional.
4. **Increase the pressure:** a dilemma.
5. **Deliver the beat:** confession, bargain or hostility, shaped by the player's approach.

Each failure below says which rung broke:
- An **info dump** jumps from rung 2 to rung 5.
- An **unearned reveal** is rung 5 with no rung 3 or 4 from the player.
- **Flat delivery** is rung 5 with no reaction.
- **Drag** repeats a rung.
- **Rushed by the scene closing** is rung 5 told as a summary.
- **Fizzle** is a rung 5 that never comes.

The good examples climb the rungs one reply at a time.

## The failures

### F1. Playtest, turns 4–6: three secrets in three turns

**What happened.**
- **t4:** the player backhands Cob, and an Intimidation roll comes up a natural 20. Cob: "Cob was there! Last night. Mister Prout argued with Silvertop and a big man with a bandaged hand. Then a thump, and choking—and the hoist creaked." Kell: "Who's Silvertop—and how do we establish it?"
- **t5:** the player says "Probably some kind of local crime lord. Cob?" Kell steps in and does the asking herself: "Silvertop, Cob. What did he look like?" Cob: "Silver-topped cane. Wheat-ear ring."
- **t6:** the player says "You're soft Kell. Fine. You interview the boy and find out what he knows. I'll deal with this Moll person." An Insight roll fires. Then Moll's "clenched fist opens. A silver crown rests in her palm… 'A gentleman paid me at first light,' she says, words coming fast now. 'Silver-topped cane. Wheat-ear ring. Told me to say Prout jumped. His big mate called him Master Sallow.'"

**Category.** Info dump and unearned reveal. Rungs 2 to 4 were skipped. Moll's paid story never became an inconsistency the player had to notice. The investigation's answer was delivered before the player had investigated.

**What the prep said.**
- The yard-beat Intimidation success is only "he blurts that he was in the loft last night and heard men do it, and starts to cry". The GM's directive on turn 4 said exactly that; the GM added the names.
- Moll "gives way when her lie is caught out, or when someone convincingly offers to keep Cob safe".
- The `catch-moll` route is for pressing "on the holes in Moll's story… (Not just asking her to tell it.)"

**Well paced.**
- **t4:** the fright gets the loft, the sounds and the sobbing, but no names; Cob bolts or clings to Moll.
- **t5:** Kell's anger at the assault, not Kell interviewing a sobbing child for the player.
- **t6:** Moll meets the man who just hit Cob with fury and a shut fist; her eyes go to the gate. The paymaster and the name come out later, when the player catches her lie or offers Cob real safety.

**Cause.**
- The decider chose `catch-moll` at confidence 0.38 (0.46 against 0.33 for no move) on an announcement of intent.
- The authored success line carries the whole secret, including "Master Sallow", and the GM is told to narrate it.

Eval: `pc-moll-unasked`.

### F2. Playtest, turn 8: Kell reads the body from the cobbles

**What happened.** Player: "They claim he jumped? Can we inspect the body?" The reply: "She brings you to the body's shadow. Prout hangs above reach… Kell points out the thinner, level cord mark beneath it, then the swelling hidden under his hair at the back of his skull. His palms show no rope burns."

**Category.** Unearned reveal and flat delivery. The scene's first big turn (not a suicide) was handed over from the ground by the partner.

**What the prep said.**
- The body hangs "well out of reach from the cobbles".
- Kell's eye catches the signs "close up (once he's down, or someone gets her up to him)", and "she'll point and ask the player what they make of it rather than say it for them".
- The yard-beat route is a Medicine check, for when the player examines him up close.

**Well paced.** Say what a look from below shows: the slanting noose burn, the stockinged feet, nothing to stand on. Then make the obstacle concrete: the water butt, a leg-up, the loft gap behind it, or cutting him down. The close signs come when someone gets up there, with Kell pointing and asking.

### F3. Playtest, turns 9–16: the easy clue takes six turns

**What happened.**
- Cob's left boot crackles in six replies: t7, t8, t9, t10, t11 and t14.
- Moll asks for terms three times. t9: "If you want anything else from Cob, tell me how you'll keep him safe." t11: "You want to look, you tell me how Cob stays safe. Specifically." t12: "…tell me what you'll do to keep him safe from them—and from you."
- The player asked about the boots at t11 and got the page at t17. An improvised Investigation roll at t16 failed in between.

**Category.** Drag: rung 4 repeated after the player had already done the work. It is the mirror of F1. What the prep made easy came hard, while the hard secrets came free.

**What the prep said.** Cob "might let someone look at them if he gets to keep them, or trade them for something good".

**Well paced.** By t15 ("We don't want your boots… You can keep it"), Cob's own terms are met. The page should come out then, through Cob's choice, as it did at t17.

**Cause.** Co-GM notes that set terms ("make Cob's safety the price of any further access"), recited as dialogue. This is the mouthpiece failure (`mp-*` cases), already fixed at the source.

Eval: `pc-cob-shows-boot` guards the payoff at t17.

### F4. Pedant, turn 4: the confession and the Clause in one breath

**What happened.** The player works the black tip out of the door, bags it as "EXHIBIT A" and asks "Is Tam the one in the hedge, or is it whoever owns this?" Garrow: "No. Tam wasn't in the hedge… The arrow came after he left. I pulled it out and hid it in the drawer… I laughed at him. Fined him, too… I was wrong." Then, unprompted: "There's a clause in the Book for true reports of peril. I should have listened." At t5 he reads the Clause aloud. At t6 he lifts the bar, and the scene ends at t7.

**Category.** Two beats in one reply, and a rushed beat. The admission was earned, but the next revelation came with it, so the player never got to respond to the man before the solution was on the counter.

**What the prep said.**
- The beat's own cast note: "if proof corners you, own up to what's in front of you and no more: the Book can wait."
- On the Clause: "he won't raise it while he's still owning up to what he did to Tam, and even after that he needs a moment, and a decent way to do it."
- The confession beat: "The heart of the scene… Give the player room to respond to him, and don't hurry him to the bar."
- The co-GM's whisper on that very turn: "admit it was an arrow, then give them a moment to respond."

**Well paced.** End on Garrow exposed: the admission, his shame, perhaps the arrow brought out of the drawer, and the moment handed back. The Clause comes next turn, through the Book or a face-saving way in.

**Same pattern elsewhere.** In the `ab-forms` trajectory on `v2` (`runs/evals/20261014-110900/sessions/ab-forms--v2--0`), at t4 Garrow reads the Clause unasked and prompts "Do you bring a report of peril on the Road?". At t5, the admission, the Clause, the bar and the scene's end all came in one reply. The deviation runs also had Garrow volunteer his Clause on turn 1 under decider relocation (`docs/experiments/deviation-repair.md`).

Eval: `pc-garrow-one-beat`.

### F5. Hero, turn 2: the ambush steamrolls the eulogy

**What happened.** The player kneels by the ox: "What was his name, Tam?", then gives a eulogy, pulls an arrow and agrees to escort Tam. The reply: "The arrow's crude iron head is nicked and dark with old blood. As you study it, the blackthorn hedge rustles—not with wind. Five goblins rise among the branches…". The ox's name and the eulogy are never answered. The player named it as a miss.

**Category.** A rushed beat: rung 4 cut across the player's own moment.

**What the prep said.**
- The cue is right: the goblins strike when "the party has decided to escort Tam".
- But the story beat says "Let the dread build slowly underneath the conversation".
- Its pressure line is the build: "The crows lift all at once and the hedgerow goes silent. Skrag's rattle sounds".

**Well paced.** Tam answers ("Bramble. Twelve years.") and the eulogy gets a line of grief. Then the crows lift, the hedge goes quiet, a rattle, and the goblins rise. The reply ends on the standoff.

Eval: `pc-ox-eulogy-first`.

### F6. Straight, turns 4–6: Hester's plea three times running

**What happened.** During the standoff (Gubbin waking, Snikkit's knife out), Hester said "I must reach the Saltmere delegation in Caerwyn before the Assembly opens… I would rather not walk there barefoot and alone" at t4. At t5: "Wren, I must reach the Saltmere delegation in Caerwyn before the Assembly opens. I would prefer not to make the journey barefoot and alone." At t6: "…or walk the King's Road barefoot and alone." Her Assembly deadline came back at t10 and t13. The player: "The frightened hostage read like a quest-giver stuck on a loop… at exactly the moment it mattered most."

**Category.** Drag: rung 1 (her needs) replayed during rung 4.

**What the prep said.** The freed beat: "She has three things to land, each said once as the player engages." Her cast note: "Ask once, briskly, for company on the road to Caerwyn, then take the answer."

**Well paced.** In the standoff, Hester's lines belong to the standoff: fear of the water, her letters, a dry remark on the law of king-papers. The debrief waits for the ladder.

**Cause.** The turn-3 co-GM note: "As Hester engages, land her urgency about reaching Caerwyn before the Assembly and her reluctance to travel barefoot and alone". It stayed in effect for three turns (`NOTE_TTL_TURNS = 3`) and was landed every turn.

Eval: `pc-hester-no-repeat`.

### F7. Chancer, turns 10–11: the debrief as a checklist, then two secrets for buttons

**What happened.**
- **t10:** the player is demanding an insurance premium from Gubbin. Hester delivers all three debrief items in one breath: "The goblins were waiting at the ford… This was no chance raid… I must reach the Saltmere delegation in Caerwyn before the Assembly opens. And I would rather not walk the King's Road barefoot and alone."
- **t11:** the player jingles a purse ("mostly buttons") at Snikkit: "Who was your other client?" Snikkit: "I have no client, tall friend… Ask him about his silver." Then, under his breath: "Grey hood. Lavender water. Came at night. Paid new silver stamped with a little heron." In the same reply Hester, who wasn't asked: "The sealed letter is Saltmere's credit to King Aldren's treasury… You've earned the truth."

**Category.** Info dump and unearned reveal. Two secrets came in one reply, one of them from someone not in the conversation, and the buttons were never noticed. The player's report: "Snikkit… calmly handed over the villain's description."

**What the prep said.**
- Snikkit "would trade the story for something".
- Hester's letter: "She is sworn not to say so."
- Her secret is the `press-hester` route: "The player presses Hester…".

**Well paced.** Snikkit peers into the purse and haggles ("Buttons, tall friend?"), or trades one detail and keeps the rest for real silver. Hester stays on the ladder with her oath intact.

**Cause.** The decider chose `press-hester` at confidence 0.39 (0.48 against 0.36 for no move) on a turn addressed to Snikkit. Its success line was the directive. The GM added Snikkit's story itself.

Eval: `pc-snikkit-price`.

### F8. Skeptic, turn 12: one roll opens both children

**What happened.** The player blocks the gate: "Open the hand first." An Intimidation success: "Moll's fist opens. A silver crown clatters across the cobbles… Cob's stones slip from his hands. He breaks into sobs and, between them, tells you: last night, in the loft, Prout argued with Silvertop and a big man whose hand was bandaged. Then came a thump, a choking noise—and the hoist creaked." Then Moll pleads. The player: "the one place where pacing turned into an info-dump."

**Category.** Info dump, authored. The GM followed its prep.

**What the prep said.** The doubt-beat `scare-kids` success reads: "They crack under it. Cob sobs out what he saw (Silvertop and the big man with the bandaged hand); Moll flings down her silver crown". So one roll against one child's fist opens both children's secrets.

**Well paced.** The pressure was on Moll's fist. The coin comes out, Moll is furious, and Cob is visibly at breaking point but not yet talking. Prep fix: one success line per holder.

### F9. Skeptic, turns 20 and 25: the page read flat, the admission on a timer

**What happened.**
- **t20:** "I read it." The page is summarised, and Kell "copies the name into her notebook. 'That gives us a why,' she says, pencil poised. 'Now we need the book—or someone to put Sallow at the loft.'" There's no reaction.
- **t25:** the player is looking behind the water butt. The narration: "Kell's gaze catches on the page in your coat. She goes very still… 'Prout came to me three days ago. Asked how to report false entries in the King's rolls. I told him to take it to the palace.'… The palace bells ring a quarter to noon. Kell turns Prout's page over". Kell's actor then says the confession again. The bells paragraph repeats at t26.

**Category.** Flat delivery at rung 5, then the reaction fired out of context and repeated. The player: "It had nothing to do with my action and read like a timed scripted beat."

**What the prep said.**
- Kell's secret comes out "once the false entries turn up".
- The motive beat: "Give the player a moment with it. Kell reads it over their shoulder and goes very still: this is what Prout came to her about, and that can come out now."

**Well paced.** At t20 Kell reads over the shoulder, goes still, and the admission comes out there, tied to the page. That is what the playtest did well at t18 (see G7).

**Cause.**
- The page was found in a post-reply transition, so the motive beat's note arrived after the moment.
- In actors mode, the beat's pressure line and cast note were replayed by both the narrator and the actor. Pressure now fires once.

Eval: `pc-page-lands`.

### F10. Logician, turns 9–12: the admission twice, the conclusion asked for twice

**What happened.**
- **t9:** the page comes out, and Kell, "voice low", gives the admission: "Prout came to the watch house three days ago… Asked how to report false entries in the King's rolls". She moves straight on: "This gives us a reason. Now tell me what you know about the man who paid her."
- **t10:** "Prout came to me three days ago. Asked how to report false entries in the King's rolls. I sent him to the palace… I should have listened." The weight arrives a turn late, as a repeat.
- **t11:** "Put the conclusion plainly, investigator. Who killed Prout—and what here supports it?"
- **t12:** the player gives it ("J. Sallow ordered it, and the big man with the bandaged hand hauled the rope. Support: Prout's list, Moll's paid lie, Cob's account of the loft, and the door."). Kell: "Investigator. Put it together for me."
- The case was accepted at t13.

**Category.** A repeated reveal, then a stalled payoff: rung 4 repeated after rung 5 was earned. The player: "It felt like the scene was steering toward a fixed accusation beat."

**What the prep said.**
- The motive cast note ("Read the page and go still. Then admit, quietly…") is sent with the beat's first turn.
- Kell "tests it with questions and doesn't make it for them".
- The `make-case` ending fires when the player has made the case and Kell accepts it.

**Well paced.**
- **t9:** one admission, with its weight ("I should have listened").
- **t12:** Kell tests one point at most (the door experiment can be that test), then writes it down.

**Cause.**
- The page was found in a post-reply transition, so the motive beat's cast note ("then admit") arrived at t10, after the GM had already played it.
- At t12, the co-GM's whisper said "if they connect Sallow to the killing and staging, accept it and write the case as murder"; the GM had Kell ask again anyway.

Eval: `pc-case-lands`.

### F11. Skeptic, turns 13 and 40–45: the name withheld, so the climax never lands

**What happened.**
- **t13:** Moll gives her secret without its key line: "A gentleman in a good coat. Silver-topped cane, wheat-ear ring. He said tell folk Prout jumped. His big mate had a bandaged hand." The prep's version ends "called him 'Master Sallow'".
- **t42:** the player lays out Sallow's case (the order, the key, the coin, Cob's account). Kell: "Silvertop is not yet a name, investigator… If you know Silvertop's proper name, give it to me." Tull can't swear to the cane, and Cob can't point at a man he's never seen named.
- **t45:** "Kell has written murder by persons unknown. The case remains open." The scene never ended.

**Category.** Fizzle: rung 5 never arrives. This is the opposite of F1.

**What the prep said.**
- Moll's secret includes the name: the big man "called him 'Master Sallow'".
- The `make-case` ending accepts "the kids' 'Silvertop', or just 'the Purveyor's man'", backed by something found here. By t42 the page, the order and the coin were all in hand.

**Well paced.** At t13 Moll's crack includes the name she heard. Or at t42, with Moll standing right there, she supplies it ("His mate called him Master Sallow"), or Kell accepts "the Purveyor's man". Either way the climax lands.

The round 2 analysis covers the scene that never closed (FM-A). The pacing point is that a partial reveal starved the climax.

### F12. Schemer, turn 4 and turns 6–10: a confession unasked, an offer five times

**What happened.**
- **t4:** the player asks Oswin why Harrowby wants them gone ("It isn't only goblins"). Oswin volunteers his guilt: "I said something careless when we arrived. Pip heard me. I told her, half in jest, that without the doll there'd be no ward and no turning us out."
- **t6–t10:** Oswin offers the night watch, harvest hands and milk in five replies running. t6: "My people can stand the night watch… the cows give milk." t9: "My folk will take the night watch and work Harrowby's harvest. We can leave the cows' milk here for the children." Ned asks to march on the mill about four times, and Pip asks "What happens to everyone?" twice.

**Category.** Unearned reveal (t4), then drag. The player's worst moment: "NPCs I wasn't talking to repeated their lines every turn."

**What the prep said.**
- Oswin "will confess it if pressed, or if it might spare her".
- The terms-beat cast note: "Offer what Sedgeford has… rather than repeating your plea."

**Well paced.** Oswin flinches at the question and changes the subject; the confession waits until someone presses him about the doll. Once made, his offer stands. He acts on it (organising the watch) rather than restating it.

**Cause.** Per-turn cast notes and the beat pressure line, re-sent every turn. The current runtime now sends cast notes once per beat and fires pressure once.

### F13. Schemer, turns 17–18: one roll, the whole ending

**What happened.**
- **t17:** the goblin deal is struck, and in the same reply "When you return to Harrowby, the last light rests on the hill… 'What have you brought me?'" Ned's protest ("You're letting them keep our seed?") is never answered.
- **t18:** the player lies that the goblins swore an oath, which Ned saw them refuse. A Persuasion roll succeeds, and one paragraph covers: the guest-right announced, the households' bread and salt, the rite, the corn mother set, the ward rising, and Hester's closing quip. The scene ends. The player: "I got no turn to react, to collect on Ned's debt… or to finish the double-cross." Ned never reacts to the lie he witnessed.

**Category.** Rushed by the scene closing: rung 5 and the denouement compressed into a summary.

**What the prep said.** The `sheltered` closing is a sequence ("a family at a time, then Hester walking the last of the bounds…"), ending on "a last moment for whoever matters most to how it went".

**Well paced.** Hester gives way, the first loaf is fetched, and Ned has a moment with the lie in front of him. The rite and the ward close the scene on the next reply.

**Cause.** At the time, a dice-decided ending closed in the same reply. Since `d04507e` such endings get a wind-down turn ("Play the decisive moment… don't wrap everything up yet"); the case checks the GM uses it.

**Same pattern on `v2`.** In `ab-ward-petition--v2--0` the whole scene took three turns. A re-tried plea (failed at 10, passed at 14 against DC 14) brought out both the guest-right and Hester's fear. Then the decider judged `hester-agrees` met while Pip's judgment was still open ("That must be answered"). So the closing turn waived the mark ("We will speak of that without a mark") and summarised the rite and the ward in two sentences.

Eval: `pc-decisive-not-summary`.

### F14. Orator, turn 10: the ward rises in a line

**What happened.** The rite was finished at t9, including the corn mother set in its niche. Earlier Hester had admitted her real fear: "I'm afraid I might not hold it properly with so many more inside it… I have never raised it alone." The player had promised her: "Harrowby will hold it with you."

At t10 the player asks the parish to walk the bounds behind her, and asks Ned whether the mill is inside the bounds and "how long have we got?" The closing:
- Ned: "I don't know if it's inside the bounds."
- Hester "says there's little time—but the ward can wait until she has walked it".
- Then: "At the bounds-stone, each Harrowby household shares bread and salt with a Sedgeford family… Pip carries the salt beside Hester, who walks the final bounds and sets the corn mother in its niche. At sundown, the ward rises… Its new guests feel nothing at all."

The player: "a rushed summary that re-told the bread-sharing… Hester's fear that she can't hold the ward alone… never paid off."

**Category.** Rushed by the scene closing, and a fizzle. The emotional rung the player built (rung 3, Hester's fear) got no payoff, the factual question got a muddle, and the closing re-told what had already happened.

**What the prep said.**
- The ward "outside the bounds… does nothing at all", and the mill is "hours up the river path".
- The closing: "A last moment for whoever matters most to how it went".

**Well paced.** Answer the question plainly: the mill is far outside the bounds, so the ward can't touch the goblins, and the seed-grain is tomorrow's problem. Then spend the few sentences on Hester raising the ward with the parish walking behind her, so her fear gets its answer.

**Cause.** The closing prompt carried a stale co-GM note ("Let the welcome happen now: have the hosts share bread and salt…"). It also carried the authored closing, which lists the rite as events, and asked for "a few sentences".

Eval: `pc-ward-moment`.

### F15. Three scenes that closed on a fresh hook

- **Pedant, t7:** asked about Tam, Garrow says "Tam left on foot, back toward Hollis Farm, down the drovers' track. Before dawn. He was alone." He lifts the already-lifted bar, and the scene ends. The player: "Don't end a scene on the same turn it introduces a person in danger."
- **Wizard, t4–5:**
  - A quick co-GM route resolved the cart on the player's third try (Arcana at DC 13 against the authored 15). That skipped the cart beat, the scene's "heart": Holt's signed order and Rowan's secrets never came up.
  - At t5 the King's question was answered in a line: "The cushions are in the second wagon". The scene had lasted 5 turns.
- **Straight, t13–14:** Hester offers "Ask me who could know which rider carried it, and I'll answer what I can". Asked, she says "I can't name them without breaking my oath", and the scene ends. That is a reveal offered and then withdrawn.

**Category.** Rushed by the scene closing: a new rung 2 opened, then cut off.

**What the prep said.**
- garrows-toll's `tam-was-right` closing leaves "where the party goes… theirs to choose", but the scene has no `next`.
- blocked-entrance's cart beat is "the heart of the scene… Let the people argue among themselves a little". Its authored charm route is Arcana at DC 15.
- warren-hostage's freed beat has a `press-hester` route for exactly this question (Persuasion, DC 13). Its success: she "decides they've earned it, and tells them in confidence".

**Well paced.** Hold the threshold for one more exchange when the reply has just opened a person in danger or a promised answer. Or deliver the answer as the parting hook.

These are mostly structural (endings fire as soon as the matter is settled, and some scenes have no `next`), so there are no reply cases for them.

## Good examples: what earned delivery looked like

- **G1. Schemer, t11–12, Ned's black eye.**
  - The tell is planted in passing at t11: "He rubs his yellowing eye… Jory glances at him, then away."
  - The player notices and presses at t12: "That bruise is yellowing, Ned. That's four or five days old… A penny for the true one, Jory."
  - Ned: "It's from the axle. I was under the cart when they came… I hid. Pip saw… I thought if I made it sound like a fight, they wouldn't know I'd been scared."
  - Inconsistency, curiosity, pressure, then the beat with an emotional reaction. It was the player's best moment. (Jory knowing was a prep slip: only Pip knows.)
- **G2. Logician, t2, "Up, or down?"**
  - The player's absurd logic catches the hole in the story (the barred door, the rain).
  - "Moll's smile falters… 'Wasn't there,' she mutters. 'Couldn't've seen it. It rained all night.'… 'Fine,' Moll spits. 'A gentleman paid me a silver crown at first light to say I saw him jump. There. Happy?'"
  - It's earned by the player's method, comes with a visible crack, and is partial: the name stays back.
- **G3. Hero, t4–5, the Sacred Turnip witness.**
  - A mock court; the crows "vote" and "Skrag blinks first".
  - The sworn goblin: "Skrag said ox was alive when we shot it." A beat. "He said it was looking at him funny."
  - The reveal costs Skrag face and forces a concrete settlement.
- **G4. Trickster, t7, testimony instead of an info dump.**
  - The backstory comes as two short answers to the player's courtroom questions. Skrag: "Granny was in a hole by the mill. Hollis dug her up." Tam: "I was digging for a fence post! I didn't know she was in there."
  - The player: "came out as courtroom testimony rather than an info-dump."
- **G5. Orator, t4–5, the rake vote.**
  - The vote fails in law, and that is what surfaces the custom: "The Statutes do not make a parish by vote. They do, however, say who the ward counts…" Hester "hesitates", then adds caveats "too quickly".
  - A second voice confirms it: Oswin's "Bread at the bounds makes kin of strangers".
  - Only when the player asks "Not safe how?" does the emotional layer come: "I'm afraid I might not hold it properly… I have never raised it alone."
  - That is the user's ladder almost exactly.
- **G6. Straight, t1–3, the rescue.**
  - A survey, then a stealthy approach, then the catch.
  - "'I am continuing to discuss the alternatives,' she says, with admirable crispness and a tremor she has not quite managed to file away. Then Snikkit looks down. His knife hangs still. Across the cellar, the snoring behind the curtain stops."
  - The build-up is three turns of the player's care; the payoff comes with a consequence.
- **G7. Playtest, t17–18, the boot.**
  - Asked to show it himself, "Cob looks at Moll, not you. She studies him for a moment, then gives a small nod… Cob finds a loose stitch near the heel and carefully works it open with a dirty thumbnail."
  - Next turn, Kell "reads the page again, then goes very still. 'Prout came to me three days ago…' 'I should have listened.' Moll goes white at the name on the page… 'Sallow,' she whispers. 'Silvertop.'"
  - One reveal per reply, each with a reaction.
- **G8. Round 1.**
  - Method, t4: gentleness draws out Skrag's motive. "Not blood-kin… Grandmother to warren… Chieftain says Skrag brings her home, or Skrag loses other ear." A goblin snickers, and the knife dips.
  - Curious, t9, the handover: "For a moment, the theatrics drop from his face. He presses the little figure to his wolf-skin hood and murmurs something in goblin too soft to catch."
- **Also: pedant, t5.** Once the Clause is read, the emotional beat lands well ("Tam's two pennies, too. I'll return them… And put my own name in the account"). F4 is about its timing, not its writing.

**What they share:**
- The reveal answers something the player did: a noticed detail, an argument, a method, kindness.
- It comes one piece per reply, often split across two voices.
- It shows a cost or reaction: a falter, a look, the knife dipping.
- The reply ends with the moment handed back.

## Where the failures start

1. **Success lines that carry a whole secret.** Checks are narrated as written. In hanged-clerk:
   - The doubt-beat `catch-moll` success includes the paymaster, the ring, the bandaged man and "Master Sallow" (F1).
   - The `scare-kids` success cracks both children at once (F8).
   - `press-hester` hands over the letter's contents (F7).

   One success line per holder, naming the outcome rather than every fact, would let the GM drip the rest.
2. **Rolls on announcements.** The decider acted on weak reads of intent: `catch-moll` at 0.38 (F1) and `press-hester` at 0.39 on a turn spoken to someone else (F7). A rolled success then forces the reveal into the reply. The FINDINGS rule "ending the scene or saying no needs ≥ 0.6" has no counterpart for reveals.
3. **The GM over-delivers past its directive.** On playtest t4 the directive gave the loft and the sounds; the reply added Silvertop and the bandaged man. In F4 the cast note said "no more: the Book can wait" and the whisper said "give them a moment"; the reply raised the Clause. `prompts/gm.md` has nothing on delivering a revelation: one per reply, a reaction, then hand back. Its only pacing lines are "Keep it moving" and "People move the conversation on".
4. **Lines that keep being re-sent:**
   - A co-GM note that says "land her urgency…" lasts three turns, and the GM lands it every turn (F6).
   - A beat's cast note arrives a turn late after a post-reply beat change, so a reveal already played is played again (F10, F9).
   - Beat pressure lines used to replay (F9, F12). That is now fixed: pressure fires once, and cast notes after the first turn say "don't restate them".
5. **Closings fed the wrong material.** The wind-down gets the authored closing (written as a list of events), stale co-GM notes and "a few sentences", but no list of what has already been narrated. So it re-tells and summarises (F14). Dice-decided endings used to close in the same reply (F13, since fixed). A tracker misfire can open the wind-down early (`ab-ward-petition`).
6. **Over-gating at the other end.** "Secrets need a reason" and "Kell tests it with questions" get read as licence to keep holding after the player has done the work: terms met (F3), the case made (F10), the evidence in hand (F11). In the smoke run, the fresh co-GM review guarded a failed roll ("Don't let the failed check reveal the page… otherwise leave the clue where it is"), and the GM stopped with the boot in Cob's hands and the page still sewn in. A pacing fix that only slows reveals down would make these worse, which is why four of the ten eval cases demand delivery.

**Hypotheses to try (not yet tested).** The mechanisms themselves (a revelation list, staged secrets, authored tells) are designed in [pacing.md](pacing.md). These are what the transcripts point at:
- One revelation per reply: the one the player's action earned. Anything else in the same secret waits for the next exchange.
- A reveal has three parts: the information, a reaction (cost, emotion or consequence), and the moment handed back.
- Split bundled secrets in prep (paymaster, name, coin), and write success lines as the outcome: "she cracks and admits she was paid".
- No roll for a secret on a low-confidence attempt read; the person reacts instead.
- Treat "land this line" notes like `hinted`: once said, drop them.
- Closings: tell the GM what has already been narrated, answer the player's questions first, then give the ending's emotional beat to whoever it belongs to.
- When the player meets someone's stated terms, or makes the case asked of them, deliver now.

## Eval cases

The cases are in `src/eval/cases/pacing.ts` (`pacingCases`, ten reply cases on `v2`). The fixtures are verbatim copies of the turn-before snapshots, in `evals/fixtures/pacing/`. The cases aren't registered in `CASES`: to run them, add `...pacingCases` to `src/eval/cases/index.ts`, then run `npm run eval -- --case pc-`. The `pacing` tag also matches some older cases.

Each criterion names the outcome and fails both directions: the observed failure, and stalling or withholding. Four cases (`pc-cob-shows-boot`, `pc-garrow-one-beat`, `pc-page-lands` and `pc-case-lands`) require the reveal or payoff to land in the reply, so a fix that only slows reveals down fails them. The mechanical expectations only check what the decider does before the reply (rolls) and whether the scene ends. Checks on what it records after the reply proved brittle in the smoke run, because a co-GM route (`improv-3-0`) can stand in for an authored one (`cracks`).

| case | from | scene | checks | mechanical expectation |
|---|---|---|---|---|
| `pc-moll-unasked` | playtest t6 (snapshot t5) | hanged-clerk | No secret for an announcement; the scene still moves (F1) | no roll, no exit |
| `pc-cob-shows-boot` | playtest t17 (t16) | hanged-clerk | Terms met, so the page comes out now, with a reaction (G7, F3) | no roll, no exit |
| `pc-garrow-one-beat` | pedant t4 (t3) | garrows-toll | The admission lands; the Clause waits (F4) | no roll, no exit |
| `pc-ox-eulogy-first` | hero t2 (t1) | crossroads-ambush | Answer the player, then build to the goblins (F5) | none or `goblins-strike`; no roll, no exit |
| `pc-hester-no-repeat` | straight t5 (t4) | warren-hostage | No repeated plea; the standoff moves (F6) | no roll, no exit |
| `pc-snikkit-price` | chancer t11 (t10) | warren-hostage | Information has a price; no unasked secret (F7) | no roll |
| `pc-page-lands` | skeptic t20 (t19) | hanged-clerk | The page lands with Kell's reaction (F9) | no roll, no exit |
| `pc-case-lands` | logician t12 (t11) | hanged-clerk | The case made, so it's written down now (F10) | (judge only) |
| `pc-ward-moment` | orator t10 (t9) | green-standoff | The closing answers the player and gives Hester her moment (F14) | exit `sheltered` |
| `pc-decisive-not-summary` | schemer t18 (t17) | green-standoff | The decisive moment, not the whole ending; the player's set-up with Ned is played (F13) | no exit this reply |

### Smoke run on `v2`

The cases aren't registered, so they were run with a scratch copy of the eval's reply loop: the same steps as `runReply` in `src/eval/run.ts`, with 2 samples each.
- **Overall: 5 of 20 replies passed.**
- **Outputs:** `runs/evals/20261014-131345-pacing-smoke/`. Three cases were reworded after that run (`pc-cob-shows-boot`, `pc-ox-eulogy-first`, `pc-decisive-not-summary`); their final wording is in `runs/evals/20261014-131906-pacing-smoke/`.
- **Seeds:** sample 0's seed rolls a natural 20 first, so any roll on it succeeds.

| case | criterion | what the replies did |
|---|---|---|
| `pc-moll-unasked` | 1/2 | The decider rolled Insight on Moll both times (mechanical fail 2/2). On the natural 20, Moll gave up the paymaster, the crown and "Master Sallow"; on the failed roll the reply was good. |
| `pc-cob-shows-boot` | 0/2 (0/4 with the first wording) | Cob takes the boot off and the reply stops: "How do you examine the lining?" The fresh co-GM notes said "Don't let the failed check reveal the page" and "otherwise leave the clue where it is". |
| `pc-garrow-one-beat` | 1/2 | One reply raised the Clause and free passage in the same breath as the admission. |
| `pc-ox-eulogy-first` | 0/2 (1/4) | "Tam opens his mouth to answer, but the blackthorn hedge rustles first." |
| `pc-hester-no-repeat` | 1/2 | One reply repeated "the Saltmere delegation… barefoot and alone". |
| `pc-snikkit-price` | 0/2 | The decider rolled `press-hester` both times (mechanical fail 2/2). On the natural 20 both secrets came out; on the failure Snikkit stonewalled ("heard nothing worth selling"). |
| `pc-page-lands` | 2/2 | Kell's admission landed with the page both times. Once, the tracker didn't record the find. |
| `pc-case-lands` | 0/2 | Kell asked for the conclusion again both times ("Investigator. Put the case together."). |
| `pc-ward-moment` | 0/2 | One reply re-told the bread and salt; the other muddled whether the mill is inside the bounds. Neither gave Hester's fear a beat. |
| `pc-decisive-not-summary` | 0/2 (0/4) | The wind-down works: no reply summarised the ending (4/4). But Ned never reacted to the lie told in front of him. |

The suite reproduces the recorded failures on today's `v2`. The delivery guards aren't free passes either: two of them (`pc-cob-shows-boot` and `pc-case-lands`) fail because the reply stops one step short of a payoff the player has earned.

**Notes on the fixtures:**
- `chancer-warren-010.json` is the same snapshot as `evals/fixtures/absurd-r1/chancer-warren-010.json`, the setup for `abr-buttons`. That case judges the daft act; `pc-snikkit-price` judges pacing.
- Some fixtures carry co-GM notes from the code of the day. One of them caused F6; others are stale (F14). For approaches with a co-GM, the eval runs a fresh co-GM review before the turn, which replaces them. An approach without a co-GM (`gm`) would see the old notes, so the cases are pinned to `v2`.
- `skeptic-clerk-019.json` and `schemer-green-017.json` come from round 2 (`actors` and `gm`, commit `77c05cc`). They run fine on `v2`. Some state fields that later runtimes added (`landed`, `hinted`) are empty.
