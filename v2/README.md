# v2: the production build

The production build of Kingmaker, as the design has it: a client, a simulation and a stateless AI service.

- **The client** is the prototype's OpenTUI app, in a terminal or a browser tab. It talks only to the simulation.
- **The simulation** is a SpacetimeDB module (run locally with the `spacetime` CLI), the authority on everything that happens: the moves, the rules, the world, every die.
- **The AI service** (`kingmaker-ai`) is an HTTP service that does all the model work and keeps the words: the prompts, the lore and each game's documents. It holds nothing between requests, since each one carries the working set it needs, so it runs as a local process or a container for now, and on Cloud Run or as a Lambda later. It's the only part that calls OpenRouter. The simulation calls it from a scheduled procedure, and it streams the GM's words back through a reducer only it may call.

The design is the roadmap ([src/web/site/roadmap](../src/web/site/roadmap/index.html), published with each PR preview at `roadmap/`). It's built a vertical at a time: a slice of the game end to end through the parts, with the prototype ([ARCHITECTURE.md](../ARCHITECTURE.md)) playable throughout. The first, V0, plays the hanged clerk's scene, a line at a time.

## The layout

| Folder | What it is |
|---|---|
| [shared/](shared/) | Plain TypeScript the other three run: the requests and answers between the simulation and the AI service ([protocol/ai.ts](shared/protocol/ai.ts)), the idempotency keys, the refusals in the game's words, the markup's types, the dice, the scene's types, loader and graph, the GM's bookkeeping (`GmState`), and the world with its rows |
| [simulation/](simulation/) | The SpacetimeDB module: [schema.ts](simulation/src/schema.ts) (every table), [index.ts](simulation/src/index.ts) (every reducer, procedure and view), and the moves, each a plain function over the tables |
| [ai/](ai/README.md) | The AI service. Its model client, prompts and docs service are the prototype's too: a change here is a change to both |
| [client/](client/) | The client. For now, the bindings the CLI generates from the module ([module_bindings/](client/module_bindings/), committed) |
| [campaigns/caerwyn/](campaigns/caerwyn/) | The campaign as data: campaign.json, the hanged clerk's scene.json and its Markdown, the granary yard as a world, and the 154 lore docs |
| `hosts/` | The composition roots, the only code that reads env or argv: the AI service, the client, the dev stack (coming with V0) |
| `runs/` | Run output, never committed: the CLI's config for building, the dev stack's data and logs |

v2 doesn't import the prototype: what it needs of it is copied, and each copy's first line names its source at the commit it came from and the edits made. v2/ai is the one place the two share, and there the prototype imports v2.

## The rules

- **Imports.** `shared/` imports only itself (no `node:`, no packages). `ai/` imports `node:`, itself and `shared/`, never a package or the prototype. `simulation/src` imports `shared/`, `spacetimedb`, `spacetimedb/server` and itself, but only `index.ts` and `schema.ts` import `spacetimedb/server` at run time (it doesn't load in Node), so every move also runs on an in-memory host in the tests. `client/` imports `shared/`, its packages and the bindings. `hosts/` may import anything in v2. Tests hold the first two ([shared/imports.test.ts](shared/imports.test.ts), [ai/imports.test.ts](ai/imports.test.ts)).
- **ES2021 in `shared/`,** the module's lib: no `.at`, `findLast`, `Object.hasOwn`, `structuredClone` or `toSorted`. The module's own type check (`tsc -p simulation`) catches them.
- **Erasable syntax, and `.ts` on every relative import.** `ai/` and `shared/` also run under plain `node` (the AI service's container, and the prototype's tests), so no JSX, enums, parameter properties or JSON imports there.
- **The simulation is deterministic.** No `Math.random`, `Date.now()` or `new Date()` in `simulation/src` or `shared/`: time is the transaction's, and every die comes from the game's `dice` row, so a game replays.
- **The bindings are the module's.** After any change to a table, reducer or view, run `npm run simulation:generate` and commit `client/module_bindings`; CI checks they're current.

## Running it

Node 26.9 (the repo's proto pins it) and, for the module, the SpacetimeDB CLI 2.12.0 at `~/.local/bin/spacetime`.

```sh
cd v2 && npm ci              # v2's own packages: never the repo root's
npm run check                # the type check (v2's, and the module's under its own lib), the tests, the client's screens
npm run simulation:build     # the module, bundled (simulation/dist/bundle.js)
npm run simulation:generate  # the client's bindings, from the module
```

The CLI scripts keep their config in `runs/cli.toml`, never `~/.config/spacetime`. The dev stack, the client and the headless client come with the rest of V0.
