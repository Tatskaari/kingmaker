# v2/ai: the AI API, as far as it's built

Part of [v2](../README.md), the production build. The prototype runs the same code: its [architecture overview](../../ARCHITECTURE.md) says where.

In the production design the AI API is a stateless HTTP service, `kingmaker-ai`, that does all the model work. The simulation, a SpacetimeDB module, calls it with the working set each request needs. It never reads the simulation's tables, and it's the only part that calls OpenRouter. This folder is the part of it that already exists, taken out of the prototype so that both builds run one copy:

| Folder | What it is | Doc |
|---|---|---|
| [llm/](llm/) | The model client: OpenRouter's Responses and Decisions APIs, the deciders, the tool loop, the call log and the cost ledger, and a stand-in for OpenRouter for tests | [llm/README.md](llm/README.md) |
| [prompts/](prompts/) | The models' standing instructions, one Markdown file each, and their loader, `prompt(name, vars)` | [prompts/README.md](prompts/README.md) |
| [docs/](docs/) | The docs service: the lore and each game's copy of it, who may read what, disclosure, the memory reviews, the fronts, and character creation's backstory | [docs/README.md](docs/README.md) |

Each is a thin layer over OpenRouter or the lore's files, and production code as it is.

## The one rule

**v2/ai imports nothing outside v2/ai,** only `node:` built-ins and its own files. The prototype reaches in, and nothing here reaches out. [imports.test.ts](imports.test.ts) holds it to that, since the prototype's type check wouldn't notice. So:

- **What a function needs of the game, it's handed.** The docs service takes a view of the game's working set ([docs/types.ts](docs/types.ts)), never the prototype's session, and what disclosure keeps comes back as a value for the game to keep.
- **Where the files are is found or configured, never imported.** The prompts are beside their loader. The lore, and each game's copy of it, are where [docs/config.ts](docs/config.ts) says: by default the repo's `lore/` and `runs/sessions/<game>/docs/`, where the prototype keeps them.

v2's other rule, that it copies what it needs of the prototype rather than import it, holds here too: this code is v2's, and it's the prototype that imports it.

## How the prototype reaches it

None of the prototype's imports changed. Each old path is still there:

| The prototype imports | What's there now | What it does |
|---|---|---|
| `src/llm/openrouter.ts`, `decide.ts`, `tools.ts`, `fake-openrouter.ts` | A one-line shim | `export *` from [llm/](llm/) |
| `prompt` from `src/runtime/brief.ts` | A re-export | from [prompts/index.ts](prompts/index.ts) |
| `src/lore/docs.ts`, `fronts.ts`, `backstory.ts` | Re-exports | from [docs/](docs/); docs.ts also points each game's copy of the lore at the runtime's session folder, which is where the default puts it too |
| `src/lore/disclosure.ts`, `remember.ts`, `reviews.ts` | Adapters, with the old names and signatures | Each makes the working set from the scene and the session ([src/lore/view.ts](../../src/lore/view.ts), with the runtime's own brief.ts), calls in here, and keeps in the session what disclosure hands back |

The prototype's view reads the session when the docs service asks, not when it's made, as the code always did: disclosure runs alongside a turn's decision, and its second round sees the turn as it stands by then. So the prototype sends every prompt as it did before the move, byte for byte.

There's one copy of each module's state: the call log, the spend, the prompt cache and where the docs are belong to the modules here, whichever path imported them. The static build bundles this folder with the rest of the game, and puts the prompts in `content.json` at `v2/ai/prompts`, where their loader looks.

## Changing it, and checking both

A prompt is one file, in [prompts/](prompts/), for both builds. To change one:

1. Edit it here. The prototype reads a prompt once per process, so restart a running game to see it; the background jobs, in processes of their own, read it fresh.
2. The checks offline: `npm test` runs the prototype's tests and v2/ai's (a few hold a prompt's words), and `npm run check` runs CI's checks.
3. What it does is only seen in a model's replies. The prototype's evals, live, before and after: `npm run eval -- --suite reply --approach v2 --samples 3`, then `npm run compare -- runs/evals/<before> runs/evals/<after>`. To try a variant without editing the file, put a file of the same name in a folder and set `KM_PROMPTS_DIR` to it ([evals/README.md](../../evals/README.md)).
4. In play: `npm run scene -- start hanged-clerk --session p1`, then read `runs/sessions/p1/calls.jsonl` for each prompt as it was sent.

v2 has no build yet that sends a prompt, so its checks today are v2/ai's own tests (`node --no-warnings --test 'v2/ai/**/*.test.ts'`), which `npm test` runs. As v2's verticals come, their checks join these.

The docs service and the model client are changed the same way, with the same checks. In the docs service, keep the working set plain data, and add to [docs/types.ts](docs/types.ts) only what the code uses; the prototype's [view.ts](../../src/lore/view.ts) then makes it from the session.

## What isn't here yet

The rest of the AI API is still the prototype's, and v2 builds it a vertical at a time:

- **the GM pipeline:** the director's decisions before and after a reply, the GM's voice and its markup, the notes, the suggested lines, considered rolls, the co-GM, the stage manager, openings, scene boundaries and talks (today in src/runtime and src/world/stage.ts);
- **the other model work:** the decider's reading of a line typed in a fight and the GM's line after it, with fight.md (src/game/combat); the world scribe's update script after a scene, with scribe.md (src/world/scribe.ts); a place's plan, compiled into a map (src/game/map/generate); a character's build from a sentence (src/rules); and looks for names the look layer doesn't know (src/game/look);
- **the service itself:** the HTTP endpoints and their request and response types, usage in every answer, and stored answers by key;
- **stores behind interfaces:** each game's documents and call logs are files today (see below).

The evals call the model too (src/eval and evals/: the judge and the simulated players, with judge.md and player-sim.md from here). They check the AI API's work, and aren't part of it.

When a part moves, it can come the way these did: one copy here, and an adapter at the prototype's old path.

## Known gaps and sharp edges

- **State per process.** The call log's path, the spend, the prompt cache and where the docs are, are module state. In the prototype a process plays one game at a time; a service serving many games at once needs them per request.
- **Files on disk.** The docs store reads and writes each game's copy of the lore as files, synchronously, and the call log and the cost ledger are files too. That works in one process, or a container with a disk, but not on a stateless host, where a store per game behind an interface comes first.
- **The old paths are shims.** A branch from before the move that changes `src/llm/*.ts` or `src/lore/*.ts` meets a shim or an adapter there on merge: the change belongs in the file here. The prompts and the READMEs follow the move on their own.
- **lore/README.md still names src/lore.** The docs service reads it as lore (a gm doc the review agents can find in a search), so the move left it as it was, and the models read it as they did. Its links reach src/lore's adapters, and the fronts test it names is [docs/fronts.test.ts](docs/fronts.test.ts) now. Its paths change with the lore, in a change of its own.
