# V14: v2 in the browser, with no SpacetimeDB

The plan for one PR, `claude/v2-browser`, on top of the stack's tip `claude/v2-map` (#659, head 8f21717).
It is the verticals plan's V14 ("Play in a browser, and without a server", v2/docs/verticals.md:417) in one
PR, and it is also the test of the user's DI brief (docs/code.md): a second host for the simulation, a
second transport for the client and a second set of stores for the AI service, each swapped in at a
composition root without touching the game's code.

The plan is as it was written (the PR's packages and their contracts in §9), with what was built in
§10. The five reports and the prototypes it names live in the author's scratchpad, beside the plan's
first copy, not in the repo.

Read first: the five reports beside this file (`understand-client.md`, `understand-server.md`,
`understand-ai.md`, `understand-web.md`, `understand-parity-ci.md`). They cite every line this plan
leans on. Working prototypes of the three seams are in `proto/` beside this file:
- `proto/client-seam/split/`: the `Link`/`Replica`/`SpacetimeLink`/`portLink` split, with a parity test
  (the Replica over a real MessageChannel gives the same `view()`, `explore()` and `home()` as today's
  `Connection` fed the same rows) and the repo's connection.test.ts passing against the split.
- `proto/client-seam/tui/`: the JS OpenTUI stand-in with the ~25-line hover fix (`renderer.ts`), which
  takes v2's screen check on the stand-in from 646/652 to 652/652.
- `proto/simulation-host/memory-cs.ts` and `memory.diff`: the memory host's injections (clock, onCommit,
  restore with sequences, log, service, dispatchDue, reap, the pk fast path). With it in place of
  `host/memory.ts` the 10 memory-host test files pass 87/87. `idb-worker.ts`/`run-browser.mjs`: the
  IndexedDB write-through, run in a real Worker in headless Chromium. `revive.ts`.
- `proto/ai-worker/di/patches.mjs` and `proto/ai-worker/patched/all.diff`: the AI service's DI seams
  (DocsVolume, PromptSource, CampaignStore.files, Stores.docs, node-free sha256, rules JSON imports, timers,
  openrouter's process guards), applied at bundle time and replayed in Chromium and Firefox: 21 of 25
  answers byte-identical to Node's, 4 differing only in a latencyMs. `di/browser-ai.ts`: memory volumes,
  IndexedDB write-behind, content campaigns.

These were run in scratch, never against the repo's suites: treat them as the shape and a head start,
not as finished code.

## 1. How to try it (what the PR's "How to try it" will say)

```sh
git switch claude/v2-browser && cd v2 && npm ci
npm run build:web            # v2/dist/web: the page and its two workers
npm run web:serve            # http://127.0.0.1:7311/kingmaker/pr-preview/pr-0/v2/  (served as GitHub Pages serves it)
```

Or open the PR's preview: `https://tatskaari.github.io/kingmaker/pr-preview/pr-<N>/v2/` (the prototype
stays at `play/` beside it, for comparing).

