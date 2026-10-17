# hc-cob-night-for-coin

Asked only 'Seen him, have you?' by someone who has bought him with coin all scene and promised him nothing, Cob gives Silvertop, the big man, 'proper channels' and the killing in one rush, in the same reply as Moll's crack.

- **Scene:** `hanged-clerk`, turn 8 (the fixture is the session after turn 7, beat `motive`).
- **Source:** session `~/git/kingmaker-scratch/loop/r1-1017/runs/sessions/g02`, game `g02`.
- **The player said:** My case is coming, Sergeant, give me a moment. (To the girl, softly.) Already sold it. Then someone came round before me, and paid you to keep quiet, I'd guess. Whatever they paid, I'll double it, and the King's name means you'll never need fear them. Who bought your story, miss? (Then, sidelong to Cob.) And you twitched at Sallow's name, Cob. Seen him, have you?
- **What came back (recorded):** 🎲 Persuasion check to win Cob over: 18 + 6 = 24 vs DC 13: success  The girl’s eyes stay on you. “The King’s name” makes her fist tighten; your offer of more money gets a sharp, humourless laugh.  “A gentleman. Paid me to say I saw the clerk jump.”  Cob goes very still on the water butt. Then, quieter than before:  “Silvertop was here last night. Silver cane. Wheat ring. Big cove with him. Mister Prout said ‘proper channels.’ Then there was a thump. A choking noise. The hoist creaked.”  The girl turns on him, face gone flat. “Cob, no.”  Kell’s pencil stops above the page. “That’s an account of…
- **Rubric:** `dump`, severity 3, on "Silvertop was here last night. Silver cane. Wheat ring. Big cove with him.".

## What the fixture holds, and what comes from source

The scene (`scenes/hanged-clerk.ts`), the prompts (`prompts/`) and the lore (`lore/`) are loaded live, so a change to any of them is tested. The GM's prompt is rebuilt by the engine from the files here; no captured prompt is kept.

- `state.json`: the session after turn 7, without the transcript, the world, the co-GM's work and the diagnostics (metrics, speculation, suggestions).
- `transcript.json`: 17 entries, what the player had seen.
- `world.json`: the scene's world as it stood.
- `harness.json`: the co-GM's notes (written on turn 5), whispers, canon and patches. `"harness"` in case.json: `recorded` uses them; `fresh` drops the notes, whispers and waiting results and runs today's co-GM on the fixture first; `none` drops them all.
- `lore/`: the session's docs overlay as it stood: 29 notes kept, 17 written on turn 8 or later left out (index lines linking to them too). Notes with no turn are edited all game, so these are set back to the turn's own GM call: `Places/Granary Yard.md`, `Player/Corvin Vale.md`.

## Reconstruction assumptions

- The co-GM's background results are applied as recorded, in the order the game applies them.
- The dice: the fixture's seed is the session's; a turn's rolls are drawn afresh for each sample.
