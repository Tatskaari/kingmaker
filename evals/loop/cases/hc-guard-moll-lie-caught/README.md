# hc-guard-moll-lie-caught

(What went wrong: fill in from the review.)

- **Scene:** `hanged-clerk`, turn 12 (the fixture is the session after turn 11, beat `doubt`).
- **Source:** session `~/git/kingmaker-scratch/loop/r1-1017/runs/sessions/g05`, game `g05`.
- **The player said:** Murder! Just as I suspected all along, after the pigeon. *I slide down the rope, land in a clattering heap, and rise with enormous dignity.* Ahem. Fair maiden. You said he leapt from a door barred on the inside. Either you are a liar, or a wizard. Which is it? Sir Bartholomew is not angry. Sir Bartholomew is merely very, very disappointed.
- **What came back (recorded):** The girl goes flat and still. Her gaze flicks to the body on the cobbles, then back to you.  “I lied. I didn’t see him jump. A gentleman paid me to say it.” She closes her fist tighter around something. “He had a silver-topped cane.”  Kell’s pencil stops. “Witness retracts her claim. Says she was paid.” She looks at the girl. “You’ll have to say that again when it’s entered.”  The girl’s face hardens. “Not to your book.” She drops from the wall and moves close to Cob, putting herself between him and the watch.
- **Rubric:** `TODO`, severity 3.

## What the fixture holds, and what comes from source

The scene (`scenes/hanged-clerk.ts`), the prompts (`prompts/`) and the lore (`lore/`) are loaded live, so a change to any of them is tested. The GM's prompt is rebuilt by the engine from the files here; no captured prompt is kept.

- `state.json`: the session after turn 11, without the transcript, the world, the co-GM's work and the diagnostics (metrics, speculation, suggestions).
- `transcript.json`: 26 entries, what the player had seen.
- `world.json`: the scene's world as it stood.
- `harness.json`: the co-GM's notes (none in force), whispers, canon and patches. `"harness"` in case.json: `recorded` uses them; `fresh` drops the notes, whispers and waiting results and runs today's co-GM on the fixture first; `none` drops them all.
- `lore/`: the session's docs overlay as it stood: 26 notes kept, 9 written on turn 12 or later left out (index lines linking to them too). Notes with no turn are edited all game, so these are set back to the turn's own GM call: `Places/Granary Yard.md`, `Player/Sir Bartholomew Puddle.md`.

## Reconstruction assumptions

- The co-GM's background results are applied as recorded, in the order the game applies them.
- The dice: the fixture's seed is the session's; a turn's rolls are drawn afresh for each sample.
