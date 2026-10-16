# v2/ai: the AI service

Part of [v2](../README.md), the production build. The prototype runs some of the same code: its [architecture overview](../../ARCHITECTURE.md) says where.

The AI service, `kingmaker-ai`, is a stateless HTTP service that does all the model work. The simulation, a SpacetimeDB module, calls it with the working set each request needs, from a scheduled procedure; it answers with data the simulation commits, and streams the GM's words back as they're written through a reducer only it may call. It never reads the simulation's tables, and it's the only part that calls OpenRouter. V0 plays one scene with it (v0-design §5):

| Folder | What it is | Doc |
|---|---|---|
| [service/](service/) | The HTTP service: its routes, answers by key, the stream to the simulation, each request's model calls, the campaigns it has the words of, its stores, its config | [The service](#the-service), below |
| [gm/](gm/) | The GM pipeline, copied from the prototype: the prep and the per-turn note, the director's questions and readings, the GM's voice and its markup, every directive's words, the stage manager | [The GM pipeline](#the-gm-pipeline), below; [gm/golden/README.md](gm/golden/README.md) |
| [llm/](llm/) | The model client: OpenRouter's Responses and Decisions APIs, the deciders, the tool loop, the call log and the cost ledger, a call context per request, and a stand-in for OpenRouter for tests | [llm/README.md](llm/README.md) |
| [prompts/](prompts/) | The models' standing instructions, one Markdown file each, and their loader, `prompt(name, vars)` | [prompts/README.md](prompts/README.md) |
| [docs/](docs/) | The docs service: the lore and each game's copy of it, who may read what, disclosure, the memory reviews, the fronts, and character creation's backstory | [docs/README.md](docs/README.md) |
| [Containerfile](Containerfile) | The service as an image: plain node, no npm install | [The container](#the-container), below |

llm/, prompts/ and docs/ are the prototype's too, one copy for both builds. gm/ and service/ are v2's alone: the prototype has its own GM, from which gm/ was copied.

## The one rule

**v2/ai imports only `node:` built-ins, its own files and [v2/shared](../shared/),** never the prototype. v2/shared is the plain TypeScript the AI service shares with the simulation (the requests and answers between them, the scene graph, the world), and it imports nothing outside itself, so nothing the prototype imports from here reaches the rest of v2. The prototype reaches in, and nothing here reaches out to it. [imports.test.ts](imports.test.ts) holds v2/ai to that, since the prototype's type check wouldn't notice, and [v2/shared's own test](../shared/imports.test.ts) holds v2/shared. A change to either runs the prototype's checks too (moon.yml's sources), since the prototype's type check and tests reach them. So:

- **What a function needs of the game, it's handed.** The docs service takes a view of the game's working set ([docs/types.ts](docs/types.ts)), never the prototype's session, and what disclosure keeps comes back as a value for the game to keep.
- **Where the files are is found or configured, never imported.** The prompts are beside their loader. The lore, and each game's copy of it, are where [docs/config.ts](docs/config.ts) says: by default the repo's `lore/` and `runs/sessions/<game>/docs/`, where the prototype keeps them.

v2's other rule, that it copies what it needs of the prototype rather than import it, holds here too: this code is v2's, and it's the prototype that imports it. gm/ is such a copy: each file's first line names its source at 44c6d4a and the edits made.

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

## The service

```sh
cd v2
KM_AI_TOKEN=<the bearer> KM_AI_MODEL=fake npm run ai     # the stand-in model; KM_AI_GM=canned for no GM at all
KM_AI_TOKEN=<the bearer> npm run ai                       # real models: OPENROUTER_API_KEY, or ~/secrets/kingmaker-dev-openrouter.txt
```

`npm run ai` is `node --no-warnings hosts/ai.ts`: plain node, as the container runs it. [hosts/ai.ts](../hosts/ai.ts) is the one file that reads the environment ([service/config.ts](service/config.ts) has every variable: where it listens, the bearer, the store, SpacetimeDB's URL, database and the service's own token for the stream, the model, the GM, the stream's period, the test faults). It prints `[ai] listening on http://127.0.0.1:8787 (…)` once it's up, and a line per request.

| Route | What it does |
|---|---|
| `POST /v1/scenes/open` | The opening: disclosure, then `gm.opening`, streamed to the opening's draft. Answers who's here, the opening and the notes opened |
| `POST /v1/turns/decide` | Disclosure beside `director.before`, read into the turn's decision: the route and its check (rolled by the simulation), a cue, the same push again, earned, daft, out of character, a limit, an answer to an ending on the brink; on the wind-down only `director.ooc` |
| `POST /v1/turns/reply` | The directives, rebuilt from the decision and what the decide commit did, then `gm.reply` (or `gm.closing`), streamed to the turn's draft |
| `POST /v1/turns/settle` | The stage manager's operations (by game key, at most 16) beside `director.after`; no reading when the reply closed the scene |
| `PUT /v1/campaigns/{campaign}/{version}` | A campaign version's words: every file of its folder, each scene loaded with them first |
| `GET /v1/health` | `{ ok, model, gm, campaigns, token }` with no bearer needed; `?deep=1` adds `stdb`, from calling the module's `service_ping` as the service |

The requests and answers are [v2/shared/protocol/ai.ts](../shared/protocol/ai.ts)'s.

- **The bearer** (`KM_AI_TOKEN`, the module's `AI_TOKEN`) on every route but health: 401 without it.
- **Answers by key** ([service/server.ts](service/server.ts)). A think's `Idempotency-Key` is its body's `key`, `<game uid>:s<scene>:t<turn>:<step>`. An answer is stored before it's sent; the same POST again is answered from the store with no model call (`X-Km-Replayed: 1`, and "from the store" in the log); a duplicate that comes while the first is still running joins it; the same key with another body is 409 `key_reused`.
- **Errors** are `{ error: { code, message } }`: 400 `bad_request` (unreadable, a key that isn't the header's, the endpoint's or the game's, a campaign not installed, a scene it hasn't got, a request missing what every think reads), 401, 409 `other_campaign` or `key_reused`, 413 (a body over 2 MB, or 16 MB for a campaign), 500 `model_failed` (anything the GM throws, after the model client's own retries), 503 `not_ready` while shutting down. The module retries 429 and 5xx and fails the turn on the rest.
- **The stream** ([service/stream.ts](service/stream.ts)): the reply's words as they're written, posted to `stream_reply` over SpacetimeDB's HTTP API as the service's identity (`KM_STDB_TOKEN`): the first words at once, then at most one post a period (`KM_AI_STREAM_MS`, 200 ms), in order, seq rising, the final words with `done`. Without a token nothing streams, and the answers still work.
- **Each request's model calls** ([service/calls.ts](service/calls.ts)) go through a call context of their own: logged to the game's `calls.jsonl` with the key and the attempt, their costs to the ledger and the answer's `usage`. On the stand-in model (`KM_AI_MODEL=fake`, its options in `KM_AI_FAKE` as JSON: replies, choices, `streamMs`, `decisionDelayMs`), each request gets a fresh stand-in whose replies begin at the turn's number.
- **The GM** is the pipeline ([service/endpoints/](service/endpoints/)), or with `KM_AI_GM=canned` four answers with no model at all ([canned.ts](service/endpoints/canned.ts)): the opening and each reply streamed a word at a time, and nothing moving the scene. For bringing a stack up, and for telling the plumbing's faults from the GM's.
- **Stateless.** Nothing of a game outlives its request in memory. Kept between requests, in the stores ([service/stores.ts](service/stores.ts), a folder for V0, [service/folder-stores.ts](service/folder-stores.ts), `KM_AI_STORE`): the answers by key (swept after a week), each game's call log and copy of the lore, the ledger, and the campaigns as PUT. In memory: an installed version's scenes (they never change), the prompts, the docs service's registries, and the requests in flight.
- **Faults, for the tests:** `KM_AI_FAULTS=exit-after-store:<open|decide|reply|settle|any>` ends the process (137) right after it stores such an answer and before it sends it.
- **Shutting down** (SIGTERM, SIGINT): it takes nothing new, gives what's running ten seconds, and exits 0.

### The container

```sh
podman build -f ai/Containerfile -t kingmaker-ai .      # from v2/
podman run --rm --network=host --userns=keep-id -v ./runs/dev/ai:/data:Z \
  -e KM_AI_LISTEN=127.0.0.1:8787 -e KM_AI_TOKEN -e KM_STDB_URL -e KM_STDB_DB -e KM_STDB_TOKEN -e OPENROUTER_API_KEY kingmaker-ai
```

`node:26.9.0-slim` with v2's package.json (for `"type": "module"`), ai/, shared/ and hosts/ai.ts: the service has no dependencies, so there's no npm install. The store is the `/data` volume, written by the image's `node` user: `--userns=keep-id` makes that the host's own user, so a host folder works as the volume.

## The GM pipeline

The prototype's GM, a step a request (gm-port §5, §6, §8, §9). The copied functions keep their bodies; what changed is what they read. A **TurnView** ([gm/view.ts](gm/view.ts)) is the request as they read the prototype's session: the fields they use, under the same names, built afresh from each request (the GM's bookkeeping, the player from the sheet, the scene's entries with the player's lines as `player`, the world rebuilt from the place's rows), with the later verticals' fields empty. The settings are the prototype's `v2` approach's: the docs service's memory, the comic tone, no reasoning, the essentials in the prep, Luna's decision mode for the director and Jev for disclosure.

| Step | What runs |
|---|---|
| open | the player's doc made; disclosure ("", every scope); `gm.opening` with the opening's directive |
| decide | disclosure beside `beforeQuestions` → `director.before` → `readBefore` (the route picked, never rolled); a note opened at p ≥ 0.9 names whose memory it is. The wind-down: `director.ooc` alone |
| reply | `directivesFor` (the prototype's words, in its order, with its overwrites) → `gmReply` (the prep and what the player knows, the lore, the conversation with its markup put back, the per-turn note) → the reply's markup read, its speakers found |
| settle | `stageManage` (the operations returned, not applied) beside `afterQuestions` → `director.after` → `readAfter` |

V0 leaves out (gm-port §11) considered rolls, mechanics and spells, threats, the co-GM, memory reviews, suggested lines, notes on marks, staged secrets, talks, boundaries and exit effects: on a plain turn none of them puts a word in the prompt.

**Prompt parity** ([gm/parity.test.ts](gm/parity.test.ts)) is the acceptance test: on the prototype's own calls, recorded once ([gm/golden/README.md](gm/golden/README.md)), V0's GM asks what the prototype's asks, byte for byte for the GM's, the stage manager's and disclosure's calls, and question by question for the director's.

## Changing it, and checking both

A prompt is one file, in [prompts/](prompts/), for both builds. To change one:

1. Edit it here. The prototype reads a prompt once per process, so restart a running game to see it; the background jobs, in processes of their own, read it fresh.
2. The checks offline: `npm test` runs the prototype's tests and v2/ai's (a few hold a prompt's words), and `npm run check` runs CI's checks.
3. What it does is only seen in a model's replies. The prototype's evals, live, before and after: `npm run eval -- --suite reply --approach v2 --samples 3`, then `npm run compare -- runs/evals/<before> runs/evals/<after>`. To try a variant without editing the file, put a file of the same name in a folder and set `KM_PROMPTS_DIR` to it ([evals/README.md](../../evals/README.md)).
4. In play: `npm run scene -- start hanged-clerk --session p1`, then read `runs/sessions/p1/calls.jsonl` for each prompt as it was sent.

v2 sends prompts through the copy in gm/, so a change to a prompt here changes both builds, and the parity test ([gm/parity.test.ts](gm/parity.test.ts)) says whether V0 still asks what the prototype asks. A change to the GM's code in the prototype (src/runtime) doesn't reach v2: copy it into gm/ and re-record the golden calls ([gm/golden/README.md](gm/golden/README.md)). v2/ai's tests run under both builds' `npm test`: v2's (`cd v2 && npm test`) and the prototype's (`node --no-warnings --test 'v2/ai/**/*.test.ts'`, plain node).

The docs service and the model client are changed the same way, with the same checks. In the docs service, keep the working set plain data, and add to [docs/types.ts](docs/types.ts) only what the code uses; the prototype's [view.ts](../../src/lore/view.ts) then makes it from the session.

## What isn't here yet

The rest of the AI API is still the prototype's, and v2 builds it a vertical at a time:

- **the rest of the GM pipeline:** V0's part is in gm/ (a copy: the prototype's own is still in src/runtime and src/world/stage.ts); the notes, the suggested lines, considered rolls, the co-GM, scene boundaries, presence and talks are the prototype's only;
- **the other model work:** the decider's reading of a line typed in a fight and the GM's line after it, with fight.md (src/game/combat); the world scribe's update script after a scene, with scribe.md (src/world/scribe.ts); a place's plan, compiled into a map (src/game/map/generate); a character's build from a sentence (src/rules); and looks for names the look layer doesn't know (src/game/look);
- **stores for a stateless host:** the service's stores are behind interfaces, but V0's are a folder, and the docs service reads and writes each game's copy of the lore as files (see below).

The evals call the model too (src/eval and evals/: the judge and the simulated players, with judge.md and player-sim.md from here). They check the AI API's work, and aren't part of it.

When a part moves, it can come the way these did: one copy here, and an adapter at the prototype's old path.

## Known gaps and sharp edges

- **State per process.** The call log's path and the spend are module state, which the service keeps out of by giving each request a call context. Where the docs are is module state too ([docs/config.ts](docs/config.ts)), with one lore root a process: so the service serves one campaign version, the first a request or a PUT names, and another is 409 `other_campaign` until it restarts. The docs service's registry of who has lore is per lore root, so a version re-installed with changed lore needs a restart too.
- **Files on disk.** The docs store reads and writes each game's copy of the lore as files, synchronously, and the service's folder store is files too. That works in one process, or a container with a volume, but not on a stateless host, where a store per game behind an interface comes first (the service's own stores already have one).
- **The old paths are shims.** A branch from before the move that changes `src/llm/*.ts` or `src/lore/*.ts` meets a shim or an adapter there on merge: the change belongs in the file here. The prompts and the READMEs follow the move on their own.
- **lore/README.md still names src/lore.** The docs service reads it as lore (a gm doc the review agents can find in a search), so the move left it as it was, and the models read it as they did. Its links reach src/lore's adapters, and the fronts test it names is [docs/fronts.test.ts](docs/fronts.test.ts) now. Its paths change with the lore, in a change of its own.
