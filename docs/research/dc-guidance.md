# Setting the DC for social checks: getting a secret out of someone

Research for the Kingmaker V2 scene runtime. Compiled 2026-10-14.

The question is how hard it should be to get a secret out of someone, and when it should be rolled at all. It serves your steer on pressure rolls: "flag … when the player is applying pressure and make sure the GM makes them roll for it. The roll difficulty should be based on how valuable the info is, and how well the player is roleplaying this." The numbers in §3 are meant to replace the placeholder `pressureDc()` in `src/runtime/director.ts` (the experimental `v2-pressure` preset), whose comment points here.

**How to read this.** §0 gives the answer. §1 covers what each source says, with quotes. §2 pulls together where the sources agree on the three sub-questions: scaling by the secret's value, rewarding roleplay and leverage, and what failure means. §3 is the proposed model, with the inputs the decider judges, the rule, why these numbers, when to skip the roll, what success and failure mean, and how to word the dice line. §4 works the model through examples from our own scenes. §5 covers how it fits the runtime and which evals to add, and §6 lists open questions. Sources are linked inline and collected at the end.

---

## 0. Summary

Across D&D 5e, Pathfinder 2e, Blades in the Dark, PbtA, Draw Steel, Ironsworn, GUMSHOE and the main GM-advice writers, four points come up again and again:

