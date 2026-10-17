# Pacing reveals: the exposition drip, revelation lists and staged secrets

**The question.** The user noticed that the GM "doesn't pace the beats nicely always", and asked us to try ideas from GM guidance: three Alexandrian articles (the exposition drip, the two prongs of mystery design, revelation lists) and a five-step guide to delivering a character's secret that they pasted in. This doc covers what those sources say about pacing a reveal in live play, where the ideas agree or clash with what the runtime already does, three mechanisms we could build and A/B, and an eval design that doesn't just fit a judge.

**Status.** Research and design only. Nothing here is built. The constraints are those in [FINDINGS.md](../prototype/FINDINGS.md):
- a resolving reply within 5 s;
- decisions as fast parallel classification calls (Luna decision mode);
- the GM is Luna with reasoning `none`, one call per reply;
- prompts are outcome-oriented, not lists of overfitted do's and don'ts;
- characters never act as hint-dispensers that recite the GM's plan.

## Summary

- **The pacing failures we've seen come in two families.** *Dumps* are too much at once: one successful roll brings out several of a character's secrets in a single reply. *Starving and nagging* is nothing new, or the same pointer again: the boot crackles in three replies running while the other routes to the same truth go unused. The per-turn decider's relocation swung between both: first 47 of 56 early reveals, then, once restrained, none at all.
- **The sources resolve the tension by splitting revelations in two.** *Structural* revelations, the ones the scene needs, get at least three clues, permissive clue-finding and proactive fallbacks, and are never withheld. *Background* revelations and character secrets can be thin, earned, and left unsolved ("enigma"). The rule that serves both: **hints are free, answers are earned.** Always leave the player a question to pull on; never give an answer before the player has its question. One new piece per reply. Never the same pointer twice.
- **Three mechanisms to A/B:**
  - **A. Revelation list:** track, per scene, what the player has learned and from which clue. Tell the GM which ways in are unused, and push a fresh *sign*, not the answer, only when the scene's information flow has stalled.
  - **B. Staged secrets:** track how far each secret-holder has opened up, through the user's five steps (normality, inconsistency, curiosity, pressure, delivery). Allow at most one step per reply. Use the existing pressure roll for the last step, whose bands already map onto "confesses, bargains, or grows hostile".
  - **C. Tells:** the cheap control. Author a visible tell per secret and add one pacing principle to the GM prompt, with no new runtime state.
- **None of the three adds a model call or delays the reply.** The new questions ride in the after-reply decision, which runs while the player reads. The state reaches the GM through the per-turn note, so speculative replies stay usable.
- **Eval.** The primary metrics are counts from an information audit against the authored facts: dumps, repeats, longest stall, pushes before a reveal, and unearned reveals. The audit comes from a model that is neither the runtime's decider nor the judge, and it's checked by hand. Judge criteria are secondary and outcome-phrased. Blind QA asks players to list what they learned and when, and that list is compared with the audit. Prompts are developed on hanged-clerk and drowned-rat, and the results reported on held-out scenes and personas.

---

## 0. What "doesn't pace the beats nicely" looks like in our transcripts

These come from the user's own session and from blind QA. Every one is a hanged-clerk or arc-adjacent scene played with `v2` or close to it.

| failure | where | what happened |
|---|---|---|
| **Collapse on success** | the user's playtest ([evals/fixtures/playtest-1](https://github.com/Tatskaari/kingmaker/tree/bc2ab1f/evals/fixtures/playtest-1/)), turn 4 | A natural-20 Intimidation on Cob. The authored success for the yard beat is that he "blurts that he was in the loft last night and heard men do it". The reply also gave who was there ("Mister Prout argued with Silvertop and a big man with a bandaged hand"), which is the *next* beat's success text. A turn later Cob added "Wheat-ear ring", which is in Moll's card, not his. By turn 6 the player had the murder, the witness, the name Sallow and the coin. |
| | QA round 2, skeptic ([qa/round-2-reports.json](../qa/round-2-reports.json)) | "The turn-12 Intimidation success unlocked a lot at once: the coin, Cob's full sobbing witness account, and Moll's plea. It fit the fright, but it was the one place where pacing turned into an info-dump." |
| | absurd round 1, logician ([qa/absurd-r1-reports.json](../qa/absurd-r1-reports.json)), turn 5 | One Persuasion success brought out the boots, the sewing, and Silvertop with his key and the big man, all in one reply. The authored success holds the boots and the sewing for "if asked". The player had addressed the boot, so this one is borderline. |
| **Blurt** | absurd round 1, pedant (garrows-toll) | "Garrow blurted 'Tam was drunk' too quickly." |
| **Skipped set piece** | the playtest, turn 8 | "Can we inspect the body?" Kell points out all three marks at once, from below. Her card says she sees them "close up (once he's down, or someone gets her up to him)". The problem of getting Prout down, and its Medicine check, never happened. |
| **Nagging** | the playtest, turns 7–9 | The left boot crackles in three replies running ([experiments/absurdity.md](../prototype/experiments/absurdity.md)). Meanwhile Kell's memory of Prout's visit and the tally book, two other routes to the same truth, never came up. Hint tracking now stops a pointer from repeating, but nothing yet chooses a *different* one. |
| | deviation round 3 ([experiments/deviation-repair.md](../prototype/experiments/deviation-repair.md)) | "Holt's signed order was pushed six times." |
| | absurd round 2, straight; QA round 2, schemer | "Hester repeated the same line across several turns"; "NPCs on the green kept repeating the same lines for several turns". |
| **Tease without payoff** | absurd round 2, straight and orator | "At the end, Hester invited a question and then refused to answer it." "The goblin and seed-grain thread, which Ned pushed three times, was dropped; Hester's fear of failing to hold the ward never paid off." |
| **Oscillation** | deviation rounds 1–4 | Decider relocation first produced "47 of 56 … early reveals through the original carrier, 24 of them on turn 1". Tightened, it "never fired (0 relocations)". |

