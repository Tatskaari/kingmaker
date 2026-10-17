# hc-narration-loose-board

Nobody has mentioned a loose board, and the player has no way to know one is there. Calling it 'the loose board' gives away Cob's hidden hole into the loft, the way up that the player had been looking for since turn 8.

- **Scene:** `hanged-clerk`, turn 15 (the fixture is the session after turn 14, beat `doubt`).
- **Source:** session `~/git/kingmaker-scratch/loop/r1-1017/runs/sessions/g05`, game `g05`.
- **The player said:** Ho! The lad retreats toward the water butt! A knight knows a guilty barrel when he sees one. *I stride past Cob, peer suspiciously into the water butt, and then plunge my gauntleted arm in up to the shoulder to feel about.*
- **What came back (recorded):** Your gauntleted hand sweeps the bottom of the water butt. Water sloshes; your fingers find only sediment.  From behind you, the girl in the shawl snaps, “He’s not in the barrel, tin-plume.”  Cob edges another pace toward the loose board. Kell glances from the butt to the boy, her notebook still open.
- **Rubric:** `narration`, severity 3, on "Cob edges another pace toward the loose board.".

## What the fixture holds, and what comes from source

The scene (`scenes/hanged-clerk.ts`), the prompts (`prompts/`) and the lore (`lore/`) are loaded live, so a change to any of them is tested. The GM's prompt is rebuilt by the engine from the files here; no captured prompt is kept.

- `state.json`: the session after turn 14, without the transcript, the world, the co-GM's work and the diagnostics (metrics, speculation, suggestions).
- `transcript.json`: 33 entries, what the player had seen.
- `world.json`: the scene's world as it stood.
- `harness.json`: the co-GM's notes (none in force), whispers, canon and patches, and its results waiting to land at the start of turn 15: repair-012.json, repair-013.json, repair-014.json. `"harness"` in case.json: `recorded` uses them; `fresh` drops the notes, whispers and waiting results and runs today's co-GM on the fixture first; `none` drops them all.
- `lore/`: the session's docs overlay as it stood: 35 notes kept. These have no turn, so they're as the game left them (a later edit may be in them): `Places/Granary Yard.md`, `Player/Sir Bartholomew Puddle.md`.

## Reconstruction assumptions

- The co-GM's background results are applied as recorded, in the order the game applies them.
- The dice: the fixture's seed is the session's; a turn's rolls are drawn afresh for each sample.
