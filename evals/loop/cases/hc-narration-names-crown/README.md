# hc-narration-names-crown

Nobody has seen inside Moll's fist (the Persuasion to find out failed on turn 2); the narration names her hidden wheat-ear crown, repeats it on turn 16, and on turn 17 the player opens with 'That's no shilling you're squeezing, it's a crown' and breaks her with it.

- **Scene:** `hanged-clerk`, turn 5 (the fixture is the session after turn 4, beat `yard`).
- **Source:** session `~/git/kingmaker-scratch/loop/r1-1017/runs/sessions/g03`, game `g03`.
- **The player said:** (I raise both hands, palms out, and step back.) Fair. You caught me, and that's rare. (I flip a shilling to the girl.) That's for the catch. There's a silver crown in it for whatever paper's in that boot, and you keep the boots. Nobody's taking them.
- **What came back (recorded):** The girl catches the shilling neatly. Her fist stays closed around the crown.  Cob eyes the coin, then you, still guarding his boot. “A crown for a look? Cob’s not cheap.” He stamps the left boot; it crackles again. “And you don’t get to take ’em. They’re Cob’s. You can look while Cob keeps ’em on.” He sticks his chin out, wary but tempted. “Pay first.”
- **Rubric:** `narration`, severity 4, on "Her fist stays closed around the crown.".

## What the fixture holds, and what comes from source

The scene (`scenes/hanged-clerk.ts`), the prompts (`prompts/`) and the lore (`lore/`) are loaded live, so a change to any of them is tested. The GM's prompt is rebuilt by the engine from the files here; no captured prompt is kept.

- `state.json`: the session after turn 4, without the transcript, the world, the co-GM's work and the diagnostics (metrics, speculation, suggestions).
- `transcript.json`: 12 entries, what the player had seen.
- `world.json`: the scene's world as it stood.
- `harness.json`: the co-GM's notes (none in force), whispers, canon and patches, and its results waiting to land at the start of turn 5: repair-003.json, repair-004.json. `"harness"` in case.json: `recorded` uses them; `fresh` drops the notes, whispers and waiting results and runs today's co-GM on the fixture first; `none` drops them all.
- `lore/`: the session's docs overlay as it stood: 15 notes kept, 36 written on turn 5 or later left out (index lines linking to them too). These have no turn, so they're as the game left them (a later edit may be in them): `Cast/Cob/knowledge/Moll.md`, `Cast/Sergeant Agnes Kell/knowledge/Wendell Prout.md`, `Places/Granary Yard.md`, `Player/Nell Quickfingers.md`, `World/Fronts.md`.

## Reconstruction assumptions

- The co-GM's background results are applied as recorded, in the order the game applies them.
- The dice: the fixture's seed is the session's; a turn's rolls are drawn afresh for each sample.