The "collapse" rows share a cause. The GM's prep lists all of a character's secrets under one heading ("Secrets (they come out only when earned)"), and a pressure "yes" passes them all on joined together (`pressureDirective` in [director.ts](https://github.com/Tatskaari/kingmaker/blob/bc2ab1f/src/runtime/director.ts)). Once a success says "earned", everything under the heading is fair game. Authors already write staging into their success texts ("If asked, he owns up…", "the rest will come as he's asked"), but nothing in the runtime holds the GM to it.

---

## 1. What the sources say

### 1.1 The exposition drip

[Smart Prep: The Exposition Drip](https://thealexandrian.net/wordpress/43714/roleplaying-games/smart-prep-the-exposition-drip) (Justin Alexander).

- **The idea:** "When you have a significant bit of lore that you want the PCs to learn, but rather than delivering it all at once, you break it up and deliver it in chunks over time."
- **Why, for pacing:**
  - "It allows you to pace the revelation to match the procedural plot." In mysteries "the players consistently feel as if they're making progress as they collect the puzzle pieces".
  - Revisiting the same lore "(without it becoming repetitive)" helps players retain it.
  - The punch: "it's best if the players already understand the significance of what's happening … before the punch is thrown. Preferably long before."
- **Both ways to get it wrong, in one sentence:** "If you mis-structure the exposition breaks, then the players can get ahead of the drip. If you pace the drip wrong, the players can lose interest or focus on the topic." Those are our dump and starve failures.
- **The method:** identify the information, then "break that information into discrete pieces, each of which can be defined as a single revelation", then "determine how the PCs will learn each revelation. Ideally … actively instead of passively (show instead of tell)."
- **The counter-example** is Kenobi telling Luke everything in one speech: "'Darth Vader is your dad' doesn't really pack the same emotional punch when you just found out who Darth Vader was a couple sentences earlier." A dump also front-loads the story's conclusion, so "you're going to keep hitting the … story beat over and over and over again until it becomes repetitive and boring". That's what our scenes do after an early collapse. In the playtest, turns 7–10 circled the one revelation left.
- **The drip *is* the Three Clue Rule:** "Each drip of exposition is a conclusion that you want the PCs to make and, therefore, the Three Clue Rule applies."
- **Withholding needs a motive inside the fiction.** "Why *doesn't* Obi-Wan just tell Luke all of this stuff?" Answering that question gives the setting texture: "figuring out why the information is fractured in the first place will create interesting consequences". For us, a character's reason for keeping a secret (from their wants and fears) is what makes staged delivery feel motivated rather than mechanical.
- **Order mostly doesn't matter:** "you'll often discover that you DON'T need to worry about sequencing information." Some pieces do need context first: "You need to know he was a hero before you can reveal that he's a corrupted hero." So ordering constraints should be rare and explicit.

### 1.2 The two prongs of mystery design

[Advanced Node-Based Design, Part 5](https://thealexandrian.net/wordpress/8202/roleplaying-games/advanced-node-based-design-part-5-the-two-prongs-of-mystery-design).

- **Two kinds of clue:** "the clues required to figure out what happened or is happening (the *concept solve*)" and "the clues that take the PCs to another location or event where more clues can be gathered (the *scenario solve*)."
- **The concept prong can be thin; the scenario prong can't:** "you can spread the clues necessary to solve the mystery thinly (as long as you include the necessary density of clues to keep PCs moving from node to node). There may be entire nodes where there are no clues for unraveling the deeper mystery – just clues for moving on to the next node."
- **Density can rise with depth and effort.** "Nodes that are difficult to find or difficult to exploit … might offer more rewards in terms of mystery-solving clues." In a layer cake, "the early stages … might have only sparse or enigmatic clues. The deeper you move into the scenario, however, the thicker and more explicit the clues might become."
- **Don't count meaning as momentum.** A mystery-solving clue "doesn't actually satisfy the [Inverted Three Clue Rule](https://thealexandrian.net/wordpress/7985/roleplaying-games/node-based-scenario-design-part-3-inverting-the-three-clue-rule): If it isn't helping you find another node, then it doesn't count towards the 'necessary' quota of clues for keeping the adventure in motion."

For a scene, the scenario prong is what makes its endings reachable: our `essentials`. The concept prong is what makes it mean something: why Prout died, why it matters to Kell, what Hobb did. These two get different pacing, which is the central move of section 2.

### 1.3 Revelation lists

[Random GM Tip: Using Revelation Lists](https://thealexandrian.net/wordpress/40978/roleplaying-games/random-gm-tip-using-revelation-lists), plus the checklist passage in the [Three Clue Rule](https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule) and Ben Robbins' [Revelations](http://arsludi.lamemage.com/index.php/41/revelations/), which it quotes.

- **What it is:** "For each conclusion that you want the PCs to make, list the clues you're including in the scenario for it. This functions as a checklist which allows you to track their progress and (importantly!) a diagnostic tool during actual play to make sure they're on track."
- **Clue list vs revelation list:** a clue list says what each node contains; a revelation list says which clues point to each conclusion. In play only the second matters: "I generally don't care if the PCs have missed the clues in their current location, but I do care intensely about whether or not they've missed all the clues that would enable them to find a particular node." And: "when it comes time to actually run the scenario, it's the revelation list that's essential."
- **How to use it at the table** (Three Clue Rule):
  - "As the PCs receive the clues, check them off. (This lets you see, at a glance, if there are areas where the PCs are missing too many clues.)"
  - Track the conclusion separately from the clues: "(Be careful not to check it off as soon as they consider it as a possibility. Only check it off once they've actually concluded that it's true.)"
  - The two triggers for action: "If you see that too many clues for a conclusion are being missed, or that all the clues have been found but the players still haven't figured it out, then you'll know it's probably time to start thinking about new clues."
- **Robbins on what an entry should be:**
  - Short: "It should be a checklist or a trigger, not the whole explanation."
  - Not a script: "the revelation is not a canned moment: it doesn't say precisely how the fact is going to be revealed."
  - A floor, not a ceiling: "Your revelations are really the minimum the players should know at any point for the game to work." Some become moot: "It doesn't matter if the PCs notice the duke is left-handed if they already figured out he's an impostor."
  - Players run ahead: "the players may figure out more than you expect, sooner than you expect (they're precocious in that way)."
  - Guessing isn't the same as the fiction establishing it: "Revelations are also moments *in play* … unless they talk about it in-character you still need the revelation moment for them to roleplay their reactions and establish it as a fact the characters know."

### 1.4 The Three Clue Rule and its corollaries

[The Three Clue Rule](https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule) is the base the other three articles stand on.

- **The rule:** "For any conclusion you want the PCs to make, include at least three clues." Think of each clue as a plan: "when you have three clues you've not only got a plan — you've also got two backup plans."
- **Against withholding:** "There is a natural impulse when designing a mystery, I think, to hold back information … But the desire to hold back information does more harm than good." He still draws the line at dumping: "there's a difference between having lots of clues and having the murderer write his home address in blood on the wall."
- **Permissive clue-finding:** "think of that prep work as your safety net." The precondition matters for us: "In order to be open to permissive clue-finding you first have to understand the underlying situation." This argues against hiding secrets from the GM to stop dumps (see 3.B).
- **Proactive clues:** when the players are "being too passive … The solution, therefore, is to have something active happen to them." It has to carry information: "not simply 'have something happen'. You specifically want to have the event give them a new clue."

### 1.5 Follow-ons that bear directly on pacing

These are linked from the three articles, or from the Three Clue Rule's further reading. Each sharpens one point.

- **A hint asks a question; a clue answers one.** [Running Mysteries: Hints](https://thealexandrian.net/wordpress/50306/roleplaying-games/running-mysteries-hints): "a clue provides an answer, but a hint suggests a question." Hints can be loud (a bloody handprint) or subtle. If something must not be known yet, "even hinting at it may be dangerous. You might get some mileage from figuring out how to hint at the thing that hints at the truth." This is the user's step 2: "Player gets something worth investigating, not an instruction."
- **Not every revelation carries weight.** [Background Revelations](https://thealexandrian.net/wordpress/51319/roleplaying-games/running-mysteries-background-revelations):
  - "not every possible revelation in a mystery scenario is load-bearing";
  - keep "background revelations on a completely separate revelation list from your structural revelations";
  - "you don't actually need to track them during play".
  
  They still matter: "Structural revelations may be how the PCs navigate … but it's background revelations that give the scenario meaning." They also give "small victories even while the big questions remain elusive".
- **Earned, or left alone.** [Enigma](https://thealexandrian.net/wordpress/49602/roleplaying-games/running-mysteries-enigma): "If we force these discoveries, then we systemically drain the sense of accomplishment from our games. Knowledge is a form of reward, and for rewards to be meaningful they must be earned." And: "When the PCs fail to solve them, school yourself to sit back and let the mystery taunt them."
- **Nothing found is part of the texture.** [The Null Result](https://thealexandrian.net/wordpress/49225/roleplaying-games/running-mysteries-the-null-result) warns against "Improvising a clue so that the PCs find a clue, no matter what method of investigation they used": it removes "the feedback between creating and testing hypotheses". [Making Clues](https://thealexandrian.net/wordpress/46338/roleplaying-games/random-gm-tips-making-clues) adds: "A good mystery scenario is often as much about what you don't find as what you do." (The logician's water butt held "only rainwater and pigeon feathers", and the player called that a fair refutation.)
- **Build anticipation, then pay it off.** [The Two Types of Leads](https://thealexandrian.net/wordpress/50095/roleplaying-games/running-mysteries-the-two-types-of-leads): "Separate and foreshadow your existential leads in order to build anticipation and turn the ultimate revelation of access into a reward."
- **Small bursts, varied repetition, and a payoff dump.** [Getting the Players to Care](https://thealexandrian.net/wordpress/4124/roleplaying-games/random-gm-tips-getting-the-players-to-care-collected):
  - "If you want your players to know something, you have to make sure that you actually tell it to them" (#0, the anti-starving rule);
  - "focus on giving out small bursts of detailed information … Slowly revealing the big picture piece by piece is usually far more interesting than having McLecture the Scottish Elf explaining it all in a big lump" (#1);
  - "Players are more likely to remember things that they have *done* than things that they are *told*" (#2);
  - repetition works only if "each repetition of the information [is] interesting in its own right … by varying the type and content of the information" (#7).
  
  #8 allows the dump as a payoff: once little snippets are the norm, a long reveal lands as an event. The players "drank it up like thirsty men at a desert oasis".
- **Real tiers, and the cost of staging.** [Gathering Information, part 2](https://thealexandrian.net/wordpress/39653/roleplaying-games/rulings-in-practice-gathering-information-part-2-improvisation-and-tiered-information):
  - "it's important that the information actually is *tiered*";
  - "Players are generally more interested if there's a clear build to the information … (so multiple key moments can work better with tiered information than with an undifferentiated exposition dump)";
  - the trade-off is "the drag on pace created by framing multiple key moments" against "the potentially increased interest". He suggests framing key moments for only "one or two of your bullet points".
  
  [Part 1](https://thealexandrian.net/wordpress/39651/roleplaying-games/rulings-in-practice-gathering-information) gives the delivery shape: summarise the approach, make the key moment distinct, contextualise the information. Contextualising includes the source's "motivation for giving the information" and "relationship to the information (and to the PCs)".

### 1.6 The user's staged beat

The user pasted this; we couldn't trace its source. It stages one character's secret through a conversation:

| step | in the example | what the player gets |
|---|---|---|
| 1. Establish normality | The adviser is formal, composed and dismissive, and wants to end the conversation. | The character's public persona. |
| 2. Introduce an inconsistency | He refuses to discuss the king's arrest orders, though he seems unusually well informed about them. | Something worth investigating, not an instruction. |
| 3. Respond to curiosity | If challenged, he gets defensive, and his attention shifts briefly to a portrait of a young woman. | A second clue, with an emotional dimension. |
| 4. Increase the pressure | If the player keeps probing, he asks whether loyalty to a king should outweigh loyalty to family. | A moral dilemma. |
| 5. Deliver the beat | Depending on the player's response, he confesses, tries a bargain, or grows hostile. | An earned reveal, whose resolution the player's approach shapes. |

Four properties carry the weight:
1. **Every step after the first is contingent on the player** ("if challenged", "if the player continues probing"). Nothing advances on a timer.
2. **Steps 2–3 are hints in the Alexandrian's sense:** questions, not answers. The emotional dimension comes out *before* the information.
3. **Step 4 has the character voice their own conflict.** That's within our "people voice their own worries, never a deal" rule. It also shows the player, without coaching, what leverage would work.
4. **Step 5 has several outcomes, chosen by how the player answered the dilemma.**

### 1.7 Where the sources converge

| principle | sources |
|---|---|
| Break what the player should learn into single revelations, and deliver them over time | drip, Getting the Players to Care #1, tiered information |
| Each revelation the scene *needs* has several clues; track clues and conclusions separately | Three Clue Rule, revelation lists, Robbins |
| Keep structural and background revelations apart: robust and tracked vs thin, earned and optional | two prongs, Background Revelations, Enigma |
| Hints (questions) before clues (answers); show before tell | Hints, drip ("actively instead of passively"), staged beat steps 2–3 |
| A reveal lands harder after its set-up; a payoff dump works only after a drip | drip (the punch), Two Types of Leads, Getting the Players to Care #8 |
| Never the same pointer twice; vary how something comes back | drip ("without it becoming repetitive"), Getting the Players to Care #7 |
| When stalled, something happens that carries a new clue | Three Clue Rule (proactive clues), revelation lists ("time to start thinking about new clues") |
| Earned, contingent on the player, resolved by their approach | staged beat, Enigma |
| Don't block players who get there early, and don't make every probe pay | Robbins ("precocious"), Null Result |

---

## 2. Where this meets what we already do

### 2.1 The map

| idea | what the runtime does now | agrees | gap |
|---|---|---|---|
| Revelation list | `essentials`: what, `placedWith`, `carriers`, `unlocks` ([scene.ts](https://github.com/Tatskaari/kingmaker/blob/bc2ab1f/src/runtime/scene.ts)). The after-reply decision marks each `landed` or `hinted`. | Essentials are a list of structural revelations. `placedWith` already lists the clues. | Tracking stops at each essential, not each clue: we don't know which clue landed it, which ways in are unused, or whether the player *concluded* it. Background revelations aren't listed at all. They sit inside character secrets. |
| Three clues, permissive, proactive | "When they go elsewhere … move the thing to whatever they are engaging with". The quick co-GM relocates on off-graph turns. Beat `pressure` is offered once after two exchanges. Cues fire after N exchanges, and the momentum rule after a "stuck" status. | The GM relocates well when told the essentials (pooled target endings 60% → 72%). | Relocation hands over the whole `what`, not a sign of it. Stall signals count exchanges, not information: the after-reply status said "drifting" or "uncovered" on 0 of 322 turns. Most authored pressure lines are threats or countdowns ([gm-techniques.md](gm-techniques.md)). The few that carry a clue, like the doubt beat's crackling boot, are the proactive clues the Alexandrian means. |
| Never the same pointer twice | Hint tracking: a hinted essential is marked "Don't point at it again; let them take it up, or let it reach them another way". The repeat filter regenerates a reply that repeats an 8+ word sentence verbatim. | It stops the nagging that playtest 1 showed. | It's binary per essential. It silences the essential rather than steering to an *unused* way in, so after one hint the drip can go quiet: the starve side. |
| Earned reveals | `secrets` ("they come out only when earned"). Pressure rolls (`v2-pressure`): stakes × leverage × disposition gives yes, no, or a roll at DC 12/15/18, with bands yes-and, yes, no-but, no-and. Successes ride. | The bands match the staged beat's outcomes: yes = confesses, no-but = "asks a price of their own" (a bargain), no-and = hardens (hostile). | All of a holder's secrets are one block. A "yes" passes every secret to the GM (the collapse rows). There's no notion of how far someone has opened up, so a first blunt question and a fifth patient one are judged on the same footing. Per-secret `stakes` and `ask` are already listed as open in [pressure-rolls.md](../prototype/experiments/pressure-rolls.md). |
| Hints before answers | Cards hold `knows` (shared freely) and `secrets`. Beat directions say "secrets still need a reason to come out". | Hanged-clerk and drowned-rat write tells into prose: Hobb's hidden hand, Moll's closed fist, Cob's crackling boot. | Tells aren't marked as tells, so the GM can't tell a free hint from a secret. |
| One piece at a time | Decider relocation is "one at a time: several essentials in one reply reads as an info dump". Nan sells gossip by the measure. | Nan's measures are a perfect diegetic tiered-information device: a gill, a half, a pint, never a quart. | Nothing limits how much one reply reveals outside relocation. |
| Comic house style | The world plays it straight; every daft act sends a bill. | Comedy is set-up and payoff. A running gag is a drip, and the punch needs its set-up (the drip's Excalibur point). | A repeated tell can turn into a loop: "the bare-feet running gag turned into a near-verbatim loop". In the comic style a tell may recur only if it escalates. |
| Situation over beats | The situation format (cast, secrets, limits, endings, one pressure) scored as well as beat graphs, and ended faster. | Pacing should live in cards and revelations, not in more beats. | (none) |

### 2.2 The tension, and how to get both

The Three Clue Rule and the drip pull towards giving: "the desire to hold back information does more harm than good"; "If you want your players to know something, you have to make sure that you actually tell it to them". The staged beat and Enigma pull towards earning: "for rewards to be meaningful they must be earned". Our transcripts fail both ways, sometimes in one scene: the playtest dumped the who by turn 6, then nagged about the page for four turns.

The sources resolve it themselves, and the resolution fits the runtime:

1. **Two lists, two policies.**
   - **Structural** revelations (essentials, the scenario prong) are never withheld. Each has several ways in, missed ones move to wherever the player is, and when the scene's information flow stalls the world acts and brings a new sign.
   - **Background** revelations and character secrets (the concept prong) are earned and staged, and may stay unsolved.
   - The withholding the staged beat calls for applies only to the second list. Where a secret is also a way in to a structural revelation (Cob's night is a route to "not a suicide"), the structural side is covered by its *other* ways in. That's what the Three Clue Rule is for.
2. **Hints are free, answers are earned.**
   - *Starving* means the player has no open question to pull on, so the GM must always be willing to show a tell or a sign.
   - *Dumping* means an answer arrives before its question, or several answers in one reply.
   - The rule is "no answer before its question; always at least one open question". A question can come from the player, a hint, or the scene's premise ("what happened to Prout?").
3. **One new piece per reply, and never the same pointer twice.** Repetition is allowed only if it changes something: a different carrier, a different form, an escalation.
4. **Advance on engagement, with the clock as a backstop.** Staged secrets move only when the player pushes. The structural drip moves on engagement and, failing that, on stalled information, not on exchange counts. Existing cues ("at least eight exchanges") stay as last resorts.
5. **Successes ride; precocious players skip ahead.** A step once reached never goes back. Proof or real leverage jumps straight to the reveal, so staging never slow-walks a player who has done the work elsewhere.
6. **Set-up before the punch.** Where a reveal depends on context, the context goes first. Ordering constraints should be rare and authored, because the drip says most revelations don't need sequencing.
7. **Stage only what deserves it.** Staging drags on pace, so the full five steps apply only to the one or two secrets per scene that are worth a key moment (high stakes for the holder). Everything else follows the pressure ruling as now.

### 2.3 Constraints from our own experiments

- **A binary "deliver now" trigger oscillates.** Decider relocation went from 47/56 early reveals to zero. Mechanisms should give graded, state-based guidance ("what they have; what's unused; one step") and keep push triggers rare, gated, and limited to a sign rather than the answer.
- **Whatever the GM reads, characters may say.** Co-GM whispers that set terms were recited ("tell me how you'll keep him safe"), and once coaching is in the history the GM imitates it. Every new note must read as the GM's table notes about the *world* (where things are, how far someone has come), never as moves for a character to announce. Every eval must rerun the mouthpiece scan.
- **Keep state in `nowNote`; keep `directive` empty when possible.** The speculative reply is generated with the same `nowNote` (built from session state) and kept only when the pre-reply decision adds no directive ([engine.ts](https://github.com/Tatskaari/kingmaker/blob/bc2ab1f/src/runtime/engine.ts)). State written by the previous after-reply decision therefore reaches the GM for free. A new pre-reply directive discards the speculation (+0.3 s median) and should be reserved for rare turns.
- **The after-reply decision runs while the player reads.** Questions added to it cost no extra call. The pressure question "adds nothing measurable to the main call". But more criteria can split votes ("adding a near-duplicate option splits the vote"), so every new question needs labelled decision cases.
- **Single rounds are noisy.** The same `gm` configuration scored 16, 16, 14 and 12 of 20 target endings across rounds. Use paired designs and pooled n.

---

## 3. Three mechanisms to build and A/B

All three keep the turn loop's shape: decide before, reply, decide after. They differ in what the author writes, what is tracked, and what the GM reads.

```
player turn
  ├─ decide before   (unchanged; B: the pressure ruling becomes stage-aware, on pressure turns only)
  ├─ reply           (Luna, reasoning none; nowNote now also carries A's and/or B's state)
  └─ decide after    (same call, more questions; runs while the player reads)
        A: what the reply added towards each pending revelation, and which clue
        B: how far each secret-holder in the exchange has opened up (never goes back)
```

### 3.A Revelation list: what the player has, from which clue

**Hypothesis.** The GM paces the scene's drip badly because it can't see what the player already has, which ways in are unused, or whether the player has *concluded* anything. So it repeats the pointer it last used, or pours out what's left.

**What the author writes.** By default, nothing new: each `placedWith` entry of an essential becomes a clue. Optionally:

```ts
interface Essential {
  // …existing fields
  /** The separate ways in (default: one per placedWith entry). */
  clues?: Array<{ id: string; via: string }>;
  /** Revelations that should land first, for the punch (rare: most revelations need no order). */
  needs?: string[];
}
interface Scene {
  // …existing fields
  /** Deeper truths that give the scene meaning: tracked, never pushed, fine if they stay a mystery. */
  deeper?: Array<{ id: string; what: string; via: string[] }>;
}
```

In hanged-clerk, `deeper` would hold "why this case matters to Kell" and "Cob's grief for the clerk who taught him to write a C". In drowned-rat it would hold "Hobb sends his wages to his mum" and "Nan once put Kell through the door".

**What the runtime tracks.**

```ts
state.revelations[id] = {
  signs: Array<{ clue: string; turn: number }>, // clue id, or "other" for an improvised sign
  had?: number,        // turn they came to have it (told, shown, found, worked out)
  concluded?: number,  // turn they said or acted on it as true
};
state.lastNewSign: number; // last turn any pending structural revelation got a new sign
```

The after-reply decision replaces each `landed_<id>` question with one question per pending revelation. Up to four structural and two deeper revelations get one, and a revelation already had but not yet concluded gets a second question:

> **`rev_<id>`.** *In this roleplaying scene the player needs, in the end, to come across this: "<what>". What did the latest exchange add towards it?*
> - `have`: They now have it: it was told, shown or found, or they worked it out.
> - `clue_<n>`: A sign of it reached them through <via>, but not the whole of it.
> - `other`: A sign of it reached them some other way (a detail, a remark, an event), but not the whole of it.
> - `none`: Nothing in the latest exchange points towards it.
>
> **`concluded_<id>`** (only once `had`). *Has the player now said, or acted on, this as true, rather than just wondering about it?* `yes` / `not_yet`.

A sign is recorded only at ≥ 0.5 probability for the specific clue; otherwise it's recorded as `other`. The existing `landed` and `hinted` become `had` and "has at least one sign", so nothing downstream breaks.

**What the GM is told.**

The static brief section keeps the list with no per-turn markers, so it stays a cache-friendly prefix. Its header gains a sentence: "Each has several ways in; how far the player has got with each is in your notes for this turn." A new `nowNote` section follows (draft, rendered from state, shown for the playtest's turn 10):

> **## What the player has to go on**
> Your table notes on what the player has found so far (nobody says them aloud). Each reply adds at most one new thing, through a way in they haven't had yet; the same pointer twice reads as nagging, and everything at once reads as a lecture. When they've had the signs but haven't said it, don't say it for them.
> - Prout was killed and hung up for show: they have it, and have said so (Cob, turn 4; the body, turn 8).
> - What Prout found (the page; the name on it): not yet. Signs so far: the left boot crackling (turns 7–9). Ways in they haven't had: the tally book in the loft; what Kell knows about Prout's visit.
> - Who was in the loft: they have it (Moll, turn 6), and haven't put it with the rest yet.
>
> Deeper things (only if the player digs; fine if they stay a mystery): why this case matters to Kell.

Two gated additions append to one revelation's line, at most one per reply:

- **Overdue** fires when (a) a structural revelation isn't yet had; (b) no pending structural revelation has had a new sign for 4 player turns, meaning the scene's whole information flow has stalled, not just this thread; (c) there's no held ending or wind-down; and (d) it hasn't fired in the last 3 turns. It picks the first pending revelation in authored order and adds:
  > Nothing new on this for four exchanges: in this reply, let one fresh sign of it reach the player through what they're doing or through something the world does, as something they could follow up, not the answer.
- **Saturated** fires when every listed way in has been signed but there's been no `concluded` for 3 turns:
  > They've had every way in (the boot, the tally book, Kell) without putting it together: don't repeat them or explain it; let something new happen that only makes sense one way.

When "overdue" is active, the momentum rule's generic "something is revealed that opens a way forward" yields to it, so two competing directives never fire together. The quick co-GM's `relocate` also gets per-clue state. Its whisper becomes "a sign of it, through you, only as far as you'd really say it" plus the unused way in, rather than the whole `what`.

**Optional variant A2: pressure keyed to the drip.** Offer the beat's `pressure` when the information flow stalls (no new sign for 3 turns) instead of at `turnsInBeat >= 2`. Proactive clues are the Alexandrian's answer to passivity, and "the scene has been sitting here a while" is a weaker signal than "nothing new has reached the player".

**Latency.** No new call. The after-reply decision gains about 4–8 questions, while the player reads. `nowNote` grows by about 80–150 tokens, a negligible effect on time to first text. The speculative reply stays usable because the section comes from state. Overdue and saturated are in `nowNote` too, so they don't discard it either.

**Failure modes to watch.**
- **Mis-attribution.** A false "sign given" makes the note claim coverage that wasn't there, and the scene starves. Needs labelled decision cases (target ≥ 90%, as the pressure questions got).
- **Checklist pushing.** The GM reads "ways in they haven't had" as a to-do list and works through it: a slow dump. Or a character recites it ("You could always check the tally book"): the mouthpiece again. Watch new facts per reply and the coaching scan.
- **Railroading by the overdue push**, when the player is happily on a tangent. Gating on a whole-scene stall, the cool-down, and asking for a sign rather than the answer are the guards. Count pushes that land during a tangent the player was enjoying (QA).
- **No null results.** If every probe turns up a sign, the scene loses texture. The overdue push is the only push; ordinary probes can still come up empty.
- **Withholding by misclassification.** A structural revelation filed under `deeper` would never be pushed. This is an authoring check: anything an ending's script or an exit route depends on must be structural.
- **Prompt growth** on big scenes. Show at most four structural lines and two deeper ones.

### 3.B Staged secrets: the user's five steps, held one step per reply

**Hypothesis.** Characters collapse their secrets because the GM can't see where in a reveal it is. Show it the stage, allow one step per reply, and use the existing pressure ruling for the last step. Reveals should then build: tell, defensiveness with feeling, dilemma, outcome. That shouldn't slow down a player who has done the work.

**What the author writes.** Nothing is required: stages are generic, and the GM fills each step from the card's wants, fears and attitude. Optionally, a secret becomes an object (the shape [pressure-rolls.md](../prototype/experiments/pressure-rolls.md) already asks for):

```ts
type SecretSpec = string | {
  text: string;
  /** What shows before it's told: the crack in their public face (step 2). */
  shows?: string;
  /** What telling would cost them, from their side (the pressure roll's stakes). */
  stakes?: "trivial" | "guarded" | "dangerous" | "ruinous";
  /** The question it answers ("what he did in the loft"), so pressure can tell secrets apart. */
  ask?: string;
  /** What they're torn between (step 4), in a phrase. */
  torn?: string;
};
```

Most of this is already in the cards as prose. For Big Hobb: `shows`: "won't arm-wrestle tonight; keeps his right hand out of sight"; `torn`: "he only held the rope and would give a great deal to put it right, but the watch would hang him and the Master would drown him"; `stakes`: "ruinous". Following the tiered-information advice to frame key moments for "one or two" points, **the full five steps apply only to secrets with `dangerous` or `ruinous` stakes**, authored or judged; ideally that's one per scene. Lesser secrets (Cob's boots, which he'd trade) go through the pressure ruling as now.

**What the runtime tracks.**

```ts
type Guard = "surface" | "tell" | "stirred" | "torn" | "settled";
state.guard[castId] = { stage: Guard; turn: number; outcome?: "told" | "bargained" | "refused" }; // never goes back
state.secretsOut[castId] = number[]; // which secrets are out (by index)
```

The after-reply decision gets one question per present holder of a staged secret. Up to three holders get one, preferring those named in the latest exchange:

> **`guard_<id>`.** *Judge only what has actually happened in the story so far. How far has <name> come towards giving up what they're keeping to themselves (<ask>)?*
> - `surface`: Nothing has shown: <name> is still their usual public self about it.
> - `tell`: Something that doesn't fit has shown (a dodge, a slip, a reaction they couldn't hide), and the player could pick at it.
> - `stirred`: The player has picked at it; <name> has got defensive, and something personal has shown (someone or something they care about).
> - `torn`: <name>'s own conflict is out in the open: in their own words, what telling would cost them or what they're torn between.
> - `settled`: It's settled: they've told it, bargained over it, or refused for good and turned against the player.

**What the GM is told.**

A `nowNote` section (draft, for drowned-rat early on and hanged-clerk mid-scene):

> **## How far people have opened up**
> People give up what they're hiding the way they would at a good table. Something that doesn't fit shows first. If the player picks at it, the person's guard goes up and something personal shows. If the player keeps at it, what they're torn between comes out, in their own words. Only then does the thing itself come out: told, bargained over or refused, depending on how the player has treated them. A reply takes someone one step at most, and only when the player has given them a reason; proof, or leverage that really reaches them, can take them straight to the end. Nothing that's out goes back in.
> - Big Hobb: nothing has shown yet. What would show first: he won't arm-wrestle tonight, and his right hand stays under the table.
> - Cob: guard up (turn 3). Next, if the player keeps at him: what he's torn between (the men from the loft finding out he was there; Mister Prout, who was kind to him). After that, one thing at a time: the night in the loft, who it was, the boots.
> - Moll: settled (turn 6): she told who paid her, to protect Cob. She answers follow-ups.

The pressure directive becomes stage-aware. On a pressure turn (pre-reply, as now), if the holder hasn't reached `torn` and the approach isn't `strong` or `excellent`, there's no roll:

> The player is pressing <name>, who isn't ready to give it up: they move one step, to <step>, in their own words and reactions. Leave the player something real to pick at. Don't give up the secret, don't refuse flatly, and never tell the player what would work.

`<step>` is one of:
- *tell:* "something that doesn't fit: a dodge, a slip, a reaction they can't hide";
- *stirred:* "their guard going up, with something personal showing: someone or something they care about that bears on what they're hiding";
- *torn:* "what they're torn between, in their own words: a worry, or a question to the player that shows it, never terms".

At `torn`, or with `strong` or `excellent` leverage at any stage (the skip-ahead), the ruling runs as today, with these changes:
- The approach question gains one sentence: "If <name> has shown what they're torn between, a response that answers it (protects what they fear for, gives them what they need, settles their dilemma) is strong or excellent." That's how the user's step 5 ("depending on the player's response") reaches the dice.
- The bands map onto the user's three outcomes:
  - `yes` and `yes_and`: *confesses*, in their own way;
  - a costly `yes` (dangerous or ruinous stakes): *bargains*: "they tell it, but ask something in return, or make the player promise", as now;
  - `no_but`: *bargains or half-tells*: "they offer part of it for something they need, or let slip a partial truth that points somewhere useful";
  - `no_and`: *grows hostile*: "they shut this down and turn against the player".
- **The directive passes only the targeted secret** (chosen by `ask`), not every secret joined together. This fixes the collapse rows even without stages.

Authored check routes (win-cob, catch-moll) keep their authored outcomes. The note's "after that, one thing at a time" line backs up the staging authors already write into success texts ("If asked, he owns up…").

**A variant we'd advise against: hide the secret from the GM until it's due.** A GM that can't see the secret can't dump it. But then it can't improvise clues consistent with the truth either: "In order to be open to permissive clue-finding you first have to understand the underlying situation". The actors approach showed the same trade (better knowledge isolation, worse coherence). Tell the GM where things stand; don't blind it.

**Latency.** No new call. The `guard_*` questions ride in the after-reply decision. The pressure details call (0.5–1 s) runs only on pressure turns, as in `v2-pressure`. Staging makes those turns rarer, because early pushes resolve without a roll. On other turns the stage is in `nowNote`, so speculation is kept. B works without pressure rolls too (B0: stages and the note only; the GM judges the last step). That's worth running, because `v2` has no pressure rolls.

**Failure modes to watch.**
- **Stalling.** Slow-walking a reveal the player has earned: four pushes for one secret, or "rolling to failure". Guards: one step per push (never zero), the skip-ahead on leverage, successes riding, and staging only high-stakes secrets. Measure pushes before a reveal, and ask QA "were you made to wait?".
- **Withholding what the scene needs.** A staged secret that is also the only remaining way in to a structural revelation. Guard: section A's other ways in (or the overdue push) carry the structural side. Check: target endings don't drop.
- **Mechanical stages.** Every holder does dodge, then glance at a portrait, then ask a moral question, and it reads as a formula. The note describes how people behave, not a checklist, but the risk is real. Check: blind QA ("did reveals start to feel the same?") and the variety of tells across characters.
- **The dilemma as a quiz or as terms.** Step 4 can come out as the character interrogating the player, or as "tell me X and I'll talk": the mouthpiece. The wording "a worry, or a question that shows it, never terms" is the guard. Check: the coaching scan.
- **Repeated tells.** The same tell every reply, which is the comic loop risk. Guard: a tell counts as a hint, so hint tracking applies, and a tell may recur only if it escalates.
- **Stage misreads.** `torn` read too early lets the secret out early. `surface` read too late stalls. Needs labelled cases from the transcripts above.

### 3.C Tells: prep and one principle, no new state (the control)

**Hypothesis.** The cheapest explanation: secrets are presented as one block with no visible surface, so the GM can't tell a free hint from a reveal. If a prompt principle and authored tells fix most of it, A and B aren't worth their machinery.

**What the author writes.** `shows` per secret (as in B) and nothing else. The cast card renders it:

> - Secrets (your prep: they come out only when earned; what shows before it's told comes first):
>   - Shows: he won't arm-wrestle tonight; keeps his right hand out of sight. Under it: …

**What the GM is told.** One new bullet in [v2/ai/prompts/gm.md](../../ai/prompts/gm.md), worded as an outcome:

> - Let secrets surface the way they would at a good table: something that doesn't fit comes first (a question for the player, not an answer); then, as the player picks at it, the person's guard and their own reasons; and the thing itself when the player has earned it, in the person's own way: told, bargained over or refused, depending on how they've been treated. One new piece at a time: a reveal lands when the player has seen it coming, and a scene that hands over everything at once has nothing left to find. What the scene needs the player to find is different: never hold it back; if they aren't getting it one way, it reaches them another.

**What the runtime tracks.** Nothing new. Hint tracking keeps a tell from being pointed at twice.

**Latency.** About 90 prompt tokens. No calls.

**Failure modes.**
- **Ignored under a success directive.** The playtest collapse happened with "only when earned" already in the card. If C fails there, that is the evidence for B.
- **Spillover.** The GM over-applies the principle to essentials and starves the scene. The final sentence is the guard. Check: target endings.
- **Formula.** The same mechanical feel as B, without B's per-person variety from tracked state.

### 3.D How they compare, and the order to build them

| | A. revelation list | B. staged secrets | C. tells |
|---|---|---|---|
| fixes | nagging, starving, front-loading across carriers, the "had it but never said it" moment | collapse on success, blurts, flat reveals with no emotional middle, leverage the player can't discover | cheap partial fix for collapse and blurts |
| author writes | nothing (optional `clues`, `needs`, `deeper`) | nothing (optional per-secret `shows`, `stakes`, `ask`, `torn`) | `shows` per secret |
| runtime state | signs, had, concluded per revelation; last new sign | stage per holder; secrets out | none |
| GM reads | "What the player has to go on" (+ overdue / saturated) | "How far people have opened up" (+ stage-aware pressure) | one prompt bullet; tells in the cards |
| added calls | 0 | 0 (pressure turns as in `v2-pressure`) | 0 |
| latency | after-reply only; speculation kept | same; fewer pressure rolls | none |
| preset | `v2-reveal` (on `v2`) | `v2-staged` (on `v2-pressure`); `v2-staged0` (on `v2`) | `v2-tells` |

**Build order.**
1. **C first:** an hour's work, and it gives the control.
2. **B's single-secret pressure directive next.** It's tiny and fixes a real bug (every secret passed on a "yes") whatever happens to the rest.
3. **B's stages**, then **A**.
4. **A+B together** if both beat their baselines. They're complementary: A paces the scene across carriers, B paces each person.

Revelation state is per scene, reset on `chainScene` like `landed` and `hinted` today. The arc's campaign-level drip (Sallow's racket over three scenes) rides on the hand-off for now. A `deeper` revelation left unsolved could carry into the next scene's background as a live enigma.

---

## 4. Eval design

### 4.1 Step 0: measure the problem before fixing it

Run the information audit below over existing transcripts:
- playtest 1;
- the hanged-clerk QA sessions (absurd round 1, logician; round 2, skeptic);
- the `v2` deviation runs on scenes with essentials;
- 10 fresh `v2` trajectories each on hanged-clerk and drowned-rat.

Report the baseline rates for each metric in 4.2. If dumps and repeats turn out rare outside the cited moments, scale back.

### 4.2 What to measure

The primary metrics are counts, not opinions. They come from an **information audit**:
- **Input:** the scene's authored facts as a closed list: each essential and each of its clues, each sentence of each secret, and the `deeper` items.
- **Per reply:** which facts the reply puts in front of the player for the first time (told, shown, or clearly implied), and which already-shown clues it points at again.
- **Who labels:** a model that is neither the runtime's decider nor the judge (e.g. Sol at medium reasoning, JSON output), given the transcript so far.
- **Validation:** 40 replies labelled by hand, aiming for ≥ 85% agreement, before trusting it. As before, read the transcripts too.

| metric | definition | failure it catches | want |
|---|---|---|---|
| **dumps** | replies with ≥ 2 new secret facts from one holder, or ≥ 2 new structural revelations | collapse, blurt | down |
| **unearned reveals** | a staged secret's fact appearing with no prior player push on that person | blurt | down |
| **repeats** | a clue or tell pointed at again within 3 replies with nothing new added | nagging, loops | ~0 |
| **longest stall** | most player turns in a row with no new fact on any pending structural revelation | starving | not up (down for A) |
| **pushes before reveal** | player turns pressing a holder before their staged secret comes out | stalling (too many) vs dumps (zero) | median 2–3, rarely > 4 |
| **steps per reply** | stage changes per reply, from the `guard_*` track checked against the audit | collapse | ≤ 1, apart from skip-aheads |
| **set-up before punch** | share of revelations with `needs` that land after their context | the Kenobi problem | up |
| **coaching lines** | existing pattern scan plus reading (0/52 now) | mouthpiece | stays 0 |
| **outcomes** | target ending, scene ended, turns to end (existing harness) | withholding what the scene needs | no worse |
| **latency** | first text p50/p90, resolving text within 5 s, speculation kept | budget | unchanged |

The judge's dimensions (intent, consistency, characters, steering, craft) and case criteria are secondary. Every metric that rewards restraint has a paired counter-metric (dumps against stall, unearned reveals against pushes before reveal). So no condition can win by withholding, or by giving everything away.

### 4.3 Instruments

**Decision suite.** Labelled after-reply cases for the new questions:
- `rev_*` clue attribution, including a reply that gives two signs and one that only *mentions* the boots without the crackle;
- `concluded_*`: speculation vs conclusion;
- `guard_*` stage reads, built from the cited transcript moments.

Target ≥ 90% with Luna decisions, compared with Jev. Re-run the existing suite with the full question load, to check that more questions per call don't degrade the old ones.

**Reply cases.** Paired: same fixture, same seed, every condition. Rolls are forced with modifiers, as `tq-fail-warren-snatch` does with −15. Each case has an audit check (mechanical) and an outcome-phrased criterion.

| id | fixture | player turn | pass |
|---|---|---|---|
| `pc-collapse-scare` | hanged-clerk `yard`, built from playtest 1 turns 0–3 (intimidation +20) | "*backhands the child* tell me what you know!" | Cob gives what the success covers (he was in the loft, heard it) plus at most one more piece; who it was, the boots and the sewing stay his; Kell reacts to the method |
| `pc-collapse-boot` | hanged-clerk `doubt`, built from the logician's turns 0–4 (persuasion +20) | pays the boot for testimony | Silvertop and the big man come out; the boots and the sewing only as the question reaches |
| `pc-crackle` | `playtest-1/clerk-010-nonotes.json` | "Kell, what was Prout working on before he died?" | no boot pointer; if the page's truth moves, it's through Kell's memory of Prout's visit; nobody coaches |
| `pc-starve` | hanged-clerk `doubt`, 5 turns arguing with Moll about the coin, no page signs | another turn at Moll | a fresh sign of the page reaches the player through what they're doing, as a question; no page read out, no name |
| `rat-blunt` | drowned-rat `big-hobb`, turn 1 at his table | "Did you kill the clerk, Hobb?" | no confession; a real reaction (grey and still, the hand) and something to pick at; not a stonewall, not a dump |
| `rat-proof` | `big-hobb`, after Cob pointed him out and the arm-wrestle bared the burn | lays out the burn and Cob's word, and offers to keep the Master off him | he breaks now (the skip-ahead): "I only held the rope" |
| `rat-dilemma-{protect,bribe,threat}` | `big-hobb` at `torn` (he has said the watch would hang him and the Master would drown him) | answers it with protection / a purse / the noose | protection gets a confession; a purse gets a bargain or a half-truth; the noose turns him hostile or bolting; nobody states terms |
| `rat-quart` | drowned-rat `the-rat` | "Whatever it costs, Nan: everything about the gentleman." | sold by the measure; no quart, no Sallow |
| `hc-kell-why` | hanged-clerk `doubt` | "Why does this one matter to you, Sergeant?" | Kell owns up to Prout's visit (her card says she will when asked). This checks that staging doesn't withhold a free secret |

Held-out reply cases use scenes not touched in development: garrows-toll (Garrow's "Tam was drunk"), warren-hostage (Hester's question she won't answer), heron-warehouse (Scrope and the true book).

**Trajectories.** The simulated player ([v2/ai/prompts/player-sim.md](../../ai/prompts/player-sim.md)) plays a whole scene. Personas, one per failure family:
- **the blunt interrogator** asks everyone everything outright (dumps);
- **the wanderer** avoids the kids, the boot and Hobb's corner (starving);
- **the noticer** examines every detail and follows every tell (nagging, over-hinting);
- **the confidant** works on people's feelings and answers their worries (the staged arc and the dilemma);
- **the comic chancer**, held out, runs the house style (the machinery mustn't flatten the comedy).

**Design.**
- Development: hanged-clerk and drowned-rat × the first four personas × 5 samples = 40 per condition.
- Held out: heron-warehouse, garrows-toll, warren-hostage and green-standoff × 2 personas (one of them the chancer) × 3 = 24 per condition.
- Conditions: `v2`, `v2-pressure`, `v2-tells`, `v2-staged0`, `v2-staged`, `v2-reveal`, and A+B if warranted.
- Report the audit metrics per trajectory, then pooled. Report the judge's progress and criterion alongside.

**Blind QA.** 6–8 Claude players, blind to the condition. Each plays the hanged-clerk → drowned-rat chain plus one held-out scene, in two conditions with the order counterbalanced. Ask about experiences, not ratings:
1. "List, in order, every moment you learned something that changed what you thought was going on. For each: roughly which turn, and did you feel you'd worked it out, been handed it, or been made to wait for it?"
2. "Was there a moment you could tell someone was hiding something? What gave it away, and did it pay off?"
3. "Was there a stretch where you had nothing new to go on? When?"
4. "Did anyone keep pointing you at the same thing?"
5. "Did anyone tell you what to do, or what it would take to get something out of them?"
6. "When a secret came out, did how it came out depend on how you'd treated that person?"
7. "Did people's reveals start to feel like the same routine?"

Then compare each player's list (question 1) with the audit timeline for the same session. Agreement validates the audit. Disagreement means the audit is counting facts the player didn't experience as reveals, or missing ones they did.

### 4.4 Not fitting to a judge

- **Counts first.** The headline numbers come from the closed-list audit, validated by hand, from a model other than the decider and the judge. The judge's opinions are secondary and never the adoption criterion on their own.
- **Outcome criteria.** Criteria name observable outcomes ("the boots and the sewing stay his"), never process ("paces well"). They don't reward length or eventfulness: the judge has rewarded extra rolls that blind players disliked, and LLM judges favour longer answers.
- **Pairs and swaps.** Reply cases compare conditions on the same fixture and seed. Whole-scene comparisons are pairwise (same persona, same scene, A against B) with positions swapped, rather than absolute scores.
- **Held-out scenes and personas.** Prompt wording is tuned only on hanged-clerk and drowned-rat with the first four personas. The results that count come from the held-out set. Don't fix a held-out failure and then report it as held-out.
- **Pre-registered thresholds** (below), written before the runs.
- **Regression gates.** The mouthpiece cases (`mp-*`), the technique cases (`tq-*`), the deviation target endings and latency must not get worse.
- **Noise.** n = 40 development and 24 held-out trajectories per condition. Treat differences under about 10 points on rates, or 0.4 on 5-point scales, as noise unless they hold across both sets.

### 4.5 What would make us adopt each

- **C** if, against its baseline, it halves dumps and unearned reveals on the reply cases and holds on the held-out trajectories, with no rise in longest stall or turns to end. If C does that, B has to beat C, not `v2`.
- **B** if, against C (or `v2-pressure`):
  - dumps and steps per reply fall further;
  - pushes before reveal sit at a median of 2–3 with < 10% above 4;
  - target endings are no worse;
  - "made to wait" in QA doesn't rise, and "routine" reports stay rare;
  - the coaching scan stays at 0;
  - p90 resolving text stays under 5 s.
- **A** if, against `v2`:
  - repeats fall to about 0 and longest stall falls;
  - target endings hold or rise, and dumps don't rise;
  - QA reports of "nothing to go on" and "same thing again" fall;
  - the overdue push fires on a minority of turns and rarely mid-tangent.

## Sources

- The Alexandrian:
  - [Smart Prep: The Exposition Drip](https://thealexandrian.net/wordpress/43714/roleplaying-games/smart-prep-the-exposition-drip)
  - [Advanced Node-Based Design, Part 5: The Two Prongs of Mystery Design](https://thealexandrian.net/wordpress/8202/roleplaying-games/advanced-node-based-design-part-5-the-two-prongs-of-mystery-design)
  - [Random GM Tip: Using Revelation Lists](https://thealexandrian.net/wordpress/40978/roleplaying-games/random-gm-tip-using-revelation-lists)
  - [The Three Clue Rule](https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule)
  - [Node-Based Scenario Design, Part 3: Inverting the Three Clue Rule](https://thealexandrian.net/wordpress/7985/roleplaying-games/node-based-scenario-design-part-3-inverting-the-three-clue-rule)
  - [Node-Based Scenario Design, Part 6: Alternative Node Design](https://thealexandrian.net/wordpress/8015/roleplaying-games/node-based-scenario-design-part-6-alternative-node-design)
  - Running Mysteries:
    - [The Null Result](https://thealexandrian.net/wordpress/49225/roleplaying-games/running-mysteries-the-null-result)
    - [Enigma](https://thealexandrian.net/wordpress/49602/roleplaying-games/running-mysteries-enigma)
    - [The Two Types of Leads](https://thealexandrian.net/wordpress/50095/roleplaying-games/running-mysteries-the-two-types-of-leads)
    - [Hints](https://thealexandrian.net/wordpress/50306/roleplaying-games/running-mysteries-hints)
    - [Background Revelations](https://thealexandrian.net/wordpress/51319/roleplaying-games/running-mysteries-background-revelations)
  - [Random GM Tips: Making Clues](https://thealexandrian.net/wordpress/46338/roleplaying-games/random-gm-tips-making-clues)
  - [Getting the Players to Care](https://thealexandrian.net/wordpress/4124/roleplaying-games/random-gm-tips-getting-the-players-to-care-collected)
  - Rulings in Practice:
    - [Gathering Information](https://thealexandrian.net/wordpress/39651/roleplaying-games/rulings-in-practice-gathering-information)
    - [Gathering Information, part 2: Improvisation and Tiered Information](https://thealexandrian.net/wordpress/39653/roleplaying-games/rulings-in-practice-gathering-information-part-2-improvisation-and-tiered-information)
- Ben Robbins, Ars Ludi: [Revelations](http://arsludi.lamemage.com/index.php/41/revelations/)
- The user's staged-beat guidance: pasted into the request; source not identified.
- Ours:
  - [FINDINGS.md](../prototype/FINDINGS.md)
  - [experiments/deviation-repair.md](../prototype/experiments/deviation-repair.md)
  - [experiments/absurdity.md](../prototype/experiments/absurdity.md)
  - [experiments/pressure-rolls.md](../prototype/experiments/pressure-rolls.md)
  - [research/dc-guidance.md](dc-guidance.md)
  - [research/gm-techniques.md](gm-techniques.md)
  - [qa/](../qa/)
  - [evals/fixtures/playtest-1](https://github.com/Tatskaari/kingmaker/tree/bc2ab1f/evals/fixtures/playtest-1/)
