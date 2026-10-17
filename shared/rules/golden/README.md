# The rules' golden sheets and checks

What the prototype's rules code makes, for `shared/rules`'s parity (v1-design §4.1): v2's `golden.test.ts` makes the same characters through its own copy and compares.

Recorded by `tools/v2/record-v1-golden.mts` from the prototype at `44c6d4a`, under its stand-in for OpenRouter (no model asked). The recorder went with the prototype: it's in git history at `bc2ab1f` (`git show bc2ab1f:tools/v2/record-v1-golden.mts`), where the game was still in `v2/` (`--out v2`):

```sh
KM_RUNS_DIR=$(mktemp -d) OPENROUTER_API_KEY=offline node --no-warnings tools/v2/record-v1-golden.mts \
  --proto /home/jon/git/kingmaker/.claude/worktrees/v2 --out v2
```

Record again only when a case is added: the prototype's code these come from is fixed at `44c6d4a`.

- **sheets.json:** builds.json's five ready-made builds (as Wren Ashdown, with each build's concept) and the three builds Tamsin Vell is offered in `ai/rules/golden/builds-tamsin.json`, each made by `createCharacter` at level 3 with seed 7: its line, the build line and modifiers it leaves on the player, `statusLine`, `refresh`'s lists (`rules`: spells, weapons, features, gear, prefer, status, pc), `sheetData` (before the story begins, so the purse is the starting one) and `sheetText`. The engine's ids are masked as #1, #2… in the order they first appear in each character's record, since they're random.
- **checks.json:** the ready-made rogue's checks through the engine (`rollFor`), perception, investigation and persuasion at DC 10, 13 and 16. `fresh`: for each seed 1-100, the nine each the next of that seed's dice (rolls one to nine) on the character as made, as each turn's check rolls on the campaign it found (900). `chained`: for seeds 1-3, the nine in a row on one session, each on the campaign the one before committed (27).
