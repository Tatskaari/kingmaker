# V0: a line in a scene

The blueprint for the first vertical of the production build: the hanged clerk's scene, played through the split the design describes (client ↔ SpacetimeDB ↔ a stateless AI service). Package A lands the contracts alone; B, C, D and E build against them in parallel; F integrates. Every name, table and type below is a contract unless it says otherwise.

> **Overrides.** These were decided after the blueprint was written, and win where the text below disagrees:
>
> 1. **`gm_state` keeps typed columns,** as the design has it (CS §2), not one JSON column: a column for each field V0 uses, with SpacetimeDB's products, arrays and options for the structured ones. Later verticals add their columns. The AI service still gets `GmState` whole in every request, built from the row; `shared/gm/state.ts` keeps the type and the mapping both ways (`gmToRow`, `gmFromRow`).
> 2. **One pull request, not six.** Packages A to F were internal: B, C, D and E each built on a branch from A's commit, and F merged them into `claude/v2-v0`, which is the PR. §11's branch names and its "one PR each" don't apply.
> 3. **A built `service_ping` and `ping_ai` for real,** not as `not_built` stand-ins, so the dev host and the doctor worked before B landed.
> 4. **Every port and data folder can be moved:** the dev host's and the e2e's `--port`, `--ai-port` and `--root`. Several stacks ran at once while V0 was built.
> 5. **Namespace mode** was the only mode on the machine V0 was built on (11.0.0.1 isn't set up there). CI runs host mode.
>
> Where the build departs from the blueprint in other ways, §14 says.

Sources: the design's long form, `content-server.md` (CS), and the research notes `spacetime.md`, `gm-port.md`, `content-world.md` and `client.md`. These live in the author's scratchpad, not the repo, so the references name a section rather than link. The plan this blueprint starts is [verticals.md](verticals.md). The prototype is read at `44c6d4a`; the shared AI code at `claude/v2-ai-shared` (`daefc06`). Where V0 departs from CS, the text says so, and §13 lists every departure with its reason.

---

## 0. Decisions at a glance

1. **V0 plays one scene end to end:** a new game, the hanged clerk's opening, any number of lines (each decided, replied and settled), the wind-down, "Scene ends". No map, no rules engine, no co-GM, memory reviews, boundary or exit effects.
2. **Three processes.** The client (the OpenTUI screen, or the headless client) talks only to SpacetimeDB. The module calls the AI service from a scheduled procedure. The AI service streams the reply back through the service-only `stream_reply` reducer over SpacetimeDB's HTTP API.
3. **One durable `job` row per move in flight** holds the move's plan and its next request, built inside the transaction that queues it and keyed by an idempotency key. `run_job` does one think per dispatch: claim, POST, commit. Retries and stuck jobs are dispatched by the reaper. The AI service keeps every answer by key, so a re-dispatch never calls a model twice when the first answer was kept.
4. **The AI service is stateless:** a `node:http` server with no npm dependencies, run by plain `node` (type stripping), the same files in a podman image. Its stores sit behind interfaces; V0's are a folder.
5. **Local networking:** the module always calls `http://11.0.0.1:8787`. Host mode when 11.0.0.1 is on this machine; otherwise namespace mode, where only SpacetimeDB runs inside `pasta`, which maps 11.0.0.1 to the host's loopback and forwards SpacetimeDB's port to the host's loopback. Verified tonight (§1.5). `npm run dev` picks the mode itself.
6. **Layout:** `v2/shared` (Node-free ES2021: protocol, scene graph, world, dice), `v2/simulation` (the module), `v2/ai` (the service; `llm`, `prompts`, `docs` shared with the prototype), `v2/client`, `v2/hosts` (composition roots), `v2/campaigns/caerwyn`.
7. **`v2/ai` may import `v2/shared`.** The v2-ai rule widens from "only itself" to "itself and `v2/shared`; never the prototype".
8. **The GM pipeline is copied** into `v2/ai/gm` (gm-port §15) behind a `TurnView` adapter, so the prototype can adopt it later through shims as it did the docs service. Prompt parity with recorded prototype calls is the acceptance test.
9. **One copy of the world code** (the prototype's `SceneWorld`, `applyOps`, `worldView`, and the rows mapping) lives in `v2/shared/world`: the simulation mutates through it, the AI service renders through it.
10. **Moves are plain functions over the module's own table API** (`tx.db.scene.id.find(…)`), so the same code runs in SpacetimeDB and on an in-memory host built for the tests.
11. **Spectators, not watchers with characters.** A second client joins a game and watches its scene row for row. The GM's prompts stay single-player, so parity holds.
12. **Dice:** `rollCheck` from the game's `dice` row (the prototype's no-sheet path). The sheet is a pregenerated build from the campaign.

---

## 1. The demo

### 1.1 What the user runs

```sh
cd v2 && npm ci                      # in the repo, so proto gives Node 26.9
npm run dev                          # SpacetimeDB, the module, the AI service, the campaign; real models
```

In two more terminals:

```sh
npm run client -- --session wren --new "Wren Ashdown: a hedge wizard from the fens" --build wizard
npm run client -- --session tamsin --join 1          # a second client watching the same scene
```

Headless, for agents and QA (the prototype's `qa` verbs):

```sh
npm run play -- new --session qa --as "Pell Marrow: a disgraced herald" --build rogue
npm run play -- say --session qa "Sergeant, who found him?"
```

`npm run dev` flags: `--fake` (the fake model; no key), `--container` (the AI service in podman), `--fresh` (empty data), `--mode host|namespace`, `--port 3300`, `--ai-port 8787`, `--no-keys` (no keyboard; stops on SIGTERM). The key comes from `OPENROUTER_API_KEY` or `~/secrets/kingmaker-dev-openrouter.txt` (as `v2/ai/llm` reads it); without one, the dev host stops and suggests `--fake`.

The dev host's screen once it's up:

```text
Kingmaker dev stack · namespace mode (SpacetimeDB in a pasta namespace; 11.0.0.1 is this machine's loopback)
  SpacetimeDB   ws://127.0.0.1:3300  database kingmaker       log runs/dev/logs/spacetime.log
  AI service    http://127.0.0.1:8787 · the module calls http://11.0.0.1:8787 · openrouter   log runs/dev/logs/ai.log
  Campaign      caerwyn 0.1.0 installed in both
  Doctor        the module reached the AI service (200 in 3 ms); the AI service called the module as itself
Play:  npm run client -- --session <name> --new "Name: concept" [--build ranger|rogue|wizard]
       npm run client -- --session <name> --join <game>
Keys:  k kill the AI service · s start it · r restart it · f kill it after its next stored answer
       p republish the module · d doctor · q quit
Tip:   sudo ip addr add 11.0.0.1/32 dev lo  runs the stack without a namespace (host mode)
```

### 1.2 What they see

- **The scene screen** (client.md §5.3): the conversation a turn at a time, the GM's reply growing in its draft with `▍`, the status line ("The GM is speaking…"), the box, and the side panel (the character, their status line, "Here" in each person's colour, the game's number to join).
- **The spectator's screen** is the same conversation, row for row. Their box never opens: "Wren Ashdown has the lead: you're watching." A line typed there is refused in the game's words.
- **A turn, on both screens:** the line at once ("the GM is thinking"); first words a second and a half later, as in the prototype (the split adds milliseconds: a dispatch is ~3 ms, a stream post ~4 ms); the reply final, the box open; the world settled behind it a few seconds later.
- **The end:** a line that makes the case (or walks away) reaches an ending; the next line is the wind-down; the GM closes the scene and "— Scene ends: The Hanged Clerk —" closes the transcript.

### 1.3 The AI service killed mid-turn

| Case | What the user (or the e2e) does | What happens |
|---|---|---|
| Killed mid-reply | `k` while the draft grows, then `s` | `run_job`'s POST fails (reset or refused). The job goes `waiting`; the turn's note says "The GM has lost the thread for a moment: trying again." The reaper re-dispatches it (1, 2, 4, 8, then every 15 s). Once the service is back, the reply streams again as attempt 2 (the draft restarts) and the turn finishes. The first answer was never kept, so this costs a second model call. |
| Killed after it kept the answer | `f` (the service exits right after storing its next answer, before replying), then `s` | The re-dispatched POST carries the same key; the service answers from its store ("from the store, no model call" in its log); the turn finishes. |
| SpacetimeDB restarted mid-think (e2e only) | the e2e stops and restarts SpacetimeDB while a slow decide is in flight | The schedule row was consumed and the procedure died with the server. The job row is still `running`; after its deadline the reaper re-dispatches it; the service answers from its store. |

### 1.4 The live run

`npm run live -- --lines 4` (F) plays a new game and four scripted lines against the running dev stack with real models, and writes `v2/docs/live/v0-<date>.md`: the transcript, each turn's timings (said, first text, final, settled) from the `turn` rows, and its calls and cost. A turn costs about $0.004, so the run is under $0.05.

### 1.5 Local networking, and why not kind

SpacetimeDB 2.12's `ctx.http.fetch` refuses every RFC 6890 special-purpose address (loopback, 10/8, 172.16/12, 192.168/16, 100.64/10, link-local, ULA, documentation ranges), hard-coded, for literals and DNS answers alike. It allows any other address, including one local to the machine. So the module calls `http://11.0.0.1:8787` and the dev host makes that address reach the AI service:

| Mode | When | SpacetimeDB | AI service listens on | The module's `AI_URL` |
|---|---|---|---|---|
| host | `ip -4 addr show` has `inet 11.0.0.1/` (any interface) | on the host, `127.0.0.1:3300` | `11.0.0.1:8787` and `127.0.0.1:8787` | `http://11.0.0.1:8787` |
| namespace | otherwise; needs `/usr/bin/pasta` | inside `pasta --config-net -t 127.0.0.1/3300 --map-host-loopback 11.0.0.1`, listening on `0.0.0.0:3300` | `127.0.0.1:8787` on the host | `http://11.0.0.1:8787` |
| CI | GitHub runners have passwordless sudo | host mode after `sudo ip addr add 11.0.0.1/32 dev lo` | as host mode | as host mode |
| production | | a server with a public address | Cloud Run or Lambda, HTTPS | `https://…`, with `AI_TOKEN` |

Namespace mode was run tonight (in the scratchpad's `addr-test/pasta-map/`): from the host, `127.0.0.1:3398` reached SpacetimeDB in the namespace (ping, a new identity, an HTTP call of a procedure); the procedure's POST to `http://11.0.0.1:8789` reached a server on the host's `127.0.0.1:8789` (200); `127.0.0.1` from the procedure was refused; the forwarded port wasn't open on the LAN address. Two cautions from the runs: pasta's child lost its output when pasta's stdout was a file (spawn it with pipes and write the log yourself), and one run saw a refused connection that the next didn't (the doctor checks the path at every start).

Host mode for good on this machine: `sudo nmcli connection add type dummy ifname km0 con-name km0 ipv4.method manual ipv4.addresses 11.0.0.1/32 ipv6.method disabled`. The `/etc/hosts` name (`11.0.0.1 ai.kingmaker.test`) is optional: the dev host uses the address. 11.0.0.0/8 is a real public range; using one address of it locally shadows only that address.

**Kind wouldn't help:** pods and services in kind get 10.x addresses, which SpacetimeDB refuses the same way. Any local setup needs the AI service at a non-special address; the two modes above are the whole fix, and the dev host does it.

---

## 2. Layout

### 2.1 The tree

Every file V0 expects, with its job and its package (A–F, §11). "copy" means from the prototype at `44c6d4a` or from the scratchpad, with the edits named.

```text
v2/
  README.md                        what v2 is, the layout, the rules below, how to run (A; F updates)
  package.json                     client-files' package, V0 scripts (§2.2), exact versions, no new dependencies (A)
  package-lock.json                client-files' lock (A)
  tsconfig.json                    bundler resolution, strict; client, shared, ai, hosts, simulation/**/*.test.ts (A)
  .gitignore                       runs/ (A)
  shared/                          Node-free, ES2021, imports nothing outside shared/ (A)
    imports.test.ts                the rule, tested
    protocol/ai.ts                 the AI API's requests and answers (§5.2)
    protocol/keys.ts               idempotency keys and string ids (§3.7)
    protocol/refusals.ts           RefusalCode, the words, refusal(code, vars) (§3.4)
    markup.ts                      Markup types (client-files)
    dice.ts                        rng, rollCheck, describeRoll, titleCase, RollResult (copy src/runtime/dice.ts) + rollFrom(diceRow, …)
    dice.test.ts                   same seed, same rolls
    scene/types.ts                 Scene, Beat, Transition, Check, Exit, Essential, Character, Skill, SKILLS (copy src/runtime/scene.ts; Exit.script → effects; no Approach)
    scene/files.ts                 the campaign format: CampaignFile, SceneFile, RouteFile, Effect, PlaceFile, BuildsFile, LooksFile (content-world A4)
    scene/load.ts                  sections, items, sceneOf(file, words?) (the converter's loader, with file reads taken out)
    scene/graph.ts                 withImprovisedEnding, effectiveScene, currentBeat, targetTitle, visitedBeats, presentCast, spentHere, leftBehind, openRoutes, endsScene (copy brief.ts:27-106, 349-389; director.ts:55-58)
    scene/names.ts                 TITLES, heardIn, namedIn, knownCast, nameTokens, unnamed (copy brief.ts:108-163; not asHeard, strangers)
    scene/load.test.ts             campaigns/caerwyn loads: 5 beats, 37 routes, 5 exits (6 with own-ending), facts resolve
    gm/state.ts                    GmState, PathStep, OpenedNote, ScenePatch, initialGm(scene) (§6.1)
    world/scene-world.ts           the world (copy src/world/scene-world.ts whole; imports fixed; .at(-1) replaced)
    world/inventory.ts             (copy src/world/inventory.ts; node:crypto and the strict read/commit dropped)
    world/systems.ts               ignite, douse, spill, chill, bleed, break, PHYSICS (copy src/world/systems.ts; .at(-1) replaced)
    world/rows.ts                  PlaceRows, Keys, fullKey, localKey, worldToRows, rowsToWorld (copy tools/world-rows-check.mts; sort by entity.ord)
    world/rows.test.ts             the opening world through rows and back, and the check script's 7 turns of ops both ways: identical
  simulation/                      the SpacetimeDB module (A scaffolds; B builds)
    package.json                   the marker the CLI needs (client-files)
    tsconfig.json                  ES2021 + dom, bundler; src and ../shared; excludes **/*.test.ts and src/host/** (client-files + exclude)
    src/schema.ts                  every table and the env (§3.1); A writes it, B may add private tables only
    src/index.ts                   registration only: every reducer, procedure, view and lifecycle export (A; frozen)
    src/tables.ts                  plain metadata for the memory host: primary keys, autoInc, named indexes (B)
    src/context.ts                 TxCtx, txOf, Actor, Refused, asReducer, runMove, queueThink (§4.1) (B)
    src/moves/move.ts              Move, Next, AiCall (A: types, §4.1)
    src/moves/registry.ts          MOVES: say, openScene (B)
    src/moves/new-game.ts          newGame: the game, player, seat, sheet, dice, place, then openScene (B)
    src/moves/join-game.ts         joinGame: a spectator's seat (B)
    src/moves/open-scene.ts        openScene: resolve, think, commit (§4.3) (B)
    src/moves/say.ts               say: check, resolve, think, commit (decide, reply, settle, the wind-down) (§4.2) (B)
    src/moves/retry-turn.ts        retryTurn (B)
    src/gm/bookkeeping.ts          applyMove, takeMove, holdEnding, moveOnAfterReply, endingReached, whyItWaits, arrivals, reachEnding, settledFacts, keepOpened (copy engine.ts state parts; gm-port §6, §9) (B)
    src/gm/requests.ts             think's body: turnContext, openRequest and the four AiCalls (§6.2) (B)
    src/world/rows-io.ts           a place's rows as PlaceRows; a world written back (ids kept by key, new ones in order); the log appended (B)
    src/world/place.ts             openPlace: the place from place_def, the cast present, the purse, the build's gear (B)
    src/world/stage.ts             syncStage: on_stage and look rows from presentCast; heard rows from knownCast (B)
    src/jobs.ts                    queueThink's rows, claimJob, finishJob, failJob, reapJobs, retry (§3.5) (B)
    src/stream.ts                  streamReply's and servicePing's bodies (B)
    src/install.ts                 installCampaign's body (B)
    src/views.ts                   my_seat, my_names (B)
    src/stubs.ts                   A's stub bodies, each refusing "not_built"; B deletes it
    src/host/memory.ts             the in-memory host: tables, transactions, the job runner (§4.5) (B)
    src/**/*.test.ts               the moves and the job loop on the memory host (B)
  ai/                              the AI service; llm/, prompts/ and docs/ are shared with the prototype (C)
    README.md                      (exists) + the GM pipeline and the service
    imports.test.ts                (exists) widened: node:, ai/ and shared/ (A)
    llm/openrouter.ts              (exists) + the CallContext seam (§5.4)
    llm/decide.ts                  (exists) + JevDecider(model, name, calls?)
    llm/fake-openrouter.ts         (exists) + fakeFetch(options), streamMs, decisionDelayMs
    prompts/, docs/                (exist, unchanged)
    gm/view.ts                     TurnView and viewOf(request, scene): the request as the copied code reads it (gm-port §3)
    gm/working-set.ts              the docs service's WorkingSet from a TurnView (the prototype's src/lore/view.ts logic)
    gm/brief.ts                    sceneBrief, nowNote, outOfSight, castBlock, playerNow… (copy brief.ts, gm-port §15)
    gm/knowledge.ts                knowledgeBrief (copy knowledge.ts:29-81, 104-109)
    gm/markup.ts                   parseMarkup, markupOf (copy markup.ts:1-506, 635-660)
    gm/speakers.ts                 a speech tag to the cast key it names, when someone present answers to it
    gm/voice.ts                    gmReply, gmHistory, readReply, the repeat guard (copy voices.ts:1-156)
    gm/director.ts                 beforeQuestions, readBefore, pick, afterQuestions, readAfter, outOfCharacter (copy director.ts, trimmed to V0)
    gm/directives.ts               directivesFor and every directive's words (copy engine.ts, director.ts)
    gm/stage.ts                    stageManage: the stage manager's ops, returned, not applied (copy src/world/stage.ts)
    gm/golden/                     recorded prototype calls and sessions, and README.md: how they were recorded
    gm/parity.test.ts              V0's prompts against the prototype's (§10.2)
    service/context.ts             AiContext, Endpoint (§5.3)
    service/endpoints/open.ts      POST /v1/scenes/open
    service/endpoints/decide.ts    POST /v1/turns/decide
    service/endpoints/reply.ts     POST /v1/turns/reply
    service/endpoints/settle.ts    POST /v1/turns/settle
    service/endpoints/canned.ts    the four with no model (KM_AI_GM=canned): C's first deliverable, for bring-up
    service/server.ts              routes, the bearer token, JSON, answers by key, coalescing, errors, faults, shutdown
    service/stream.ts              the stream sink: throttled stream_reply over SpacetimeDB's HTTP API
    service/calls.ts               a request's CallContext: the model's fetch, its call log, the ledger, its Usage
    service/campaigns.ts           installed campaigns: PUT, each scene with its words, the docs service's lore root
    service/stores.ts              AnswerStore, CallLog, Ledger, CampaignStore (§5.6)
    service/folder-stores.ts       the folder implementations
    service/config.ts              AiConfig and readConfig(env): read only by hosts/ai.ts
    service/*.test.ts              endpoints on the fake model, the server, the stream, the stores
    Containerfile                  node:26.9.0-slim, ai + shared + hosts/ai.ts, no npm install (§5.7)
  client/                          talks only to SpacetimeDB (D)
    module_bindings/               generated by `npm run simulation:generate` from A's schema; committed; CI checks it (A; F regenerates)
    net/connection.ts              connect, subscriptions from my_seat, rows → SceneRows, the moves, refusals (§7)
    net/session.ts                 runs/play/<session>.json: the identity token
    scene/view.ts, rows.ts, model.ts, text.ts (+ tests)        from client-files, rows typed by the bindings
    ui/scene.tsx, reply.tsx, popover.tsx, overlay.tsx, common.tsx, theme.ts, reply.ts, busy.ts, commands.ts, app.tsx   from client-files
    check/screens.tsx, check/fixture.ts                        the screen check (client-files)
    demo.ts                        canned turns, no server (--demo)
    headless.ts                    the headless verbs over a Backend
  campaigns/caerwyn/               v2-research/caerwyn as converted (A), plus builds.json and looks.json (E)
  hosts/                           composition roots: the only code that reads env or argv
    ai.ts                          the AI service: env → config → stores → server (C)
    client.tsx                     the TUI: --session, --new, --build, --join, --demo (D)
    play.ts                        the headless client: new, join, observe, say, retry, transcript (D)
    campaign.ts                    the campaign tool: check (E)
    install.ts                     install a campaign into both services (E)
    dev.ts                         the dev stack, one command (E)
    dev/stack.ts                   startStack: the library the dev host and the e2e share (E)
    dev/mode.ts                    host or namespace; pasta's arguments (E)
    dev/spacetime.ts               start, publish with env, identities, HTTP calls and SQL as a given identity (E)
    dev/ai-process.ts              the AI service as a node process or a podman container (E)
    doctor.ts                      checks a running stack, both directions (E)
    local.ts                       the local host: the memory host with the AI service in-process (F)
    local.test.ts                  endings and turns on the local host, fake model (F)
    e2e.ts                         a line in a scene, end to end, with the kills (F)
    live-run.ts                    a short run with real models, recorded (F)
  docs/live/                       recorded live runs (F)
.github/workflows/v2.yml           check (A), e2e and container (F)
moon.yml                           sources += 'v2/shared/**/*' (A)
```

### 2.2 Package rules

- **Imports.** `shared/` imports only `shared/` (no `node:`, no packages). `simulation/src` imports `shared/`, `spacetimedb`, `spacetimedb/server` and itself, but only `index.ts` and `schema.ts` import `spacetimedb/server` at run time: every other file takes them as types only (`import type`), since `spacetimedb/server` doesn't load in Node and the memory host must load the rest. `ai/` imports `node:`, `ai/` and `shared/` (never a package, never the prototype). `client/` imports `shared/`, its packages and the bindings. `hosts/` may import anything in `v2/`. Nothing in `v2/` imports the prototype; nothing in `src/` imports `v2/` except the existing shims into `v2/ai`.
- **ES2021 in `shared/`** (the module's lib): no `.at`, `findLast`, `findLastIndex`, `Object.hasOwn`, `structuredClone`, `toSorted`. Copies fix them (`effectiveScene`'s `.at(-1)`, `leftBehind`'s `findLast`, the world's two `.at(-1)`).
- **Erasable syntax only, `.ts` extensions on every relative import.** `ai/`, `shared/` and `hosts/ai.ts` run under plain `node` (the container, and the prototype's `npm test`, which runs `v2/ai/**/*.test.ts`), so no JSX, no enums, no parameter properties, no extensionless imports, no JSON imports there.
- **Deterministic simulation code:** no `Math.random`, `Date.now()` or `new Date()` in `simulation/src` or `shared/` (time is `tx.now`, randomness the dice row or `tx.seed()`/`tx.uuid()`).
- **Scripts** (`v2/package.json`):

| Script | Command |
|---|---|
| `typecheck` | `tsc --noEmit -p . && tsc --noEmit -p simulation` |
| `test` | `node --no-warnings --import tsx --test 'shared/**/*.test.ts' 'simulation/**/*.test.ts' 'ai/**/*.test.ts' 'client/**/*.test.ts' 'hosts/**/*.test.ts'` |
| `screens` | `node --experimental-ffi --no-warnings --import tsx client/check/screens.tsx` |
| `check` | `npm run typecheck && npm test && npm run screens` |
| `simulation:build` | `spacetime build -p simulation` |
| `simulation:generate` | `spacetime generate --lang typescript --out-dir client/module_bindings --module-path simulation --no-config --yes` |
| `ai` | `node --no-warnings hosts/ai.ts` (plain node, as in the container) |
| `dev`, `doctor`, `campaign`, `install-campaign`, `play`, `e2e`, `live` | `node --no-warnings --import tsx hosts/<dev\|doctor\|campaign\|install\|play\|e2e\|live-run>.ts` |
| `client` | `node --experimental-ffi --no-warnings --import tsx hosts/client.tsx` |

### 2.3 Changes outside `v2/`

Only these, all in A: `moon.yml` sources gain `'v2/shared/**/*'` (the prototype's typecheck reaches `v2/shared` through `v2/ai`, so a change there must run its CI); `v2/ai/imports.test.ts` and `v2/ai/README.md`'s rule widen to `v2/shared`; `.github/workflows/v2.yml` is new. The root `tsconfig.json`, `package.json` and the other workflows don't change. C's edits to `v2/ai/llm` are shared code: the prototype's `npm run typecheck`, `npm test` and `npm run build:web` must pass at the repo root.

---

## 3. The protocol

### 3.1 Tables

Columns are the TypeScript names; SQL, HTTP and subscription queries use snake_case (`sceneId` → `scene_id`). Ids are `u64` (`bigint`). Every row belongs to one game. "pk" is the primary key; `auto` is `.autoInc()` (insert with `0n`); "ix" a btree index.

**Games and players**

| Table | Access | Columns |
|---|---|---|
| `game` | public | `id` pk auto · `uid` string unique (`tx.uuid()`: the game's id in every AI request, key and folder) · `campaign` · `campaignVersion` · `title` · `time` (morning…) · `day` u32 · `hostId` u64 · `status` (playing) · `createdAt` |
| `player` | public | `id` pk auto · `identity` ix · `gameId` ix · `name` · `concept` · `role` (host, spectator) · `characterId` option u64 · `placeId` option u64 · `sceneId` option u64 · `online` bool |
| `seat` | private, read through `my_seat` | `identity` pk · `playerId` |
| `sheet` | public | `playerId` pk · `gameId` ix · `build` ("elf ranger 3 (Hunter), criminal background") · `skills` (JSON `Record<Skill, number>`) · `statusLine` ("HP 28/28, spell slots 1st 3/3") |
| `dice` | private | `gameId` pk · `seed` u32 · `rolls` u32 |
| `admin` | private | `identity` pk · `role` (owner): `init` records the publisher |

**Scenes and turns**

| Table | Access | Columns |
|---|---|---|
| `scene` | public | `id` pk auto · `gameId` ix · `sceneKey` · `title` · `hook` · `kind` (scene) · `placeId` · `status` (opening, live, closing, ended) · `controllerId` (a player) · `turnId` option (the turn in flight: the lease) · `turns` u32 (the last turn's n) · `exitKey` option · `rev` u32 · `openedAt` · `endedAt` option |
| `gm_state` | private | `sceneId` pk · a column for each `GmState` field V0 uses (§6.1, and override 1 at the top): `beat`, `turnsInBeat`, `path`, `established`, `landed`, `hinted`, `opened`, `endingLead`, `pendingExit`, `closing`, `ended`, `sceneStatus`, `oocTurns`, `pressureOffered`, `repeated` |
| `on_stage` | public | `entityId` pk · `sceneId` ix · `role` (controller, cast) |
| `turn` | public | `id` pk auto · `gameId` · `sceneId` ix · `n` u32 (0 is the opening) · `playerId` · `phase` (queued, deciding, replying, settling, done, failed) · `note` option (while it waits on the AI service) · `error` option (the player's words when it failed) · `startedAt` · `firstTextAt` option · `endedAt` option · `calls` u32 · `costMicros` u64 |
| `transcript` | public | `id` pk auto · `gameId` · `sceneId` ix · `turn` u32 · `seq` u32 (per scene, from 1) · `speaker` (`player:<id>`, gm, dice, system) · `kind` (player, narration, dialogue, roll, system) · `text` · `markup` option (JSON `Markup`) · `at` |
| `reply_draft` | public | `turnId` pk · `sceneId` ix · `speaker` · `text` (all of it so far) · `markup` option · `attempt` u32 · `seq` u32 · `done` bool |
| `heard` | private, read through `my_names` | `id` pk auto · `gameId` · `playerId` ix · `entityKey` |

**The world** (content-world B2: a component holds only a field that moves out of `Entity` unchanged; every word stays in `narrative`). Each component table is keyed by `entityId`, with `placeId` copied in (ix) so a client can subscribe to one place.

| Table | Access | Columns |
|---|---|---|
| `place` | public | `id` pk auto · `gameId` ix · `key` (granary-yard) · `name` · `rootId` · `sizeW` f64 · `sizeH` f64 · `round` u32 · `rev` u32 · `sceneId` option |
| `entity` | public | `id` pk auto · `gameId` · `placeId` ix · `ord` u32 (insertion order: the renderers' order) · `key` (kell, pc:1, granary-yard/elm) · `parentId` option · `name` · `called` option · `kind` · `prefab` option · `createdTurn` option u32 · `gone` bool · index `byGameKey` (gameId, key), unique by a check in the write path |
| `position` · `area` · `material` · `health` · `stack` · `surface` · `creature` · `player_character` · `gear` | public | `x y` f64 · `x y w h` f64 · `material`, `size` options · `hp`, `maxHp` i32, `ac` option i32 · `quantity` i32 · `radiusFt` option f64, `roundsLeft` option i32 · `castKey`, `statblock`, `weapon` options · `playerId` · `engineItem` |
| `narrative` | public | `states` string[] · `tags` string[] · `notes` array of `WorldNote { text, turn u32, by }` (the last six) |
| `gm_note` | private | `description` |
| `world_log` | public | `id` pk auto · `placeId` ix · `seq` u32 · `round` u32 · `text` · `by` (author, rules, stage) · `cause` option |
| `look` | public | `entityId` pk · `placeId` ix · `role` · `glyph` · `fg` (the cast's colours, from `looks.json`) |

**Jobs**

| Table | Access | Columns |
|---|---|---|
| `job` | private | `id` pk auto · `key` unique (the current step's idempotency key) · `gameId` · `sceneId` · `turnId` · `move` (say, openScene) · `step` (open, decide, reply, settle) · `endpoint` · `timeoutMs` u32 · `request` (JSON, the POST body) · `plan` (JSON) · `state` ix (queued, running, waiting, failed) · `attempts` u32 · `deadline` option · `retryAt` option · `failingSince` option · `error` option · `updatedAt` |
| `job_dispatch` | private; schedule table → `run_job` | `scheduledId` pk auto · `scheduledAt` scheduleAt · `jobId` |
| `reaper` | private; schedule table → `reap_jobs` | `scheduledId` pk auto · `scheduledAt` (interval 2 s, inserted by `init`) |

**The campaign's simulation half**

| Table | Access | Columns |
|---|---|---|
| `campaign` | public | `id` pk ("caerwyn@0.1.0") · `key` · `version` · `title` · `json` (campaign.json) · `builds` (JSON builds.json) · `looks` (JSON looks.json) · `installedAt` |
| `scene_def` | private | `id` pk ("caerwyn@0.1.0/hanged-clerk") · `campaignId` ix · `key` · `title` · `hook` · `json` (scene.json whole: structure and its short logic text; no Markdown) |
| `place_def` | private | `id` pk · `campaignId` ix · `key` · `json` (places/<key>.json) |

**Env** (`schema(…, { env })`, all `t.option(t.string())`, set at publish): `AI_URL`, `AI_TOKEN` (the bearer the module sends), `AI_IDENTITY` (hex: the only caller of `stream_reply` and `service_ping`).

### 3.2 Views

| View | Returns | Body |
|---|---|---|
| `my_seat` | option `SeatView { playerId` pk `, gameId, placeId option, sceneId option, role }` | the caller's seat → player row |
| `my_names` | array `NameView { entityId` pk `, key, name }` | for the cast on the caller's scene's stage: `name` if the scene's controller has heard it (`heard`), else `called ?? name`. A spectator sees names as the controller knows them |

Both are `t.row` types with a primary key, so a change arrives as one `onUpdate`. There's no `my_jobs`: that view belongs to the worker design (spacetime.md §9.2), and in V0 nothing outside the module reads a job; clients see a job only through its turn's `phase` and `note`.

### 3.3 Reducers and procedures

| Export (wire name) | Args | Who | Checks | Writes |
|---|---|---|---|---|
| `newGame` (new_game) | `campaign, name, concept, build` (strings) | anyone | the campaign installed; the build in it; a name of 1–60 characters | game, player (host), seat (replaces any), sheet, dice (seed `tx.seed()`); then `openScene`'s resolve: the place and its world rows, the scene, gm_state, on_stage, look, heard, turn 0, the open job (§4.3) |
| `joinGame` (join_game) | `game` u64 | anyone | the game exists | player (spectator, no character; its scene), seat |
| `say` | `text` | a seated player | §4.2 | turn, transcript, scene; a job and a dispatch, or a queued turn |
| `retryTurn` (retry_turn) | `turn` u64 | the scene's controller | the turn is failed and holds the scene's lease | the job back to queued (attempts 0), a dispatch, the turn's phase back to its step's, its error cleared |
| `streamReply` (stream_reply) | `turnId` u64, `attempt` u32, `seq` u32, `speaker`, `text`, `markup` option, `done` bool | `AI_IDENTITY` | the turn is replying; `(attempt, seq)` after the draft's | the draft (insert, or update; a new attempt replaces the text), `turn.firstTextAt` once. A stale post is dropped silently |
| `servicePing` (service_ping) | none | `AI_IDENTITY` | | nothing: proves the AI service's token |
| `installCampaign` (install_campaign) | `id, campaign, scenes, places, builds, looks` (JSON strings) | admin | every scene loads (`sceneOf` without words) | campaign, scene_def, place_def rows, replacing that version's |
| `pingAi` (ping_ai), a procedure | none → string | admin | | GETs `${AI_URL}/v1/health` with the bearer (5 s timeout); returns `"200 in 3 ms: {…}"` or the error. Never throws |
| `runJob` (run_job), a scheduled procedure | the `job_dispatch` row | the scheduler only | §3.5 | §3.5 |
| `reapJobs` (reap_jobs), a scheduled reducer | the `reaper` row | the scheduler only | §3.5 | §3.5 |
| `init` | | the publisher | | `admin` (the publisher), the reaper's interval row |
| `onConnect`, `onDisconnect` | | anyone | a seated identity only | `player.online`. Every HTTP `/call` runs both: unknown identities and the AI's write nothing |

Scheduled functions guard with `ctx.sender.isEqual(ctx.databaseIdentity)` (the owner can call them over HTTP otherwise). `index.ts` only registers: each body is a plain function in another file taking a `TxCtx` (§4.1), so the memory host can call it. A refusal is thrown as `Refused` and becomes `SenderError(JSON.stringify(refusal))`; anything else thrown is a bug (a panic).

### 3.4 Refusals

The client parses `JSON.parse(err.message)` from the `SenderError` and shows `text` in the status line (`C.warn`).

| Code | When | The player sees |
|---|---|---|
| `not_in_game` | no seat | "(You're not in a game: start one with --new, or watch one with --join.)" |
| `unknown` | no such game or turn | "(There's no such game here.)" / "(There's no such turn.)" |
| `no_campaign` | newGame, the campaign isn't installed | "(There's no campaign called caerwyn here.)" |
| `no_build` | newGame, unknown build | "(There's no ready-made build called bard: there's ranger, rogue and wizard.)" |
| `bad_name` | newGame, no name or too long | "(Your character needs a name of 60 characters or fewer.)" |
| `not_ready` | say while the scene opens | "(The scene is still opening.)" |
| `scene_over` | say after the end | "(The scene is over.)" |
| `not_controller` | a spectator's line or retry | "(Wren Ashdown has the lead here: you're watching.)" |
| `turn_in_flight` | a line while deciding or replying, or a second queued line | "(The GM is still answering.)" |
| `turn_failed` | a line while a turn is failed | "(The GM lost the thread: /retry to carry on.)" |
| `empty_line` | nothing to say | "(Say something, or do something in *asterisks*.)" |
| `too_long` | over 2,000 characters | "(That's too much for one turn: 2,000 characters at most.)" |
| `not_failed` | retry of a turn that hasn't failed | "(That turn hasn't failed: there's nothing to retry.)" |
| `not_service` | stream_reply or service_ping from another identity | "Only the AI service may do that." |
| `not_admin` | install_campaign from anyone but the owner | "Only the database's owner may install a campaign." |
| `bad_pack` | a scene that doesn't load | "The campaign pack doesn't load: <why>." |
| `not_built` | A's stubs, until B lands | "(That isn't built yet.)" |

### 3.5 The job loop

```text
queued ──dispatch──▶ running ──200──▶ commit ──▶ queued (the next step, a new dispatch) │ done (row deleted)
                        │ 429, 5xx, refused, reset, timed out ──▶ waiting ──reaper, at retryAt──▶ queued
                        │ other 4xx, or the commit threw ──▶ failed (turn failed; retry_turn ──▶ queued)
                        └ past its deadline (the procedure died) ──reaper──▶ queued
waiting or running, failing for 10 minutes ──▶ failed
```

- **Queue** (`queueThink`, in the transaction of a resolve or a commit): `request = move.think(tx, plan)` reads the working set from the rows this transaction sees and builds the POST body. The job row is upserted (one per move in flight: inserted by resolve, rewritten by each commit) with the step's key, endpoint, timeout, request and plan, `state: queued`, `attempts: 0`; then a `job_dispatch` row at `tx.now`. It runs about 3 ms after the commit.
- **`run_job`**, one think per dispatch:
  1. `withTx(claimJob)`: the job must be `queued` (else a stale dispatch: return). `running`, `attempts + 1`, `deadline = now + timeoutMs + 10 s`. Returns `{ jobId, key, endpoint, request, timeoutMs, attempt }`.
  2. POST with nothing locked: `ctx.http.fetch(AI_URL + endpoint, { method: "POST", headers: { authorization: "Bearer " + AI_TOKEN, "content-type": "application/json", "idempotency-key": key, "x-km-attempt": attempt }, body: request, timeout })`. Classified: 200 → an answer; 429, 5xx, an `HttpError` (refused, reset, DNS, timeout) or unreadable JSON → retry; any other status → fatal; no `AI_URL` → fatal ("the AI service isn't configured").
  3. `withTx(finishJob)`. **The revision check:** the job must still be `running` with `attempts === attempt` (else the reaper re-dispatched it and this answer is dropped); for an answer, the scene's lease must still be this turn and the scene not ended (else stop, keeping any reply already committed). Then `move.commit(tx, plan, answer)`, the answer's usage added to the turn (`calls`, `costMicros`), `turn.note` cleared, and either `queueThink` for the next step or the job row deleted. A retry: `waiting`, `retryAt = now + 1, 2, 4, 8, then 15 s`, `failingSince` kept from the first failure, `turn.note = "The GM has lost the thread for a moment: trying again."`. Fatal: `failJob`.
  4. If `finishJob` throws (a bug), a fresh `withTx(failJob)` records it, so a bug fails the turn rather than looping.
- **`failJob`:** job `failed` with its error; the turn `failed`, `error` = "The GM couldn't answer: <short reason>"; the draft deleted; the lease kept, so the scene waits for `/retry`.
- **`reap_jobs`** (every 2 s): `waiting` jobs whose `retryAt` has passed → queued + dispatch; `running` jobs past their deadline → queued + dispatch, logged "re-dispatched after its deadline"; `queued` jobs untouched for 10 s with no `job_dispatch` row → a dispatch; anything failing for 10 minutes → `failJob`.
- **Timeouts** (the POST's, under the 180 s cap): open 60 s, decide 20 s, reply 60 s, settle 60 s.
- **`withTx` may run its body twice:** `claimJob`, `finishJob` and every commit are pure functions of the rows, the plan and the answer (the dice are a row; nothing outside the transaction is touched or cached).
- **The pool:** each think holds one procedure isolate for its length. The dev host writes `[v8] procedure-instance-pool-size = 16` into `<data-dir>/config.toml` before the first start (a pre-written file is kept: checked tonight). Reducers aren't held up by waiting procedures (spike Q1).
- **Logs** (`console.info`, read with `spacetime logs`): `[job 7 <key> attempt 2] 200 in 2410 ms: committed`, `… refused: waiting, retry in 2 s`, `[reaper] job 7 re-dispatched after its deadline`.

### 3.6 Identities, tokens, env

- **The owner:** the dev host gets an identity (`POST /v1/identity`), logs the CLI in with it (`--config-path runs/dev/cli.toml`), and publishes; `init` records it in `admin`. It calls `install_campaign` and `ping_ai` over HTTP with its token.
- **The AI service:** its own identity from `POST /v1/identity` (once; kept in `runs/dev/stack.json`). Its hex goes to the module as `AI_IDENTITY`; its token to the service as `KM_STDB_TOKEN`. Tokens are signed by the server's keys (`runs/dev/keys`), so they survive `--fresh`.
- **The bearer:** 32 random bytes, hex, made once per stack: the module's `AI_TOKEN` and the service's `KM_AI_TOKEN`.
- **Publish:** `AI_URL=http://11.0.0.1:8787 AI_TOKEN=… AI_IDENTITY=… spacetime --config-path runs/dev/cli.toml publish kingmaker -s kingmaker-dev -p simulation --no-config --yes=migrate,break-clients,skip-login --delete-data=on-conflict` (the dev host logs loudly when a conflict wiped the data). `--env-only` changes the values without a publish. Never a bare `--yes`.

### 3.7 Keys and ids

- **The idempotency key:** `${game.uid}:s${sceneId}:t${n}:${step}` (step: open, decide, reply, settle), e.g. `5f0c…:s1:t3:reply`. The same step of the same turn always has the same key, across retries, re-dispatches and `retry_turn`. The uid makes keys and the AI service's folders unique across databases, so a fresh database can't be answered from an old game's store.
- **Ids in JSON** (requests, plans) are strings; rows keep `bigint`s. JSON arguments to reducers over HTTP carry u64s as numbers (ids stay far below 2^53).
- **Entity keys** (content-world B3): cast by cast id (`kell`), a player's character `pc:<playerId>`, the root the place key, everything else `<place>/<id>`. Prompts and `applyOps` see local keys (the controller's character is `player`); `SettleResponse.ops` name entities by game key; `fullKey` and `localKey` in `shared/world/rows.ts` convert on both sides.

---

## 4. Moves on the SpacetimeDB host

### 4.1 The interface

CS §3's four phases, with one change: `think` runs inside the transaction that queues the job, reading the rows, so the request is exactly the state the commit's revision check compares against, and the stored request can be re-POSTed after any crash.

```ts
// simulation/src/moves/move.ts (A)
export interface Move<Args, Plan> {
  readonly name: string;
  /** May this actor make this move now? Runs in the reducer only in V0 (the client mirrors say's in view.mayType). */
  check?(tx: TxCtx, actor: Actor, args: Args): Refusal | undefined;
  /** In the reducer's transaction: record the move, roll, change the world; done, or a plan to think about. */
  resolve(tx: TxCtx, actor: Actor, args: Args): Next<Plan>;
  /** In the same transaction as the resolve or commit that made the plan: the request to POST next. */
  think?(tx: TxCtx, plan: Plan): AiCall;
  /** In run_job's withTx, after the revision check: apply the answer; done, or the next plan. */
  commit?(tx: TxCtx, plan: Plan, answer: unknown): Next<Plan>;
}
export type Next<Plan> = { done: true } | { done: false; plan: Plan };
export interface AiCall { endpoint: Endpoint; key: string; timeoutMs: number; request: OpenRequest | DecideRequest | ReplyRequest | SettleRequest }

// simulation/src/context.ts (B)
export type Db = ReducerCtx<InferSchema<typeof spacetimedb>>["db"];      // import type: the module's own tables
export interface TxCtx {
  db: Db;                  // ctx.db, or the memory host's tables: the same accessors (tx.db.scene.id.find(…))
  now: Timestamp;          // ctx.timestamp
  env: Env;                // AI_URL, AI_TOKEN, AI_IDENTITY
  uuid(): string;          // ctx.newUuidV4().toString()
  seed(): number;          // ctx.random.integerInRange(0, 999_999_999): a new game's dice seed
  log(line: string): void; // console.info
}
export function runMove<A, P>(tx: TxCtx, move: Move<A, P>, actor: Actor, args: A): void {
  const refusal = move.check?.(tx, actor, args);
  if (refusal) throw new Refused(refusal);
  const next = move.resolve(tx, actor, args);
  if (!next.done) queueThink(tx, move, next.plan);          // the job row (plan + request) and a dispatch, in this transaction
}

// simulation/src/index.ts (A): registration only
export const say = spacetimedb.reducer({ text: t.string() }, (ctx, args) => asReducer(ctx, tx => runMove(tx, sayMove, actorOf(tx, ctx.sender), args)));
export const runJob = spacetimedb.procedure({ onSchedule: jobDispatch }, { arg: jobDispatch.rowType }, t.unit(), (ctx, { arg }) => {
  if (!ctx.sender.isEqual(ctx.databaseIdentity)) return {};
  const claim = ctx.withTx(tx => claimJob(txOf(tx, ctx.env), arg.jobId));
  if (!claim) return {};
  const outcome = postToAi(ctx, claim);                                // ctx.http.fetch: synchronous, nothing locked
  try { ctx.withTx(tx => finishJob(txOf(tx, ctx.env), claim, outcome)); }
  catch (e) { ctx.withTx(tx => failJob(txOf(tx, ctx.env), claim, `the commit failed: ${String(e)}`)); }
  return {};
});
```

### 4.2 `say`

```ts
// simulation/src/moves/say.ts (B)
export const say: Move<{ text: string }, SayPlan> = {
  name: "say",
  check(tx, actor, { text }) {
    const scene = seatScene(tx, actor);                        // the scene the caller's seat is on
    if (!scene) return refusal("not_in_game");
    if (scene.status === "opening") return refusal("not_ready");
    if (scene.status === "ended") return refusal("scene_over");
    if (scene.controllerId !== actor.id) return refusal("not_controller", { name: controllerName(tx, scene) });
    const line = text.trim();
    if (!line) return refusal("empty_line");
    if (line.length > 2000) return refusal("too_long");
    const inFlight = scene.turnId === undefined ? undefined : tx.db.turn.id.find(scene.turnId);
    if (inFlight?.phase === "failed") return refusal("turn_failed");
    if (inFlight && (inFlight.phase !== "settling" || queuedTurn(tx, scene))) return refusal("turn_in_flight");
  },
  resolve(tx, actor, { text }) {
    const scene = seatScene(tx, actor)!, line = text.trim(), n = scene.turns + 1;
    const waits = scene.turnId !== undefined;                  // a turn is settling: this one starts when it's done
    const turn = tx.db.turn.insert({ ...newTurn(tx, scene, actor, n), phase: waits ? "queued" : "deciding" });
    addEntry(tx, scene, { turn: n, speaker: `player:${actor.id}`, kind: "player", text: line });
    tx.db.scene.id.update({ ...scene, turns: n, turnId: waits ? scene.turnId : turn.id, rev: scene.rev + 1 });
    return waits ? { done: true } : { done: false, plan: startPlan(tx, scene, turn, line) };   // onStage, settledBefore, windDown from gm_state
  },
  think: (tx, plan) => sayCall(tx, plan),                      // gm/requests.ts: decide, reply or settle (§6.2)
  commit(tx, plan, answer) {
    if (plan.step === "decide") return afterDecide(tx, plan, answer as DecideResponse);
    if (plan.step === "reply") return afterReply(tx, plan, answer as ReplyResponse);
    return afterSettle(tx, plan, answer as SettleResponse);  // ends by starting a queued turn, if there is one
  },
};
```

### 4.3 `openScene`, and `newGame` that starts it

```ts
// simulation/src/moves/open-scene.ts (B)
export const openScene: Move<{ game: bigint; sceneKey: string }, OpenPlan> = {
  name: "openScene",
  resolve(tx, actor, { game, sceneKey }) {
    const def = sceneDefOf(tx, game, sceneKey);                // the scene_def row of the game's campaign version
    const graph = effectiveScene(sceneOf(JSON.parse(def.json) as SceneFile), []);   // shared loader, structure only: no words
    const place = openPlace(tx, game, def, actor);             // world/place.ts: buildWorld, joinWorld, purse, gear → rows
    const scene = tx.db.scene.insert({ ...newScene(tx, game, def, place, actor), status: "opening" });
    putGm(tx, scene, initialGm(graph));
    syncStage(tx, scene, graph);                               // on_stage (the controller, the present cast), look, heard (the hook's names)
    const turn = tx.db.turn.insert({ ...newTurn(tx, scene, actor, 0), phase: "replying" });
    tx.db.scene.id.update({ ...scene, turnId: turn.id });
    return { done: false, plan: { step: "open", game: str(game), scene: str(scene.id), turn: str(turn.id), seen: revs(tx, scene) } };
  },
  think: (tx, plan) => openCall(tx, plan),                     // POST /v1/scenes/open, 60 s, key <uid>:s<id>:t0:open
  commit(tx, plan, answer) {
    const a = answer as OpenResponse;                          // gm.opened = keepOpened(gm.opened, a.opened)
    // the opening entry (turn 0, gm, narration, markup); the draft deleted; heard rows; scene live; turn 0 done; lease released
    return { done: true };
  },
};

// simulation/src/moves/new-game.ts (B): a reducer that creates the game, then runs openScene's resolve
export function newGameReducer(tx: TxCtx, sender: Identity, args: NewGameArgs): void {
  const campaign = campaignOf(tx, args.campaign);            // refusals: no_campaign, no_build, bad_name
  const game = createGame(tx, campaign, sender, args);       // game (uid), player (host), seat, sheet, dice
  runMove(tx, openScene, actorOf(tx, sender), { game: game.id, sceneKey: campaign.firstScene });
}
```

### 4.4 Shared code and host code

| Shared (`v2/shared`, pure) | Simulation, host-independent (`simulation/src`, plain functions over `TxCtx`) | SpacetimeDB-only (`index.ts`) |
|---|---|---|
| protocol types, refusals, keys; the scene's types, loader, graph helpers and names; `GmState`; dice; the world and its rows mapping | the moves; the bookkeeping in commits; `think`'s request builders; rows I/O; the job functions; the views' and stream's bodies | table builders, registration, `txOf`, `asReducer`, `postToAi` (`ctx.http.fetch`), `withTx` |

### 4.5 The local in-memory host

`simulation/src/host/memory.ts` (B) runs the same move and job functions with no SpacetimeDB:

- **Tables:** a `Proxy` that answers every accessor the moves use (`insert`, `iter`, `count`, `<column>.find/filter/update/delete`, and the named multi-column indexes from `tables.ts`) over `Map`s, with autoInc and `bigint` keys, typed as `Db`. Values use the `spacetimedb` package's `Timestamp`, `Identity` and `ScheduleAt`, which load in Node.
- **Transactions:** each call runs against the live maps with an undo journal; a throw rolls every write of the call back.
- **The clock:** `now` advances only when a test says so (`advance(ms)`); `seed()` and `uuid()` come from a fixed sequence per host, so a test replays.
- **Jobs:** `drain()` takes every due `job_dispatch` row and runs `claimJob`, then an injected `ai(endpoint, body, headers) → { status, body }` (async), then `finishJob`, until nothing is due; `advance()` runs `reapJobs`.
- **API:** `memoryHost({ seed, ai })` → `{ db, as(identity).{ newGame, joinGame, say, retryTurn }` (each returns a `Refusal` or nothing)`, streamReply(args), drain(), advance(ms) }`.

B's tests drive it with a scripted `ai` (answers as JSON). F's `hosts/local.ts` passes the AI service's server handler instead, in process, every body serialised as JSON: that's the design's local host, V0-sized.

---

## 5. The AI service

### 5.1 HTTP API

| Method and path | Body → answer | Model calls in V0 |
|---|---|---|
| `POST /v1/scenes/open` | `OpenRequest` → `OpenResponse`; streams the opening | `memory.disclose.*` (Jev, per scope), `gm.opening` (Luna) |
| `POST /v1/turns/decide` | `DecideRequest` → `DecideResponse` | `memory.disclose.*` beside `director.before` (Luna decisions); on a wind-down only `director.ooc` |
| `POST /v1/turns/reply` | `ReplyRequest` → `ReplyResponse`; streams the reply | `gm.reply`, or `gm.closing` on a wind-down |
| `POST /v1/turns/settle` | `SettleRequest` → `SettleResponse` | `world.stage` (Luna, low) beside `director.after` (skipped when the reply closed the scene) |
| `PUT /v1/campaigns/{campaign}/{version}` | `{ files: Record<path, text> }` (the whole campaign folder) → `{ campaign, version, files, scenes }` | none |
| `GET /v1/health` | → `{ ok, model: "openrouter"\|"fake", gm: "pipeline"\|"canned", campaigns: ["caerwyn@0.1.0"], token: "accepted"\|"refused"\|"absent", stdb?: "ok"\|<error> }` | none; `?deep=1` calls `service_ping` as itself |

- **Headers in:** `Authorization: Bearer <KM_AI_TOKEN>` (every route but health), `Idempotency-Key` (must equal `body.key`), `X-Km-Attempt` (the stream's attempt). **Out:** `X-Km-Replayed: 1` when served from the store.
- **Statuses:** 200 the answer; 400 `bad_request` (unreadable, key mismatch, unknown scene, campaign not installed); 401 `unauthorised`; 409 `other_campaign` (V0's one lore root, §5.5) or `key_reused` (the same key with a different request body); 500 `model_failed` (after `v2/ai/llm`'s own retries); 503 `not_ready` (shutting down). Errors are `{ error: { code, message } }`. The module retries 429 and 5xx, fails the turn on the rest.
- **Answers by key:** look the key up first (a hit returns the stored answer, no model call); coalesce a concurrent duplicate onto the request in flight; otherwise run, store `{ requestHash, body }` under the key, then answer. Stored before answering, so a crash after the store is recoverable.
- **Faults (tests only):** `KM_AI_FAULTS=exit-after-store:<step>|any` makes the process exit (code 137) right after storing such an answer, before answering.
- **Limits:** 2 MB for a POST body, 16 MB for the PUT.

### 5.2 The request and answer types

`v2/shared/protocol/ai.ts` (A). CS §4's, amended as gm-port §13 says, with the world as `PlaceRows` and markup on entries.

```ts
// types from shared/: Markup (markup.ts), GmState and OpenedNote (gm/state.ts), Skill (scene/types.ts),
// RollResult (dice.ts), PlaceRows (world/rows.ts), WorldOp (world/scene-world.ts)
export type Endpoint = "/v1/scenes/open" | "/v1/turns/decide" | "/v1/turns/reply" | "/v1/turns/settle";

/** Every request: which game and content, who's playing, and the key that makes a retry safe. */
export interface AiRequest {
  key: string;                                         // <game uid>:s<scene>:t<n>:<step>, also the Idempotency-Key header
  game: { id: string; campaign: string; version: string };   // id: game.uid
  player: { id: string; name: string };                // the scene's controller
}
export interface Usage { calls: number; costUsd: number; byOperation: Record<string, { calls: number; costUsd: number; ms: number }> }
export interface Entry { turn: number; speaker: string; kind: "player" | "narration" | "dialogue" | "roll" | "system"; text: string; markup?: Markup }
export interface SheetRow { name: string; concept: string; build?: string; skills: Partial<Record<Skill, number>>; status?: string }
export interface Story { time: string; day: number; flags: Record<string, string> }
export interface Reply { speaker: "gm"; kind: "narration"; text: string; markup?: Markup }   // markup: speech with cast keys where they resolve

/** A turn's working set, read in the transaction that queued the think: everything the GM may need. */
export interface TurnContext {
  scene: { id: string; key: string; kind: "scene"; turn: number };
  pc: string;                                          // the controller's character's key ("pc:1"): the world's "player"
  gm: GmState;                                         // §6.1
  transcript: Entry[];                                 // the scene's, with this turn's line and dice lines
  line: { speaker: string; text: string };             // speaker "player:<id>"
  world: PlaceRows;                                    // the place's rows, ids as strings, the log's last six
  party: SheetRow[];                                   // V0: the controller's sheet only
  present: Array<{ key: string; name: string; called?: string }>;   // advisory: the service runs presentCast itself
  story: Story;
}

export interface OpenRequest extends AiRequest {
  scene: { id: string; key: string; kind: "scene" };
  pc: string; gm: GmState; world: PlaceRows; party: SheetRow[]; story: Story;
  stream: { turn: string };
}
export interface OpenResponse { present: string[]; entries: Reply[]; opened: OpenedNote[]; usage: Usage }

export interface Check { skill: Skill; dc: number; reason?: string }
export interface Decision {
  route?: { id: string; phase: "attempt" | "cue"; check?: Check; theirs?: boolean };   // a route and its check, the skill already the player's means
  plain?: string;                                      // an outcome route the turn simply achieves (== route.id: it ends the scene now)
  sameAgain?: { route: string; answer?: string };
  earned: boolean; daft: boolean; outOfCharacter: boolean;
  limit?: string; answering?: boolean; remembered?: string[];
}
export interface DecideRequest extends AiRequest { turn: TurnContext; landed: string[] }     // landed: [] in V0 (no world clock)
export interface DecideResponse { decision: Decision; opened: OpenedNote[]; usage: Usage }

export interface Outcome {                             // what the decide commit did: the reply builds its directives from it
  lines: string[];                                     // this turn's dice lines
  directives: string[];                                // the rules' lines: [] in V0
  move?: { route: string; phase: "attempt" | "cue"; from: string; to: string; roll?: RollResult; exit?: string; chosen: boolean };
  taken?: { ended?: string; closing?: string; pendingExit?: string };
  held?: "ooc" | "brink" | "closes";
  pending?: { exit: string };
  wasStuck: boolean;
  closes?: string;
  windDown?: { exit: string };
}
export interface ReplyRequest extends AiRequest { turn: TurnContext; decision: Decision; outcome: Outcome; stream: { turn: string } }
export interface ReplyResponse { entries: Reply[]; gm: { offered?: string; repeated: string | null }; firstTextMs: number | null; usage: Usage }

export interface SettleRequest extends AiRequest { turn: TurnContext; reply: string; lines: string[]; settled: string[] }   // reply: plain text
export interface After {
  outcome?: { route: string; check?: Check };
  ending?: { exitId: string; probability: number };
  status?: "on_track" | "drifting" | "stuck" | "uncovered";
  landed: string[]; hinted: string[]; unanswered: boolean; theirs: boolean;
}
export interface SettleResponse { ops: WorldOp[]; after?: After; usage: Usage }   // ops: at most 16, by game key; after absent when the reply closed the scene

export interface AiError { error: { code: "bad_request" | "unauthorised" | "other_campaign" | "key_reused" | "model_failed" | "not_ready"; message: string } }
```

### 5.3 The pipeline, per endpoint

Ported per gm-port: the copied functions keep their bodies; `SessionState` becomes `TurnView` (gm-port §3), a structural subset of it under the same field names, built by `viewOf(request, scene)` with every later-vertical field empty. The service's constants are the `v2` approach's: memory on, the comic tone, effort none, essentials shown, the `luna-decisions` decider, staging off.

| Endpoint | Flat steps | gm-port |
|---|---|---|
| open | `scene = campaign.scene(key)`; `view = viewOf(req)`; the player's doc ensured; `disclose(workingSet(view), "", jev)` (best effort); `gmReply(…, [openingDirective], "gm.opening")` streamed; `{ present: presentCast, entries: [reply], opened }` | §5 |
| decide | wind-down (`gm.closing`): `outOfCharacter` only. Otherwise `disclose` beside `beforeQuestions` → one `director.before` call → `readBefore` → `pick` (no roll); `remembered` from a note opened at p ≥ 0.9 | §6, §10 |
| reply | `directivesFor(scene, view, decision, outcome)` (pure, the prototype's strings exactly) → `gmReply` streamed (`gm.closing` on a wind-down that isn't out of character) → `readReply` → speech tags mapped to cast keys; `gm.offered` and `gm.repeated` | §8, §10 |
| settle | `stageManage(rowsToWorld(world), …)` (ops cut to 16, local keys → game keys) beside `afterQuestions` → `director.after` (skipped when `gm.ended`) → `readAfter` | §9 |

**Left out of V0** (gm-port §11): considered rolls, mechanics and spells, threats and reactions, the co-GM, memory reviews, suggested lines, notes on marks (marks are parsed and kept; the client draws a mark only when it has a note), full speaker attribution, staged secrets, talks, boundaries and exit effects.

```ts
// ai/service/context.ts (C)
export interface AiContext {
  campaign: Campaign;            // the request's campaign version: each scene with its words (cached: it never changes)
  calls: CallContext;            // this request's model transport, call log and usage
  stream: StreamSink;            // the reply as it's written (a no-op for decide and settle)
  attempt: number;               // X-Km-Attempt
}
export type Handler<Req, Res> = (req: Req, ctx: AiContext) => Promise<Res>;
```

### 5.4 The model client seam (shared code)

`v2/ai/llm` is the prototype's too, so every change is optional and leaves today's behaviour untouched when it isn't used:

```ts
// ai/llm/openrouter.ts (C): one request's model calls
export interface CallContext {
  fetch?: typeof fetch;                                              // OpenRouter, or fakeFetch
  apiKey?: string;
  log?(entry: Record<string, unknown>): void;                        // games/<uid>/calls.jsonl
  cost?(line: { provider: string; operation: string; model: string; costUsd: number; latencyMs: number }): void;   // Usage and the ledger
}
// RespondRequest gains `calls?: CallContext`; fetchWithRetry(url, init, label, calls?); logCall and recordCost go to
// calls.log and calls.cost when given (and touch no module state). JevDecider(model, name, calls?).
// fake-openrouter.ts: fakeFetch(options) returns { fetch, asked, sent } with nothing global; fakeOpenRouter() installs
// it globally as today. New options: streamMs (a streamed reply sent word by word over that long), decisionDelayMs.
```

The service makes one `CallContext` per request (`service/calls.ts`): `fetch` is `globalThis.fetch` (or `fakeFetch` when `KM_AI_MODEL=fake`, options from `KM_AI_FAKE` as JSON), `apiKey` from config, `log` to the game's call log (each entry with the request's key and attempt, so a test can count the model calls a key cost), `cost` into the request's `Usage` and the ledger. Disclosure takes it through the decider it's handed (`disclose(workingSet, line, new JevDecider(JEV_MODEL, "jev", calls))`: already a parameter); the director's decider is `new JevDecider(LUNA_DECISIONS_MODEL, "luna-decisions", calls)`; `gmReply` and `stageManage` pass `calls` to `respond`.

### 5.5 Docs and prompts

- **Prompts:** `prompt(name, vars)` from `v2/ai/prompts` as it is (cached by name: they never change).
- **Docs:** the docs service as it is. `configureDocs({ loreRoot: <store>/campaigns/<c>/<v>/lore, overlay: game => <store>/games/<uid>/docs })`. `loreRoot` is one per process, so V0's service serves one campaign version: the first request (or PUT) sets it, and a request for another version gets 409 `other_campaign`. `gm/working-set.ts` builds the docs service's `WorkingSet` from the `TurnView`; `memoryBrief(ws, "stable" | "live")` gives the two lore blocks; disclosure's `opened` goes back in the answer, and the simulation keeps it in `gm.opened`.

### 5.6 Stores

```ts
// ai/service/stores.ts (C)
export interface StoredAnswer { requestHash: string; status: 200; body: string; at: string }
export interface AnswerStore { get(key: string): Promise<StoredAnswer | undefined>; put(key: string, answer: StoredAnswer): Promise<void> }
export interface CallLog { append(game: string, entry: Record<string, unknown>): void }     // synchronous, like logCall
export interface Ledger { append(line: Record<string, unknown>): void }
export interface CampaignStore { put(campaign: string, version: string, files: Record<string, string>): Promise<void>; root(campaign: string, version: string): string | undefined }
export interface Stores { answers: AnswerStore; calls: CallLog; ledger: Ledger; campaigns: CampaignStore; docsRoot: string }
```

The folder implementation (`KM_AI_STORE`, a volume in the container): `answers/<encodeURIComponent(key)>.json` (older than 7 days swept at start), `games/<uid>/calls.jsonl`, `ledger.jsonl`, `campaigns/<c>/<v>/…` (the folder as PUT), `games/<uid>/docs/…` (the docs service's overlay; an async interface over it waits until the docs service leaves synchronous `fs`, a change to code the prototype shares).

### 5.7 Config, statelessness, the container

| Env | Default | What |
|---|---|---|
| `KM_AI_LISTEN` | `127.0.0.1:8787` | comma-separated `host:port`s (host mode: `11.0.0.1:8787,127.0.0.1:8787`) |
| `KM_AI_TOKEN` | required | the bearer the module sends |
| `KM_AI_STORE` | `runs/ai` | the folder store |
| `KM_STDB_URL`, `KM_STDB_DB`, `KM_STDB_TOKEN` | `http://127.0.0.1:3300`, `kingmaker`, none | where stream_reply goes, as which identity (without a token, nothing streams; answers still work) |
| `OPENROUTER_API_KEY` | `~/secrets/kingmaker-dev-openrouter.txt` via `apiKey()` | the only key |
| `KM_AI_MODEL`, `KM_AI_FAKE` | `openrouter`, none | `fake`: `fakeFetch(JSON.parse(KM_AI_FAKE ?? "{}"))` |
| `KM_AI_GM` | `pipeline` | `canned`: the four endpoints with no model |
| `KM_AI_STREAM_MS`, `KM_AI_FAULTS` | `200`, none | the stream's period; test faults (§5.1) |

- **Stateless:** nothing about a game survives a request in memory: no session, no world, no call-log path, no spend, no "current scene". Allowed: caches of what never changes (prompts, an installed version's scenes, the docs service's per-campaign registries) and the map of requests in flight. SIGTERM: stop accepting, finish what's in flight (10 s), exit.
- **The container** (`v2/ai/Containerfile`): `FROM docker.io/library/node:26.9.0-slim`; `WORKDIR /srv/kingmaker`; copy `package.json` (for `"type": "module"`), `ai/`, `shared/`, `hosts/ai.ts`; `ENV KM_AI_STORE=/data KM_AI_LISTEN=0.0.0.0:8787`; `VOLUME /data`; `USER node`; `CMD ["node", "--no-warnings", "hosts/ai.ts"]`. No `npm install`: the service has no dependencies. Built from `v2/`: `podman build -f ai/Containerfile -t kingmaker-ai .`. The dev host runs it with `podman run --rm --name kingmaker-ai-dev --network=host -v runs/dev/ai:/data:Z -e KM_AI_LISTEN=… -e KM_AI_TOKEN -e KM_STDB_URL -e KM_STDB_DB -e KM_STDB_TOKEN -e OPENROUTER_API_KEY kingmaker-ai` (`--network=host`, so the listen addresses and SpacetimeDB's loopback port work as for a process). Tests and the e2e run plain `node hosts/ai.ts`.

### 5.8 The stream

`service/stream.ts` (C): for open and reply, `respond`'s `onText(raw)` runs `parseMarkup(raw, { final: false })`; the sink posts when the shown text has grown and 200 ms have passed since the last post (the first at once): `POST ${KM_STDB_URL}/v1/database/${KM_STDB_DB}/call/stream_reply`, `Authorization: Bearer ${KM_STDB_TOKEN}`, body `{"turnId": 812, "attempt": 2, "seq": 5, "speaker": "gm", "text": "…", "markup": {"some": "<json>"}, "done": false}` (named arguments by their TypeScript names; `markup` `{"none": []}` when empty). The last post carries `readReply`'s final text with `done: true`, then the answer goes back. Posts are fire-and-forget in order (one in flight at a time; a newer text replaces a waiting one); a failure is logged and never fails the request. On a restart from the top (a two-phase reply), `seq` keeps rising and the text may shrink: a draft isn't committed text. `firstTextMs` is from the request to the first post.

---

## 6. The simulation's side of a turn

### 6.1 `GmState` and the plans

```ts
// shared/gm/state.ts (A): the prototype's field names, so the copied code reads it unchanged
export interface GmState {
  beat: string; turnsInBeat: number;
  path: PathStep[];                    // { turn, from, to, via, roll?: RollResult, source: "pre" | "post" | "repair", known?: number }
  established: string[];               // fact texts (content-world A7)
  landed: string[]; hinted: string[];
  opened: OpenedNote[];                // { path, title, scope, turn }, the newest 24
  endingLead?: { exitId: string; count: number; probability: number };
  pendingExit?: { exitId: string; turn: number; via: string; extended: boolean; waits?: string };
  closing?: { exitId: string; turn: number };
  ended?: { exitId: string; turn: number };
  sceneStatus?: "on_track" | "drifting" | "stuck" | "uncovered";
  oocTurns: number[]; pressureOffered: string[]; repeated?: string;
  // later verticals: always empty in V0, but read by copied code
  canon: string[]; patches: ScenePatch[]; entered: string[]; absent: string[];
  notes: string | null; whispers: Array<{ to: string; note: string; turn: number }>;
}
export function initialGm(scene: Scene): GmState;     // beat = scene.start, everything else empty
```

Copied code that reads any other `SessionState` field (`rulings`, `fought`, `guard`, `threat`…) gets its empty value from the `TurnView` (C) or is trimmed (B). Turn numbers are per scene (`turn.n`) everywhere: `path`, `oocTurns`, `pendingExit.turn`, `closing.turn`.

```ts
// simulation/src/moves/say.ts (B): the plan, saved in the job row
interface SayPlan {
  step: "decide" | "reply" | "settle";
  game: string; scene: string; turn: string; n: number; player: string;
  input: string;
  onStage: string[];        // presentCast as the player spoke: whyItWaits' arrivals
  settledBefore: string[];  // settledFacts(gm) at the turn's start: the stage manager's `settled`
  windDown: boolean;        // gm.closing was set when the turn started
  decision?: Decision; outcome?: Outcome; reply?: string;
  lines: string[];          // this turn's dice lines
  seen: { scene: number; place: number };
}
```

### 6.2 The commits, in order

Each is one `withTx`, a pure function of the rows, the plan and the answer; each ends with `queueThink` for the next step or `{ done: true }`.

- **After decide** (gm-port §6): `gm.opened = keepOpened(…)`. A wind-down: `oocTurns` if out of character; `outcome.windDown`; on to the reply. Otherwise, the pending ending taken off; a route: `moveOf` rolls its check from the dice row (`rollCheck(rng(seed + 7919 × ++rolls), skill, dc, sheet.skills[skill] ?? 0)`), the dice line into the transcript (`dice`, `roll`), `applyMove(…, "pre")`, `takeMove` (closing, ended, pendingExit); a same push again into `path`; `oocTurns`; `holdEnding` (ooc, brink, closes); `gm.ended` when this reply closes the scene. The turn `replying`; the plan's `outcome` and `lines`; think: `ReplyRequest`.
- **After reply** (gm-port §8): the GM's entry (narration, with markup); the draft deleted; `gm.pressureOffered`, `gm.repeated`; `joinWorld` for whoever a cue brought on, and `syncStage`; heard rows. A wind-down not out of character: `closing` deleted, the scene ended (status, `exitKey`, `endedAt`, the system entry "Scene ends: <title>"), the turn `done`, the lease released, a queued turn cancelled ("The scene ended first."). A wind-down out of character: the turn `done`. Otherwise the turn `settling` (the box opens); think: `SettleRequest`.
- **After settle** (gm-port §9, content-world B4): the ops mapped to local keys and applied through the gate (`applyOps` on the world rebuilt from rows; at most 16; each problem logged as `(not done) <problem>`, by stage); a removed player put back (`(not done) remove: the player leaves only by walking out`); the rows written back. Unless the scene closes in this reply: `gm.sceneStatus`; landed and hinted; `moveOnAfterReply` (an outcome route, its check rolled, `applyMove(…, "post")`; `whyItWaits`; `reachEnding`) or `endingReached`. `joinWorld` again; `turnsInBeat++` when no step changed the beat and the turn wasn't out of character. `gm.closing` set → the scene `closing`; `gm.ended` → the scene ended as above. The turn `done`, the lease released; then a queued turn starts (`startPlan`, deciding, the lease, its job).
- **After open:** §4.3.

### 6.3 The world and the gate

- **The code:** `shared/world/scene-world.ts`, `inventory.ts`, `systems.ts` are the prototype's, copied whole with four edits (content-world B5: drop `node:crypto` and the strict read/commit; two `.at(-1)`; the tsconfig flags A already has). `shared/world/rows.ts` is the check script's `worldToRows`/`rowsToWorld`/keys, sorting by `entity.ord`. Quirks carry over unfixed (content-world B2's list).
- **Building the place** (`simulation/src/world/place.ts`): `buildWorld(sceneKey, placeDef, presentCast, { name })`, `joinWorld`, the campaign's starting purse into the player's hands, the build's gear as `<first>-<item>` items (`in hand` or `worn`, `gear` set: engine.ts:182-188), then the rows. Entity ids are SpacetimeDB's; `rows-io.ts` keeps them by key and gives new entities the next `ord`.
- **Applying ops:** read the place's rows (the log's last six only), `rowsToWorld`, `applyOps(world, ops, n, "stage")`, write back only rows that changed, delete rows of entities that vanished (a stack that joined another), append new log lines with `round = n`, `place.rev + 1`.
- **Names heard:** after every transcript write, `knownCast(scene, transcript)` (shared, with the hook) for the controller; new keys become `heard` rows. `my_names` reads them.

### 6.4 Dice

The `dice` row is the game's only randomness after its creation: `{ seed, rolls }`, advanced in the commit's transaction, so a re-run `withTx` rolls the same and a game replays. V0 rolls only route checks (decide commit) and outcome-route checks (settle commit). The prototype rolls through the rules engine when there's a sheet; V0 uses its no-sheet `rollCheck` until the rules engine arrives, so the same seed doesn't give the prototype's rolls.

---

## 7. The client

- **Connection** (`client/net/connection.ts`, D): `DbConnection.builder().withUri(KM_STDB_URL).withDatabaseName(KM_STDB_DB).withToken(session.token).withAutomaticReconnect(…)`; the token saved on connect (`runs/play/<session>.json`); defaults from `runs/dev/stack.json`, else `ws://127.0.0.1:3300` and `kingmaker`. Subscribe `SELECT * FROM my_seat`; on each seat, swap (subscribe the new set, then drop the old):

```sql
SELECT * FROM my_names
SELECT * FROM game WHERE id = {g}          SELECT * FROM player WHERE game_id = {g}
SELECT * FROM sheet WHERE game_id = {g}    SELECT * FROM scene WHERE game_id = {g}
SELECT * FROM transcript WHERE scene_id = {s}    SELECT * FROM reply_draft WHERE scene_id = {s}
SELECT * FROM turn WHERE scene_id = {s}          SELECT * FROM on_stage WHERE scene_id = {s}
SELECT * FROM look WHERE place_id = {p}
```

  Every `onInsert`/`onUpdate`/`onDelete` of those rebuilds `SceneRows` from `conn.db` (coalesced to one rebuild per tick) and calls `model.update(sceneViewOf(rows))`. Moves: `say`, `retryTurn`, `newGame`, `joinGame`; a rejection's `SenderError` message is the `Refusal` JSON, its `text` goes to `rows.refusal`. Row callbacks fire before a call's promise resolves: guard nothing by "my call is in flight". For the e2e it exposes `onEvent((table, op, row) => …)`, every row event in arrival order.
- **Rows → view** (`client/scene/rows.ts`): client-files' `sceneViewOf`, with the bindings' row types and four changes: `mayType` when the controller's scene is `live` or `closing` and the phase is idle, settling or done; the draft keyed by `(attempt, seq)`; `view.note` from `turn.note` (shown in `C.warn` in place of the spinner's line); spectators get `watching: <controller's name>`.
- **The screen:** client-files' scene screen, model, popover and help as verified (364 lines; 96 checks). Additions: the spectator's closed box line, the game's number in the side panel, a mark drawn only when it has a note.
- **Headless** (`hosts/play.ts` over `client/headless.ts`): `new --session <s> --as "Name: concept" [--build id] [--campaign caerwyn]` (the build defaults to `ranger`, the campaign to `caerwyn`; waits for the opening), `join --session <s> --game <id>`, `observe`, `say <text> [--wait settled] [--stream]`, `retry`, `transcript`. Output is client-files' `viewText` (`MODE: scene`, `[The Hanged Clerk, morning] Here: …`, the last 8 entries, the draft, the refusal or note, and the `PHASE:` line telling the agent whose turn it is). A refusal exits 1; a failed turn exits 1 with `PHASE: failed (…). Use: retry`.
- **The screen check:** `npm run screens`, client-files' 96 checks plus the spectator, the note and a draft restarting at attempt 2.

---

## 8. The campaign install

- **The folder** (`v2/campaigns/caerwyn`, A copies `v2-research/caerwyn` as converted): `campaign.json`, `scenes/hanged-clerk/` (scene.json and its Markdown), `places/granary-yard.json`, `lore/` (154 docs). E adds:
  - `builds.json`: `{ "<id>": { build, level, skills (all 18), status, gear: [{ id, name, kind, slot? }] } }` for `ranger`, `rogue`, `wizard`, dumped once from the prototype's rules engine by a scratch script (outside v2) and committed as data;
  - `looks.json`: `{ "<cast id>": { role, glyph, fg } }` from the prototype's `CAST` table (`src/game/map/looks.ts:17-40`), so Kell is `#6d9eeb`.
- **The check** (`npm run campaign -- check campaigns/caerwyn`, E): the converter's checks that need no prototype (content-world A10): every scene loads with its words; fact ids resolve; route targets, `onSuccess`/`onFailure` and exits exist; keys named in effects and `afterwards` exist in the place or the cast; the place's people match the cast; thing parents exist; lore and fronts paths exist; builds have all 18 skills; looks name cast ids.
- **The install** (`npm run install-campaign -- campaigns/caerwyn`, E; the dev host runs it at every start, idempotently): the check; then **the words**: `PUT /v1/campaigns/caerwyn/0.1.0` with every file of the folder (the service needs the graph as well as the prose: content-world A1); then **the structure**: `install_campaign` over HTTP as the owner, with campaign.json, each scene.json, each place, builds and looks. A game keeps the version it started on. Re-installing a version replaces it (a dev convenience; a real release bumps the version).

---

## 9. Running it

### 9.1 The dev host (`npm run dev`, E)

`hosts/dev.ts` is a thin CLI over `hosts/dev/stack.ts`, which the e2e shares:

```ts
export interface StackOptions {
  root: string;                         // runs/dev, runs/e2e
  stdbPort: number; aiPort: number;     // 3300 and 8787 for dev; 3310 and 8797 for the e2e
  mode?: "host" | "namespace";          // detected when absent
  model: "openrouter" | "fake"; fake?: FakeOptions; gm?: "pipeline" | "canned";
  container?: boolean; fresh?: boolean; aiEnv?: Record<string, string>;
}
export interface Stack {
  mode: "host" | "namespace"; http: string; ws: string; db: string;
  aiFromHost: string; aiFromSimulation: string;
  owner: { identity: string; token: string };
  ai: { identity: string; token: string; bearer: string; start(env?: Record<string, string>): Promise<void>; stop(signal?: NodeJS.Signals): Promise<void>; exited(): Promise<number> };
  stdb: { start(): Promise<void>; stop(): Promise<void> };
  call(reducer: string, args: unknown, as?: "owner" | "ai"): Promise<string>; sql(query: string): Promise<unknown[]>;
  install(campaignDir: string): Promise<void>; doctor(): Promise<DoctorReport>; down(): Promise<void>;
}
export function startStack(options: StackOptions): Promise<Stack>;
```

Steps, in order:
1. **Check tools:** Node ≥ 26.4; `spacetime --version` is 2.12.0; `pasta` for namespace mode; `podman` for `--container`.
2. **Mode:** host if `ip -4 addr show` has `inet 11.0.0.1/`, else namespace (`--mode` overrides).
3. **Folders** under the root: `stdb/` (data, with `config.toml`'s pool size written first), `keys/`, `cli.toml`, `ai/` (the store), `logs/`, `stack.json`. `--fresh` deletes `stdb/`, `ai/` and `runs/play/`; the keys stay.
4. **SpacetimeDB:** host mode: `spacetime --config-path <root>/cli.toml start --listen-addr 127.0.0.1:<port> --data-dir <root>/stdb --jwt-pub-key-path <root>/keys/id_ecdsa.pub --jwt-priv-key-path <root>/keys/id_ecdsa --non-interactive`. Namespace mode: the same command after `pasta --config-net --quiet --foreground --tcp-ports 127.0.0.1/<port> --map-host-loopback 11.0.0.1 --`, listening on `0.0.0.0:<port>` inside. Spawned with pipes; the host writes `logs/spacetime.log`. Wait for `GET /v1/ping`.
5. **Identities:** the owner and the AI service from `POST /v1/identity` (kept in `stack.json`); the CLI's server `kingmaker-dev` added once (`--no-fingerprint`) and logged in as the owner; the bearer made once.
6. **Publish** with the env (§3.6).
7. **The AI service:** `node --no-warnings hosts/ai.ts`, or the container (§5.7), with `KM_AI_LISTEN` per mode (§1.5), `KM_AI_TOKEN`, `KM_AI_STORE=<root>/ai`, `KM_STDB_URL=http://127.0.0.1:<port>`, `KM_STDB_DB=kingmaker`, `KM_STDB_TOKEN`, `KM_AI_MODEL`, `OPENROUTER_API_KEY` (read from the secrets file when the env has none). Log: `logs/ai.log`. Wait for `/v1/health`.
8. **Install** the campaign (§8).
9. **Doctor** (§9.2); then the screen in §1.1 and the keys. `stack.json` gets the pids, URLs, tokens and mode (local dev credentials, gitignored), so `client`, `play`, `install-campaign` and `doctor` find the stack.
10. **Down** on `q`, Ctrl+C or SIGTERM: the AI service, then SpacetimeDB (pasta ends with its child).

Logs: `runs/dev/logs/{spacetime,ai,dev}.log`; the module's own with `spacetime --config-path runs/dev/cli.toml logs kingmaker -s kingmaker-dev -f`.

### 9.2 The doctor (`npm run doctor`, E)

Checks a running stack and prints each with a fix: Node and CLI versions; the mode and whether 11.0.0.1 is local; pasta or podman as needed; SpacetimeDB's ping; the module published (`SELECT * FROM campaign`); the env set and `AI_IDENTITY` matching the stack's; the pool size; the AI service's health from the host; **the module reaches the AI service** (`ping_ai` as the owner: "200 in 3 ms"); **the AI service reaches the module as itself** (`/v1/health?deep=1` → `service_ping`); the campaign in both.

---

## 10. Tests

### 10.1 Unit tests (`npm test`, offline)

| Where | What |
|---|---|
| `shared/` (A) | the imports rule; the scene loader on caerwyn; the world through rows and the 7 turns of ops both ways (identical worlds, changes, problems and views); dice determinism |
| `simulation/` (B), on the memory host | new_game → the opening job → its commit (live, turn 0 done, heard); say → decide (a route with a check: the dice line from the seed) → reply → settle (ops through the gate, problems logged, the player's "gone" undone) → done; every refusal; a queued line started by the settle commit; retry with backoff (waiting → reaper → queued); a stale attempt's answer dropped; a `running` job past its deadline re-dispatched; failed → `retryTurn`; a commit that throws fails the turn; the wind-down ends the scene; stream_reply's rules (service only, attempt and seq, stale posts dropped) |
| `ai/` (C) | each endpoint on `fakeFetch`; the server (bearer, idempotency: a second POST of a key is answered from the store with no model call; a concurrent duplicate coalesces; `key_reused`; 400, 401, 500 mapping; `exit-after-store`); the stream sink against a stand-in HTTP server (throttle, rising seq, attempt, done, failures ignored); the folder stores; servers in tests on port 0 (the prototype's `npm test` runs these too); the copied tests worth keeping (gm-port §16.2: markup's cut points, the prompt-content tests, `knowledgeBrief`, the stage manager's schema ids; director cases against `beforeQuestions`/`readBefore`/`pick`) |
| `client/` (D) | rows → view (client-files' 3, plus spectators, notes, attempts); text (2); `npm run screens` |
| `hosts/` (E, F) | E: the mode's detection and pasta's arguments; the campaign check. F: `local.test.ts` (below) |

### 10.2 Prompt parity (C)

The acceptance test for the AI service (gm-port §16.1). A script outside v2, with the prototype's tools ([tools/record-golden.mts](../../tools/record-golden.mts); [ai/gm/golden/README.md](../ai/gm/golden/README.md) says how to run it), runs the prototype at `44c6d4a` under `fakeOpenRouter({ choices, replies })` with `KM_CALL_LOG` set: `createSession` (no backstory) and `openScene` for the hanged clerk, then three `playerTurn`s: a plain question to Kell; `catch-moll` (scripted `attempt`); an out-of-character question. It wraps the fake's fetch to capture a deep copy of the session at each model call. It writes `v2/ai/gm/golden/hanged-clerk/*.json`: each call's operation and body, and the session as it stood. `parity.test.ts` turns each session into the V0 request (`worldToRows` for the world, the gm fields, the transcript, the sheet), runs V0's code for that call under `fakeFetch` with the same options, and compares:
- **byte for byte:** `gm.opening` and `gm.reply` (instructions and input), `world.stage` (instructions, input, schema), each `memory.disclose.*` (state and questions);
- **`director.before` and `director.after`:** the state string byte for byte, and each question V0 asks equal to the prototype's question of that id (V0 asks fewer: gm-port §6, §9).

The reply's outcome comes from the captured session (its roll), so parity doesn't depend on V0's dice. Any difference that remains (the notes on marks, say) is listed in `golden/README.md` with its reason and pinned by the test.

### 10.3 The local host (F)

`hosts/local.test.ts`: the memory host with the AI service's handler in process and the fake model, every body through JSON. gm-port §16.4's endings scenarios (an out-of-character turn doesn't move the clock; an ending not the player's doing waits, a brink answer holds it once, then it lands; an ending the player chose gets one wind-down; an unanswered question holds an ending; an out-of-character word never closes one), gates.test.ts's same push again and an ending that leads twice; the same seed and lines give the same dice lines twice.

### 10.4 End to end (`npm run e2e`, F)

A real SpacetimeDB (data in `runs/e2e`, ports 3310 and 8797), the AI service as `node` on the fake model, two clients over `client/net/connection.ts` recording every row event they see. Host mode in CI; namespace mode here.
1. Start the stack (`--fresh`), install, doctor.
2. A: `newGame`; the opening streams (A saw at least two draft updates before the transcript entry); scene `live`.
3. B: `joinGame`. A says a line; B's line is refused `not_controller`; A's second line at once is refused `turn_in_flight`. Done. A's and B's event logs for the turn are identical (phases, draft `(attempt, seq)`s, transcript rows).
4. **Killed mid-reply:** the AI service restarted with `streamMs: 3000`; A says a line; at the first draft, SIGKILL; `turn.note` appears; start it again; the turn is done with one GM entry; the draft reached attempt 2; `gm.reply` twice for that key in the call log.
5. **Kept answer:** restarted with `KM_AI_FAULTS=exit-after-store:settle`; A says a line; the process exits after storing; start it without the fault; done; `world.stage` once for that key; the service logged "from the store".
6. **SpacetimeDB restarted mid-think:** restarted with `decisionDelayMs: 3000`; A says a line; a second after the turn enters `deciding` (the decide POST is in flight), stop SpacetimeDB and start it on the same data, the clients reconnecting; done within 60 s; `director.before` once for that key; the module logged "re-dispatched after its deadline".
7. **An ending:** fake choices that reach `case-made`; the wind-down line; `gm.closing`; "Scene ends: The Hanged Clerk"; the scene ended; a further line refused `scene_over`.
8. Down. It prints each turn's first-text latency and exits 0.

### 10.5 CI (`.github/workflows/v2.yml`)

- **check** (A): Node 26.9.0, `npm ci` in `v2/`, `npm run typecheck`, `npm test`, `npm run screens`, and the bindings are current (`npm run simulation:generate && git diff --exit-code client/module_bindings`, which needs the CLI: install it as in e2e).
- **e2e** (F): the pinned CLI (`curl -sSf https://install.spacetimedb.com | sh -s -- --yes`, then `spacetime version install 2.12.0 --use --yes`), `sudo ip addr add 11.0.0.1/32 dev lo`, `npm run e2e`; the logs uploaded on failure.
- **container** (F): `podman build -f ai/Containerfile -t kingmaker-ai .`, run it on the fake model, `GET /v1/health`.
- The prototype's `check.yml` runs on any PR touching `v2/ai` or `v2/shared` (moon's sources): its typecheck and tests cover the shared code.

### 10.6 The live run (F)

`npm run dev`, then `npm run live -- --lines 4` (§1.4). The recorded run is committed under `v2/docs/live/` and summarised in F's PR.

---

## 11. Work packages

Branches: A `claude/v2-v0-contracts` from `claude/v2-ai-shared`; B `-simulation`, C `-ai`, D `-client`, E `-dev`, each from A; F `-integration` from A, merging B, C, D, E in that order. One PR each, stacked on A; F's on A shows the joins. (Overridden: one PR, `claude/v2-v0`; B to E built on `claude/v2-v0-sim`, `-ai`, `-client` and `-dev`. See the note at the top.) After A merges into the branches, only F edits A's files; a package that needs something in `shared/` writes a local helper and says so in its PR, and F folds it in.

### A: contracts (alone, first)

- **Owns:** `v2/package.json`, lock, `tsconfig.json`, `.gitignore`, `README.md`; all of `v2/shared/`; `simulation/package.json`, `tsconfig.json`, `src/schema.ts`, `src/index.ts`, `src/moves/move.ts`, `src/stubs.ts`; `client/module_bindings/`; `v2/campaigns/caerwyn/` (the converted copy); `v2/ai/imports.test.ts` and its README rule; `moon.yml`; `.github/workflows/v2.yml` (check job).
- **Builds against:** this doc; client-files (the package, tsconfigs, markup types); content-world (rows); gm-port §12-13 (types).
- **Done when:** `npm ci && npm run check` pass in `v2/` (the shared tests included); `npm run simulation:build` succeeds; the bindings are generated and committed; a scratch publish answers `spacetime call new_game` with the `not_built` refusal; at the repo root `npm run typecheck` and `npm test` pass (the widened rule).
- **Must not touch:** the prototype's code; `v2/ai/{llm,prompts,docs}`.

### B: the simulation

- **Owns:** `v2/simulation/src/**` except `schema.ts`'s public tables, `index.ts` and `moves/move.ts`; deletes `stubs.ts`. May add private tables and columns (the bindings check must stay green).
- **Builds against:** the schema, `shared/` (protocol, scene, gm state, dice, world), §3-§6.
- **Done when:** the memory-host tests in §10.1 pass; the module publishes to a scratch server in namespace mode and plays a game against a 40-line stand-in AI server on the host (canned JSON answers for the four endpoints, a few `stream_reply` posts): the opening commits, three lines reach `done`, a stand-in killed mid-turn shows `waiting` then finishes once it's back; `run_job`'s log lines appear in `spacetime logs`.
- **Must not touch:** `shared/`, `ai/`, `client/`, `hosts/`.

### C: the AI service

- **Owns:** `v2/ai/gm/**`, `v2/ai/service/**`, `v2/ai/Containerfile`, `hosts/ai.ts`, the edits to `v2/ai/llm/*` (§5.4) and to `v2/ai/README.md`; the golden recording script (built in the scratchpad; now `tools/record-golden.mts`).
- **Builds against:** `shared/protocol/ai.ts`, `shared/scene`, `shared/gm/state.ts`, `shared/world`; gm-port (the copy list, §15); this §5.
- **Order:** the seam and `canned.ts` first (so E and F can bring the stack up), then the pipeline, then parity.
- **Done when:** §10.1's AI tests and §10.2's parity pass; `npm run ai` with `KM_AI_GM=canned` answers all four endpoints and streams to a stand-in; the image builds and answers `/v1/health`; at the repo root `npm run typecheck`, `npm test` and `npm run build:web` pass (the prototype still works through the shared llm code).
- **Must not touch:** `shared/`, `simulation/`, `client/`, `hosts/` other than `ai.ts`; the prototype's `src/`.

### D: the client

- **Owns:** `v2/client/**` except `module_bindings/`; `hosts/client.tsx`, `hosts/play.ts`.
- **Builds against:** the generated bindings, `shared/markup.ts`, `shared/protocol/refusals.ts`, client-files, §7.
- **Done when:** rows and text tests and the screen check pass; `npm run client -- --demo` and `npm run play -- say --session d --demo "…"` work; the connection typechecks against the bindings and, once B has published, `play new`/`observe` run against a scratch stack (B's stand-in AI is enough).
- **Must not touch:** anything outside its files.

### E: the campaign, the install, the dev host

- **Owns:** `campaigns/caerwyn/{builds,looks}.json`; `hosts/campaign.ts`, `hosts/install.ts`, `hosts/dev.ts`, `hosts/dev/**`, `hosts/doctor.ts`; the builds/looks dump script (scratchpad).
- **Builds against:** the schema's reducer names and args (§3.3), the env (§3.6), the AI service's config and HTTP API (§5.1, §5.7), `shared/scene` (the check).
- **Done when:** the campaign check passes; `npm run dev -- --fake` brings the stack up in namespace mode here (host mode runs in F's CI), with the doctor's both directions green, against the real AI service once C's canned endpoints exist (a stand-in before that); `k`, `s`, `r`, `p`, `q` work; `--container` runs the image; `npm run doctor` reports a stopped AI service with its fix.
- **Must not touch:** `shared/`, `simulation/`, `ai/`, `client/`.

### F: integration

- **Owns:** `hosts/local.ts`, `hosts/local.test.ts`, `hosts/e2e.ts`, `hosts/live-run.ts`, `docs/live/`, the e2e and container jobs in `v2.yml`; after merging B-E, any file, to make them meet; the bindings' regeneration.
- **Done when:** `npm run check` and §10.3 pass; `npm run e2e` passes here (namespace mode) and in CI (host mode); the container job is green; the live run is recorded; `v2/README.md` says how to run all of it; the PR describes the demo in §1.

---

## 12. Risks and open questions

- **Procedures are "unstable" in 2.12.** Pin the CLI and the npm package at 2.12.0 exactly; the worker design (spacetime.md §9.2) stays the documented fallback, and the requests and answers don't change between the two.
- **Namespace mode rests on one evening's runs**, with one unexplained refused connection. The doctor checks the path at every start; host mode is one `sudo` away.
- **The shared llm seam touches the prototype.** Every new parameter is optional and the prototype's checks run on every PR that touches `v2/ai`; still, a careless edit there breaks both.
- **Parity of the decider's questions is per question, not per request,** because V0 asks fewer (no considered rolls, mechanics, co-GM). The GM's own prompts must match byte for byte.
- **One campaign version per AI service process** (the docs service's lore root is global). Fine for V0; the docs service needs a lore root per game before a second campaign.
- **Reducer time:** the settle commit rebuilds the place from rows and runs `applyOps`; reducers serialise. Log each commit's time; at 38 entities it should be milliseconds.
- **A retried reply restarts the draft,** so watchers see text shrink and regrow. Accepted: only the transcript is never taken back.
- **The 10-minute give-up** turns a long AI outage into a failed turn and a `/retry`; the scene's lease is kept meanwhile.
- **Open for the user:** spectators instead of watchers with characters (the multiplayer vertical brings characters, hand-offs and the prompts that know two players); and whether the GM pipeline should next be shared with the prototype through shims, as the docs service is, so the two can be iterated on together.

---

## 13. Departures from the design

| The design says (CS; gm-port or v2-ai where named) | V0 does | Why |
|---|---|---|
| `think` runs outside any transaction, from the plan | it runs inside the transaction that queues the job and reads the rows; the request is stored | the request is exactly what the revision check compares against, and a crash can re-POST it unchanged |
| `move_plan` + `job` (schedule) + `job_run` | one `job` row per move in flight, plus `job_dispatch` (schedule) and `reaper` | one durable record per move, the schedule row being consumed at dispatch (spike gotcha 5) |
| `runJob` loops think/commit in one procedure; `callAi` retries with backoff | one think per dispatch; retries and stuck jobs re-dispatched by the reaper | `ctx.sleep` throws; one path for retries, crashes and re-dispatch; ~3 ms a step |
| the `service` table (identity, url, token) | env values `AI_URL`, `AI_TOKEN`, `AI_IDENTITY` | set by the owner at publish, changeable with `--env-only`, read in reducers and procedures |
| `installCampaign` procedure fetching from the AI API | an owner-only reducer given the structure; the words PUT by the install tool | no procedure for an admin action; each service gets its half from the same pack |
| `scene_def` without prose | scene.json whole (its `when`s, check lines, fact texts); no Markdown | the bookkeeping reads the prototype's Scene shape; the short logic text is in the JSON by the design's own rule |
| `gm_state` in columns | (not taken: override 1 keeps typed columns) | |
| watchers are characters in the place | spectators, with no character | keeps the GM single-player and parity intact; real watchers come with multiplayer |
| `check` shared with the client | in the simulation only; the client's `mayType` mirrors `say`'s | V0 has one move a client offers; shared checks come with the action menu |
| the world's components as in CS §2 | content-world B2's set; every word in `narrative` (+ `tags`, `ord`) | the gate and the renderers stay the prototype's code |
| `transcript`, `reply_draft`, `scene` as listed | `markup` on both, `attempt` on the draft, `title` and `hook` on the scene, `note`, `calls`, `costMicros` on the turn | the client's gaps (client.md §9), retries, and the live run's numbers |
| `streamReply(turn, seq, speaker, text, done)` | plus `attempt` and `markup` | a re-dispatched reply replaces its draft; the screen colours speech as it streams |
| request types of CS §4 | gm-port §13's, `pc` in place of `line.player`, `PlaceRows`, no `heard` (the simulation works names out itself) | what the copied code needs, and nothing it doesn't |
| the AI's game id is the game's | `game.uid`, a UUID | keys and folders unique across databases |
| caps, usage, budget | none; each turn's calls and cost on its row | V0 has one player and the developer's key |
| a round of the world's clock each turn | none (`landed` is `[]`) | nothing in a plain conversation burns; the world vertical brings it |
| dice through the rules engine | `rollCheck` from the dice row | the rules engine comes with the mechanics vertical |
| the GM bookkeeping in `shared/` (gm-port §3) | in `simulation/src/gm` | only the simulation runs it; the AI service needs only the read-only helpers, which are in `shared/scene` |
| v2-ai's rule: `v2/ai` imports only itself | itself and `v2/shared` | the AI service and the module share the protocol, the scene graph and the world; neither imports the prototype |

---

## 14. As built

V0 keeps to this blueprint, but for the overrides at the top and these, each with its reason. The packages' reports and the PR give the full account.

| The blueprint says | V0 does | Why |
|---|---|---|
| The scene's last line reads "Scene ends: The Hanged Clerk" (§1.2, §10.4) | "Scene ends: " and the exit's title: "Scene ends: The case is made" | As the prototype writes it (engine.ts:995): the line says how the scene ended |
| `After.outcome` is `{ route, check? }` (§5.2) | It also carries `exit`, the authored ending an improvised outcome gives way to | The prototype moves the improvised ending onto a plausible authored one (director.ts:1330-1333); without it the scene would end as "an ending of their own" |
| A line queued when the scene ends is cancelled (§6.2) | Its turn ends `done`, with the error "The scene ended first." | There's no `cancelled` phase, and the turn row still says what happened |
| A decision that names a route not open from the beat fails the turn | It moves nothing, and the module logs it | A retry would get the same kept answer, and fail again |
| `new_game` takes the campaign's key | `caerwyn` (the newest installed version) or `caerwyn@0.1.0` | A game names its version from the start |
| `not_in_game` says "start one with --new, or watch one with --join" (§3.4) | "(You're not in a game: start one, or watch someone's.)", and each client adds its own way: the TUI's flags, the headless client's verbs | The flags are the TUI's alone: the headless client starts and watches with `play new` and `play join --game <n>` |
| `say` refuses `not_ready` while the scene opens (§4.2), before it looks at the turn | Only while the opening is in flight. Once it has failed, a line gets `turn_failed`, "(The GM lost the thread: /retry to carry on.)", as on any failed turn (a spectator, `not_controller`); the headless client adds `play retry` | The opening is turn 0, holding the scene's lease: "(The scene is still opening.)" told the player to wait for what only /retry brings |
| `new_game` limits the name (§3.4) | The concept too: 300 characters at most, or `bad_concept`, "(Your character's concept needs to be 300 characters or fewer.)" | The concept is in every request the game sends, and in several of the GM's prompts: a long one costs at every model call, and one past the AI service's 2 MB would leave the game unable to open |
| `speakers.ts` maps a speech tag to a cast key; full speaker attribution waits (§2.1, §5.3) | The prototype's whole `speakers.ts`, with `withSpeakers` | The GM's history, which writes the markup back, matches the prototype's for any reply, and the client colours more of the speech |
| Marks are parsed and kept, and drawn only with a note (§5.3) | A reply's marks are dropped (`marks: []`) | Nothing writes their notes in V0, and the GM's own words on a mark must never reach the screen |
| The AI service's call log has each call when it's done | Each call also when it starts | A call killed mid-flight leaves a line, so a test can count what a key cost |
| The client's moves reject with a `SenderError` (§7) | Each answers the refusal, parsed (or `{ code: "error" }` for a lost connection), or nothing | One shape for the screen, the headless client and the e2e |
| `startStack` installs the campaign and runs the doctor (§9.1) | The caller does both (`stack.install`, `stack.doctor`) | The dev host and the e2e want them at different moments |
| Down stops SpacetimeDB, and pasta ends with its child (§9.1) | SpacetimeDB is sent SIGINT, and the stop waits for its whole process group | In namespace mode it's PID 1 of pasta's PID namespace, which drops a signal it has no handler for: SIGTERM ended pasta and left SpacetimeDB running |
| The ranger's build line has a criminal background (§3.1's example) | Soldier, as the prototype's rules engine builds its elf ranger | `builds.json` is the engine's own output |
| The e2e's step 4: "the draft reached attempt 2" | Attempt 2 or later | The reaper's backoff decides which attempt finds the AI service back |
| The owner's reducers are `install_campaign` and `ping_ai` (§3.3) | Also `dispatch_waiting`: every waiting job dispatched now, not at its retry time. The dev host calls it once `s`, `r` or `f` has started the AI service | The backoff (§3.5) held a turn up to 15 s after `s` brought the service back, with nothing on screen saying why |
| `turn.note` is cleared when an answer commits (§3.5) | Also when a new attempt's first words reach `stream_reply` | The status line said "The GM has lost the thread…" while the reply was visibly being written again |
| The e2e restarts the AI service between turns (§10.4) | A step of its own (5) also sends it SIGTERM at a reply's first draft: the reply lands from its first attempt, with no note and one `gm.reply` | The service finished a think on SIGTERM but exited before the answer was written, so the dev host's `r` (and any host scaling in) lost it to a retry. It now waits for its responses to be sent, ten seconds at most (§5.7) |
| `npm run live -- --lines 4` | Also `--budget` (it stops before a line that would spend past $0.10) and `--rehearse` (a stack on the fake model, the record marked so) | A guard on the spend, and a way to try the script without any |
