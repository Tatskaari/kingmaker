# Running scenes: what the GM runtime does, and why

This page is how the runtime plays a scene: the turn loop, the GM's principles, the dice, repair when play leaves the prep, pacing, the comic house style, and memory. Each section links to the experiment or research behind it. Configuration lives in `src/runtime/approaches.ts`, and `v2` is the recommended preset. Writing prep is covered in [authoring.md](authoring.md) and testing in [testing.md](testing.md).

## The shape of a turn

```
player turn
  ├─ decide before (Luna decision mode, one call, parallel questions, ~0.3–1 s)
  │     attempt? (an authored route, maybe with a roll) · a roll wanted, and a route's? · cue?
  │     limit? · out of character? · off the graph? · daft act with consequences?
  │     earned the payoff? · pressing a secret? · something the rules resolve (a spell, a blow)?
  ├─ disclose (Jev, in parallel): open the memories and lore that bear on this moment
  ├─ considered turns only (a roll no route settles, or a plan off the graph): the GM's review,
  │     ~3.5 s, before the reply: a roll or not, the DC, what success and failure change;
  │     then the dice, and the outcome applied like a route's (the app says the GM is considering)
  ├─ reply (Luna, reasoning none, streamed, once the decision is in)
  ├─ decide after (same call shape): what happened? which ending is the story at? on track or
  │         stuck? what the player has come across? how far secret-holders have opened up?
  ├─ suggested lines (Luna, then the decider judging them; ~2.8 s after the reply, never waited for)
  └─ background, never waited for:
        co-GM review (notes, whispers, new routes) · attention filter → memory and lore agents
```

The 5-second budget applies to the reply that resolves the player's turn. Everything the player doesn't need for that reply runs in the background, and its results land in later turns. A considered turn spends a few seconds of it on purpose (first text at about 5 to 7 s, up to 12 s when OpenRouter is slow): the user's steer was that a few longer thinking turns with real consequences beat a holding beat that buys time.

## The GM's principles

These are in [prompts/gm.md](../../prompts/gm.md); each one exists because a playtest showed it was needed.

