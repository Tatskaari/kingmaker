# GM techniques for play that leaves the prep: test design

These are the design notes for twelve eval cases in [`src/eval/cases/techniques.ts`](../../src/eval/cases/techniques.ts), plus briefs for blind QA. The six techniques are the user's summary of GM advice articles, listed below with their sources.

**Status.** The cases typecheck and pass an offline structural check: fixtures build, and every expected route, ending and approach exists. They haven't been run, and they aren't in `CASES` yet (see [Running](#running)).

The deviation experiment ([deviation-repair.md](../experiments/deviation-repair.md)) asked whether a scene still ends the right way when play leaves the graph. These cases ask a narrower question for each technique. At the moment the technique is needed, does the GM use it, and does it avoid the matching anti-pattern?

## Sources

| technique | the advice | sources |
|---|---|---|
| Move the clue | "If the key was supposed to be found in room three after the combat, and the players stealthed through room three and never searched it, move that key to another room." Keep secrets "abstract from their place of discovery so that you can drop them into the game wherever it makes sense." | [Gnome Stew][gs], [Sly Flourish: Revealing Secrets][sf-reveal], [Sly Flourish: Secrets Serve You][sf-serve], [Three Clue Rule][tcr] |
| Soft correction | "Sometimes you can nudge the players with a hint, a comment from an NPC, or a skill check that gives the characters some information." | [Gnome Stew][gs] |
| Preserve intent, change method | If the players "propose some completely different plan", you "should *also* be able to pick up the tools … and figure out what will happen". In the article's example, getting the boys out of the hospital "likely leads to a citywide manhunt". "Your prep should be a safety net, not a straitjacket." | [Tools, Not Contingencies][tools], [Node Navigation][nav] |
| NPC initiative | "A proactive node comes looking for the PCs." When players stall: "The bad guy finds out they're investigating and sends someone to kill or bribe them." Prep the NPCs' plans, not reactions to every PC choice. | [Node Navigation][nav], [Three Clue Rule][tcr], [Tools, Not Contingencies][tools] |
| Fail forward | "Failure is meaningful (and interesting) when it creates an obstacle or consequences, and therefore requires the creation of a *new* path." "You don't annihilate the intended route … You just complicate it." | [Failure for the Beginning GM][fail] |
| Rejoin at a later node | "It's not unusual for players to invent their own B's without any particular prompting." "When in doubt play it as it lies." With "ANY three clues" the PCs reach at least one conclusion, so no single node is a gate. | [Node Navigation][nav], [Inverting the Three Clue Rule][inv], [Gnome Stew][gs] ("Toss the notes") |

Three notes on the sources:
- "Secrets Serve You" is about secrets serving the GM: "You don't owe secrets and clues anything at all." The relocation advice is in its companion piece, "Revealing Secrets". That piece also says about half of a session's prepared secrets usually stay unrevealed, which is "perfectly fine and healthy". This backs one anti-pattern below: landing everything at once.
- "Soft correction" comes from the Gnome Stew article that the deviation experiment was built on.
- The user's version of NPC initiative adds that the action should open a new opportunity, not only threaten. The cases judge that.

## What the runtime already does, and the gaps the cases probe

| technique | already in the runtime | gaps | existing cases |
|---|---|---|---|
| Move the clue | Essentials in the GM's prep, framed as movable. v2's quick co-GM `relocate` (to someone present, or the world). The after-reply `landed_*` question. | green-standoff and warren-hostage have no essentials. Without essentials, target endings fell from 72% to 60% (pooled, deviation experiment). | `dv-ignore-tam`, `dv-no-rowan`, `dv-ignore-door`, `dv-no-search` (trajectories) |
| Soft correction | Characters "only know what they could know". Limits give honest "no, but" answers to impossible requests. | No rule covers a player acting on a misunderstanding. `v2/ai/prompts/gm.md` covers only the reverse, where the player points out the GM's contradiction. Models tend to accept a user's premise. | `gt-in-league`, `hc-accuse-cob` (adjacent) |
| Preserve intent | The quick co-GM's `open_route`, with a roll (skill, reason, failure consequence) when the plan's outcome should be uncertain. The built-in ending of their own. | It runs only when the decider flags a turn off-graph. A threat can be forced onto a nearby authored persuasion edge, as round 1 rolled a pickpocket as Insight. | `rp-ablated-*`, `rp-dreamed-*`, `wh-counter-hostage`, `gs-take-the-mark` |
| NPC initiative | Beat pressure (offered once, after two exchanges in a beat), cues, the after-reply status and momentum rule, and cast notes framed as wants. | Most authored pressure lines are threats or countdowns. The openings mostly sit in secrets. | `gs-just-watch`, `be-relay-shuttle` |
| Fail forward | Failure text on every authored check. The GM prompt's "Failure costs something or complicates things … the story keeps going". Endings the player didn't choose are held for one response. The quick co-GM's `failure` field. | Some authored failures are pure setbacks ("braces harder"). Trajectories can't force failures, and forced failures in reply cases don't fail on sample 0 ([findings](#findings-while-designing)). | `xr-failed-threat-not-instant-end` |
| Rejoin at a later node | The quick co-GM's `open_route` to any beat. The background co-GM's `move_to`. The improvised ending's redirect to a plausible authored ending. | The decider only sees the current beat's routes plus `anytime`. Nothing leads from crossroads `ranting` to the goblins, or from blocked-entrance `holt-raging` to the cart. So in `gm` a skip leaves the tracker behind. | `be-lift-tree` (the same remedy, but from the cart beat) |

## The cases

There are two cases per technique, spread so each scene hosts two. The 8 reply cases isolate the moment a technique is needed, and the 4 trajectories check it over a scene.

- **Approaches:** `v2` (the quick co-GM) and `gm` (no co-GM). Move-the-clue adds `gm-rigid` (essentials hidden) as the control.
- **Tags:** `technique` plus one of `move-the-clue`, `soft-correction`, `preserve-intent`, `npc-initiative`, `fail-forward`, `rejoin-later-node`.
- **Criteria:** each is outcome-oriented. It says what must be true of the reply or scene, then the failing patterns. The full text is in the file.

### 1. Move the clue

**Good:** what the scene needs reaches the player through whoever or whatever they're engaging with. It comes in that carrier's voice and only as far as they could know, as if it had always been there. It arrives one thing at a time, once the player has passed up the original carrier.

**Anti-patterns:**
- steering them back to the person they avoided;
- silence until a scripted cue;
- the narrator handing it over;
- everything at once;
- the original carrier blurting it early, as decider relocation did 26 times out of 31 in round 3.

**`tq-move-clerk-kell`** (reply, hanged-clerk, beat `doubt`)
- **Setup:** the barred loft door has just broken the suicide story, and Cob and Moll have brushed the player off.
- **Player:** won't deal with "those two" and asks Kell what Prout was working on, and who'd want a grain clerk quiet.
- **Good GM:** Kell becomes the carrier. She owns up to Prout's visit three days ago (false entries in the King's rolls; a gentleman of the Purveyor's office), or she points the player at the Granary Roll up in the tally loft.
- **Anti-patterns:** "you'll need those two"; Kell naming Sallow or describing the page, neither of which she could know.
- **Checks:** no roll, no exit.

**`tq-move-crossroads-hedge`** (reply, crossroads-ambush, beat `ranting`)
- **Setup:** the player has stepped round Tam twice and is watching the hedge.
- **Player:** speaks low to the blackthorn: "What's he done to you?"
- **Good GM:** the hedge answers in Skrag's voice: the goblins want Grandmother Bone back, and the farmer has it. The idol moves from Tam to the goblins, and Skrag is brought on before his beat.
- **Anti-patterns:** silence until a cue (what `gm-rigid` did in the deviation experiment), Tam taking over, the narrator explaining, an instant fight.
- **Checks:** no roll, no exit.

### 2. Soft correction

**Good:** when the player acts on a misunderstanding of something their character could know, the world or someone who would know sets it straight in the fiction. This happens before it costs them. The real stakes stay intact and no secret is spent on the correction.

**Anti-patterns:**
- making the false premise true;
- an out-of-character lecture;
- a correction that waves the stakes away or solves the scene.

This is the opposite of the qa1 hand-off cases. There the GM was wrong and the player's correction had to win. Here the prep is right. The Three Clue Rule's warning applies too: once players reach a conclusion "they'll tend to latch onto it", so the correction has to come early.

**`tq-soft-green-mark`** (reply, green-standoff, beat `judgment`)
- **Setup:** each of the four has made their case once.
- **Player:** "You mean to burn a thief's brand into a nine-year-old's face? And at sundown your ward strikes dead every stranger still on the green?"
- **Good GM:** Hester (or Oswin, or Pip) corrects both points. The mark is ash and chalk: painless, but a year and a day. The ward hurts nobody; strangers just find urgent business elsewhere. The stakes stay: a child marked before the Nine Furrows, and thirty-one people on a goblin road at dusk.
- **Anti-patterns:** the brand or killing confirmed; secrets used to soothe (the guest-right); the question rolled as a plea.
- **Checks:** no roll, no exit.

**`tq-soft-clerk-debts`** (reply, hanged-clerk, beat `yard`)
- **Setup:** Moll has told her paid story ("wailing about his debts").
- **Player:** "So he jumped over his debts. Who did he owe? The King will want a name."
- **Good GM:** Kell's dry correction: no debts, drink or enemies that anyone knows of. The mismatch with Moll's story is left for the player to notice.
- **Anti-patterns:** moneylenders invented to fit the premise (the sycophancy test); Kell declaring murder and solving it; an out-of-character note.
- **Checks:** no roll, and no exit (the `concede` route mustn't fire).

### 3. Preserve intent, change method

**Good:** the player's goal stays reachable by the method they chose. If dice are rolled, they're for what the player actually did, with a reason. The method brings its own consequences: a threat leaves a grudge, a bribe leaves a price, and "the guard may report them".

**Anti-patterns:**
- refusing because the prep listed another method;
- nearest-edge forcing (a threat rolled as persuasion);
- success with no trace of how it was won;
- quietly swapping in the authored method.

**`tq-intent-entrance-threat`** (reply, blocked-entrance, beat `the-cart`)
- **Setup:** Rowan has explained the charm. The authored way to get him to back out is Persuasion DC 14.
- **Player:** threatens to tell the Nine Furrows delegation he was too proud to admit he can't fix it. This aims at his fear of public failure.
- **Good GM:** a threat with traction. If dice are rolled, they're for Intimidation. It either works or visibly shakes him, and it leaves a mark persuasion wouldn't: Rowan's resentment, a counter-threat, Holt's or Mags's reaction to the method.
- **Anti-patterns:** a Persuasion roll; a flat "Rowan ignores you"; a cheerful, consequence-free backing out.
- **Checks:** exit `none` or `backed-out`.
- **Approach contrast:** in `v2` the quick co-GM should open an intimidation route. `gm` has only the persuasion edge.

**`tq-intent-crossroads-buyoff`** (trajectory, crossroads-ambush, 12 turns)
- **Player:** Odo Barrowman, a merchant who would rather pay than fight, threaten or trick, and who won't give away what isn't his.
- **Good GM:** coin matters on the goblins' terms. Skrag is greedy, but his chief wants Grandmother Bone. Payment buys a withdrawal, a delay, or a deal that includes the idol if Tam agrees, and the consequence fits (they'll be back).
- **Anti-patterns:** coin ignored or treated as meaningless; offers forced onto the intimidation or deception edges; the problem vanishing as if the goblins never wanted their idol.
- **Target endings:** `bargain`, `routed`, `own-ending`.

### 4. NPC initiative

**Good:** when the player stops driving, someone acts from the wants on their cast card. What they do gives the player something new to take up: an offer, a lead, a problem they can solve.

**Anti-patterns:**
- waiting with the player;
- repeating the same demand;
- only a threat or a countdown;
- a random event unconnected to anyone's wants;
- an NPC resolving the scene, or handing over the hidden solution.

**`tq-npc-toll-wait`** (reply, garrows-toll, beat `the-bill`)
- **Setup:** two flat refusals each way.
- **Player:** sits on the parapet: "I've got all evening too."
- **Good GM:** lonely Garrow fills the second cup and starts talking, perhaps the "funny story" of the farmer he fined. Or a rustle makes him jump and glance at the hole in his door.
- **Anti-patterns:** another recital of the toll, a sunset-bell threat on its own, or Garrow confessing the arrow, offering the Clause of Perils or lifting the bar.
- **Checks:** no roll, no exit.

**`tq-npc-warren-passive`** (trajectory, warren-hostage, 14 turns)
- **Player:** cautious, never makes a plan, takes a clear sensible offer, doesn't want anyone to die.
- **Good GM:** the cast keeps offering real choices. Hester calls up and bargains for her own rescue, Snikkit makes his quiet offer, Gubbin wakes to name his price, and a ransom with a deadline is on the table. The player decides by taking one.
- **Anti-patterns:** stalling; the moon rising and Hester drowning before anyone has offered a way to save her; someone resolving it for the player.
- **Target endings:** `escorted`, `parted`, `gone-for-ransom`.

### 5. Fail forward

**Good:** the failure lands, with no quiet success. It changes the situation concretely (a cost, a new obstacle, a worse position, someone who now knows) and leaves something to act on. It doesn't end the scene unless the prep says that failure does, and even then the player gets one more response.

**Anti-patterns:**
- "nothing happens, try again";
- a negated failure;
- the scene ending in the same reply;
- a failure that closes every path. As the source puts it, if there's only one path, failure "must be interpreted as temporary and, therefore, meaningless".

**`tq-fail-warren-snatch`** (reply, warren-hostage, beat `standoff`)
- **Setup:** the player's acrobatics modifier is −15.
- **Player:** leaps for the rope above Hester (Acrobatics DC 15).
- **Good GM:** Snikkit's knife is quicker and Hester drops into the race. The current drags her towards the culvert, and the player gets things to grab at (the trailing rope, the wheel's stump, a walkway post, her hand) and the moment straight back.
- **Anti-patterns:** swept away in the same breath, the scene ending, a catch anyway, nothing to do but watch.
- **Checks:** roll `acrobatics`, route `snatch`, no exit.
- **Sample 0:** it rolls a natural 20, so it's judged as a success control ([findings](#findings-while-designing)).

**`tq-fail-toll-chancer`** (trajectory, garrows-toll, 14 turns)
- **Player:** Pell Quickfoot, a chancer who tries lies, sneaking and running the bar. After a failure they try a new angle; they never hurt anyone.
- **Good GM:** each failure puts the Book's fine in the ledger, with consistent sums. Garrow watches like a hawk and the same trick won't work twice, but anything genuinely new still gets a hearing. This is the authored `dug-in` beat, which exists for exactly this.
- **Odds:** at the default +2, the first tries fail 55% (lie, DC 14), 50% (sneak, DC 13) and 40% (run, DC 11) of the time. A run that tries all three sees a failure about 86% of the time.
- **Target endings:** any crossing (`bluffed`, `slipped-past`, `ran-the-bar`, `paid`, `tam-was-right`, `other-remedy`, `cowed`).

### 6. Rejoin at a later node

**Good:** when the player's own route reaches content prepped for later, the GM plays that content from where the player actually is. The tracker follows. Skipped content comes in only if it still matters, and never as a gate or a replay.

**Anti-patterns:**
- "first, answer my question";
- re-running the skipped beat as exposition;
- the tracker lagging, so the GM keeps playing the earlier beat's direction;
- things happening twice.

**`tq-rejoin-entrance-tree`** (reply, blocked-entrance, beat `holt-raging`)
- **Setup:** the opening only, just after Holt's challenge.
- **Player:** ignores Holt, sees the branches are wider than the arch, and calls porters to lift the tree off. This is the hidden remedy, reached before anyone has explained the charm.
- **Good GM:** real traction with an honest cost. Rowan scrambles out in alarm for the fragile tree, and Holt starts timing it. The charm's link to the tree comes out through the attempt.
- **Anti-patterns:** Holt's "who are you?" as a gate, the plan refused or buried in explanation, someone else's fix.
- **Checks:** exit `none` or `cleared-other`.
- **Approach contrast:** nothing routes from `holt-raging` to the cart, so in `gm` only the improvised ending's redirect can close it.

**`tq-rejoin-green-ward`** (trajectory, green-standoff, 14 turns)
- **Player:** won't take sides on the child's punishment, and goes straight for the refugees: the ward, where they could sleep, how villages took strangers in "in the old days". That last question can reach the guest-right early.
- **Good GM:** real movement on the ward without settling Pip first, in the authored order. Once settled, the ward isn't reopened, which the `terms` beat's own direction asks for. Pip's judgment still resolves in a way that follows from the player staying out of it.
- **Anti-patterns:** "the judgment comes first"; the ward reopened; the scene stuck because `hester-agrees` also needs Pip settled.
- **Target endings:** `sheltered`, `remedy`, `to-the-mill`.

## Blind QA

The user suggested "a QA agent with a bit of guidance, e.g. on how to solve the scene where the GM hasn't prepped for it". Each brief below gives a context-free Claude player one hidden testing goal. It is worded so the player can pursue it from the opening alone, without knowing the prep.

Run the players on `v2`, one per technique on the first scene listed, then rotate scenes in a second round. As in rounds 1 and 2:
- an analyst with the prep reads the reports against `state.json`, `calls.jsonl` and the snapshots;
- failures become reply cases from the per-turn snapshots, copied into `evals/fixtures/`.

### Common brief (paste in, then add one goal)

> You're playtesting a text roleplaying game run by an AI game master. Play one character through one scene from the command line in /home/jon/git/kingmaker:
> `npm run scene -- start <scene> --session <id>` prints the opening; `npm run scene -- say <id> '<what you say or do>'` takes one turn; `npm run scene -- transcript <id>` rereads the scene.
> Don't open `scenes/`, `src/`, `prompts/`, `docs/` or `runs/`, and don't use `status`: you mustn't know the GM's prep. Play 12 to 20 turns, or until the scene ends, the way a real person plays at a table: in character, curious, with your own ideas.
> You also have one hidden testing goal (below). Pursue it the way your character naturally would. Don't announce it, and don't break character to test the system. Note privately, turn by turn, when you pursued it and what came back.
> Report in the usual JSON (summary, tangents, stonewalled, railroaded, inconsistencies, impossible_requests, best_moment, worst_moment, ratings, would_keep_playing, other_notes), plus `technique`: `{ "name", "what_i_did": [{turn, what}], "what_came_back": [{turn, what, handled: "well"|"ok"|"badly", why}], "answers": { question: answer } }`, answering the goal's questions.

### Goals, scenes and questions

**Move the clue**
- **Goal:** "Early on, choose one person your character won't deal with: the one the opening puts at the centre, or the one who seems to know the most. Give yourself an in-character reason (distrust, dislike, pride) and keep to it. Don't question them, take their advice or search their things. Get to the bottom of the scene's problem through anyone and anything else."
- **Scenes:**
  - crossroads-ambush: the shouting farmer.
  - hanged-clerk: the two children.
  - blocked-entrance: the scholar under the cart.
  - garrows-toll: the toll house itself (never look at or around it, and argue from the road).
- **Questions:** What did you need to find out, and how did it reach you? Did it feel as if it had always been there? Were you steered back to the person you avoided? Did anyone suddenly tell you everything?
- **Analyst:** which essentials landed and through which carrier, the relocations, and whether any came before the player had a fair chance at the original.

**Soft correction**
- **Goal:** "Play someone who jumps to conclusions. When something is ambiguous (a word, a custom, a threat, a witness's story), commit to the first, most dramatic reading and act on it. Take what people tell you at face value until the world gives you a reason not to. Make the mistakes a real player makes when skimming, not absurd ones. If you're corrected, accept it in character."
- **Scenes:**
  - green-standoff: assume the worst about what the "mark" and the "ward" do to people.
  - hanged-clerk: believe the first witness.
  - crossroads-ambush: decide early why the goblins are after the farmer.
  - warren-hostage: decide quickly who's in charge.
- **Questions:** Were you wrong about anything that mattered? How did you find out: a character, something you noticed, a roll, or an out-of-character note? Was that before or after you'd acted on it? Did the game ever make something you'd got wrong true?
- **Analyst:** false premises adopted into the fiction (compare with the prep), out-of-character corrections, secrets spent on a correction.

**Preserve intent, change method** (the user's "solve it in a way the GM hasn't prepped for")
- **Goal:** "Whenever the scene puts an obstacle or a gatekeeper in front of you, work out what most players would do (pay, persuade, fight, ask nicely). Then get the same result another plausible way: threaten instead of persuading, bribe instead of arguing, trick instead of paying, sneak instead of asking, or a practical fix of your own that a module writer probably didn't list. Commit to it; don't fall back to the obvious way as soon as it meets resistance."
- **Scenes:** blocked-entrance (the cart), garrows-toll (the bar), crossroads-ambush (the goblins), warren-hostage (the hostage), hanged-clerk (the children's silence).
- **Questions:** Did your method get a fair chance? If dice were rolled, was the roll for what you actually did, and did it say why? Did your method leave a mark the obvious one wouldn't have (a grudge, a report, a debt, a reputation)? Were you steered back to the "proper" way?
- **Analyst:** the dice line's skill against the action, the quick co-GM's `quick-<turn>` routes and their reasons, and whether the consequence reached the ending.

**NPC initiative**
- **Goal:** "Play someone cautious and reactive. After the first three or four turns, stop driving for a stretch of four to six turns: answer briefly, watch, wait, make small talk or do small unrelated things. Don't leave and don't sabotage. After that, take up anything sensible that someone puts in front of you."
- **Scenes:** warren-hostage, garrows-toll, hanged-clerk, blocked-entrance.
- **Questions:** While you weren't driving, did anyone act on their own goals? Did that give you something new to do, or only a threat or a countdown? Did anyone solve the problem for you? Did the scene end without you making a real choice?
- **Analyst:** turns with status "stuck", the momentum directive, pressure and cues, and whether each action fits that character's wants.

**Fail forward**
- **Goal:** "Play someone bold who tries risky, uncertain things: climbing, sneaking, lying, threatening, grabbing. When something fails, don't retry it straight away and don't give up: work with whatever the failure left you."
- **Scenes:** warren-hostage, garrows-toll, hanged-clerk, green-standoff.
- **Questions:** For each failed roll, what changed? Did you get a new problem, a new path, or just "no"? Was a failure quietly turned into a success? Did one failure end the scene? Did every roll say why it was being made?
- **Analyst:** the authored failure text against the narration, held endings, and state such as fines and sums staying consistent.

**Rejoin at a later node** (also "solve it in a way the GM hasn't prepped for")
- **Goal:** "Skip whatever the scene puts in front of you first. Ignore whoever greets, challenges or briefs you, and go straight for what looks like the heart of the problem: the object, the place, the person in trouble, or a solution you can already guess at. If the game tries to walk you back to the start, politely keep going your own way."
- **Scenes:**
  - blocked-entrance: go straight to the cart.
  - green-standoff: go straight to the refugees' problem, not the girl's.
  - hanged-clerk: go straight to where he died.
  - garrows-toll: ask to see the rules the toll is charged by before anything else.
  - warren-hostage: go straight to whoever is in charge.
- **Questions:** Did the scene let you get there? Did anything you skipped turn out to matter, and did it reach you anyway? Were you sent back to the start, or did anything happen twice? Did the scene end through what you did?
- **Analyst:** the beat path (`quick-*` and `repair` moves), replayed cast notes, essentials, and whether the ending matched what the player did.

## Findings while designing

1. **Forced failures don't fail on sample 0.** `buildFixture` resets `rollCount` to 0 and `runReply` seeds sample *s* with 1000 + 7*s*. The first d20 for seed 1000 is a natural 20, which always succeeds; samples 1 and 2 roll 7 and a natural 1. So `xr-failed-threat-not-instant-end` (Intimidation −15) has passed its threat on sample 0 in every run checked: 7 of 7 sample-0 runs across `runs/evals/20261014-082642-edge-rolls`, `-083957-gm-effort` and `-090458-speculative`, all failing the criterion and most failing the exit check. Its sample-0 failures are an artefact, not GM behaviour. A `rollCount` or seed offset in `FixtureSpec` (or a different seed base in `runReply`) would fix it. Until then, `tq-fail-warren-snatch` judges a natural 20 as a success control.
2. **The tracker can't follow a skip without a co-GM.** The decider only sees the current beat's routes and `anytime`. In `gm`, a player who reaches a later beat early leaves the beat direction behind the fiction. In `v2`, the quick co-GM can open a route to any beat, but only on turns flagged off-graph. The rejoin and hedge cases measure that difference.
3. **Trajectories can't set modifiers.** `TrajectoryCase` has only `character`, so fail-forward trajectories rely on natural failure rates. At the default +2, checks at DC 11, 13, 14 and 16 fail 40%, 50%, 55% and 65% of the time. A `modifiers` field would make "a clumsy character" testable.
4. **Two scenes have no essentials** (green-standoff, warren-hostage), so moving a clue there depends on general craft. Their clever routes are deliberately secrets: round 3 moved options and secrets out of essentials. So the move-the-clue cases stay on scenes with essentials. The warren's "somebody told them which rider to take" lead is a candidate essential if campaign hooks should move too.
5. **Soft correction has no rule in `v2/ai/prompts/gm.md`.** If the `tq-soft-*` cases fail, the obvious fix is one line: "If the player acts on a misunderstanding of something their character could know, let the world or someone who'd know set it straight in the fiction before it costs them; don't make it true."

**Related work in progress.**
- **Pressure rolls (`v2-pressure`):** if they land, run `tq-move-clerk-kell` and both `tq-soft-*` cases on it too. A secret pressed out by a roll is Gnome Stew's "skill check" kind of soft correction. These cases expect no roll for ordinary questions, which checks that pressure rolls don't fire on them.
- **World-state tracking:** a log of which beats' content has actually been delivered would help rejoin, so skipped content is neither replayed nor lost.

## Running

1. Register the cases: add `import { techniqueCases } from "./techniques.ts";` and `...techniqueCases` to `CASES` in `src/eval/cases/index.ts`. That file was deliberately left alone here.
2. Run them:

```sh
npm run eval -- --case tq- --samples 3            # all twelve; approaches per case (v2, gm; + gm-rigid for move-the-clue)
npm run eval -- --tag fail-forward --samples 3    # one technique
npm run eval -- --case tq-intent --approach v2,gm,gm-quick-block
```

**Reading the results:**
- Reply cases report criterion pass and mechanical pass (rolls, routes, exits) per approach.
- Trajectories report target endings, progress and the judge's weakest moment.
- With 3 samples, treat differences under about one sample per case as noise, as with earlier experiments.
- Confirm a surprising result with the blind QA brief for that technique.

[tools]: https://thealexandrian.net/wordpress/37422/roleplaying-games/dont-prep-plots-tools-not-contingencies
[sf-serve]: https://slyflourish.com/secrets_serve_you.html
[sf-reveal]: https://slyflourish.com/revealing_secrets.html
[nav]: https://thealexandrian.net/wordpress/8176/roleplaying-games/advanced-node-based-design-part-2-node-navigation
[gs]: https://gnomestew.com/when-play-does-not-go-to-prep/
[tcr]: https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule
[inv]: https://thealexandrian.net/?p=7985
[fail]: https://thealexandrian.net/wordpress/46186/roleplaying-games/failure-for-the-beginning-gm
