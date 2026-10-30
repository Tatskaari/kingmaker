# The creation calls

The prototype's model calls in character creation, a file a case, for the AI service's prompt parity (v1-design §4.2): for the same request, `POST /v1/characters` and `POST /v1/backstories` must ask what the prototype asks, byte for byte.

Recorded by `tools/v2/record-v1-golden.mts` from the prototype at `44c6d4a`, under its stand-in for OpenRouter (no model asked). The recorder went with the prototype: it's in git history at `bc2ab1f` (`git show bc2ab1f:tools/v2/record-v1-golden.mts`), where the game was still in `v2/` (`--out v2`):

```sh
KM_RUNS_DIR=$(mktemp -d) OPENROUTER_API_KEY=offline node --no-warnings tools/v2/record-v1-golden.mts \
  --proto /home/jon/git/kingmaker/.claude/worktrees/v2 --out v2
```

Record again only when a case is added: the prototype's code these come from is fixed at `44c6d4a`.

The exceptions are `backstory-draft.json` and `backstory-check.json`, re-recorded from the game itself (2026-10-30) when Caerwyn's story began with the prologue on the King's Road: the premise and where a backstory ends are the campaign's now (its `creation.premise` and `creation.begins`), the lore check reads the new people's public profiles, and the draft's stand-in story ends on the road. They're the game's calls, not the prototype's.

Each file has `about` (the case), `fn` and `args` (what was called, with what), `byName` (the stand-in's answer for each schema name; none is the least JSON that fits), `calls` (each request body as sent to OpenRouter, in order, with its operation) and `result` (what the prototype made of the answer, the engine's ids masked).

| File | Call | Operation |
|---|---|---|
| builds-tamsin.json | `threeBuilds` for Tamsin Vell, three real suggestions of three classes, in ids (the fighter's style written as a name, "Dueling"); a model answering in names is build-tamsin.json's case, and `ai/rules/builds.test.ts`'s | `rules.builds` |
| builds-odo.json, builds-pell.json | `threeBuilds` for Brother Odo and Pell Marrow, the least JSON: all three from the class defaults | `rules.builds` |
| build-tamsin.json | `createCharacter` with no build: the model's choice (`chooseBuild`, the prompt's concept is "Name: concept"); `result.build` is it settled and styled as the prototype does | `rules.build` |
| backstory-draft.json | `draftBackstory` for her chosen build | `backstory.draft` |
| backstory-work.json | `workIn`, her notes kept | `backstory.work` |
| backstory-check.json | `checkLore` on the nephew story, which names the granary (its place doc in the lore) | `backstory.check` |
| backstory-traits.json | `finishBackstory` | `backstory.traits` |
