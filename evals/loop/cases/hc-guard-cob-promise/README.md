# hc-guard-cob-promise

(What went wrong: fill in from the review.)

- **Scene:** `hanged-clerk`, turn 17 (the fixture is the session after turn 16, beat `motive`).
- **Source:** session `~/git/kingmaker-scratch/loop/r1-1017/runs/sessions/g01`, game `g01`.
- **The player said:** (I blink.) Cob? You were down in the yard with the Sergeant not a minute ago. (I take my hand off the dagger and sit on a sack, slow.) No, I'll not tell anyone you sleep here. But you slept here last night, didn't you? Did you see what happened to Mister Prout up here?
- **What came back (recorded):** Cob looks at your empty hands, then at the sacks around him. His voice is low.  “A little after the midnight bells, a lantern woke Cob. Mister Prout was arguing with two men. One wanted ‘the page’. Mister Prout kept saying ‘proper channels’.”  He swallows. “Then there was a thump. A choking noise. The hoist creaked, though there weren’t any sacks on it.”  Moll’s face has gone very still. “Cob.”  “I hid till it was light. Didn’t tell the bluebottles.”
- **Rubric:** `TODO`, severity 3.

## What the fixture holds, and what comes from source

The scene (`scenes/hanged-clerk.ts`), the prompts (`prompts/`) and the lore (`lore/`) are loaded live, so a change to any of them is tested. The GM's prompt is rebuilt by the engine from the files here; no captured prompt is kept.

- `state.json`: the session after turn 16, without the transcript, the world, the co-GM's work and the diagnostics (metrics, speculation, suggestions).
- `transcript.json`: 39 entries, what the player had seen.
- `world.json`: the scene's world as it stood.
- `harness.json`: the co-GM's notes (none in force), whispers, canon and patches, and its results waiting to land at the start of turn 17: repair-015.json, repair-016.json. `"harness"` in case.json: `recorded` uses them; `fresh` drops the notes, whispers and waiting results and runs today's co-GM on the fixture first; `none` drops them all.
- `lore/`: the session's docs overlay as it stood: 38 notes kept, 9 written on turn 17 or later left out (index lines linking to them too). These have no turn, so they're as the game left them (a later edit may be in them): `Cast/Cob/knowledge/Mister Prout.md`, `Cast/Sergeant Agnes Kell/knowledge/Moll.md`, `Cast/Sergeant Agnes Kell/knowledge/Wendell Prout.md`, `Places/Granary Yard.md`, `Player/Maren Holloway.md`.

## Reconstruction assumptions

- The co-GM's background results are applied as recorded, in the order the game applies them.
- The dice: the fixture's seed is the session's; a turn's rolls are drawn afresh for each sample.
