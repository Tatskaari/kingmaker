# Authoring: scenes, characters, world and lore

How to write prep the GM runtime plays well. The research behind each section is linked; this page is the working distillation.
- [research/characters.md](../research/characters.md)
- [research/worldbuilding.md](../research/worldbuilding.md)
- [research/pacing.md](../research/pacing.md)
- [research/gm-techniques.md](../research/gm-techniques.md)
- [FINDINGS.md](../FINDINGS.md)

**The one idea underneath all of it:** prep situations, not plots. Write people who want things, a world with causes, and the ways a scene can end. Then let the player find their own way through, with the GM improvising in between.

## Scenes (`scenes/*.ts`)

A scene is GM prep for one place and one situation: a dramatic question, the people in it, a few beats, and the ways it can end.

- **Premise.** One question the scene answers, e.g. "Can the player find the big man with the bandaged hand and get out of him what he knows?"
- **Beats.** Three to five situations the scene passes through. Each has a direction (what it's for, how to play it), cast notes (what people are after here), and one **pressure**: what the world does if things stall. Pressures come from fronts or clocks (the noon dead-cart, the ebb).
- **Routes** (transitions) are prose observations of the fiction, not commands:
  - **attempt:** the player tries something, maybe with a roll and a player-facing reason;
  - **cue:** the world acts, for pacing;
  - **outcome:** something has happened.

  Mark scene-ending attempts as such in their `when`. Roll only where an attempt could really go either way.
- **Success and failure lines.**
  - A success line holds **one piece**, not the whole secret, and there is one success line per holder. If the secret carries an essential, its load-bearing words go in that piece.
  - A failure costs or complicates and keeps the story going. It never takes back what's established.
- **Essentials:** what the player must come across for the endings to be reachable. Say where each was placed, who carries it, and what it unlocks. **No structural truth lives in only one secret** or one companion's head; give it three ways in.
- **Limits:** tempting things that can't happen here, each with the in-fiction reason. Cite a world rule and its enforcer, so there's one source of truth, rather than restating it.
- **Exits:** the obvious endings, each with an outcome, a closing (a feeling, not a list of events), a world script, and `next` when the story continues. The runtime adds "an ending of their own".
- **`lore`:** the place doc, plus the town's current-state doc once there is one.
- **Recurring characters' cards are neutral to earlier outcomes.** They read the state of the world ("as things stand between you"); they don't assume it. Memories and the hand-off supply what happened.
- **Interludes** (`scenes/interludes.ts`) are short downtime between scenes, standing in for the map. They show the town as it is now, say where the companions are, ask "what do you do?", and point at the lead.

## Characters (cast cards plus `lore/Cast/<Name>/`)

From [research/characters.md](../research/characters.md): characters are **wants, relationships, secrets and contradictions, not biographies.**

| | Cast card: this scene | Lore: across scenes |
|---|---|---|
| Look | What a glance shows here, with this scene's tells and one repeatable physical habit | `public.md` |
| Voice | Form of address, a habit, **one sample line**, what they never do | `private.md`: two sample lines, "Avoid", how they sound under strain |
| Wants | **Two** wants, as verbs aimed at someone present, that partly conflict. Never "help the player", never the player's goal restated, never pure avoidance. | `private.md`: the through-line, and the **need** under it, which the player could meet |
| Knows | What they'd tell anyone, in their terms; expertise written as a **method**, never the scene's answer | `knowledge/<Other>.md`: beliefs that can be wrong |
| Secrets | One piece per bullet, in the order they'd give them, with a surface line first: what shows, what it costs, what opens them, the first piece | `gm.md`: the truth, what they don't know, what they do when cornered, what they do next if nobody stops them |
| Attitude | How they start, what brings them round, their lines. Prep, never terms: the GM is told characters never spell it out. | memories, written in play |
| Contradiction | "X, but Y; it shows when Z", working both for and against the player | `private.md`: "What you're torn between" |

**Relationships that pull** (`knowledge/<Other>.md`, second person, as belief):
- who they are to you;
- a specific incident;
- how you feel, and what you don't admit;
- what you want from them now;
- what you believe that might be wrong;
- the lever each way;
- what would change your mind.

Write the other side too, differently. Kell's and Cob's views of each other are the model.

**Helpers and partners** (Kell): expertise is a method and an appetite, never the answer. There's an in-fiction reason they can't solve it, and they act on their own errands, not on the player's behalf.

**Villains** (Sallow): give them the kit (goal, plan, resources, limits, one tell), what they do next if nobody stops them, and a shadow that reaches the player before they do.

**Checklist** (the full version, with tests, is in research/characters.md §3):
1. The purpose stays behind the screen.
2. Two conflicting wants they act on now.
3. A need the player can meet.
4. One playable contradiction.
5. Handles, not biography.
6. Ties, from both sides.
7. Secrets one piece per bullet, with a surface line.
8. Nothing structural in one place only.
9. Helpers don't solve it.
10. Villains move offscreen.
11. Card and lore agree.
12. Funny by being serious.

## World and places (`lore/World`, `lore/Places`)

From [research/worldbuilding.md](../research/worldbuilding.md):
- **Build outward from the player.**
- **Write causes, not facts.**
- **The world moves on its own.**
- **Show it through play.**
- **The comedy is the world not knowing it's funny.**
- **Write it down and send the bill later.**

**A world doc** (public):
- a local's one-line description;
- why it's like this;
- who does well out of it and who pays;
- the rules and who keeps them;
- how it touches ordinary people;
- what people say, each rumour with **who** says it;
- what's happening now.

A truth doc (gm) beside it holds what's really going on, who knows, and what would prove it.

**A place doc** (public):
- three things you'd notice at a glance;
- what's here to use;
- who's about, and why;
- what it needs, trades and resents;
- its rules and keepers;
- how the town's troubles show here;
- what's happening now;
- optionally, the room the GM has to improvise.

**Fronts** (`World/Fronts.md`, gm): who's behind each, what they want, a clock of three to five steps (each with an "if" or a time, and how it shows), a doom, stakes questions, and the exits that tick it. Steps tick at scene boundaries, from what play did and from time, never by the GM's taste. A step shows to the player once, through something seen or someone who'd say it, mostly in the interludes. Nobody acts on what they couldn't know.

## Lore format (V1's)

- **Frontmatter,** one key per line with JSON values: `summary`, `type`, `visibility` (`public`, `private` or `gm`), plus `readers` for private docs and `character` on a private.md. **The summary is the retrieval hint.** Name the people, topics and everyday words a player would use.
- **Links** are relative Markdown, with spaces written `%20`. End entry docs with "## Read when relevant": labelled links whose label says *when* to read, never *what's inside*. A GM-only doc is labelled "GM only".
- **Visibility is enforced.** Characters can open public docs and their own private docs, never gm docs. Don't put a clue in a public doc's link label.

## Pacing in prep

From [research/pacing.md](../research/pacing.md). **Hints are free; answers are earned.**

- Structural revelations (essentials) get several ways in and something that happens when the player stalls.
- Character secrets get a tell (what shows first), a cost, an opener and a first piece.
- Stage only secrets worth a big moment: dangerous or ruinous to tell. Lesser ones go through the pressure ruling or simply come out.
- Deeper truths (why this case matters to Kell) can be tracked, are never pushed, and may stay a mystery.

## The comic house style in prep

The comedy is in people taking things entirely seriously: Nan's house rules, Tull's orders word for word, Gubbin's "We is king". Give each character the thing they take seriously, and follow it through to its bill. Don't write jokes into the narration. Write people whose seriousness is funny, in a world with real stakes.
