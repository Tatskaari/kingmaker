# hc-kell-confession-staged

The page's full contents (the motive and Sallow's name) and Kell's one-time secret come out in the same reply: she goes from the 'goes still' tell straight to the full confession, with no turn in between for the player to notice it or ask.

- **Scene:** `hanged-clerk`, turn 7 (the fixture is the session after turn 6, beat `doubt`).
- **Source:** session `~/git/kingmaker-scratch/loop/r1-1017/runs/sessions/g04`, game `g04`.
- **The player said:** (I let out a long breath through my nose, then — despite myself — a short laugh) Well played. Two crowns to look at a boot; I shall dine out on that. But a bargain's a bargain, and a 'look' at a paper means reading it. You take it out with your own fingers, Cob, and hold it open where I can see. I won't touch it, I won't take it. (I fold my hands behind my back to prove the point.) Sergeant, you're witness to the terms.
- **What came back (recorded):** Cob scowls, then carefully picks open the boot lining with his own fingers. He holds the folded page out at arm’s length, keeping his boots on and the paper beyond your reach.  You can read the entries: grain wagons marked “lost to goblins,” each countersigned “J. Sallow, for the Royal Purveyor.” Prout has pencilled weights beside them—the same wagons recorded at the river warehouses.  Kell reads over your shoulder. Her pencil goes still above the notebook. “I knew him by sight. He came to the watch house three days ago. Asked how to report false entries in the King’s rolls. I told him to take…
- **Rubric:** `dump`, severity 3, on "I knew him by sight. He came to the watch house three days ago.".

## What the fixture holds, and what comes from source

The scene (`scenes/hanged-clerk.ts`), the prompts (`prompts/`) and the lore (`lore/`) are loaded live, so a change to any of them is tested. The GM's prompt is rebuilt by the engine from the files here; no captured prompt is kept.

- `state.json`: the session after turn 6, without the transcript, the world, the co-GM's work and the diagnostics (metrics, speculation, suggestions).
- `transcript.json`: 15 entries, what the player had seen.
- `world.json`: the scene's world as it stood.
- `harness.json`: the co-GM's notes (none in force), whispers, canon and patches, and its results waiting to land at the start of turn 7: repair-006.json. `"harness"` in case.json: `recorded` uses them; `fresh` drops the notes, whispers and waiting results and runs today's co-GM on the fixture first; `none` drops them all.
- `lore/`: the session's docs overlay as it stood: 23 notes kept, 35 written on turn 7 or later left out (index lines linking to them too). These have no turn, so they're as the game left them (a later edit may be in them): `Places/Granary Yard.md`, `Player/Aurelian Thorne.md`.

## Reconstruction assumptions

- The co-GM's background results are applied as recorded, in the order the game applies them.
- The dice: the fixture's seed is the session's; a turn's rolls are drawn afresh for each sample.