- The page asks for an OpenRouter key (kept in this browser only, shared with the prototype's previews),
  or offers **Play with the fake GM** (no key, no cost: hosts/dev/fake.json's canned replies, which
  don't answer what you say). `?fake` skips the gate on the fake GM; `?fake=arc` uses the whole story's
  recipe, so each scene ends in two lines and the arc can be walked to The End on the fake.
- Then it plays as the terminal client does: the title, a character from a sentence (or a ready-made
  one), the sheet, the town's map, every scene of the arc with its place drawn, spells and fire, the
  full GM, between scenes, The End. The fight is still the stand-in.
- **No server at all:** the simulation runs in a Web Worker over tables kept in IndexedDB, and the AI
  service runs in the same worker; with a key, the model calls go from that worker straight to
  OpenRouter. Reload, and the title's Continue carries the game on. A second tab is told the game is
  open elsewhere and can take it over.
- `/end <exit>` works as in the dev stack (the page host makes it as the database's owner).

## 2. The shape

```
 the page (xterm.js, the key form)      new MessageChannel(): port A → client worker, port B → server worker
   │  keys, resize ─────────────────▶  CLIENT WORKER  (hosts/web/client-worker.tsx)
   │  ◀──────────── terminal bytes      the v2 client's App on the JS OpenTUI (web/tui), AppModel over
   │                                    Replica(portLink(port A))              ▲  moves in, rows out
   │                                                                            │  (structured clone)
   │  key, flush, take-over ────────▶  SERVER WORKER  (hosts/web/server-worker.ts)
   │  ◀── ready, busy, storage,         the page host: memoryHost (real clock, change sets, restored rows)
   │      key-refused                   + the AI service in process (memory stores, write-behind) + the
   │                                    port server (snapshot, tx diffs, views per caller) + the job loop
   │                                    IndexedDB: one database for both; a Web Lock: one tab at a time
   └──────────────────────────────────▶ OpenRouter (from the server worker, the player's key) or the fake
```

The design asks for exactly this ("Keeping page-only mode", docs/design/productionise.md; "two bundles…
each runs in its own worker, joined by a MessageChannel"). The terminal client and the SpacetimeDB stack
are unchanged: `Connection` keeps working over SpacetimeDB, and the e2e passes as before.

The composition roots stay flat, in the brief's style:

```ts
export async function runServer(config: ServerConfig, page: PagePort): Promise<void> {
  await claimTab(config.deployment, page);                       // Web Lock; busy → the page
  const storage = await openStorage(config.deployment, page);    // IndexedDB (or memory, told to the page)
  const content = await loadContent(config.contentUrl);          // content.json: the campaign, prompts, fake
  const sim = newSimulation(config, await storage.sim.load());   // memoryHost over the restored rows
  const ai = newAiService(config, storage.ai, content, sim);     // in process; the key or the fake
  await installCampaign(content.campaign, ai, sim);              // only when the campaign changed
  persistAsItGoes(storage, sim);
  startJobs(sim);                                                // dispatchDue after commits, the reaper
  servePorts(page, port => serveClient(portDuplex(port), sim, config));
  page.ready();
}
```

`runClient(config, page, port)` reads the same way: `Replica(portLink(port))`, await it, the tui renderer
writing to the page, `new AppModel(...)`, render, follow the page's input.

## 3. The wire (shared/protocol/port.ts)

Messages, not RPC proxies (productionise.md "The protocol"), so any channel can carry, log and replay
them. Types only in shared (shared imports nothing outside itself, so no SDK classes there).

- client → server: `{kind: "connect", protocol: 1, session?: string}`, `{kind: "move", id: number, name: MoveWire, args}`, `{kind: "disconnect"}`.
- server → client: `{kind: "connected", identity: string /* hex */}`, `{kind: "snapshot", tables: Record<ClientTable, Row[]>}`,
  `{kind: "tx", changes: RowChange[]}`, `{kind: "answer", id, rejection?: Rejection}`, `{kind: "status", trouble?: string, cutOff?: string}`.
- `RowChange = {table: ClientTable /* SQL name, as the client's Watched type */, op: "insert" | "update" | "delete", row, old?}`.
- `CLIENT_TABLES`: the 32 public tables and the 4 views the client watches, each with its accessor and
  primary key (understand-client.md §1.3 lists all 36 and their keys).
- `revive(value, classes)`: rebuilds `Identity`, `Timestamp` and `TimeDuration` from their marker fields
  (`__identity__`, `__timestamp_micros_since_unix_epoch__`, `__time_duration_micros__`), with the classes
  handed in by the caller (DI: shared can't import the SDK). The client's port link and the server's
  IndexedDB load both use it.

Rules the server keeps (the client and the e2e rely on them):
1. **Full push, not subscriptions.** In page-only mode one browser holds one player's games, so the
   server sends every row of the public tables and the caller's four views (`my_seat`, `my_names`,
   `my_games`, `my_creation`, made with `sim.view(identity)`), and the client's Replica filters as it
   already does. `covers()` is true once the snapshot is in. A network host would filter per
   subscription; that's not this PR (say so in the docs).
2. **One `tx` per committed transaction** (moves, job claims and finishes, stream_reply, the reaper),
   with the net change per primary key: `insert`, `update` (the final row, when the key existed before
   and after) or `delete` (the row as it was), plus the views' diffs by their keys. Rows equal before
   and after are dropped. These are the SDK's own ops; the e2e checks depend on them (transcript insert
   vs update, every reply_draft event, every turn phase).
3. **A move's `tx` goes out before its `answer`, on the same port.** Fan out synchronously in
   `onCommit`; the job loop defers with `setTimeout(0)`.
4. Private tables never cross (gm_state, gm_note, heard, job, job_dispatch, reaper, dice, rules_state,
   seat, scene_def, place_def, admin, co_gm_result, creation).
5. Moves are the memory host's `Caller` methods by name, with a whitelist: every client move
   (understand-client.md §1.3's table), plus `endScene` made as the owner when `config.ownerMoves`
   (on in the page). Never `installCampaign`, `dispatchWaiting` or `streamReply`. A `Refused` comes back
   as the refusal; any other throw as `{code: "error", text}` (and is logged).
6. Identities: `connect {session}` → the server's registry in IndexedDB meta (session name → a random
   identity minted on first use). The page's client uses session "default". No tokens: the port is the
   page's own.

## 4. The seams

### 4.1 The client: `Link` and `Replica` (client/net)

Split `client/net/connection.ts` (553 lines) as `proto/client-seam/split/` does:
- `client/net/link.ts`: `Link {tables: ClientTables; ready; onRow; onStatus; covers(); move(name, args); close()}`,
  `ClientTables` (the bindings' accessors the Replica reads: the SDK's `conn.db` satisfies it as is).
- `client/net/replica.ts`: `class Replica implements Backend`, written against `Link`: `rows()`,
  `view()`, `exploreRows()`, `explore()`, `placeOf`, `seat`, `home()`, `onChange`, `onEvent`, the moves,
  the change ticks. Moved, not rewritten.
- `client/net/connection.ts`: `SpacetimeLink implements Link` (the builder, subscriptions, trouble,
  reconnect, the owner's end_scene over HTTP), `connect()`, and `class Connection extends Replica`, so
  every user (e2e kit, arc, live, hosts) is unchanged. connection.test.ts passes unchanged.
- `client/net/port.ts`: `portLink(port: MessagePortLike): Link`: a Map per table keyed by primary key,
  the snapshot applied as inserts, each `tx` applied whole then its events emitted in order, moves
  matched to answers by id, `status` with `cutOff` refusing every pending and later move. Revives rows
  with the SDK's classes (client may import spacetimedb). The SDK's `DbConnection` must not end up in
  the client worker's bundle: only `Identity`/`Timestamp`/`TimeDuration` values.

Browser readiness, by DI (the brief: nothing reads config or process.env when it's imported):
- `client/look/glyphs.ts`: the font probe (node:fs/os/path) and the `process.env` default move to the
  hosts; hosts call `setGlyphSet(...)`. The page passes the set (default `kingmaker`).
- `client/look/invent.ts`: `LookCache` in memory by default; the file store moves to a host-only module
  set through `setLookCache`.
- `client/explore/model.ts:42` and `client/ui/between.tsx:31`: pacing as a setting (the checks set it),
  not `process.env` reads.
- `client/look/opentui.ts:275`: `attachOverlay(renderer, {doors})` takes the flag. (The page doesn't
  attach the overlay in this PR: the doors and lamps pictures are a follow-up.)
- A `surface: "terminal" | "page"` option on `AppModel`: on the page, Esc doesn't quit the title, and
  copy that only fits a terminal ("--join N to watch", `client/ui/scene.tsx:581-584`, `client/ui/explore.tsx:152`) is left out.

### 4.2 The simulation: the memory host for real play (simulation/src)

Additive, with every existing test unchanged (from `proto/simulation-host/memory-cs.ts`):
- `MemoryHostOptions` gains `clock?: () => Timestamp`, `onCommit?: (c: ChangeSet) => void`,
  `restore?: {rows; sequences?}` (rows go in before `initDatabase`; each autoInc counter set to
  max(saved, highest id + 1)), `log?: (line) => void`, `service?: Identity` (so `sim.service` agrees
  with `env.AI_IDENTITY`; fixes local.ts's footgun).
- `ChangeSet {changes: RowChange[]; sequences}`: captured at the three `journal()` calls, folded in
  `inTransaction` after the journal clears (first before, last after; insert+delete dropped;
  delete+insert an update), and handed to `onCommit` outside the transaction.
- `MemoryHost` gains `dispatchDue()` (every due dispatch started without awaiting, as SpacetimeDB's
  scheduler runs them; claims run in order) and `reap()`. `drain()` and `advance()` stay for the tests.
- `AiPost` gains an optional 4th argument `{timeoutMs}` (the claim's), which the page host enforces.
- The pk `find` becomes a Map lookup (same answers).
- `simulation/src/tables.ts`: `TableMeta` gains `public?: true` and `defaults?` (the 28 real defaults:
  understand-server.md §1.3), with `simulation/src/tables.test.ts` checking both against schema.ts's text,
  and that every SQL name is its accessor in snake_case.
- `simulation/src/jobs.ts`: `requeueRunning(tx)`: every running job back to queued with a dispatch now
  (the page host calls it at start, since no run_job survives a reload).

### 4.3 The AI service: stores behind interfaces (v2/ai)

The DI route (understand-ai.md §4, "B"), with folder defaults kept so the prototype and the existing
tests need no change, and created lazily so nothing touches node:fs or `import.meta` at import time:
- `ai/docs/config.ts`: `DocsVolume {read(path), write(path, text), list()}` (synchronous: the docs API
  is), `configureDocs({lore, overlay: (game) => DocsVolume})`. `folderVolume(root)` (node, lazily made
  from today's defaults) and `memoryVolume(files, onWrite?)` (pure). docs.ts's 9 fs call sites go
  through the volume; `randomUUID` from `globalThis.crypto`; `inside()` refuses `/` and `../`.
- `ai/prompts/index.ts`: `PromptSource = (name) => string | undefined`, `configurePrompts(source)`, the
  folder source (with `KM_PROMPTS_DIR`) the lazy default.
- `ai/service/stores.ts`: `CampaignStore.files(c, v)` (a reader: `read(path)`, `paths()`) in place of
  `root()`, and `Stores.docs {overlay(game): DocsVolume}` in place of `docsRoot`; `AnswerStore.sweep?`.
  `folderStores` implements both. New `memoryStores(persist?)` in `ai/service/memory-stores.ts` (pure,
  usable by tests) with one contract test shared with folderStores.
- Node-free one-liners: `sha256` via `crypto.subtle` (same hex), guard `.unref()`; `ai/rules/load.ts`
  loads the pack and spells by JSON import (so the bundler dedupes them with the simulation's); 
  `ai/rules/builds.ts` uses a `setTimeout` promise; `ai/llm/openrouter.ts` guards its `process` reads
  (:94, :101, :149).
- A refused key must not retry for ten minutes: a new non-retryable `AiErrorCode` (`key_refused`) in
  shared/protocol/ai.ts, the service answering it on a 401 from OpenRouter, and simulation/src/ai-call.ts
  failing the turn at once with words for the player ("OpenRouter turned the key down: change it from
  the bar under the game."), as `over_budget` does.

## 5. The browser platform (v2/web) and the composition roots (v2/hosts/web)

Copied from the prototype (v2 never imports it), each copy's first line naming its source and edits:
- `web/tui/`: `src/web/tui/*.ts` (17 files, 5,309 lines, incl. testing.ts), with the hover fix from
  `proto/client-seam/tui/renderer.ts`. The build aliases `@opentui/core`, `@opentui/react` and
  `@opentui/react/test-utils` to it. It resolves react, react-reconciler and scheduler from
  v2/node_modules (one React, or the screens die on their first hook).
- `web/page/`: index.html, `page.js` (from client.js, without the socket transport), `transport.js`
  (from worker-transport.js: two workers, the MessageChannel, routing per understand-web.md §5.4), style.css;
  the key form, the key bar, the busy/take-over and storage notices, the "Play with the fake GM" choice.
- `web/fonts/`: the two KingmakerGlyphs .ttf files (from assets/fonts), and the font tables code (src/web/fonts.ts).
- `web/node/`: only the stand-ins the bundles still need after the DI changes (expected: `path` as posix,
  `fs`/`os` throwing stubs for the prototype-only dead paths, `timers/promises` if anything still needs it).
  Not the prototype's fake fs: nothing in v2 needs a file system in the browser.
- `web/server/`: the page host's parts: `sim-store.ts` (`SimStore {load, write, flush, sessions}` in
  IndexedDB and memory versions: one `rows` store keyed `[table, keyOf(pk)]`, a `meta` store with
  sequences, the database identity, sessions, the installed campaign's hash and DATA_VERSION; debounced
  write-through, 150 ms after the first change and at most 1 s later, one readwrite transaction per flush
  across the sim's and the AI's stores; requeue on failure; flush on the page's `flush`), the AI stores'
  IndexedDB persistence (answers durable before `answer()` returns; docs overlay writes flushed in the
  same transaction as the answer they belong to; call logs capped per game), `push.ts` (snapshot, tx,
  view diffs), `connections.ts` (connect, sessions, the move whitelist, answers), `jobs.ts` (dispatchDue
  after a commit that inserted job_dispatch rows, the reaper on the reaper row's interval, startup
  recovery: requeueRunning and every player offline), `transport.ts` (`Duplex` over a MessagePort, and an
  in-process pair for Node tests with injectable latency), `tab.ts` (the Web Lock, busy, take-over,
  from src/web/static/worker.ts:155-174), `clock.ts`/`random.ts` (`getRandomValues`, never
  `crypto.randomUUID`, which needs a secure context).
- `hosts/web/client-worker.tsx`, `hosts/web/server-worker.ts`: the composition roots (§2).
- `hosts/web/build.ts` (`npm run build:web`): one esbuild call, entries `client-worker` and
  `server-worker` with splitting; the aliases; `content.json` (campaigns/caerwyn's .md/.json, ai/prompts,
  hosts/dev/fake.json: fetched by the server worker only); the page files and xterm from v2/node_modules;
  the fonts; the `?v=` stamp and the preload list; the CSP meta (`connect-src 'self' https://openrouter.ai`);
  the leak check (refuse to write dist if the dev key or anything shaped like `sk-or-v1-…` is in it);
  every URL relative. `--out` for the preview.
- `hosts/web/serve.ts` (`npm run web:serve`): files only, under a Pages-like base, as src/web/static/serve.ts
  (add `.wasm`).
- `hosts/web/check.ts` (`npm run web:check`): Playwright, headless Chromium, against the built site served
  under `/kingmaker/pr-preview/pr-0/v2/`, on the fake GM (§7).
- `hosts/web/screens.ts` (`npm run web:screens`): v2's `client/check/screens.tsx` bundled on the stand-in:
  652/652, the same as `npm run screens` on real OpenTUI.

IndexedDB, the lock and the BroadcastChannel are named `kingmaker-v2-web <base>`, where base is the
deployment's path (it ends in `/v2/`), so v2 never reads or locks the prototype's `kingmaker-v2 <base>`.
The localStorage key `kingmaker.openrouter-api-key` stays shared with the prototype's previews.

The key lives in the server worker only: the page posts it in `start` and `key`; the transport closure
gives each request `{apiKey, fetch: guardedFetch}` (no `globalThis.fetch` patching): no key → a local
401 with no network; a 401 from openrouter.ai → `key-refused` to the page; errors redacted. The client
worker never sees it. The fake GM: `transports("fake", {fake})` with hosts/dev/fake.json (its
`onTop`/`quietGm` moved to a node-free module), and `?fake=arc` adding the whole story's choices.
Stream posts at `periodMs` about 100 in the page host. A daily ceiling stays ($5 in this browser), worded
for the page.

## 6. CI and the preview

- `.github/workflows/preview.yml`: a `build-v2` job beside `build` (checkout the PR head, node 26.9 with
  v2's lock cached, `npm ci` and `npm run build:web` in v2, upload `v2/dist/web`), skipped when v2 has no
  `build:web` script; `publish` needs both, unpacks v2's artifact at `dist/web/v2/` before
  rossjrw/pr-preview-action, writes a placeholder `/v2/index.html` when `build-v2` failed (so a broken v2
  build can't take the prototype's preview down), and adds a sticky comment with the `/v2/` link
  (understand-parity-ci.md §5.3 has the YAML). `pull_request` runs the PR's own workflow, so this works on
  the stack without touching main.
- `.github/workflows/v2.yml`: `check` adds `npm run build:web` and `npm run web:screens`; a new `browser`
  job runs Playwright's Chromium (cached by v2's lock, `chromium-headless-shell`) and `npm run web:check`,
  uploading the check's screens on failure. Every `run:` must parse in bash (hosts/ci.test.ts), and the
  path filter already covers v2/**.
- v2/package.json: devDependencies esbuild 0.28.2, playwright 1.62.1, yoga-layout 3.2.1,
  react-reconciler 0.33.0, @types/react-reconciler 0.33.0, @xterm/xterm 6.0.0, @xterm/addon-fit 0.11.0,
  @xterm/addon-webgl 0.19.0, @xterm/addon-unicode11 0.9.0 (the root's versions), and fake-indexeddb if a
  Node test wants IndexedDB; scripts build:web, web:serve, web:check, web:screens. `tsconfig.json`
  includes `web`.

## 7. Testing: effective, not exhaustive

- Existing: `npm run check` in v2 (typecheck, test, screens), the root's `npm run typecheck` and
  `npm test` (the prototype imports v2/ai), and ONE e2e run on SpacetimeDB (the client's Connection was
  refactored).
- New unit tests: the memory host's change sets and restore; tables.test.ts; memoryStores against the
  same contract as folderStores; the port link over a Node MessageChannel (ordering, refusal, cut off,
  parity with Connection over the same rows); the port server over the in-process pair (snapshot, tx ops,
  views, the whitelist, answers after rows).
- **The contract test, both hosts' links, in Node:** `Replica(portLink)` against the page host's server
  over a real MessageChannel (real structured clone), on the fake model: a new game with a ready-made
  build, the map, `g` to the yard, the opening streamed, a line and its reply with notes and suggested
  lines, then the server rebuilt from what the SimStore kept (memory version) and the game carried on.
  The e2e's play scenarios over both hosts are the plan's fuller form; this is its first step.
- `npm run web:screens`: 652/652 on the stand-in.
- `npm run web:check` (Playwright, the fake GM, ~1-2 min): no page error, both workers up, no request
  leaves the origin; the title; a ready-made character; the map ("The lead: The Hanged Clerk"); `g`
  opens the yard and the fake's opening streams in; a line and its reply, then suggested lines; reload →
  the title's Continue lists the game and carries it on (IndexedDB holds the sim's rows and the AI's
  stores); a made-up `sk-or-…` key in the form appears in no URL, console line, IndexedDB record or
  output; a second tab is told it's busy.
- One live run with the real key (~/secrets/kingmaker-dev-openrouter.txt, never printed, never in dist,
  never committed): the built page in headless Chromium, a character and the yard's opening and one
  line on real models, under $0.10, recorded without the key in v2/docs/live/.

## 8. Not in this PR

- The doors and lamps pictures over the map (the client already emits them; the page half is ~356 lines).
- Problem reports (V16), the zoo (V19), a `?demo` mode, the site's pitch and roadmap pages (they stay the
  prototype's until the drop), a browser tab against a SpacetimeDB server, several players in one browser.
- Server-side subscription filtering (full push is right for one browser).
- The fight, the map's action menu, talks with Kell, invented looks: the parity verticals (V10-V13, V9's rest).

## 9. Packages

All in worktrees under `/home/jon/git/kingmaker/.claude/worktrees/`, branches from `claude/v2-browser`.

### K1: the client seam, the wire, the dependencies (contracts, parallel with K2)
- **Owns:** `client/net/{link,replica,connection,port}.ts` (port.ts may be a stub that throws "not built"
  if time is short; C finishes it), `shared/protocol/port.ts` (the wire and `revive`), v2/package.json and
  the lock (the devDependencies and scripts of §6, scripts pointing at files that may not exist yet),
  `tsconfig.json`'s include, stub entry files `hosts/web/client-worker.tsx` and `hosts/web/server-worker.ts`
  (each posts `{type: "error", message: "not built"}`) so P can build against them.
- **Done when:** `npm run check` passes; connection.test.ts passes unchanged; the root's typecheck and
  test pass; the wire is documented in shared/protocol/port.ts.
- **Must not touch:** simulation/, ai/, the SpacetimeDB e2e's behaviour.

### K2: the simulation's and the AI service's seams (contracts, parallel with K1)
- **Owns:** §4.2 and §4.3 in full: simulation/src/host/memory.ts, tables.ts (+ tables.test.ts),
  jobs.ts (requeueRunning), ai-call.ts and shared/protocol/ai.ts (key_refused), v2/ai's DocsVolume,
  PromptSource, stores (files, docs, memoryStores + contract test), the node-free one-liners; the
  prototype's adapters only if a v2/ai change forces them (src/lore/*, src/runtime/brief.ts), keeping the
  prototype's tests and its static build green; `hosts/dev/fake.ts`'s onTop/quietGm and
  `hosts/dev/campaign.ts`'s packOf moved to node-free modules (re-exported where they were);
  hosts/local.ts's streamInto/streamArgsOf/install moved to a node-free `hosts/in-process.ts`.
- **Done when:** `npm run check` passes in v2; the root's `npm run typecheck` and `npm test` pass;
  `npm run build:web` at the root still builds the prototype's static site; an esbuild browser bundle of
  the memory host + the AI service (as hosts/local.ts composes them, with memoryStores and memory volumes)
  has no `node:` imports except openrouter.ts's prototype-only paths (aliased to stubs).
- **Must not touch:** client/, the module's reducers' behaviour.

### K-merge (after K1 and K2)
Merge both into `claude/v2-browser`, run `npm run check`, the root's typecheck and test, and ONE e2e run
on SpacetimeDB (your ports). Fix what the merge breaks. Write the contracts report for S, C and P.

### S: the server worker (after K-merge, parallel with C and P)
- **Owns:** `web/server/*` and `hosts/web/server-worker.ts` (§5), its Node tests, and the contract test
  (§7) as far as it can go with K1's port link (finish it with C's in the integration).
- **Done when:** the Node tests pass; the contract test plays the flow on the fake model over a Node
  MessageChannel and carries on after a rebuild from the memory SimStore; the server worker bundles for
  the browser (esbuild, platform browser) and, in headless Chromium (a tiny harness page of your own, not
  P's page), loads, installs the campaign, makes a game, plays the opening and a line on the fake model,
  and after the worker is terminated and restarted carries the game on from IndexedDB.
- **Must not touch:** client/, web/tui, web/page, the build's page files.

### C: the client worker (after K-merge, parallel with S and P)
- **Owns:** `client/net/port.ts` (finished, with its tests), the client's browser-readiness DI (§4.1),
  `web/tui/` (the copy with the hover fix, its own imports test), `web/node/` for the client's needs,
  `hosts/web/client-worker.tsx`, `hosts/web/screens.ts` (`npm run web:screens`: 652/652).
- **Done when:** `npm run check` and `npm run web:screens` pass; the client worker bundles for the
  browser with no `node:` import and no `process` read, with one React, and without the SDK's
  DbConnection; a Node smoke runs the bundle with a fake port server (a handful of rows) and draws the
  title and the scene.
- **Must not touch:** simulation/, ai/, web/server, web/page.

### P: the page, the build, CI (after K-merge, parallel with S and C)
- **Owns:** `web/page/*`, `web/fonts/*`, `hosts/web/build.ts`, `hosts/web/serve.ts`, `hosts/web/check.ts`,
  `.github/workflows/preview.yml`, `.github/workflows/v2.yml`, keeping hosts/ci.test.ts green.
- **Done when:** `npm run build:web` builds the site from K1's stub entries (and will from S's and C's
  real ones: the build takes the entries by path); the build's own checks (allowlist, leak check, stamp,
  preload, CSP, relative URLs) pass; `npm run web:check` runs against the stub build as far as the stubs
  allow (the page loads, both workers start, the gate and the key form, the fake GM choice, no request
  leaves the origin), and its play steps are written, ready for the integration; the workflow changes
  parse (ci.test.ts).
- **Must not touch:** client/, simulation/, ai/, web/server, web/tui.

### I: the integration
Merge S, C and P (in that order), make them meet, and get: `npm run check`, `npm run web:screens`,
`npm run build:web` and `npm run web:check` passing; the contract test passing with C's port link; the
root's typecheck and test; ONE e2e run on SpacetimeDB; the live run (§7, under $0.10). Docs: v2/README.md
("In a browser"), this plan copied to v2/docs/browser-design.md with an "As built" section, verticals.md's
V14 marked as built in one PR. The PR description (How to try it first, with the preview link pattern),
committed to the report folder. Don't push.

## 10. As built

Built as planned, in one PR (`claude/v2-browser`), by the packages of §9: K1, K2 and K3 (the contracts: K2's §4.2 and
K3's §4.3 split the plan's K2 in two), then S, C and P in parallel, then the integration. What follows is where it
departs from the plan, and how it measures.

### The parts, where they are

- **The wire:** `shared/protocol/port.ts`, as §3 has it, with `keyOf`, `rowKey` and `revive`.
- **The client's seam:** `client/net/link.ts`, `replica.ts`, `connection.ts` (`SpacetimeLink`, and `Connection` as
  the Replica over it, so its users and `connection.test.ts` are unchanged) and `port.ts` (`portLink`).
- **The simulation's seam:** `simulation/src/host/memory.ts` (clock, onCommit with change sets, restore with
  sequences, log, service, `dispatchDue`, `reap`, the claim's timeout, the pk Map), `tables.ts` (`public`,
  `defaults`) and `jobs.ts` (`requeueRunning`).
- **The AI service's seams:** `ai/docs/config.ts`, `volumes.ts` and `paths.ts` (DocsVolume, folder and memory
  volumes, posix paths); `ai/prompts/index.ts` (PromptSource); `ai/service/stores.ts`, `memory-stores.ts` and
  `folder-stores.ts` (the store interfaces, memoryStores, one contract test); `key_refused` from `openrouter.ts`
  through `server.ts` to `simulation/src/ai-call.ts`.
- **The page host:** `hosts/web/page-host.ts` (the simulation and the AI service joined as `hosts/local.ts` joins
  them) and `web/server/` (database, write-behind, sim-store, ai-store, push, connections, jobs, transport, tab,
  model, content, clock, random).
- **The composition roots:** `hosts/web/server-worker.ts` (`runServer`) and `hosts/web/client-worker.tsx`
  (`runClient`), flat, as §2 sketches them.
- **The page and its build:** `web/page/` (copies of the prototype's page), `web/fonts/`, `web/tui/` (the
  prototype's JS OpenTUI, with the hover fix), `web/node/`, and `hosts/web/build.ts`, `content.ts`, `site.ts`,
  `serve.ts`, `check.ts`, `screens.ts` and `tui.ts`.
- **CI:** `preview.yml`'s `build-v2` job and `/v2/` in each PR's preview; `v2.yml`'s check job builds the page and
  runs `web:screens`, and its `browser` job runs `web:check`.

### Where it departs from the plan

- **The page host is its own module** (`hosts/web/page-host.ts`), split from the server worker's entry, so the
  contract test starts it in Node, where there's no `self`.
- **The server worker takes a second kind of port.** Play again starts a new client worker on a new channel and
  hands its other end to the running server worker as `{type: "port", port}`, so the server plays on through it.
  And `quit` (another tab takes the game over) is answered with `flushed` once the lock is let go.
- **The client reads nothing from the environment or the disk,** not only the four reads §4.1 named: the glyph set,
  the looks' store (`LookStore`) and the pace (`client/pace.ts`) are set by the hosts. `hosts/terminal.ts`
  (`configureTerminal`) makes the same choices the client made for itself before, and every terminal host calls it
  (client, play, arc, e2e, live-run).
- **The page surface has three screen checks of its own,** so `npm run screens` and `npm run web:screens` count 655,
  not 652.
- **The campaign is served from content.json** (`contentCampaigns`), never written to IndexedDB, and installed in
  both services only when its files' hash changes from the one the saves were made with.
- **The AI service takes the host's words for its daily ceiling** (`ServiceOptions.overBudget`, beside
  `keyRefused`), so the page says the budget is this browser's.
- **The simulation imports the rules' JSON with `with { type: "json" }`,** as the AI service does, so the server
  worker holds one copy of the pack and the spells: the site went from 6.44 MB to 5.52 MB (1.47 MB gzipped).
  `spacetime build` takes it, and the module's bundle has the same JSON in it.
- **web/node holds `fs`, `os` and `path`,** throwing stand-ins for the model client's prototype-only paths, which
  the server worker's bundle still names and never runs. The client worker needs none.
- **Push sends no `old`** with an update: nothing reads it.
- **The fake GM, chosen on the form, is kept in the address** (`?fake`), so a reload carries the game on with it.
  Without that, a reload put the key form up again (found in the integration's play).
- **`npm test` runs `web/`'s tests too,** so the page host's parts, the contract test and web/tui's rule are in
  `npm run check`.

### How it measures

| | |
|---|---|
| The site | 26 files, 5.52 MB, 1.47 MB gzipped: client-worker.js 820 KB, server-worker.js 527 KB, the engine's chunk 1.17 MB, the pack 630 KB, the spells 297 KB, content.json 1.28 MB (the campaign's 261 files, 23 prompts, the fake) |
| To the title | 421 to 428 ms on a first visit, 426 to 833 ms after a reload, served locally (two runs of `web:check`, on a busy machine) |
| `npm run check` | 870 tests, screens PASS 655 |
| `npm run web:screens` | PASS 655 |
| `npm run web:check` | PASS, 78 checks, about 40 s (77 before the check on the fake GM's address was added) |
| The contract test | passes (in `npm test`) |
| `npm run e2e` (SpacetimeDB, once) | PASS, every step (1 to 35), 418 s |
| The repo root | `npm run typecheck` clean, `npm test` 859/859, `npm run build:web` builds |
| The live run | $0.0089 for a character, the yard's opening and a line on real models ([live/browser.md](live/browser.md)) |

### Left for later

- §8's list: the doors and lamps pictures, problem reports, the zoo, a tab against a SpacetimeDB server, several
  players in one browser, server-side subscription filtering, the parity verticals.
- Every e2e scenario on both hosts: the contract test is the first step.
- A deleted game's AI docs and logs stay in IndexedDB (the AI service has no game delete).
- A client worker ended without its `disconnect` (Play again ends the old one) stays in the push fan-out until the
  page reloads. Harmless: its rows go to a dead port.
- The server worker logs every line of the simulation's and the AI service's to its console (with the key taken
  out). V16's reports could keep a ring buffer instead.
- The $5 ceiling counts the fake's pretend costs too (about $0.003 a turn).
- `DATA_VERSION` (`web/server/sim-store.ts`) is bumped by hand when a table changes in a way a restore can't mend;
  a build with another version clears the saves.
- The page has no ready-made character (the terminal client's `--build`): a character is made from a sentence.
- The server worker needs a secure context (https, or localhost) for Web Crypto, as Pages and `web:serve` give it.
