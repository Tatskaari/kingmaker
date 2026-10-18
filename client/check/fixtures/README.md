# The client's fixtures

What the prototype's creation and sheet code made, for the client's screens and screen check (v1-design §4.4), which draw them as the rows will carry them.

Recorded by `tools/v2/record-v1-golden.mts` from the prototype at `44c6d4a`, under its stand-in for OpenRouter (no model asked). The recorder went with the prototype: it's in git history at `bc2ab1f` (`git show bc2ab1f:tools/v2/record-v1-golden.mts`), where the game was still in `v2/` (`--out v2`):

```sh
KM_RUNS_DIR=$(mktemp -d) OPENROUTER_API_KEY=offline node --no-warnings tools/v2/record-v1-golden.mts \
  --proto /home/jon/git/kingmaker/.claude/worktrees/v2 --out v2
```

Record again only when a case is added: the prototype's code these come from is fixed at `44c6d4a`.

| File | What |
|---|---|
| offer-tamsin.json | `threeBuilds` offline for Tamsin Vell's concept: three from the class defaults, with the offline note |
| srd-lists.json | `srdLists(3)`: what the player picks from to make their own |
| own-option.json | `ownBuild` (orc, rogue, thief, criminal) for Tamsin Vell |
| sheet-wizard.json | the ready-made wizard's `SheetData` (Pell Marrow, seed 7), the starting purse in it |
| sheet-fighter.json | the ready-made fighter's (Wren Ashdown, seed 7) |
| spell-facts-wizard.json | what the rules engine says of the wizard's ready spells (range, effects' kinds, area), as the prototype's scene menu reads them: the sheet's `spellFacts` as the rules' `sheetRows` writes it (the same JSON). Recorded by `tools/v2/record-spell-facts.mts` (same flags; in git history at `bc2ab1f` too) |

The fight's (M6) is recorded from the game itself, not the prototype: `hosts/fight-fixture.ts` plays one of the zoo's rings on the memory host and writes each commit as a frame (the fight row as it stood, and how many of its moments there were by then), so the screen check and the playback's tests (`client/check/fight.ts`) can hand the client the rows as they came. Record it again when a fight's rows change shape (a field the screen reads, a moment's details):

```sh
node --no-warnings --import tsx hosts/fight-fixture.ts --ring wolves --build fighter --seed 3 --out client/check/fixtures/fight-wolves.json
```

| File | What |
|---|---|
| fight-wolves.json | the wolf run for the ready-made fighter (Wren Ashdown, seed 3): 21 frames, 40 moments, her victory in round 6 (the plan: a blow at whoever's in reach, else close in, else end the turn; auto from round 4) |
