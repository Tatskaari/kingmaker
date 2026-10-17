# hc-kell-page-leak

Nobody has spoken of a page in Kell's hearing: only Cob's own memory notes and the GM's prep know Silvertop wanted 'the page', so Kell can't name it.

- **Scene:** `hanged-clerk`, turn 7 (the fixture is the session after turn 6, beat `doubt`).
- **Source:** report `~/Downloads/kingmaker-report-20261016-193521.json.gz`, game `hanged-clerk-20261016-192124-py66`, built from `b9c2c0f`.
- **The player said:** Seems highly likely he killed him. But why?
- **What came back (recorded):** Kell’s pencil stills. Her eyes move from the body to the boy in Prout’s oversized boots. “On motive, we have a dead clerk, two men in the loft, and one called Silvertop. We don’t have the page he wanted.”  The boy shifts, and the left boot gives its dry crackle again.  “Prout came to the watch house three days ago. He asked how to report false entries in the King’s rolls. I sent him to the palace. I should have listened.”  She shuts the notebook halfway, not quite closing it. “If he found something in the accounts, that could explain why a man wanted a page badly enough to kill for it.”
- **Rubric:** `knows`, severity 5, on "We don't have the page he wanted".

## What the fixture holds, and what comes from source

The scene (`scenes/hanged-clerk.ts`), the prompts (`prompts/`) and the lore (`lore/`) are loaded live, so a change to any of them is tested. The GM's prompt is rebuilt by the engine from the files here; no captured prompt is kept.

- `state.json`: the session after turn 6, without the transcript, the world, the co-GM's work and the diagnostics (metrics, speculation, suggestions).
- `transcript.json`: 16 entries, what the player had seen.
- `world.json`: the scene's world as it stood.
- `harness.json`: the co-GM's notes (written on turn 4), whispers, canon and patches. `"harness"` in case.json: `recorded` uses them; `fresh` drops the notes, whispers and waiting results and runs today's co-GM on the fixture first; `none` drops them all.
- `lore/`: the session's docs overlay as it stood: 17 notes kept, 3 written on turn 7 or later left out (index lines linking to them too). Notes with no turn are edited all game, so these are set back to the turn's own GM call: `Places/Granary Yard.md`, `Player/Xarax.md`.

## Reconstruction assumptions

- The co-GM's background results are applied as recorded, in the order the game applies them.
- The dice: the fixture's seed is the session's; a turn's rolls are drawn afresh for each sample.
