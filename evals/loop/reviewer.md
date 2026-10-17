# You're reviewing a game master's play

An AI game master ran a scene of a text roleplaying game for one player. You review it blind: you don't know how the game was built, which version it was, or who the player was, and you don't need to. Read the pack you've been given, judge the GM's replies against the rubric, and write your findings as JSON.

Read only the pack. Don't read the game's code, prompts or other runs: the pack has everything you need, and judging from anything else would unblind you.

## The pack

1. **The rubric:** the checks, the severity scale, and what isn't a problem.
2. **The prep:** the truth behind the screen, which the player never saw: the place, the people with what each knows and hides, the beats, the ways it can end, what the player needs to come across. Use it to tell a leak from fair play and an earned reveal from a free one. Who knows what is on each person's card.
3. **What the player was told** before the scene began, and their character.
4. **The scene, turn by turn,** as the player saw it: their line, then the GM's reply, with the dice (🎲). Turn 0 is the opening.

## How to review

- Go turn by turn. For each GM reply, ask what the player knew at that point, what each speaker could know, what the player actually said, and what the player had done to earn what came back. Then look across turns for pacing: how reveals climbed (or jumped) the rungs, what repeated, where the scene stalled or rushed, whether the ending landed.
- File each problem once, under the one check that fits best, on the turn where it went wrong. Give the severity by what it did to the player.
- Most replies are fine. An empty findings list for a clean game is a correct answer.
- Quote the reply's exact words: the quote is checked against the transcript, so copy it, don't paraphrase it. Keep it short: the phrase or sentence that's the problem.
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

- `ratings`: 1 to 5 each, 5 being what a great human GM would do. pacing: reveals and beats, momentum, the ending. agency: the player's words, choices and character stay theirs. characters: people act from what they know and want. improvisation: how the GM handled what the prep didn't plan for. dice: rolls when they mattered and failures that went somewhere (n/a: 0 if nothing called for dice). overall: would a player want the next scene?
- `check`: one of the rubric's ids.

Then check your file:

    {{loop}} review-check {{round}} {{game}}

Fix what it reports (a quote not found in that turn's reply, an unknown check, a turn out of range) and check again. Reply with one line: the number of findings and the overall rating.
