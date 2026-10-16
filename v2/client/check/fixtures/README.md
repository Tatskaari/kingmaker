# The client's fixtures

What the prototype's creation and sheet code made, for the client's screens and screen check (v1-design §4.4), which draw them as the rows will carry them.

Recorded by `tools/v2/record-v1-golden.mts` from the prototype at `44c6d4a`, under its stand-in for OpenRouter (no model asked):

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
