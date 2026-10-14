# Real scene sources for the Kingmaker V2 PoC

Research report, 2026-10-14. It covers real tabletop and cRPG scenes we could use as PoC test scenes. The focus is the tangents real players take in those scenes and how GMs, and the NPCs they voice, improvise around them while still landing the authored beats.

Related reports: `docs/research/ai-gm-and-craft.md` covers general GM craft, AI-GM precedents and a first read of the QA transcripts. This report doesn't repeat that material. It stays anchored to specific scenes.

---

## TL;DR

- **13 candidates**: 12 sourced scenes plus the user's crossroads example (already built as `scenes/crossroads-ambush.ts`). They span complexity 1 to 5:
  - 1:1 bill negotiation: Disco Elysium, Garte.
  - Haggle where the merchandise talks back: KOTOR, HK-47.
  - Ambush, then a captive, then a trail: Lost Mine of Phandelver (LMoP), Goblin Arrows.
  - Hostage bargain, then the rescued NPC's debrief: LMoP, Yeemik and Sildar.
  - Multi-NPC faction standoff: Baldur's Gate 3 (BG3), Emerald Grove.
  - Hostile witness plus investigation with a partner NPC: Disco Elysium, the hanged man's yard.
  - Crowd brawl with a monster interrupt and a quest hook: Dragon Heist, the Yawning Portal.
  - One-question oracle gatekeeper: LMoP, Agatha. Disco's Measurehead appears as a second gatekeeper.
  - Divination ritual: Curse of Strahd, the tarokka reading.
  - Companion recruitment: BG3, Lae'zel's cage. Sunless Citadel's Meepo is the tabletop parallel.
  - Morally grey quest-giver: Witcher 3, the Bloody Baron.
  - Royal court hearing with a hidden traitor: Storm King's Thunder, with NWN2 and KOTOR trials alongside.
- **The most consistent finding:** tables where off-script play went well treated the authored beats as a *situation* (NPC goals, resources and facts), not a script. They let players' plans succeed or fail on in-world terms. Three examples follow.
  - A party spared an ambusher. He guided them to his cave, where they drank whisky with the bugbear boss and bartered half their wagon for the hostage.
  - Another party talked a dragon into moving house.
  - At different tables, the same hostage-taker either threw the prisoner off a ledge or hugged the party goodbye. It depended on how they treated him.
- **Real players fixate on logistics exactly as V1's NPCs did with the cart.** LMoP DMs get "what do we do with the wagon?" all the time. Experienced DMs answer with a quick ruling (hide it, tie up the oxen, leave a guard) and don't punish it. A logistics question should never turn into a quest.
- **cRPGs that absorb tangents well do four things:**
  1. Give every gate several keys. Disco's Measurehead has at least four.
  2. Make failure produce content. Fail to cut the belt and your partner cuts it for you.
  3. Define what happens if you walk away. Lae'zel breaks out and kills her captors.
  4. Bring different choices back to the same beat. NWN2's trial ends in trial by combat whether you win or lose.
- **Multi-NPC scenes:** the best table advice is never to let two NPCs hold a conversation. It comes from Sandy Petersen, as relayed by DMDavid. NPCs in conflict should each press their case *to the party*. This bears directly on V1's NPC-chatter failure and on the "who speaks next" decision.
- **BG3 gives the strongest precedent against QA round 1's "one roll ends the scene" problem.** In the Arabella standoff, a first failed appeal opens a second, different appeal. Only a second failure is final.
- **Recommended set (8, reusing the current scene names):**
  1. Mad Farmer at the Crossroads (built).
  2. Garrow's toll.
  3. The warren under the burnt mill (bargain, then debrief).
  4. Standoff on the Nine Furrows green.
  5. The hanged clerk behind the Caerwyn granary.
  6. Brawl in the Assembly taproom.
  7. The widow of the burnt mill's one question.
  8. Audience before King Aldren.

  The hardest improvisation stress tests are 3, 4, 5 and 8.

---

## 1. How to read this

Each candidate lists:
- source links and a paraphrased synopsis;
- the cast, with each NPC's want, fear, secret and voice, plus their **limit**: what they won't do without a reason;
- authored beats in order, decision points and roll opportunities;
- exits mapped to V2's exit modes (combat / persuade / progress / other);
- tangents and how GMs handled them;
- complexity, and cRPG structure notes where relevant.

**Evidence tags on tangents**

| Tag | Meaning |
|---|---|
| **[seen]** | Happened at a real table, in a session log or in an actual-play show (linked). |
| **[designed]** | Anticipated by the original designers, in the module text or as a cRPG branch. |
| **[probe]** | Not sourced. A likely move worth throwing at the GM in blind QA. |

Cast details marked *(inf.)* are inferred for PoC use and are not in the source.

**Complexity scale**

| Level | Shape |
|---|---|
| 1 | One NPC, one decision. |
| 2 | One or two NPCs, or one NPC plus an interrupt. |
| 3 | Conflicting wants or deception, several rolls, two or more exits. |
| 4 | Crowd, or a multi-route investigation where turn-taking matters. |
| 5 | Formal multi-party scene, or a multi-stage morally grey arc with hidden truths and long-range consequences. |

**Caveats**
- Reddit (r/DMAcademy, r/CurseofStrahd) couldn't be reached from the research environment: direct fetches were blocked and the mirrors were down. Real-player evidence therefore comes from:
  - ENWorld, D&D Beyond and Paizo forum threads;
  - session logs and blogs;
  - actual-play wikis and Steam discussions;
  - cRPG wikis and walkthroughs.
- Synopses are paraphrased. Quotes are a few words at most.

---

## 2. Candidate overview

