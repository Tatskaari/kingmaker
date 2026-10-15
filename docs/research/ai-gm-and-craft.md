# AI Game Masters and GM Craft: Improvising Around Authored Scenes

Research for the Kingmaker V2 scene runtime. Compiled 2026-10-14.

The top question is how an AI GM, and the characters it voices, can improvise around unscripted player tangents while still landing the authored beats, without stonewalling and without railroading. Every section is written with that question in mind.

**How to read this.** Sections 1 to 4 answer the four research questions: Friends & Fables, tabletop GM craft, interactive-drama precedents, and the Decisions API. Section 5 applies the research to the first blind-QA transcripts (`runs/sessions/qa1-*`). Section 6 lists concrete design implications. Sources are linked inline and collected at the end.

**Source reliability tags.** **[primary]** means official docs, patch notes, papers or source code. **[press]** means journalism. **[competitor]** means a review published by a competing AI-RPG product, so treat its praise or criticism with care. **[user]** means forum or feedback posts.

---

## 0. Executive summary

1. **Friends & Fables' GM, "Franz", is confirmed.** The product is built by Side Quest Labs (William Liu and David Melnychuk). Franz is not one model but an orchestrated pipeline: a research step pulls relevant lore, memories and entities into a shared "working context", a narration model writes the reply, and post-processing models update game state ([How Franz works](https://fables.gg/blog/how-franz-works), [PC Gamer via Yahoo](https://tech.yahoo.com/ai/articles/generative-ai-dividing-rpg-fans-013630531.html)).
2. **F&F's most relevant lesson for us concerns railroading by plan.** Franz 2.0 added a persistent "plan". Users then complained that Franz "forces the player into what it has decided" and loops until they do it. F&F responded by making the plan ephemeral: it is rewritten after every player message and then discarded, explicitly "to help Franz feel less railroady" ([25.39](https://fables.gg/patch-notes/patch-notes-2540-plot-and-plan-changes)). By May 2026 they had switched the planning step off because it hurt performance ([26.03](https://fables.gg/patch-notes/patch-notes-2603-craft-update)).
3. **F&F's team concluded that rigid pipelines hurt improvisation.** They said an architecture built for weaker models "limits how well he can handle situations we didn't specifically design for" ([Dev Log 26.01](https://fables.gg/patch-notes/development-log-2601)). Their successor product, Craft, is a single tool-using GM agent. Its context is controlled by visibility levels, and it loads conditional GM instructions on narrative or tool triggers ([Craft docs](https://www.craftrpgs.com/docs/writing-gm-instructions)). Since September 2026 Craft's default model is GPT-6 Luna ([B0.048](https://www.craftrpgs.com/patch-notes/patch-notes-b0-048-space-bunny-alpha-gpt-6-luna-core)).
4. **Tabletop craft agrees on what to prepare.** Prepare *situations, not plots*: what is true, who wants what, and what each person can do. Deliver must-land information through several routes (the Three Clue Rule). Untether clues from their locations (Lazy GM). Then *react* ([Don't Prep Plots](https://thealexandrian.net/wordpress/4147/roleplaying-games/dont-prep-plots)). Railroading is specifically "negat[ing] a player's choice in order to enforce a preconceived outcome". Consequences are its opposite ([Railroading Manifesto](https://thealexandrian.net/?p=36900)).
5. **There is now direct evidence on how to steer.** SENNA (IUI '26) tested AI-GM redirection strategies. Players rated **in-world consequences** best (mean appropriateness 2.19 on a −3 to +3 scale), then **NPC influence** (1.94) and **offering information** (1.67). **Hard denial** scored −2.03. Players unanimously preferred redirection strategies matched to the situation over the model's own unsupervised blend ([thesis PDF](https://projekter.aau.dk/projekter/files/784680954/Narrative_Adherence_in_LLM_driven_Games.pdf)).
6. **Façade solved "tangent, then return to the beat" in 2005, by hand.** It used beat goals with a *gist point*, global "mix-ins" for side topics, and "reestablish" lines ("So, I was going to say, about Italy…"). It also used tone-matching, so that tangents feel causally connected ([AIIDE 2005](https://cdn.aaai.org/AIIDE/2005/AIIDE05-016.pdf)). Versu's story manager steers by *tweaking character desires and spawning social situations*, not by puppeting ([Evans & Short 2014](https://www.cs.uky.edu/~sgware/reading/papers/evans2014versu.pdf)). Both patterns map well onto an LLM runtime.
7. **"Who speaks next" has good precedents.** Conversation-analysis turn-taking assigns the turn to the addressed person, which Versu calls the "selected speaker". SillyTavern's natural order goes by mentions, then talkativeness, then random. Concordia's `NextActing` asks a multiple-choice question, "Whose turn is next?" A hybrid of fixed rules plus a decision-model choice that includes **"nobody: it's the player's turn"** directly targets V1's runaway NPC-to-NPC chatter.
8. **Correction: GPT-6 Luna *does* have a decision mode.** It is not a `reasoning.mode`. It is exposed in two ways:
   - OpenAI's **Decisions API**: `POST https://api.openai.com/v1/decisions`, model `gpt-6-luna`, public beta since 2026-10-06 ([docs](https://developers.openai.com/api/docs/guides/decisions)).
   - **OpenRouter's same alpha endpoint**, under the separate slug **`openai/gpt-6-luna-decisions`**: $0.10/M input tokens, $0 output, 1.05M context, up to 200 questions per request ([model page](https://openrouter.ai/openai/gpt-6-luna-decisions)).
   The endpoint rejected `openai/gpt-6-luna` because that is the chat slug. I did not make a live call.
9. **The first QA runs show strong single-turn improvisation.** Examples include weaving a player-invented goblin acquaintance into Skrag's lines and correcting a player's invented backstory in character. The failures are at the joints:
   - rolling dice when nothing is at stake;
   - snapping an improvised action (a pickpocket) to the nearest authored check (Insight);
   - exit closings that contradict the reply before them;
   - an aftermath scene that ignores which exit was taken (Section 5).

---

## 1. Friends & Fables (fables.gg) and its AI GM "Franz"

### 1.1 What it is (verified)

- **Product.** Friends & Fables (F&F) is a "Generative Text RPG platform" with an AI Game Master named **Franz**. The homepage, help centre and patch notes all use that name ([fables.gg](https://fables.gg/), [help: What is F&F](https://help.fables.gg/articles/3518529-what-is-friends-and-fables)). It runs D&D-5e-like campaigns for up to 6 players, either solo or asynchronously, with TTS voices for Franz and the NPCs.
- **People.** It is built by **Side Quest Labs** (William Liu, David Melnychuk). In a 2024 PC Gamer interview they described Franz as "a system", with one part reasoning about whether something new has been introduced, built mostly on Llama models at the time ([PC Gamer via Yahoo, 2024-10-25](https://tech.yahoo.com/ai/articles/generative-ai-dividing-rpg-fans-013630531.html)) **[press]**.
- **Models today.** It uses a mixture of Gemini, Llama, GPT, Grok and in-house fine-tunes ([help: models](https://help.fables.gg/articles/5728392-what-models-do-you-use)). Users choose the *narration* model (for example "Fenix", GLM, Grok 4.5). Switching it "does not change things like combat mechanics or the research step" ([help: available models](https://help.fables.gg/articles/3993355-available-llm-models)).
- **Status in 2026.** The team built a successor, **Craft** (craftrpgs.com), now in open beta. In September 2026 they paused big F&F updates until 2027 ([26.05](https://fables.gg/patch-notes/patch-notes-26-05-new-bug-report-system-updates-timeline)).

### 1.2 Architecture timeline: what changed and why it matters for improvisation

All entries are **[primary]** patch notes or blog posts.

| When | Release | Relevant change |
|---|---|---|
| 2024-06 | [Prepare for Combat](https://fables.gg/patch-notes/prepare-for-combat), [Quest overhaul](https://fables.gg/patch-notes/quest-overhaul-combat-updates-bugfixes) | Combat starts when someone clicks "Roll for Initiative". "If you fail a skill check in a dangerous situation, Franz will initiate an encounter." Real *constraints* arrive (spell slots, equipped weapons). Quest objectives carry plans Franz writes for himself ("When the users are at this objective, Harold should appear…"). Future objectives are hidden. |
| 2024-10/11 | [Suggested actions](https://fables.gg/patch-notes/suggested-actions), [ACE-1](https://fables.gg/blog/introducing-ace-1-the-engine-powering-the-best-ai-ttrpg-experiences) | Suggested next moves for stuck players. "Agentic Campaign Engine": agents retrieve, decide, loop and act. Memories become "atomic units of knowledge". NPC relationship scores. "View Context" lets users see what Franz saw. |
| 2025-02 | [Narration 1.1](https://fables.gg/patch-notes/narration-module-upgrade-10-greater-11) | Livelier NPCs, NPC-to-NPC interplay, and reply length that adapts (shorter when an NPC expects an answer). |
| 2025-03 | [Narration 1.1.2: OOC mode](https://fables.gg/patch-notes/narration-112-ooc-mode) | Prefixing a message with "Franz" or "OOC:" routes it to a tool-using out-of-character mode (search memories, edit state, create items). If a tool doesn't exist, Franz says so "instead of pretending". |
| 2025-04 | [ACE-1.5](https://fables.gg/patch-notes/ace-15-bringing-pois-and-npcs-to-life-npc-conversations) | POI maps. **Conversation mode** keeps a conversation "isolated to NPCs that you are near". NPC context is weighted by distance and importance. New *mannerisms* and *aliases* fields. Per-character TTS voices. "90% of situations where Franz writes dialog for player characters should be eliminated." |
| 2025-06 | [Quests & One-Shots](https://fables.gg/patch-notes/a-new-creative-medium-friends-and-fables-quests-and-one) | Authored **steps** (GM instructions, location, scene setup) and **paths** (trigger, outcome, scene change). Authors "script must-hit beats" while "Franz can still fill in the gaps and improvise when players try to go off the rails." |
| 2025-07 | [Narration 1.1.4](https://fables.gg/patch-notes/narration-114-new-dice-roller-quest-tags) | **Adventure vs downtime** modes. Adventure mode "increases forward momentum" and adds "random tables for hooks". "Skill checks… should happen at more natural times." |
| 2025-08 | [Combat V4](https://fables.gg/patch-notes/combat-v4), [ACE 1.5.5](https://fables.gg/patch-notes/ace-155)/[1.5.6](https://fables.gg/patch-notes/ace-156) | Agentic combat: Franz gets tools for any roll and for encounter state, plus self-managed "encounter notes". A narration-model swap drew about 80% negative feedback on Discord and was partly rolled back ("not ready for prime time, at least not in full"). 1.5.6: the new model "did not like to give skill checks", so prompts encouraging them were reinstated. |
| 2025-08-28 | [Franz 2.0](https://fables.gg/patch-notes/franz-20-working-context-lore-improved-planning-and-more) | Research step. Editable **context blocks** with budgets and expiry. **Plot & Plan**. Scene context. Unified response modes. Franz's on-the-fly quest generation removed ("plot & plan are actually quite good for handling quests narratively"). |
| 2025-09/10 | [2.0.1](https://fables.gg/patch-notes/franz-201-better-ooc-correction-handling-lore-sync), [25.37](https://fables.gg/patch-notes/patch-notes-2537-premium-narration-franz-202), [25.38](https://fables.gg/patch-notes/patch-notes-2538-movementtravel-character-generation-tropes), [25.39](https://fables.gg/patch-notes/patch-notes-2540-plot-and-plan-changes), [25.41](https://fables.gg/patch-notes/patch-notes-2541-npc-memory-planning) | Better handling of corrections. Better "dialogue character matching" (attributing lines to the right NPC). Movement updates now follow Franz's *own* narration ("if an NPC said they would meet you at the shipyard, they'll actually show up"). A trope-reduction system ("wooden birds", "scent of ozone"). **Plan made ephemeral and post-message to feel "less railroady".** **Per-NPC memory** with a character-specific planning step. |
| 2025-12 | [25.50](https://fables.gg/patch-notes/patch-notes-2550-group-rolls-follows-in-app-notifications-qol) | Group rolls (Franz waits until all have rolled). Improved handling of failed rolls. |
| 2026-02 | [Dev Log 26.01](https://fables.gg/patch-notes/development-log-2601) | The core was built for older models that needed rigid structure. That rigidity "limits how well he can handle situations we didn't specifically design for", so they began a rewrite, which became Craft. |
| 2026-05 | [26.03](https://fables.gg/patch-notes/patch-notes-2603-craft-update) | Plot summary now updates every 3 turns. **Planning step toggled off** as it hurt performance. |

### 1.3 What happens on each turn

The sources are [How Franz works](https://fables.gg/blog/how-franz-works), [Context Management](https://help.fables.gg/articles/5272453-whats-the-maximum-context-size-how-do-i-manage-context), [What game state can ACE see/update](https://help.fables.gg/articles/4035786-what-game-state-can-ace-see-update) and [Working Context Blocks](https://help.fables.gg/articles/8560008-working-context-blocks).

1. **Research.** A fast, smaller model reads the player's message and searches lore (by folder, page title and heading), entity sheets and long-term memories (semantically). It writes the relevant bits into **context blocks**. Blocks have priorities and expiry and go idle when budgets are full. Players can edit them, and `@mentions` force an entity into context.
2. **Scene context.** Every request includes the "current scene": world basics, nearby locations, and what is at the current point of interest. "Characters that are closer to you are deemed more important" ([Current Scene](https://help.fables.gg/articles/1999565-current-scene)). The last 5 to 8 messages are included, plus the plot summary.
3. **Narration.** It is "medium size models which run extremely fast". The engine "usually sends out 10+ requests to various different models" per turn.
4. **Post-processing state updates.** Separate models decide the mechanical consequences of the exchange, such as moves, inventory and quest steps. A dedicated "special mode" kicks in when the system detects the player correcting Franz ([How to fix Franz](https://help.fables.gg/articles/1581604-how-to-fix-franz-and-get-your-campaign-back-on)).
5. **Situational tools.** Franz "only has access to certain tools in certain situations". For example, he "won't have the tool to accept a quest if there are no nearby NPCs with an available quest". *This is affordance gating: the world limits what the GM can do.*

### 1.4 How worlds, campaigns, quests, encounters and "scenes" are structured

- **World → Areas → Points of Interest (POIs) → entities.** POIs have maps where characters, monsters and items are placed. Franz can move people around as he narrates. F&F advises world builders to build "smaller scales but with more detail… Make each room a POI" ([ACE-1.5](https://fables.gg/patch-notes/ace-15-bringing-pois-and-npcs-to-life-npc-conversations)). Worlds exist so the conversation doesn't "loop or lose direction" ([Worlds](https://help.fables.gg/articles/5283283-worlds)).
- **Quests (June 2025 onward)** are F&F's closest analogue to our scenes. Each quest is a graph of:
  - **Steps:** GM instructions for how to run the step, a location, and scene setup. When the party arrives, the POI is set as authored.
  - **Paths:** a *trigger* (when the engine decides it is met, it takes that path), an *outcome*, and an optional scene change. The examples include player choice, success or failure of a skill check, traps or secret doors, and scripted NPC dialogue for "the perfect moment".
  Quests can be level-gated, chained, and planted on NPCs. **One-shots** are quests with fixed characters and a briefing ([Quests & One-Shots](https://fables.gg/patch-notes/a-new-creative-medium-friends-and-fables-quests-and-one)).
- **Encounters (combat).** Combat begins "once you roll initiative". F&F tells players to reach "a point in the story where an encounter makes sense narratively", for example an argument, a failed stealth check, or stumbling into a camp. The roll can also be triggered manually ([How to Start an Encounter](https://help.fables.gg/articles/9486000-how-to-start-an-encounter)). There are two combat styles: *narrative* combat, which uses the normal pipeline and may lose track of stats, and *turn-based* combat with battlemaps ([Narrative vs Turn Based](https://help.fables.gg/articles/0954370-narrative-vs-turn-based-combat)). You flee by telling Franz, who sets a DC for a Dexterity roll ([Flee](https://help.fables.gg/articles/0556260-flee-an-encounter)).

### 1.5 Voicing many NPCs

- **One narrator voices everyone.** Franz is the single narrator. Since 2.0.1/2.0.2, the dialogue tagging step matches each line to the right character, and the TTS switches to that NPC's voice ([ACE-1.5](https://fables.gg/patch-notes/ace-15-bringing-pois-and-npcs-to-life-npc-conversations), [25.37](https://fables.gg/patch-notes/patch-notes-2537-premium-narration-franz-202)).
- **Who is in the conversation.** In conversation mode only nearby NPCs take part. Character sheets add *mannerisms* ("Jim bites his nails when he's nervous") and *aliases*.
- **NPC memory (Oct 2025).** "Every memory gets tagged to the characters that should 'have that memory'." When you talk to an NPC, the system retrieves that character's 20 most recent memories and runs a **character-specific planning step** ([25.41](https://fables.gg/patch-notes/patch-notes-2541-npc-memory-planning)).
- **Proactive NPCs.** NPCs follow through on what they said they would do (the meet-you-at-the-shipyard example). They can also ask to join the party.

### 1.6 Dice, skill checks and combat

- **Who asks for rolls.** Franz decides when to ask for a check. The roll UI shows bonuses and rolls for you, with manual dice as an option ([Narration 1.1.4](https://fables.gg/patch-notes/narration-114-new-dice-roller-quest-tags), [Combat V4](https://fables.gg/patch-notes/combat-v4)).
- **Model behaviour around checks.** Two notable issues: a bug where the DC was "consistently set at 15" ([Memories V2](https://fables.gg/patch-notes/memories-v2)), and a narration model that "did not like to give skill checks" ([ACE 1.5.6](https://fables.gg/patch-notes/ace-156)). *When checks happen is a model behaviour that drifts with every model swap, so evaluate it.*
- **Group rolls.** Franz waits until all party rolls are made or dismissed ([25.50](https://fables.gg/patch-notes/patch-notes-2550-group-rolls-follows-in-app-notifications-qol)).
- **Combat V4.** It went from rigid code to an *agentic* GM with tools to roll, edit entities and add summons, plus "encounter notes" for durations and conditions. Hand-placed monsters are not rebalanced ([Combat V4](https://fables.gg/patch-notes/combat-v4)). Combat was rewritten five times, and the team cited it as a reason to start over ([Craft blog](https://www.craftrpgs.com/blog/craft-a-new-approach-to-ai-rpgs)).

### 1.7 State and memory

- **Long-term memories.** Created every 5 turns, tagged with POI and characters, and retrieved by the research step ([Memories](https://help.fables.gg/articles/2838157-memories)).
- **Plot.** A rolling summary of important recent events ([Plot and Plan](https://help.fables.gg/articles/4217496-plot-and-plan)).
- **Less is more.** F&F's stated philosophy is "the minimum amount of highly relevant and information dense context". Including all memories "does not lead to better results, and often worsens it".
- **The UI is the truth.** "Regardless of what Franz says out loud, the data you see in the UI is the truth" ([Troubleshooting Encounters](https://help.fables.gg/articles/2475873-troubleshooting-encounters)). Structured state is also what enforces constraints. Without it, "you can manipulate an LLM into bending the rules" ([F&F vs ChatGPT/AI Dungeon](https://fables.gg/blog/how-is-friends-and-fables-different-from-chatgpt-ai-dungeon-or-novelai)).

### 1.8 How F&F handles players going off-script, and what it learned

- **Authored beats plus improvised gaps.** Quests let authors fix must-hit beats and leave the rest to Franz.
- **Plans cause railroading.** The Franz 2.0 persistent plan was then made **ephemeral and post-message**, so "you should be able to steer things a bit more with the way you write your message… This will help Franz feel less railroady" ([25.39](https://fables.gg/patch-notes/patch-notes-2540-plot-and-plan-changes)). Within eight months the planning step was switched off entirely ([26.03](https://fables.gg/patch-notes/patch-notes-2603-craft-update)).
- **Momentum is a separate problem from freedom.** F&F admitted that "the narrative gameplay can be quite slow paced without much happening unless player initiated" ([Memories V2](https://fables.gg/patch-notes/memories-v2)). The fix was an **adventure mode** with "forward momentum" and **random hook tables**, kept separate from a calmer **downtime** mode ([1.1.4](https://fables.gg/patch-notes/narration-114-new-dice-roller-quest-tags)). *Responsiveness and proactivity are separate dials.*
- **Corrections are handled, but arguing is poison.** "Prolonged arguing with Franz will be counter productive as the entire chat history will be consumed by back and forth arguments." Also: "LLMs tend to repeat patterns. Franz sees his last few messages as examples" ([How to fix Franz](https://help.fables.gg/articles/1581604-how-to-fix-franz-and-get-your-campaign-back-on)).
- **Trope hygiene is a system, not a prompt line.** They added a "trope reduction system" that rewrites over-used phrases, then fixed it so it would not rewrite words already canonical in the world ([25.38](https://fables.gg/patch-notes/patch-notes-2538-movementtravel-character-generation-tropes), [25.41](https://fables.gg/patch-notes/patch-notes-2541-npc-memory-planning)).
- **Builders import tabletop craft themselves.** One public world's lore page of "Franz's role and core principles" tells Franz to present "situations, information, opportunities, risks, consequences". It says "failure should change the situation rather than simply end the adventure", and that when uncertain he should choose "the most interesting choice, the most believable consequence" ([Shattered Imperium lore](https://fables.gg/worlds/504edbfd-dd24-4e7a-a0c7-d651c186bc81/lore/01-franz-s-role-and-core-principles)) **[user]**.

### 1.9 What users praise and what they complain about

Reddit and the F&F Discord blocked automated access (Reddit returned an interstitial). F&F's Featurebase feedback posts are now private, so some quotes below come from search-engine snippets of those posts.

**Praise**
- **Coherence.** State tracking and memory tooling beat raw chatbots. "Characters maintain their identities across sessions more reliably than any other platform" ([Arcanum review](https://arcanumrpgs.com/blog/friends-and-fables-review/)) **[competitor]**.
- **Fair adjudication.** Franz "doesn't hand you a success because you phrased the request confidently" (same review) **[competitor]**.
- **Improvised content grounded in the world.** Franz invented a fitting NPC with backstory and stats, and "relied heavily on the worldbuilder's work for research" ([DreamGen review](https://dreamgen.com/blog/articles/friends-and-fables-review)) **[competitor]**.
- **Balancing several players.** It is "great at balancing narrative for multiple players" (DreamGen) and "balances the narrative between players well" ([DungeonsDeep](https://dungeonsdeep.ai/blog/friends-and-fables-review-2026)) **[competitor]**.
- **Overall.** "The best AI game mastered RPG game out there", from a 2024 forum post ([rpgsolo](https://www.rpgsolo.com/forum/Thread-Endless-Solo-RPGs-with-AI-DM-via-Friends-and-Fables-DnD-5e)) **[user]**.

**Complaints**
- **Railroading after Franz 2.0.** Franz "does not listen to player's instructions anymore and forces the player into what it has decided". He "loops messages until the player has done the very specific action franz has decided" (Featurebase post "[new franz is not an AI gamemaster anymore](https://friendsfables.featurebase.app/p/new-franz-is-not-an-ai-gamemaster-anymore)", now private; quoted from a search snippet) **[user]**. This lines up in time with the persistent plan described above.
- **Out-of-character handling.** Asked to redo a scene, Franz "responds by changing context blocks instead of redoing the scene" and is "EXTREMELY hard to get back on track" ("[Version 2.0 Franz Is Insufferable OOC](https://friendsfables.featurebase.app/p/version-20-franz-is-insufferable-ooc)", via search snippet) **[user]**.
- **Compounding errors.** "Each wrong turn becomes the context the next turn reasons from" (Arcanum) **[competitor]**. Memory drifts in long campaigns, especially on cheaper tiers (DreamGen, DungeonsDeep) **[competitor]**. From a 2024 forum post: "Franz is a little wonky at times and often has memory issues and gets cyclical in some of his thinking" **[user]**.
- **Repetitive tropes.** "Intricately carved wooden boxes" and NPCs named "Elara" ([PC Gamer via Yahoo](https://tech.yahoo.com/ai/articles/generative-ai-dividing-rpg-fans-013630531.html)) **[press]**.
- **Combat as the default.** Franz sometimes defaults "to combat when a social resolution would have been more interesting" (Arcanum) **[competitor]**.
- **Mechanics slips.** A d4 offered for a Perception check, and a creature treated as both dead and alive (DungeonsDeep) **[competitor]**.

### 1.10 Craft, the successor, and why it was built

- **What it is.** One **tool-using GM agent**. Its tools include `read`/`write`/`update` on project files, `askPlayerToRoll(reason, diceExpression, skillName, targetCharacter)`, `gmRollDice` for NPC rolls, `research` (a fast read-only helper that returns cited facts instead of whole files), an optional multiple-choice `askUserQuestion`, and a name generator ([Agent tools](https://www.craftrpgs.com/docs/agent-tools)).
- **Three kinds of GM instructions:** *Default* (always loaded), *Narratively Triggered* ("loaded when story conditions are met") and *Tool Triggered* ([Glossary](https://www.craftrpgs.com/docs/a-glossary-of-craft-terms)).
- **Context visibility.** Every file is Pinned (always loaded), Partial (title and description only) or Searchable ([Context Visibility](https://www.craftrpgs.com/docs/context-visibility), [Progressive Disclosure](https://www.craftrpgs.com/docs/progressive-disclosure)). This closely matches V1's progressive-disclosure success.
- **Craft's advice for GM instructions.** "Write conditionals, not absolutes". Fewer rules are followed more reliably. "Correct bad patterns early", because the model learns from its own recent output ([Writing GM Instructions](https://www.craftrpgs.com/docs/writing-gm-instructions)). Context rot is defined as working memory filling with "low-value information" ([Context Rot](https://www.craftrpgs.com/docs/context-rot)).
- **Game Starts.** Openings can be *scripted* (a list of narration or dialogue beats with expression cues) or *dynamic* (an instruction the GM improvises from). An "Opening Instruction File" is a one-time checklist the GM deletes afterwards. One suggested use is to "secretly pick a rumor, a clue, and a stranger… then weave all three into the opening scene" ([Game Starts](https://www.craftrpgs.com/docs/game-starts)).
- **Visual Novel Mode** splits each GM reply into narration and per-character dialogue chunks, each with an expression ([B0.11](https://www.craftrpgs.com/patch-notes/patch-notes-b0-11-visual-novel-mode-expressions)).
- **GPT-6 Luna** "is a core model and is now the default model for new games" (2026-09-24, [B0.048](https://www.craftrpgs.com/patch-notes/patch-notes-b0-048-space-bunny-alpha-gpt-6-luna-core)).

### 1.11 Takeaways from F&F and Craft for V2

1. Keep **authored structure at the edges** (steps/beats, paths/transitions, exits, state scripts) and let the GM improvise inside them. Do not keep a persistent "what happens next" plan.
2. **Gate the GM's affordances by the situation.** For example, no "accept quest" or "persuaded" exit unless the right NPC is present and the beat permits it. This is how the GM "knows what's possible", the gap V1's repair agent had.
3. **Responsiveness** (follow the player) and **proactivity** (inject hooks when nothing is happening) are separate controls. Tune both.
4. **Ground narration in structured state** and treat state as the truth. Separate out-of-character requests and corrections from the fiction.
5. **Re-evaluate rolling behaviour, voice attribution and tropes on every model change.** All three regressed at F&F during model swaps.

---

## 2. Tabletop GM craft for improvising within authored structure

### 2.1 Prepare situations, not plots, and know what counts as a railroad

- **Prep situations, not plots.** A plot is "the sequence of events in a story". A situation is "merely a set of circumstances", and what happens "will depend on the actions the PCs take". Plots are chains of failure points: what if they don't board the derelict, or fail the Perception roll? A situation needs almost the same prep but is robust ([Don't Prep Plots, 2009](https://thealexandrian.net/wordpress/4147/roleplaying-games/dont-prep-plots)). Alexander adds: "Your gaming session is not a story — it is a happening."
- **Play goal-oriented opponents.** Instead of contingency trees, ask "What is the bad guy trying to do?" Know each NPC's **toolkit** (people, equipment, locations, information) and what each tool is for. Players supply the "nails" (same article). *This is the right mental model for our cast cards: wants plus toolkit plus what each piece of key information is good for.*
- **Don't plan specific contingencies.** If–then trees are "plot-based prep juiced up on Choose Your Own Adventure steroids". Alexander observes that this is "the type of prep you would need to do if you were programming a computer game", but with a GM present, "You can just react." *An LLM GM is that live GM. Our scenes should carry situations and toolkits, not exhaustive transition trees.*
- **Railroading, precisely.** "Railroads happen when the GM negates a player's choice in order to enforce a preconceived outcome." Failing a roll, being told a pillow can't break an adamantine door, or a scheduled event happening are *not* railroads. "Railroading makes a choice meaningless. Consequences make a choice meaningful." ([Railroading Manifesto, 2015](https://thealexandrian.net/?p=36900)). *For evaluation: a redirect is acceptable if the player's choice still mattered.*

### 2.2 Make information robust so beats can land by any route

- **Three Clue Rule.** "For any conclusion you want the PCs to make, include at least three clues." Players will miss, ignore or misread clues, and each clue has several points of failure ([Three Clue Rule, 2008](https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule)). Its corollaries:
  - *Permissive clue-finding:* reward clever approaches you never prepared. Treat prepped clues as a "safety net", not a "straitjacket".
  - *Proactive clues* ("bash them on the head"): when players are stuck, make something happen. Someone dies, or "the next part of the bad guy's plan happens".
  - *Red herrings are overrated:* players invent their own.
  - *Revelation lists:* track which conclusions have their clues delivered.
- **Inverted rule and node design.** "If the PCs have access to ANY three clues, they will reach at least ONE conclusion." Scenes become **nodes**, each pointing to several others, and **funnels** converge free-form layers on a culminating node ([Inverting the Three Clue Rule](https://thealexandrian.net/wordpress/7985/roleplaying-games/node-based-scenario-design-part-3-inverting-the-three-clue-rule), [Alternative Node Design](https://thealexandrian.net/wordpress/8015/roleplaying-games/node-based-scenario-design-part-6-alternative-node-design)). *A scene can be a free-form layer funnelling to its exits.*
- **Secrets and clues untethered from location.** Write about ten one-sentence secrets and "keep these secrets and clues abstract from their place of discovery so that you can drop them into the game wherever it makes sense" ([Lazy GM Resource Document, CC-BY 4.0](https://slyflourish.com/lazy_gm_resource_document.html)). "When the characters explore somewhere, discover something, talk to someone… that's the time to drop them in". Revealing about half of them is fine ([Using the 8 steps at the table](https://slyflourish.com/using_the_8_steps_at_the_table.html)).
- **Prep as ingredients.** "You're setting up little dishes of pre-cooked food so you can improvise the meal at the table" (same article). Potential scenes are optional: "be ready to throw our potential scenes away when the game goes in a different direction" (Lazy GM).

### 2.3 Openings, bangs, agendas and dramatic questions

- **Strong start.** "Setting the stage for the session determines a great deal about how the rest of the game will go." Also: "When in doubt, start with a fight." A strong start "kicks your game off in the middle of the action" ([Lazy GM](https://slyflourish.com/lazy_gm_resource_document.html)).
- **The scene agenda and the bang.** Open a scene by quickly establishing who, what, where and when, then apply an impetus. Know the scene's **agenda** ("Why are we here?"). The **bang** "is the thing which forces the PCs to make one or more meaningful choices… the explosive force which launches the scene". Shorter set-up and more interesting choices make a better bang ([Art of Pacing pt 2](https://thealexandrian.net/wordpress/31520/roleplaying-games/the-art-of-pacing-part-2-scene-framing)).
- **Purpose plus what's about to happen.** Fate: when starting a scene, establish "What's the purpose of the scene?" and "What interesting thing is just about to happen?" A specific purpose tells you when the scene is over ([Fate SRD: Defining Scenes](https://fate-srd.com/fate-core/defining-scenes)).
- **Dramatic question.** "Every encounter begins by posing a dramatic question and it ends when the players have an answer to that question." It is the heroes' current objective rephrased as a yes-or-no question ([Angry GM: Four Things](https://theangrygm.com/four-things-youve-never-heard-of-that-make-encounters-not-suck/)). Do not phrase the question in a way that assumes *how* the players will resolve it ("can the PCs continue their journey?" rather than "can the PCs kill the spiders?") ([Angry GM: Awesome Encounters](https://theangrygm.com/how-to-build-awesome-encounters/)). *Our scenes already have a `premise` phrased as a question, which is good. The exit judge should ask whether it has been answered.*

### 2.4 How to adjudicate: say yes, roll, or "yes, but"

- **Say yes or roll the dice.** From *Dogs in the Vineyard* (2004): the GM either goes along with the player or lets it happen through a die roll ([Wikipedia](https://en.wikipedia.org/wiki/Dogs_in_the_Vineyard)). *Blades in the Dark* says the same: "If there's no danger or trouble at hand, you don't make an action roll… the GM will simply say yes" ([BitD SRD](https://raw.githubusercontent.com/amazingrando/blades-in-the-dark-srd-content/master/Blades-in-the-Dark-SRD.md)).
- **"Yes, but."** Pathfinder 2e's GM Core: "It's usually better to say 'yes' than 'no,' within reason". "Yes, but" lets "the player's creative idea" work while tying it to the rules through consequences or an extra roll ([GM Core p.15, AoN](https://2e.aonprd.com/Rules.aspx?ID=884)). Improv theatre's "yes, and" is the generative version. *Improv for Gamers* (Evil Hat) adapts those exercises for tables.
- **Fail forward / "no whiffing."** 13th Age (p.42) recommends redefining failure as "things go wrong" rather than "the PC isn't good enough". It credits Ron Edwards and Luke Crane ([EN World discussion](https://www.enworld.org/goto/post?id=6782135)). Burning Wheel resolves a failed test with a GM-introduced complication.
- **Position, effect, consequence.**
  - BitD sets a **position** (controlled, risky or desperate) and an **effect level** before the roll. A 4/5 is success with a cost.
  - "**Don't inflict a complication that negates a successful roll**" (BitD SRD).
  - **Devil's bargains:** a bonus die in exchange for a complication the player chooses to accept.
  - **Progress clocks:** danger clocks, *racing* clocks, and *tug-of-war* clocks that fill and empty. These let a situation turn over several actions instead of being settled by one roll.

### 2.5 Powered-by-the-Apocalypse GM agenda, principles and moves

- **Agenda.** Dungeon World: "Portray a fantastic world", "Fill the characters' lives with adventure", "Play to find out what happens".
- **Principles.** Draw maps, leave blanks. Address the characters, not the players. **Make a move that follows.** Never speak the name of your move. Give every monster life. Name every person. **Ask questions and use the answers.** **Be a fan of the characters.** Think dangerous. Begin and end with the fiction. **Think offscreen, too** ([Dungeon World: The GM](https://roll20.net/compendium/dw/Rules:The%20GM)).
- **Moves.** Reveal an unwelcome truth. Show signs of an approaching threat. Use up their resources. Turn their move back on them. Separate them. Offer an opportunity, with or without cost. Put someone in a spot. **Tell them the requirements or consequences and ask.**
- **Soft and hard moves.** A soft move shows a threat with room to react. If the players ignore it, that is a **golden opportunity** for a hard move. Make a move "when everyone looks to you to find out what happens".
- **Fronts.** Dangers have *impulses* and *grim portents*. "When you're not sure what to do next, push your danger towards resolving a grim portent." Stakes questions are things you genuinely want to discover, so "you have to play to find out" ([DW Fronts](https://roll20.net/compendium/dw/Fronts)).
- **Honesty.** Apocalypse World 2e: always say "what the principles demand… what the rules demand… what your prep demands… what honesty demands". Be "scrupulous, even generous, with the truth" ([Daily Apocalypse](https://daily-apocalypse.com/daily-apocalypse/36-always-say)). *Be honest about what characters can perceive. Secrets still have to be earned.*

### 2.6 Running NPCs, including several in one scene

- **NPC briefing template.** Appearance in one or two sentences, an optional one-line quote, two or three roleplaying bullets, background, and **Key Info** (what the PCs are supposed to be able to get). Always include "at least one simple, physical action" as a mannerism. It is the hook back into the character and "can even make playing scenes with multiple NPCs easier to run" ([Universal NPC Roleplaying Template](https://thealexandrian.net/wordpress/37916/roleplaying-games/universal-npc-roleplaying-template)).
- **Quick NPCs.** Three one-line bullets: appearance, roleplaying (a mannerism) and background ([Quick NPC Template, 2024](https://thealexandrian.net/wordpress/50635/roleplaying-games/quick-npc-template)).
- **NPC-to-NPC talk.** "Have a point, keep it short". Avoid realistic but tedious chit-chat. Mark each speaker clearly ([Roleplaying Tips #78](https://www.roleplayingtips.com/rptn/gm-schizophrenia-tips-for-holding-conversations-between-multiple-npcs/)). Common table advice: NPCs address the PCs rather than each other, each NPC shows **one visible want** per scene, and NPC exchanges end in a decision for the players.
- **A living world.** "Let the world and the NPCs react to the characters' actions" and "Ask what the villains and NPCs are doing right now" ([Lazy GM](https://slyflourish.com/lazy_gm_resource_document.html)).

### 2.7 Sharing the spotlight

- **Track it and pass it on.** Spotlighting means sharing screen time. Keep a tick list of who has had a turn ([Burn After Running](https://burnafterrunningrpg.com/2023/03/)). There is a difference between *sharing* and *shining* the spotlight: hand scenes to others and trust them to reciprocate ([Gnome Stew, 2019](https://gnomestew.com/sharing-and-shining-the-spotlight/)).
- **For an AI GM this means three things:**
  - track whose turn it should be;
  - always leave the player a gap to act;
  - when several players are present, aim scene pressure at the one who has been quiet. Enemies are a classic way to point focus at a character.

### 2.8 Pacing and ending scenes

- **The core loop.** Play is a "conversation of meaningful choices": "GM: What do you want to do? Player: I want to do X. GM: When you try to do that, this happens." Pacing means removing **empty time** between meaningful choices ([Art of Pacing pt 1](https://thealexandrian.net/wordpress/31509/roleplaying-games/the-art-of-pacing)).
- **Kinds of time.** Abstract time ("several days pass"), now time, slow time, and the **sharp cut** (pt 2).
- **When to cut** ([Art of Pacing pt 4](https://thealexandrian.net/wordpress/31533/roleplaying-games/the-art-of-pacing-part-4-closing-the-frame)):
  - **Finishing the agenda:** the scene's question is answered.
  - **The second lull:** "One pivot makes for a good scene; two pivots makes for a muddy mess" (quoting Smallville).
  - **On the exit:** when one or two leads leave.
  - **Flee:** a lead runs, leaving the agenda unresolved.
  - **A new bang:** "the doors of the inn burst open…"
- **Fate.** "As soon as the momentum starts to flag, move on". End scenes "immediately after the interesting action concludes" ([Fate SRD](https://fate-srd.com/fate-core/defining-scenes)).
- **Blades.** "Cut to the action", meaning the first serious obstacle, not the approach (BitD SRD).

### 2.9 Distilled GM headspace: principles phrased as outcomes

These are written as outcomes the GM aims for, not do/don't rules, in line with the PoC's prompting guidance.

1. **Every contribution lands.** Whatever the player tries gets a specific reaction from the world or a person and leaves a mark ("yes, and"; *ask questions and use the answers*; *be a fan*).
2. **The scene's question gets answered by whatever route the player found.** Prep says what is true and who wants what. It doesn't say what happens (*situations not plots*; the dramatic question).
3. **The world pushes back the way that world would.** Consequences follow from the fiction, and people act on their wants on and off screen (*make a move that follows*; *goal-oriented opponents*; *think offscreen*; fronts).
4. **No one hits a wall; they hit a complication, a cost or a better question** (*fail forward*; *yes, but*; *don't negate a success*).
5. **Dice appear only when the outcome is uncertain and failure would change things, and the result becomes the story** (*say yes or roll*; failure is content).
6. **What the story needs reaches the players more than one way.** If one route closes, another opens naturally (*Three Clue Rule*; untethered secrets; proactive clues).
7. **Steering feels like story, not a GM's hand.** Threads return through consequences, people's needs and new information, never through refusal (SENNA's results; *never speak the name of your move*).
8. **The player always has something interesting to respond to next.** When energy dips, something happens (bangs; the second lull; fronts).
9. **What has been established stays true.** New details fill blanks, characters know only what they could know, and secrets are earned (*draw maps, leave blanks*; AW honesty; Key Info).
10. **Every other character sounds like themselves and talks to the party, not past it.** The spotlight keeps coming back to the player (mannerism hooks; NPC lines end on a choice for the player).
11. **Scenes end when their question is answered or their energy is spent**, on a note that makes the next scene matter (closing the frame; Fate).

**Prompt-ready paragraph.** Adapt freely; it deliberately contains no implementation details.

> You're running this scene so that, by the end, the player feels the story bent around what they did. Whatever they try should visibly land: someone reacts to it specifically, and it leaves a mark. Your notes tell you what's true here and what each person wants; they don't tell you what happens. When the player wanders, the world keeps living: people pursue what they want, time passes, pressure builds, and threads find their way back through those people and consequences rather than through you saying no. Nobody hits a wall; they hit a cost, a complication or a better question. Dice belong to moments where the outcome is genuinely uncertain and failure would change things, and whatever they show becomes part of the story. What's been established stays true; new details fill gaps rather than overwrite them, characters only know what they could know, and secrets are earned. Everyone else in the scene sounds like themselves and talks to the party, not past it, and every reply leaves the player something interesting to do next.

---

## 3. Precedents from interactive drama and dialogue systems

### 3.1 Façade (Mateas & Stern): beats, mix-ins and returning to the beat after a tangent

Source: [Structuring Content in the Façade Interactive Drama Architecture, AIIDE 2005](https://cdn.aaai.org/AIIDE/2005/AIIDE05-016.pdf) **[primary]**.

- **Units.** Façade has about 2,500 *joint dialog behaviours*, each a coordinated exchange of 1 to 5 lines between Grace and Trip. They are grouped into **27 beats**, and a typical playthrough sees about 15.
- **Inside a beat.** A beat is a canonical sequence of *beat goals*: transition-in, body goals, a **wait goal** in which the characters wait for the player to respond, and a **default transition-out** for when the player doesn't engage. Handler behaviours watch for interpreted player *discourse acts* (about 30 types, such as praise, topic references or provocation) and modify the sequence with **beat mix-ins**, which are beat-specific reactions.
- **Global mix-ins for tangents.** Satellite topics (sex, divorce, the wedding photo, the brass bull, drinks) have three-tier progressions that can interrupt any beat. There are also generic **deflection and recovery** mix-ins for confusing or inappropriate input.
- **Returning after an interruption.** If a mix-in interrupts a beat goal *before its gist point*, the goal is repeated afterwards. Every beat goal has a **reestablish** line for resuming ("So, I was going to say, about Italy…"). Tone is matched across mix-ins and beats, so players "often perceive them as causally related, even though they are not".
- **Drama manager.** The sequencer picks the unused beat whose preconditions hold and whose tension effects best match an authored **Aristotelian tension arc**. It prefers beats related to topics the player raised.
- **Results.** Natural-language understanding failed about 30% of the time. Ideal local agency was reached about 25% of the time and partial agency about 40%. The characters are deliberately **self-absorbed**, "allowing them to occasionally believably ignore unrecognized or unhandleable player actions". The large domain (a failing marriage) "overly raised players' expectations".
- **For V2.** Every authored beat should have a *gist* (the must-land content) and a *re-entry line*. Tangents should be answered in character, in the scene's tone, then lead back to the beat. NPCs with strong agendas can deflect gracefully in character.

### 3.2 Versu (Evans & Short): social practices and a story manager that doesn't micromanage

Sources: [Versu — A Simulationist Storytelling System, IEEE TCIAIG 2014](https://www.cs.uky.edu/~sgware/reading/papers/evans2014versu.pdf) and [Emily Short: Versu conversation implementation](https://emshort.blog/2013/02/26/versu/) **[primary]**.

- **Social practices.** Recurring social situations (a meal, a conversation, a game of whist) are *reactive joint plans* that **offer affordances** to the characters taking part. "The practices never control the agents directly; they merely provide suggestions." Each agent picks its action by *utility* over its own desires, and the world state is a database of logical sentences.
- **Story manager.** It is itself a social practice. It "does not like to micromanage" and its job is to "initiate practices, watch their progress, and insert occasional changes". It ensures a story's "key recognizable moments" happen "at the right moment", mainly by "creating new social practices, or tweaking the desires of the participants".
- **Conversation turns.** The conversation practice tracks whose turn it is and which topics are salient. When someone is addressed directly, they become the **selected speaker**. Interrupting is a norm violation that affects how others regard the interrupter. A long pause clears the conversational state.
- **For V2.** The background repair agent should behave like Versu's story manager. It should adjust NPC desires and pressures and add situations, not write the next lines. This directly answers V1's failure where NPCs got stuck on an impossible "find another route for the cart" goal: let the story manager *change the want*.

### 3.3 Ink and Yarn Spinner: weaves, gathers, fallbacks, tunnels and salience

- **Ink (inkle)** ([Writing with ink](https://raw.githubusercontent.com/inkle/ink/master/Documentation/WritingWithInk.md)):
  - *Weaves*: options with **gather points** that "gather the flow back together" after a choice, so branches reconverge by design.
  - *Fallback choices*: invisible options taken when nothing else applies.
  - *Sticky versus once-only* choices.
  - **Tunnels**: side-stories that run and then return to wherever they were called from.
  - *For V2:* a tangent is a tunnel and a beat is a gather point.
- **Yarn Spinner 3** ([Saliency](https://docs.yarnspinner.dev/write-yarn-scripts/advanced-scripting/saliency)):
  - *node groups* and *line groups* with `when:` conditions are its storylets;
  - a *saliency strategy* picks among the candidates that pass. The built-in strategies are First, Best (most complex passing condition), Best Least Recently Viewed, and **Random Best Least Recently Viewed** (the default);
  - `when: always` serves as fallback content.
- **Salience in shipped games.** Valve's dynamic dialogue in *Left 4 Dead* fuzzy-matches world facts against thousands of rule-tagged lines. The most specific rule wins, with general fallbacks ([GDC 2012, Ruskin](https://www.gdcvault.com/play/1015528/AI-driven-Dynamic-Dialog-through)).
- **Emily Short's taxonomy** ([Beyond Branching](https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/)):
  - quality-based narrative (storylets gated on stats);
  - salience-based narrative;
  - **waypoint narrative**, where NPCs move through a network of topics towards narrative goals and the player can redirect them. In her game *Glass*, more content meant "the more efficient and responsive the story-healing could be".
  - *For V2:* "story-healing" is exactly what the repair agent should do.

### 3.4 Baldur's Gate 3 and Disco Elysium: dice on dialogue

- **BG3.** Some dialogue responses require an ability check against a DC. Before rolling you can add Guidance or Bardic Inspiration. Passive Perception fires automatically around traps and hidden things ([bg3.wiki](https://bg3.wiki/wiki/Ability_check)). A failed roll usually leads to another branch rather than a dead end: "Failure is content, not punishment" ([CGMagazine](https://www.cgmagonline.com/articles/baldurs-gate-3-redefined-crpg-dialogue/)) **[press]**. "Karmic Dice" prevents streaks of failure ([Prima](https://primagames.com/tips/baldurs-gate-3-karmic-dice-explained)) **[press]**.
- **Disco Elysium.**
  - *Passive checks* happen automatically. Skills interject as inner voices, which is effectively a "who speaks next" decided by skill level.
  - *White checks* can be retried after you raise the skill or change the circumstances.
  - *Red checks* are one-shot and affect the story ([gfinity](https://gfinity.net/disco-elysium/can-you-fail/)) **[press]**.
  - The lead writer wanted dialogue "as addictive and as snappy as Twitter". Failures are often the funniest outcomes ([Kotaku, 2020](https://kotaku.com/disco-elysiums-dialogue-system-is-as-addictive-as-any-s-1841046831)) **[press]**.
- **For V2.** Checks on conversation edges are the right default, and V1's notes say the same. Add three things:
  1. a *no-roll* path when nothing is at stake;
  2. a *white/red* distinction: can the player retry with new leverage, or is it once only?
  3. passive checks that let the GM surface information without a visible roll.

### 3.5 Hidden Door

- **Design.** Hidden Door decomposes storytelling into many specialised tasks: "turning generation problems into ranking problems… generation offline… ranking in real time". It uses a **trope** database with metadata, world rules written in Python, and Postgres state. Scenes are structured, about 5 to 8 minutes, with set beginnings and endings. Actions are validated against world physics, and human editors review content ([AI Game Changers interview, 2025-10](https://aigamechangers.substack.com/p/the-machine-is-not-itself-creative)) **[press]**.
- **Critique.** "Cards seem to be the core state of the game." Typing an action "doesn't directly do the action, but instead regenerates the choices". "An objective appears but without my intervention it is also immediately completed." "Without individual perspectives the characters will seem unalive, each just a plot device" ([Ian Bicking design review, 2025-08](https://ianbicking.org/blog/2025/08/hidden-door-design-review-llm-driven-game)).
- **For V2.** These are anti-patterns to test for: the GM resolving things for the player, setting up obstacles and solutions in the same breath, and NPCs who are mere plot devices.

### 3.6 AI Dungeon: how context is assembled

Source: [What goes into the Context](https://help.aidungeon.com/faq/what-goes-into-the-context-sent-to-the-ai) **[primary]**.

- **Required elements.** Instructions, Plot Essentials, Story Summary, Author's Note, Front Memory and the last action, capped at 70% of context.
- **Dynamic elements.** About 25% for **Story Cards**, which are included when their keyword *triggers* appear in recent actions, ranked by how recently and frequently they were triggered. About 50% for history and about 25% for the **Memory Bank**, which is retrieved by relevance to the most recent action.
- **Assembly order.** Instructions, Plot Essentials, Story Cards, Story Summary, Memory Bank, History, **Author's Note**, Last Action, Front Memory. The Author's Note sits next to the end, which is why it is the strongest steering lever ([Story Cards](https://help.aidungeon.com/faq/story-cards), [Memory System](https://help.aidungeon.com/faq/the-memory-system)).
- **For V2.** Put the current beat's steering near the end of the prompt and keep it short.

### 3.7 Academic work on LLM DMs: CALYPSO, the D&D dialogue challenge, FIREBALL

- **D&D as a Dialog Challenge** (EMNLP 2022). About 900 play-by-post games and 800k turns. Tasks are game-state tracking and next-turn generation, and tracking state improves generation ([arXiv 2210.07109](https://arxiv.org/abs/2210.07109)).
- **FIREBALL** (ACL 2023). About 25,000 Discord sessions with true game state from the Avrae bot. Narration improves when grounded in state, and models can generate game commands ([arXiv 2305.01528](https://arxiv.org/abs/2305.01528)).
- **CALYPSO** (AIIDE 2023). A DM assistant studied with 71 players. It offered three interfaces: encounter understanding, focused brainstorming, and open chat. The DM keeps final say. Outputs were either "high-fidelity text suitable for direct presentation to players" or "low-fidelity ideas that the DM could develop further" ([arXiv 2308.07540](https://arxiv.org/abs/2308.07540)).
- **For V2.** This is an analogue for a director that offers the narrator low-fidelity options rather than finished text.

### 3.8 Recent drama-manager and AI-GM research

All entries are **[primary]** unless marked.

| Work | Mechanism | Finding relevant to tangents |
|---|---|---|
| **SENNA / ChatRPG v3** (Jørgensen & Tharmabalan, IUI '26; [DOI](https://doi.org/10.1145/3742413.3789218), [thesis](https://projekter.aau.dk/projekter/files/784680954/Narrative_Adherence_in_LLM_driven_Games.pdf)) | Five ReAct agents. **Scribe** turns an adventure module into a *narrative graph* with conditions. **Examiner** rules each action Allowed, Conditionally Allowed or Disallowed. **Navigator** advances graph nodes. **Narrator** writes prose aware of the verdict. **Archivist** tracks state. | Six redirection strategies were tested: hard denial, more information, illusion of choice (the "quantum ogre"), NPC influence, humour, and in-world consequences. Expert GMs ranked *More Information* first. Twelve players rated **Consequences** best (2.19), NPC Influence 1.94, More Info 1.67 and Hard Deny −2.03. Required beats were almost always satisfied, while optional content was hit or miss. Failure modes included repeating itself when the player wouldn't comply, giving away answers, and "helicopter-parent hand-holding". Scenario-matched strategies felt more natural than the model's ad-hoc blend. |
| **ChatRPG static vs agentic GM** (CUI 2025; [arXiv 2502.19519](https://arxiv.org/abs/2502.19519)) | A single prompt versus a Narrator plus Archivist with tools. | The agentic version was better on 9 constructs, including immersion and coherence. The static version was over-compliant. |
| **IBSEN** (ACL 2024; [ACL](https://aclanthology.org/2024.acl-long.88)) | A **director** agent writes plot objectives, instructs **actor** agents, and "reschedules the plot when human players participate". | Generates complete, diverse scripts from rough objectives. This is the director/actor split that the PoC's `actors` approach mirrors. |
| **Drama Llama** (2025; [arXiv 2501.09099](https://arxiv.org/abs/2501.09099)) | Storylets with **natural-language triggers** (condition, stage directions, basic or ending). A minimal LLM drama manager checks triggers after each message and fires at most one. | Trigger detection was unreliable for authors, characters were "overly forced" to their traits, and output was clichéd. Quality depended heavily on what authors wrote. |
| **Dramamancer** (2026; [arXiv 2601.18785](https://arxiv.org/abs/2601.18785)) | An *interpretation* module runs after every player input to check storylet conditions. An *instantiation* module writes one line at a time; "the LLM implicitly decides which character is contributing that line", and also decides whether to **pause for player input** once there has been "meaningful progression" since the player last spoke. | The line "should be highly responsive to the most recent input from the player character, regardless of whether the player's input causes any event conditions to be satisfied". Evaluation dimensions: event-detection accuracy, timing, responsiveness and character distinctiveness. |
| **Drama Interaction** (Wu et al. 2024; [arXiv 2405.14231](https://arxiv.org/abs/2405.14231)) and **Immersion & Agency** (ACL 2025; [ACL](https://aclanthology.org/2025.acl-long.546)) | *Narrative chains* of scenes, with *triggers* for scene changes, clues and relationships. *Plot-based reflection* lets agents adjust their reactions to the player's intent. | Shows that reflecting on the plot plus the player's intent improves agency without losing structure. |
| **StoryVerse** (FDG 2024; [arXiv 2405.13042](https://arxiv.org/abs/2405.13042)) | Authors write *abstract acts*. An LLM narrative planner turns them into character action sequences that fit the current world state. | "Abstract acts" are waypoints, not scripts. |
| **Player-Driven Emergence** (Microsoft, CoG 2024; [arXiv 2404.17027](https://arxiv.org/abs/2404.17027)) | 28 players, GPT-4 NPCs, a fixed mystery premise. Play logs were converted to node graphs. | Players discovered *emergent nodes* that were not authored. Explorer-type players produced the most. Tangents are design signal, so mine QA logs for them. |
| **CoC-Seduce** (2026; [arXiv 2607.02802](https://arxiv.org/abs/2607.02802)) | 5,376 adversarial persuasion attempts against 22 models acting as rules referees. | "Rhetorical injection" breaks rule adherence. Newer models and reasoning chains don't reliably help, and "Pseudo-Logic framing is the most effective". *Don't let the narrator alone judge persuasion exits.* |
| **Sakellaridis thesis** (Utrecht 2024; [thesis PDF](https://studenttheses.uu.nl/bitstream/handle/20.500.12932/47209/Thesis_Final.pdf?sequence=1&isAllowed=y), [Wargamer summary](https://www.wargamer.com/dnd/ai-railroads-players) **[press]**) | A ChatGPT DM against a human DM running *Sunless Citadel*. | The AI "struggled to accommodate the diverse and unpredictable choices", offered too little threat, and delivered information unclearly. It was rated better at immersive description. |
| **Concordia** (DeepMind 2023; [arXiv 2312.03664](https://arxiv.org/abs/2312.03664)) | The GM translates natural-language actions into grounded outcomes. Scenes are specified by participants, premise, a GM and a round budget ([source](https://github.com/google-deepmind/concordia/blob/main/concordia/typing/scene.py)). | `NextActing` asks the model a multiple-choice question, "Whose turn is next?", over the players. There are also fixed-order, random and scene-participant variants ([source](https://github.com/google-deepmind/concordia/blob/main/concordia/components/game_master/next_acting.py)). |

Practitioner consensus is similar ([HN thread](https://news.ycombinator.com/item?id=42698610)) **[user]**. LLM DMs are "too pliable" ("I kept getting my way"). Facts belong in storage, not in the model's memory, and dice belong in code.

### 3.9 Who speaks next: approaches compared

| System | Rule |
|---|---|
| Conversation analysis, via Versu | The addressed person is the *selected speaker*. Otherwise someone self-selects, and interrupting is a social cost ([Emily Short](https://emshort.blog/2013/02/26/versu/)). |
| Façade | Two NPCs are coordinated by joint behaviours. A **wait goal** hands the floor to the player, with a default transition-out if they don't take it. |
| SillyTavern "Natural order" | Names mentioned in the last message speak first. Otherwise each character rolls against a *talkativeness* value (default 50%). Otherwise someone random speaks. Self-responses are off by default. Alternatives: list order, pooled order (anyone who hasn't spoken since the user's last message) and manual ([docs](https://docs.sillytavern.app/usage/core-concepts/groupchats/)). |
| AutoGen SelectorGroupChat | An LLM picks the next speaker from the context and participant descriptions. It can disallow the same speaker twice in a row, filter candidates first, or use a custom selector function ([docs](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/selector-group-chat.html)). |
| Concordia `NextActing` | A multiple-choice question over players, conditioned on chosen components. There are also fixed-order, random and per-scene round-robin variants. |
| IBSEN / Dramamancer | The director chooses which actor speaks (IBSEN). Or the generator implicitly chooses per line, with a separate interpreter for events and an explicit "pause for the player" decision after meaningful progress (Dramamancer). |
| F&F | Only nearby NPCs take part in a conversation. Separate dialogue tagging attributes each line to the right NPC. |
| Disco Elysium | Passive skill checks decide which inner voices interject. |

*Synthesis.* Use rules for the obvious cases: the addressed person speaks, a named person speaks, and an actor mid-exchange continues. Use a calibrated decision for the rest. Always include **"no one: hand the floor to the player"** and **"the world/narrator"** as options. Penalise NPC-only chains (SillyTavern turns self-responses off; Façade has its wait goal).

### 3.10 How each system keeps beats on track while allowing freedom

| System | Keeps the story on its beats by… | Allows freedom by… |
|---|---|---|
| Façade | Beat sequencing towards a tension arc; gist points; default transitions | Mix-ins for any topic; reestablish lines; self-absorbed NPCs |
| Versu | A story manager that ensures key moments by spawning situations and tweaking desires | Agents choosing autonomously from practice affordances |
| Ink | Gathers that reconverge weaves; knot structure | Choices; tunnels for side trips; fallbacks |
| Yarn 3 / L4D | Authored conditions per storylet or line | Salience picks the most specific valid content; fallbacks |
| BG3 / Disco | Checks placed on authored edges; red checks for plot | Failure branches; white-check retries; passive interjections |
| F&F quests | Steps with GM instructions; paths with triggers | The GM improvises the gaps; ephemeral plans |
| SENNA | A narrative graph with an Examiner verdict | Redirecting through consequences, NPCs and information instead of denial |
| Hidden Door | Short framed scenes; tropes; validation against world rules | Remixing tropes; ranked options |

---

## 4. OpenRouter Decisions API and GPT-6 Luna's "decision mode"

### 4.1 OpenRouter Decisions API (verified from docs and public endpoints)

- **Endpoint.** `POST https://openrouter.ai/api/alpha/decisions` ([API reference](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request), [Jev hub](https://openrouter.ai/docs/guides/community/jev)). The path is `/api/alpha/decisions`, **not** `/api/v1/alpha/decisions`, which returns 404 ([openrouter-examples #83](https://github.com/OpenRouterTeam/openrouter-examples/issues/83)). TypeSafe-SDK users can instead point at `POST https://openrouter.ai/api/v1/systemone`.
- **Request.** `{ model, state, questions, session_id?, user?, provider?, trace? }`.
  - `state` is a string, object or array.
  - `questions` is a **named object**. Each entry has `{ type: "noul"|"choice"|"score", instructions, criteria }`.
  - For `choice`, `criteria` is a **record** of `label → guidance`. The guidance can be a string, object or array. Wrapping options in `{choices:[…]}` returns a garbage answer (#83).
  - For `noul`, `criteria` is `{true, false}`. For `score`, it is an **ordered array**.
- **Response.**
  - `answers[key]` gives `{type, choice, confidence, probabilities}` for choice; `{noul}` (the probability of yes) for noul; and `{score, confidence, probabilities, legend}` for score.
  - It also returns `usage.cost` and the dated snapshot that served the request.
  - Questions are "answered in parallel and cannot see each other's answers", so dependent decisions need sequential calls ([Jev tutorial](https://openrouter.ai/docs/guides/community/jev-tutorial)).
  - Confidence for a choice is `(p_max − 1/n)/(1 − 1/n)`. Thresholds should scale with the cost of a mistake ([TypeSafe: Confidence](https://docs.typesafe.ai/confidence)).
- **Jev 1.13.** `typesafe/jev-1.13` (alias `~typesafe/jev-latest`) costs $0.042 per million input tokens, with output free. It accepts text only. The public endpoint metadata lists a 64k context with `max_prompt_tokens` of 32,000; the docs say 32k ([model page](https://openrouter.ai/typesafe/jev-1.13), [endpoints JSON](https://openrouter.ai/api/v1/models/typesafe/jev-1.13/endpoints)).
- **Writing criteria.** TypeSafe advises decomposing broad questions into atomic ones and including only relevant state. Criteria can be structured objects with `what`, `not_for` and `examples` fields to separate guidance that would otherwise blur ([How to build with System One](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)). *This directly addresses the lab notebook's finding that Jev "reads loosely-worded criteria liberally".*

### 4.2 Does GPT-6 Luna have a decision mode? Yes, as a separate endpoint and slug, not a parameter

- **OpenAI direct.** The **Decisions API** is `POST https://api.openai.com/v1/decisions`, with `model: "gpt-6-luna"` as the only supported model. It has been in public beta since **2026-10-06** ([OpenAI docs](https://developers.openai.com/api/docs/guides/decisions); [AI Weekly](https://aiweekly.co/alerts/openai-launches-decisions-api-public-beta-on-gpt-6-luna), which cites the [forum announcement](https://community.openai.com/t/decisions-api-is-now-available-in-public-beta/1403877)).
  - Request: `{ model, input, questions: [ … ] }`. Each question is `{type: "predicate"|"choice"|"score", name, instructions}` plus `choices: [{value, description}]` or `levels: [{label, description}]`.
  - Response: an `answers` array with `probabilities` and `confidence`.
  - Pricing: $0.10 per million input tokens, with no output or cache charges.
  - Speed: "10x faster than the Responses API" (a vendor claim with no benchmark published).
  - Input: text and/or inline base64 images. Hosted image URLs are not accepted.
  - The `gpt-6-luna` model page's endpoint table omits Decisions ([model page](https://developers.openai.com/api/docs/models/gpt-6-luna); [Mixed News](https://mixed-news.com/en/openai-decisions-api-beta-gpt-6-luna-endpoint-table/)) **[press]**.
- **Via OpenRouter.** **`openai/gpt-6-luna-decisions`** ("GPT-6 Luna served through OpenAI's Decisions API"), created 2026-10-06, served by the snapshot `openai/gpt-6-luna-decisions-20261006`.
  - Output modality is "decisions". Context is 1.05M tokens. Price is $0.10/M input and $0 output. It accepts text, JSON or images in `state`.
  - Question types are `noul`, `choice` and `score`, the same schema as Jev. "A request can carry up to 200 questions about the same content" ([model page](https://openrouter.ai/openai/gpt-6-luna-decisions); [endpoints JSON](https://openrouter.ai/api/v1/models/openai/gpt-6-luna-decisions/endpoints)).
  - The public metadata shows roughly 95 to 97% recent uptime and an endpoint status code of −2. I don't know what that code means.
  - A public GitHub PR already targets this slug on the alpha endpoint ([miilv/controlr #13](https://github.com/miilv/controlr/pull/13)) **[user]**.
- **Why the earlier probes failed.**
  - `openai/gpt-6-luna` is the *chat* slug, so the Decisions router reports it as nonexistent.
  - The Responses API's `reasoning.mode` really does only accept `standard|pro`. Pro mode is for "difficult tasks". `reasoning.effort` runs from `none` to `max`, and Luna's default effort is `medium` ([OpenAI reasoning guide](https://developers.openai.com/api/docs/guides/reasoning)).
  - OpenRouter appears to expose Luna's pro mode as a separate slug, `openai/gpt-6-luna-pro` ("GPT-6 Luna Pro"), visible in the public `/api/v1/models` list. I am inferring that it maps to `reasoning.mode: "pro"`; this is not documented.
- **What I did not verify.** I made **no live call** to `openai/gpt-6-luna-decisions`, so latency, calibration and whether `criteria` objects behave the same as with Jev are untested. The OpenAI forum post was cited by AI Weekly; I did not read it directly. Secondary sources quote "150 ms vs 1.6 s" ([Firecrawl](https://www.firecrawl.dev/blog/openai-decisions-api-vs-jev)) **[press]**. Treat that as unverified.

### 4.3 Example requests (taken from the documented schemas; not executed)

OpenRouter. This should be a drop-in replacement for the Jev path in `src/llm/decide.ts`:

```bash
curl https://openrouter.ai/api/alpha/decisions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-6-luna-decisions",
    "state": {"present": ["tam", "skrag"], "last_player_line": "Skrag, those are your arrows in Tam'\''s ox, aren'\''t they?"},
    "questions": {
      "next_speaker": {
        "type": "choice",
        "instructions": "Who should answer the player'\''s last line?",
        "criteria": {
          "skrag": {"what": "Skrag was addressed or has the most at stake in the reply", "not_for": "Lines aimed at Tam"},
          "tam": "Tam was addressed, or the line is about his ox, farm or idol and Skrag has nothing to add",
          "world": "Nobody would speak; the environment or a consequence answers",
          "player": "Nobody else should speak now; the player has just been asked something or must choose"
        }
      },
      "needs_roll": {"type": "noul", "instructions": "Is the outcome of the player'\''s action genuinely uncertain AND would failure change the situation?",
        "criteria": {"true": "Uncertain with a real cost to failure", "false": "Nothing at stake, or the outcome is obvious"}}
    }
  }'
```

OpenAI direct ([docs](https://developers.openai.com/api/docs/guides/decisions)):

```json
{ "model": "gpt-6-luna", "input": "…scene state…",
  "questions": [{ "type": "choice", "name": "next_speaker", "instructions": "Who should answer?",
    "choices": [{"value": "skrag", "description": "…"}, {"value": "player", "description": "…"}] }] }
```

---

## 5. Applying this research to the first blind-QA runs (`runs/sessions/qa1-*`)

These are observations from the transcripts in `state.json` as of 2026-10-14 01:42, read but not modified. They are meant to show where the craft principles bite, not to grade the runs.

**What worked**

- **"Yes, and" on player inventions** (`qa1-curious-gm`). The player claimed to have fixed Tam's "goose in a bonnet" weathervane and invented a goblin contact, "Nettlegums". The GM accepted the weathervane, which filled a blank, and had Skrag reply: "Nettlegums owes Skrag two buttons and a song." That weaves the player's fiction into the NPC's world, which is *ask questions and use the answers* at its best. The scene still exited through the authored `bargain` exit, with a player-invented clockwork-ox deal.
- **Canon protected in character** (`qa1-method-gmrepair`). The player called him "Tam of Hollowmere" with a wife called Bess. Tam corrected it in the fiction: "Hollowmere? No—Hollis Farm… Bet's my wife." This fits *draw maps, leave blanks*: invented details can fill gaps but not overwrite what is established, and the correction comes from the NPC.
- **NPC influence over refusal** (`qa1-chaos-actors`). The player planned to hide inside the dead ox. Tam refused in character ("you're not cutting open my ox!") and offered an alternative. That is SENNA's second-best redirection strategy.

**Where it went wrong**

- **Dice with nothing at stake.** A friendly greeting triggered Persuasion (DC 10), and an anecdote triggered Insight (DC 12, failed) in `qa1-curious-gm` turns 2 and 5. *Say yes or roll* and BitD's "no danger, no roll" both apply. The lab notebook's decision-suite finding matches this.
- **Improvised actions snapped to the nearest authored check.** A pickpocket attempt on Tam's smock was resolved as an Insight check (natural 20), which then revealed the idol (`qa1-chaos-actors` turns 7–9). This needs an *improvised check* option (Sleight of Hand against Tam's attention, or a contest) instead of mapping to `read-tam`. It is also a case for *permissive clue-finding*: the beat's gist can land by this route.
- **Exit closing contradicts the reply before it** (`qa1-method-gmrepair` turns 19–20). Skrag "snatches up the bread and apples" in the reply, then leaves them "untouched" in the exit closing. The closing should be told what the last reply already narrated.
- **The aftermath ignores which exit was taken** (`qa1-method-gmrepair` turn 22). After `bargain`, whose script removes the idol and has Skrag leave, the next scene has "Grandmother Bone lie where you left them" and Tam climbing out of the ditch. That staging fits the `fight` exit. The player had to invent an explanation ("she came back on her own"). Openings should be generated from the exit taken and the established facts, as Craft's *dynamic* openings and F&F's "scene information on completion of a path" do.
- **Lab notebook items that fit the research.**
  - A single intimidation roll ends the scene before tension builds. Use clocks or effect levels, and soft moves before hard ones.
  - "What are my options?" leaks Skrag's secret willingness to bargain. Be honest about what characters perceive and keep secrets earned.
  - A blunt "you can't teleport". Hard denial is the worst-rated redirection strategy.

---

## 6. Design implications for the V2 scene runtime

Each item names its evidence. Items 1 to 6 concern the scene format, 7 to 13 the turn loop, 14 to 18 the characters and the director, and 19 to 22 evaluation and models.

1. **Author scenes as situations funnelling to exits, not as plots.** Keep the `premise` as a dramatic question that does not assume a method. Cast cards should hold *wants with a fallback*, fears, a **toolkit** (what each person can do) and **key info versus secrets**. Beats are storylets; exits are funnels. *(Don't Prep Plots; Angry GM; node-based funnels.)* The repo's scene format is already close. The main additions are toolkit, revelations and clocks (items 2 and 6).
2. **Keep a revelation list separate from the beats.** For each must-land revelation, list three or more carriers: people, objects, places or passive checks. Track `landed: yes/no`. Let any carrier deliver it when the player makes contact, and log what landed so the director knows what is still missing. *(Three Clue Rule; Sly's secrets abstracted from place.)*
3. **Give every beat a gist and a re-entry line.** If a tangent interrupts before the gist lands, the GM returns later through an NPC in the scene's tone ("…as I was saying about the arrows"). If the player has already moved on, it uses another carrier from item 2. *(Façade gist points and reestablish lines; Ink tunnels and gathers.)*
4. **Classify every player turn by tangent type before replying, and route it.**

   | Type | Response policy |
   |---|---|
   | On-beat | Proceed normally. |
   | Flavour or banter | Say yes and give a specific reaction; no roll. |
   | Player-authored fact | Fills a blank: accept and record to canon. Contradicts canon: an NPC corrects it in the fiction. |
   | Alternative approach to the beat | Find the version that works. Map it to an existing transition if it fits, otherwise create an improvised check with position and cost. |
   | New thread or leaving | Let them. Tick clocks and show consequences; NPCs appeal or offer information. |
   | Impossible within the world | Explain through world logic and show what *is* possible ("yes, but"). Never refuse out of the fiction. |
   | Hostile towards an ally | Real consequences, and possibly an exit. |
   | Meta or out-of-character | Answer out of character, using only what the character could know. |
   | Correction | Accept it, fix the state, don't argue. |

   *(SENNA strategies; PF2e "yes, but"; F&F OOC and correction modes; the lab notebook's leak and teleport cases.)* The decision layer handles this classification well because it is a closed set.
5. **Make redirection an explicit, situation-matched choice.** When the director or narrator needs to steer, choose a strategy, in roughly this order of preference: **in-world consequence**, then **NPC influence**, then **more information**, then (rarely) humour or a quantum ogre. **Never hard denial.** Record which strategy was used, for evaluation. *(SENNA: matched strategies beat the model's own blend; hard denial scored −2.03.)*
6. **Use clocks for exits that should take more than one action.** Persuasion, intimidation and patience exits get progress or tug-of-war clocks of two to four segments. A success ticks the clock or improves the player's position. The exit fires when the clock fills or the fiction is decisive. One roll should rarely end a scene. *(BitD clocks and effect levels; DW soft versus hard moves; lab notebook: an intimidation roll ended the scene early.)*
7. **Say yes or roll.** Before choosing any check, ask a `noul`: "Is the outcome genuinely uncertain AND would failure change the situation?" Only then pick an authored edge or an improvised check, choosing the skill from what the player actually did. Results come in tiers: success, success at a cost, or failure plus a complication. **Never negate a success.** Mark checks as *white* (retry with new leverage) or *red* (once only). *(DitV; BitD; BG3 and Disco; the qa1 pickpocket and greeting cases.)*
8. **Keep exit and persuasion adjudication out of the narrator.** A decision model judges exit conditions with confidence thresholds scaled to how costly a mistake is. Exit scripts run on structured state, and the narrator only describes the outcome. *(CoC-Seduce rhetorical injection; F&F "the UI is the truth"; TypeSafe guidance on thresholds.)*
9. **Who speaks next: rules first, then a calibrated choice that includes the player.**
   - Rules: whoever is addressed or named speaks, and an NPC mid-exchange can finish.
   - Otherwise, a `choice` over {each present NPC, world/narrator, **player**}. Criteria should cover how relevant the line is to each NPC's want, how recently they spoke, a *talkativeness* trait, and how long since the player last had the floor.
   - Cap NPC-only chains at one or two lines, and make each NPC line end by turning to a player character.
   *(Sacks via Versu; SillyTavern natural order; Concordia `NextActing`; Façade wait goals; Dramamancer's "pause for the player after meaningful progression"; V1's runaway NPC-to-NPC chatter.)*
10. **Every NPC want needs an outlet.** Each want lists how it can be satisfied *within this scene's exits*. If the world blocks it, the NPC changes tack, concedes, defers ("later, at the farm"), or escalates towards an exit. No NPC may repeat an unachievable demand more than twice. *(V1's "find another route for the cart" stonewall; Versu's story manager tweaking desires; Alexandrian goal-oriented opponents.)*
11. **Plan only within a single turn.** Any "what I'm aiming for" reasoning is written after the player's message and discarded afterwards. Plans that persist cause loops that wait for the player to do the expected thing. *(F&F 25.39 and the user complaints; Dramamancer: respond to the latest input whether or not it triggers an event.)*
12. **Keep momentum as a separate control.** Score how stalled the scene is (is anything at stake right now?) and count pivots. On a second lull, the director supplies a *new bang*: the beat's `pressure`, a proactive clue, or an NPC acting off-screen. Keep a "downtime" setting for scenes meant to be quiet. *(F&F adventure versus downtime and hook tables; Art of Pacing; Fate; DW fronts.)*
13. **Make scene boundaries state-aware.**
    - Exit closings receive the previous reply and must not re-narrate or contradict it.
    - Next-scene openings are *dynamic*, built from the exit taken, the established facts and the world state.
    - Scripted openings are only for the first scene.
    *(qa1-method-gmrepair turns 19–22; Craft scripted versus dynamic Game Starts; F&F paths set scene info on completion.)*
14. **Run the background repair agent like Versu's story manager, not a second narrator.** It runs every N turns or on a stall or deviation. It sees the beats, the exits and their scripts, the revelation list, the clocks and the established facts.
    - It **outputs** pressures and opportunities: which revelation to push and through whom, desire tweaks, a bang candidate, a redirection strategy, clock ticks.
    - It **never** writes next events as certainties.
    - It must know what is possible in the world: exits, affordances, what cannot exist. That is the gap V1 identified.
    *(Versu; SENNA's Examiner reading the narrative graph; Craft's tool-triggered instructions; CALYPSO-style low-fidelity suggestions.)*
15. **Put steering last and keep it small.**
    - Pinned: the GM headspace (Section 2.9), the current beat's direction and gist, and the active pressures, placed near the end of the prompt.
    - Partial: cast cards for people present or mentioned.
    - On demand: lore and other scenes.
    *(AI Dungeon puts the Author's Note next to last; Craft context visibility and context rot; F&F "less is more"; V1's progressive-disclosure success.)*
16. **Give each NPC a voice card and check line attribution.** Each card has a look, a one-line quote, a mannerism, verbal tics and words the character would never use. Check that every spoken line is attributed to someone actually present. Consider per-character actor calls when two or more NPCs talk in the same turn. *(Alexandrian NPC template; F&F 2.0.2 speaker matching; lab notebook: "longlegs" bleeding into Tam's voice; reply suite: `actors` scored slightly higher on characters.)*
17. **Never write the player character's dialogue, choices or feelings.** Check this mechanically in the evaluations. *(F&F ACE-1.5 cut this by about 90%; the current GM prompt already says it.)*
18. **Give NPCs memories and the scene a canon log.** Tag established facts and improvised details to the people who would know them, and retrieve each person's recent memories when they speak. Player-authored facts that were accepted go into canon. *(F&F 25.41 per-NPC memory and planning; V1's background fact recording success.)*
19. **Keep out-of-character talk and corrections out of the fiction.** Detect them, answer outside the scene's history, and fix state without argument. Prune or summarise argument loops so they don't poison the context. *(F&F OOC mode and "arguing is counter-productive"; Craft's separate OOC chat memory.)*
20. **Watch for repeated patterns and tropes.** Track repeated phrases, openings and beats across replies, and vary or prune them. When a bad pattern appears, correct it at once, because the model imitates its last few replies. *(F&F trope reduction; Craft "correct bad patterns early"; F&F "LLMs repeat patterns".)*
21. **Benchmark `openai/gpt-6-luna-decisions` as a decider.** Run it on the existing 11-case decision suite against Jev (73%) and Luna with structured output (91–100% at about 1 s). It uses the same OpenRouter endpoint and schema. Batch independent questions into one call (up to 200) and keep dependent ones sequential. Rewrite loose criteria as `{what, not_for, examples}`, and keep a cascade only for low-confidence answers. *(Section 4; TypeSafe docs; lab notebook.)*
22. **Score blind-QA transcripts on improvisation, not only progress.** For each tangent turn, score:
    - (a) acknowledged specifically;
    - (b) plausible in the world;
    - (c) consequence or cost when warranted;
    - (d) which redirection strategy was used, if any, and whether it was hard denial;
    - (e) turns until the beat's gist landed by any carrier;
    - (f) whether NPCs acted on their wants;
    - (g) voice distinctness and correct attribution;
    - (h) no player-character puppeting;
    - (i) roll hygiene: no roll without stakes, the right skill, no negated success;
    - (j) continuity across scene boundaries.
    Also track SENNA-style *required* and *optional* adherence statements per scene, and mine logs for *emergent nodes*, meaning good tangents worth authoring into future scenes. *(SENNA; Dramamancer's evaluation dimensions; Player-Driven Emergence; Hidden Door anti-patterns.)*

---

## Sources

**Friends & Fables and Craft [primary]**: [fables.gg](https://fables.gg/) · [How Franz works](https://fables.gg/blog/how-franz-works) · [Introducing ACE-1](https://fables.gg/blog/introducing-ace-1-the-engine-powering-the-best-ai-ttrpg-experiences) · [F&F vs ChatGPT/AI Dungeon/NovelAI](https://fables.gg/blog/how-is-friends-and-fables-different-from-chatgpt-ai-dungeon-or-novelai) · [Why AI Dungeon is not the AI DM](https://fables.gg/blog/why-ai-dungeon-is-not-the-ai-dungeon-master-youre-looking-for) · [When to play AI Dungeon vs F&F](https://fables.gg/blog/when-to-play-ai-dungeon-and-when-to-play-friends--fables) · [jsx-prompts](https://fables.gg/blog/introducing-jsx-prompts-build-complex-prompts-for-llms-with-jsx) · Patch notes: [Prepare for Combat](https://fables.gg/patch-notes/prepare-for-combat), [Quest overhaul](https://fables.gg/patch-notes/quest-overhaul-combat-updates-bugfixes), [Suggested actions](https://fables.gg/patch-notes/suggested-actions), [Narration 1.1](https://fables.gg/patch-notes/narration-module-upgrade-10-greater-11), [OOC mode](https://fables.gg/patch-notes/narration-112-ooc-mode), [ACE-1.5](https://fables.gg/patch-notes/ace-15-bringing-pois-and-npcs-to-life-npc-conversations), [Memories V2](https://fables.gg/patch-notes/memories-v2), [Quests & One-Shots](https://fables.gg/patch-notes/a-new-creative-medium-friends-and-fables-quests-and-one), [Narration 1.1.4](https://fables.gg/patch-notes/narration-114-new-dice-roller-quest-tags), [Combat V4](https://fables.gg/patch-notes/combat-v4), [ACE 1.5.5](https://fables.gg/patch-notes/ace-155), [ACE 1.5.6](https://fables.gg/patch-notes/ace-156), [Franz 2.0](https://fables.gg/patch-notes/franz-20-working-context-lore-improved-planning-and-more), [2.0.1](https://fables.gg/patch-notes/franz-201-better-ooc-correction-handling-lore-sync), [25.37](https://fables.gg/patch-notes/patch-notes-2537-premium-narration-franz-202), [25.38](https://fables.gg/patch-notes/patch-notes-2538-movementtravel-character-generation-tropes), [25.39](https://fables.gg/patch-notes/patch-notes-2540-plot-and-plan-changes), [25.41](https://fables.gg/patch-notes/patch-notes-2541-npc-memory-planning), [25.50](https://fables.gg/patch-notes/patch-notes-2550-group-rolls-follows-in-app-notifications-qol), [Dev Log 26.01](https://fables.gg/patch-notes/development-log-2601), [26.03](https://fables.gg/patch-notes/patch-notes-2603-craft-update), [Craft open beta](https://fables.gg/patch-notes/craft-open-beta-and-credit-transfer), [26.05](https://fables.gg/patch-notes/patch-notes-26-05-new-bug-report-system-updates-timeline) · Help centre: [Current Scene](https://help.fables.gg/articles/1999565-current-scene), [Plot and Plan](https://help.fables.gg/articles/4217496-plot-and-plan), [Memories](https://help.fables.gg/articles/2838157-memories), [Working Context Blocks](https://help.fables.gg/articles/8560008-working-context-blocks), [What ACE sees](https://help.fables.gg/articles/4035786-what-game-state-can-ace-see-update), [How to fix Franz](https://help.fables.gg/articles/1581604-how-to-fix-franz-and-get-your-campaign-back-on), [Get the most out of Franz](https://help.fables.gg/articles/0314477-how-to-get-the-most-out-of-franz), [Start an Encounter](https://help.fables.gg/articles/9486000-how-to-start-an-encounter), [Narrative vs Turn Based](https://help.fables.gg/articles/0954370-narrative-vs-turn-based-combat), [Flee](https://help.fables.gg/articles/0556260-flee-an-encounter), [Troubleshooting Encounters](https://help.fables.gg/articles/2475873-troubleshooting-encounters), [Models](https://help.fables.gg/articles/5728392-what-models-do-you-use), [Available models](https://help.fables.gg/articles/3993355-available-llm-models), [Context size](https://help.fables.gg/articles/5272453-whats-the-maximum-context-size-how-do-i-manage-context), [Worlds](https://help.fables.gg/articles/5283283-worlds) · Craft: [A new approach](https://www.craftrpgs.com/blog/craft-a-new-approach-to-ai-rpgs), [Writing GM Instructions](https://www.craftrpgs.com/docs/writing-gm-instructions), [Context Rot](https://www.craftrpgs.com/docs/context-rot), [Context Visibility](https://www.craftrpgs.com/docs/context-visibility), [Progressive Disclosure](https://www.craftrpgs.com/docs/progressive-disclosure), [Agent Tools](https://www.craftrpgs.com/docs/agent-tools), [Research Tool](https://www.craftrpgs.com/docs/the-research-tool), [Dice and Rolling](https://www.craftrpgs.com/docs/dice-and-rolling), [Game Starts](https://www.craftrpgs.com/docs/game-starts), [Glossary](https://www.craftrpgs.com/docs/a-glossary-of-craft-terms), [B0.18 GM harness](https://www.craftrpgs.com/patch-notes/patch-notes-b0-18-gm-harness-improvements), [B0.048 GPT-6 Luna](https://www.craftrpgs.com/patch-notes/patch-notes-b0-048-space-bunny-alpha-gpt-6-luna-core), [B0.25 model rotation](https://www.craftrpgs.com/patch-notes/model-rotation)

**F&F press, reviews and user posts**: [PC Gamer via Yahoo](https://tech.yahoo.com/ai/articles/generative-ai-dividing-rpg-fans-013630531.html) [press] · [Arcanum review](https://arcanumrpgs.com/blog/friends-and-fables-review/), [DungeonsDeep review](https://dungeonsdeep.ai/blog/friends-and-fables-review-2026), [DreamGen review](https://dreamgen.com/blog/articles/friends-and-fables-review) [competitor] · [rpgsolo forum](https://www.rpgsolo.com/forum/Thread-Endless-Solo-RPGs-with-AI-DM-via-Friends-and-Fables-DnD-5e), [Featurebase: new franz…](https://friendsfables.featurebase.app/p/new-franz-is-not-an-ai-gamemaster-anymore), [Featurebase: 2.0 OOC](https://friendsfables.featurebase.app/p/version-20-franz-is-insufferable-ooc), [Shattered Imperium lore](https://fables.gg/worlds/504edbfd-dd24-4e7a-a0c7-d651c186bc81/lore/01-franz-s-role-and-core-principles) [user] · Not accessible to automated fetching: [r/friendsandfables](https://www.reddit.com/r/friendsandfables/), [Discord](https://discord.gg/JEeTYAhxCw)

**GM craft**: The Alexandrian: [Don't Prep Plots](https://thealexandrian.net/wordpress/4147/roleplaying-games/dont-prep-plots), [Three Clue Rule](https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule), [Node-Based Design pt 1](https://thealexandrian.net/wordpress/7949/roleplaying-games/node-based-scenario-design-part-1-the-plotted-approach), [pt 3](https://thealexandrian.net/wordpress/7985/roleplaying-games/node-based-scenario-design-part-3-inverting-the-three-clue-rule), [pt 6](https://thealexandrian.net/wordpress/8015/roleplaying-games/node-based-scenario-design-part-6-alternative-node-design), [Railroading Manifesto](https://thealexandrian.net/?p=36900), [Art of Pacing](https://thealexandrian.net/wordpress/31509/roleplaying-games/the-art-of-pacing), [pt 2](https://thealexandrian.net/wordpress/31520/roleplaying-games/the-art-of-pacing-part-2-scene-framing), [pt 4](https://thealexandrian.net/wordpress/31533/roleplaying-games/the-art-of-pacing-part-4-closing-the-frame), [Universal NPC Template](https://thealexandrian.net/wordpress/37916/roleplaying-games/universal-npc-roleplaying-template), [Quick NPC Template](https://thealexandrian.net/wordpress/50635/roleplaying-games/quick-npc-template) · Sly Flourish: [Lazy GM Resource Document](https://slyflourish.com/lazy_gm_resource_document.html), [Using the 8 steps at the table](https://slyflourish.com/using_the_8_steps_at_the_table.html) · Dungeon World: [The GM](https://roll20.net/compendium/dw/Rules:The%20GM), [Fronts](https://roll20.net/compendium/dw/Fronts) · Apocalypse World: [Always say](https://daily-apocalypse.com/daily-apocalypse/36-always-say) · [Blades in the Dark SRD](https://raw.githubusercontent.com/amazingrando/blades-in-the-dark-srd-content/master/Blades-in-the-Dark-SRD.md) · [Fate SRD: Defining Scenes](https://fate-srd.com/fate-core/defining-scenes) · [Angry GM: awesome encounters](https://theangrygm.com/how-to-build-awesome-encounters/), [Angry GM: four things](https://theangrygm.com/four-things-youve-never-heard-of-that-make-encounters-not-suck/) · [PF2e GM Core: Adjudicating Rules](https://2e.aonprd.com/Rules.aspx?ID=884) · [Dogs in the Vineyard](https://en.wikipedia.org/wiki/Dogs_in_the_Vineyard) · [13th Age fail forward (EN World)](https://www.enworld.org/goto/post?id=6782135) · [Roleplaying Tips #78](https://www.roleplayingtips.com/rptn/gm-schizophrenia-tips-for-holding-conversations-between-multiple-npcs/) · [Gnome Stew: spotlight](https://gnomestew.com/sharing-and-shining-the-spotlight/) · [Burn After Running: spotlighting](https://burnafterrunningrpg.com/2023/03/)

**Interactive drama and dialogue systems**: [Façade AIIDE 2005](https://cdn.aaai.org/AIIDE/2005/AIIDE05-016.pdf) · [Versu TCIAIG 2014](https://www.cs.uky.edu/~sgware/reading/papers/evans2014versu.pdf), [Versu conversation](https://emshort.blog/2013/02/26/versu/) · [Writing with ink](https://raw.githubusercontent.com/inkle/ink/master/Documentation/WritingWithInk.md) · [Yarn Spinner saliency](https://docs.yarnspinner.dev/write-yarn-scripts/advanced-scripting/saliency) · [Beyond Branching](https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/) · [Valve dynamic dialog](https://www.gdcvault.com/play/1015528/AI-driven-Dynamic-Dialog-through) · [bg3.wiki checks](https://bg3.wiki/wiki/Ability_check), [CGMagazine BG3](https://www.cgmagonline.com/articles/baldurs-gate-3-redefined-crpg-dialogue/), [Karmic Dice](https://primagames.com/tips/baldurs-gate-3-karmic-dice-explained) · [Disco Elysium checks](https://gfinity.net/disco-elysium/can-you-fail/), [Kotaku on Disco dialogue](https://kotaku.com/disco-elysiums-dialogue-system-is-as-addictive-as-any-s-1841046831) · [Hidden Door interview](https://aigamechangers.substack.com/p/the-machine-is-not-itself-creative), [Bicking review](https://ianbicking.org/blog/2025/08/hidden-door-design-review-llm-driven-game) · AI Dungeon: [Context](https://help.aidungeon.com/faq/what-goes-into-the-context-sent-to-the-ai), [Story Cards](https://help.aidungeon.com/faq/story-cards), [Memory System](https://help.aidungeon.com/faq/the-memory-system) · [CALYPSO](https://arxiv.org/abs/2308.07540) · [D&D Dialog Challenge](https://arxiv.org/abs/2210.07109) · [FIREBALL](https://arxiv.org/abs/2305.01528) · [SENNA DOI](https://doi.org/10.1145/3742413.3789218), [SENNA thesis](https://projekter.aau.dk/projekter/files/784680954/Narrative_Adherence_in_LLM_driven_Games.pdf) · [Static vs Agentic GM](https://arxiv.org/abs/2502.19519) · [IBSEN](https://aclanthology.org/2024.acl-long.88) · [Drama Llama](https://arxiv.org/abs/2501.09099) · [Dramamancer](https://arxiv.org/abs/2601.18785) · [Drama Interaction](https://arxiv.org/abs/2405.14231) · [Immersion & Agency](https://aclanthology.org/2025.acl-long.546) · [StoryVerse](https://arxiv.org/abs/2405.13042) · [Player-Driven Emergence](https://arxiv.org/abs/2404.17027) · [CoC-Seduce](https://arxiv.org/abs/2607.02802) · [Sakellaridis thesis](https://studenttheses.uu.nl/bitstream/handle/20.500.12932/47209/Thesis_Final.pdf?sequence=1&isAllowed=y), [via Wargamer](https://www.wargamer.com/dnd/ai-railroads-players) · [Concordia](https://arxiv.org/abs/2312.03664), [NextActing source](https://github.com/google-deepmind/concordia/blob/main/concordia/components/game_master/next_acting.py), [Scene spec source](https://github.com/google-deepmind/concordia/blob/main/concordia/typing/scene.py) · [SillyTavern group chats](https://docs.sillytavern.app/usage/core-concepts/groupchats/) · [AutoGen SelectorGroupChat](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/selector-group-chat.html) · [HN: LLM agents as DMs](https://news.ycombinator.com/item?id=42698610)

**Decisions APIs**: [OpenRouter Decisions reference](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request) · [Jev hub](https://openrouter.ai/docs/guides/community/jev) · [Jev tutorial](https://openrouter.ai/docs/guides/community/jev-tutorial) · [Jev model page](https://openrouter.ai/typesafe/jev-1.13) · [GPT-6 Luna Decisions on OpenRouter](https://openrouter.ai/openai/gpt-6-luna-decisions) and [endpoints JSON](https://openrouter.ai/api/v1/models/openai/gpt-6-luna-decisions/endpoints) · [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions) · [OpenAI gpt-6-luna model page](https://developers.openai.com/api/docs/models/gpt-6-luna) · [OpenAI reasoning guide](https://developers.openai.com/api/docs/guides/reasoning) · [AI Weekly launch note](https://aiweekly.co/alerts/openai-launches-decisions-api-public-beta-on-gpt-6-luna) · [Mixed News](https://mixed-news.com/en/openai-decisions-api-beta-gpt-6-luna-endpoint-table/) · [openrouter-examples #83](https://github.com/OpenRouterTeam/openrouter-examples/issues/83) · [TypeSafe: How to build](https://docs.typesafe.ai/concepts/how-to-build-with-system-one) · [TypeSafe: Confidence](https://docs.typesafe.ai/confidence) · [miilv/controlr PR #13](https://github.com/miilv/controlr/pull/13) · [Firecrawl comparison](https://www.firecrawl.dev/blog/openai-decisions-api-vs-jev) (secondary)
