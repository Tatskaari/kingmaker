# Absurdity: Pratchett / Monty Python silliness around a real story

**The steer.** Don't play it straight all the time. When players want to do something silly, enable it, but with real repercussions in the world. The model is Monty Python or Terry Pratchett around a good story, not "children in the playground going off the rails".

**The result.** `v2` is now the comic house style plus a consequence flag. Absurd players rated humour about 4/5 with it. Consequences moved up modestly but are still the weak spot. A straight control player said the comic style "never made the danger feel fake". Data: 8 blind Claude players over 2 rounds, 16 simulated absurd scenes, and A/B reply cases built from the moments where QA saw daft acts go unanswered.

## Round 1: the baseline (`v2`, played straight)

Four blind players, each with a different brand of absurdity, on four scenes (reports in [qa/absurd-r1-reports.json](../qa/absurd-r1-reports.json)):

| player | scene | fun | humour | consequences | real / token / none |
|---|---|---|---|---|---|
| hero raised by geese | crossroads-ambush | 4 | 4 | 2 | 4 / 3 / 3 |
| stickler for procedure | garrows-toll | 3 | 3 | 3 | 3 / 2 / 1 |
| Python-witch-trial logician | hanged-clerk | 4 | 3 | 2 | 6 / 5 / 2 |
| chancer selling hostage insurance | warren-hostage | 4 | 4 | 3 | 7 / 2 / 3 |

**What already worked.** The GM made the core Pratchett move unprompted: it took the silliness seriously and turned it into plot.
- The crows "voted" in a Court of the Crossroads, and Skrag blinked first.
- A goblin witness sworn in on the Sacred Turnip exposed his chief's lie about the ox.
- "King signs for king" got the hostage down.

The characters had deadpan wit of their own:
- Skrag: "Skrag does not duel geese."
- Narration: "The granary declines to rise."
- Narration: the pigeon settles on the roof, "having declined to testify".

The story kept its stakes, and nobody stonewalled.

**What was missing.** Every player said the same thing: daft acts never sent a bill.
- The hero posed on the dead ox in front of five drawn bows and ventriloquised the goblins' sacred idol. Nothing happened.
- The pedant's summons, nailed to the hedge the goblins had shot from, got "No goblin answers".
- The chancer walked out on Snikkit's coup and paid him in buttons. No fallout.

Characters also judged bits from outside the story instead of arguing inside them. Kell logged the pigeon's testimony "as a joke, not as proof". The world rarely brought absurdity of its own.

## The change

1. **[v2/ai/prompts/tone-comic.md](../../v2/ai/prompts/tone-comic.md)** is the comic house style (approach `tone: "comic"`), added to the GM prompt:
   - The world plays it straight, and that's where the comedy comes from.
   - People deal with daft ideas on their own terms: they believe them, dispute them, cite their own rules, take offence or see an opportunity. They never treat them as a joke from outside.
   - Every daft act sends a bill, good or bad, now or later.
   - The world has comic momentum of its own.
   - The stakes stay real.
2. **Consequence flag** (`consequences: true`). One more question in the pre-reply decision: did the player just do something daft or reckless that people here would really answer? If so, the GM is told to follow it through to a consequence in this reply, or one plainly on its way. It costs about 0.5–1 s on flagged turns, because the speculative reply is discarded.

**A/B on the seven moments from round 1** (judge criterion pass; n=3 per case; noisy, so I read the replies):

| run | v2 | v2-comic | v2-comic-bill |
|---|---|---|---|
| 1 | 67% | 79% | – |
| 2 | – | 62% | 76% |

What changed in the replies:
- **Characters argued inside the bit.** Gubbin: "The king pays no premium. The king receives premiums." Garrow: "I don't believe the Book recognises service by thorn… And the goose is not a Crown officer."
- **The flag added pushback.** Skrag: "Keep talking, and arrows talk." Snikkit noticed the purse of buttons: "My other client pays in silver. Better silver."