| # | Scene (source) | Shape | On stage | Cx | Exits | Main improvisation stress |
|---|---|---|---|---|---|---|
| U | Crossroads peasant & goblins (user's example; built) | hook → interrupt → combat → aftermath | farmer, goblin band | 2 | combat, persuade, other (walk on) | paranoia, parley, aftermath continuity |
| 1 | Goblin Arrows (LMoP) | discovery → ambush → captive → trail | goblins, a captive | 2 | combat, progress, persuade (guide) | logistics, adopting the enemy, refusing the trail |
| 2 | Yeemik's bargain + Sildar's debrief (LMoP) | hostage bargain with a treacherous NPC → rescued-NPC aftermath | lieutenant, goblins, knight | 3 | persuade, combat, progress, other (new goblin boss) | lies, double-cross, NPC agency |
| 3 | Garte's bill (Disco Elysium) | 1:1 negotiation, fixed and negotiable charges | manager (+partner) | 1 | persuade, progress, other (flee) | absurd persistence, giving in too easily vs stonewalling |
| 4 | Yuka Laka sells HK-47 (KOTOR) + Bildrath (Curse of Strahd) | haggling loop with price floor; merchandise talks | merchant, droid | 2 | persuade, progress, combat (rob), other (recruit) | price consistency, threats, the merchandise interjecting |
| 5 | Emerald Grove: Aradin vs Zevlor; Kagha vs Arabella (BG3) | multi-NPC factional standoff with crowd | 2 leaders + crowd; judge, child, parents | 4 | persuade, combat, progress, other (watch) | who speaks next, escalation ladder, NPC chatter |
| 6 | The hanged man's yard (Disco Elysium) | hostile witness + investigation + partner | 2 kids, partner, corpse | 4 | progress, persuade, combat (a punch), other (fetch help) | hostility without stonewalling, partner steering, redundant clues |
| 7 | The Yawning Portal (Dragon Heist) | crowd brawl → monster interrupt → hook | owner, two factions, barmaid, author, troll | 4 | combat, persuade, progress, other | crowds, optional participation, a hook that doesn't depend on the fight |
| 8 | Agatha's one question (LMoP) + Measurehead (Disco) | oracle gatekeeper | banshee (or bouncer) | 2 | persuade, progress, combat, other | the "big question"; many keys to one gate |
| 9 | Madam Eva's tarokka reading (Curse of Strahd) | ritual/divination with authored randomness | seer, hosts | 3 | progress, other (decline), combat | refusal, pressure for plain answers, ritual pacing |
| 10 | Lae'zel in the cage (BG3) + Meepo (Sunless Citadel) | dispute around a captive → recruitment | captive, 2 scouts | 2 | persuade, combat, progress (recruit), other (walk on) | betrayal, side-switching, recruit's voice |
| 11 | The Bloody Baron (Witcher 3) + Inn at the Crossroads | morally grey quest-giver, layered confession | lord, soldiers | 5 | persuade, progress, combat, other (refuse) | judging him without the NPC collapsing; killing the quest-giver |
| 12 | Before the Wyrmskull Throne (Storm King's Thunder) + NWN2/KOTOR trials | formal court hearing with hidden traitor | regent, uncle, disguised counsellor, sisters, envoys | 5 | persuade, combat (unmasking), progress, other (expelled) | procedure vs improvisation, many voices, one consistent hidden truth |

---

## 3. What real tables teach about tangents

### 3.1 Patterns that worked, with the scene evidence

General craft is covered in depth in `ai-gm-and-craft.md`. These are the patterns that show up in the real-table evidence for *these* scenes.

1. **Run NPCs as goals, not lines.** The Alexandrian's "Don't Prep Plots" argues that a plot breaks when players deviate, while a situation of people with goals and resources reacts to them ([Alexandrian](https://thealexandrian.net/wordpress/4147/roleplaying-games/dont-prep-plots)).
   - Yeemik (§5.2) is a goal: *get Klarg killed without risk to me*. That's why tables report opposite but consistent outcomes. A lie got the hostage thrown; cooperation got a goodbye hug.
2. **Accept the plan, then price it in-world.** Sly Flourish says to treat the group as your improv team and build on what they bring ([Sly Flourish](https://slyflourish.com/dnd_improv.html)).
   - LMoP tables did exactly this. One talked the dragon Venomfang into a "more prestigious" lair and threw in cultists as servants. The DM let him accept and leave ([grown-ups log](https://grown-ups.dyndns.org/phandelver/?p=60)).
   - Another spared a goblin, was guided to the cave, drank whisky with the boss and bartered half the wagon for the hostage. The DM planted the seed of a goblin revolt instead of forcing a fight ([D&D Beyond "Advice please"](https://www.dndbeyond.com/forums/dungeon-masters-only/27158-relationships-dragons/next)).
3. **Every gate gets several keys.** This is the Three Clue Rule extended to doors and plot gates ([Alexandrian](https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule)).
   - The Alexandrian rewrites Dragon Heist so Volo hires the party whether or not they fought the troll ([remix](https://thealexandrian.net/?p=42841)).
   - Disco's Measurehead can be passed by a fistfight, by adopting his ideology, by an order from his boss, or by climbing round ([TheGamer](https://www.thegamer.com/disco-elysium-measurehead-guide/)).
4. **Failure moves the scene on instead of stopping it** ([Daily Apocalypse](https://daily-apocalypse.com/daily-apocalypse/143-beyond-success-failure-failing-forward-and-moves-in-apocalypse-world)).
   - In Disco's field autopsy, fail to remove the belt and Kim does it ([GameBanshee](http://www.gamebanshee.com/discoelysium/walkthrough/performfieldautopsy.php)).
   - Fail to flee Garte and the drinks still come off the bill ([GameBanshee](http://www.gamebanshee.com/discoelysium/walkthrough/payfordamages.php)).
   - In BG3's Arabella standoff, a first failed appeal opens a second, different appeal ([bg3.wiki](https://bg3.wiki/wiki/Save_Arabella)).
5. **The world moves when players don't.**
   - BG3: Lae'zel breaks out and kills her captors if left. Barcus Wroot dies if you leave the map. Stay neutral while Auntie Ethel argues with the brothers and she kills them (§5.10, §6).
   - Kingmaker GMs turned an escaped bandit leader into a recurring raider ([Paizo](https://paizo.com/threads/rzs2nlgh)).
6. **Feed consequences back to the players instead of blocking them.** The Alexandrian's rule for a party that abandons a job: work out the consequences of what the PCs did, then find how they come back round to meet the PCs ([Ask the Alexandrian #16](https://thealexandrian.net/?p=51874)). The same goes for killing the quest-giver ([nullpointer](https://www.nullpointer.co.uk/should-you-be-able-to-kill-the-king-rpg-design.html)).
7. **When things stall, push from the fiction.**
   - Alexandrian: proactive clues, and if all else fails, something happens *to* the party.
   - Dungeon World: soft moves telegraph a threat, and an ignored soft move licenses a hard one ([Dungeon World SRD](https://www.dungeonworldsrd.com/gamemastering/)).
   - Curse of Strahd DMs pull drifting parties back with a theatrical appearance by the villain or his agents ([D&D Beyond](https://www.dndbeyond.com/forums/dungeons-dragons-discussion/dungeon-masters-only/242496-sandbox-how-should-i-run-it-curse-of-strahd)).
8. **Settle logistics with a quick ruling.** For LMoP's wagon, DMs say: hide it, tie up the oxen or leave a guard. The hideout fight lasts a minute anyway, and new players shouldn't be punished for logistics ([ENWorld "Lost wagon of Phandelver"](https://www.enworld.org/goto/post?id=6378223)).
9. **Keep one NPC on stage; NPCs in conflict turn to the party.** Sandy Petersen's rule, as relayed by DMDavid: never let two NPCs have a discussion. Narrate NPC-to-NPC exchanges, keep them to a line, and have opposing NPCs make their case to the PCs ([DMDavid](https://dmdavid.com/tag/running-group-roleplaying-scenes-how-permission-from-an-rpg-legend-made-me-stop-talking-to-myself/)).
10. **Roll only when the outcome is uncertain and failure matters** (5e DMG guidance, discussed on [ENWorld](https://www.enworld.org/goto/post?id=6625477)). Ordering an ale needs no check.
    - For repeated attempts, haggling DMs end things with "that's my final offer" after two or three failures ([ENWorld](https://www.enworld.org/threads/haggling-rules-guidelines-suggestions.233193/)).
    - Disco only lets you retry a white check after something has changed ([GameBanshee review](https://gamebanshee.com/3wx38)).
11. **Bring choices back together; vary the flavour.**
    - NWN2's trial ends in trial by combat whether you win or lose ([sorcerers.net](https://sorcerers.net/Games/NWN2/Walkthrough2/act2/trials.php)).
    - Witcher 3's botchling choice splits into two routes to the same hut ([Wikipedia](https://en.wikipedia.org/wiki/The_Bloody_Baron)).
12. **Bring back what was improvised.**
    - A Dragon Heist table's player-invented dwarf from session one returned as the watch captain ([Droplowest](https://droplowest.com/2019/07/31/dragon-heist-diary-part-two/)).
    - In The Adventure Zone, a minor NPC from the LMoP-based first arc (Barry Bluejeans) later became central ([Fanlore](https://www.fanlore.org/wiki/Balance_Arc)).
13. **Steer from inside the fiction with a companion.**
    - Disco's Kim Kitsuragi is written to find the player funny and indulge them, then steer back to the case. He taps his foot, checks his watch and keeps the notebook ([wiki.gg](https://discoelysium.wiki.gg/wiki/Kim_Kitsuragi)).
    - BG3 companions approve or disapprove in the moment ([bg3.wiki](https://bg3.wiki/wiki/Approval)).
14. **Respect paranoia and avoid unbeatable surprises.**
    - DMDavid: betrayal by a trusted NPC teaches players to trust nobody, and you shouldn't spring threats players can neither beat nor avoid ([DMDavid](https://dmdavid.com/tag/tag/paranoia/)).
    - Witcher 3 has at least one roadside "merchant under attack" who is in on the robbery ([rutab.net, Russian](https://rutab.net/b/the-witcher-3-wild-hunt/2020/04/27/dopolnitelnoe-zadanie-ograblenie-na-trakte.html)). Most of its persons in distress are genuine ([checklist](https://game-checklists.com/witcher3/all-persons-in-distress-checklist.html)).

### 3.2 Tangent taxonomy for blind QA

T1–T13 come from real tables. T14–T15 are what QA round 1's players did most and were added from the transcripts.

| Code | Tangent | Real-table evidence | Exercised best by |
|---|---|---|---|
| T1 | Refuse the hook or walk away | LMoP players chasing revenge or skipping the hideout ([bearblog](https://abekin.bearblog.dev/lost-mine-of-phandelver/)) | U, 1, 11 |
| T2 | Attack the "wrong" target: quest-giver, ally, merchant | Quest-giver killing threads ([nullpointer](https://www.nullpointer.co.uk/should-you-be-able-to-kill-the-king-rpg-design.html)) | 4, 5, 11, 12 |
| T3 | Switch sides or double-cross | Yeemik deals; BG3 "talk them away, then attack" | 2, 5, 10 |
| T4 | Lie about facts or fabricate evidence | "Klarg's already dead" → hostage thrown | 2, 12 |
| T5 | Bypass with magic, stealth or a back route | Disco's shack route; Detect Thoughts on Kagha | 6, 8, 12 |
| T6 | Over-reach for information (the "big question") | Agatha can answer almost anything | 8, 9, 2 |
| T7 | Fixate on logistics: cart, horses, prisoners, loot | LMoP wagon ([ENWorld](https://www.enworld.org/goto/post?id=6378223)) | 1, U |
| T8 | Adopt or recruit an unexpected NPC | Skreek the goblin; Meepo | 1, 2, 10 |
| T9 | Absurd or comedic persistence | Disco's dumpster ending | 3, 6, 7 |
| T10 | Leave the scene's topic | Tarokka: players asking about their own backstories *(probe)* | 7, 9, 12 |
| T11 | Plan ahead: ambush, traps, siege engine | Kingmaker table built a catapult ([ENWorld](https://www.enworld.org/threads/kingmaker.312414/)) | U, 1, 7 |
| T12 | Refuse to take part: decline the reading, won't haggle, won't kill | Most of a party declined their fortunes ([report](https://titus171.itch.io/one-of-us-will-die/devlog/939500/curse-of-strahd-adventure-report-ii-once-more-into-the-mists)) | 9, 4, 11 |
| T13 | Split the party, or one PC wanders off | Common at tables *(probe)* | 6, 7 |
| T14 | Invent facts: shared history, contacts, skills | QA round 1: "I fixed your goose weathervane", an invented goblin contact, a misremembered farm name; Dragon Heist's player-invented dwarf | all |
| T15 | Claim assets that don't exist (the griffon whistle) | QA round 1; the Stranger scene's "no crowns or armies, with a laugh and an alternative" | all |

### 3.3 QA round 1 failures and the real scenes that test them

From `docs/LOG.md` and the `runs/sessions/qa1-*` transcripts. These were read, not modified.

| QA failure | Real-table or cRPG precedent | Candidate scene that makes it an eval |
|---|---|---|
| **Nearest-edge forcing**: a pickpocket attempt rolled as Insight; a peace poem rolled as Deception | Tables call for the skill that fits the attempt. cRPGs give bespoke options (BG3: druid commands the snake; Detect Thoughts on Kagha) | §5.6 Cuno's yard and §5.7 the Yawning Portal: many unauthored approaches, each needing its own skill |
| **A creative variant gets the authored outcome**: threatening to smash the idol maps to "they scatter" | Yeemik reacts to the *specific* leverage. Holding his hostage at risk changes his calculation completely | §5.2 Yeemik: a hostage-for-a-hostage threat should produce a different outcome from plain intimidation |
| **Invented hooks**: the GM put a mystery key in a goblin's pouch and the player chased a lock that doesn't exist | The Three Clue Rule warns that players make their own red herrings; don't add more. V1's cart, and LMoP's wagon | §5.1 Goblin Arrows: loot and logistics should resolve quickly and mundanely |
| **One roll ends the scene** | BG3 Arabella: two appeals before the tragic outcome. NWN2: a points meter over a long scene | §5.5 and §5.12 |
| **"What are my options?" leaks secrets** | cRPG menus show what the character can perceive and attempt, not hidden motives | §5.9 and §5.8: secrets that must be earned |
| **Aftermath assumed a fight after a bargain** | BG3: Barcus's thanks vary by situation. LMoP: Sildar's debrief depends on how he was freed | §5.2: the debrief must be written from the exit actually taken |

### 3.4 Personas for the next blind QA rounds

Round 1's players were all *friendly improvisers*: whimsical, co-operative and inventive. Real-table tangents suggest adding these:

| Persona | Behaviour | Tangent codes |
|---|---|---|
| **The skeptic** | Suspects every NPC of being a lure, demands proof, won't hand anything over | T1, T4, T12 |
| **The logistics lawyer** | Asks about the ox carcass, the cart, the loot, sleeping arrangements, the exact distance to Caerwyn | T7 |
| **The murder-hobo** | Attacks or robs the quest-giver or merchant; loots everything | T2 |
| **The double-crosser** | Agrees to deals and then breaks them | T3, T4 |
| **The minimalist** | One-line answers, never volunteers anything. Tests whether the GM pushes the scene forward when the player doesn't | T12 |
| **The meta-gamer** | Asks out-of-character questions ("what are my options?", "is this a trap?") and asks for rolls | T6 |

---

## 4. How cRPGs structure these moments

### 4.1 Patterns

| Pattern | Example | What it buys | In the V2 scene format |
|---|---|---|---|
| Skill check shown on the dialogue option | BG3 Arabella: Intimidation, Nature or Persuasion, DCs 10–18. Persuasion appears in roughly 290 BG3 dialogues ([bg3.wiki](https://bg3.wiki/wiki/Ability_check)) | Clear stakes | `transitions[].check` on an edge (already the design) |
| Options gated by class, race or background | Only a druid can command the snake. Drow, duergar or githyanki PCs make Lae'zel's scouts attack ([bg3.wiki](https://bg3.wiki/wiki/Free_Lae%27zel)) | Who you are matters | Edge preconditions read the character sheet |
| Options gated by earlier events | Witcher 3: how you treated the Baron's men at the crossroads inn decides the gate. They wave you through, take a 15-crown bribe, or you sneak in through a flooded cave ([fextralife](https://thewitcher3.wiki.fextralife.com/Bloody+Baron), [guides4gamers](https://guides4gamers.com/witcher-3-wild-hunt/quests/the-nilfgaardian-connection/)). ME1: talking Wrex down needs 8 Charm or Intimidate, or his family armour ([RPG Site](https://www.rpgsite.net/feature/11128-mass-effect-virmire-choices-who-to-send--take-dealing-with-wrex-and-assisting-kirrahes-team)) | Memory and consequence | Edges conditioned on world flags written by earlier exits' scripts |
| One-shot vs retryable checks | Disco: red checks happen once; white checks can be retried after improvement ([GameBanshee review](https://gamebanshee.com/3wx38)) | No brute-forcing | A retry policy per check: once, or only after the situation changes |
| Passive interjections | Disco's skills chime in. BG3 rolls Perception automatically near traps and ambushes | Hints without menus | GM-side passive checks that add hints, never options |
| Failure as content | Arabella dies after a second failure; Disco's slapstick failures; Kim cuts the belt | No dead ends | Every check edge has a failure target that changes the situation |
| Tiered persuasion with costs | KOTOR's Yuka Laka: object, then persuade, then threaten. Threatening gets the lowest price but he won't trade with you again ([Archivum](https://starwars.archivum.wiki/article/Yuka_Laka)). Pathfinder: Kingmaker's [Evil] option lets you shake down the trader yourself ([gamerguides](https://www.gamerguides.com/pathfinder-kingmaker/guide/walkthrough/chapter-1-getting-started-in-the-outskirts/olegs-trading-post)) | Moral texture | Edge outcomes write disposition flags |
| Relationship meters | BG3 approval: warnings at -20 and -40, the companion leaves at -50, and approval shifts persuasion DCs ([bg3.wiki](https://bg3.wiki/wiki/Approval)). Kingdom Come's merchant patience ([gamerguides](https://www.gamerguides.com/kingdom-come-deliverance/introduction/useful-gameplay-tips/haggling)). Kim's respect | Persistent memory | NPC disposition that modifies DCs |
| Points contest across a long scene | NWN2 trial: Diplomacy, Bluff and Intimidate each move points; evidence scores; crowd belief matters ([LP archive](https://lparchive.org/Neverwinter-Nights-2/Update%2041)) | Momentum without single-roll endings | A scene-level meter the GM moves; exit at a threshold |
| What happens if you leave | Lae'zel, Ethel, Barcus | The world moves | An `anytime` walk-away edge plus a default exit (crossroads-ambush already has `abandoned`) |
| Converging branches | NWN2 trial; Witcher's botchling | Beats land without rails | Several edges leading to one exit with different world changes |
| Expected betrayal as a real branch | BG3 gives a Charlatan an inspiration for talking the scouts away and then attacking them ([bg3.wiki](https://bg3.wiki/wiki/Free_Lae%27zel)) | Rewards roguery | Author the obvious double-cross as an edge |
| Back routes | Disco: Cuno's shack. Witcher 3: the flooded cave | No single chokepoint | Multiple progress edges |

### 4.2 Mapping to the current scene format

The current `Scene` type already has a premise (the dramatic question), cast wants, fears and secrets, scene `limits`, beats with `pressure`, edges with checks, an `anytime` walk-away edge and scripted exits. The real scenes suggest four additions. They're about NPC behaviour, not authoring polish:

1. **Per-NPC limits and leverage.** Every NPC above has a line they won't cross without a reason. "Yeemik won't release before proof" is what lets a GM improvise without giving in too easily or stonewalling.
2. **A retry policy per check**, from Disco and BG3. It lets the GM refuse to re-roll the same pitch while still accepting a genuinely new angle.
3. **A disposition variable for long scenes**: approval, patience or crowd belief. Longer scenes (§5.5, §5.7, §5.12) can then build tension across several failures, so no single roll ends them.
4. **Openings written from the exit taken.** Sildar's debrief and Barcus's thanks both differ by outcome in the source material.

---

## 5. Candidate scenes

### 5.U The crossroads peasant (the user's example, already built)

- **Source**
  - The user's brief, `Kingmaker V2 prototype.md`.
  - Built as `scenes/crossroads-ambush.ts` and `scenes/crossroads-aftermath.ts`: Tam Hollis, Skrag and the Grandmother Bone idol.
  - Real analogs:
    - LMoP Goblin Arrows (§5.1).
    - BG3 "Rescue the Gnome": goblins use Barcus Wroot for target practice on a windmill. He's grateful, explains his missing friend, and dies if you leave ([bg3.wiki](https://bg3.wiki/wiki/Barcus_Wroot)).
    - Witcher 3's roadside persons in distress, one of which is a lure ([rutab.net](https://rutab.net/b/the-witcher-3-wild-hunt/2020/04/27/dopolnitelnoe-zadanie-ograblenie-na-trakte.html)).
    - Kingmaker's Oleg's Trading Post, where the party prepares before the raiders arrive ([ENWorld](https://www.enworld.org/threads/kingmaker.312414/)).
- **Shape / complexity:** hook → interrupt → combat exit → aftermath scene. **2.**
- **Synopsis:** on the road the party meets a terrified farmer raving at a milestone. Engaging him brings out the goblins who have been shadowing him. Either initiative is rolled and the fight plays out on the map, or the standoff resolves another way. Afterwards he comes out of hiding, explains, and gives a lead and a request.
- **Cast:** see the scene file. The real analogs add two reaction points:
  - Fleeing raiders lead to their lair.
  - A rescued NPC's gratitude and information depend on what just happened.
- **Tangents and handling**
  - **[seen, analog]** Treating the farmer as a lure. The suspicion is reasonable (Witcher has lures). If he's genuine, caution should pay off, for example by spotting the goblins early. Don't punish it (DMDavid).
  - **[designed, analog]** Walking past. In BG3, Barcus dies. The GM should let the party go and show the consequence later (the `abandoned` exit plus Alexandrian #16), not hold the road shut.
  - **[seen, analog]** "We hide and ambush them." A Kingmaker group built traps and a catapult before the bandits came. Announced preparation should change positioning and surprise, not be overridden by a scripted "goblins burst out".
  - **[seen]** QA round 1, all handled reasonably well:
    - an invented backstory ("raised by goblins");
    - hiding in the dead ox, refused in character with an alternative offered;
    - cheese as bait;
    - poetry at the goblin leader;
    - whistling for a non-existent griffon ("only the flies answer").
  - **[probe]**
    - The skeptic refuses to engage until Tam proves the goblins exist.
    - The party loots the ox, or asks who owns the carcass.
    - The party carries Tam off bodily.
    - One PC holds the idol hostage over a fire.
    - The party demands payment before helping.
- **Watch for:**
  - initiative firing after the party has left;
  - Tam looping one line;
  - a dead or departed NPC "coming out of hiding";
  - secrets revealed when a player asks "what are my options?"

### 5.1 Lost Mine of Phandelver: Goblin Arrows (ambush → captive → trail)

- **Source**
  - *Lost Mine of Phandelver* (D&D Starter Set, 2014), Part 1 ([D&D Beyond](https://www.dndbeyond.com/sources/lmop)).
  - Session logs: [View from the Stars ch. 2](https://theviewfromthestars.substack.com/p/chapter-2-goblin-ambush), [ch. 5](https://theviewfromthestars.substack.com/p/chapter-5-interrogation-techniques).
  - Forums and reviews: [D&D Beyond "Advice please"](https://www.dndbeyond.com/forums/dungeon-masters-only/27158-relationships-dragons/next), [ENWorld "Lost wagon of Phandelver"](https://www.enworld.org/goto/post?id=6378223), [play review](https://abekin.bearblog.dev/lost-mine-of-phandelver/).
- **Shape / complexity:** discovery → ambush combat → interrogation → trail (progress). **2.**
- **Synopsis:** hired to haul a wagon of supplies to a frontier town while their dwarf patron rode ahead with a knight, the party finds two dead horses (the patron's) bristling with black-fletched goblin arrows. Goblins hidden in the thickets attack. The last goblin usually flees down a concealed trail, with a snare and a pit, toward the goblins' cave. A captive can be made to talk.

**Cast**

| NPC | Want | Fear | Secret | Voice |
|---|---|---|---|---|
| Goblin ambushers | loot; please their boss | the bugbear boss; dying | they dragged off the dwarf and the knight | shrill, cowardly; flee when losing |
| Captive goblin (named "Skreek" at one table) | to live | the boss; the party | the route, the traps, who is held inside | wheedling, bargaining |

Limit: the captive won't walk into the cave first unless more afraid of the party than of the boss.

**Authored beats**
1. Dead horses: what happened?
2. Ambush.
3. Aftermath: loot, an empty map case, drag marks.
4. Captive, or the fleeing goblin.
5. The trail and its traps.
6. Exit to the hideout, or on to town.

**Decision points**
- Approach carefully or rush in.
- Kill or spare.
- Leave the wagon.
- Follow the trail now, or deliver the goods first.

**Roll opportunities**

| Moment | Skill | Success | Failure |
|---|---|---|---|
| Spot the ambush | Perception | no surprise | surprised |
| Read the scene | Investigation, Medicine or Survival | how long dead, how many, drag marks | less detail; the trail still gives clues |
| Break the captive | Intimidation or Persuasion | route, traps, numbers | lies or half-truths |
| Trail traps | Perception or Survival | avoid the snare and pit | damage, noise, the cave alerted |

**Exits**
- Combat.
- Progress: the trail to the hideout.
- Progress: deliver the wagon to town; the hideout comes later.
- Persuade: the captive becomes a guide.

**Tangents and how GMs handled them**
- **[seen]** A party spared the fourth goblin, persuaded him to guide them, talked their way past the cave guards, drank whisky by the boss's fire and bartered half the wagon's goods for the knight. The DM rewarded it and seeded a goblin revolt. They noted that departures like this happened "quite often" ([D&D Beyond](https://www.dndbeyond.com/forums/dungeon-masters-only/27158-relationships-dragons/next)).
- **[seen]** A brutal interrogation: a severed head as a prop, and yes/no answers so the captive couldn't shout a warning. The DM let it run and showed the cost through a squeamish PC's reaction ([ch. 5](https://theviewfromthestars.substack.com/p/chapter-5-interrogation-techniques)).
- **[seen]** Burning Hands set the log barrier alight and blocked the goblins' retreat. Looting the bodies started a moral argument inside the party ([ch. 2](https://theviewfromthestars.substack.com/p/chapter-2-goblin-ambush)).
- **[seen]** "What about the wagon?" Hide it, tie up the oxen, leave a guard. Don't punish it ([ENWorld](https://www.enworld.org/goto/post?id=6378223)).
- **[seen]** Players chased revenge instead of the intended hooks. That DM found the module couldn't absorb it ([review](https://abekin.bearblog.dev/lost-mine-of-phandelver/)). Others bring the hideout's consequences to town later.
- **[probe]**
  - Bury the horses.
  - Drive the wagon down the goblin trail.
  - Keep the captive as a pet.
  - Send one PC back for help.
  - Ask what the goblins were paid with.
- **Improvisation stress:** logistics (T7), adopting the enemy (T8), refusing the trail (T1). Loot should resolve mundanely, with no mystery keys.

### 5.2 Lost Mine of Phandelver: Yeemik's bargain + Sildar's debrief

- **Source**
  - LMoP Part 1, Cragmaw Hideout.
  - Logs: [grown-ups.dyndns.org](https://grown-ups.dyndns.org/phandelver/tag/sildar-hallwinter/); World Anvil campaign logs ([Sildar](https://www.worldanvil.com/w/faerun-rothguard/a/sildar-hallwinter-person), [Cragmaw Hideout](https://www.worldanvil.com/w/lanath-elsanchez45/a/chapter-1-23A-the-cragmaw-hideout-article)).
  - Actual play: [The Adventure Zone, "Here There Be Gerblins"](https://theadventurezone.fandom.com/wiki/Here_There_Be_Gerblins).
  - Forum: [D&D Beyond "Does this sound fun?"](https://www.dndbeyond.com/forums/dungeon-masters-only/74860-this-might-have-been-asked-before/next).
- **Shape / complexity:** hostage negotiation with a treacherous NPC → rescued-NPC aftermath. **3.**
- **Synopsis:** deep in the cave, an ambitious goblin lieutenant holds the beaten knight near a drop. He offers a trade: kill his bugbear boss (with proof) and he'll release the prisoner. Attack him and the knight goes over. Once freed, the knight debriefs:
  - He's an agent of a lords' alliance.
  - The dwarf was taken to a ruined castle by a goblin "king" working for someone called the Black Spider.
  - He must find a missing colleague in town.
  - He'll pay the party to escort him.

**Cast**

| NPC | Want | Fear | Secret | Voice |
|---|---|---|---|---|
| Yeemik (lieutenant) | the boss's job | the boss; losing his leverage | will sell out whoever is weaker | sly, fast-talking, self-important |
| His goblins | survive; side with the winner | — | — | narrated chorus |
| Sildar (knight) | find the dwarf and his colleague | failing his mission | alliance agent; the colleague has turned villain (a later reveal) | gruff, formal, honourable |
| Klarg (offstage boss) | rule; loot | rivals | — | vain bully |

Limits: Yeemik won't release the knight before proof. Sildar won't abandon the dwarf.

**Authored beats**
1. Yeemik's challenge.
2. His offer and his threat.
3. The party's response.
4. The hostage is resolved.
5. Sildar's debrief: the dwarf's location, the castle, the Black Spider, the missing colleague, the reward.
6. Exit.

**Decision points**
- Deal, attack or bluff.
- Whether to trust Yeemik afterwards.
- Yeemik's fate.
- Escort the knight, or go after the dwarf.

**Roll opportunities**

| Moment | Skill | Success | Failure |
|---|---|---|---|
| Read Yeemik | Insight | he'll keep the deal only while it suits him | misread |
| Bluff ("the boss is already dead") | Deception vs his Insight | he relaxes or reveals more | he acts on the lie, and may decide he doesn't need them |
| Hostage released first | Persuasion | the knight is handed over first | Yeemik hardens |
| Snatch the hostage | Athletics or Acrobatics, plus initiative | knight safe | knight falls or is hurt |
| Debrief | Persuasion or Insight | extra detail on the colleague and the alliance | the core lead still lands |

**Exits**
- Persuade: a deal.
- Combat.
- Progress: escort the knight to town.
- Other: Yeemik becomes the goblin boss, which changes world state.

**Tangents and how GMs handled them**
- **[seen]** The party claimed the boss was already dead. Yeemik decided he didn't need them and threw the knight; an arrow took Yeemik mid-throw (World Anvil logs).
- **[seen]** The party helped Yeemik. He hugged the halfling goodbye (logs).
- **[seen]** Yeemik was installed on the boss's throne as an ally (logs).
- **[seen]** A party feigned acceptance and then attacked ([grown-ups](https://grown-ups.dyndns.org/phandelver/tag/sildar-hallwinter/)).
- **[seen]** A PC killed Yeemik for scheming against the party (logs).
- **[seen]** In The Adventure Zone, the GM had the boss murder his lieutenant, upending the plan ([TAZ wiki](https://theadventurezone.fandom.com/wiki/Here_There_Be_Gerblins)).
- **[seen]** The knight later offered alliance membership. It was revoked after one PC gave offence, so a callback came with a consequence ([grown-ups](https://grown-ups.dyndns.org/phandelver/tag/sildar-hallwinter/)).
- **[seen]** Whole campaigns go off-script and never reach the castle. One DM then ran a side game where the players were Yeemik's goblins ([D&D Beyond](https://www.dndbeyond.com/forums/dungeon-masters-only/74860-this-might-have-been-asked-before/next)).
- **[probe]**
  - Threaten Yeemik's own life or his trinket: a hostage for a hostage.
  - Recruit Yeemik as a guide.
  - Refuse to escort the knight.
  - Suspect the knight.
  - Ask Yeemik about the "king".
- **Handling:** judge every player line by whether it gets Yeemik the boss's job without risk. His Insight opposes their Deception. Sildar's must-land lead needs at least three routes: Sildar himself, Yeemik, and documents or the captive.
- **Improvisation stress:** deception (T4), double-cross (T3), a creative threat that must change Yeemik's calculation and not just trigger the intimidation edge.

### 5.3 Disco Elysium: Garte's bill (simple 1:1 negotiation)

- **Source**
  - *Disco Elysium* (ZA/UM, 2019), Day 1, "Pay for damages" ([GameBanshee](http://www.gamebanshee.com/discoelysium/walkthrough/payfordamages.php)).
  - Player discussion: [Steam](https://steamcommunity.com/app/632470/discussions/0/2270319347573508910).
  - The dumpster ending: [TrueAchievements](https://www.trueachievements.com/game/Disco-Elysium/walkthrough/2).
- **Shape / complexity:** 1:1 negotiation over an itemised bill, part fixed and part negotiable. **1.**
- **Synopsis:** the hungover detective owes the hostel manager for three nights, a bar tab and a window he smashed: 130 réal in all. He has no money. He can promise to pay later, plead, run, argue charges away or pull rank.

**Cast**

| NPC | Want | Fear | Secret | Voice |
|---|---|---|---|---|
| Garte (manager) | to be paid; to keep order | *(inf.)* losing face to a cop who wrecked his hostel | *(inf.)* none; he's the straight man | dry, deadpan, put-upon |
| Kim (partner, arrives later) | to keep the case moving | — | — | calm |

Limit: no bed until the bill is paid.

**Authored beats**
1. The itemised bill.
2. Excuses.
3. Concessions.
4. The consequence: no room.
5. Errands to raise money.

**Roll opportunities**

| Moment | Skill | Success | Failure |
|---|---|---|---|
| Run for it | Savoir Faire | escape; the drinks come off the bill | crash into a wheelchair and lose health; the drinks still come off |
| Argue the window | Rhetoric | window charge waived | — |
| "Arrest" him | Authority | lodging billed to the precinct; then the window is waived too | — |

The drinks are always owed.

**Exits**
- Persuade: a reduced bill.
- Progress: accept the debt and leave.
- Other: flee.

**Tangents**
- **[designed]** Fleeing is slapstick but still pays off, and arresting the manager works.
- **[designed]** On a later day, pestering him for a free room ends with him suggesting the dumpster. Sleeping there ends the game (the "Real Musor" achievement). The designers anticipated absurd persistence ([TrueAchievements](https://www.trueachievements.com/game/Disco-Elysium/walkthrough/2)).
- **[designed]** That evening Kim quietly hands over confiscated goods to sell, so the partner is a safety net ([GameBanshee](http://www.gamebanshee.com/discoelysium/walkthrough/payfordamages.php)).
- **[probe]**
  - Pay in kind: tie, badge, boots.
  - Offer to work it off.
  - Blame "the other guy".
  - Threaten with a gun.
  - Sneak into the room anyway.
  - Ask what happened last night.
- **Handling:** model the bill as separate charges. Each can be removed by a specific approach; one is fixed. Give the NPC a "final offer" line, and let absurdity land with an in-world cost.
- **Improvisation stress:** absurd persistence (T9), and getting the calibration right between caving and stonewalling.

### 5.4 Merchant haggle: Yuka Laka sells HK-47 (KOTOR) + Bildrath's Mercantile (Curse of Strahd)

- **Source**
  - *Star Wars: Knights of the Old Republic* (BioWare, 2003), Tatooine droid shop ([GameBanshee](https://www.gamebanshee.com/starwarskotor/locations/droidshop.php), [Archivum](https://starwars.archivum.wiki/article/Yuka_Laka)).
  - Tabletop analog: *Curse of Strahd*'s Bildrath's Mercantile ([D&D Beyond thread](https://www.dndbeyond.com/forums/dungeon-masters-only/151076-aasimar-fey-switcheroo/next)).
  - Haggling practice: [ENWorld](https://www.enworld.org/threads/haggling-rules-guidelines-suggestions.233193/). Merchant patience: [Kingdom Come](https://www.gamerguides.com/kingdom-come-deliverance/introduction/useful-gameplay-tips/haggling).
- **Shape / complexity:** a haggling loop with a price floor and a relationship cost, where the merchandise talks. **2.**
- **Synopsis:** a dusty shop sells a battle droid at an outrageous price.
  - Objecting knocks the price down at once ("some people bite straight away"). Persuasion pushes it lower.
  - A threat gets the floor price, but the merchant won't trade with you again.
  - Before buying you can chat to the droid: a murderous comic who calls organics "meatbags". He joins the party on purchase.
- **Tabletop analog:** in *Curse of Strahd*'s cursed, cut-off village, the only general store's owner overcharges because nothing new gets in. His hulking nephew keeps the peace, and players routinely bristle at the prices.

**Cast**

| NPC | Want | Fear | Secret | Voice |
|---|---|---|---|---|
| Merchant | top price; to unload a problem item | robbery; the law | *(inf.)* the item's checkered past | oily patter |
| The talking merchandise | a master worth serving | *(inf.)* a memory wipe | its past | formal, labels its own sentences, contemptuous |

Limits: a price floor; threats end the relationship.

**Authored beats**
1. The pitch.
2. Objection.
3. Rounds of haggling.
4. Buy, walk or threaten.
5. The merchandise joins.

**Roll opportunities**

| Moment | Skill | Success | Failure |
|---|---|---|---|
| Haggle | Persuasion | the price steps down | patience drops; after 2–3 failures, "final offer" |
| Lean on him | Intimidation | floor price | relationship over; maybe the guards |
| Find a flaw | Investigation or Insight | leverage for a discount | — |
| Steal | Sleight of Hand | the item | caught: combat or the law |

**Exits**
- Persuade: a deal.
- Progress: walk away.
- Combat: robbery.
- Other: recruit the merchandise.

**Tangents**
- **[designed]** A threat buys the cheapest price but closes the shop. Talking to the merchandise first is always possible.
- **[seen]** Players who haggle over every purchase. DMs cap the rounds and use "that's my final offer" as the signal. Shopkeepers expect haggling ([ENWorld](https://www.enworld.org/threads/haggling-rules-guidelines-suggestions.233193/)).
- **[seen]** Curse of Strahd players annoyed by Bildrath's prices ([D&D Beyond](https://www.dndbeyond.com/forums/dungeon-masters-only/151076-aasimar-fey-switcheroo/next)).
- **[probe]**
  - Free the merchandise instead of buying it.
  - Sell the merchant his own junk.
  - Pay in favours or rumours.
  - Get the merchandise to insult the merchant into a discount.
- **Improvisation stress:** keeping the price floor consistent, and letting the merchandise interject without the two NPCs bantering at each other.

### 5.5 Baldur's Gate 3: Emerald Grove standoffs (Aradin vs Zevlor; Kagha vs Arabella)

- **Source:** *Baldur's Gate 3* (Larian, 2023), Act 1. bg3.wiki pages: [Aradin](https://bg3.wiki/wiki/Aradin), [Zevlor](https://bg3.wiki/wiki/Zevlor), [Emerald Grove](https://bg3.wiki/wiki/Emerald_Grove), [Save Arabella](https://bg3.wiki/wiki/Save_Arabella).
- **Shape / complexity:** a multi-NPC faction standoff in front of a crowd, then a higher-stakes standoff deeper in. **4.**
- **Synopsis**
  - **At the gate:** after the party helps refugees fight off a goblin raid on a druid sanctuary's gate, they walk in on a shouting match. A mercenary captain who lost men and the refugees' leader trade blame over the missing archdruid and the goblins at the door. Armed people stand on both sides. The party can talk them down, threaten both, throw the first punch, or watch.
  - **Inside:** the acting archdruid is judging a refugee child caught with the grove's sacred idol, a venomous snake poised over her. The girl's parents beg the party to help.

**Cast**

| NPC | Want | Fear | Secret | Voice |
|---|---|---|---|---|
| Aradin (mercenary) | blame and compensation; to leave alive | looking weak before his men | hired by a city wizard for a different prize | loud, bitter, swaggering |
| Zevlor (refugee leader) | protect and evacuate his people | refugees blamed and expelled | haunted by exile from his fallen city | weary, dignified |
| Crowd of refugees and mercenaries | — | — | — | narrated chorus |
| Kagha (acting archdruid) | punish the theft; seal the grove | the grove's ruin | allied with shadow druids | harsh, self-righteous |
| Arabella (child) | survive; be brave | the snake | caught with the idol | small, defiant |
| Komira and Locke (parents) | their child back | losing her | — | pleading |

Limits:
- Aradin needs a face-saving way out.
- Zevlor won't let refugees be threatened.
- Kagha needs a reason that serves the grove.

**Authored beats**
- At the gate:
  1. The fight's aftermath.
  2. The argument erupts as the party nears.
  3. A window to intervene.
  4. Resolution: calmed (Aradin stays or leaves) or a brawl.
- The judgment:
  1. The parents' plea.
  2. The judgment.
  3. Intervention, with two chances.
  4. The child is freed, bitten, or it comes to combat.

**Roll opportunities**

| Moment | Skill | Success | Failure |
|---|---|---|---|
| Calm both | Persuasion DC 15 | the argument ends | it escalates |
| Threaten both | Intimidation DC 10 | they back down | — |
| Throw the first punch | Strength DC 17 | a fight | — |
| Talk Kagha down | Intimidation DC 10, Nature DC 10–15, Persuasion DC 10–18 (varies by class and race), Detect Thoughts, or a druid commanding the snake | the child is freed | one more, different appeal; a second failure kills the child |

**Exits**
- Persuade: de-escalate, or free the child.
- Combat: a riot, or fighting the druids.
- Progress: take the grove's job against the goblin leaders.
- Other: watch, and it resolves without you.

**Tangents**
- **[designed]**
  - Punch the tiefling, siding with Aradin.
  - Just watch.
  - Read Kagha's mind, or command the snake.
  - Attack Kagha, which starts a grove-wide fight.
  - Later, side with the goblins and raid the grove.
- **[designed]** Companions react in the moment. Saving Arabella gives Gale +8; Lae'zel disapproves.
- **[probe]**
  - Heal Aradin's wounded first.
  - Ask both about the missing archdruid.
  - Offer to hunt goblins for pay.
  - Take the child's punishment.
  - Return the idol yourself.
  - Address the whole crowd.
  - Hire the mercenaries.
- **Turn-taking:** in the cinematic, NPCs interject in turn, but each line is aimed at the party. The crowd is narrated, not voiced (pattern 9).
- **Improvisation stress:**
  - who speaks next;
  - an escalation ladder of soft moves (hands on hilts, the crowd closing in) before hard ones;
  - NPC-to-NPC chatter, V1's failure;
  - a default outcome if the party only watches.

### 5.6 Disco Elysium: the hanged man's yard (Cuno, Cunoesse, Kim)

- **Source:** *Disco Elysium*, Day 1.
  - Characters: [Cuno](https://discoelysium.wiki.gg/wiki/Cuno), [Cunoesse](https://discoelysium.wiki.gg/wiki/Cunoesse), [Kim](https://discoelysium.wiki.gg/wiki/Kim_Kitsuragi), [Wikipedia: Cuno](https://en.wikipedia.org/wiki/Cuno_(Disco_Elysium)).
  - Procedure: [field autopsy](http://www.gamebanshee.com/discoelysium/walkthrough/performfieldautopsy.php), [getting the body down](https://www.ginx.tv/en/get-body-down), [cause of death](https://www.thegamer.com/disco-elysium-finding-real-cause-death/).
- **Shape / complexity:** hostile witness + investigation + partner NPC, with several routes to the key beat. **4.**
- **Synopsis:** a man has hung for a week from a tree behind the hostel. A foul-mouthed boy pelts the corpse with rocks while a girl hurls abuse from behind the fence; both taunt the detective and his partner. To work the scene the detective must:
  - deal with the kids, or ignore them;
  - examine the ground and the body;
  - get the body down, by one of three routes: shoot the rope with the partner's gun, get the dockworkers' union to help (past their bouncer), or climb in through the boy's hidden shack;
  - run a field autopsy with the partner.

  The obvious cause of death is misdirection.

**Cast**

| NPC | Want | Fear | Secret | Voice |
|---|---|---|---|---|
| Cuno | respect; to be left alone; to get out of the district | his violent, addicted father | a hidden shack; uses speed; a real name he hides | third person ("Cuno doesn't care"), slurs, bravado |
| Cunoesse | to keep Cuno hers | being abandoned | manipulates him out of fear | vulgar, multilingual |
| Kim (partner) | to do the case right | *(inf.)* his partner wrecking it | keeps his private life private | calm, precise, dry; taps his foot |
| The body | — | — | shot first, hung afterwards | — |

Limits: Cuno won't cooperate with a cop who hasn't earned respect. Kim won't endorse brutality.

**Authored beats**
1. Heckling.
2. Deal with the kids.
3. Examine the scene.
4. Get the body down.
5. Autopsy with Kim.
6. A first theory and leads.

**Roll opportunities**

| Moment | Skill | Success | Failure |
|---|---|---|---|
| Punch Cuno | Physical Instrument | grudging respect and answers | you fall and get hurt; gifts later can mend it |
| See through Cunoesse | Empathy | her grip on him; separate them | — |
| A one-shot argument | Rhetoric (red check) | key information | lost for good |
| Shoot the rope | Hand/Eye Coordination | body down | harder if you rise to the heckling |
| Remove the belt | Physical Instrument | you do it | Kim cuts it |
| Final look | Perception | a bullet in the skull | the body goes to storage; revisit later |

**Exits**
- Progress: body down, evidence logged, leads.
- Persuade: Cuno talks or leaves.
- Combat, briefly: the punch.
- Other: go and fetch the union, which leads into the bouncer scene (§5.8).

**Tangents**
- **[designed]** Punch the kid. Ignore the heckling to make the shot. Gifts after a failed punch. The back route through the shack. Help from the union.
- **[seen]** Players warm to Cuno over the game. He can later become a partner ([Wikipedia](https://en.wikipedia.org/wiki/Cuno_(Disco_Elysium)); [Steam](https://steamcommunity.com/app/632470/discussions/0/3113648183779266876)).
- **[designed]** Failures that Kim covers.
- **[probe]**
  - Arrest Cuno.
  - Pay him to leave.
  - Join in the rock-throwing.
  - Ask what he saw the night of the hanging.
  - Leave the kids to Kim.
  - Come back at night.
- **The partner pattern:** Kim indulges jokes, then steers back to priorities. His disapproval works as a meter.
- **Improvisation stress:**
  - hostility without stonewalling;
  - the partner steers without becoming the GM's mouthpiece;
  - the cause of death has at least three routes.

### 5.7 Waterdeep: Dragon Heist: the Yawning Portal (brawl → troll → Volo)

- **Source:** *Waterdeep: Dragon Heist* (2018), Ch. 1 ([D&D Beyond](https://www.dndbeyond.com/sources/wdh)).
  - Running advice: [Sly Flourish](https://slyflourish.com/dragon_heist_chapter_1.html); Alexandrian remix ([1](https://thealexandrian.net/?p=42801), [2](https://thealexandrian.net/?p=42841)).
  - Table accounts: [Droplowest diary](https://droplowest.com/2019/07/31/dragon-heist-diary-part-two/); [D&D Beyond play-by-post](https://www.dndbeyond.com/forums/dungeons-dragons-discussion/play-by-post/79782-rynos-waterdeep-dragon-heist?comment=29).
  - Bonnie's secret: [Forgotten Realms wiki](https://forgottenrealms.fandom.com/wiki/Bonnie).
- **Shape / complexity:** crowd scene → brawl → monster interrupt → quest hook. **4.**
- **Synopsis**
  - In a famous tavern built around a pit into an ancient dungeon, a half-orc enforcer from one crime network and a gang from a rival guild start a brawl. The owner keeps polishing mugs.
  - Mid-chaos, a troll and a cloud of blood-drinking stirges climb out of the pit, and the owner joins the fight.
  - Afterwards a famously talkative author hires the party to find his missing friend: some coin now, much more on success. Later, unable to pay, he hands over the deed to a derelict manor instead.

**Cast**

| NPC | Want | Fear | Secret | Voice |
|---|---|---|---|---|
| Durnan (owner) | order in his house | *(inf.)* little | retired adventurer who made a fortune below | terse |
| Yagra Stonefist | win; keep face | — | Zhentarim | blunt |
| Krentz and thugs | rough her up | the watch | Xanathar Guild | sneering |
| Bonnie (barmaid) | keep her cover | exposure | a doppelganger | bubbly |
| Volo (author) | find his friend Floon | Floon's dead | short of cash | florid, name-dropping |
| Troll and stirges | to feed | fire | — | — |

Limits: Durnan doesn't step into fistfights. Volo can't pay more than he has.

**Authored beats**
1. Tavern life.
2. The brawl.
3. The party's involvement.
4. The interrupt from the pit.
5. Aftermath.
6. Volo's hire.
7. Exit.

**Roll opportunities**

| Moment | Skill | Success | Failure |
|---|---|---|---|
| Stop the brawl | Intimidation or Persuasion | the brawl fizzles | the party gets dragged in |
| Read the fight | Insight | who started it, and whose side to take | — |
| Notice the pit | Perception | early warning | surprise |
| Fee | Persuasion | a better fee or an advance | Volo's flustered best offer |

**Exits**
- Combat: the brawl or the troll.
- Persuade: a deal with Volo.
- Progress: the hunt for the missing friend.
- Other: leave.

**Tangents**
- **[seen]** A party sided with the enforcer. One PC asked her whether she even wanted help (play-by-post logs).
- **[seen]** A party rescued the wrong man first. The DM used his noble status to smooth over the legal trouble. A dwarf a player invented in session one came back as watch captain ([Droplowest](https://droplowest.com/2019/07/31/dragon-heist-diary-part-two/)).
- **[seen]** A double-agent PC turned on the party during the follow-up raid (play-by-post logs).
- **[designed fix]** The hire shouldn't depend on the fight: a regular introduces the party to Volo whatever they did ([Alexandrian](https://thealexandrian.net/?p=42841)).
- **[seen, advice]** Give tavern NPCs flavour and bring them back. Play the watch sergeant blustery but non-lethal ([Sly Flourish](https://slyflourish.com/dragon_heist_chapter_1.html)).
- **[probe]**
  - Jump into the pit.
  - Bet on the brawl.
  - Protect the barmaid.
  - Pick pockets in the chaos.
  - Haggle Volo up.
  - Refuse the job.
- **Improvisation stress:** handling a crowd, optional participation, and a hook that holds whatever the party did.

### 5.8 Lost Mine of Phandelver: Agatha's one question (+ Disco's Measurehead; riddles)

- **Source:** LMoP Part 3, Conyberry and Agatha's lair.
  - Session plot write-up: [World Anvil](https://www.worldanvil.com/w/forgotten-realms-haydenjohnsmusic24/a/agatha-s-lair-plot).
  - The necromancer's competing question: [World Anvil](https://www.worldanvil.com/w/lanath-elsanchez45/a/chapter-1-173A-old-owl-well-article).
  - Measurehead: [TheGamer](https://www.thegamer.com/disco-elysium-measurehead-guide/).
  - Riddle practice: [ENWorld](https://www.enworld.org/threads/riddle-mechanic-suggestion-advice.687683/), [TheGamer](https://www.thegamer.com/dungeons-and-dragons-riddles-dm-use-challenge/).
- **Shape / complexity:** an oracle gatekeeper limited to a single answer. **2.**
- **Synopsis:** a town's cleric, secretly an agent of a spy network, sends the party to a ruined village to put a question to a banshee: where did a legendary wizard's spellbook go?
  - A jeweled silver comb is the intended gift. Polite visitors can win one answer with Persuasion; the comb guarantees it.
  - The banshee is well informed and can answer almost any single question about the adventure, so players may spend it on something bigger.
  - A necromancer elsewhere wants his own question asked.

**Cast**

| NPC | Want | Fear | Secret | Voice |
|---|---|---|---|---|
| Agatha (banshee) | tribute; flattery; solitude | *(inf.)* being forgotten or mocked | knows far more than she's asked | icy, archaic, imperious |

Limit: one question. Rudeness brings anger, a wail, or her vanishing.

**Authored beats**
1. Approach.
2. She manifests and challenges them.
3. Gift or flattery.
4. The question.
5. Answer and dismissal.

**Roll opportunities**
- Persuasion DC 15 if polite without the gift; automatic success with the comb.
- Religion or Arcana: banshee etiquette and the danger.
- Insight: her mood.
- Saving throws if she wails.

**Exits**
- Persuade: an answer.
- Progress: leave with a lead.
- Combat.
- Other: leave empty-handed.

**Tangents**
- **[designed]** Three questions compete: the cleric's, the necromancer's, and the party's own (where the lost mine is, who the villain is).
- **[probe]**
  - Ask two questions at once.
  - Yes/no trickery.
  - Offer a different gift.
  - Flirt with her, or insult her.
  - Try to bind her.
  - Ask about her life.
  - Keep the comb.
- **Handling:** answer truthfully even when it short-cuts a mystery, then let the world react. Rule generously on compound questions.
- **Related gatekeepers**
  - **Measurehead:** a bouncer blocking the harbour gate, with four routes past him:
    1. Discredit his race theory, then flatten him with Physical Instrument.
    2. Adopt his theory.
    3. Ask his union boss.
    4. Climb round through Cuno's shack.
  - **Riddles:** tables give 3–5 graded hints through Intelligence checks, let the group confer, and avoid riddles where only one answer gets you through.
- **Improvisation stress:** the "big question" (T6), generosity vs protecting the plot, many keys to one gate.

### 5.9 Curse of Strahd: Madam Eva's tarokka reading

- **Source:** *Curse of Strahd* (2016) ([D&D Beyond](https://www.dndbeyond.com/sources/cos)).
  - Running the reading: [Roll20 tarokka guide](https://pages.roll20.net/dnd/tarokka-deck-guide); [D&D Beyond thread](https://www.dndbeyond.com/forums/dungeons-dragons-discussion/dungeon-masters-only/242496-sandbox-how-should-i-run-it-curse-of-strahd).
  - A table's account: [session report](https://titus171.itch.io/one-of-us-will-die/devlog/939500/curse-of-strahd-adventure-report-ii-once-more-into-the-mists).
- **Shape / complexity:** ritual divination with authored randomness, delivering information. **3.**
- **Synopsis:** at a travellers' camp beside misty pools, an ancient seer who seems to have expected the party reads five cards. They reveal where three relics lie, who the party's ally will be, and where the tyrant will be met. Each card comes with a cryptic verse. GMs either draw live or stack the deck, and the reading drives the whole campaign.

**Cast**

| NPC | Want | Fear | Secret | Voice |
|---|---|---|---|---|
| Madam Eva (seer) | the tyrant's evil undone | *(inf.)* the party failing like the others before them | far older than she looks; a pact with a goddess of night; blood kin to the tyrant | theatrical, knowing, cryptic |
| The camp's hosts | profit; to protect the seer | — | some sell information | wary, mocking |

Limit: no plain answers. The cards speak.

**Authored beats**
1. Arrival.
2. Invitation into the tent.
3. The reading: five cards, one per beat.
4. Questions.
5. Dismissal.

**Roll opportunities**
- Insight: she's sincere.
- Perception: someone listening outside.
- History or Religion: the card symbols.
- Persuasion: one extra hint.
- Sleight of Hand: peek or cheat, with consequences.

**Exits**
- Progress: the reading is delivered.
- Other: the reading is declined and happens later or elsewhere.
- Combat: attacking the hosts, which is disastrous.

**Tangents**
- **[seen]** Most of one party declined their fortunes. Only one player accepted, and the reading went ahead for her alone ([session report](https://titus171.itch.io/one-of-us-will-die/devlog/939500/curse-of-strahd-adventure-report-ii-once-more-into-the-mists)).
- **[seen, advice]** Stack the deck or draw at random. Make the five or so locations the reading highlights the important ones. Nudge parties that drift with a theatrical appearance by the villain or his agents ([D&D Beyond](https://www.dndbeyond.com/forums/dungeons-dragons-discussion/dungeon-masters-only/242496-sandbox-how-should-i-run-it-curse-of-strahd); [Roll20](https://pages.roll20.net/dnd/tarokka-deck-guide)).
- **[probe]**
  - "Just tell us how to kill him", or how to leave.
  - Ask about their own backstories.
  - Ask her to come along.
  - Insult the hosts.
  - Steal the deck, or read it themselves.
  - Demand a redraw.
- **Handling:** make it interactive by letting players draw. Each verse should be cryptic but actionable, with backup clues elsewhere. Answer off-topic questions with a related omen, not a refusal.
- **Improvisation stress:** refusal (T12), pressure for plain answers (T6), pacing a ritual.

### 5.10 Baldur's Gate 3: Lae'zel in the cage (+ Sunless Citadel's Meepo)

- **Source:** BG3 Act 1, "Free Lae'zel" ([bg3.wiki](https://bg3.wiki/wiki/Free_Lae%27zel), [Lae'zel](https://bg3.wiki/wiki/Lae%27zel)).
  - Tabletop: *The Sunless Citadel* (in *Tales from the Yawning Portal*). Sources: [World Anvil report](https://www.worldanvil.com/w/oerth-krithernak/a/the-sunless-citadel-report-report), [ENWorld](https://www.enworld.org/threads/iseriths-sunless-citadel.647365/).
- **Shape / complexity:** a third-party dispute over a captive → recruitment. **2.**
- **Synopsis:** two jumpy scouts have a dangerous warrior trapped in a hanging cage and are arguing over whether to shoot her. The party can:
  - scare them off;
  - talk them into shooting the cage down;
  - side with them;
  - fight.

  Freed, she demands help with the affliction the party shares, and can be recruited. She respects bluntness and despises mercy and submission.
- **Tabletop parallel:** a kobold whose clan's pet dragon was stolen begs for help. He leads the party to his chieftain, who trades a key for the dragon's return. Players often adopt him.

**Cast**

| NPC | Want | Fear | Secret | Voice |
|---|---|---|---|---|
| Lae'zel | freedom; a cure through her own people | *(inf.)* dishonour | her people's agenda | clipped, contemptuous, martial |
| Nymessa and Damays (scouts) | neutralise the threat | her kind | — | nervous bravado |
| Meepo (tabletop) | get the dragon back; status | goblins; his chieftain | — | eager, squeaky |

Limits: she won't beg. The scouts won't free a monster without a reason.

**Authored beats**
1. Overhear the argument.
2. Approach.
3. Deal with the scouts.
4. Free her.
5. Her terms.
6. Recruit or refuse.

**Roll opportunities**
- Deception DC 10: scare the scouts off.
- Persuasion DC 5–7: get them to shoot the cage down, or argue she's not a beast.
- Intimidation DC 5, when the PC's race frightens them.
- Attacking the cage while the scouts are present starts combat.

**Exits**
- Persuade: the scouts leave.
- Combat.
- Progress: recruit her.
- Other: walk away, and she breaks out later and kills the scouts.

**Tangents**
- **[designed]** Talk the scouts away, then attack them (a Charlatan earns inspiration for it). Walk away and an off-screen outcome follows.
- **[designed]** Companion approval reacts.
- **[seen]** A DM gave Meepo mechanical value (advantage when talking to kobolds) so players kept him around. One party made him fight as a punishment, felt bad, healed him, and he idolised them afterwards (ENWorld threads).
- **[probe]**
  - Leave her caged as leverage.
  - Demand an oath.
  - Side with the scouts and kill her.
  - Recruit the scouts instead.
- **Improvisation stress:** double-cross (T3), adopting an NPC (T8), and keeping a recruited NPC's voice consistent once they're in the party.

### 5.11 The Witcher 3: the Bloody Baron (+ the Inn at the Crossroads)

- **Source:** *The Witcher 3: Wild Hunt* (CD Projekt Red, 2015).
  - Quest: [Wikipedia](https://en.wikipedia.org/wiki/The_Bloody_Baron), [fextralife](https://thewitcher3.wiki.fextralife.com/Bloody+Baron), [guides4gamers](https://guides4gamers.com/witcher-3-wild-hunt/quests/the-nilfgaardian-connection/).
  - Critique and design: [Shamus Young](https://www.shamusyoung.com/twentysidedtale/?p=42769), [nullpointer](https://www.nullpointer.co.uk/should-you-be-able-to-kill-the-king-rpg-design.html).
- **Shape / complexity:** a morally grey quest-giver whose confession comes in layers, with delayed consequences and reactions to earlier choices. **5.**
- **Synopsis:** seeking word of a missing girl, the witcher reaches a warlord's keep.
  - The Baron, jovial and dangerous, will share what he knows only after the witcher finds his runaway wife and daughter.
  - Searching their rooms and drinking with him peels back the layers: the drinking, the beatings, a lost pregnancy, his guilt.
  - The leads go to a cursed infant spirit, which can be destroyed or laid to rest; both paths end at the same place. They also go to a daughter who refuses to come home, and a wife enslaved by swamp witches.
  - A seemingly unrelated choice elsewhere decides whether the ending is a tragedy or a bleak, compromised survival.
  - Earlier, at a crossroads inn, the Baron's soldiers bully the innkeeper. Whether the witcher buys them drinks, insults them or kills them changes how the keep's gate guards greet him.

**Cast**

| NPC | Want | Fear | Secret | Voice |
|---|---|---|---|---|
| The Baron | his family back; absolution | what he is; that she's gone for good | the beatings; the miscarriage | hearty, joking, maudlin in drink, flashes of menace |
| Quartermaster and soldiers | to protect their lord | — | gossip | blunt |

Limits: he won't share the information first, and won't admit the worst while sober.

**Authored beats (first meeting)**
1. The gate, which reacts to the inn.
2. The audience: his bargain.
3. Searching the family's rooms.
4. The drinking confession, in layers.
5. The player's judgment.
6. Commitment.

**Roll opportunities (as a tabletop scene)**
- Insight: what he's hiding.
- Investigation or Medicine: the rooms (blood, a broken door).
- Persuasion: part of the information up front. Impossible in the game, plausible at a table.
- Intimidation: risky in his own hall.
- Deception: claim to know more than you do.

**Exits**
- Persuade: a deal.
- Progress: quest accepted.
- Combat: attack the Baron. His guards respond, and the lead now needs another route.
- Other: refuse, with consequences.

**Tangents**
- **[designed]** The inn changes the gate: waved through, pay up, or sneak in through a flooded cave with a hag in it.
- **[designed]** Killing or saving the spirit converges.
- **[critique]** The witcher can't refuse the job or really judge the Baron. The meaning is left to the player ([Shamus Young](https://www.shamusyoung.com/twentysidedtale/?p=42769)).
  - At a table, players will threaten him, arrest him, refuse or kill him. The GM needs other routes to the information (the quartermaster, the daughter, documents), with consequences that follow from what the players did ([nullpointer](https://www.nullpointer.co.uk/should-you-be-able-to-kill-the-king-rpg-design.html); [Ask the Alexandrian #16](https://thealexandrian.net/?p=51874)).
- **[probe]**
  - Seek out the wife's side first.
  - Confront him with the miscarriage early.
  - Get him drunk faster.
  - Demand payment.
  - Question the soldiers.
- **Improvisation stress:**
  - the NPC stays himself under moral judgment, neither collapsing nor raging;
  - pacing the reveals;
  - killing the quest-giver (T2).

### 5.12 Storm King's Thunder: before the Wyrmskull Throne (+ NWN2 and KOTOR trials)

- **Source:** *Storm King's Thunder* (2016), Ch. 10 ([D&D Beyond](https://www.dndbeyond.com/sources/skt)).
  - Tabletop running notes: [World Anvil session](https://www.worldanvil.com/w/forgotten-realms-phork37/a/skt72-before-the-wyrmskull-throne-article), [Sly Flourish](https://slyflourish.com/getting_the_most_out_of_skt.html), [Alexandrian remix](https://thealexandrian.net/?p=50815).
  - cRPG trials: NWN2 trial ([LP archive](https://lparchive.org/Neverwinter-Nights-2/Update%2041), [sorcerers.net](https://sorcerers.net/Games/NWN2/Walkthrough2/act2/trials.php)); KOTOR's [Sunry murder trial](https://almarsguides.com/Computer/Games/StarWarsKnightsoftheOldRepublic/SideQuests/Manaan/SunryMurderTrial/) and [Manaan court](https://almarsguides.com/computer/games/starwarsknightsoftheoldrepublic/walkthrough/manaan/).
  - Running a tabletop trial: [Tribality](https://www.tribality.com/2019/03/26/how-to-have-a-courthouse-session/).
- **Shape / complexity:** a formal court hearing with many NPCs, conflicting interests, a hidden traitor and evidence. **5.**
- **Synopsis:** the party is received at an undersea court where a young regent rules in her missing father's place. Around the throne stand:
  - envoys of rival giant clans;
  - her two elder sisters, secretly complicit in the plot against her parents;
  - her uncle the garrison commander, who distrusts "small folk";
  - her most trusted counsellor, in truth a dragon in disguise and the hand behind it all.

  The party presents what they know and the court argues. The truth may come out, or the party may be discredited.

**Cast**

| NPC | Want | Fear | Secret | Voice |
|---|---|---|---|---|
| Serissa (regent) | find her father; avoid war | civil war among the clans | unsure of her own authority | earnest, formal |
| Uthor (uncle) | tradition; no deals with small folk | angering the gods | none: honest but wrong | gruff |
| Iymrith (counsellor) | stay hidden; discredit the party | exposure | a dragon behind the plot | smooth, reasonable |
| Mirran and Nym (sisters) | the throne | exposure; their blackmailer | co-conspirators | honeyed / sullen |
| Envoys | advantage for their clan | losing face | — | varied |

Limit: Serissa won't move against a counsellor without proof.

**Authored beats**
1. Arrival and protocol.
2. Introductions.
3. The petition.
4. Rebuttal.
5. Evidence and witnesses.
6. A ruling, or an unmasking.
7. A commission, or a crisis.

**Roll opportunities**
- History: protocol.
- Persuasion: the regent and the envoys.
- Insight on Iymrith, at a high DC.
- Arcana: spotting the illusion.
- Deception: fabricating evidence, which is dangerous.
- Performance: rhetoric.

**Exits**
- Persuade: a ruling, and support.
- Combat: the unmasking.
- Progress: the mission.
- Other: expelled or imprisoned.

**Tangents and structure precedents**
- **[seen, advice]** Let unexpected player actions, such as dream magic, reveal the story ([Sly Flourish](https://slyflourish.com/getting_the_most_out_of_skt.html)).
- **[seen, advice]** The published mystery's logic is shaky, so GMs remix it. The GM needs one coherent truth to improvise against ([Alexandrian](https://thealexandrian.net/?p=50815)).
- **[designed]** NWN2 makes a trial a contest of drama as much as evidence. Diplomacy, Bluff and Intimidate each move points, and win or lose it ends in trial by combat ([LP archive](https://lparchive.org/Neverwinter-Nights-2/Update%2041), [sorcerers.net](https://sorcerers.net/Games/NWN2/Walkthrough2/act2/trials.php)).
- **[designed]** KOTOR has two court scenes:
  - You defend a client who turns out to be guilty, and you can still get him off ([almarsguides](https://almarsguides.com/Computer/Games/StarWarsKnightsoftheOldRepublic/SideQuests/Manaan/SunryMurderTrial/)).
  - In another court, lying or admitting guilt can get you executed. The court-appointed advocate falls back on an insanity plea if you let him talk ([almarsguides](https://almarsguides.com/computer/games/starwarsknightsoftheoldrepublic/walkthrough/manaan/)).
- **[seen, advice]** At the table: the first side to establish three decisive facts wins. Don't execute a PC on a bad roll; bring in a friendly witness or an interruption instead. Speak with Dead shouldn't trivialise the case ([Tribality](https://www.tribality.com/2019/03/26/how-to-have-a-courthouse-session/)).
- **[probe]**
  - Accuse the counsellor with no proof.
  - Challenge someone to single combat.
  - Refuse to kneel.
  - Demand a private audience.
  - Bribe an envoy.
  - Compel the truth with magic.
  - Walk out.
- **Improvisation stress:**
  - procedure vs improvisation;
  - many voices;
  - one hidden truth kept consistent;
  - outcomes that converge without railroading.

---

## 6. Also considered

| Scene | Source | Why it's interesting |
|---|---|---|
| Oleg's Trading Post | Pathfinder *Kingmaker* AP, "Stolen Land"; the Pathfinder: Kingmaker cRPG ([gamerguides](https://www.gamerguides.com/pathfinder-kingmaker/guide/walkthrough/chapter-1-getting-started-in-the-outskirts/olegs-trading-post), [Paizo](https://paizo.com/threads/rzs2nlgh), [ENWorld](https://www.enworld.org/threads/kingmaker.312414/)) | Bandits come to collect a monthly "tax" from a frontier trader, and players prepare an ambush. The leader often escapes and returns. The cRPG adds an [Evil] option to shake the trader down yourself. A strong fit for the road. |
| Venomfang at Thundertree | LMoP ([grown-ups](https://grown-ups.dyndns.org/phandelver/?p=60)) | Negotiating with an apex threat. One table talked it into moving to a castle. |
| Hamun Kost at Old Owl Well | LMoP ([World Anvil](https://www.worldanvil.com/w/lanath-elsanchez45/a/chapter-1-173A-old-owl-well-article); [review](https://abekin.bearblog.dev/lost-mine-of-phandelver/)) | A necromancer who calls off his zombies when hailed and trades information for favours. One DM found it "no interesting decision", which makes it a useful negative example. |
| Kobolds vs goblins | *The Sunless Citadel* ([World Anvil](https://www.worldanvil.com/w/oerth-krithernak/a/the-sunless-citadel-report-report)) | Two-faction dungeon diplomacy. Goblin prisoners promise an escort and plan to betray it. |
| Auntie Ethel's teahouse | BG3 ([eip.gg](https://eip.gg/bg3/guides/save-mayrina/)) | A sweet old shopkeeper argues with two brothers about their missing sister. DC 19 Insight shows she's lying, and staying neutral gets the brothers killed. A deceptive merchant in a multi-NPC scene. |
| Council of Waterdeep | *Rise of Tiamat* ([Kobold Press](https://koboldpress.com/the-rise-of-tiamat-a-dms-and-players-overview/)) | A faction council whose support depends on the reputation earned on missions. |
| Wrex on Virmire | *Mass Effect* ([RPG Site](https://www.rpgsite.net/feature/11128-mass-effect-virmire-choices-who-to-send--take-dealing-with-wrex-and-assisting-kirrahes-team)) | A talk-down gated by earlier choices, with a companion's life at stake. |
| "Here There Be Gerblins" | *The Adventure Zone* ([TAZ wiki](https://theadventurezone.fandom.com/wiki/Here_There_Be_Gerblins)) | An actual-play run of LMoP's opening where the GM remixed the beats heavily. The boss kills his lieutenant, and the town is destroyed by the end of the arc. |

---

## 7. Recommended PoC set, in one setting

### 7.1 The set (build and test in this order)

Names follow the current scene files: Caerwyn and King Aldren's palace, the King's Road, the toll house and its warden Garrow, the drovers' track to Hollis Farm in Nine Furrows, and Skrag's warren under the burnt mill. The delegations are Nine Furrows (agricultural wizards), Kläggenheim (dwarven miners and engineers) and Saltmere (ships and credit).

| # | PoC scene | Built from | Cx | What it tests | Exits |
|---|---|---|---|---|---|
| 1 | **The Mad Farmer at the Crossroads** (built) | user's example; Goblin Arrows; Barcus | 2 | combat exit and aftermath; paranoia; whether a hiding NPC's fate stays consistent | combat → aftermath; persuade; other (walk on) |
| 2 | **Garrow's toll** | Garte's bill; the Witcher's crossroads inn | 1–2 | 1:1 negotiation with some charges fixed; absurd persistence; how the party treats the warden's men is recorded and changes later scenes | persuade (toll waived or reduced); progress (pay); other (slip past) |
| 3 | **The warren under the burnt mill** | Yeemik's bargain + Sildar's debrief | 3 | deception and double-cross; Skrag as a Yeemik who fears his chieftain; a captive (a Kläggenheim surveyor or a royal courier) whose debrief depends on how they were freed | persuade; combat; progress; other (Skrag becomes chieftain) |
| 4 | **Standoff on the Nine Furrows green** | BG3 Aradin/Zevlor + Kagha/Arabella | 4 | who speaks next; escalation ladder; side-taking; what happens if the party just watches | persuade; combat; progress; other |
| 5 | **The hanged clerk behind the Caerwyn granary** | Disco's yard | 4 | a hostile urchin without stonewalling; a watch-sergeant partner who steers; three routes to the cause of death | progress; persuade; combat (a punch); other |
| 6 | **Brawl in the Assembly taproom** | Yawning Portal | 4 | Kläggenheim miners vs Saltmere sailors; a crowd; an interrupt from the cellar (rats, or goblins tunnelling in); a herald or chronicler whose hire doesn't depend on the fight | combat; persuade; progress; other |
| 7 | **The widow of the burnt mill** | Agatha's one question | 2 | the "big question"; gift and flattery; answering without breaking the plot | persuade; progress; other |
| 8 | **Audience before King Aldren** | Storm King's Thunder court + NWN2/KOTOR trials | 5 | formal procedure with room to improvise; many NPCs; a hidden truth; a meter instead of single-roll endings | persuade; combat; progress; other |

Alternates:
- **A caged goblin for sale** in the Caerwyn market (KOTOR haggle + Lae'zel's cage), Cx 2.
- **The hedge-witch's cards** at the crossroads shrine (Madam Eva), Cx 3.
- **The reeve's confession** (the Bloody Baron), Cx 5.

### 7.2 Which scenes stress improvisation hardest

1. **#3, the warren:** lies and leverage. Skrag must reason from his goal, not recite. It tests "a creative variant gets a fitting outcome": holding Grandmother Bone hostage is not the same as intimidating him.
2. **#4, the green:** several NPCs and a crowd. This is the direct test of turn-taking and V1's NPC-chatter failure. A soft-to-hard escalation ladder replaces single-roll endings.
3. **#5, the hanged clerk:** insults and hostility. A partner NPC must steer without becoming the GM's mouthpiece. Investigation clues need several routes, and props must not become fake hooks.
4. **#8, the audience:** procedure vs improvisation, accusations without proof, and one coherent hidden truth across many voices.
5. **#6, the taproom:** crowds, interrupts, and players who refuse to engage.

The others still matter. #7 tests answering anything; #2 tests absurd persistence and remembering how the party behaved; #1 tests paranoia and aftermath continuity.

### 7.3 Adapting the sources to the Caerwyn road

- **Map hub:**
  - the palace at Caerwyn;
  - the granary quarter and its taproom;
  - the city gate;
  - the King's Road;
  - the toll house and its warden Garrow;
  - the crossroads, with milestone and gibbet;
  - the drovers' track to Hollis Farm and the Nine Furrows green;
  - the burnt mill on the river, with the warren beneath and the widow's ghost.
- **An optional through-line.** Skip it if the user wants self-contained scenes.
  - Someone at court has been paying the goblins to raid grain and ore carts on the King's Road. This could be a new NPC, say a Saltmere factor posing as a royal purveyor. Keep V1's named characters out of the villain role unless the user decides otherwise.
  - Proof builds up scene by scene:
    - stamped coin in goblin pouches (#1, #3);
    - the courier's intercepted letter (#3);
    - the Kläggenheim escort's grievance (#4);
    - the clerk who found the ledger and was "hanged" (#5);
    - miners vs sailors in the taproom (#6);
    - the widow's one true answer (#7);
    - the audience where it comes out (#8).
- **Low-fantasy swaps:**

  | Source element | Swap |
  |---|---|
  | Troll and stirges | a starving bear, or goblins breaking up through an old cellar tunnel; rats |
  | Banshee | the burnt miller's widow |
  | Tarokka deck | cards or bones read at the crossroads shrine |
  | Snake over the child | a hedge-ward or a branding iron |
  | Caged githyanki | a goblin or a deserter in the empty gibbet |
  | Talking droid | a caged goblin for sale who insults buyers |
  | Dragon counsellor | a human agent under a false name |
  | "The Black Spider" | a signet stamped on the coins |

- **Cast mapping:**

  | PoC scene | Adapted cast | Facts it can write to the world |
  |---|---|---|
  | 2 Garrow's toll | Garrow, who laughed at Tam; his toll-house men | toll paid or waived; how the toll-house men feel about the party, which carries to the city gate (Witcher-style) |
  | 3 The warren | Skrag, the unseen chieftain, the captive, goblin chorus | captive freed or dead; who leads the warren; the coin stamp |
  | 4 Nine Furrows green | Kläggenheim escort captain (lost men on the road); a Nine Furrows elder; a child caught with a dwarven tool or charm; the warden judging her | convoy released or held; village trust |
  | 5 Granary yard | the urchin pelting the body; his sister behind the fence; a Caerwyn watch sergeant | cause of death; the ledger page; suspects |
  | 6 Taproom | owner; miners; sailors; a barmaid with a secret; the herald who hires | brawl outcome; an invitation to court |
  | 7 Burnt mill | the widow | one answer |
  | 8 Audience | King Aldren (weary), the three delegations, the hidden agent | ruling; unmasking; whether the Assembly holds |

---

## 8. Sources

**Published adventures and their running guides**
- Lost Mine of Phandelver: [D&D Beyond](https://www.dndbeyond.com/sources/lmop) · Waterdeep: Dragon Heist: [D&D Beyond](https://www.dndbeyond.com/sources/wdh) · Curse of Strahd: [D&D Beyond](https://www.dndbeyond.com/sources/cos) · Storm King's Thunder: [D&D Beyond](https://www.dndbeyond.com/sources/skt)
- Sly Flourish: [Dragon Heist ch. 1](https://slyflourish.com/dragon_heist_chapter_1.html) · [Getting the most out of SKT](https://slyflourish.com/getting_the_most_out_of_skt.html)
- The Alexandrian: [Dragon Heist remix: Finding Floon](https://thealexandrian.net/?p=42801) · [Dragon Heist remix: opening](https://thealexandrian.net/?p=42841) · [SKT remix: Hekaton is missing](https://thealexandrian.net/?p=50815)
- [Roll20 tarokka guide](https://pages.roll20.net/dnd/tarokka-deck-guide) · [Kobold Press: Rise of Tiamat overview](https://koboldpress.com/the-rise-of-tiamat-a-dms-and-players-overview/)

**Real-table and actual-play evidence**
- LMoP: [View from the Stars ch. 2](https://theviewfromthestars.substack.com/p/chapter-2-goblin-ambush) · [ch. 5](https://theviewfromthestars.substack.com/p/chapter-5-interrogation-techniques) · [D&D Beyond "Advice please"](https://www.dndbeyond.com/forums/dungeon-masters-only/27158-relationships-dragons/next) · [D&D Beyond "Does this sound fun?"](https://www.dndbeyond.com/forums/dungeon-masters-only/74860-this-might-have-been-asked-before/next) · [ENWorld "Lost wagon of Phandelver"](https://www.enworld.org/goto/post?id=6378223) · [Play review](https://abekin.bearblog.dev/lost-mine-of-phandelver/) · [grown-ups: Sildar sessions](https://grown-ups.dyndns.org/phandelver/tag/sildar-hallwinter/) · [grown-ups: Venomfang](https://grown-ups.dyndns.org/phandelver/?p=60) · World Anvil: [Sildar](https://www.worldanvil.com/w/faerun-rothguard/a/sildar-hallwinter-person), [Cragmaw Hideout](https://www.worldanvil.com/w/lanath-elsanchez45/a/chapter-1-23A-the-cragmaw-hideout-article), [Old Owl Well](https://www.worldanvil.com/w/lanath-elsanchez45/a/chapter-1-173A-old-owl-well-article), [Agatha's lair](https://www.worldanvil.com/w/forgotten-realms-haydenjohnsmusic24/a/agatha-s-lair-plot)
- The Adventure Zone: [Here There Be Gerblins](https://theadventurezone.fandom.com/wiki/Here_There_Be_Gerblins) · [Fanlore: Balance](https://www.fanlore.org/wiki/Balance_Arc)
- Dragon Heist: [Droplowest diary](https://droplowest.com/2019/07/31/dragon-heist-diary-part-two/) · [D&D Beyond play-by-post](https://www.dndbeyond.com/forums/dungeons-dragons-discussion/play-by-post/79782-rynos-waterdeep-dragon-heist?comment=29) · [FR wiki: Bonnie](https://forgottenrealms.fandom.com/wiki/Bonnie)
- Curse of Strahd: [Session report](https://titus171.itch.io/one-of-us-will-die/devlog/939500/curse-of-strahd-adventure-report-ii-once-more-into-the-mists) · [D&D Beyond: sandbox thread](https://www.dndbeyond.com/forums/dungeons-dragons-discussion/dungeon-masters-only/242496-sandbox-how-should-i-run-it-curse-of-strahd) · [D&D Beyond: Bildrath thread](https://www.dndbeyond.com/forums/dungeon-masters-only/151076-aasimar-fey-switcheroo/next)
- SKT: [World Anvil: Before the Wyrmskull Throne](https://www.worldanvil.com/w/forgotten-realms-phork37/a/skt72-before-the-wyrmskull-throne-article)
- Sunless Citadel: [World Anvil report](https://www.worldanvil.com/w/oerth-krithernak/a/the-sunless-citadel-report-report) · [ENWorld: iserith's Sunless Citadel](https://www.enworld.org/threads/iseriths-sunless-citadel.647365/)
- Kingmaker: [Paizo: escaped bandits](https://paizo.com/threads/rzs2nlgh) · [ENWorld: Kingmaker](https://www.enworld.org/threads/kingmaker.312414/)

**cRPG wikis and walkthroughs**
- BG3: [Aradin](https://bg3.wiki/wiki/Aradin) · [Zevlor](https://bg3.wiki/wiki/Zevlor) · [Emerald Grove](https://bg3.wiki/wiki/Emerald_Grove) · [Save Arabella](https://bg3.wiki/wiki/Save_Arabella) · [Free Lae'zel](https://bg3.wiki/wiki/Free_Lae%27zel) · [Lae'zel](https://bg3.wiki/wiki/Lae%27zel) · [Barcus Wroot](https://bg3.wiki/wiki/Barcus_Wroot) · [Approval](https://bg3.wiki/wiki/Approval) · [Ability check](https://bg3.wiki/wiki/Ability_check) · [eip.gg: Save Mayrina](https://eip.gg/bg3/guides/save-mayrina/)
- Disco Elysium: [Cuno](https://discoelysium.wiki.gg/wiki/Cuno) · [Cunoesse](https://discoelysium.wiki.gg/wiki/Cunoesse) · [Kim Kitsuragi](https://discoelysium.wiki.gg/wiki/Kim_Kitsuragi) · [Wikipedia: Cuno](https://en.wikipedia.org/wiki/Cuno_(Disco_Elysium)) · GameBanshee: [Pay for damages](http://www.gamebanshee.com/discoelysium/walkthrough/payfordamages.php), [Field autopsy](http://www.gamebanshee.com/discoelysium/walkthrough/performfieldautopsy.php), [Review (check types)](https://gamebanshee.com/3wx38) · [GINX: body down](https://www.ginx.tv/en/get-body-down) · TheGamer: [cause of death](https://www.thegamer.com/disco-elysium-finding-real-cause-death/), [Measurehead](https://www.thegamer.com/disco-elysium-measurehead-guide/) · [TrueAchievements](https://www.trueachievements.com/game/Disco-Elysium/walkthrough/2) · Steam: [Garte](https://steamcommunity.com/app/632470/discussions/0/2270319347573508910), [Cuno](https://steamcommunity.com/app/632470/discussions/0/3113648183779266876)
- KOTOR: [GameBanshee: droid shop](https://www.gamebanshee.com/starwarskotor/locations/droidshop.php) · [Archivum: Yuka Laka](https://starwars.archivum.wiki/article/Yuka_Laka) · [almarsguides: Sunry trial](https://almarsguides.com/Computer/Games/StarWarsKnightsoftheOldRepublic/SideQuests/Manaan/SunryMurderTrial/) · [almarsguides: Manaan](https://almarsguides.com/computer/games/starwarsknightsoftheoldrepublic/walkthrough/manaan/)
- NWN2: [LP archive: the trial](https://lparchive.org/Neverwinter-Nights-2/Update%2041) · [sorcerers.net: trials](https://sorcerers.net/Games/NWN2/Walkthrough2/act2/trials.php)
- Witcher 3: [Wikipedia: The Bloody Baron](https://en.wikipedia.org/wiki/The_Bloody_Baron) · [fextralife: Bloody Baron](https://thewitcher3.wiki.fextralife.com/Bloody+Baron) · [guides4gamers: The Nilfgaardian Connection](https://guides4gamers.com/witcher-3-wild-hunt/quests/the-nilfgaardian-connection/) · [Shamus Young](https://www.shamusyoung.com/twentysidedtale/?p=42769) · [rutab.net: roadside lure](https://rutab.net/b/the-witcher-3-wild-hunt/2020/04/27/dopolnitelnoe-zadanie-ograblenie-na-trakte.html) · [Persons in distress](https://game-checklists.com/witcher3/all-persons-in-distress-checklist.html)
- Others: [Pathfinder: Kingmaker: Oleg's Trading Post](https://www.gamerguides.com/pathfinder-kingmaker/guide/walkthrough/chapter-1-getting-started-in-the-outskirts/olegs-trading-post) · [Mass Effect: Virmire](https://www.rpgsite.net/feature/11128-mass-effect-virmire-choices-who-to-send--take-dealing-with-wrex-and-assisting-kirrahes-team) · [Kingdom Come: haggling](https://www.gamerguides.com/kingdom-come-deliverance/introduction/useful-gameplay-tips/haggling)

**GM craft referenced**
- The Alexandrian: [Don't Prep Plots](https://thealexandrian.net/wordpress/4147/roleplaying-games/dont-prep-plots) · [Three Clue Rule](https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule) · [Ask the Alexandrian #16](https://thealexandrian.net/?p=51874) · [Art of Pacing pt. 6](https://thealexandrian.net/wordpress/33796/roleplaying-games/the-art-of-pacing-part-6-more-advanced-techniques)
- Sly Flourish: [Improv](https://slyflourish.com/dnd_improv.html) · [Mercer on NPCs](https://slyflourish.com/mercer_bringing_npcs_to_life.html)
- DMDavid: [Multi-NPC scenes](https://dmdavid.com/tag/running-group-roleplaying-scenes-how-permission-from-an-rpg-legend-made-me-stop-talking-to-myself/) · [Paranoia and unfair encounters](https://dmdavid.com/tag/tag/paranoia/)
- Rules and theory: [Dungeon World SRD: GM](https://www.dungeonworldsrd.com/gamemastering/) · [Fate SRD: running the game](https://fate-srd.com/fate-core/running-game) · [Daily Apocalypse: failing forward](https://daily-apocalypse.com/daily-apocalypse/143-beyond-success-failure-failing-forward-and-moves-in-apocalypse-world) · [ENWorld: adjudicating actions](https://www.enworld.org/goto/post?id=6625477)
- Specific techniques: [ENWorld: haggling](https://www.enworld.org/threads/haggling-rules-guidelines-suggestions.233193/) · ENWorld: [riddles](https://www.enworld.org/threads/riddle-mechanic-suggestion-advice.687683/) · TheGamer: [riddles](https://www.thegamer.com/dungeons-and-dragons-riddles-dm-use-challenge/) · [Tribality: courthouse sessions](https://www.tribality.com/2019/03/26/how-to-have-a-courthouse-session/) · [nullpointer: killing quest-givers](https://www.nullpointer.co.uk/should-you-be-able-to-kill-the-king-rpg-design.html)
