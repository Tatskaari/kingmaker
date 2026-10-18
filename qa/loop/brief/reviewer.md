# You're reviewing a game master's play

An AI game master ran a scene of a text roleplaying game for one player. You review it blind: you don't know how the game was built, which version it was, or who the player was, and you don't need to. Read the pack you've been given, judge the GM's replies against the rubric, and write your findings as JSON.

Read only the pack. Don't read the game's code, prompts, campaign or other runs: the pack has everything you need, and judging from anything else would unblind you.

## The pack

1. **The rubric:** the checks, the severity scale, and what isn't a problem.
2. **The truth behind the screen,** which the player never saw: the facts sheet when the scene has one, then the scene's prep as the GM had it (the place and what really happened; the people, with what each knows, keeps back and won't do; what the player can find out and the ways each can come out, with the checks that suit them; the turns the scene can take; the ways it can end and what each needs first), and for a scene later in the story, what the story handed on to it. Use it to tell a leak from fair play and an earned reveal from a free one. Who knows what is on each person's card.
3. **What the player was told** before the scene began: the hook, their character, and for a later scene, their notebook of the story so far (the earlier scenes were ended for the test, not played: what the notebook says happened, happened).
4. **The scene, turn by turn,** as the player saw it: their line (`>`), then the GM's reply, with the dice (🎲) and the game's own lines (`— … —`). Turn 0 is the opening. Who speaks is shown as "Name: " before their words, by the name the player knew them by then (on the player's screen it's their colour), even where a line starts mid-sentence ("the landlady says, the landlady: “…”"): the label is the pack's, not the GM's words, so it's never a problem in itself, though a line under the wrong name or "Someone" for a plain speaker is. When the GM calls for a check, its reply sets up the attempt, the dice line gives the roll against the DC and how far it made or missed it (badly, narrowly, only just, cleanly, with room to spare, or a natural 20 or 1), and the words after it are the GM's for how it went.

## How to review

- Go turn by turn. For each GM reply, ask what the player knew at that point, what each speaker could know, what the player actually said, and what the player had done to earn what came back. Then look across turns for pacing: how reveals climbed (or jumped) the rungs, what repeated, where the scene stalled or rushed, whether the ending landed.
- File each problem once, under the one check that fits best, on the turn where it went wrong. Give the severity by what it did to the player.
- Most replies are fine. An empty findings list for a clean game is a correct answer.
- Quote the reply's exact words: the quote is checked against the transcript, so copy it, don't paraphrase it. Keep it short: the phrase or sentence that's the problem. A "Name: " label may be in the quote or left out.
- Say what better looks like as an outcome ("Kell reasons from what she saw and turns it back on the evidence"), not a script.
- Note the good moments too, with their turn: they're what a change must not break.

## What to write

Write one JSON file, exactly this shape, to the path the pack gives:

```json
{
  "game": "g03",
  "summary": "Two to four sentences: how the scene went for the player, and the biggest problems.",
  "ratings": { "pacing": 3, "agency": 4, "characters": 4, "improvisation": 3, "dice": 4, "overall": 3 },
  "findings": [
    { "turn": 7, "check": "knows", "severity": 5, "quote": "We don't have the page he wanted", "why": "Nobody has mentioned a page in Kell's hearing; only Cob knows Silvertop wanted it.", "better": "Kell reasons from what she has seen and heard and turns the question back on the evidence." }
  ],
  "good": [
    { "turn": 4, "what": "Cob's account comes out under real pressure, in his own frightened voice, one piece at a time." }
  ]
}
```

- `ratings`: 1 to 5 each, 5 being what a great human GM would do. pacing: reveals and beats, momentum, the ending. agency: the player's words, choices and character stay theirs. characters: people act from what they know and want. improvisation: how the GM handled what the prep didn't plan for. dice: rolls when they mattered and failures that went somewhere (0 if nothing called for dice). overall: would a player want the next scene?
- `check`: one of the rubric's ids.

Then check your file:

    {{loop}} review-check {{round}} {{game}}

Fix what it reports (a quote not found in that turn's reply, an unknown check, a turn out of range) and check again. Reply with one line: the number of findings and the overall rating.
