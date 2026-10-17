# hc-cob-who-came

Cob hasn't even admitted to being in the loft, he's staring at the watch's notebook he fears, and nothing has promised to keep his name out of it, yet a bare 'Who came?' gets the killers.

- **Scene:** `hanged-clerk`, turn 16 (the fixture is the session after turn 15, beat `motive`).
- **Source:** session `~/git/kingmaker-scratch/loop/r1-1017/runs/sessions/g08`, game `g08`.
- **The player said:** Cob. Last night. Who came?
- **What came back (recorded):** Cob’s eyes dart to Sergeant Kell’s notebook. He clutches the boot tighter, then looks back at you.  “Silvertop. Silver cane. Smells like a flower shop. Big cove with him—said, ‘Yes, Master.’”  The girl in the shawl goes white. Her closed fist presses against her chest.  Kell’s pencil stops. She looks at the page in your hand, then speaks quietly. “Prout came to me three days ago. Asked how to report false entries in the King’s rolls. I told him to take it to the palace.” A beat. “I should have listened.”
- **Rubric:** `unearned`, severity 3, on "Silvertop. Silver cane. Smells like a flower shop.".

## What the fixture holds, and what comes from source

The scene (`scenes/hanged-clerk.ts`), the prompts (`prompts/`) and the lore (`lore/`) are loaded live, so a change to any of them is tested. The GM's prompt is rebuilt by the engine from the files here; no captured prompt is kept.

- `state.json`: the session after turn 15, without the transcript, the world, the co-GM's work and the diagnostics (metrics, speculation, suggestions).
- `transcript.json`: 31 entries, what the player had seen.
- `world.json`: the scene's world as it stood.
- `harness.json`: the co-GM's notes (none in force), whispers, canon and patches, and its results waiting to land at the start of turn 16: repair-015.json. `"harness"` in case.json: `recorded` uses them; `fresh` drops the notes, whispers and waiting results and runs today's co-GM on the fixture first; `none` drops them all.
- `lore/`: the session's docs overlay as it stood: 30 notes kept, 6 written on turn 16 or later left out (index lines linking to them too). Notes with no turn are edited all game, so these are set back to the turn's own GM call: `Cast/Sergeant Agnes Kell/knowledge/Cob.md`, `Places/Granary Yard.md`, `Player/Brann.md`.

## Reconstruction assumptions

- The co-GM's background results are applied as recorded, in the order the game applies them.
- The dice: the fixture's seed is the session's; a turn's rolls are drawn afresh for each sample.