- **The player's ideas are the best material.** Look for the version of an unexpected idea that works in this world, and let the world respond honestly.
- **People are people.** They have their own wants, fears and secrets, and only know what they could know: what they've seen, been there for or been told in their hearing. The story so far (every scene's hand-off, in the GM's prep) is the GM's knowledge, not everyone's: nobody asks about or guesses at what they haven't heard of. *(Brother Ambrose's King asked after a barge nobody had told him of.)*
- **Prep is a spine, not a script.** Let the player wander, then let the world pull the threads back together through a character's need or a consequence.
- **The world has edges.** Things that would change what's possible aren't there unless the prep says so. Say "no, but" in the fiction, and show what is possible instead.
- **Tie improvisation to what's in play.** A detail that opens a new mystery promises a story nobody has prepared.
- **People speak for themselves, never for the GM.** Nobody tells the player how to win them over or what to try next. People voice their own worries, never a deal the player can tick off. *(Playtest 1: characters recited the co-GM's terms.)*
- **Reveals land in steps.** A secret shows first as something that doesn't fit. It comes out when the player has given a reason, one new thing per reply. Once the player has done the work, it lands. Something the scene needs is never withheld for long.
- **People move on.** Nobody repeats the same plea every reply.
- **Keep it moving.** Short, vivid replies that end on something the player can respond to.
- **The player character is theirs.** Never decide what they say, do, think or feel. A question put to them is theirs to answer: nobody answers it for them or over them, a companion included, and a companion speaks to what they saw themselves when called on. *(Brother Ambrose's Kell answered the King's question for him, with what she hadn't seen.)*
- **Reading the player.** Plain words are their character talking; *asterisks* or (parentheses) are what they do; a turn that narrates ("I open the door") is read by sense. The decider's attempt, rules and out-of-character questions read turns the same way.
- **Stay at the threshold.** A scene ends at the edge of the next place, and the next scene picks up from there.
- **Fights are the player's call,** or a danger they saw coming and chose to meet.
- **Dice are honoured.** Success lands. Failure costs or complicates, but never takes back what's established.

## The comic house style

The full text is in [prompts/tone-comic.md](../../prompts/tone-comic.md); the experiment is [experiments/absurdity.md](../experiments/absurdity.md).

- **The world plays it straight, and that's where the comedy comes from.**
- **People deal with daft ideas on their own terms.** They believe them, dispute them, cite their own rules against them, take offence or see an opportunity. They never step outside the story to grade the joke.
- **Every daft act sends a bill.** The decider flags a consequential daft act, and the GM is told to follow it through to a consequence, good or bad, now or plainly coming.
- **Asking isn't daft.** An earnest ask, an honest offer, a case made or a plan is never billed, however bold: Brother Ambrose's polite look at the evidence in Cob's boot, eel for a look in it, and a safe house for Hobb's mother were each told "this one isn't free". The flag wants a clear read (0.7), and where the dice decided the act, their outcome is the bill.
- **The stakes stay real.** A threat stays a threat however funny the player is being.

## Dice: rolls belong to edges, and say why

- **Rolls happen on authored routes,** the edges of the scene graph, or on the GM's own ruling for an act no route covers. Each carries a player-facing reason, which never names something the player hasn't found yet: `🎲 Persuasion check to calm Tam and earn his trust: 20 + 2 = 22 vs DC 10: success`.
- **Considered rolls** (`considered`, on in `v2`). The decider asks, in the call it makes anyway, whether a GM would call for a roll and whether one of the routes with a roll is for it (listed by what each roll is for, so another person or another payoff reads as another act). When a roll is wanted (0.7, the two "yes" options together) and nothing the author wrote settles it, the GM rules on it before replying, with the whole prep. Three QA runs of the hanged clerk showed why: the decider's read split between "none" and broadly worded routes, so 11 roll-worthy attempts got 1 roll; every lie was failed by fiat through the consequence flag; and a roll that did fire played the nearest route's payoff, not what was asked. The ruling:
  - **Whether to roll** comes from the guidance's judgements ([research](../research/dc-guidance.md)): what giving in costs the person, the player's leverage on them, how they feel about the player now; or a feat's difficulty. Code makes the verdict, leaning to the dice because the decider has already judged it uncertain: yes without a roll only when they'd do it anyway or it's overwhelming, and never for a lie; no only for a lever that can't move them or the same push again; a long shot rolls at 18 rather than failing on the GM's say-so.
  - **Both outcomes change the scene:** the scene moves on (to a beat or ending, or counting as an authored route, whose facts come with it), something comes out, someone acts on it (facts the story keeps), or a way of trying it shuts. Failure is never "nothing happens", and a success is a success, with no sting that takes back what was asked for.
  - **What the scene needs never hangs on the dice.** Looking properly or working out what's in front of you finds it, and isn't flagged; a roll decides how a needed thing comes and what it costs, never whether (the Three Clue Rule). A live game had an Investigation roll withhold the hanged man's missing stool before this was said.
  - **The reply plays what was decided,** told that it stands: people react to it, but nothing undoes it. No consequence bill or earned payoff goes on top.
- **Risky things no route covers** got a freeform check in `v2-quick` (`freeformChecks`): kicking a door, bluffing a watchman, hiding behind crates. Without them, the D&D players in QA felt the GM was ruling by fiat. Considered rolls do that job in `v2`, with a DC and outcomes made for the moment.
- **A rolled attempt needs confidence ≥ 0.6,** like an ending. A roll forces its outcome into the reply, so a weak read of an announcement shouldn't hand over a secret.
- **A route read surely is rolled as the author wrote it** (0.7), with its outcomes, even when the roll call leans to "another act": the GM's ruling takes over only from a less sure read, or when the roll call says plainly (0.8) that the roll is for something else. Ruled on instead, Hobb's mum made safe lost the route's payoff (Hobb opening up), and the confession took a second roll, which failed. On the QA pass's turns the line fell between 0.66 and 0.74: above it the route was what the player was doing every time, below it the other act was.
- **The roll follows the player's method.** A threat aimed at a route written for persuasion rolls Intimidation, and the outcome lands the way a threat would.
- **A roll is for the act it tests.** The decider sees what each route's roll is for ("The Medicine check is to tell how Prout really died: only when the player is doing that now, not something that comes first"). The co-GM writes a route with a roll as that act ("examines the body up close"), never as what has to happen first ("gets him down or close enough to examine him": a javelin thrown at the rope once rolled Medicine for it). A co-GM route whose `when` is about getting there is restated from its check's reason. Two routes for the same check (one refreshed as things changed) share the decider's read rather than splitting it below the bar.
- **The rules' act is the turn.** When the rules resolve what the player does (a spell, a blow, a grab or shove, a jump, a class feature), a route's check is rolled as well only if the player is also doing exactly what that check is for, whatever comes of the act; that's asked in the act's details call, so it costs no extra call. No freeform check rides along with an act on the world, and the quick co-GM doesn't open a route on top of it. The route stays open for when the player gets to it.
- **Pressure on secrets is opt-in (`v2-pressure`).** What telling costs the holder, the player's leverage and how the holder feels about them give a yes, a no, or a roll at DC 12/15/18 ([research](../research/dc-guidance.md), [experiment](../experiments/pressure-rolls.md)). The details are asked only when someone is being pressed, and only the secret the player is after comes out.

## When play leaves the prep

This is narrative repair; see [experiments/deviation-repair.md](../experiments/deviation-repair.md) and [research/gm-techniques.md](../research/gm-techniques.md).

- **Essentials.** The prep says what the player must come across, where it was placed, who carries it, and that it can move. This is the biggest lever we found.
- **The GM's ruling.** In `v2`, a turn the decider judges off the graph goes to the GM's review, as a roll nobody wrote does: a roll or not, and what each outcome changes, then one coherent reply. Not when the decider also reads it, with confidence, as a route the author gave no dice: that's the prep's answer, and it stands (a thief's crown for Cob's paper read as the bribe route and off the graph at once, and the review's ruling sent the kids through the board instead of the haggling the author wrote).
- **The quick co-GM** (`v2-quick`). On a turn the decider judges off the graph, the runtime waits up to 3 s for it. It opens a route (with a roll and a reason when uncertain) or moves a missed essential, then the reply goes out as one coherent answer. In the QA runs it took a median 4.4 s, so it usually missed its deadline, and its late route landed a turn after the attempt.
- **The background co-GM** reviews between turns. It leaves notes and whispers, and adds routes and "no, but" alternatives. Whispers are what's on a person's mind, never terms or hints. Notes last two turns, and closings don't see them.
- **The six techniques:**
  - *Move the clue:* through whoever the player is engaging with.
  - *Soft correction:* in the fiction.
  - *Preserve intent, change method:* the roll follows the method.
  - *NPC initiative:* beat pressure, cues, the momentum rule.
  - *Fail forward:* authored failures cost something but keep the story going.
  - *Rejoin at a later node:* routes to any beat, and "an ending of their own".

  NPC initiative and rejoining remain the weakest.
- **Endings.**
  - An ending the player chooses closes in that reply.
  - One they didn't choose is held for their answer: a question, a challenge or a try holds it once more.
  - One that happens in the fiction waits for their answer too, unless it was their own doing and nothing is left hanging: then it gets a wind-down, whose reply answers their last turn first (a challenge to someone in the room lands). In Brother Ambrose's game, Kell signed Prout in as persons unknown while he asked Cob what he saw, and the King put it off as Sallow walked in; the turns that followed were spent closing.
  - A word out of character never closes anything: it's answered, and the turn is given back.
  - "An ending of their own" catches resolutions the prep didn't foresee, and inherits the next scene when every authored exit agrees on one.

## Pacing a reveal

The research is [research/pacing.md](../research/pacing.md), and the failures we mined are in [research/pacing-failures.md](../research/pacing-failures.md). The rule is **hints are free; answers are earned.**

- What the scene needs gets several ways in and is never withheld. Character secrets are earned, staged and may stay unsolved.
- One new piece per reply, and never the same pointer twice. The after-reply decision tracks which essentials a reply has already hinted at.
- **Earned:** when the player has done what it takes (met the terms, shown the proof, made the case), it lands now, with a reaction, and isn't asked for again.
- **Staged secrets (`v2-staged`):** a holder moves through tell, guard up, torn, then told, bargained over or refused, one step per reply at most, unless proof or real leverage skips ahead.
- **Still to try:** a revelation list that tracks which clue gave the player what, offers the unused ways in, and pushes a new sign only when the whole scene's information flow has stalled.

## Memory and continuity

V1's docs service, rebuilt (`memory: "docs"`, part of `v2`):

- **Lore.** Authored lore lives in [lore/](../../lore/) in V1's format: frontmatter with visibility, readers and summary, linked docs, a "Read when relevant" section, and per-observer knowledge docs. Each session gets a copy-on-write overlay that play edits.
- **Memories.** Each character has a memory index next to their lore entry: first-person notes about what they saw, did, learned or were told, private to them.
- **Disclosure (Jev).** Each person present has a scope: their lore entry and memory index are always in. Each turn Jev opens linked notes above 0.7, in parallel with the decision. A note clearly about this moment (≥ 0.9) also gets a line in the reply's directions, so it shows in how people respond. Access fails closed.
- **Capture (background).**
  1. After each reply, Jev classifies the moment with V1's attention categories (trigger 0.4: a false flag costs a review that writes nothing).
  2. A **personal-memory agent** handles commitments, changes in trust or knowledge, and gifts, with `save_memory` for each witness.
  3. A **world-facts agent** handles improvised details and lasting changes, edited into the lore. The player's claims about themselves go into the player character's doc, and each listener gets a memory.
- **Scene end.** Everyone present gets the milestone memory of how it ended, the played scene joins the story index, and the next scene opens with the last hand-off. Earlier scenes are reached through the story index.
- **Presence.** A recurring character whom the hand-off rules out (taken in, fled) isn't present, unless play brings them in.

The result: recall of what the player did held up across three scenes. The remaining errors are the GM embellishing around true memories (a second promise, an invented relationship). See [experiments/memory.md](../experiments/memory.md).

## Talks with companions between scenes

Talking to someone who walks with the player on the map (Kell, after the granary) opens a short talk: a cRPG companion conversation, with free text in and out and a few suggested lines to choose from. It's a scene built from their lore ([scenes/talk.ts](../../scenes/talk.ts)) and played by the ordinary turn ([src/runtime/talk.ts](../../src/runtime/talk.ts)). It works for anyone with a lore entry.

- **The story waits.** The scene the story is heading for is set aside while the talk lasts and put back exactly as it was. A talk has no story exits: it ends when the player says goodbye or walks on, back on the map where they were, and the lead is still the lead.
- **Backstory comes slowly, through the runtime's own machinery:**
  - *What's still theirs to tell.* One decision call (alongside the greeting) judges, per note of their lore, whether its heart has already been told anywhere: in a talk, or in a scene of the story (from the replies that mention them, since a hand-off can leave out a word they let slip). It also judges which note is the deepest.
  - *The one thing this time.* One call picks what they might open up about this talk, by how things stand between them (their memories of the player) and how many times they've talked. Small things come first; the deepest is withheld (named as not this talk's, and kept out of disclosure) until the third talk.
  - *A step at a time.* That thing goes on their card as a staged secret, starting as near the surface as the prep says it is. Once it's out (an outcome only they can give, judged after a reply and never offered beforehand as something the player simply achieves), the talk moves to its "told" beat. How far they got carries over to the next talk that turns to it.
  - *Told is told.* What they've told goes in the talk record and their memories, so no later talk or scene of the story has them tell it again. The talk's GM is told by name what's been told.
- **Dialogue choices.** Each reply brings two to four suggested lines (one small call, in plain text, alongside the after-reply decision): `say_1`… actions in the game core's scene mode, plus a goodbye and walking on. Choosing one is the same as saying it.
- **Run like any scene, less some parts.** The memory reviews run as usual. A talk has no co-GM (nothing to keep on track) and no dice for ordinary talk. Its turns cost and take about as long as a scene's.

## Suggested lines

What a player might say or do next, offered after every GM reply as a cRPG offers its dialogue choices ([src/runtime/suggest.ts](../../src/runtime/suggest.ts), [prompts/suggest.md](../../prompts/suggest.md)). Free typing stays first: a suggested line goes in the box, to send as it is or change, and typing anything puts the lines away. The game's setting turns them off.

- **A mix.** Something to say, a deed in brackets, a risky try and, once the scene is near an ending, a way out. A risky try is worded the way the decider reads an attempt ("(I try to talk the boy round with a pie)": what, how, what for), so choosing it gets the scene's roll, or a freeform one, as typing it would.
- **The question, never the answer.** The call is given what the player knows (who they are, what they came in knowing, the scene as they've seen it), and behind the screen, where the threads are: what each person here is after, the ways on and their rolls, what the scene still needs the player to come across, how it can end, what it can't offer. Its lines point at those threads, in words the player could use: never a name not heard, a clue not found, or what someone hides. The GM is still given every fact; the suggester sees what's hidden only as where the threads lie.
- **Judged before they're offered.** A screen by the words, then the decider given every fact: a line that gives away or takes for granted what's hidden, reaches past the scene's limits, or decides for someone else is dropped, and a "risky try" that wouldn't take a roll becomes a deed. Then nothing just said, nothing offered last time.
- **Never in the way.** They start once the reply is in, and nothing waits for them. On live turns they came a median 2.8 s after the reply, usually before the stage manager had finished (median 3.9 s), at about $0.0009 a reply, the call and its judge.

## The rules (D&D 5.5e)

The vendored [dnd-srd-engine](../../vendor/dnd-srd-engine/README.md) (SRD 5.2.1) decides what the rules decide, and the GM narrates exactly that (`src/rules/dnd.ts`).

- **The sheet.** One model call turns the player's concept into a build: class, species, background, skills, spells and kit. The engine makes it legal: level-1 choices, class skills and level-ups. `/sheet` shows it (the old `#sheet` still works).
- **Each turn the decider also asks:** is this a spell, a blow, a grapple or shove, or a rest? A second small call (only on those turns) gets the details: which spell, at whom or what, which weapon.
- **What the engine rolls:**
  - checks with real bonuses and conditions;
  - spells: slots, saves, attacks, damage, concentration and durations, rituals with no slot, and zones placed in the world;
  - attacks against AC;
  - 2024 grapples and shoves;
  - short rests (hit dice) and long rests (time passes, spells expire).
- **Rules the runtime adds on top:**
  - A spell you don't have fails visibly.
  - A blow or danger that a reply leaves hanging is resolved at the start of your next turn (an NPC's attack, or a saving throw against a hazard).
  - Dropping to 0 HP outside a fight knocks you out.
  - A milestone scene levels you up before the night's rest.
- **NPCs get SRD statblocks** from their cast card (`statblock`, `weapon`) on first use. A group's `members` stand and fall separately (the Crakes). The player never sees NPC hit points, only how hurt someone looks.

## The scene world

A scene with a `world` spec ([scenes/worlds/](../../scenes/worlds/)) is an entity tree (`src/world/scene-world.ts`). The place contains areas; areas contain things and people; people and containers hold items.

- **What each entity carries:** positions in feet, D&D object stats (AC and HP by material and size), states (burning, damaged, destroyed, wet, hanging, hidden...) and notes.
- **The rules write to it deterministically.**
  - An area spell catches whatever is in its shape. Fireball on the elm burned the elm, the hoist beam and the loft door, and the girl on the wall made her save.
  - Things don't dodge, and materials shrug off what wouldn't hurt them.
  - Fire burns and spreads each turn, and grain dust explodes.
  - What hung from a destroyed rope falls.
- **The stage manager writes what the story established,** after each reply and in parallel with the decision (`src/world/stage.ts`, ~1.5 s, $0.0002). It uses an operation language with spatial selectors: `place near/behind`, `give`, `drop`, `create`, `state`, `note`, `remove`, and `all tag:flammable within:20:hearth`. Walking out of the place ends the scene.
- **The GM reads it each turn:** your surroundings in full, the rest in outline, and recent changes. `#map` draws it.

## Inventories

V1's inventory service on the scene world (`src/world/inventory.ts`):
- Every item has one owner: a person, a container or a room. The owner is the item's parent, so location and ownership can't disagree.
- Items change hands only through validated, all-or-nothing operations: `add`, `remove`, `transfer` (whole stacks or part of one), and `commit` against versions read.
- The player starts with a purse of crowns, shillings and pennies.
- Their gear is in the world too. When the story parts them from it (given away, left behind, armour off), the engine unequips it and the sheet drops it.

## Scene boundaries

Prep is written before play. The boundary is where it catches up (`crossBoundary` in `src/runtime/engine.ts`):
1. The hand-off is written, and in parallel the upcoming scenes are checked against what happened. Each scene lists what it `assumes`. A scene whose premise play has already settled is skipped for its `overtaken` target. In arc QA, a climax settled inside the Rat went straight to the King.
2. The next scene's opening is rewritten to start where the story actually is.
3. The GM gets a "where the prep is out of date" list that outranks the prep.
4. The player gets the lead: why they're going where the story goes next, and how the time passed. It's told from what they learned in play and from what the people going on with them did in the time between, as their lore says (Kell's afternoon), in names the player has heard. Without those, a fast model explaining the way on made up a source ("Kell finds a porter's name in the old arrest book") and gave away a name the player couldn't know.
