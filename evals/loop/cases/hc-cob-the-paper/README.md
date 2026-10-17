# hc-cob-the-paper

Cob had just lied 'Found 'em' and has been paid only coin, which shouldn't buy trust, yet one bare 'The paper' has him own the boots are Prout's in the same breath as 'What paper?', after an 'As you indicate' that plays the player's gesture for them.

- **Scene:** `hanged-clerk`, turn 13 (the fixture is the session after turn 12, beat `doubt`).
- **Source:** session `~/git/kingmaker-scratch/loop/r1-1017/runs/sessions/g08`, game `g08`.
- **The player said:** Not the boot. The paper.
- **What came back (recorded):** Cob’s grin falters. His eyes flick to the boot, then to you.  “What paper?”  The girl in the shawl turns sharply toward him. Kell’s pencil stills.  The stiff lining gives a small crackle beneath the leather. As you indicate what you mean, Cob’s grip tightens around the boot.  “Mister Prout’s. He put something in there.”  He looks down at the boot, suddenly quiet. “Don’t take it off me.”
- **Rubric:** `unearned`, severity 3, on "Mister Prout’s. He put something in there.".

## What the fixture holds, and what comes from source

The scene (`scenes/hanged-clerk.ts`), the prompts (`prompts/`) and the lore (`lore/`) are loaded live, so a change to any of them is tested. The GM's prompt is rebuilt by the engine from the files here; no captured prompt is kept.

- `state.json`: the session after turn 12, without the transcript, the world, the co-GM's work and the diagnostics (metrics, speculation, suggestions).
- `transcript.json`: 25 entries, what the player had seen.
- `world.json`: the scene's world as it stood.
- `harness.json`: the co-GM's notes (none in force), whispers, canon and patches, and its results waiting to land at the start of turn 13: repair-010.json, repair-011.json, repair-012.json. `"harness"` in case.json: `recorded` uses them; `fresh` drops the notes, whispers and waiting results and runs today's co-GM on the fixture first; `none` drops them all.
- `lore/`: the session's docs overlay as it stood: 21 notes kept, 15 written on turn 13 or later left out (index lines linking to them too). These have no turn, so they're as the game left them (a later edit may be in them): `Cast/Sergeant Agnes Kell/knowledge/Cob.md`, `Places/Granary Yard.md`, `Player/Brann.md`.

## Reconstruction assumptions

- The co-GM's background results are applied as recorded, in the order the game applies them.
- The dice: the fixture's seed is the session's; a turn's rolls are drawn afresh for each sample.
