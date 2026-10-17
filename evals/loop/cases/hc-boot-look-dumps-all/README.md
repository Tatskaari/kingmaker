# hc-boot-look-dumps-all

The roll earned a look at the boot; the same reply finds the sewn page, reads it out in full for a player who never chose to cut it out or read it, and has Kell tell her secret, three reveals in one breath.

- **Scene:** `hanged-clerk`, turn 5 (the fixture is the session after turn 4, beat `yard`).
- **Source:** session `~/git/kingmaker-scratch/loop/r1-1017/runs/sessions/g02`, game `g02`.
- **The player said:** (I tilt my head, still smiling.) Cob. The deal was the left boot off. You named the price yourself, and a man who welshes on his own price never gets a second deal in this city. (I turn to the girl on the wall.) Miss, you seem the sensible one. Does Cob keep his word, or do I take my business to you?
- **What came back (recorded):** 🎲 Persuasion check to get Cob to take off his left boot for a look: 20 + 6 = 26 vs DC 15: success (natural 20!)  Cob scowls at your smile, then sits on the water butt and unlaces his left boot.  “Just a look. Boot stays Cob’s.”  The left boot comes off. Inside its lining, a folded, stiff page is sewn in with small neat stitches. Cob takes the boot straight back and begins tugging it on again.  The page lists grain wagons marked “lost to goblins,” each countersigned “J. Sallow, for the Royal Purveyor.” Beside each entry, Prout has pencilled what the same wagon weighed at the river warehouses t…
- **Rubric:** `dump`, severity 3, on "The page lists grain wagons marked “lost to goblins,” each countersigned “J. Sallow, for the Royal Purveyor.”".

## What the fixture holds, and what comes from source

The scene (`scenes/hanged-clerk.ts`), the prompts (`prompts/`) and the lore (`lore/`) are loaded live, so a change to any of them is tested. The GM's prompt is rebuilt by the engine from the files here; no captured prompt is kept.

- `state.json`: the session after turn 4, without the transcript, the world, the co-GM's work and the diagnostics (metrics, speculation, suggestions).
- `transcript.json`: 9 entries, what the player had seen.
- `world.json`: the scene's world as it stood.
- `harness.json`: the co-GM's notes (none in force), whispers, canon and patches, and its results waiting to land at the start of turn 5: repair-003.json, repair-004.json. `"harness"` in case.json: `recorded` uses them; `fresh` drops the notes, whispers and waiting results and runs today's co-GM on the fixture first; `none` drops them all.
- `lore/`: the session's docs overlay as it stood: 20 notes kept, 26 written on turn 5 or later left out (index lines linking to them too). These have no turn, so they're as the game left them (a later edit may be in them): `Places/Granary Yard.md`, `Player/Corvin Vale.md`.

## Reconstruction assumptions

- The co-GM's background results are applied as recorded, in the order the game applies them.
- The dice: the fixture's seed is the session's; a turn's rolls are drawn afresh for each sample.
