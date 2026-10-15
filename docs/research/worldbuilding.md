# Worldbuilding for an improvising GM

**The question.** The user summarised what Sly Flourish, The Alexandrian and Dungeon World say about worldbuilding in three ideas:
1. Build outward from the players.
2. Establish causes, not just facts: why something exists, who benefits from it and who resents it.
3. Create a world that moves on its own.

This doc checks those ideas against the sources and turns them into formats for `lore/World` and `lore/Places`. It also covers how a scene's prep should draw on that lore, how the world can move between chained scenes, and what the background agents should record. It ends with a critique of the Caerwyn lore and of the arc `hanged-clerk` → `drowned-rat` → `heron-warehouse` (with the interludes `caerwyn-afternoon` and `wharf-night` between them).

**Status.** This is research and design only. Nothing here is built. The constraints are those in [FINDINGS.md](../FINDINGS.md):
- a resolving reply within 5 s;
- the GM is Luna at reasoning `none`, with one call per reply;
- decisions are fast parallel classification calls;
- prompts are phrased as outcomes, not as lists of do's and don'ts;
- characters never act as hint-dispensers who recite the GM's plan.

The lore conventions are those in [lore/index.md](../../lore/index.md):
- docs are public, private or gm;
- a public doc's secrets go in a "(truth)" doc beside it;
- each doc ends with "Read when relevant" links whose labels say when to open them.

Disclosure is progressive ([disclosure.ts](../../v2/ai/docs/disclosure.ts)). The scene's `lore` docs are always in the GM's brief. A linked doc opens when the per-turn decider rates it above 0.7. Edits made during play go into a per-session overlay.

**What this doc doesn't repeat.** General GM craft is in [ai-gm-and-craft.md](ai-gm-and-craft.md) §2: situations rather than plots, the Three Clue Rule, and the PbtA principles. The pacing of reveals is in [pacing.md](pacing.md) and [pacing-failures.md](pacing-failures.md). Moving a missed clue is in [gm-techniques.md](gm-techniques.md), and the repair co-GM is in [experiments/deviation-repair.md](../experiments/deviation-repair.md). The world-state ledger is in [compaction.md](compaction.md), and bills for daft acts are in [experiments/absurdity.md](../experiments/absurdity.md). This doc is about the world those scenes stand in.

## Summary

- **The sources back all three ideas and add three more:**
  1. **Build outward from the player, and leave blanks.** This covers spiral development, "two horizons out", "draw maps, leave blanks" and "the key is geography, not ephemera".
  2. **Write causes, not facts.** Give each institution a want, say who gains and who pays, and name the rule that holds it in place. The sources here are Apocalypse World's fundamental scarcity and "straightforward, sensible self-interests", Dungeon World's impulses and steading tags, and the Angry GM's Second Story.
  3. **The world moves while the player isn't looking.** The sources are fronts and grim portents, countdown clocks, Blades' faction clocks, and The Alexandrian's timeline of bangs and event fallout.
  4. **Show the world through play.** A fact should reach the player as something seen or overheard, at a moment it matters, from someone who'd say it. In The Alexandrian's words, the fallout is "vectored so that it intersects the PCs".
  5. **In comedy, the world doesn't know it's funny.** "Discworld isn't internally funny to the people who live there". The jokes come from causes followed through, as in Pratchett's vet.
  6. **Write down what play establishes, and send the bill.** The sources are The Alexandrian's continuity notes and event fallout, and Dungeon World's "it'll come back to bite them later… Make a note".
- **For a GM that improvises without reasoning, causes are the useful kind of prep.** A cause answers the questions play actually asks: why the watch won't help, who wants this hushed up, what a porter thinks of Saltmere. It keeps improvised details tied to threads already in play, which is the GM prompt's rule against invented hooks. It also drives the comedy: an institution follows its own logic off a cliff, and the people inside it take it seriously.
- **Caerwyn's docs already state causes well, in single lines.**
  - Purveyance is the King's right, "which farmers call robbery and purveyors call tradition".
  - "Visitors notice the gilt. The city notices the bread."
  - The Captain's book sets out a rule, who enforces it, and what it costs to break it.
  - The arc's limits rest on one world cause, the Assembly: 11 of the 24 limits across the three scenes.
- **They're weak on sides, on motion and on keeping each fact in one place.**
  - The Grain Crisis is a list of facts and rumours.
  - No world doc says what happens next.
  - Sallow's only move off-stage is one `if` in the last scene's card.
  - World facts the arc depends on live only in scene prose, such as the Rat's rules board and "the docks shut tomorrow". Facts kept there drift: the interlude's "Saltmere herons" undoes the heron as a clue.
- **Proposed formats:**
  - **World and place docs** get fixed sections: why it's like this, who does well out of it, who pays, the rules and who keeps them, how it touches ordinary people, what people say (and who says it), and what's happening now.
  - **A gm doc, `World/Fronts.md`.** Each front names who's behind it, what they want and the resources they have. It has a clock of steps written with "if" and "shows as", a doom, and stakes questions. The clock is a Markdown checklist in the session overlay, so the existing doc tools can tick it.
  - **A short public doc, `World/Caerwyn now.md`.** It's always in the GM's brief for arc scenes and interludes. It holds the hour, the price of bread, the talk around town (each item with the people who say it), and what the town says about the investigator.
  - **At each scene boundary the world takes a turn.** A step ticks when play made it true, or when time has passed. Each front shows at most one new step, and each step gets a vector: a way the player will meet it in the next scene or interlude. The interludes, which stand in for the map, are where the town shows it.
  - **The background lore reviewer records causes along with changes.** It ticks steps, or strikes out ones that no longer make sense, and keeps "what's happening now" current by replacing it rather than appending.