1. **Roll only when it can go either way and failing costs something.** Otherwise say yes, or say no and show what would work instead. That's the Angry GM's three questions, The Alexandrian's "failure should be interesting, meaningful, or both", Sly Flourish's "below 10 … it's not worth rolling", 5e 2024's willing/unwilling/hesitant, and Dogs in the Vineyard's "roll dice or say yes".
2. **Difficulty comes from the world, not from the character sheet or the plot.** The main input is what telling would cost the person, judged from their side, and how they feel about whoever is asking (2014 DMG, The Alexandrian, Pathfinder 2e, the Angry GM). How much the *player* needs the secret isn't a difficulty input. It decides how failure is handled instead, because essential information should never hang on one roll (Three Clue Rule, GUMSHOE).
3. **Good play shifts the odds, and a good enough case removes the roll.** Sources use three mechanisms:
   - leverage lowers the DC (PF2e weaknesses −2/−5; Sly's lich is DC 32 to intimidate but DC 14 to flatter);
   - leverage or attitude grants advantage (5e 2024 attitudes, Sly, the Angry GM);
   - a strong enough case wins outright (Draw Steel's "particularly well-roleplayed or well-reasoned argument automatically counts as a tier 3 outcome without a test"; 2024's "willing"; Dungeon World's Parley, which needs leverage to trigger at all).
   Judge *what the character says and offers*, not how eloquently the player writes it.
4. **Failure is a "no, but" or a cost, not a wall.** It can be a counter-offer, a price, a partial truth or a cooler attitude. The same approach isn't rolled again ("let it ride"), but a new angle can be. Intimidation that works still costs the relationship.

**Proposed model.** The decider makes three judgements in the call it already makes. Code then turns them into one of five outcomes:

| input | levels (step value) |
|---|---|
| **stakes**: what telling would cost the holder (author it per secret where possible) | trivial · guarded **1** · dangerous **2** · ruinous **3** |
| **approach**: what the player's character says, offers or shows, judged against this person | `no_chance` · weak **−1** · plausible **0** · strong **+1** · excellent **+2** · `free` |
| **disposition**: how the holder feels about the player *now* | hostile **−1** · wary **0** · friendly **+1** |

```
free, or trivial stakes                  → say yes, no roll
no_chance, or the same push after a failed roll → no roll: they hold, and show what would reach them
gap = stakes − approach − disposition
gap ≤ 0 → say yes, no roll    gap 1 → DC 12    gap 2 → DC 15    gap 3 → DC 18    gap ≥ 4 → no roll: "not like this"
```

Put as a GM would: the base DC is **12 / 15 / 18** for guarded / dangerous / ruinous. Every step of better leverage or warmer feeling takes 3 off, and every step worse adds 3. At **9 or below** the secret comes out with no roll. At **21 or above** it doesn't, there's no roll, and the reply shows what would work. Only three DCs are ever rolled, all within about 1–3 points of the DCs our scene authors already use.

Failure has two bands:
- **Missed by 1–4: "no, but".** A price, a condition or a partial truth.
- **Missed by 5 or more, or a natural 1: "no, and".** They hold, their attitude hardens, this line closes for now, and the beat's pressure may come in.

Two rules apply either way. Nothing already said is taken back, and a secret the scene needs always stays reachable. Wording for the dice line, for example: `Persuasion check to get Moll to say who paid her (dangerous to admit; your leverage helps): 11 + 3 = 14 vs DC 12: success`.

---

## 1. What the sources say

### 1.1 D&D 5e (2024 free rules, SRD 5.2, and the 2014 DMG)

- **Typical DCs.** Very easy 5, Easy 10, Medium 15, Hard 20, Very hard 25, Nearly impossible 30. "The more difficult the task, the higher its DC." The DM calls for a check when there is "a chance of meaningful failure" ([Free Rules: Playing the Game](https://www.dndbeyond.com/sources/dnd/free-rules/playing-the-game)).
- **Social interaction.** "The DM uses an NPC's personality and your character's actions and attitudes to determine how an NPC reacts." Offering what an NPC wants, or playing on their sympathies, fears or goals, helps. Roleplay can change an NPC's attitude, "but there might still be an element of chance" (same page).
- **The Influence action** decides whether a roll happens at all. From the [rules glossary](https://www.dndbeyond.com/sources/dnd/free-rules/rules-glossary):
  - "Describe or roleplay how you're communicating with the monster… The DM then determines whether the monster feels willing, unwilling, or hesitant due to your interaction; this determination establishes whether an ability check is necessary."
  - **Willing:** "no ability check is necessary". **Unwilling** ("repugnant to the monster or counter to its alignment"): "no ability check is necessary; it doesn't comply".
  - **Hesitant:** a check, "default DC equal to 15 or the monster's Intelligence score, whichever is higher". "On a failed check, you must wait 24 hours (or a duration set by the DM) before urging it in the same way again."
- **Attitudes.** "You have Advantage on an ability check to influence a Friendly creature", and Disadvantage against a Hostile one (same glossary).
- **Natural 20 and natural 1.** The glossary gives critical hits only to attack rolls. Nothing makes a natural 20 an automatic success on an ability check. (Our `dice.ts` does treat it that way. §3.3 shows that this makes no difference inside the proposed DC band.)
- **2014 DMG, p. 245: the Conversation Reaction table.** The NPC's attitude (friendly, indifferent or hostile) picks a column. The check result (DC 0, 10 or 20) decides how much **risk or sacrifice** they'll accept. An indifferent NPC needs DC 20 to accept a minor risk, and a hostile one at best helps when there's no risk at all ([reproduced on GM Binder](https://www.gmbinder.com/share/-N9SrnKXADHF-PzsAl0_/-N9Tfnwv_Hqnqs56P5jS/source)). The Alexandrian calls these tables "quite limited and prone to producing nonsensical results". He rebuilds them around six relationship steps and the request's cost **as the NPC sees it**: "Asking a king to make a 100 gp donation… is, at worst, a minor cost to the monarch, but making the same request to a pauper would be a major ask". For an indifferent NPC his DCs are help with no cost at 15, a minor cost at 20 and a major cost at 25. Relationship modifies the roll from +10 (Intimate) to −15 (Nemesis) ([Random D&D Tip: Reactions & Relationships](https://thealexandrian.net/wordpress/50021/roleplaying-games/random-dd-tip-relationships-reactions)).

### 1.2 The Angry GM

- **When to roll.** "DECIDE if what the character wants to do can actually bring about the goal. If not, the action can't succeed. Then, DECIDE if there's any way the action might fail… If the action can't fail, it succeeds. Otherwise, if the action can succeed and can fail, DECIDE if there is a cost or consequence that prevents the character from just trying over and over again until the character succeeds. If there isn't, the action succeeds" ([Marvelous Mechanical Miscellany](https://theangrygm.com/marvelous-mechanical-miscellany/)).
- **DCs.** "A task anyone can reasonably accomplish most of the time is DC 5. A task anyone with some small amount of training or talent can easily accomplish is DC 10. A task that requires both training and talent is DC 15. A tough task for the trained and talented is DC 20."
- **Circumstances.** "If there is one positive or negative circumstance, assess a +2 or −2. But if there is more than one positive or negative circumstance OR the circumstances are really good or really bad, apply Advantage or Disadvantage" (same article).
- **Social conflicts** ([Systematic InterACTION!](https://theangrygm.com/systematic-interaction/), 2016):
  - "There must be a good reason why the NPC WON'T help the PCs." Without one, "most InterACTIONS! should be automatic successes".
  - Each reason to refuse is an OBJECTION scored 1–5: "1 is a minor OBJECTION! It's the sort of thing charismatic PCs can overcome with one or two quick exchanges… 5 is a major OBJECTION!"
  - Addressing an objection lowers it, "usually just by one. But if the players come up with something amazing or offer something huge, you can reduce it by more."
  - If objections total "more than five points greater than all the INCENTIVES!, the NPC becomes too firm in their decision to sway."
- **Resolving social actions** ([2023](https://theangrygm.com/resolving-social-actions/)):
  - "Disposition sets the Base Difficulty to influence the NPC."
  - Type of action matters: "Attempts to Convince are hardest, then attempts to Negotiate, followed by attempts to Understand, and finally attempts to Connect." The approach plays into, or grinds against, the NPC's mood and motivations.
  - NPCs have Patience, about "a half-dozen social actions before they shut down", after which they stonewall.
  - Notably: "with social actions, it's best to err on the side of die rolls". He prefers this because it keeps outcomes from resting on the player's eloquence. It supports your instinct that pressure should be rolled.

### 1.3 The Alexandrian (Justin Alexander)

- **Difficulty is set by the world.** "Setting difficulty by looking at the stats of the character attempting the action and then calculating what you want the percentage of success to be is a pernicious practice." Also: "Failure should be interesting, meaningful, or both. If it is neither, then you shouldn't be rolling the dice" ([Art of Rulings 5: Skill and Difficulty](https://thealexandrian.net/wordpress/38039/roleplaying-games/art-of-rulings-part-5-skill-and-difficulty)).
- **Let it ride** (a [Burning Wheel](https://forums.burningwheel.com/t/letting-it-ride-example/15700) rule). "When a PC is attempting a particular endeavor, make a single check and let the result of that check ride forward." A new check needs a "change in approach" or a significant change in circumstances ([Art of Rulings 8](https://thealexandrian.net/wordpress/38313/roleplaying-games/the-art-of-rulings-part-8-let-it-ride)).
- **Rolling to failure.** Rolling again and again teaches players not to plan: "if we just improvised something, it would be resolved in a single roll… If we actually put together a plan… it would just invite lots and lots of dice rolling until the plan failed" ([GM Don't List #2](https://thealexandrian.net/wordpress/38798/roleplaying-games/gm-dont-list-2-rolling-to-failure)).
- **Social skills** ([Rulings in Practice: Social Skills](https://thealexandrian.net/wordpress/43360/roleplaying-games/rulings-in-practice-social-skills), 2019):
  - Use the same loop as any other skill: state the intention, make the check, narrate the result.
  - The player-skill problem: "Everyone can make an argument, but people aren't equally gifted at that."
  - Social skills tell you things; they don't force behaviour.
  - Successes ride: "The check determined that the NPC is intimidated and will spill his guts, and that remains true as the PC continues to ask questions."
  - Failure should be *played*, not summarised. Instead of "he refuses to tell you anything", the NPC might mock the PC or show a bigger fear of someone else.
- **Diplomacy for D&D 3e** ([Advanced Rules: Diplomacy](https://thealexandrian.net/?p=700), 2007) is the closest precedent for a cost-based DC:
  - **Base DC 15**, plus **relationship** from −15 (Intimate) through 0 (Just Met) to +15 (Nemesis), plus **risk vs reward** from −15 ("Fantastic") through 0 ("Even") to +15 ("Horrible: no conceivable advantage or guaranteed loss").
  - Fail by 5 or less: "the subject does not accept the deal but may… present a counter-offer that would push the deal up one place on the risk-vs.-reward list".
  - Fail by 10 or more: "the Diplomacy is over; the subject will entertain no further deals, and may become hostile".
  - Retry? "No, unless you can significantly change the circumstances."
  - And: "If you use your relationship to take advantage of someone, it may affect their future relationship with you."
- **Tiered information.** His worked example gives each deeper level of a secret its own DC: 10, 12, 15, 18 and 30. He warns that "it's important that the information actually is *tiered*" ([Gathering Information pt 2](https://thealexandrian.net/wordpress/39653/roleplaying-games/rulings-in-practice-gathering-information-part-2-improvisation-and-tiered-information)).
- **Open or hidden DCs.** "If the difficulty number represents something that the PCs can directly observe, tell the players… If [it] represents something that the PCs can't observe, keep the number hidden" ([Art of Rulings 12](https://thealexandrian.net/wordpress/39142/roleplaying-games/art-of-rulings-12-hidden-vs-open-difficulty-numbers)). An NPC's fear is partly observable. What they're hiding isn't.
- **Failure** ([Failure for the Beginning GM](https://thealexandrian.net/wordpress/46186/roleplaying-games/failure-for-the-beginning-gm)):
  - "Failure is meaningful (and interesting) when it creates an obstacle or consequences, and therefore requires the creation of a *new* path."
  - Fail forward means describing a failure "as being a success-with-complications".
  - His five default complications cover "like 90% of fail forward checks": pay extra, take damage, broken equipment, extra time, and "someone knows you did it who you didn't want to know".
- **Three Clue Rule.** "For any conclusion you want the PCs to make, include at least three clues." A single clue behind a skill check is a chokepoint. Be permissive with clever approaches. When the players miss, use proactive clues ([Three Clue Rule](https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule)).

### 1.4 Sly Flourish (Mike Shea)

- **DCs** ([How to Choose DCs](https://slyflourish.com/choosing_dcs.html), 2023):
  - "If the only DCs you ever use are 10, 15, and 20, your game will run just fine."
  - "Below 10 and it's not worth rolling – just let the characters accomplish their goal."
  - "Don't set your DCs based on the characters, their proficiencies, or other abilities they have."
  - And for this topic: "An *approach* might change a DC. If you're trying to intimidate the lich (DC 32), that may not work out very well, but flattery might (DC 14)!"
- **Rewarding roleplay** ([Our Ability Check Toolbox](https://slyflourish.com/ability_check_toolbox.html), 2018):
  - "We're within the intention of the game to offer advantage to the player for a fine bit of roleplaying."
  - When the roleplay makes failure unlikely, "let the roll go away completely".
  - Use the dice "when a bit of randomness makes sense… or ignore it when the characters approach the situation in a way that makes failure unlikely".
- **Shades of grey** ([1d20 Shades of Gray](https://slyflourish.com/1d20_shades_of_grey.html), 2016). He sets a low and a high DC, for example 13 and 18. Below 13 goes badly, 13–17 succeeds with a complication, and 18 or more succeeds outright. "Overachieving should never get a PC in trouble."
- **Secrets** are kept "abstract from their place of discovery so that you can drop them into the game wherever it makes sense" ([Revealing Secrets](https://slyflourish.com/revealing_secrets.html)). This is the idea behind our relocation of essentials.
- *Note:* I couldn't find a Sly Flourish source for a "DC 12/15/18" scale. His published advice is 10/15/20 (with "10 (easy) to 20 (hard)" in [Numbers to Keep in Your Head](https://slyflourish.com/numbers_to_keep_in_your_head.html)). The 12/15/18 in §3 is our own choice, made for our modifiers. It's close to his 13–18 band and to The Alexandrian's tier DCs.

### 1.5 Blades in the Dark

- "When a player character does something challenging, we make an action roll." Before the roll, the GM sets **position** (controlled, risky or desperate: how dangerous it is for the PC) and **effect** (limited, standard or great: how much they'll get). Effect depends on potency (including "particular weaknesses"), quality and scale. Players can trade position for effect ([Action Roll](https://bladesinthedark.com/action-roll), [Effect](https://bladesinthedark.com/effect)).
- A 4 or 5 means "You do it, but there's a consequence". A 1–3 means "Things go badly". Consequences are reduced effect, complication, lost opportunity, worse position or harm. "Don't inflict a complication that negates a successful roll" ([Consequences](https://bladesinthedark.com/consequences-harm)).
- **Gathering information:**
  - "If it's common knowledge, the GM will simply answer your questions."
  - If there's an obstacle, roll an action. If it isn't common knowledge but nothing stands in the way, make a fortune roll.
  - "The GM answers you honestly, with a level of detail depending on the effect level". Limited effect gives "incomplete or partial information" ([Gathering Information](https://bladesinthedark.com/gathering-information)).
- **Takeaway.** Blades separates *the chance of it working* from *how much you get*. A partial success can mean a partial truth.

### 1.6 Pathfinder 2e (GM Core and Player Core, on Archives of Nethys)

- **DCs.**
  - Simple DCs: untrained 10, trained 15, expert 20, master 30, legendary 40.
  - Level-based DCs: level 0 → 14, 1 → 15, 2 → 16, 3 → 18.
  - Adjustments: easy −2, very easy −5, incredibly easy −10; hard +2, very hard +5, incredibly hard +10 (uncommon, rare and unique things respectively).
  - Source: GM Core p. 52 ([Difficulty Classes](https://2e.aonprd.com/Rules.aspx?ID=2627)).
- **Social skills** (GM Core p. 53, [Specific Actions](https://2e.aonprd.com/Rules.aspx?ID=2633)):
  - Estimate the creature's level ("a commoner is usually level 0 or 1").
  - Adjust for attitude: "easy for a friendly creature, very easy for a helpful one, hard for an unfriendly one, or very hard for a hostile one".
  - Adjust for the goal: "the DC to Request something an indifferent NPC is fundamentally opposed to might be incredibly hard or impossible", and easy if it's something they want anyway ([older edition text](https://2e.aonprd.com/Rules.aspx?ID=558)).
- **Gather Information** (Player Core p. 239, [action](https://2e.aonprd.com/Actions.aspx?ID=49)):
  - The DC reflects "the availability of information about the subject", raised for in-depth detail.
  - The tiers run from talk of the town (untrained) through common rumour (trained), "obscure rumor, poorly guarded secret" (expert) and "well-guarded or esoteric information" (master) to "known only to an incredibly select few" (legendary).
  - On a critical failure, "You collect incorrect information".
- **Request** (Player Core p. 239, [action](https://2e.aonprd.com/Actions.aspx?ID=51)):
  - It only works on friendly or helpful creatures, and "Some requests are unsavory or impossible, and even a helpful NPC would never agree to them".
  - Success may come with "added provisions or alterations".
  - On a failure "they might propose an alternative that is less extreme". On a critical failure their "attitude toward you decreases by one step due to the temerity of the request".
- **Coerce** (Player Core p. 240, [action](https://2e.aonprd.com/Actions.aspx?ID=52)). Even on a success the target complies and then becomes unfriendly, and may act against you. A failure makes them unfriendly. A critical failure makes them hostile and "temporarily immune to your Coercion for at least 1 week".
- **The Influence subsystem** (GM Core p. 188, [stat blocks](https://2e.aonprd.com/Rules.aspx?ID=1202)). "When a PC incorporates an NPC's weakness, it typically decreases the associated Influence check's DC by 2 (or 5 for stronger weaknesses)". Resistances raise it by the same amounts. Exploiting a weakness can even grant automatic influence.
- **Ad hoc bonuses** (GM Core p. 28, [rules](https://2e.aonprd.com/Rules.aspx?ID=2557)). Give +1 or +2 if the tactic is "interesting, surprising, or novel" or "took effort or smart thinking to set up", and not if it's "easy to replicate in pretty much every battle". "When PCs put effort into getting advantages… there should be some payoff."

### 1.7 Dungeon World and PbtA (no DCs)

- Rolls are 2d6 + stat: 10+ is a hit, 7–9 a hit with a cost or choice, and 6 or less a miss, on which the GM makes a move.
- **Parley.** "When you **have leverage on a GM character and manipulate them**, roll+Cha. Leverage is something they need or want. On a hit they ask you for something and do it if you make them a promise first. On a 7–9, they need some concrete assurance of your promise, right now" ([Parley](https://roll20.net/compendium/dw/Parley)). Without leverage it's just conversation, and the GM answers as the character would.
- **GM moves.** Soft moves have "no immediate, irrevocable consequences". Hard moves have immediate ones. The list includes "Reveal an unwelcome truth", "Offer an opportunity, with or without cost" and "Tell them the requirements or consequences and ask". One principle: "Never speak the name of your move" ([The GM](https://roll20.net/compendium/dw/The%20GM)).

### 1.8 Others worth borrowing from

- **Draw Steel** (MCDM 2025), [Negotiation chapter](https://steelcompendium.io/compendium/main/Rules/Chapters/Negotiation/) (rules text in [data-rules-md](https://github.com/SteelCompendium/data-rules-md/blob/main/Chapters/Negotiation.md)):
  - For a simple secret, no subsystem is needed: "If a hero wants information about a cult leader from a captured cultist, a single Presence test using the Lie skill or a Might test using Intimidate is likely all that's needed."
  - In full negotiations, "Arguments need a justification as to why they're true." Arguments that hit no motivation face "a more difficult test".
  - "A particularly well-roleplayed or well-reasoned argument automatically counts as a tier 3 outcome without a test. Good roleplaying should be rewarded!"
  - Reusing the same argument gets an automatic tier 1. Hitting a pitfall "automatically fails". Being caught in a lie costs interest.
  - Outcomes run from "yes, and" through "no, but" (offering "other less impactful goods or services") to "no, and".
  - Also: "Negotiation is not a process that changes an NPC's character."
- **Ironsworn** ([Datasworn move text](https://github.com/rsek/datasworn), CC BY 4.0):
  - Compel: the approach picks the stat (charm, threaten or swindle), with "+1 if you share a bond".
  - A strong hit means "they'll do what you want or share what they know". A weak hit means "as above, but they ask something of you in return". A miss means "they refuse or make a demand which costs you greatly".
  - In Gather Information, even a miss "reveals an unwelcome truth".
- **GUMSHOE** ([overview](https://en.wikipedia.org/wiki/Gumshoe_System)). "Investigative abilities always work; there are no dice rolls involved". It was designed because "important clues being missed due to failed dice-rolls" brought play to a halt. Extra, non-essential information costs a spend.
- **Dogs in the Vineyard.** "Roll dice or say yes" ([Wikipedia](https://en.wikipedia.org/wiki/Dogs_in_the_Vineyard)).
- **Cypher System.** "If you attempt something that has a difficulty of 0, no roll is needed—you automatically succeed". Skills, assets and effort lower difficulty in whole steps, and "Assets can never decrease a task's difficulty by more than two steps" ([Cypher SRD](https://callmepartario.github.io/og-csrd/)). Difficulty in steps, eased by what you bring, is the shape of the model in §3.

---

## 2. Where the sources agree

### (a) Scaling by how valuable or dangerous the secret is to its holder

- **The axis is the cost to them of saying it, from their side.** It goes by different names: risk or sacrifice (2014 DMG), risk vs reward and king vs pauper (The Alexandrian), "fundamentally opposed" and how well guarded the information is (PF2e), objection strength 1–5 (the Angry GM), repugnant means unwilling (5e 2024). None of them scale by how badly the *party* wants it.
- **Step sizes vary.** The Alexandrian's 5e reactions add 5 per cost tier, PF2e adds 2, 5 or 10, his 3e Diplomacy moves in 5s, and his tiered-information example runs 10/12/15/18/30. On a d20 with 5e-sized bonuses, one tier is worth 3–5 points.
- **At the top, almost everyone stops rolling.** In the 2014 DMG a hostile NPC won't take a risk for you at any DC. 2024 has "unwilling, no check", PF2e "impossible", Draw Steel's interest 0 and the Angry GM's "too firm to sway". The fix is a better approach, not a luckier die.
- **Value to the story is a separate question.** Information the scene needs gets handled by how failure works (it stays reachable), not by a higher DC. Otherwise the most important secret becomes the hardest to get, and it's exactly where the scene needs to flow (Three Clue Rule, GUMSHOE). Authors usually make the important secrets costly to their holders anyway, so the two line up without double-counting.

### (b) Rewarding good roleplay and leverage

- **Three mechanisms, often combined:**
  - **lower the DC:** PF2e weaknesses −2/−5, Sly's lich, the Angry GM's ±2, The Alexandrian's risk vs reward;
  - **advantage:** 5e 2024 attitudes, Sly's "fine bit of roleplaying", the Angry GM for strong circumstances;
  - **no roll:** Draw Steel's automatic tier 3, 2024's willing, Sly's "let the roll go away", the Angry GM's "most InterACTIONS! should be automatic successes", GUMSHOE's core clues.
- **PbtA reverses the framing.** Leverage is what *allows* the roll. Without it there's nothing to roll, and the NPC simply answers as themselves.
- **Reward the content, not the eloquence.** The Alexandrian's player-skill problem is that a shy player's charismatic character shouldn't do worse than a glib player's. Draw Steel asks for "a justification as to why [the argument is] true". For us there's an extra reason: LLM judges are known to favour longer answers (verbosity bias, [Zheng et al. 2023](https://arxiv.org/abs/2306.05685)). So the criteria should name concrete content: what's offered, threatened, shown or appealed to, and whether it touches what *this* person wants or fears.
- **Leverage earned in play should count more.** Evidence found, a fear spotted, something they said earlier: PF2e's "did this take effort or smart thinking to set up?"

### (c) What a failed social check should mean

- **The same push doesn't get rolled again.** That's let it ride. 5e 2024 says wait 24 hours before urging "in the same way". Draw Steel gives a repeated argument an automatic tier 1, and PF2e Coerce makes the target immune for a week on a critical failure.
- **A new angle reopens it.** "Change in approach" (The Alexandrian), "unless you can significantly change the circumstances".
- **A near miss is a "no, but".** A counter-offer (Alexandrian, failing by 5 or less), a less extreme alternative (PF2e Request), "other less impactful goods" (Draw Steel interest 2), something asked in return (Ironsworn's weak hit), success with a complication (Sly's 13–17 band). Blades' limited effect is the partial-truth version.
- **A bad miss costs something.** The attitude drops a step (PF2e critical failure, Coerce). The conversation ends (Alexandrian, failing by 10 or more). The GM makes a hard move (Dungeon World), the player pays the price (Ironsworn), or "someone knows you did it" (The Alexandrian).
- **Success can cost too.** Coerced people turn unfriendly afterwards (PF2e). "If you use your relationship to take advantage of someone, it may affect their future relationship with you" (The Alexandrian).
- **Play the failure, never dead-end it.** The NPC's reaction shows something: a bigger fear, what they'd want instead. Information the scene needs comes another way, through proactive clues (Three Clue Rule) or our existing relocation of essentials.

---

## 3. The proposed model

### 3.1 Inputs the decider judges

All of these go into the decision call the turn already makes ("director.before"). They add questions, not calls, so there's no latency cost. The questions work the same for Jev or Luna's decision mode. Who's being pressed and by what means (persuasion, intimidation, deception, insight) are already asked in `v2-pressure`.

**Stakes: what telling would cost the holder, as they see it.** Author this per secret where you can, for example `{ text, stakes: "dangerous", ask: "who paid her to lie" }`. The decider's judgement is the fallback. Authoring keeps the same secret on the same DC from turn to turn, and it lets a holder with several secrets keep them apart (Cob has four, from boots he'd swap to a murder he heard).

| choice | criterion text |
|---|---|
| trivial | Costs them nothing much to say: gossip, a mild embarrassment, something they'd tell anyone who asked nicely. |
| guarded | Costs them something real but survivable: pride, a scolding, money, a favour or a deal, a friend's annoyance. |
| dangerous | Puts something big at risk: their safety, livelihood or standing, or someone they protect. |
| ruinous | Could destroy them: their life, a sworn oath or their deepest loyalty, or the person they love most. |

**Approach: what the player's character says, offers or shows, judged against this person's card.** These are the existing `pressure_fit` options, reworded so the judgement rests on content.

Instruction: "Judge what the character says, offers or shows, not how long or polished the writing is. A terse line with real leverage is strong; a fine speech with no reason in it is plausible at best."

| choice | criterion text |
|---|---|
| free | No roll needed: they'd tell this person anyway. It costs them nothing to say, their card says they'll share it if asked, or the player has already given them what they wanted. |
| no_chance | It can't work on them: it pulls a lever that, by who they are, doesn't move them (their card says so, or no one could get it out of them this way), and nothing has changed that. |
| weak | No real reason to tell: a bare demand or a repeat, a bribe or threat with no grip on this person, or a lie they can see through. |
| plausible | A fair appeal, offer, threat or bluff that gives them some reason, but isn't aimed at what this person in particular wants or fears. |
| strong | Real leverage on this person: it offers what they want, protects what they fear for, or uses evidence or something learned in play that they can't brush off. |
| excellent | Strong leverage, played in character and aimed squarely at this person (their wants, their fears, what they just said): the kind of case that would sway a real person. |

**Disposition: how the holder feels about the player right now.** This is new. Ask it once, about the person being pressed: "judging by the scene so far: their starting attitude, then what has happened".

| choice | criterion text |
|---|---|
| hostile | Dislikes, distrusts or fears the player right now, or wants them gone. |
| wary | Neutral, guarded, or not yet sure of them. |
| friendly | Likes or trusts them, owes them, or has been won over in this scene. |

**New angle?** Ask this only when the same holder has already resisted a pressure roll for the same secret.

| choice | criterion text |
|---|---|
| new | A new angle: new leverage or evidence, a different lever, or something important has changed since the last try. |
| same | The same push again, reworded or louder. |

Two rules for uncertain answers. If the top choice has probability under 0.5, step one level towards the middle (plausible, wary). Keep the existing 0.6 confidence bar on *whether* someone is being pressed at all.

### 3.2 The rule

```ts
const RESIST = { guarded: 1, dangerous: 2, ruinous: 3 } as const;
const APPROACH = { weak: -1, plausible: 0, strong: 1, excellent: 2 } as const;
const WARMTH = { hostile: -1, wary: 0, friendly: 1 } as const;

type Ruling =
  | { kind: "yes" }                                               // say yes: no roll, they give it up
  | { kind: "no"; why: "lever" | "too_far" | "same_again" }       // no roll: they hold; show what would reach them
  | { kind: "roll"; dc: 12 | 15 | 18 };

function pressureRuling(stakes: Stakes, approach: Approach, disposition: Disposition, retry?: { newAngle: boolean }): Ruling {
  if (approach === "free" || stakes === "trivial") return { kind: "yes" };
  if (approach === "no_chance") return { kind: "no", why: "lever" };
  if (retry && !retry.newAngle) return { kind: "no", why: "same_again" };           // let it ride
  const gap = RESIST[stakes] - APPROACH[approach] - WARMTH[disposition];
  if (gap <= 0) return { kind: "yes" };
  if (gap >= 4) return { kind: "no", why: "too_far" };
  return { kind: "roll", dc: (9 + 3 * gap) as 12 | 15 | 18 };
}
```

The whole grid looks like this ("yes" and "no" mean no roll):

| approach | disposition | guarded (base 12) | dangerous (base 15) | ruinous (base 18) |
|---|---|---|---|---|
| weak | hostile | 18 | **no** | **no** |
| weak | wary | 15 | 18 | **no** |
| weak | friendly | 12 | 15 | 18 |
| plausible | hostile | 15 | 18 | **no** |
| plausible | wary | 12 | 15 | 18 |
| plausible | friendly | **yes** | 12 | 15 |
| strong | hostile | 12 | 15 | 18 |
| strong | wary | **yes** | 12 | 15 |
| strong | friendly | **yes** | **yes** | 12 |
| excellent | hostile | **yes** | 12 | 15 |
| excellent | wary | **yes** | **yes** | 12 |
| excellent | friendly | **yes** | **yes** | **yes** |

Of the 36 cells, 10 are "yes", 4 are "no" and 22 are rolls. Trivial secrets are always "yes", and `free` and `no_chance` skip the grid.

### 3.3 Why these numbers

- **Fit to our characters.** PCs are "a capable level 3 adventurer: strong skills +4 to +6, average +1 to +2, weak −1 to 0" (`src/runtime/engine.ts`), clamped to −2..+8. Chance of success:

  | DC | weak (+0) | average (+2) | strong (+5) | best (+8) |
  |---|---|---|---|---|
  | 12 | 45% | 55% | 70% | 85% |
  | 15 | 30% | 40% | 55% | 70% |
  | 18 | 15% | 25% | 40% | 55% |
  | *(DC 9, if it were rolled: we say yes)* | 60% | 70% | 85% | 95% |
  | *(DC 21, if it were rolled: we say no)* | 5% | 10% | 25% | 40% |

- **The middle cell is 5e's "Medium".** A dangerous secret, pushed with a fair but generic approach on a wary holder, is DC 15. That's the 2024 Influence default and the "medium" DC in every 5e table: a real coin flip (55% for a specialist, 40% for an average skill). PF2e's level 1–3 DCs (15–18) and The Alexandrian's 3e base of 15 land in the same place.
- **One step is 3 points, or 15 percentage points.** That's in the range of advantage (about +5 near a coin flip, about +3 on average) and the Angry GM's ±2/advantage. It's big enough that players feel leverage pays, and small enough that one misjudged step by the decider doesn't wreck a scene. Keeping every step a multiple of 3 means only DC 12, 15 and 18 are ever rolled, which echoes the "three DCs is enough" advice (the DMG, via Sly).
- **The skip thresholds come from the sources.** "Below 10 and it's not worth rolling" (Sly) becomes the "yes" at DC 9 or less. At DC 21 or more an average character needs a 19, and the right fix is leverage, not luck. So we say no in the fiction and show what would move them, following 2024's "unwilling", PF2e's "impossible" and Dungeon World's Parley, where no leverage means no roll. This also stops the decider from turning every hopeless ask into a 5–10% lottery.
- **Gentler than the 2014 DMG on purpose.** There, an indifferent NPC needs DC 20 for a minor risk, and The Alexandrian's version needs 20 for a minor cost and 25 for a major one. Our scenes run about 5–10 exchanges and are built around the secret coming out. Leverage and warmth can reach "yes" without a roll, and failure stays open.
- **It matches what our authors already wrote.** The hand-authored social checks sit at DC 11–16. In `hanged-clerk`: win-cob 12–13, catch-moll 13, scare-kids 12. In `garrows-toll`: read-garrow 11, convince 12, and threats and tricks 14, rising to 16 on a second try (`threaten-again`, `lie-again`). That's mostly the plausible-and-wary or strong-and-wary cells. Cast cards already say what moves people ("it comes out when he's shown something he can't wave away"). That's the information the approach judgement needs.
- **Natural 20 and natural 1 don't matter here.** With DCs of 12–18 and modifiers of −2..+8, a natural 20 always beats 18 and a natural 1 never reaches 12. So the house rule in `dice.ts` never changes a result in this band.
- **What changes from the placeholder `pressureDc()`.** The placeholder uses base 8/12/15/18; adjustments weak +2, strong −3, excellent −5; and a clamp of 5–22:
  1. Trivial secrets get no roll instead of DC 8, since blind QA disliked "dice with nothing at stake".
  2. Steps are symmetric (±3), so DCs land on 12/15/18.
  3. Disposition is added, worth ±3.
  4. Explicit "yes" and "no" thresholds replace the clamp, since rolls at DC 5 or DC 22 are both pointless.
  5. The let-it-ride and new-angle gate is added.

### 3.4 When not to roll

| situation | ruling | why |
|---|---|---|
| ordinary question they'd happily answer | no pressure, no roll (already in `v2-pressure`) | Angry: no reason to refuse, no conflict |
| `free`, trivial stakes, or gap ≤ 0 | **yes**: they give it up | Dogs, 2024 "willing", Draw Steel automatic tier 3, Sly |
| `no_chance`, or gap ≥ 4 | **no**: they hold, and the reply shows what would reach them | 2024 "unwilling", PF2e "impossible", Dungeon World Parley |
| same push after a failed roll | **no** (let it ride): impatience, plus the lever | The Alexandrian, Burning Wheel, 2024's 24 hours, Draw Steel's repeated argument |
| follow-up on a secret already won | no roll: success rides | The Alexandrian on social skills |
| an authored route covers it | the authored check (authored routes already take precedence) | – |

There is a softer alternative to "no" for the same push, and `garrows-toll` already uses it: allow a retry, but one step harder (14 → 16 in `threaten-again` and `lie-again`). That fits a scene built around one gatekeeper. Let it ride fits better when other routes exist.

Optional, to try in QA: **two strikes**. After two failed rolls on the same person in one scene, they won't discuss it again unless something important changes. This follows the Angry GM's Patience, Draw Steel's patience and The Alexandrian's "fail by 10 or more".

### 3.5 What success and failure mean (GM directions)

Work out the band in code from the roll and pass it with the reveal or hold instruction:

```ts
const band = roll.success
  ? (roll.critical === "success" || roll.total - dc >= 5 ? "yes_and" : "yes")
  : (roll.critical === "failure" || dc - roll.total >= 5 ? "no_and" : "no_but");
```

- **Yes, with no roll:** "No dice needed: {name} gives it up, in their own way and voice, as far as the question reaches." For dangerous and ruinous secrets add: "It still costs them: they ask something in return, or make the player promise" (Ironsworn's weak hit, Dungeon World's Parley).
- **No, with no roll:** "{name} doesn't give it up. Don't reveal it. Let their reaction show what kind of thing would reach them (what they want, what they fear), without spelling out the answer." Never say "no roll" in the fiction ("never speak the name of your move").
- **Success:** "{name} gives up what fits the question." Then by means and margin:
  - **Intimidation or deception:** "They talk, but they'll remember how: cooler towards the player from here on" (PF2e Coerce, The Alexandrian).
  - **"Yes, and"** (a natural 20, or beating the DC by 5 or more): "and a little more than asked: a name, a detail, the next thing they know" (Draw Steel interest 5, Blades great effect).
- **"No, but"** (missed by 1–4): "Not yet, but nearly: {name} doesn't give it up, but names a price or a condition, or lets slip a partial truth that points somewhere useful. Don't reveal the secret itself" (The Alexandrian's counter-offer, PF2e Request, Draw Steel interest 2, Blades limited effect).
- **"No, and"** (missed by 5 or more, or a natural 1): "{name} holds firm and it costs the player: their attitude hardens, they shut this line down, and the beat's pressure may come in (they call for someone, walk off, warn someone). Their reaction still shows what might reach them later" (The Alexandrian's failing by 10 or more, PF2e critical failure, Blades 1–3, Dungeon World hard move).
- **Always:** "Nothing already said is taken back. If this is something the scene needs, leave a way to it." Don't use false information as a failure result for essentials. PF2e Gather Information does, but for us it reads as the game lying.

**Insight is a special case.** Insight reads people; it doesn't compel them (The Alexandrian: social skills give information). A success could reveal the *lever* (the fear, the tell, the hole in the story) rather than the secret itself, for dangerous and ruinous secrets. The next push then counts as strong. The authored `catch-moll` edge has her crack on a successful Insight read, which is also fine when someone is cornered. Try both in QA.

### 3.6 The player-facing reason

Today's line, `🎲 Persuasion check to calm Tam and earn his trust: 20 + 2 = 22 vs DC 10: success`, already names the goal. For pressure checks:

- **Goal:** `to get {name} to {ask}`, where `ask` is the authored question, worded as the question, never the answer ("say who paid her", not "admit Master Sallow paid her"). If no `ask` is authored, fall back to the current means-based templates ("to frighten {name} into talking").
- **Then one bracket.** It holds a stakes clause: guarded "a sore point", dangerous "dangerous to admit", ruinous "it could ruin them". Add at most one modifier clause, preferring approach over disposition:
  - strong: "your leverage helps"
  - excellent: "you've given them every reason"
  - weak: "you've given them no reason to"
  - hostile: "they don't trust you"
  - friendly: "they like you"

  A plausible approach with a wary holder adds nothing. This is the part that teaches players that leverage and relationships matter. It also only describes things the character could see, in line with The Alexandrian's open/hidden DC rule.
- **No dice line for "yes" or "no".** The narration carries those.

Examples:
- `🎲 Persuasion check to get Moll to say who paid her (dangerous to admit; your leverage helps): 11 + 3 = 14 vs DC 12: success`
- `🎲 Intimidation check to make Garrow admit what came out of the hedge (dangerous to admit; they don't trust you): 8 + 1 = 9 vs DC 18: failure`
- `🎲 Deception check to trick the courier into naming what she carries (it could ruin them): 16 + 4 = 20 vs DC 18: success`

---

## 4. Worked examples from our scenes

The secrets and attitudes are quoted from the cast cards in `scenes/`. Several turns are the inputs of the in-progress `src/eval/cases/pressure.ts`.

| turn | stakes | approach | disposition | gap | ruling |
|---|---|---|---|---|---|
| Moll: "If they come back for the boy, I want to be standing between them. Who was it?" (card: "She'll break her story to protect Cob, never to save herself") | dangerous (2) | strong (+1); excellent (+2) if played well | wary (0) | 1 (0) | **DC 12** (excellent → **yes**) |
| Moll: "Lying to the King's investigator is a hanging matter… you'll be in irons by noon" | dangerous | `no_chance` (never to save herself) | – | – | **no**: she spits back, and her eyes go to Cob |
| Cob: flips a copper, "now tell me what you saw last night" (card: bought attention isn't trust) | dangerous | `no_chance` | – | – | **no**: he boasts, but says nothing he saw |
| Cob: "You keep the boots; I only want a look inside" (card: he might let someone look if he keeps them) | guarded (1) | strong (+1): his own condition | wary (0) | 0 | **yes** |
| Garrow: "Something came out of that hedge after Tam left, didn't it, warden?" (card: "Accusations and bare insistence only make him deny it harder; it comes out when he's shown something he can't wave away or given a decent way to admit it") | dangerous (2): the arrow he didn't log, "nearly a crime" for him | weak (−1): bare insistence, by his card | wary (0) | 3 | **DC 18**. Pointing at the fresh arrow-hole in his own door makes it strong: **DC 12**. Adding a decent way to admit it (the Book's Clause of Perils) makes it excellent: **yes**. (If the player is reading him, the authored `read-garrow` Insight check at DC 11 takes precedence.) |
| Snikkit: a silver ring for who came to Gubbin's hall (card: "would trade the story for something") | guarded (1) | strong (+1) | wary (0) | 0 | **yes** |
| The courier: "What's in the satchel?" (sworn to secrecy about the treasury credit) | ruinous (3) | plausible (0) | wary (0) | 3 | **DC 18**. Showing proof of the plot makes it strong: **DC 15**. A bare demand while she's hostile: gap 5, **no** |
| Tam, calmed and asked kindly what's in his smock (embarrassed he meant to sell it) | guarded (1) | plausible (0) | friendly (+1): "clings to anyone who treats him kindly" | 0 | **yes** |
| Kell: "Why does this one matter to you?" (card: she'll say if asked) | – | `free` | – | – | **yes** |

Under this model, `pr-moll-protect` (which currently expects a roll) should also accept `pressure:free:moll` when the approach is judged excellent. The other rows that come from `pressure.ts` (Moll threatened, Cob's coin, Cob's boots, Snikkit, Garrow, Kell) match its expected answers. I didn't check its remaining cases against the model.

---

## 5. Fit with the runtime, and evals

- **Code shape.** Replace `pressureDc(stakes, fit)` with a ruling function like §3.2, returning yes, no or roll. Feed the band into `pressureDirective()` (§3.5) and the gloss into `describeRoll(roll, reason)` (§3.6). Add one `pressure_disposition` question, and a `pressure_new_angle` question only after a failed roll. Keep the existing per-keeper `stakes_*` question as the fallback when a secret has no authored `stakes`.
- **State.** Record `pressed[holder:secret] = { turn, means, approach, band }` so let it ride, success rides, and the optional two strikes have something to check. Disposition doesn't need its own state. The decider reads it from the transcript each turn, and the GM's narration of a cooler attitude after "no, and" carries it.
- **Several secrets per holder.** Ask "which secret is the player after?" with each secret's authored `ask` as a criterion. If the target becomes a (holder, secret) pair, the gate's confidence can be the holder's summed probability. That avoids the "near-duplicate options split the vote" problem in FINDINGS.
- **Authored routes.** They still take precedence (`!move`). As an option, treat an authored check's DC as the plausible-and-wary baseline and apply the same ±3 steps. Then authored routes reward leverage the same way, which authors currently do by hand in prose ("a fair trade or a real promise… needs no dice").
- **Essentials.** A failed pressure roll on a secret that carries an essential shouldn't block later relocation. (The engine currently drops relocation on a failed *authored* roll in the same turn, which is fine. Just don't record the essential as lost.)
- **Latency.** There are no new calls. The decision stays at about 0.25–0.35 s, and the numbers come from code.

**Evals to add** (decision suite unless noted):
1. **Terse but strong.** "I put the black-fletched arrow from his drawer on the counter." Expect strong or excellent, not weak.
2. **Long but empty.** A florid speech with no offer, threat or evidence. Expect plausible at most. This tests verbosity bias.
3. **Disposition flip.** The same plausible ask about a guarded secret: friendly gives "yes", hostile gives DC 15.
4. **Let it ride.** After a failed roll on Moll, the same plea reworded gives no roll. New evidence (the coin seen in her fist) gives a roll again.
5. **Success rides.** A follow-up question after a won secret gets no roll.
6. **Too far.** A hostile holder, a bare demand, a dangerous secret: "no", and the reply shows the lever.
7. **Reply suite.** "No, but" names a price or partial truth without revealing the secret. "No, and" costs something without a dead end. Intimidation that succeeds carries a relationship cost.

**What to measure in trajectories and blind QA.** Record the mix of yes / roll / no rulings on pressure turns, and how often leverage-bearing approaches (strong or excellent) end in the player's favour. Ask blind players whether leverage felt rewarded, whether refusals without a roll felt fair (did they show what would work?), and whether any roll felt pointless.

---

## 6. Open questions

- **Authored or judged stakes?** I recommend authoring them. Judging stakes every turn adds noise, and it's the input authors know best.
- **The specialist edge case.** At gap 4, a +8 specialist would have had a 40% roll. The model says no, on the grounds that leverage, not skill, is missing. If QA finds that unfair, allow a DC 20 roll at gap 4 when the player's modifier for the chosen means is +6 or more.
- **Help from others.** Another character backing the player (Kell vouching for them) could grant advantage, in the spirit of 5e's Help action. That's for a later round.
- **Partial truths.** A "no, but" partial truth could quietly reveal too much. Watch the reply-suite judge for leaks, which is the FINDINGS "secret-giveaway pressure" problem.
- **Should "excellent" exist at all?** It's adjacent to "strong" and might split votes. If it does, merge it into "strong". Strong already reaches "yes" for a guarded secret with a wary or friendly holder, and for a dangerous one with a friendly holder.

---

## Sources

**D&D 5e**: [Free Rules (2024): Playing the Game](https://www.dndbeyond.com/sources/dnd/free-rules/playing-the-game) · [Free Rules (2024): Rules Glossary (Influence, attitudes, D20 Test)](https://www.dndbeyond.com/sources/dnd/free-rules/rules-glossary) · [Basic Rules (2014): Adventuring, Social Interaction](https://www.dndbeyond.com/sources/dnd/basic-rules-2014/adventuring) · [2014 DMG Conversation Reaction table, as reproduced on GM Binder](https://www.gmbinder.com/share/-N9SrnKXADHF-PzsAl0_/-N9Tfnwv_Hqnqs56P5jS/source)

**The Angry GM**: [Marvelous Mechanical Miscellany](https://theangrygm.com/marvelous-mechanical-miscellany/) · [Systematic InterACTION!](https://theangrygm.com/systematic-interaction/) · [Resolving Social Actions](https://theangrygm.com/resolving-social-actions/)

**The Alexandrian**: [Art of Rulings](https://thealexandrian.net/wordpress/4238/roleplaying-games/the-art-of-rulings) · [Part 5: Skill and Difficulty](https://thealexandrian.net/wordpress/38039/roleplaying-games/art-of-rulings-part-5-skill-and-difficulty) · [Part 8: Let It Ride](https://thealexandrian.net/wordpress/38313/roleplaying-games/the-art-of-rulings-part-8-let-it-ride) · [Part 12: Hidden vs Open Difficulty Numbers](https://thealexandrian.net/wordpress/39142/roleplaying-games/art-of-rulings-12-hidden-vs-open-difficulty-numbers) · [Part 13: Hidden vs Open Stakes](https://thealexandrian.net/wordpress/39367/roleplaying-games/art-of-rulings-13-hidden-vs-open-stakes) · [GM Don't List #2: Rolling to Failure](https://thealexandrian.net/wordpress/38798/roleplaying-games/gm-dont-list-2-rolling-to-failure) · [Rulings in Practice: Social Skills](https://thealexandrian.net/wordpress/43360/roleplaying-games/rulings-in-practice-social-skills) · [Rulings in Practice: Gathering Information pt 2](https://thealexandrian.net/wordpress/39653/roleplaying-games/rulings-in-practice-gathering-information-part-2-improvisation-and-tiered-information) · [Advanced Rules: Diplomacy (3e)](https://thealexandrian.net/?p=700) · [Random D&D Tip: Reactions & Relationships](https://thealexandrian.net/wordpress/50021/roleplaying-games/random-dd-tip-relationships-reactions) · [Failure for the Beginning GM](https://thealexandrian.net/wordpress/46186/roleplaying-games/failure-for-the-beginning-gm) · [Three Clue Rule](https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule)

**Sly Flourish**: [How to Choose DCs](https://slyflourish.com/choosing_dcs.html) · [Our Ability Check Toolbox](https://slyflourish.com/ability_check_toolbox.html) · [1d20 Shades of Gray](https://slyflourish.com/1d20_shades_of_grey.html) · [Numbers to Keep in Your Head](https://slyflourish.com/numbers_to_keep_in_your_head.html) · [Lazy GM's Resource Document](https://slyflourish.com/lazy_gm_resource_document.html) · [Revealing Secrets](https://slyflourish.com/revealing_secrets.html) · [Secrets Serve You](https://slyflourish.com/secrets_serve_you.html)

**Blades in the Dark SRD**: [Action Roll](https://bladesinthedark.com/action-roll) · [Effect](https://bladesinthedark.com/effect) · [Consequences & Harm](https://bladesinthedark.com/consequences-harm) · [Gathering Information](https://bladesinthedark.com/gathering-information)

**Pathfinder 2e (Archives of Nethys)**: [Difficulty Classes, GM Core p. 52](https://2e.aonprd.com/Rules.aspx?ID=2627) · [Specific Actions: Social Skills, GM Core p. 53](https://2e.aonprd.com/Rules.aspx?ID=2633) · [Social Skills (older edition)](https://2e.aonprd.com/Rules.aspx?ID=558) · [Gather Information](https://2e.aonprd.com/Actions.aspx?ID=49) · [Request](https://2e.aonprd.com/Actions.aspx?ID=51) · [Coerce](https://2e.aonprd.com/Actions.aspx?ID=52) · [Influence stat blocks, GM Core p. 188](https://2e.aonprd.com/Rules.aspx?ID=1202) · [Ad Hoc Bonuses and Penalties, GM Core p. 28](https://2e.aonprd.com/Rules.aspx?ID=2557)

**PbtA**: [Dungeon World: Parley](https://roll20.net/compendium/dw/Parley) · [Dungeon World: The GM](https://roll20.net/compendium/dw/The%20GM)

**Others**: [Draw Steel: Negotiation (Steel Compendium)](https://steelcompendium.io/compendium/main/Rules/Chapters/Negotiation/) and [rules text](https://github.com/SteelCompendium/data-rules-md/blob/main/Chapters/Negotiation.md) · [Ironsworn move data (Datasworn)](https://github.com/rsek/datasworn) · [GUMSHOE](https://en.wikipedia.org/wiki/Gumshoe_System) · [Dogs in the Vineyard](https://en.wikipedia.org/wiki/Dogs_in_the_Vineyard) · [Burning Wheel forum: letting it ride](https://forums.burningwheel.com/t/letting-it-ride-example/15700) · [Cypher System Reference Document](https://callmepartario.github.io/og-csrd/) · [Zheng et al. 2023, Judging LLM-as-a-Judge (verbosity bias)](https://arxiv.org/abs/2306.05685)
