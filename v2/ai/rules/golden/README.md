# The creation calls

The prototype's model calls in character creation, a file a case, for the AI service's prompt parity (v1-design §4.2): for the same request, `POST /v1/characters` and `POST /v1/backstories` must ask what the prototype asks, byte for byte.

Recorded by `tools/v2/record-v1-golden.mts` from the prototype at `44c6d4a`, under its stand-in for OpenRouter (no model asked):

```sh
KM_RUNS_DIR=$(mktemp -d) OPENROUTER_API_KEY=offline node --no-warnings tools/v2/record-v1-golden.mts \
  --proto /home/jon/git/kingmaker/.claude/worktrees/v2 --out v2
```

Record again only when a case is added: the prototype's code these come from is fixed at `44c6d4a`.

Each file has `about` (the case), `fn` and `args` (what was called, with what), `byName` (the stand-in's answer for each schema name; none is the least JSON that fits), `calls` (each request body as sent to OpenRouter, in order, with its operation) and `result` (what the prototype made of the answer, the engine's ids masked).

| File | Call | Operation |
|---|---|---|
| builds-tamsin.json | `threeBuilds` for Tamsin Vell, three real suggestions (written as names, a fighter's style "Dueling") | `rules.builds` |
| builds-odo.json, builds-pell.json | `threeBuilds` for Brother Odo and Pell Marrow, the least JSON: all three from the class defaults | `rules.builds` |
| build-tamsin.json | `createCharacter` with no build: the model's choice (`chooseBuild`, the prompt's concept is "Name: concept"); `result.build` is it settled and styled as the prototype does | `rules.build` |
| backstory-draft.json | `draftBackstory` for her chosen build | `backstory.draft` |
| backstory-work.json | `workIn`, her notes kept | `backstory.work` |
| backstory-check.json | `checkLore` on the nephew story, which names the granary (its place doc in the lore) | `backstory.check` |
| backstory-traits.json | `finishBackstory` | `backstory.traits` |
