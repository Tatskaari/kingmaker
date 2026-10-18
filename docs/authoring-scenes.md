# Writing a scene

A scene is prep for a GM who improvises, not a script. The two-part GM plays it:
- a **mouthpiece** narrates and voices everyone;
- a **co-GM** gives each person a conversation role before every player turn, and moves the scene along its routes.

Write for both. The format is [scene-format.md](scene-format.md); the hanged clerk ([`campaigns/caerwyn/scenes/hanged-clerk.kmscene`](../campaigns/caerwyn/scenes/hanged-clerk.kmscene)) is the worked example.

## The shape

- **A start.** The situation the player walks into, a few suggested ways in (people to approach, things to look at, a person to ask), how to play the people here, and an opening image. These are examples, not a sequence: follow whatever the player engages with.
- **Discoveries** (beats with a `revelation`). They're what the player can come to understand, in any order: usually two to four.
  - Each has several **paths**: who or what holds it, the concrete clue, what earns it, and how strong it is as evidence.
  - Say what each path substantiates. A document is proof; a frightened child's account is testimony; a sergeant's memory confirms what was reported but not that it's true.
- **Events** (beats without one). They're the turns the scene takes: the dead-cart arrives, the master comes at midnight.
  - Each one has its people's roles, its pressure, and who arrives with it.
  - The route into it is a `cue` with an outer limit, so the scene can't stall forever ("once the lead is found and the player has had their chances, or at the noon bell").
- **Endings.** Graded, and each with a `result`:
  - a good one;
  - usually a mixed one (they got the lead but not the proof);
  - a bad one as a last resort (crimes, abandoning the case).

  Put what an ending needs in its routes' `requires`, not only in their prose.

## The rules

1. **Three clues for anything that matters.** A `required` discovery has at least three paths, through different people and things, and at least one needs no dice. Never lock what the story needs behind a single roll or a single person.
2. **Say what's free and what's earned.** A path's `earn` says what it takes: "free to anyone who looks up", "a kindness with nothing asked back", "getting up to the body", "a promise that answers his fear". A clue with no price gets spent by whoever's nearest, often the wrong person. An approach that needs no dice says so up front ("No dice: a promise that answers his fear"), and where the path's check is for another approach, the free ones come first and the roll after them: otherwise the GM rolls for the promise the card says works.
3. **Characterise, then inconsistency, then hooks, then clues.** Give each person `roles` that climb that ladder:
   - **characterise:** what we see first;
   - **inconsistency:** the discrepancy that invites a question;
   - **hooks:** what invites the player in.

   Their clues are the paths `via` them. The GM won't skip more than one step in a turn, though a good roll can reveal the clue.
4. **Behaviour, not meaning.** Roles and cast notes say what someone does and what they hold back this turn ("goes quiet when the loft comes up; Moll answers for him"), never what it means ("he's hiding his guilt"). The meaning leaks into the prose.
5. **Say what each person holds.**
   - **secrets:** for each one, how it shows, what pulls them both ways, what opens it, and the first thing they'd say.
   - **limits:** what never works on them. Coin buys boasts, not trust. A grab makes him bolt.
   - Free facts someone could blurt out belong to a named person, or the first person to hand spends them.
6. **People are doors, not walls.** Every person reacts to what the player tries with a real reaction and a way forward, without giving their secrets away for nothing. Write the "but" in: the stair door is locked, but the steward has the key.
7. **Make the world honest.** List the tempting things that don't exist here in `limits` (no ladder, no coroner, nobody at the palace can be reached), so the GM can say "no, but" instead of inventing.
8. **Keep timing on events, not in people.** A clock or an arrival is an event beat with a `cue` route, not a line in someone's role ("the key arrives next reply" gets forgotten). And say how it's felt moving, a step nearer each exchange and never the same sign twice: Hep's count falls each time she calls it, the Marshal's minutes run down. A count said the same way every time reads as a clock that's stopped, and a bell nobody felt coming reads as the GM ending the scene.
9. **The truth is for the GM.** Write `truth` in full: who did what, when, and with what. The paths are how it comes out. Nobody in the scene knows more than their card says.
10. **Ids are readable slugs** (`murder`, `hobb`, `cart-arrives`), and they're stable: game state keys on them.
11. **Short beats.** A discovery's description is a paragraph, and its paths are a line or two each. The people's cards carry the depth.
12. **A worse ending gives way to a better one.** Where a bad or mixed ending's route could be true at the same moment as a good one's (the barge sailing while Kell is arresting the Master), its condition says so and names the good route: "Not needed once the player has ...: that's [in-the-act]". A cue into an ending always says what has it no longer needed.
13. **Say once where a count stands.** When something is already partway as the scene opens (Hobb has refused Arlo twice), say once, plainly, where it stands, what the next step is and what the last one costs, so it isn't played twice.

## Checking it

`npm run campaign -- check campaigns/caerwyn` enforces the format's rules: reachability, the three-clue rule for required discoveries, `requires`, ids and effects ([campaigns/README.md](../campaigns/README.md) says how to write and check one). Then play it: `npm run dev`, then `npm run play` or the page.
