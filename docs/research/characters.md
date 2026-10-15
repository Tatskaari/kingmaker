# Characters an improvising GM can play

Research for the Kingmaker V2 scene runtime, compiled 2026-10-14. It covers how to write the people in our scenes so that a fast GM with no thinking time plays them well. That means the cast cards in `scenes/*.ts` and the lore in `lore/Cast/<Name>/`.

The user's framing: a character is a collection of **motivations, relationships, secrets and contradictions**, not a biography. The sources agree, and they add two things:
- A fast GM needs a few concrete **handles** it can grab mid-sentence.
- What the GM needs a character *for* has to stay separate from what the character *wants*. Otherwise the character turns into a hint-dispenser.

**How to read this.**
- Section 1 gives the principles, with quotes.
- Section 2 is the template for our formats, field by field: what goes on the card and what goes in the lore.
- Section 3 is a one-screen checklist for authors, human or AI.
- Section 4 tests Sergeant Kell, Big Hobb and Master Sallow against the checklist and proposes rewrites.

Sources are linked inline and listed at the end. Related notes:
- [pacing.md](pacing.md) covers how reveals are paced. Its `SecretSpec` is the secret shape used here.
- [pacing-failures.md](pacing-failures.md) holds the transcript failures cited below as F1–F15.
- [experiments/absurdity.md](../experiments/absurdity.md) describes the mouthpiece failure.
- See also [gm-techniques.md](gm-techniques.md), [dc-guidance.md](dc-guidance.md) and [scene-sources.md](scene-sources.md) §5.6 (Kim Kitsuragi, Kell's model).

## Summary

1. **Start from a want in motion, not a past.** Backstory earns a line only if it changes what they do today. Every source puts the want first:
   - "What does the NPC want from this conversation/situation?" (the Alexandrian);
   - "a concrete desire and preferred method of action" (*Blades in the Dark*);
   - "Don't script NPCs, role-play them … Then, play to win" (the Angry GM).
2. **Give the GM handles, not a profile.** That means a sentence or two of look with one physical habit, a line of voice with a sample, and two or three bullets on how to play them. "You don't need a full-blown psychological profile and, in fact, that would be counterproductive."
3. **Keep the GM's purpose behind the screen.** "That's how the GM's voice ends up coming out of an NPC's mouth" (the Angry GM, on companions who volunteer whatever the GM needs said).
   - Give every character a want of their own, "subtly different" from the player's.
   - Write a helper's expertise as a method and an appetite, never as the answer. Our worst Kell moments (F1, F2, F10) start where her card holds the answer.
4. **Relationships are the scene engine.** A relationship pulls when it has a specific incident, a feeling, a want now, a lever, and a belief that may be wrong, written from both sides. Kell and Cob are the model: the same two arrests, read two ways. Our best pressure lines already come from relationships, such as Arlo calling Hobb out for the chair.
5. **Contradictions must be double-edged and pressable.**
   - Write "X, but Y; it shows when Z", with two ways it helps the player and two ways it bites (Fate's litmus test).
   - Give the scene a way to force the choice, because "true character is revealed in the choices a human being makes under pressure" (McKee).
   - In the house style the contradiction is never resolved, only followed through.
6. **Secrets need a surface, a price and a key.**
   - Author what shows before it's told, what telling costs, what they're torn between, what truly reaches them, and what they give first.
   - Allow one piece per bullet and per success.
   - Mark the words an essential depends on, so a partial reveal can't starve the scene (F11).
7. **The card is for the scene; the lore is for the story.**
   - The card holds the scene task, this scene's tells and secrets, and how they start towards the player.
   - The lore holds the through-line, the voice, the contradictions, the relationships and the truth.
   - The card must stand alone (for `v2-nomemory`), the two must not disagree, and what happened in play outranks both.
8. **Our cast is strong on wants, tells and wrong beliefs, and weak in four places:**
   - expertise written as answers (Kell);
   - secrets and success lines bundled so that one success dumps them (Hobb's card; the granary's `scare-kids` line);
   - relationships written from one side only (Hobb has no lore at all);
   - an offscreen villain with no moves (Sallow).

---

## 1. Principles

### 1.1 A want in motion: a role with a motivation, played to win

The NPC advice starts from one place: what this person wants, now, from the people in front of them.

> "The NPC should have an objective. What does the NPC want from this conversation/situation? … You should be able to state it in a single, simple sentence. … The objective gives you focus: Whenever you're unsure of what the NPC should say or do next, just ask yourself, 'How can I accomplish my objective?'" ([The Alexandrian: Roleplaying for the Beginning GM](https://thealexandrian.net/wordpress/52707/roleplaying-games/roleplaying-for-the-beginning-gm))

> "What information do they want from the PCs? What do they need the PCs to believe? What do they need to hear the PCs say? What do they need to hide from the PCs? This is the NPC's agenda. You want to keep it simple, short, and actionable. And then you want to play it hard, with the NPC employing all kinds of tactics and conversational gambits to get what they want." And: "The NPC just needs to want something different than the PCs, even if it's only subtly different." ([The Alexandrian: NPC Conversation Agendas](https://thealexandrian.net/wordpress/52079/roleplaying-games/ptolus-running-the-campaign-npc-conversation-agendas))

> "Give the NPC a strong agenda. Make them want something. Better yet? A pair of agendas. If they're agendas that partly conflict with each other, even better. It actually works best if this agenda is not aimed directly at the PCs." ([The Alexandrian: Memorable NPCs](https://thealexandrian.net/wordpress/43539/roleplaying-games/random-gm-tip-memorable-npcs))

> "Don't script NPCs, role-play them. Whatever scene they are in, figure out what they want and why. Then, assume you're a player and that they won't get what they want unless you win. Then, play to win." ([The Angry GM: What Even Is an NPC](https://theangrygm.com/what-even-is-an-npc/))

> "The GM plays all the non-player characters in the world by giving each one a concrete desire and preferred method of action." ([Blades in the Dark SRD](https://raw.githubusercontent.com/amazingrando/blades-in-the-dark-srd-content/master/Blades-in-the-Dark-SRD.md))

> "The NPCs are people: they have goals and the tools to struggle towards those goals." ([Dungeon World: The GM](https://roll20.net/compendium/dw/Rules:The%20GM)) Its fronts give every danger an *impulse*, "a crucial motivation that drives it", and say "When you're not sure what to do next, push your danger towards resolving a grim portent." ([Dungeon World: Fronts](https://roll20.net/compendium/dw/Fronts))

The actor's version is the same idea at two scales. A task is "a problem, embedded in the 'given circumstances' of a scene, that the character needs to solve. This is often framed as a question: 'What do I need to make the other person do?' or 'What do I want?'" The tasks form a through-line towards a "supertask" for the whole drama ([Stanislavski's system](https://en.wikipedia.org/wiki/Stanislavski%27s_system)). The Angry GM says the same for companions: "Goals are good for short-term companions. And if a short-term companion turns into a long-term buddy, you've got to turn their goal into a motivation" ([So Many People](https://theangrygm.com/so-many-people/)).

Backstory comes after. The Universal NPC Roleplaying Template's test for background: "Is it something that will directly influence the decisions they make? … If it's just a short story about some random person's life that you're writing for an audience of one, refocus your attention on prepping material that's relevant to the players" ([Universal NPC Roleplaying Template](https://thealexandrian.net/wordpress/37916/roleplaying-games/universal-npc-roleplaying-template)). The Angry GM on villains: "Backstory is the least important, least interesting part of the story. That's why we're not playing it" ([Villains AS Characters](https://theangrygm.com/villains-and-characters-villains-as-characters/)). K.M. Weiland's *ghost* is the one exception: "something in your character's past that haunts him", kept because it explains what they believe now ([Character Arcs, Pt. 4](https://www.helpingwritersbecomeauthors.com/character-arcs-4/)).

**For us:**
- **A want is a verb aimed at someone or something in the scene,** with a deadline when there is one: "to get the two of them out of the granary quarter before the gentleman comes back". "To be safe" is a state, not a want.
- **Give two wants that partly conflict.** Moll wants to keep the crown and to keep Cob, and the scene is the moment those come apart.
- **Make it subtly different from the player's goal.** A partner who wants exactly what the player wants competes with them for the scene.
- **Add the method** (Blades' "preferred method"): Nan sells it by the measure; Tull waits for a reason he can repeat to the Captain; Sallow tries his office, then money, then the river.
- **The card holds the task; the lore holds the through-line.**
- **One past event that acts now beats a page of history.** Kell sent Prout away three days ago. Nan put Kell through a door twenty years ago. Both change what happens today.

### 1.2 Handles, not a profile

The Alexandrian's template keeps a briefing usable at the table:
- **Appearance:** "1-2 sentences is the sweet spot."
- **Quote:** a single line, because "a properly crafted quote can be a very effective way to quickly capture the NPC's unique voice".
- **Roleplaying:** "the heart of the template, but it should also be the shortest section. Two or three brief bullet points at most."
- **A mannerism:** "at least one simple, physical action that you can perform while playing the character at the table", because "the rest of the character's personality will flow out of you whenever you hit that touchstone".
- **No more:** "You don't need a full-blown psychological profile and, in fact, that would be counterproductive."

([Universal NPC Roleplaying Template](https://thealexandrian.net/wordpress/37916/roleplaying-games/universal-npc-roleplaying-template); the [Quick NPC Template](https://thealexandrian.net/wordpress/50635/roleplaying-games/quick-npc-template) cuts it to appearance, a mannerism and a concept: "the rest of the character will usually flow easily through that mannerism".)

The other sources say the same at different sizes:
- **The Angry GM's two-note NPC** has a game purpose ("you should be able to explain in one SHORT sentence why an NPC exists") and "one – and precisely ONE – humanizing trait", chosen from:
  - vulnerability, fear and pain;
  - hopes, dreams and aspirations;
  - values, virtues and beliefs;
  - flaws and failings;
  - self-awareness;
  - challenge, growth and agency.
  "Don't waste your precious one humanizing trait on personality." Traits found in play go "on the back of the NPC's card" ([Angry's Two-Note NPC](https://theangrygm.com/angrys-two-note-npc/)).
- **Sly Flourish** outlines key NPCs as "a name and a connection to the adventure, then wrapping the NPC in a character archetype from popular fiction" ([Lazy GM's Resource Document](https://slyflourish.com/lazy_gm_resource_document.html)). A borrowed character gives "physical traits, mannerisms, attitudes, accents, motivations, and more" at once ([Characters from TV shows](https://slyflourish.com/characters_from_tv_shows.html)).
- **Dungeon World:** "Anyone that the players speak with has a name. … Start with a name. The rest can flow from there."
- **Fate scales detail to the role.** Nameless NPCs "never get more than one or two aspects". Supporting NPCs get "a high concept, a trouble, one or more additional aspects". A setting's *faces* need "a name, a relationship to the organization or issue, and an aspect detailing their significance to the story" ([Creating and Playing the Opposition](https://fate-srd.com/fate-core/creating-and-playing-opposition), [Faces and Places](https://fate-srd.com/fate-core/faces-places)).

**For us:** these are the handles a fast GM can't miss.
- **A physical habit** done every few replies. Kell watches hands and taps her pencil. Saul answers for his dog.
- **A form of address.** Kell says "investigator", Sallow says "Clerk" and "Sergeant", Nan says "my duck". It can double as a display of the relationship: Kim Kitsuragi calls Harry "'officer' when he is angry with Harry, and 'detective' when he is not" ([Kim Kitsuragi, wiki.gg](https://discoelysium.wiki.gg/wiki/Kim_Kitsuragi)).
- **A sample line that does the whole character.** Sallow: "I never threaten anyone. I describe what will happen, in order."
- **The thing they take entirely seriously.** This is the engine of the house style ("People take themselves, their jobs, their customs and their troubles entirely seriously", [tone-comic.md](../../prompts/tone-comic.md)). Examples: Nan's rules, Tull's written orders, Kell's notebook, Sallow's paper.
- **An entrance that shows them in action.** Weiland calls this the characteristic moment, "his first chance to impress your readers" ([Character Arcs, Pt. 5](https://www.helpingwritersbecomeauthors.com/character-arcs-5/)). Examples: Cob stoning a hanged man he liked; Moll swearing from a wall in two languages.
- **Detail scaled to the role.** Not everyone needs a lore folder. Everyone who recurs does.

One inference of our own, not from the sources: models drift from their instructions over a conversation. One study found "a significant instruction drift within eight rounds of conversations", attributed in part to "attention decay over long exchanges" ([Li et al. 2024](https://arxiv.org/abs/2402.10962)). Short, concrete handles should survive that better than paragraphs of personality, and the per-turn brief can restate them cheaply.

### 1.3 The GM's purpose stays behind the screen

This is our hard-won lesson ([absurdity.md](../experiments/absurdity.md): characters recited the co-GM's terms), and the sources name it.

> "If the dragon king exists just to deliver exposition, it isn't really an NPC. It's just a robot. It's basically the RPG equivalent of a dialogue box or an on-screen text scroll. No decisions, no NPC." ([The Angry GM: What Even Is an NPC](https://theangrygm.com/what-even-is-an-npc/))

> "NPC companions — in general — should neither initiate interactions nor join interactions without an invitation from a PC. They should speak when spoken to and stay silent otherwise." … "Understand, though, this ain't blanket permission to volunteer any information or use any skill at all. Or create any conflict. Or tell any story. That's how the GM's voice ends up coming out of an NPC's mouth. That's why it's important to define each NPC's purpose. Specifically." ([The Angry GM: So Many People](https://theangrygm.com/so-many-people/))

> "The less the players think 'X exists because the GM wants us to do Y,' the more they will think of X as an actual person." And: "If the PCs' actions/knowledge/connections/whatever could help (or hinder) the NPC, I've found it's often more effective for the NPC to discover that during their interaction with the PCs." ([The Alexandrian: Memorable NPCs](https://thealexandrian.net/wordpress/43539/roleplaying-games/random-gm-tip-memorable-npcs))

The Alexandrian keeps the purpose on the page, but apart from the person. His **Key Info** is a separate list of "the essential interaction or information that the PCs are supposed to get from the NPC". That way the clue isn't buried "in the narrative of the NPC's background" ([Universal NPC Roleplaying Template](https://thealexandrian.net/wordpress/37916/roleplaying-games/universal-npc-roleplaying-template)).

Sly Flourish names the companion trap exactly: "This can get tricky if the NPC is clearly the right person for a particular job, either because of what they know or the skills they happen to have. … The spotlight should always be on the characters and tag-along NPCs should always be in the background" ([Tag-along NPCs](https://slyflourish.com/tag-along_npcs.html)). Dungeon World: "Never speak the name of your move."

Our transcripts show where it goes wrong ([pacing-failures.md](pacing-failures.md)):
- **F1, turn 5:** "Kell steps in and does the asking herself."
- **F2:** Kell "reads the body from the cobbles", because her card lists what her eye will find.
- **F10:** "Put the conclusion plainly, investigator", then "Put it together for me", after the player already had.
- **The mouthpiece playtest:** Moll says "If you want anything else from Cob, tell me how you'll keep him safe."

**For us:**
- **What the scene needs from someone is an author's note, not their want.** It lives in `essentials`, in a transition's success text, or in `gm.md`. `essentials` is our Key Info.
- **Write expertise as a method and an appetite, never as the conclusion.** Write "she won't say how a hanged man died till she's had him close", not the list of marks she'll find.
- **Give helpers an in-fiction reason they can't solve it.** The kids won't talk to a uniform. She's off her patch. She won't swear to what she didn't see.
- **A companion acts on her own errands, never on the player's behalf.** "I'm going down the river stairs at dusk" is initiative. "You should try the Rat" is the GM talking.
- **What would win someone over is prep, never terms.** The brief already labels attitude "your prep: they never spell it out". Cards shouldn't phrase it as a deal ("she'll talk if you promise X").

### 1.4 Relationships generate the scenes

> "The principle of conservation of NPCs actually is one of my GMing strategies. Whenever I introduce a new conflict into the game, I try to see if existing NPCs can be integrated into this role before I consider introducing a new NPC." Re-used NPCs "will have multiple facets relevant to the players". And when some think Lord Bakersfield pompous and others think him the greatest man they've ever met, "and they both have cause to think so", "you're also basically *forcing* the players (and their PCs) to make up their own minds about Lord Bakersfield." ([The Alexandrian: Memorable NPCs](https://thealexandrian.net/wordpress/43539/roleplaying-games/random-gm-tip-memorable-npcs))

> Rick and Louis "are generally Friendly with each other, but when the Nazi Strasser puts official pressure on Louis, he can become temporarily Hostile to Rick … such conflicts in an NPC's relationship with the PCs can be a great source of drama and adventure." And: "Relationships are developed over the long-term, evolving over the course of multiple scenes (and likely multiple sessions)." ([The Alexandrian: Reactions & Relationships](https://thealexandrian.net/wordpress/50021/roleplaying-games/random-dd-tip-relationships-reactions))

Several games build characters out of relationships instead of histories:
- **Fiasco.** "Each pair of adjacent players has a defined relationship and one other element (a need, object, or location) that is central to the relationship" ([Fiasco](https://en.wikipedia.org/wiki/Fiasco_(role-playing_game))).
- **Smallville (Cortex Plus).**
  - Characters "do not have any stats representing attributes or skills. Instead, characters have a set of virtues and relationships", each with "a descriptive phrase attached".
  - Players build "a relationship diagram showing how player characters, NPCs and major locations relate to each other".
  - Characters advance "more so if you challenge the nature of the statement, but you have to rewrite the statement after advancing the relationship" ([RPGamer review](https://web.archive.org/web/20140102195829/http://www.rpgamer.com/savingthrow/reviews/rev-SV.html)).
- **Monsterhearts.** Characters end creation with "'strings' on each other that can be spent to manipulate" ([Monsterhearts](https://en.wikipedia.org/wiki/Monsterhearts)).
- **Blades in the Dark.** Each character picks a known NPC "who is a close relationship (a good friend, a lover, a family relation, etc.)" and "another NPC on the list who's your rival or enemy" ([SRD](https://raw.githubusercontent.com/amazingrando/blades-in-the-dark-srd-content/master/Blades-in-the-Dark-SRD.md)).
- **Fate.** Tying an aspect to a relationship with an organisation means it "can make demands of you, can get you into trouble … Suddenly, that aspect has a lot more going on around it" ([Making a Good Aspect](https://fate-srd.com/fate-core/making-good-aspect)).
- **Dungeon World.** "People, just like dungeons, change over time. … the people they meet with will remember these changes."

**For us:** a relationship that pulls has six parts.
1. **An incident.** One or two specific things that happened, with a detail that sticks: a door, four shillings and sixpence, the end of a pie.
2. **A feeling,** and what they don't admit about it.
3. **A want now:** what they want from or for the other person today.
4. **A belief that might be wrong.** This is the fuse. Sallow believes Hobb is "too frightened of you to talk".
5. **A lever:** what they could do to the other, or the other to them.
6. **What would change it.**

Three more rules:
- **Write both sides, differently.** Kell and Cob read the same two arrests in opposite ways (2.4).
- **Let people disagree about third parties.** This is the Bakersfield effect.
- **Reuse the cast before adding people.** Cob as Nan's pot-boy is conservation at work.

Relationships are also where our best **pressure** lines come from:
- Arlo calls Hobb out for the champion's chair (a rivalry);
- Tull waits on Kell's word (trust);
- Moll tries to get Cob away (care).

### 1.5 Contradictions: surprising, consistent, pressable

Robert McKee, from *Story* (1997, chapter 5): "True character is revealed in the choices a human being makes under pressure—the greater the pressure, the deeper the revelation, the truer the choice to the character's essential nature." He also says "Dimension means contradiction: either within deep character (guilt-ridden ambition) or between characterization and deep character (a charming thief)." I couldn't check these lines against a text online in this session. McKee's own lessons on the same idea are [Character Traits vs. Contradictions](https://mckeestory.com/character-traits-vs-contradictions/) and [Character Dimensions](https://mckeestory.com/how-to-create-and-develop-character-dimensions/).

E.M. Forster, *Aspects of the Novel* (1927): "The test of a round character is whether it is capable of surprising in a convincing way. If it never surprises, it is flat." Wikipedia summarises it: round characters "undergo development, sometimes sufficiently to surprise the reader" ([Character (arts)](https://en.wikipedia.org/wiki/Character_(arts))).

Fate gives the most usable test:

> "Good aspects offer a clear benefit to your character while also providing opportunities to complicate their lives or be used to their detriment. An aspect with a double-edge is going to come up in play more often than a mostly positive or negative one. … Try this as a litmus test—list two ways you might invoke the aspect, and two ways someone else could invoke it or you could get a compel from it." ([Making a Good Aspect](https://fate-srd.com/fate-core/making-good-aspect))

A Fate *trouble* is "the answer to a simple question: what complicates your character's existence?" It "shouldn't be easy to solve. If it was, your character would have done that already … But nor should it paralyze the character completely" ([Your Character Idea](https://fate-srd.com/fate-core/your-character-idea)).

Other sources agree:
- **Smallville** turns a contradiction into play: acting against your own value statement "challenges" it.
- **The Angry GM:** flaws alone make characters "pitiable, but combined with self-awareness, agency, and growth, they garner a great deal of respect" ([Two-Note NPC](https://theangrygm.com/angrys-two-note-npc/)).
- **Kim Kitsuragi** is built on contradictions. He is a self-proclaimed "unrepentant spoilsport" who "was designed to find Harry funny, and will go out of his way to break his 'persona' to indulge him". He criticises the police's corruption but will "partake in certain abuses of power" ([wiki.gg](https://discoelysium.wiki.gg/wiki/Kim_Kitsuragi)). Kell is modelled on him.

**For us:** write a contradiction so the GM can play both halves and the scene can press on it:

> **X, but Y.** It shows when … It helps the player when … It bites when … The scene forces the choice when …

In the house style the contradiction is played absolutely straight and never resolved. Nan's rule six is "What's said in the Rat stays in the Rat" and rule seven is "Gossip sold by the measure". She "sees no contradiction between six and seven: the gossip is sold in the Rat", and that is the joke. McKee notes that [comedic characters don't need to change](https://mckeestory.com/does-a-character-need-to-change-in-a-comedy/). Followed through, the contradiction is what sends the bill.

### 1.6 Secrets: a surface, a price and a key

> "Secrets and clues are single short sentences that describe a clue, a piece of the story, or a piece of the world that the characters can discover during the game. … you'll want to keep these secrets and clues abstract from their place of discovery so that you can drop them into the game wherever it makes sense." And: "of the ten secrets I prepare, about five of them usually get revealed. This is perfectly fine and healthy." ([Sly Flourish: Revealing Secrets](https://slyflourish.com/revealing_secrets.html)) "You don't owe secrets and clues anything at all." ([Secrets Serve You](https://slyflourish.com/secrets_serve_you.html))

> "Players are generally more interested if there's a clear build to the information they're receiving (so multiple key moments can work better with tiered information than with an undifferentiated exposition dump)." To improvise what someone knows, ask: "How do they know the information / What's their opinion of the information / What's their motivation for giving the information / What's their relationship to the information (and to the PCs)". ([The Alexandrian: Tiered Information](https://thealexandrian.net/wordpress/39653/roleplaying-games/rulings-in-practice-gathering-information-part-2-improvisation-and-tiered-information))

> Reading someone can be its own step: "The initial social skill resolution provides clues about what approaches might (or might not) work with the targeted character: Are they susceptible to bribes? A coward who can be intimidated? Maybe you realize that they're secretly in love with Teodora…" Once someone breaks, "that remains true as the PC continues to ask questions." ([The Alexandrian: Social Skills](https://thealexandrian.net/wordpress/43360/roleplaying-games/rulings-in-practice-social-skills))

More from the sources:
- **Weiland**, quoting a writing guide: wounds "are often kept secret from others" ([Pt. 4](https://www.helpingwritersbecomeauthors.com/character-arcs-4/)).
- **The Angry GM:** "Discoveries aren't empowering if they're not useful" ([The Joy of Secrets](https://theangrygm.com/the-joy-of-secrets/)).
- **Dungeon World** keeps secrets as moves:
  - "An unwelcome truth is a fact the players wish wasn't true… the helpful goblin is actually a spy."
  - On consequences that come later: "Make a note of and reveal it when the time is right."
- **The Three Clue Rule** covers what the scene *needs* ([Three Clue Rule](https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule); [pacing.md](pacing.md) §1.4). pacing.md sums the sources up as "hints are free, answers are earned".

Our failures come in three shapes:
- **Dumps:** F1, and F8's "one roll opens both children".
- **Nagging:** F3, where the boot crackles in six replies.
- **Starving:** F11, where Moll cracks without the name and the climax never lands.

**For us:** author each secret as these parts. The shape follows pacing.md's `SecretSpec`, with three additions.
- **ask:** the question it answers ("who paid Moll to lie").
- **text:** one piece of the truth, in their words.
- **shows:** what doesn't fit, before it's told. If it's visible, put it in `look` (Moll's closed fist).
- **stakes:** what telling costs them.
- **torn:** what they're torn between.
- **opens:** what truly reaches them, either their need answered or proof they can't deny.
- **first:** the piece they give first.
- **carries:** the words an essential depends on, so a partial reveal keeps them.

Keep two kinds apart. **Structural truths** are essentials: they get several carriers and are never withheld. **Character secrets** are earned, and it's fine to leave them unsolved.

### 1.7 Want and need: the door the player can open

> "The Thing Your Character Wants will almost always be something external, something physical." "In a word, the Thing Your Character Needs is the Truth." "The Thing Your Character Needs may preclude the Thing He Wants." ([K.M. Weiland: Want vs. Need](https://www.helpingwritersbecomeauthors.com/character-arcs-3/))

> "If an NPC is scared of something and that's why they aren't helping the party, the PCs can do something to alleviate that fear to get the help they need." Hopeful traits suit obstacles "because players can often resolve the obstacle in a win-win way by helping the NPC get what they want." ([The Angry GM: Two-Note NPC](https://theangrygm.com/angrys-two-note-npc/))

Our best card already does this. Hobb's attitude: "Kindness is harder for him to bear than threats, because it makes him want to tell."

**For us:**
- **The want is what they're doing; the need is what would open them.**
- The need belongs in `attitude` (prep) and in a secret's `opens`. It is never terms they announce.
- It should be something the player could actually give in this scene: a promise, protection, a truth, a way to put it right.

### 1.8 Across scenes: the back of the card

The sources agree that characters grow from play, not from prep:
- **The Angry GM:** when an NPC reveals a new trait in play, "you need to write that trait on the back of the NPCs card".
- **The Alexandrian:** relationships evolve "over the course of multiple scenes".
- **Dungeon World:** "the people they meet with will remember these changes".
- **Generative agents** keep "a complete record of the agent's experiences using natural language, synthesize those memories over time into higher-level reflections, and retrieve them dynamically to plan behavior". The ablation showed that observation, planning and reflection "each contribute critically to the believability of agent behavior" ([Park et al. 2023](https://arxiv.org/abs/2304.03442)).

**For us:** our lore already has this shape.
- The card is written neutral to how earlier scenes ended.
- Memories record events.
- The improvised-detail reviewer writes new facts into the lore.

What's missing is the *reflection*. When a relationship changes, the change should reach `knowledge/<Other>.md`, so that the next scene opens the relationship as it now stands, not a log of events ([prompts/review/relationship.md](../../prompts/review/relationship.md) currently only saves memories).

---

## 2. The template

### 2.1 What goes where

| | Cast card (`scenes/*.ts`): this scene | Lore (`lore/Cast/<Name>/`): across scenes |
|---|---|---|
| Who they are | `name`, `group`, `enters` | `public.md`: what anyone could know or see |
| Look | What a first glance shows *here*, including this scene's tells (Moll's closed fist) | `public.md` look and the constant habit |
| Voice | One line, a form of address, one sample line | `private.md` voice: two sample lines, what they avoid, how they sound under strain |
| Wants | The scene task: a verb aimed at someone present, by when; a second want that partly conflicts | `private.md`: the through-line, and the need under it |
| Fears | What could happen to them in this scene | `private.md`: what they fear in general |
| Knows | What they'd tell anyone who asked, in their terms; expertise as method | `knowledge/*.md`: beliefs about people and things, which can be wrong |
| Secrets | This scene's secrets, staged (shows, torn, opens, first), one piece per bullet | `gm.md`: the truth, what they don't know, how they behave cornered, what they do next |
| Attitude | How they start towards the player, what brings them round, their lines (prep, never terms) | Memories, written in play: how they feel about the player now |
| Contradiction | The one this scene presses, in a line | `private.md` "What you're torn between" |
| Relationships | Ties to others present, a phrase each, where they matter here | `knowledge/<Other>.md` for each person who matters |

Rules:
- **The card stands alone.** `v2-nomemory`, and any approach without `memory`, sees only the card. Under `v2`, the GM also gets each present character's `private.md` under "Who these people are (their lore)", and their opened knowledge docs and memories under "What people remember" ([src/lore/disclosure.ts](../../src/lore/disclosure.ts)).
- **The card says what's different about this scene; the lore holds the constants.** They must not disagree. What happened in play (the hand-off, memories) outranks both, as the brief already says.
- **Recurring characters' cards are neutral to earlier outcomes.** This is current practice, and worth keeping.

### 2.2 The cast card, field by field

**`look`** (two or three sentences)
- **For:** what a first glance shows here, with one physical habit the GM can repeat every few replies and the visible tells of this scene's secrets.
- **Good:** Moll's "one fist kept tightly closed" (the crown). Hobb's "right hand … under the table" and "a greasy string round his thick neck disappears into his shirt" (the token). Each is noticed once, and nobody has to point at it.
- **Avoid:** backstory, and anything a glance couldn't tell.

**`voice`** (one or two sentences)
- **For:** how they talk, the form of address, a verbal habit, one sample line in quotes, and what they never do.
- **Good:** Cob's "Cob don't talk to bluebottles", Tull quoting his orders word for word.
- **Avoid:** adjectives without a sample ("gruff, suspicious"). The sample line is the Alexandrian's *quote*: "glance at it and grok the voice".

**`wants`** (one to three short sentences)
- **For:** this scene's task, as a verb aimed at someone or something present, with a deadline where there is one. Add a second want that partly conflicts.
- **Good:** Moll's "To keep Cob … To keep the silver crown in her fist. To get the two of them out of the granary quarter before the gentleman comes back." These pull against each other exactly where the scene needs them to.
- **Avoid:**
  - the player's goal restated;
  - wanting to help the player;
  - pure avoidance ("not to hang"), which gives the GM nothing to play when nobody presses.

**`fears`**
- **For:** concrete things that could happen in this scene. At least one should be something the player can relieve, because that relief is the need's door.
- **Good:** Cob's "Being sent to the Mending House". Hobb's "His master, who has told him how patient the river is with men who talk."

**`knows`** (bullets)
- **For:** what they'd tell anyone who asked, in their own terms, with the edges of their knowledge. People know only names they've been told.
- **Write expertise as a method:** what they look for, and what they want before they'll say.
- **Avoid:**
  - the scene's answer;
  - anything they'd only say under pressure (that's a secret);
  - the author's reasons ("which is why the player should…").

**`secrets`** (bullets)
- **For:** this scene's secrets, one piece per bullet, in the order they'd give them, with a surface line first. See 2.6.
- **Avoid:**
  - a whole crime in one bullet;
  - the secret's trigger written as a timer ("once X turns up") with nothing for it to show first.

**`attitude`**
- **For:** how they start towards the player, what moves them (the need), their lines, and how they show the relationship. A form of address that shifts is ideal.
- **Rule:** the brief labels this field "your prep: they never spell it out". Write it as habits and thresholds, never as terms the character could recite.

**`enters`, `group`:** as now. For a group, the leader's want stands for the group; give one member a dissent or a voice ("one of whom talks").

**Two optional additions.** These are proposed; prose in `attitude` works today.
- **`torn`:** the contradiction, in the 2.5 pattern.
- **`ties`:** one phrase per relationship with someone else in the scene.

### 2.3 The lore entry, file by file

**`index.md`.** Links with "read when" labels. Disclosure opens a note when a decider judges its link relevant, so labels should name the words a player would actually use ("a big man with a bandaged hand", "the river stairs").

**`public.md`** (about ten lines). What anyone in Caerwyn could know or see:
- a line on role, the look and the constant habit;
- "Known for": a reputation, ideally including **two opinions that disagree** (Bakersfield);
- no secrets.

**`private.md`** (second person; about 40 lines; always in the GM's prompt under `v2`):
- **Opening paragraph,** three to five sentences:
  - their role;
  - the thing they take entirely seriously;
  - the one past event that acts now;
  - where they stand today.
- **Voice:** how they talk, "Sounds like:" with two lines, "Avoid:", and how they sound under strain.
- **What you want, and need:** the through-line, and the need under it.
- **What you're torn between:** the contradiction, in the 2.5 pattern.
- **What you fear.**
- **How you deal with people:** habits by kind of person (superiors, inferiors, children, the watch). Write levers as habits ("Give him a reason he can repeat to the Captain and he'll wait").
- **Lines you won't cross.**
- **Read when relevant:** knowledge links with trigger nouns.

**`gm.md`** (the GM's truth):
- **For a villain, open with the five-line kit:** Goal / Plan / Resources / Limits / Tell (the Angry GM's "goal, a plan, and resources" plus "some sense of the villain's limits", and one detail).
- **The truth:** what they did or know that others don't.
- **What they don't know:** the fuses. Sallow's version of this section is the model.
- **Their secrets, in order:** what shows, what opens them.
- **Under pressure:** the escalation ladder, what they do cornered, and their limits.
- **What they do next if nobody stops them,** keyed to what the player might have done (Dungeon World's grim portents). This matters most for anyone offscreen.
- **How they could change:** what would turn them.

**`knowledge/<Other>.md`:** see 2.4.

**`memories/`** (written in play): as now. When a relationship changes, the reviewer should also edit the matching knowledge doc (1.8).

### 2.4 A relationship that pulls (`knowledge/<Other>.md`)

Write it in the second person, as belief, not truth, in four to eight bullets:

```markdown
# <Name, as this person calls them>
- Who they are to you, in a line.
- What happened: one or two specific incidents, with a detail that sticks.
- How you feel about them, and what you don't admit.
- What you want from them, or for them, now.
- What you believe about them that might be wrong.
- What you could do to them, or they to you.
- What would change your mind.
```

Put the trigger nouns in the summary and the link label. Write the other side too, differently.

**The model in our lore: Kell and Cob.** Same incidents, opposite readings, and neither is told the other's.
- Kell ([knowledge/Cob.md](../../lore/Cast/Sergeant%20Agnes%20Kell/knowledge/Cob.md)): "You've taken him up twice for pilfering, and twice let him go rather than send him to the Mending House." "He's not a bad lad. You've thought for a while he'd be a good one, given boots that fit and a hot dinner."
- Cob ([knowledge/Kell.md](../../lore/Cast/Cob/knowledge/Kell.md)): "You reckon her notebook is a list of kids for the Mending House." "She's caught you twice and let you go twice. You don't know why, and you don't trust it."

A scene can be built on that pair alone.

**A rewrite: Kell's Nan Quill.** Today the relationship sits inside [knowledge/The Docks.md](../../lore/Cast/Sergeant%20Agnes%20Kell/knowledge/The%20Docks.md): "Twenty years ago, as a constable of nineteen, you tried to arrest a pickpocket in the Rat, and Nan put you out through the door. Through it, not the doorway. You haven't been back. You've been told you owe for the door." It has a great incident, but no want, no lever and no wrong belief, and it only opens when the docks come up. Proposed `knowledge/Nan Quill.md`:

```markdown
---
summary: "What you think of Nan Quill of the Drowned Rat: the door she put you through twenty years ago, the four shillings and sixpence she says the watch owes, her house rules, why you've never been back, and what you'd give to be served there like anyone else."
---
# Nan Quill
- Landlady of the Drowned Rat, halfway down the river stairs. Sixty, square, forearms like hams, a cudgel she calls Manners.
- Twenty years ago, as a constable of nineteen, you tried to arrest a pickpocket in her house. She put you out through the door: through it, not the doorway. She had it rehung and says the watch owes her four shillings and sixpence.
- You've never been back. You tell yourself it's rule four (no watch on duty). It's the door.
- You'd like, once, to walk into the Rat and be served like anyone else. You'd never say so.
- You believe she'd put you out again, given half a reason.
- Rule four is a lever both ways: you're lent, not on duty, which is true, and you'll say so if she asks.
- Pay for the door and she might sell you a pint of something.
```

The belief is the fuse. Kell doesn't know what Nan's card says: Nan would sooner see Hobb "taken quietly up the stairs by the watch" than see the gentleman's sort come for him. The two can meet in the middle without either knowing why.

### 2.5 A contradiction the GM can play

```markdown
**<X>, but <Y>.**
- It shows when: <a trigger the player can create>.
- It helps the player when: <two ways>.
- It bites when: <two ways>.
- The scene forces the choice when: <a pressure, beat or cue>.
```

Use Fate's test: if you can't list two ways each, it's a trait, not a contradiction. Our lore already has good material:
- **Nan:** rules are sacred, but gossip is for sale. She never sees the conflict, and the comedy rides on it.
- **Tull:** "not paid to think", but decent. He'd share his pie with anyone hungrier, and he'll wait if given words he can repeat to the Captain.
- **Sallow:** "careful with paper and careless with everything else: coins, smells, servants, children". This one is also the plot: it is how he gets caught (4.3).

Kell's and Hobb's contradictions are written out in 4.1 and 4.2.

### 2.6 A secret that comes out well

**With today's `secrets: string[]`**, write a surface line first, then the pieces in order:

```ts
secrets: [
  "Shows: <what doesn't fit>. Torn: <what they're torn between>. Opens: <what truly reaches them>. First: <the piece they give first>.",
  "<piece one, in their words>",
  "<piece two> (only if asked straight; it costs them most)",
],
```

**A proposed type.** This is pacing.md's `SecretSpec` plus three fields:

```ts
type SecretSpec = string | {
  text: string;      // one piece, in their words
  ask?: string;      // the question it answers
  shows?: string;    // what doesn't fit, before it's told
  stakes?: "trivial" | "guarded" | "dangerous" | "ruinous";
  torn?: string;     // what they're torn between
  opens?: string;    // what truly reaches them: their need answered, or proof (prep, never terms)
  first?: string;    // the piece they give first
  carries?: string;  // the words an essential depends on
};
```

**Worked example: Moll's crown.** Her current secret is good; this only makes its parts visible.
- **ask:** who paid her to lie.
- **shows:** one fist kept tightly closed; her eyes keep going to the yard gate.
- **stakes:** dangerous.
- **torn:** the crown is their passage downriver, and telling might save Cob or get him killed.
- **opens:**
  - a believable way to keep Cob safe and out of the Mending House;
  - her lie caught out in front of him.
- **first:** "A gentleman. Paid me to say it."
- **text:** a gentleman with a silver-topped cane and a wheat-ear signet ring paid her a silver crown at first light to say she'd seen the clerk jump. The big man with him, who had a bandaged hand, called him "Master Sallow".
- **carries:** "called him 'Master Sallow'". Without it the skeptic's case never closed (F11).

Three authoring rules from the failures:
- **One success line per holder.** F8's authored line opened both children at once.
- **A success line holds one piece,** not the whole secret. F1's Insight success carried the coin, the cane, the ring and the name, on a decision made at low confidence. When the secret carries an essential, though, its load-bearing words belong in that piece: F11 is the opposite failure.
- **A structural truth never lives in one secret only.** Check each essential's `placedWith` against the cards.

---

## 3. Checklist

For an author, human or AI, before a character goes into a scene:

1. **Purpose, behind the screen.** One sentence on why they're in the scene. It goes in an author note or an essential, never in `wants` or `knows`.
2. **Two wants they act on now.** Each is a verb aimed at someone or something present. The two partly conflict, neither is "help the player", and both differ from the player's goal, even if only subtly.
3. **A need under the want.** What would open them, and something the player could give in this scene.
4. **One contradiction.** "X, but Y; shows when Z", with two ways it helps the player, two ways it bites, and a pressure that forces the choice.
5. **Handles.**
   - At most three sentences of look, with one physical habit.
   - A voice line with a sample and a form of address.
   - The thing they take entirely seriously.
   - An entrance that shows them in action.
6. **No biography.** Every line about the past must change what they do today. One event that acts now is plenty.
7. **Ties.**
   - Anyone who recurs has two or more ties to others in the arc.
   - Each tie has an incident, a want now, a lever and a belief that may be wrong.
   - The other side is written too, differently.
8. **Secrets.**
   - One piece per bullet, in their words, in the order they'd give them.
   - A surface line: what shows, what it costs, what opens it, what comes first.
   - The load-bearing words marked if it carries an essential.
9. **Nothing the scene needs lives only in one secret,** or only in a companion's head.
10. **Helpers.**
    - Expertise is a method and an appetite, not the answer.
    - There's an in-fiction reason they can't solve it.
    - They act on their own errands, never on the player's behalf.
11. **Villains.**
    - The kit: goal, plan, resources, limits and one tell.
    - What they do next if nobody stops them, scene by scene.
    - A shadow that reaches the player before they do.
12. **Card and lore.** The card stands alone and says what's different here; the lore holds the constants; they don't disagree.
13. **House style.** They're funny by being serious: whatever they take seriously is followed through, and so is the bill.

Two quick tests:
- Read the card as the character: what do you want from the next person who speaks to you? If you can't say, rewrite the wants.
- Ask: if the player never arrived, what would this person do in the next hour? If nothing, give them an errand.

---

## 4. Three of our characters against the checklist

### 4.1 Sergeant Agnes Kell

**Files.**
- Three cards: `scenes/hanged-clerk.ts`, `scenes/drowned-rat.ts` and `scenes/heron-warehouse.ts`. `scenes/interludes.ts` reuses the first.
- `lore/Cast/Sergeant Agnes Kell/`: private, public, gm and eight knowledge docs.

**What works.**
- **Unmissable handles:** "Stands very still and watches people's hands", the pencil stub sharpened with a clasp knife, "Noted.", "investigator".
- **A ghost that acts now:** Prout's visit three days ago. gm.md holds the payoff, which only Sallow can deliver: "He went through the proper channels, Sergeant. I am the proper channels."
- **Lines the GM can play:** "On what evidence?", then an arrest under protest with her objection written down.
- **The Kell–Cob pair** (quoted in 2.4) is the best relationship in the lore.
- **A doc that ends on a pull towards the arc's next scene.** The Captain doc ends: "A case like that has to go to the King."

**What to change.**

**K1. Her expertise is written as the answer.**
- **Now** (`hanged-clerk.ts`, `knows`): "Close up (once he's down, or someone gets her up to him), her eye will catch what a hanging doesn't make: a thin, level cord mark low round the neck under the noose's slanting burn, a swelling under the hair at the back of the skull, and palms with no rope burn on them. She'll point and ask the player what they make of it rather than say it for them."
- **Why:**
  - The answer to the scene's first question sits in the partner's head, and the GM delivered it from the cobbles (F2).
  - The signs already live in the `examine-body` success text and the `not-suicide` essential.
  - This is Sly's tag-along trap: she is "clearly the right person for a particular job".
- **Rewrite:** "She has cut down hanged men before, and won't say how one died until she's had him close: she wants him down, or someone up there, before she'll swear to anything. Up close she looks at the neck, the back of the head and the hands, in that order, and asks the investigator what they see."

**K2. Her want is the player's goal.**
- **Now:** "To do this properly: find out what really happened to Prout and write it down true, before the dead-cart comes at noon and he goes in the ground as a suicide."
- **Why:**
  - It is the scene's premise, nearly word for word.
  - A partner who wants exactly what the player wants competes for the scene. She ran the interview herself (F1, turn 5) and asked for the conclusion twice (F10).
  - The Alexandrian's fix is a want "subtly different".
- **Rewrite:** "To put nothing in her notebook she couldn't swear to, and to see Prout off that hook as anything but a suicide before noon. To find out whether the King's investigator is worth her notebook. To get the kids through this without the Mending House, though they won't say a word while she's standing there."

**K3. Her standards are a wall with no door.**
- **Now:**
  - Attitude: "She won't arrest anyone on a hunch: told to, she asks 'On what evidence?' first…".
  - The motive beat's direction: "Kell tests it with questions and doesn't make it for them."
- **Why:**
  - With no stated bar, the GM keeps raising it: "Silvertop is not yet a name, investigator", and the case never closed (F11).
  - After the case was made: "Put it together for me" (F10).
- **Rewrite** (add to `attitude`, and to her private.md under "How you deal with people"): "She tests a case once, at its weakest point, and writes it down if it holds. A description a witness will swear to ('the Purveyor's man with the silver-topped cane') goes in her notebook as readily as a name."

**K4. Her contradiction is in the lore but never named.**
- **Now:**
  - private.md: "You want things done properly: the truth found out and written down true."
  - gm.md: "She told him to take it to the palace and forgot him."
- **Why:**
  - Unnamed, it plays as procedure and nothing else.
  - Named, it carries the arc. At the Heron her book lets her arrest a gentleman only if she sees the crime herself, and Sallow's "I am the proper channels" lands on it.
- **Rewrite** (a new private.md section):

  ```markdown
  ## What you're torn between
  You believe in the proper channels: proper words, proper forms, nothing written down you couldn't swear to. Three days ago the proper channel was "take it to the palace", and you said it to Wendell Prout. You still believe in the book. You're less sure it believes in you.
  - It shows when someone asks you to bend a rule for a good reason. You won't, and saying so costs you something.
  - It helps the investigator: your word is near enough writing, a corporal will wait on it, and a gentleman caught in the act is yours to arrest.
  - It bites: you won't lie for them, take a bribe, arrest on a hunch, or let anyone hurt a witness.
  ```

**K5. Her secret has no surface and fires on a timer.**
- **Now** (`secrets`): "…She'll admit it if the player asks why she cares, or once the false entries turn up."
- **Why:** it fired five turns late while the player was behind the water butt, and it was told twice (F9, F10). It needs a tell before it and a single telling.
- **Rewrite:** "Shows: she knew Prout by sight, and goes very still at 'false entries'. Torn: she sent him away, by the book. Opens: the page, or the investigator asking why this one matters to her. First: 'I'd met him.' Then, once, in her own words: the visit, and 'I should have listened.'"

**K6. Her form of address could carry the relationship.**
- **Now:** "Calls the player 'investigator'."
- **Rewrite:** "Calls the player 'investigator'. When she disapproves it's 'the King's investigator', in full, and nothing else in her face changes."
- **Why:** this follows Kim's "officer" and "detective". It shows where the two of them stand without a word of comment, and it can't coach.

**K7. Her best relationship is buried in a place doc.**
- **Now:** the Nan Quill story sits inside knowledge/The Docks.md (quoted in 2.4).
- **Rewrite:** the `knowledge/Nan Quill.md` drafted in 2.4. Smaller fixes in the same vein:
  - Give knowledge/Corporal Tull.md one shared incident (it has a good lever already).
  - Give knowledge/Moll.md a want now. At the moment it is description only.

**K8. The interlude makes her the lead's carrier.**
- **Now** (`interludes.ts`):
  - `placedWith: ["Sergeant Kell", "gossip in the town"], carriers: ["kell"]`;
  - the direction says the lead can reach the player through "a word from Kell".
- **Why:** a companion told to hand over a lead is the mouthpiece pattern.
- **Rewrite** (her interlude cast note): "You're going down the river stairs at dusk after the big man with the bandaged hand, with the investigator or without; you'd rather not walk into the Rat alone. Say where you'll be, once." It's her errand, which the player can join, so it's initiative rather than coaching.

**K9. Three cards and a private.md say the same things, slightly differently.**
- **Now:**
  - Her voice is restated on all three cards.
  - Only the Heron card has "Whispers badly".
  - Only the Rat card says she won't lie and calls herself "lent".
- **Why:** under `v2` the private.md sits beside the card, so every restatement costs tokens and invites a disagreement.
- **Rewrite:**
  - Look, voice and lines live in private.md.
  - Cards keep this scene's wants, knows, secrets and attitude, plus one line of voice for `v2-nomemory`.
  - In code, recurring cards could be built from the lore plus a scene delta, as `interludes.ts` already does with `...hangedClerk.cast.find(...)`.

### 4.2 Big Hobb Mallory

**Files.**
- Cards in `scenes/drowned-rat.ts` and `scenes/heron-warehouse.ts`.
- There is **no** `lore/Cast/Big Hobb Mallory/`.
- He is described in `lore/Places/The Drowned Rat (truth).md`, and from other people's side in Cob's `knowledge/The Big Cove.md` and Sallow's `knowledge/Hobb.md`.

**What works.**
- **Tells in the look:** "His right hand is wrapped in a tarry rag, and he keeps it under the table. A greasy string round his thick neck disappears into his shirt." The hand is the surface of the secret, and the string is the surface of the token.
- **A contradiction in the voice:** "Says as little as he can, then far too much all at once. When frightened he goes very quiet and very still, like a dray-horse in thunder."
- **The need, written as prep:** "Kindness is harder for him to bear than threats, because it makes him want to tell." This is want versus need at its best, and it's the non-violent key.
- **Every way in is a relationship.**
  - Nan is fond of him: he's carried her barrels since he was Cob's size.
  - Dilly has fed him since he was a lad.
  - Arlo wants his chair.
  - Cob saw him in the loft.
- **He is someone else's fuse.** Sallow believes "He's too frightened of you to talk, and too slow to think of anything else."

**What to change.**

**H1. He has no lore, so nothing of him carries.**
- **Now:**
  - `lore/Cast/index.md` doesn't list him.
  - The Drowned Rat (truth).md sends the GM to "The cast — Hobb, Nan Quill and the others: what each knows", where there is nothing.
- **Why:**
  - He matters in all three scenes (named only by his hand in the first, on stage in the other two), and the arc turns on what he does.
  - Under `v2` a character's private.md is always in the prompt. Hobb's voice and fears exist only on two cards that differ.
- **Rewrite:** a folder, drafted below.

**H2. One secret holds the whole crime, so one success dumps it.**
- **Now** (first secret): "His master is Master Sallow of the Royal Purveyor's office; … The Master struck him with the head of his cane and strangled him with a cord while Hobb held his arms, then had Hobb haul him up on the sack hoist … At first light they went back to look, and the Master paid a granary girl a silver crown…"
- **Why:** who, how and the cover-up arrive as one block. That's the shape of F1 and F8. The confession beat says "one thing at a time"; the card should be written that way too.
- **Rewrite:** a surface line, then the pieces in the order he'd give them.
  - "Shows: he won't wrestle tonight; his right hand stays under the table; he flinches at the door, and says 'Master' and stops himself."
  - "First, haltingly: last night after the midnight bells he held a clerk's arms in the granary tally loft while the clerk was struck and strangled, then hauled him up on the sack hoist 'so it looks like he did it himself'. The rope took the skin off his palm. 'I only held him. I only held the rope.'"
  - "Who, which costs him most: he says 'the Master', and gives the name only when asked straight: Master Sallow of the Royal Purveyor's office, who struck with the head of his cane and used the cord."
  - "After, only if asked: at first light they went back to look, and the Master paid a granary girl a silver crown to say she'd seen the clerk jump."
  - Then the Heron, then the routine and the token, which are already separate bullets.

**H3. His wants are all avoidance.**
- **Now:** "To forget last night. Not to hang. To get through tonight's loading without his master looking at him. For his mum in the Shambles never to know."
- **Why:**
  - Four things not to happen give the GM nothing to play when nobody presses him.
  - His one active want ("He'd give a great deal to put it right") is filed as a secret.
- **Rewrite:** "Tonight: to lose every heron penny at Dilly's table, because he can't bear to keep them; to drink until he stops seeing the clerk's stockinged feet; to be at the river door at the eleventh bell so his master never looks at him twice. Underneath, to put it right, if anyone could show him a way that isn't the noose."
- **Bonus:** the first want is also a clue carrier. Losing heron silver on purpose is how Dilly and Nan came to have it.

**H4. The key exists in Kell's lore, but nothing joins them up.**
- **Now:**
  - Hobb: "He'd give a great deal to put it right, and can't see how: the watch would hang him and the Master would drown him."
  - Kell (knowledge/The Law.md): "People who might hang alongside the guilty can sometimes be brought to swear for the Crown instead."
- **Why:**
  - The third way out is authored, but only Kell knows it, and nothing tells the GM it's the key to Hobb.
  - FINDINGS says "Put 'clever solutions' in a character's secrets"; this one is in the wrong character's.
- **Rewrite:**
  - Hobb's gm.md, "What opens him": "A believable way to put it right that isn't the noose: swearing for the Crown (Kell knows the law), or someone who'll see his mum right whatever happens to him. He doesn't know a man can swear for the Crown."
  - The card's attitude: "…until someone shows him a way out that isn't the noose or the river."

**H5. His contradiction isn't pressable yet.**
- **Now:** it's implied across look, voice and attitude.
- **Rewrite** (attitude, or a `torn` line): "The strongest man on the river stairs, and the most frightened man in the Rat. Threats he can stand: he's been threatened all his life. Kindness undoes him. Push him clumsily and he bolts, and frightened men run to their masters."
- **The scene already has the press:** Arlo's third challenge. If he wrestles, the hand shows. If he refuses, he gives up the chair in front of everyone.

**H6. His ties are written from everyone's side but his.**
- **Now:** Nan, Dilly, Arlo, Cob and Sallow each know something about him. His card mentions only "his master" and "his mum".
- **Rewrite:** knowledge docs from his side (below), and one line on the card: "Mrs Quill, whose barrels he's carried since he was Cob's size. Dilly, who feeds him and is winning his silver. Arlo, who could have the chair and welcome, if it didn't mean showing the hand. Nan's loud little pot-boy, whom he once gave the end of his pie; he doesn't know the boy was in the loft."

**Draft lore folder** (`lore/Cast/Big Hobb Mallory/`).

`private.md`:

```markdown
---
summary: "Who you are as Big Hobb Mallory, dock-porter and champion of the Drowned Rat: your slow, polite voice, what you want tonight and what you need, what you're torn between, how you deal with people, and links to what you know of the Master, your mum, Mrs Quill, Arlo and the Heron."
type: "character"
visibility: "private"
readers: ["character:hobb"]
character: "hobb"
---
# Big Hobb Mallory

You are Hobb Mallory, Big Hobb: dock-porter, and champion of the Drowned Rat at the arm-wrestling these eleven years. You carry two sacks where other men carry one, you call the landlady "Mrs Quill", and every week, without fail, your wages go to your mum in the Shambles. For a month now you've done night work for a gentleman, at double pay in new silver, and he called you reliable. Nobody had called you anything before.

Last night you held a clerk's arms in the granary tally loft while the Master killed him, and then you hauled on the rope. You've been sick twice since.

## Voice
- Slow, low and polite: "sir", "missus", "Mrs Quill", and "Master", which you can't stop saying.
- You say as little as you can, then far too much all at once.
- Sounds like: "Not tonight, Arlo." / "I only held him. I only held the rope."
- Frightened, you go very quiet and very still.
- Avoid: menace. You're the size of a door, and you'd sooner be furniture.

## What you want, and need
Tonight you want to lose every heron penny at Dilly's table, drink until you stop seeing the clerk's feet, and be at the river door at the eleventh bell so the Master never looks at you twice. What you need is to put it right, and you can't see how: the watch would hang you, and the Master would drown you.

## What you're torn between
The strongest man on the river stairs, and the most frightened man in the Rat. Threats you can stand. Kindness undoes you, because it makes you want to tell.

## How you deal with people
- Polite to everyone, and a fighter to no one unless you're cornered. Then you're a door falling on somebody.
- You can't lie. You say less instead, and then too much.
- You do what the Master says. You've always done what someone says.

## Read when relevant
- [The Master](knowledge/The%20Master.md) — read when Master Sallow, the Purveyor's office, the gentleman, the cane, the loft or night work comes up
- [Your mum](knowledge/Mum.md) — read when his mum, the Shambles, home or his wages come up
- [Mrs Quill](knowledge/Mrs%20Quill.md) — read when Nan, her rules, Manners or the Rat comes up
- [Arlo and the chair](knowledge/Arlo.md) — read when arm-wrestling, the champion's chair or Arlo comes up
- [The Heron](knowledge/The%20Heron.md) — read when the Heron, the wharves, heron pennies, the token or tonight's loading comes up
```

`knowledge/The Master.md` (a sketch):

```markdown
# The Master
- Master Sallow, of the Purveyor's office. You call him "Master"; the porters all do, never to his face.
- He picked you out on the wharf a month ago and called you reliable. Double pay, new silver, and a gentleman's trust.
- In the loft he asked the clerk nicely, then not nicely. Then the cane. You held the clerk's arms because he said to.
- He's told you how patient the river is with men who talk. You've never been sure he meant it as a threat, and never sure he didn't.
- What you want from him now: never to be looked at again.
- You believe he'll see you right if you keep your mouth shut.
```

The truth behind that last belief belongs in `gm.md`, not here: Sallow thinks Hobb is furniture.

`gm.md` should contain:
- **The truth, staged:** the loft, then the name, then the girl, then the Heron, then the way in.
- **What he doesn't know:**
  - that Cob was in the loft;
  - that Nan has guessed;
  - that a man can swear for the Crown;
  - what Sallow really thinks of him.
- **What opens him** (H4).
- **What he does next:**
  - Frightened out of the Rat, he runs to the Master (as now).
  - As the player's man inside, his nerve holds until the Master looks at him.
  - Taken in, he tells all of it in the cells.
- **How he could change:** he swears for the Crown at the Heron, in front of the Master.

The other knowledge docs (`Mum.md`, `Mrs Quill.md`, `Arlo.md`, `The Heron.md`) follow the 2.4 pattern. Mum's incident is the weekly wages; the belief she holds about him is the one he can't bear to break.

### 4.3 Master Josiah Sallow

**Files.** His card is in `scenes/heron-warehouse.ts`, and his lore is `lore/Cast/Master Josiah Sallow/` (private, public, gm and four knowledge docs). He is offscreen in the first two scenes.

**What works.**
- **A voice line that does the whole character:** "I never threaten anyone. I describe what will happen, in order."
- **A contradiction that is also the plot:** "You're careful with paper and careless with everything else: coins, smells, servants, children." That is how he's caught:
  - Moll's crown is office silver;
  - Hobb is paid in heron pennies;
  - the goblins know his lavender;
  - he kicked the dog.
- **Wrong beliefs as fuses:**
  - "He's too frightened of you to talk";
  - "a page nobody can find is a page nobody will read";
  - goblins "can't tell one longlegs from another".
  
  gm.md's "What he doesn't know" is the best section in the lore.
- **The Angry GM's villain kit, complete:**
  - goal: the chain;
  - plan: the racket;
  - resources: the office, the Captain, the Crakes, Hobb, money;
  - limits: "You don't fight. You have people for that.";
  - one detail: the lavender, which is also his tell.
- **A shadow that reaches the player before he does:**
  - the flower smell Cob noticed in the loft;
  - the crown in Moll's fist;
  - the name on Tull's order;
  - the heron pennies in Nan's jar.

**What to change.**

**S1. He has no moves while he's offscreen.**
- **Now:** gm.md says what he did and what he is. Nothing says what he does next.
- **Why:**
  - The Angry GM: "villains are on-screen a lot more than you think", and "the villain's ability to adapt is what creates dynamic adventures".
  - Dungeon World pushes dangers "towards resolving a grim portent".
  - Two scenes pass before he appears, and the world should move.
- **Rewrite** (a new gm.md section):

  ```markdown
  ## What he does next
  - **If Prout goes to the cold room as a murder:** the Captain mentions it over a hamper by evening. Sallow sends the Crakes along the river stairs to ask who's been asking after a big man with a bandaged hand. They can be in the Rat before the tenth bell.
  - **If anyone shows a wheat-ear crown or says "Silvertop":** he sends his lantern-boy to find out which granary child is carrying office silver.
  - **If Hobb runs to him:** the true book goes into oilcloth and aboard the barge (as the Heron card has it).
  - **If nothing troubles him:** he initials tonight's page at the midnight bell, and in the morning rides at the head of the Purveyor's wagons in the procession.
  ```

**S2. Nothing gives the player a lever that isn't dice or a fight.**
- **Now** (private.md):
  - Wants: "You want the Royal Purveyor's chain …, money enough never to be 'under' anyone again, and to be thanked."
  - Fears: "…being laughed at, and dogs."
- **Why:**
  - He "will never admit the murder", and cornered he goes to the Crakes.
  - A villain the player can only out-roll or out-fight wastes the house style, where "pride, officialdom and logic followed off a cliff do the rest".
- **Rewrite** (a new private.md section):

  ```markdown
  ## What you're torn between
  You'd never admit to a crime, and you can't bear to be thought incompetent. Get your arrangements wrong in front of you ("lost to goblins, was it? Careless of somebody") and you'll correct the record, in detail, before you can stop yourself. Nothing is lost on your roads.
  - It helps them: wounded pride makes you talk, and in front of witnesses.
  - It bites: you remember who made you do it.
  ```

**S3. His relationships stop at his instruments.**
- **Now:** knowledge docs for Prout, Hobb, the Heron and the goblins.
- **Why:** the people who could undo him, or whom he needs, appear only in passing:
  - Sir Gilbert, whose letters he opens and whose chain he wants;
  - Captain Bunce, whom he keeps in hampers;
  - the King, whom he thinks signs nothing.
- **Rewrite:** add `knowledge/Sir Gilbert.md`, `knowledge/Captain Bunce.md` and `knowledge/The King.md`. The King doc carries the fuse:

  ```markdown
  # The King
  - King Aldren signs nothing that might upset anyone, and you've made yourself someone it would upset him to lose.
  - He remembers how people take their tea. You've always thought that a charming weakness.
  ```

  The arc's hook is that the King remembered how Prout took his tea and sent an investigator.

**S4. His public face has only one opinion.**
- **Now** (public.md): "At the palace he's known as a most obliging gentleman." "Master Sallow has been very brave about it."
- **Why:** if everyone agrees, the player has nothing to weigh (Bakersfield).
- **Rewrite** (add to "Known for"): "The porters call him 'the Master', never to his face. The palace kitchens grumble about his wheat-ear silver, which they can't pinch. Captain Bunce calls him 'a very obliging gentleman'."

**S5. His fear tell isn't on the card.**
- **Now:**
  - The Heron card's look: "He wears so much lavender water that you smell him a full minute before you see him."
  - Its voice: "The more frightened he is, the more polite he gets."
  - gm.md: "His tell is the lavender. The more frightened he is, the more he dabs." private.md says the same.
- **Rewrite** (the card's voice): "The more frightened he is, the more polite he gets, and the more lavender he dabs."
- **Why:** under `v2` the GM sees it in private.md, but the card is all `v2-nomemory` sees. It's a one-clause fix, and the climax is where the tell should rise.

**S6. gm.md is long prose for a fast GM.**
- **Rewrite:** open it with the five-line kit:
  - **Goal:** the Royal Purveyor's chain, and to be thanked for it.
  - **Plan:** the "lost to goblins" racket through the Heron, and an Assembly short of grain that he saves.
  - **Resources:** the office's signature, the Captain, the Crakes, Hobb, heron silver.
  - **Limits:** never fights himself; never goes down the river stairs; careful with paper.
  - **Tell:** lavender.
  
  Then the existing sections, then "What he does next" (S1).

---

## Implications beyond authoring

These are small, optional changes; none is needed to use the template.
- **Card rendering.** Show the optional `torn` and `ties` fields if present, and object secrets (2.6). The brief's secret label could add "what shows comes first".
- **Recurring characters.** Build cards from the lore plus a scene delta, so one character has one voice (K9).
- **Memory reviews.** When a relationship changes, edit `knowledge/<Other>.md` as well as saving a memory (1.8).
- **Interludes.** Give Kell an errand, not a lead to deliver (K8).
- **Eval items.** These follow from the critique:
  - a helper states a conclusion the player hasn't reached (F2-style);
  - a companion asks for the same conclusion twice (F10);
  - a secret's load-bearing words are missing from a reveal (F11).

---

## Sources

**The Alexandrian (Justin Alexander)**
- [Universal NPC Roleplaying Template](https://thealexandrian.net/wordpress/37916/roleplaying-games/universal-npc-roleplaying-template)
- [Quick NPC Template](https://thealexandrian.net/wordpress/50635/roleplaying-games/quick-npc-template)
- [Roleplaying for the Beginning GM](https://thealexandrian.net/wordpress/52707/roleplaying-games/roleplaying-for-the-beginning-gm)
- [Random GM Tip – Memorable NPCs](https://thealexandrian.net/wordpress/43539/roleplaying-games/random-gm-tip-memorable-npcs)
- [Ptolus: Running the Campaign – NPC Conversation Agendas](https://thealexandrian.net/wordpress/52079/roleplaying-games/ptolus-running-the-campaign-npc-conversation-agendas)
- [Random D&D Tip: Reactions & Relationships](https://thealexandrian.net/wordpress/50021/roleplaying-games/random-dd-tip-relationships-reactions)
- [Rulings in Practice: Gathering Information, Part 2 (tiered information)](https://thealexandrian.net/wordpress/39653/roleplaying-games/rulings-in-practice-gathering-information-part-2-improvisation-and-tiered-information)
- [Rulings in Practice: Social Skills](https://thealexandrian.net/wordpress/43360/roleplaying-games/rulings-in-practice-social-skills)
- [The Three Clue Rule](https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule)

**Sly Flourish (Mike Shea)**
- [Revealing Secrets](https://slyflourish.com/revealing_secrets.html)
- [Secrets Serve You](https://slyflourish.com/secrets_serve_you.html)
- [The Lazy GM's Resource Document](https://slyflourish.com/lazy_gm_resource_document.html)
- [Characters from TV shows](https://slyflourish.com/characters_from_tv_shows.html)
- [Tag-along NPCs](https://slyflourish.com/tag-along_npcs.html)

**The Angry GM**
- [What Even Is an NPC (And How to Do Them Right)](https://theangrygm.com/what-even-is-an-npc/)
- [Angry's Two-Note NPC](https://theangrygm.com/angrys-two-note-npc/)
- […But You Can't Make Them Care](https://theangrygm.com/but-you-cant-make-them-care/)
- [Why Are There So Many People in the Angryverse?](https://theangrygm.com/so-many-people/)
- [Villains and Characters: Villains AS Characters](https://theangrygm.com/villains-and-characters-villains-as-characters/)
- [How to Actually Play a Character](https://theangrygm.com/how-to-actually-play-a-character/)
- [The Joy of Secrets](https://theangrygm.com/the-joy-of-secrets/)

**Games**
- Dungeon World: [The GM](https://roll20.net/compendium/dw/Rules:The%20GM), [Fronts](https://roll20.net/compendium/dw/Fronts)
- [Blades in the Dark SRD](https://raw.githubusercontent.com/amazingrando/blades-in-the-dark-srd-content/master/Blades-in-the-Dark-SRD.md)
- Fate Core SRD: [Making a Good Aspect](https://fate-srd.com/fate-core/making-good-aspect), [Your Character Idea](https://fate-srd.com/fate-core/your-character-idea), [Creating and Playing the Opposition](https://fate-srd.com/fate-core/creating-and-playing-opposition), [Faces and Places](https://fate-srd.com/fate-core/faces-places)
- [Fiasco (Wikipedia)](https://en.wikipedia.org/wiki/Fiasco_(role-playing_game))
- [Monsterhearts (Wikipedia)](https://en.wikipedia.org/wiki/Monsterhearts)
- [Smallville Roleplaying Game review, RPGamer (archived)](https://web.archive.org/web/20140102195829/http://www.rpgamer.com/savingthrow/reviews/rev-SV.html)
- [Kim Kitsuragi, Disco Elysium wiki](https://discoelysium.wiki.gg/wiki/Kim_Kitsuragi)

**Story craft**
- Robert McKee, *Story* (1997). The quotes are from the book and weren't re-checked online. McKee's lessons: [Character Traits vs. Contradictions](https://mckeestory.com/character-traits-vs-contradictions/), [Character Dimensions](https://mckeestory.com/how-to-create-and-develop-character-dimensions/), [Does a Character Need to Change in a Comedy?](https://mckeestory.com/does-a-character-need-to-change-in-a-comedy/), [Conscious Desire, Unconscious Desire and Need](https://mckeestory.com/whats-the-difference-between-conscious-desire-unconscious-desire-and-need/)
- E.M. Forster, *Aspects of the Novel* (1927); see [Character (arts)](https://en.wikipedia.org/wiki/Character_(arts))
- K.M. Weiland: [Want vs. Need](https://www.helpingwritersbecomeauthors.com/character-arcs-3/), [The Ghost](https://www.helpingwritersbecomeauthors.com/character-arcs-4/), [The Characteristic Moment](https://www.helpingwritersbecomeauthors.com/character-arcs-5/)
- [Stanislavski's system (Wikipedia)](https://en.wikipedia.org/wiki/Stanislavski%27s_system)

**AI agents**
- [Park et al. 2023, Generative Agents](https://arxiv.org/abs/2304.03442)
- [Li et al. 2024, Measuring and Controlling Instruction (In)Stability in Language Model Dialogs](https://arxiv.org/abs/2402.10962)

**Ours**
- [pacing.md](pacing.md), [pacing-failures.md](pacing-failures.md), [gm-techniques.md](gm-techniques.md), [dc-guidance.md](dc-guidance.md), [scene-sources.md](scene-sources.md)
- [experiments/absurdity.md](../experiments/absurdity.md), [FINDINGS.md](../FINDINGS.md)
- [prompts/tone-comic.md](../../prompts/tone-comic.md), [prompts/gm.md](../../prompts/gm.md)