## Round 2: held out (`v2-comic-bill`, new personas and scenes)

Reports are in [qa/absurd-r2-reports.json](../qa/absurd-r2-reports.json).

| player | scene | fun | humour | consequences | real / token / none |
|---|---|---|---|---|---|
| light-fingered trickster | crossroads-ambush | 4 | 4 | **4** | 7 / 3 / 1 |
| public-meeting orator | green-standoff | 4 | 4 | 3 | 4 / 4 / 1 |
| hedge-wizard | blocked-entrance | 3 | 4 | 3 | 2 / 2 / 1 |
| **straight control** | warren-hostage | 4 | 3 | 3 | 5 / 3 / 1 |

Mean consequences went from 2.5 to 3.25, and real consequences from 45% to 53% of daft moments. The personas differ between rounds, so read this as direction, not size. Some highlights:
- **Trickster.** A failed Deception, then a whispered con, provoked a goblin volley. A chalk "Circle of Arbitration" stopped the charge "because none of them wants to be the one who curses his grandmother".
- **Hedge-wizard.** A cheese-rind spell made the cart brace harder, and a crate of glasses smashed. The "Widening" didn't widen the arch, but it countered the charm. The cost: "And volunteered to explain those marks to the palace masons."
- **Orator.** The rake vote failed in law ("The Statutes do not make a parish by vote") but uncovered the real custom that solves the scene. "The geese abstain."
- **Straight control.** "The GM never forced jokes onto my straight play." The comedy came from the characters' own personalities, for example "I am continuing to discuss the alternatives", said by a hostage in a sack over a mill-race.

**Still weak:**
1. **Bills are gentle.** The world is "cosy and accommodating" (orator), and big daft acts get soft landings (wizard). The bill that comes due *later* needs memory: the world-state tracker and world patches.
2. **Continuity slips** in long scenes. Sundown ran backwards. The ending re-told the bread-and-salt rite. Snikkit was back on the beam after climbing down.
3. **Repetition.** Hester's "barefoot and alone" came back three turns running.
4. **Scenes end as soon as an exit fires**, even when the player is heading off on a new thread. A map and next scene would pick that up.

## Playtest 1: characters as the GM's mouthpiece

The user's own hanged-clerk session (approach `v2`) showed characters voicing the GM's plan:
- Moll: "If you want anything else from Cob, tell me how you'll keep him safe."
- Kell: "If it's evidence, it can be examined, but not by grabbing him. Ask, or give them a reason to let you."

**The source.** The background co-GM's notes and whispers set terms: "make Cob's safety the price of any further access… without another roll", and to Moll, "Wren must say specifically how Cob will be kept safe". The GM recited them. A "soft nudge" relocation also had the boot crackle in every reply.

**The fixes:**
- **GM prompt.** "People in the story speak for themselves, never for you." They voice their own worries ("And who pays for the damage when you've gone?"), never a deal the player can tick off. A telling detail is noticed once.
- **Cast cards.** Attitude lines are labelled "your prep: they never spell it out".
- **Co-GM prompt.** A whisper is what's on someone's mind, never terms, hints or the game's workings.
- **Hint tracking.** The after-reply decision records essentials a reply has hinted at, and the prep then says not to point at them again.

**Results.** In fresh sessions with a blunt-investigator player, coaching lines went from 4/49 replies (old prompts) to 0/52 (pattern scan; I read the transcripts too). Replaying the user's own session from its later turns still produces some coaching: once a few such lines are in the history, the GM imitates them. So this is reduced, not solved. The cases are `mp-*` in [cases/absurd.ts](../../src/eval/cases/absurd.ts). The judge is stricter than I am here: it also fails a child bargaining for his own boots, which his card says he'd do.

## Configuration

- `v2` = comic house style + consequence flag (the CLI default).
- `v2-straight` = the previous `v2`.
- `v2-comic` and `v2-comic-bill` are the experiment conditions.