- **Concrete fixes for the arc** ([§4.3](#43-proposed-rewrites)):
  - rewrite the Grain Crisis around causes and sides;
  - give the Assembly a timetable;
  - write Caerwyn's fronts;
  - move world facts out of scene prose and into the lore;
  - settle what the heron means;
  - answer Prout's "Who pays the hedge-folk?" in the true book;
  - let the granary's outcome reach Sallow through the Captain, so the first scene changes the third.

---

## 1. What the sources say

### 1.1 Build outward from the player, and leave blanks

- **Sly Flourish** builds from the characters outwards ([2023](https://slyflourish.com/build_from_the_characters_outwards.html)):
  - "The characters are the heroes of the worlds we create together. They're the focus of our lens." The world outside their view "doesn't yet exist — except for the villains and their own quests."
  - "As GMs, we keep the horizon line always moving outward, just beyond what the characters can see so they know there's a world out there even if it isn't right in front of them."
- **Two horizons** ([2020](https://slyflourish.com/thinking_two_horizons_out.html)):
  - The first horizon is "Where are they now? What's going on there? Who will they meet?"
  - The second is "What is over the hill? What's beyond the wood?… If we want to drop seeds of future adventures, we need to think two horizons out."
  - A far place needs only "a good evocative name", and "three is a great number".
- **Spiral development** ([2023](https://slyflourish.com/spiral_campaign_building.html)) starts from the observation that "Often DMs and designers build worlds from the outside in." Instead, ask about the starting place, its people and its villains: "What villains are in play in this area? What do they want? What quests are they on themselves? What friction do they cause? Pick three." Also: "Your world can be vast, deep, and old but the way you expose that to the characters, and their players, is through gameplay."
- **Just in time** ([Lazy World Building, 2025](https://slyflourish.com/lazy_world_building.html)): "Instead, build each part as you need it for the next session." The Angry GM puts it more bluntly: "The world exists to let games happen." "There's no world outside the game." ([How to Homebrew, 2020](https://theangrygm.com/how-to-homebrew/))
- **Dungeon World: draw maps, leave blanks** ([The GM](https://roll20.net/compendium/dw/Rules:The%20GM)): "When you draw a map don't try to make it complete. Leave room for the unknown. As you play you'll get more ideas and the players will give you inspiration to work with. Let the maps expand and change." On the campaign map: "Use pencil: this map will change," and "Don't add too much in the first session, leave blanks and places to explore" ([The World](https://github.com/Sagelt/Dungeon-World/blob/master/text/The_World.xml)).
- **The Alexandrian: key what lasts.** In a hexcrawl, "the key is geography, not ephemera" ([Hexcrawl, 2012](https://thealexandrian.net/wordpress/17308/roleplaying-games/hexcrawl)).
- **A city is many layers on one map.** "The city is not a single urbancrawl, but rather a multitude of urbancrawls that lie on top of each other in a simultaneous coexistence." "Each urbancrawl layer basically boils down to one way in which the content of the city can be contextualized": a gang's activities, patrons, heist targets ([Urbancrawls part 10, 2015](https://thealexandrian.net/wordpress/36600/roleplaying-games/thinking-about-urbancrawls-part-10-one-city-many-urbancrawls)).

**For us.** "The player" is the scene. The first horizon is the scene's place doc, and the world docs are one link out. The second horizon is the next scene's place: named and given a line, not keyed in full. The arc is already built this way (a scene's `lore` → its place doc → the world docs). The layer idea is worth taking on directly. Each world doc is a layer running across the places (the grain crisis in the yard, the Rat and the kitchens), and each place doc should say how each layer shows there.

### 1.2 Causes, not facts

- **Apocalypse World: whose scarcity?** "A front is a set of linked threats. Threats are people, places and conditions that, because of where they are and what they're doing, inevitably threaten the players' characters." "Underlying every front is a fundamental scarcity": hunger, thirst, ignorance, fear, decay, despair, envy or ambition. "Ask yourself: whose hunger threatens the players' characters?" ([AW 1st ed.](https://lumpley.games/apocalypse-world/), Fronts, p. 138).
- **People with plain self-interest.** "Make your NPCs human by giving them straightforward, sensible self-interests… They do what they want to do, when they want to do it, and if something gets in their way, well, they deal with that now" (AW, The Master of Ceremonies, p. 113).
- **Resources tell you what they'll do.** "Listing each threat's available resources will give you insight into who they are, what they need, and what they can do to get it. It's especially useful to give some threats resources that the PCs need but don't have" (AW, p. 133).
- **Impulses** ([Dungeon World: Fronts](https://roll20.net/compendium/dw/Fronts)): "Every danger has a crucial motivation that drives it called its impulse… Impulses can help you translate the danger into action." The organisations come ready-made: "Corrupt Government (impulse: to maintain the status quo)", "Thieves Guild (impulse: to take by subterfuge)" and "Cult (impulse: to infest from within)".
- **Places described by what they need and resent** (DW [steadings](https://github.com/Sagelt/Dungeon-World/blob/master/text/The_World.xml)). A steading has tags, and the relational ones carry its causes:
  - "Need: The steading has an acute or ongoing need for the listed resource. That resource sells for considerably more."
  - "Trade: The steading regularly trades with the listed steadings."
  - "Enmity: The steading holds a grudge against the listed steadings."
  - Oath, Personage and History tags do similar work.
- **Ask what the opposition is trying to do** ([Don't Prep Plots, 2009](https://thealexandrian.net/wordpress/4147/roleplaying-games/dont-prep-plots)): "A situation, on the other hand, is merely a set of circumstances." "Instead of trying to second-guess what your PCs will do… simply ask yourself, 'What is the bad guy trying to do?'" Then "you'll usually be laying out what would happen if the PCs don't get involved." The follow-up adds: "What are the NPCs' plans?" ([Tools, Not Contingencies, 2015](https://thealexandrian.net/wordpress/37422/roleplaying-games/dont-prep-plots-tools-not-contingencies)).
- **The Second Story** ([Angry GM, 2024](https://theangrygm.com/the-second-story/)) is a background situation that everyone is living through.
  - "Everyone's responding to the stress in different ways… Some are doing the best they can with the resources they've got; some are plotting and scheming to take advantage of the situation."
  - It shows in passing: "Innkeepers apologize about the poor fare or patrons complain that there's barely any meat in the stew."
  - It's an improvisation engine: "every time a nonplayer character ends up on camera, you can just ask, 'How is The Second Story affecting this dude or dudette?'" Because "Every nonplayer character has crap going on too."
- **Fate's setting issues** ([Game Creation](https://fate-srd.com/fate-core/game-creation)): "Decide what threats and pressures inherent to the setting will spur the protagonists to action."

**For us.** A fact is inert and a cause is generative. Given "who gains, who pays", the GM can derive how anyone the player meets feels about the matter in hand. That's the Second Story question, answered from prep rather than invented on the spot, so the improvised detail stays tied to threads in play.

Caerwyn's causes have two faces. The public one is "lost to goblins"; the true one is Sallow's racket. Both are causes, and the public/truth split says who can know which.

### 1.3 A world that moves without the player

- **Fronts** ([DW](https://roll20.net/compendium/dw/Fronts)): "Fronts are secret tomes of GM knowledge. Each is a collection of linked dangers… It also includes one or more impending dooms, the horrible things that will happen without the characters' intervention."
  - **Grim portents** are "dark designs for what could happen if a danger goes unchecked… When you're not sure what to do next, push your danger towards resolving a grim portent."
  - **Two ways to advance.** "You can advance a grim portent descriptively or prescriptively. Descriptively means that you've seen the change happen during play, so you mark it off… Prescriptive is when, due to a failed player move or a golden opportunity, you advance the grim portent as your hard move."
  - **Off-stage.** "Always remember, fronts continue along apace no matter whether the characters are there to see them or not. Think offscreen, especially where fronts are concerned."
  - **Aftermath.** "Even if a danger is stopped, if any grim portents are fulfilled, the world is changed, if only in subtle ways."
  - **The world worsens by default.** "Think dangerous: … The world changes. Without the characters' intervention, it changes for the worse" ([DW: The GM](https://roll20.net/compendium/dw/Rules:The%20GM)). The world, in turn, "reflects the actions the players take to stop or redirect them" ([DW: The World](https://github.com/Sagelt/Dungeon-World/blob/master/text/The_World.xml)).
- **Countdown clocks** (AW, pp. 144–146) are "a reminder to you as MC that your threats have impulse, direction, plans, intentions, the will to sustain action and to respond coherently to others'".
  - **Three zones.** Before 9:00, "that thing's coming, but preventable. What are the clues? What are the triggers?" From 9:00 to 12:00 it's "inevitable, but there's still time to brace for impact." At 12:00 "the threat gets its full, active expression."
  - **Derailing.** "Countdown clocks can be derailed: when something happens that changes circumstances so that the countdown no longer makes sense, just scribble it out."
  - **Prep circumstances, not scenes.** "When you list something within the players' characters' control, always list it with an 'if'… Prep circumstances, pressures, developing NPC actions, not… NOT future scenes you intend to lead the PCs to."
  - **Stakes** are "things you're genuinely interested in finding out, not in deciding."
- **Faction clocks** ([Blades SRD](https://github.com/amazingrando/blades-in-the-dark-srd-content)): "Each faction has a long-term goal. When the PCs have downtime, the GM ticks forward the faction clocks that they're interested in. In this way, the world around the PCs is dynamic and things happen that they're not directly connected to, changing the overall situation in the city and creating new opportunities and challenges."
  - Also: "consider how a PC operation might affect the NPC clocks, whether the players intended it or not."
  - **Tug-of-war clocks** can fill and empty: "a 'Revolution!' clock that indicates when the refugees start to riot over poor treatment. Some events will tick the clock up and some will tick it down" ([Progress Clocks](https://bladesinthedark.com/progress-clocks)).
  - **Fortune rolls** decide what nobody was there to see: "When you need to make a determination about a situation the PCs aren't directly involved in and don't want to simply decide the outcome." AW's principle is the same: "Sometimes, disclaim decision-making" (p. 116).
  - **Entanglements** bring consequences home between jobs: "After each score, you roll dice to find out which entanglement comes calling" ([Entanglements](https://bladesinthedark.com/entanglements)).
- **The campaign status document** ([Smart Prep part 4, 2019](https://thealexandrian.net/wordpress/42961/roleplaying-games/smart-prep-part-4-campaign-status-documents)):
  - **A timeline of bangs.** The entries are "more like bullets waiting to be fired". "When the moment arrives, the actual bang will be customized to the circumstances of the PCs" ([Inserting Bangs, 2025](https://thealexandrian.net/wordpress/52722/roleplaying-games/ptolus-running-the-campaign-inserting-bangs)).
  - **Background events.** "Background events are a second timeline of future events running in parallel with the timeline of bangs. These are the events which DON'T directly affect the PCs, but which are nevertheless taking place and moving the campaign world forward."
  - **Event fallout** ([2022](https://thealexandrian.net/wordpress/48624/roleplaying-games/campaign-status-module-event-fallout)): "A GM's role at the table can be almost entirely described as providing the world's response to a PC's actions." The PCs "knock over a chain of dominos which continue to topple offscreen: They leave evidence of their break-in and the Herschfelds begin an investigation."
  - **Knowledge bounds who can act.** "For example, the spineseeker won't show up in the Banewarrens because the chaos cultists don't know about the Banewarrens" ([Inserting Bangs](https://thealexandrian.net/wordpress/52722/roleplaying-games/ptolus-running-the-campaign-inserting-bangs)).
- **Sly Flourish on fronts:**
  - "Campaign fronts are the external motivators in a campaign. Like a battlefront (from which they're named), a front is a point of conflict that advances and retreats as the campaign develops" ([Lazy GM's Resource Document](https://slyflourish.com/lazy_gm_resource_document.html)).
  - From [Looking Back on Dungeon World Fronts (2016)](https://slyflourish.com/looking_back_on_fronts.html): "However the PCs move, these villains move forward as well."
  - His simplified front: "Who is the major NPC? What is their goal? Who is their lieutenant? What group enforces their will?" Then: "What are the visible steps the villains will take to inflict their doom upon the world?"
  - Two warnings. First: "Good fronts, grim portents, and impending dooms are only good if the PCs can learn about them." Second: "If the fronts move too fast, the PCs can find themselves defeating one villain only to have two others succeed with their nefarious plots… they're always two steps behind with the other two."
- **The Angry GM** ([Open-World Lesson Five, 2021](https://theangrygm.com/angry-open-world-lesson-five/)): "A dynamic world feels like it's always spinning away, whether the players are on-screen or not." "Left to its own devices, the world won't just go right on sucking, it'll suck more and more each and every day."

**Where the sources agree:**
- Give each mover a want and a few visible next steps.
- Advance them between sessions: mostly from what the player did, partly from time, and by dice when nobody was there to see.
- Write the steps as circumstances with an "if", never as scenes to lead the player to.
- Make every step learnable.
- Don't move many fronts at once.

### 1.4 Show the world through play

- **Reveal history in passing.** "Reveal history in secrets and clues as the characters explore the world" ([Lazy World Building](https://slyflourish.com/lazy_world_building.html)). "You can take a bunch of lore and break it down to ten one-sentence bits you can drop into your game wherever you need it" ([Bathe Your World in Lore, 2024](https://slyflourish.com/bathe_your_world_in_lore.html)).
- **Show what happened while they were away.** "Think offscreen too. When it's time for you to make a move, imagine what your many various NPCs must have been doing meanwhile. Have any of them done something offscreen that now becomes evident?" (AW, pp. 115–116). "Announcing off-screen badness is good too. After all, badness elsewhere now will usually become badness here later" (AW, p. 119). Dungeon World says the same: "Make your move elsewhere and show its effects when they come into the spotlight."
- **Vectors** ([Ask the Alexandrian #21, 2025](https://thealexandrian.net/wordpress/52952/roleplaying-games/ask-the-alexandrian-21-keeping-track-of-an-open-table)): "you have a bunch of factions in the campaign world, they're doing stuff, and the fallout from that stuff should be vectored so that it intersects the PCs." "Rumors, job offers, and random encounters are typical examples."
  - With too few vectors, "the faction's actions are creating tiny little ripples."
  - Headline news is "the 'talk around town'", and it's best woven "into your downtime procedures (rather than just reading out the list)."
- **Reputation as a menu.** "The quick rep reference basically gives me a menu of stuff that I can have NPCs who recognize the PCs mention." "Their reaction depends on their opinion of the actions the PCs' took" ([Reputation, 2024](https://thealexandrian.net/wordpress/51265/roleplaying-games/ptolus-running-the-campaign-reputation)).
- **Specifics, and people who stay true to themselves.** "Never describe anything in general without adding something specific" (Angry GM, Lesson Five). "Your NPCs have to act truthfully to themselves, not simply fit the sort of arc you think they should fall into" ([Build Worlds, Not Stories, 2013](https://slyflourish.com/build_worlds_not_stories.html)).

**For us.** This is the vector rule, and it agrees with our hard-won rule against hint-dispensers. A world fact reaches the player in one of three ways:
- something seen or done (a dented wheat-ear canvas, two lanterns where there was one);
- talk from the people who'd say it, said once;
- a pressure on the scene.

A character brings the world up because it bears on what they want: "Tuppence a loaf, and you want me to talk for free?" They never bring it up to point the player at the plot.

### 1.5 Comedy: the world doesn't know it's funny

- **Pratchett on Discworld.** "I have to repeat the old mantra: Discworld isn't internally funny to the people who live there -- there's no baseball playing frogs" ([Words from the Master](https://www.lspace.org/books/apf/words-from-the-master.html)).
- **His method is an incentive followed through to an institution.** "I think that sick people in Ankh-Morpork generally go to a vet. It's generally a better bet. There's more pressure on a vet to get it right. People say 'it was god's will' when granny dies, but they get angry when they lose a cow" ([Pratchett Quote File](https://www.lspace.org/books/pqf/alt-fan-pratchett.html)).
- **The stakes stay real.** "In HOGFATHER there are a number of stabbings, someone's killed by a man made of knives, someone's killed by the dark, and someone just been killed by a wardrobe. It's a book about the magic of childhood. You can tell." On consistency: "There are no inconsistencies in the Discworld books; ocassionally [sic], however, there are alternate pasts." And: "However, you do need rules." (same file).
- **A silly premise run as an institution.** Ankh-Morpork's Thieves' Guild shows the whole structure. There's a cause (organised crime is easier to tax), a rule, an enforcer, beneficiaries and people who resent it ([L-Space: Thieves' Guild](https://wiki.lspace.org/Thieves%27_Guild)):
  - the rich pay "an annual premium";
  - everyone else is robbed politely and left "a receipt which guarantees that these people will not be inconvenienced with another official robbery for the rest of the year";
  - "A significant proportion of what it reaps every year via its criminal activities is paid on to the City as Guild Tax";
  - unlicensed thieves meet the Guild's enforcers.
- **Even narrative is a law of nature.** On the Discworld "things which have a one-in-a-million chance of succeeding often do so" ([L-Space: Narrativium](https://wiki.lspace.org/Narrativium)).
- **AW's moves for afflictions read like straight-faced stage directions for a crisis.** "Someone proclaims the affliction to be a just punishment." "Someone proclaims the affliction to be, in fact, a blessing." "Someone refuses or fails to adapt to new circumstances" (AW, p. 141).

**For us.** Comic worldbuilding is causal worldbuilding with the dial turned up. Each institution has a sensible origin, takes itself entirely seriously, and follows its rule one step past sense: purveyance, wheat-ear silver, "After the Assembly." That lets the GM improvise jokes that are also consequences, which is what [tone-comic.md](../../v2/ai/prompts/tone-comic.md) asks for ("every daft act sends a bill"). A doc that only lists funny facts gives the GM one joke each; a doc that gives the cause gives it a joke generator.

### 1.6 Write it down, and send the bill

- **Continuity notes** ([2023](https://thealexandrian.net/wordpress/49799/roleplaying-games/campaign-status-module-continuity-notes)): "sometimes it's a detail just random enough that it has no place to live, but is still compelling enough to be preserved and reincorporated into the campaign. For that stuff, there's the 'Known Facts' section."
- **Fallout as solo roleplay** ([Event Fallout](https://thealexandrian.net/wordpress/48624/roleplaying-games/campaign-status-module-event-fallout)): "I'm putting myself in the shoes of the NPCs involved, thinking about how they would react, then looking at the NPCs who would be affected by that and then figuring out how they would react."
- **Bills that come due later** (DW, The GM): "If your first instinct is that this won't hurt them now, but it'll come back to bite them later, great! That's part of your principles (think offscreen too). Make a note of and reveal it when the time is right."
- **Promote people who act.** "Whenever an NPC develops agency, though, list her as a threat" (AW, p. 147).
- **The cast as a menu** ([Supporting Cast, 2023](https://thealexandrian.net/wordpress/49970/roleplaying-games/campaign-status-module-supporting-cast)). "The cast list, therefore, can ultimately be thought of as a menu," and "Each reappearance of an NPC will deepen that character."
- **The timeline of bangs** is "a list of 'things I don't want to forget to have happen.'" The campaign status document as a whole "is, above all, a living document" (Smart Prep part 4).

### 1.7 Where the sources pull against each other, and what that means for an LLM GM

| tension | sources | our call |
|---|---|---|
| Are secrets fixed or open until found? | Sly: secrets "don't even become true until the characters learn them" ([Six Truths](https://slyflourish.com/understanding_the_six_truths.html)). AW: stakes are found out, not decided. | Several agents read the same lore (GM, decider, reviewers, characters), so **load-bearing truths are fixed** in gm docs: the racket, the murder, who knows what. Everything else is left unwritten and filled in play, under the GM prompt's "world has edges" rule. |
| Be wildly specific, or don't open mysteries? | Angry GM: "The trick is to be specific. Like amazingly specific," even "when you've got no idea what the specific means". Our GM prompt: "A detail that opens a brand-new mystery promises a story nobody has prepared." | A human GM remembers what the specific meant. Ours forgets unless a reviewer records it. **Be specific with texture tied to an existing cause** (thin stew because bread is dear), not with signs nobody can explain. |
| A moving world, or the player's agency? | AW: "NOT future scenes you intend to lead the PCs to." Sly: "always two steps behind". | Fronts change circumstances inside the scenes the player is in. They never pull the player to a scene. Each front shows at most one step per boundary, and signs come before consequences. |
| Prep the world, or only what the game needs? | Sly: "Worlds are independent of the characters and their goals," and also "build each part as you need it". | Both. Causes are independent of the player (Sallow steals grain whether or not anyone looks), but write only the parts the next scene can touch. |
| Rumours as signposts, or characters as hint-dispensers? | The Alexandrian: rumours carry fallout to the PCs. Our playtests: characters must never recite the GM's plan. | Rumours have mouths and are said once. A person passes on talk because it matters to them. |

---

## 2. How this maps onto our formats

### 2.1 What world and place docs should contain

Keep each doc short. The current ones are 1.3–3.8 KB, and the reader is a model with no reasoning time, so a list of causes beats a page of history. Each section below answers a question play actually asks.

**A world doc (public)** is an institution, a condition or an event: the Watch, the Grain Crisis, the Assembly.

```markdown
---
summary: "<what it is, who's involved, its causes and what's happening now, in words a player would use>"
type: "world"
visibility: "public"
---
# <Name>

<One or two sentences: what it is, as anyone in Caerwyn would put it.>

**Why it's like this.** <The cause: a scarcity, a rule, a history, someone's interest. One to three bullets.>

**Who does well out of it.** <Named people or groups, and what they get.>
**Who pays for it.** <Named people or groups, and what it costs them.>

**The rules, and who keeps them.** <Each rule, who enforces it, and what breaking it costs.>

**How it touches ordinary people.** <One or two concrete, everyday things: a price, a queue, a bell, a thinner stew.>

**What people say, and who says it.** <Each rumour with the people who'd say it. One mouth per rumour, said once.>

**What's happening now.** <Short and current. Play keeps it up to date: the world turn and the lore reviewer replace it, they don't append. Only what anyone could see or hear.>

## Read when relevant
<Labelled links. A label says when to read the doc, never what's in it; the truth doc's label says "GM only".>
```

**Its truth doc (gm)** holds:
- what's really going on (the true cause);
- who knows what;
- what would prove it;
- a link to the front that's in motion.

The truth doc keeps the backstory. The front keeps what happens next.

**A place doc (public).** This draws on Sly's three fantastic aspects, DW's steading tags and The Alexandrian's "geography, not ephemera".

```markdown
# <Place>

<First glance: three things you'd notice, smell or hear.>

**What's here.** <What lasts: ways in and out, things to use, climb or hide behind.>
**Who's about, and why.** <Each regular, and what they want here.>
**What it needs, trades and resents.** <Need (X), trade (Y), grudge (Z), and someone notable.>
**The rules of the place, and who keeps them.** <The rules board, the custom, the warden.>
**How the town's troubles show here.** <Each world layer as it appears in this place: dear bread is thinner stew.>
**What's happening now.** <Current state, kept by play.>
**Room to improvise.** <Optional: what the GM may freely invent here (regulars, songs, the house dish), tied to the place's troubles.>

## Read when relevant
```

"Room to improvise" turns DW's "leave blanks" into an explicit grant: it tells the GM where invention is safe. The scene's `limits` already say where it isn't.

### 2.2 How a scene's prep should draw on them

| scene field | what it takes from the world | arc example |
|---|---|---|
| `lore` | The place doc, plus `World/Caerwyn now.md` (§4.3, R4). The world docs stay one link out. | Today each scene lists only its place doc. |
| `setting`, `opening` | One detail of the Second Story as it looks *here*. Conditional lines for front positions, never a position assumed. | The Rat is full "because the docks shut tomorrow for the procession". |
| `cast` | Each person's wants and fears say where they stand on the world's causes: what they gain, what they pay. | Nan's jar of heron pennies "marked FOREIGN". Saul is paid "three times what the river watch did". Hep "skims a sack a night for the gang's families". These are the model. |
| `limits` | Cite a world rule and its enforcer rather than restating it in new words, so there's one source of truth to update. | The watch "lining the Assembly route" is restated 6 times across the three scenes. |
| `pressure` | At least one pressure from a front or the Assembly clock. | Already so: the noon dead-cart, the eleventh bell, the ebb. |
| `exits[].script` | Tick the fronts this ending moves. These are defaults the scribe reconciles, as [FINDINGS](../FINDINGS.md) §7 recommends for all exit scripts. | `prout_death` is set but nothing reads it downstream (§4.2, G7). |
| `essentials` | Only the world facts the scene needs to reach an ending. Background world facts stay thin and earned ([pacing.md](pacing.md) §1.2, "the concept prong can be thin"). | — |

The existing authoring rule says cards are "written neutral to earlier outcomes". Extend it to fronts: **cards read the world's state; they don't assume it**. For example: "If the Captain has told him the clerk went in as a murder, he's wary: the Crakes walk the wharf before he comes."

### 2.3 A world that moves in a scene-chained game

**Where the world's moves live: `lore/World/Fronts.md` (gm).** Each front holds:
- who's behind it, what they want, and their resources;
- a clock of steps, each with a trigger ("if…", or a time) and **shows as** (what someone could see or hear when it happens);
- a doom;
- stakes questions;
- the exits that tick it.

The clock is a Markdown checklist (`- [ ]`/`- [x]`), so the doc tools the lore reviewer already has (`read_doc`, `edit_doc`) can tick it. The per-session overlay keeps each playthrough's state separate. A step that no longer makes sense is struck out with the reason, following AW's rule: "just scribble it out". The worked example is in [§4.3, R4](#r4-new-worldfrontsmd-gm-and-worldcaerwyn-nowmd-public).

**When it moves: mostly at scene boundaries.** Fronts don't move on the GM's per-turn path, which keeps the 5 s budget untouched. Within a scene, the background lore reviewer may tick a step that play has plainly made true (§2.4); its effects surface at the next boundary. At each exit with a `next`, in this order:
1. **Descriptive ticks** come from what play did: the exit, its flags, and the hand-off. Exit scripts run against a recording world (the Phase 2 stub), and their `setFlag` calls are kept with the ended scene in `state.ended.operations`. That's a deterministic signal the boundary step can read today, though nothing reads it yet. Where the author can predict a tick, the exit script sets a flag and the fronts doc keys its step on that flag; `prout_death` already exists. The scribe reconciles the odd cases.
2. **Time ticks** come from the Assembly clock. In-fiction time passes between scenes (morning → evening → midnight), and fronts driven by time, like the bread, tick once per boundary.
3. **Uncertain off-stage outcomes** go to a fortune roll, as in Blades, not to the model's taste. The rule is AW's "Sometimes, disclaim decision-making". It also guards against an LLM's bias towards drama.
4. **Knowledge check: nobody moves on what they couldn't know.** This is The Alexandrian's spineseeker rule. Sallow can send the Crakes after Hobb only if someone told him Hobb was talking.
5. **Write it up:**
   - tick the clock;
   - replace the 1–3 items in `Caerwyn now.md` that changed, each with its mouth and its place;
   - add a line to "What's happening now" in the touched place or world doc;
   - add any bill now due to the gm fronts doc, as a bang with an "if" and a vector.

**Who does the turn.** Start with the cheapest version, which needs no new model call:
- authored exit flags;
- a time tick in code;
- each step's authored "shows as", copied into `Caerwyn now`.

Add a "world turn" agent only if play keeps producing endings nobody wrote. It would be Luna at low reasoning, run in the background alongside the hand-off, which is also written at the exit, and would read the transcript, the exit and `Fronts.md`. If it's late, the interlude's second reply picks it up, the same way the background co-GM's notes land a turn later.

**How it reaches the player.** Every step that becomes visible needs at least one vector the player will meet in the next scene or interlude, or it's invisible ("only good if the PCs can learn about them"). Vectors, in order of preference:
1. **Something seen or done:** a dented wheat-ear canvas at the service entrance, two lanterns at the Heron's land door where there was one.
2. **Talk from the people who'd say it**, said once: porters on the stairs, the kitchens, Nan at a price.
3. **A pressure in the scene**, such as a Crake on the plank walk.

The interludes are made for this. Each is downtime "standing in for the world map", and its opening already says "show the town". Change that to "show the town as it is now, including what's new in Caerwyn now", which is The Alexandrian's headline news woven "into your downtime procedures (rather than just reading out the list)". A character never announces a plan. Not "Sallow knows you're coming", but two lanterns where there was one.

**Guardrails.** These come from the sources and from our own failures:
- One visible step per front per boundary, and at most two fronts surfacing in one scene (Sly's "always two steps behind").
- A front changes circumstances. It never adds routes or endings to a scene; that's for the author and the co-GM.
- Show a sign before a consequence, which is DW's soft and hard moves at world scale.
- The world turn never answers a stakes question.
- When play has made a step meaningless, strike it out; don't force it.
- Fronts are for the world's movers. The player's own threads are tracked by quests and memories.

**How we'd know it works.** Three checks:
- **A boundary eval.** Given an exit, the flags and a fronts state, does the turn tick exactly the right steps and respect who knows what? This uses labelled cases checked by hand, like the decision suite.
- **A surfacing eval.** In the next interlude's opening and the next scene's first replies, does each new step show once, as something seen or as talk from a plausible mouth, without anyone reciting a plan? This is the information audit from [pacing.md](pacing.md) §4 pointed at world facts.
- **A blind QA question.** "Did anything you did earlier come back to you from someone who wasn't there? Did the town seem to be getting on with its own troubles?"

### 2.4 How background agents should record world changes

Today, per flagged turn, the lore reviewer runs [review/improvised.md](../../v2/ai/prompts/review/improvised.md) and [review/world.md](../../v2/ai/prompts/review/world.md), with [review/focused.md](../../v2/ai/prompts/review/focused.md) as shared rules. It edits or creates lore docs and saves memories. At scene end the runtime:
- runs the exit script against a recording world;
- writes the hand-off, which is saved as the scene's story doc and linked from the story index;
- gives everyone present a memory of how the scene ended.

The scribe reconciles world scripts only on demand (`npm run scene -- world`). What's missing is any notion of what's in motion, of who cares about a change, or of the talk around town.

Proposed changes, each small:
1. **Record a change where it lives, and replace what's current.** A change goes in the "What's happening now" section of the place or world doc it belongs to, replacing the old state. Dated history goes under a short "What's happened" list, so later scenes can cite it. *(Add to review/world.md.)*
2. **Record the cause with the change.** Say who did it, who saw it, who gains, who's hurt or angry, and which front it touches. That's what lets the next GM improvise a reaction, by asking the Second Story question of whoever's on camera. *(Add to review/world.md: "Say who did it and who will care: who it helps, who it hurts, and what it moves.")*
3. **Tick steps descriptively, and strike out the derailed ones.** When play makes a listed step happen, tick it in `Fronts.md`. When play makes a step impossible, strike it out and say why. Never tick a step because it would be dramatic: that's the world turn's job, under its rules.
4. **Talk around town goes into `Caerwyn now`, with a mouth.** Only things anyone could have seen or heard go in public docs. What a particular person saw stays in their memories (the existing memory reviewer). GM truths stay in gm docs.
5. **Keep the player's reputation as a menu.** The player doc already records what the player has told people about themselves. Add "What Caerwyn says about them", one line per public deed ("the King's investigator who got a sergeant to sign a hanged clerk in as a murder"), so strangers have something to react to. This is The Alexandrian's reputation menu.
6. **Promote people who start acting on their own.** When an improvised person starts acting on their own wants, give them a line in a cast doc and, if they push on the world, a place in a front, or in the general list (AW's "home front"). *(Add to review/improvised.md.)*
7. **Bills are entries in the fronts doc, not memories.** A daft act's delayed consequence is a bang with an "if" and a vector. For example: "If the player comes back to the Rat: Nan has a bill for the door, four shillings and sixpence, and now the window too." That's DW's "Make a note of and reveal it when the time is right". It's also what [absurdity.md](../experiments/absurdity.md) found missing: "The bill that comes due *later* needs memory: the world-state tracker and world patches."
8. **Never invent a mystery or a front.** A reviewer reconciles what play made true. It doesn't add new threads.
9. **Keep summaries current.** A doc's frontmatter `summary` is what the disclosure decider reads. When "What's happening now" changes materially, update the summary's last clause so the doc still opens when it matters.

---

## 3. Checklist

**A world doc**
- [ ] One line of what it is, as a local would say it.
- [ ] Why it's like this: a cause, not a date.
- [ ] Who does well out of it and who pays for it, by name.
- [ ] Each rule with its enforcer and the price of breaking it.
- [ ] One or two concrete ways it touches ordinary people.
- [ ] What people say, each item with the people who say it.
- [ ] What's happening now: short, current, public.
- [ ] A truth doc beside it for what's really going on and who knows, linked to its front.

**A place doc**
- [ ] Three things you'd notice at a glance.
- [ ] What lasts: ways in and out, what's there to use.
- [ ] Who's about, and what each of them wants here.
- [ ] What it needs, trades and resents.
- [ ] The rules of the place and who keeps them.
- [ ] How each of the town's troubles shows here.

**A front**
- [ ] Who's behind it, what they want, and their resources.
- [ ] Three to five steps, each with an "if" or a time, and each saying how it shows.
- [ ] A doom, and one to three stakes questions you won't answer by fiat.
- [ ] Which exits tick which steps.

**A scene**
- [ ] `lore` lists the place doc and `Caerwyn now`.
- [ ] The setting shows one detail of the town's troubles, as they look here.
- [ ] Cast cards say where each person stands on the world's causes.
- [ ] Limits cite world rules rather than restating them.
- [ ] Exits tick fronts, and cards read front positions without assuming them.

**Between scenes**
- [ ] Ticks from play first, then from time, and dice for uncertain off-stage outcomes.
- [ ] One visible step per front, each with a vector in the next scene or interlude.
- [ ] Nobody acts on what they couldn't know.

**Background agents**
- [ ] Record it where it lives: replace what's current, keep a short history.
- [ ] Record the cause: who did it, who saw, who gains, who's hurt, which front.
- [ ] Tick or strike out steps. Never answer a stakes question.
- [ ] Public talk has a mouth. Truths stay in gm docs.

---

## 4. The Caerwyn lore and the arc: a critique

### 4.1 What already works

- **Causes with a resenter, in one line.** These are §1.2 and §1.5 in miniature:
  - "**Purveyance**: by ancient right the office buys for the King at the King's price, which farmers call robbery and purveyors call tradition." ([Royal Purveyor's Office.md](../../lore/World/Royal%20Purveyor's%20Office.md))
  - "**Purse silver**: the office's purse money is stamped with a little wheat-ear so the palace kitchens can't pinch it, which the kitchens have never forgiven." This line also gives a clue its cause: it's why Moll's coin can be traced to the office.
  - "Visitors notice the gilt. The city notices the bread." ([Royal Palace.md](../../lore/World/Royal%20Palace.md))
- **Rules with an enforcer and a cost.** "**The Captain's book**: every death in the city goes in it as natural, accident, self-murder or murder, and the Captain's word stands. A sergeant may sign a body in as a murder instead, and answers to the Captain for it" ([City Watch.md](../../lore/World/City%20Watch.md)). That one rule is the engine of the whole first scene. [City Watch (truth).md](../../lore/World/City%20Watch%20%28truth%29.md) gives the Captain motives rather than a price ("Sallow arranged for the Purveyor's office to feed the watch on Assembly duty"; Sallow's own gm doc: "The Captain isn't bought, just obliging"), and it plans his reaction under pressure: "once it can't be made to [go away], his second is to have suspected Sallow all along."
- **One world cause behind many limits.** The Assembly explains why no help comes in every scene. 11 of the 24 limits in the three arc scenes rest on it. The granary warden: "This week she's at the palace counting Assembly provisions." The watch house bell is "to ring when nobody's behind it (this week, always)". This is principle 2 doing the improvising.
- **Straight-faced comic logic.**
  - "'Lost to goblins' is what Caerwyn says now about anything that goes missing: a hat, a husband, the rent. It stopped being funny about a fortnight ago."
  - "Farmers have never seen goblins carry off a whole wagon of wheat, and wonder where a goblin would sell one." This one is a clue delivered as folk logic.
  - "the answer to every request is 'After the Assembly.'"
  - The King's cushions are a joke followed through across scenes. He "takes his guests' comfort very seriously, down to the cushions". The linen under-purveyor "is having a very bad week about the cushions". In `blocked-entrance` the cushions are stuck in the wagon queue under a leaking tarpaulin.
- **The scenes' best causal worldbuilding** is in Scrope's card ([heron-warehouse.ts](../../scenes/heron-warehouse.ts)), on why the proof exists at all: "the Master doesn't trust the Saltmere factor and the factor doesn't trust the Master, so both insisted on a true book kept by a clerk they both pay. There is no honour among thieves; there is bookkeeping." That's a cause, two sides and a joke, and it makes the climax possible.
- **Truth splits and "read when" labels** keep secrets out of characters' reach. The links let the decider pull in the world one hop out.

### 4.2 What's missing

**G1. Facts without causes or sides.** [Grain Crisis.md](../../lore/World/Grain%20Crisis.md), the arc's Second Story, opens: "The harvest was poor, the Nine Furrows granaries are thin, and bread in Caerwyn has gone up a penny a loaf since the autumn." Then it lists four rumours. Several things are missing:
- the price of a loaf, against the porter's eight pennies a day that [Caerwyn.md](../../lore/World/Caerwyn.md) does give;
- who profits from dear bread;
- who's hit hardest;
- what anybody is doing about it.

[Centennial Assembly.md](../../lore/World/Centennial%20Assembly.md) is a timetable and a list of delegations. Its one cause, "Every hundred years the kingdoms must publicly recognise one common sovereign", doesn't say why they must. The answer, Edric's Concord, sits in [King Aldren/public.md](../../lore/Cast/King%20Aldren/public.md). The levy and the arms order have no resenters, though both have obvious ones: travellers, and carters on a road where goblins shoot oxen.

**G2. Nothing is in motion outside the scene cards.** The world docs describe the eve as a still photograph. The truth doc gives Sallow a motive, "**Why**: money, and standing. An Assembly short of grain and money is one the Purveyor's office gets to save, and Sallow means to be the man who saves it", but no next steps. Sallow's gm doc gives the endgame ("to sell the King his own grain back at Assembly prices and be thanked for it with the Purveyor's chain"), but nothing on the way there.

The only move the world makes off-stage in the whole arc is one secret in Sallow's `heron-warehouse` card: "If Hobb ran to him from the Rat, he knows the King's investigator and a watch sergeant are asking about the loft." Every clock is scene-local (the noon dead-cart, the eleventh bell, the ebb), so nothing carries the town forward between scenes.

**G3. Rumours without mouths.** The Grain Crisis's "What people say:" lists four rumours but not who says them. Public docs are readable by any character, so any of them may recite any rumour, and may do so more than once. That's the hint-dispenser and repetition risk (the "Nagging" row in [pacing.md](pacing.md) §0).

**G4. World facts that live only in scene prose.** If play comes back to a place, or a later scene needs these facts, the lore doesn't have them. The reviewers then have nowhere to record a change.
- The Rat's rules board exists only in `drowned-rat`'s setting. [The Drowned Rat.md](../../lore/Places/The%20Drowned%20Rat.md) says only "The house rules are posted by the door and enforced, by Nan and by Manners."
- "Paid off early because the docks shut tomorrow for the procession", a good cause for the full room, is not in [River Stairs.md](../../lore/Places/River%20Stairs.md).
- The cause of the true book, and the night staff with their wages and their fears, are not in [Heron Warehouse (truth).md](../../lore/Places/Heron%20Warehouse%20%28truth%29.md). That doc has a list of game moves instead: "**Ways in**: sneaking, bluffing as a buyer, bribing the night watch, Hobb's token, or a diversion."

**G5. Drift across authored layers.** The interlude's setting has "delegation banners (Nine Furrows wheat-sheaves, Saltmere herons, Kläggenheim axes)" ([interludes.ts](../../scenes/interludes.ts)). The lore says the heron is "the house mark of a Saltmere grain factor". If the heron is Saltmere's own emblem:
- heron pennies become ordinary Saltmere money;
- Nan's jar of pennies "nobody on the river had seen before this month" stops making sense;
- the sign over the Heron stops pointing at one buyer.

An author's improvisation has quietly changed what a clue means, and no world doc says what the heron is, so nothing caught it.

A second example is the design doc's hub. [caerwyn-arc.md](../design/caerwyn-arc.md) sends players to the Corn Exchange, where Abel Fennick "knows which wagons were 'lost'", and [Caerwyn.md](../../lore/World/Caerwyn.md) says the Exchange keeps "the wagon lists". But there's no place doc for it, and the afternoon interlude closes "the Corn Exchange's back rooms" by limit.

**G6. Scenes restate the world instead of reading it.** Each arc scene's `lore` is only its place doc, so the world docs arrive only if the per-turn decider opens them. The scenes compensate by restating world facts in their settings and limits; the watch "lining the Assembly route" appears in 6 places across the three scenes. That's fine for a still world, but once the world moves, restated facts go stale. Once the bread front has a crowd at the Corn Exchange board, a setting that mentions only bunting and dear bread is out of date.

**G7. Exits don't move the world beyond the next scene's needs.** `hanged-clerk`'s exits record `prout_death` and the quests, and nothing downstream reads them: the next scene learns only what the hand-off prose says. Kell signing Prout in as a murder is exactly a domino that "continue[s] to topple offscreen":
- Tull answers to the Captain;
- the Captain's instinct is "to make it go away without fuss";
- Sallow has promised to see that the Captain rides at the head of the procession.

Yet `heron-warehouse` knows only one way Sallow can be warned (Hobb running). So the first scene, the one the player worked hardest at, can't change the third.

**G8. A question the arc raises but can't answer.** The page in Prout's boot ends: "'Not goblins. Who pays the hedge-folk?'" The answer is in [Grain Crisis (truth).md](../../lore/World/Grain%20Crisis%20%28truth%29.md): Sallow pays the goblins of the burnt mill in heron pennies. In the arc only Sallow knows it, as one of the secrets on his `heron-warehouse` card, and the goblins of `warren-hostage` know only "a grey hood, lavender and heron pennies, but no name". Heron pennies turn up at the Rat and at the Heron, but nothing a player can find links them to goblins. The GM prompt warns against "clues and mysteries that point somewhere the story doesn't go". This one points somewhere the story does go, but leaves no way in.

### 4.3 Proposed rewrites

New specifics below (prices, the preacher, the lanterns) are proposals for the arc's author to check against [caerwyn-arc.md](../design/caerwyn-arc.md). Everything else is drawn from the existing lore and scenes.

#### R1. The Grain Crisis (public): causes, sides and mouths

Now (abridged): "The harvest was poor… bread in Caerwyn has gone up a penny a loaf since the autumn. On top of that, the palace's own grain has been going missing… What people say: …"

Proposed:

```markdown
# The Grain Crisis

Bread in Caerwyn is tuppence a loaf, a penny dearer than at harvest. A porter earns about eight pennies a day.

**Why it's dear.**
- The harvest was poor, and the Nine Furrows granaries are thin.
- The palace buys first. By the King's right of purveyance the Royal Purveyor's office buys at the King's price, so farmers bring the palace what they must and sell the rest where it fetches more.
- The palace's own grain keeps going missing: a dozen wagons on the King's Road this past month, "lost to goblins", each written off in the Royal Granary Roll and countersigned by the Purveyor's office.
- The Assembly feast must be fed regardless. The office says it has the matter in hand.

**Who does well out of it.** The grain factors at the Corn Exchange, who chalk up a new price at the noon bell. Saltmere buyers on the wharves, whose barges go downriver full. The Purveyor's office, which expects to be thanked for feeding the feast at all.

**Who pays.** Porters, carters and granary rats, for whom a loaf is a quarter of a day's work. Farmers, who sell to the King at the King's price. The Treasury, which writes off every "lost" wagon, and this week is collecting a shilling a head from travellers "to defray the costs of the Centennial".

**The rules, and who keeps them.** Palace grain lost on the road is written off in the Roll and countersigned by the Purveyor's office, and nobody else checks. Prices are the Corn Exchange's business. The watch keeps the King's peace, not the price of bread.

**What people say, and who says it.**
- Everyone: "lost to goblins", about anything that goes missing (a hat, a husband, the rent). It stopped being funny about a fortnight ago.
- Carters: they won't take the King's Road after dark without a patrol, and there are no patrols.
- Farmers at market: they've never seen goblins carry off a whole wagon of wheat, and wonder where a goblin would sell one.
- Dock-porters: Saltmere barges are taking grain downriver while Caerwyn goes short.
- The palace kitchens: the feast will be fed because the office says so, and the office's word is stamped on its pennies.

**What's happening now.** Queues at the bakers at first light. The Corn Exchange chalks up the day's price at the noon bell.
```

The Treasury line ties two existing facts together: the write-offs, and the levy from [Centennial Assembly.md](../../lore/World/Centennial%20Assembly.md). Why the Treasury is really short (Saltmere's credit, snatched with the courier in `warren-hostage`) stays in the truth doc.

#### R2. The Grain Crisis (truth): what Sallow does next

Keep the backstory. Add one section, pointing to the front rather than duplicating it:

```markdown
## In motion

Sallow's next moves, and what each looks like when it happens, are in [Fronts](Fronts.md) under "The Purveyor's man". Tonight he is at the palace offices until the midnight bell, then at the Heron to see the *Patience* loaded and to initial the true book.
```

#### R3. The Centennial Assembly: who wants what, and the week bell by bell

Add after "The arrangements":

```markdown
**Who wants what from it.**
- **King Aldren**: to be recognised again as common sovereign under Edric's Concord, with nobody upset.
- **The delegations**: under the Concord each kingdom keeps its own rulers and laws and pays tribute; the Assembly is where that is renewed, and argued over.
- **The Purveyor's office**: the feast is theirs to supply, grain crisis or no grain crisis, and they mean to be thanked for it.
- **The city**: cheaper bread and a day off. It is getting a procession.

**Who resents it.** Travellers paying the Treasury's shilling a head. Carters and drovers paying the Marshal's two pennies a weapon on a road where goblins shoot oxen. Anyone who has noticed the gilt and the bread on the same day.

**The week, bell by bell.**
- **The eve** (today): every official is at the palace, and the answer to every request is "After the Assembly." The docks shut tomorrow for the procession, so the river pays off early tonight.
- **After dark**: the palace is shut to everyone but the delegations' dinner and the procession rehearsal.
- **Procession morning**: the procession leaves the palace gate and winds through the market square, with the whole watch lining the route.
- **The Assembly sits** in the Great Hall, then the feast.
- **After the Assembly**: officials, the watch surgeon and the granary warden can be found again, and a case can be laid before the King, who signs nothing that might upset anyone.

**The banners.** Caerwyn: <emblem>. Nine Furrows: the wheat-sheaf. Kläggenheim: crossed axes. Saltmere: <emblem, not a heron; see R7>.
```

#### R4. New: `World/Fronts.md` (gm) and `World/Caerwyn now.md` (public)

`Fronts.md`, the worked example:

```markdown
---
summary: "GM only: what's in motion in Caerwyn on the eve of the Assembly, and what each mover does next if nobody stops them: Master Sallow closing his loose ends, dear bread heading for a riot, and the Assembly timetable. Each step says what sets it off and how it shows."
type: "world"
visibility: "gm"
---
# What's in motion

Tick a step when play makes it true or its time comes. Strike a step out, with the reason, when play makes it meaningless. Each step says how it shows: what someone could see or hear.

## The Purveyor's man
**Who**: Master Josiah Sallow, with Big Hobb Mallory, the Crake brothers and the Heron's people. **Wants**: the clerk Prout's business closed for good, tidily, with no loose ends; the barge away on the ebb; the Purveyor's chain. **Resources**: his office (papers, keys, the Captain's goodwill), heron pennies, the Crakes, the river.

- [x] Prout is filed as a suicide at Sallow's request. *Shows as*: Corporal Tull's written order.
- [ ] **If** Prout goes into the Captain's book as a murder (`prout_death` is "murder, Sallow named" or "murder, unnamed"): by the afternoon bells Tull has told the Captain, and the Captain mentions it to Sallow at the palace, without fuss. Sallow is wary, not warned: he doesn't know who's asking. *Shows as*: Kell's runner brings word that the Captain wants her report "after the Assembly"; before midnight the Crakes walk the Heron's wharf with a lantern, and there are two lanterns at the land door instead of one.
- [ ] **If** the wheat-ear crown is shown where the office will hear of it (the palace, the kitchens, the Corn Exchange): Sallow learns a granary girl kept his coin. *Shows as*: a Crake in the granary quarter asking after "the girl in the shawl".
- [ ] **If** Hobb runs from the Rat to his master (`sallow_warned`): Sallow knows the King's investigator and a watch sergeant are asking about the loft. *Shows as*: he comes at the bell sharp and hurrying, with Hobb at his heels, and wants the true book sewn into oilcloth and aboard the *Patience*.
- [ ] **At the second bell after midnight**, unless stopped: the *Patience* sails with the King's grain. *Shows as*: by morning the Heron is swept and empty.
- **Doom**: on procession morning the office "saves" the feast with the King's own grain, bought back at Assembly prices, and Sallow is thanked for it. Prout stays in the pit.
- **Stakes**: Will Hobb live to swear to what he did? Will Moll keep her crown, and her neck? Will Kell's notebook count for more than the Captain's book?
- **Struck out if** Sallow is arrested (`caught-in-the-act`). The front becomes the office closing ranks the morning after: papers, the Captain, Sir Gilbert's signature.

## Dear bread
**What**: the price of bread and the city's patience. **Clock**: a tug-of-war. Time and bad news fill it; good news empties it.

- [x] A penny dearer since the autumn, and "lost to goblins" has stopped being funny.
- [ ] **At each scene boundary on the eve**: the Corn Exchange chalks up another rise. *Shows as*: the price board in the market square; Nan's eel stew thinner than it was; Cob hungrier.
- [ ] A preacher at the market cross calls dear bread a judgement on the bunting. *Shows as*: a sermon preached to a bread queue.
- [ ] A crowd at the Corn Exchange board, and a cabbage thrown at a Purveyor's wagon. *Shows as*: a dented wheat-ear canvas at the palace service entrance.
- [ ] Procession morning: people along the route who came to shout "lost to goblins!" at the Purveyor's carriage.
- **Doom**: a bread riot on the procession route, in front of four delegations.
- **Ticks down if** people hear that the King's "lost" grain has been found. **Ticks up if** grain burns or sinks (`up-in-smoke`).
- **Stakes**: Who will Caerwyn blame: goblins, Saltmere or the office?

## The Assembly week
A timetable, not a danger: see [The Centennial Assembly](Centennial%20Assembly.md). It's why nobody can help today, and when the case can go to the King.
```

`Caerwyn now.md`, as authored for the start of the arc. Play replaces its lines:

```markdown
---
summary: "How Caerwyn stands right now, on the eve of the Centennial Assembly: the time, the price of bread, the talk around town and who's saying it, and what people say about the King's investigator. Kept up to date as the story goes on."
type: "world"
visibility: "public"
---
# Caerwyn now

**When**: the eve of the Centennial Assembly, mid-morning. The procession leaves the palace gate tomorrow morning.
**Bread**: tuppence a loaf, and the Corn Exchange chalks up the day's price at the noon bell.
**The talk around town**:
- Market folk: a palace clerk hanged himself behind the granary. The Captain says so.
- Porters: the docks shut tomorrow for the procession, so the river pays off early tonight.
- Carters: nobody takes the King's Road after dark, with the patrols all called in for the route.
**The King's investigator**: nobody in Caerwyn knows them yet.
```

How the arc's exits would move these, and where each move shows:

| exit | what it sets | what moves | where it shows |
|---|---|---|---|
| `hanged-clerk` → case-made, open-case | `prout_death` = murder… | Purveyor's man: the Captain tells Sallow | **afternoon**: Kell's runner; the market says a sergeant signed the clerk in as a murder, over the Captain's word. **wharf-night / heron**: the Crakes on the wharf, two lanterns |
| `hanged-clerk` → wrong-man | `prout_death` = blamed on a child | Sallow relieved; the Captain files it gladly | **afternoon**: the market says a granary brat did for the clerk and the watch has the child. **Rat**: Nan has heard which investigator had a child taken up |
| `hanged-clerk` → closed-suicide, walked-away | `prout_death` = suicide | nothing: Sallow is unhurried | **heron**: one lantern, the Master on time and bored |
| any boundary | time | Dear bread ticks | **afternoon**: the price board. **Rat**: thinner stew. **heron**: the gang grumbles at double pay "and still can't buy bread" |
| `drowned-rat` → hobb-fled | `sallow_warned` | Purveyor's man: Sallow warned | **wharf-night**: lavender on the stairs before midnight. **heron**: Sallow with Hobb at his heels, the book in oilcloth |
| `drowned-rat` → thrown-out | Nan bars the player | a bill, as a bang with an "if" | **wharf-night**: porters on the stairs have heard that "the sergeant's friend got Manners". **Later**: the door bill |
| `heron-warehouse` → up-in-smoke | fire or a sunk barge | Dear bread jumps: "lost to goblins" becomes "lost to fire" | (after the demo) |

#### R5. River Stairs and The Drowned Rat: move the world facts into the lore

Add to [River Stairs.md](../../lore/Places/River%20Stairs.md):

```markdown
**What it needs, trades and resents.** The docks live on loads, and the Saltmere factors pay best: the Heron pays double for night loading, and doesn't care for questions. The river watch, whose patch this is, is on the Assembly route with everyone else. Porters grumble about Saltmere barges going downriver full while Caerwyn goes short, and take Saltmere's money anyway.
**What's happening now.** The docks shut tomorrow for the procession, so the river paid off early tonight and the Rat is full.
```

Replace the Drowned Rat's one-line rules with the board itself, its enforcer and its price, so the rules survive the scene:

```markdown
**The rules of the house**, painted by the door in Nan's own capitals: 1. No credit. 2. No blades out. 3. No fighting indoors. 4. No watch on duty. 5. No singing before the ninth bell. 6. What's said in the Rat stays in the Rat. 7. Gossip sold by the measure. By order, N. Quill. Enforced by Manners. One warning for small things, none for a fist or a blade. (Nan sees no contradiction between six and seven: the gossip is sold in the Rat.)
**Gossip by the measure**: a gill (a penny) for what everyone on the stairs knows, a half (tuppence) for what most don't, a pint (fourpence) for what only Nan knows. She doesn't sell quarts: a quart'll get you drowned.
```

#### R6. The Heron warehouse (truth): the book's cause and the night staff's stakes

Now: "**The true book**: the warehouse's own ledger of every 'lost' royal wagon it bought, re-sacked and sold. This is the proof." … "**Ways in**: sneaking, bluffing as a buyer, bribing the night watch, Hobb's token, or a diversion."

Proposed: keep the facts, and move the list of game moves to the scene, which already has them. Add:

```markdown
**Why the book exists.** Sallow doesn't trust the Saltmere factor and the factor doesn't trust Sallow, so both insisted on a true book kept by a clerk they both pay: Mister Lemuel Scrope. There is no honour among thieves; there is bookkeeping.
**Who pays for it.** Hep Grist's re-sacking gang, on double pay and frightened of the gallows (receiving the King's grain is a hanging matter); Hep skims a sack a night for the gang's families. Saul Tench the watchman, paid three times what the river watch paid, who knows whose grain it is and minds his own business. Scrope, who was Wendell Prout's oldest friend and doesn't believe he hanged himself.
```

#### R7. Settle the heron

Pick one meaning and write it into the world docs. The arc's clues only work if the heron is one factor's private mark, so:
- change the interlude's "Saltmere herons" to Saltmere's own emblem (a ship suits "ships, warehouses, insurance and credit");
- list every delegation's banner in [Centennial Assembly.md](../../lore/World/Centennial%20Assembly.md) (R3), so the next author doesn't have to guess;
- add one line of cause to [Heron Warehouse.md](../../lore/Places/Heron%20Warehouse.md): why the factor pays in new heron-stamped silver.

#### R8. Scenes: read the world, move the world, and close the loop

1. **`lore`.** Add `"World/Caerwyn now.md"` to each arc scene and interlude, so the current situation is always in the GM's brief.
2. **`hanged-clerk` exits.** The scripts already record `prout_death`, which is the flag the fronts doc keys on. Have the boundary step (§2.3) read it from the ended scene's recorded operations. Add one line to Kell's interlude business: "If Prout went in as a murder, the Captain has sent for your report, after the Assembly."
3. **`heron-warehouse`, Sallow's card.** Replace the single secret beginning "If Hobb ran to him from the Rat…" with a card that reads the front:

   > "How much he knows tonight follows from what's in motion. If the Captain told him the clerk went in as a murder, he's wary: the Crakes walk the wharf before he comes, and there are two lanterns at the land door. If Hobb ran to him, he's warned: he comes at the bell with Hobb at his heels, sharp and hurrying, and wants the true book sewn into oilcloth and aboard the barge. Otherwise he's unhurried and bored."

4. **Answer "Who pays the hedge-folk?" inside the arc.** Add one line to `trueBookItem` in [heron-warehouse.ts](../../scenes/heron-warehouse.ts), and the same to Scrope's `knows`: "…and on the last page of each month, in the same careful hand, 'Hedge-folk, the usual: forty heron pennies.'" The book then answers Prout's question in the style of the scene's own joke about bookkeeping. It also joins the heron pennies at the Rat and on the floor to the goblins on the road, without opening anything new.
5. **Interludes.** Change the opening's "Then show the town" to "Then show the town as it is now (from Caerwyn now: what's new since the last scene, by sight or by talk, once)". Optionally give `caerwyn-afternoon` a short `Places/Corn Exchange.md`: three aspects, Abel Fennick and what he wants, and the price board as the bread front's vector. That makes the Exchange a named second horizon without making it a scene.

---

## Sources

**Sly Flourish (Mike Shea).**
- [Build from the Characters Outwards](https://slyflourish.com/build_from_the_characters_outwards.html) (2023)
- [Spiral Campaign and World Building in D&D](https://slyflourish.com/spiral_campaign_building.html) (2023)
- [Lazy World Building](https://slyflourish.com/lazy_world_building.html) (2025)
- [Thinking Two Horizons Out](https://slyflourish.com/thinking_two_horizons_out.html) (2020)
- [Lazy GM's Resource Document](https://slyflourish.com/lazy_gm_resource_document.html): fantastic locations, campaign fronts, spiral development
- [Build Worlds, Not Stories](https://slyflourish.com/build_worlds_not_stories.html) (2013)
- [Looking Back on Dungeon World Fronts](https://slyflourish.com/looking_back_on_fronts.html) (2016)
- [Thinking Through the Eyes of our Villains](https://slyflourish.com/thinking_through_the_eyes_of_our_villains.html) (2021)
- [Understanding the Six Truths](https://slyflourish.com/understanding_the_six_truths.html) (2023)
- [Bathe Your World in Lore](https://slyflourish.com/bathe_your_world_in_lore.html) (2024)
- [A Focus on Locations](https://slyflourish.com/a_focus_on_locations.html) (2016)
- [Lazy Campaign Building Checklist](https://slyflourish.com/lazy_campaign_building_checklist.html) (2026)
- [Build a Campaign-Unique Faction List](https://slyflourish.com/build_a_faction_list.html) (2025)

I couldn't find an article titled "Your world is a sandbox of fantastic locations" in his [archive](https://slyflourish.com/archive.html). The closest are "Develop fantastic locations" in the Resource Document, A Focus on Locations, and spiral development's "Pick three such locations".

**The Alexandrian (Justin Alexander).**
- [Don't Prep Plots](https://thealexandrian.net/wordpress/4147/roleplaying-games/dont-prep-plots) (2009)
- [Don't Prep Plots: Tools, Not Contingencies](https://thealexandrian.net/wordpress/37422/roleplaying-games/dont-prep-plots-tools-not-contingencies) (2015)
- [Hexcrawl](https://thealexandrian.net/wordpress/17308/roleplaying-games/hexcrawl) (2012)
- [Thinking About Urbancrawls](https://thealexandrian.net/wordpress/36473/roleplaying-games/thinking-about-urbancrawls) (2015), [part 10: One City, Many Urbancrawls](https://thealexandrian.net/wordpress/36600/roleplaying-games/thinking-about-urbancrawls-part-10-one-city-many-urbancrawls), [part 12: Exploring the Advanced Urbancrawl](https://thealexandrian.net/wordpress/36611/roleplaying-games/thinking-about-urbancrawls-part-12-exploring-the-advanced-urbancrawl)
- [Smart Prep part 4: Campaign Status Documents](https://thealexandrian.net/wordpress/42961/roleplaying-games/smart-prep-part-4-campaign-status-documents) (2019)
- Campaign status modules: [Event Fallout](https://thealexandrian.net/wordpress/48624/roleplaying-games/campaign-status-module-event-fallout) (2022), [Continuity Notes](https://thealexandrian.net/wordpress/49799/roleplaying-games/campaign-status-module-continuity-notes) (2023), [Supporting Cast](https://thealexandrian.net/wordpress/49970/roleplaying-games/campaign-status-module-supporting-cast) (2023), [Trinity Toolbox](https://thealexandrian.net/wordpress/53311/roleplaying-games/campaign-status-module-trinity-toolbox)
- Ptolus, Running the Campaign: [Reputation](https://thealexandrian.net/wordpress/51265/roleplaying-games/ptolus-running-the-campaign-reputation) (2024), [Inserting Bangs](https://thealexandrian.net/wordpress/52722/roleplaying-games/ptolus-running-the-campaign-inserting-bangs) (2025)
- [Ask the Alexandrian #21: Keeping Track of an Open Table](https://thealexandrian.net/wordpress/52952/roleplaying-games/ask-the-alexandrian-21-keeping-track-of-an-open-table) (2025)

**Dungeon World** (Sage LaTorra and Adam Koebel, CC BY 3.0).
- [Fronts](https://roll20.net/compendium/dw/Fronts)
- [The GM](https://roll20.net/compendium/dw/Rules:The%20GM)
- Source text for [Fronts](https://github.com/Sagelt/Dungeon-World/blob/master/text/Fronts.xml), [The GM](https://github.com/Sagelt/Dungeon-World/blob/master/text/GM.xml) and [The World](https://github.com/Sagelt/Dungeon-World/blob/master/text/The_World.xml) (steadings)

**Apocalypse World** (Vincent Baker), 1st edition, 2010, a [free download from the author](https://lumpley.games/apocalypse-world/): "The Master of Ceremonies" (pp. 110–119) and "Fronts" (pp. 133, 138–147). The 2nd edition's threat maps aren't freely available online, so this doc uses the 1st edition's threats, countdown clocks and stakes.

**Blades in the Dark** (John Harper), SRD:
- [Progress Clocks](https://bladesinthedark.com/progress-clocks) (including faction clocks)
- [The Faction Game](https://bladesinthedark.com/faction-game)
- [Entanglements](https://bladesinthedark.com/entanglements)
- [Heat](https://bladesinthedark.com/heat)
- [SRD text](https://github.com/amazingrando/blades-in-the-dark-srd-content) (fortune roll, tug-of-war clocks)

Blades' GM chapter and faction write-ups aren't in the SRD.

**The Angry GM.**
- [The Second Story](https://theangrygm.com/the-second-story/) (2024)
- [How to Run an Angry Open-World Game, Lesson Five](https://theangrygm.com/angry-open-world-lesson-five/) (2021)
- [How to Homebrew: Clickbait Worldbuilding](https://theangrygm.com/how-to-homebrew/) (2020)

**Fate Core SRD.** [Game Creation](https://fate-srd.com/fate-core/game-creation).

**Terry Pratchett and the Discworld.**
- [Words from the Master](https://www.lspace.org/books/apf/words-from-the-master.html) (Annotated Pratchett File)
- [Pratchett Quote File: alt.fan.pratchett](https://www.lspace.org/books/pqf/alt-fan-pratchett.html)
- L-Space wiki: [Thieves' Guild](https://wiki.lspace.org/Thieves%27_Guild), [Narrativium](https://wiki.lspace.org/Narrativium), [Ankh-Morpork](https://wiki.lspace.org/Ankh-Morpork)
