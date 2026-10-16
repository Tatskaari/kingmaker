# v2: the production build

The production build of Kingmaker, as the design has it: a client, a simulation and a stateless AI service.

- **The client** is the prototype's OpenTUI scene screen, in a terminal. It talks only to the simulation.
- **The simulation** is a SpacetimeDB module, the authority on everything that happens: the moves, the world, every die.
- **The AI service** (`kingmaker-ai`) is an HTTP service that does all the model work and keeps the words: the prompts, the lore and each game's documents. It holds nothing between requests, since each one carries the working set it needs, so it runs as a local process or a container for now, and on Cloud Run or as a Lambda later. It's the only part that calls OpenRouter. The simulation calls it from a scheduled procedure, and it streams the GM's words back through a reducer only it may call.

It's built a vertical at a time ([docs/verticals.md](docs/verticals.md)): a slice of the game end to end through the parts, with the prototype ([ARCHITECTURE.md](../ARCHITECTURE.md)) playable throughout. The design is the roadmap ([src/web/site/roadmap](../src/web/site/roadmap/index.html)).

## What you can play

V0, a line in a scene ([docs/v0-design.md](docs/v0-design.md)): the hanged clerk's scene, end to end.

- Start a game as a ready-made level-3 character (ranger, rogue or wizard), and watch the opening stream in.
- Talk with Kell, Cob and Moll. Routes, checks, cues and endings work, and every die comes from the game's own dice. A line that settles the case, or walks away from it, brings the scene to its end through one wind-down turn.
- A second terminal can watch the same scene, row for row, and see the GM's reply grow.
- Kill the AI service mid-turn, or SpacetimeDB, start it again, and the turn finishes.

A recorded run with real models is in [docs/live/](docs/live/).

## The layout

| Folder | What it is |
|---|---|
| [shared/](shared/) | Plain TypeScript the other three run: the requests and answers between the simulation and the AI service ([protocol/ai.ts](shared/protocol/ai.ts)), the idempotency keys, the refusals in the game's words, the markup's types, the dice, the scene's types, loader and graph, the GM's bookkeeping (`GmState`) and its row, and the world with its rows |
| [simulation/](simulation/) | The SpacetimeDB module: [schema.ts](simulation/src/schema.ts) (every table), [index.ts](simulation/src/index.ts) (every reducer, procedure and view), the moves and the job loop, each a plain function over the tables, and the memory host that runs them in the tests |
| [ai/](ai/README.md) | The AI service: its HTTP server and stores (service/), the GM pipeline ported from the prototype (gm/), and the model client, prompts and docs service it shares with the prototype |
| [client/](client/) | The client: the scene screen (ui/), its view of the rows (scene/), the connection that follows the player's seat (net/), the demo, the headless verbs, and the bindings the CLI generates from the module ([module_bindings/](client/module_bindings/), committed) |
| [campaigns/caerwyn/](campaigns/caerwyn/) | The campaign as data: campaign.json, the hanged clerk's scene.json and its Markdown, the granary yard as a world, the ready-made characters (builds.json), the cast's looks, and the 154 lore docs |
| [hosts/](hosts/) | The composition roots, the only code that reads env or argv: the AI service, the client and the headless client, the dev stack ([hosts/dev/README.md](hosts/dev/README.md)), the doctor, the campaign tool and its install, the local host, the e2e and the live run |
| [docs/](docs/) | The plan ([verticals.md](docs/verticals.md)), V0's blueprint ([v0-design.md](docs/v0-design.md)) and the recorded live runs ([live/](docs/live/)) |
| `runs/` | Run output, never committed: the stacks' data, keys and logs, the client's sessions, the CLI's config for building |

v2 doesn't import the prototype: what it needs of it is copied, and each copy's first line names its source at the commit it came from and the edits made. v2/ai is the one place the two share, and there the prototype imports v2.

## Running it

### What you need

- **Node 26.9.** The repo's proto pins it: run from inside the repo.
- **The SpacetimeDB CLI 2.12.0:** `curl -sSf https://install.spacetimedb.com | sh`, then `spacetime version install 2.12.0 --use`. The stack finds it on the PATH or in `~/.local/bin`, and keeps its own config in its folder: it never reads or writes `~/.config/spacetime`.
- **pasta** (the passt package) for namespace mode, or the one `sudo` line for host mode (below).
- **An OpenRouter key** for real models: `OPENROUTER_API_KEY`, or `~/secrets/kingmaker-dev-openrouter.txt`. Without one, run on the fake model with `--fake`.
- **podman**, only for `--container`.

### The stack

```sh
cd v2 && npm ci
npm run dev              # SpacetimeDB, the module, the AI service and the campaign, on real models
npm run dev -- --fake    # the same on the fake model: no key, no cost
```

It brings everything up, installs the campaign in both services, checks that each can reach the other, and prints where things are. Then it takes keys while you play:

| Key | What |
|---|---|
| `k` | kill the AI service, as a crash would |
| `s` | start it again |
| `r` | restart it (it finishes what's in flight first) |
| `f` | make it exit right after it stores its next answer; `s` then starts it, and the turn is answered from the store |
| `p` | build and republish the module (the data kept) |
| `d` | run the doctor |
| `q`, Ctrl+C | stop everything |

Its flags (`--port`, `--ai-port`, `--root`, `--fresh`, `--mode`, `--container`, `--gm canned`, `--no-keys`), its folder and what to do when it won't start are in [hosts/dev/README.md](hosts/dev/README.md). `npm run doctor` checks a running stack from another terminal.

### Playing

In two more terminals, while the stack runs:

```sh
npm run client -- --session wren --new "Wren Ashdown: a hedge wizard from the fens" --build wizard
npm run client -- --session tamsin --join 1     # watch game 1: the number in the first one's side panel
```

`npm run client -- --session wren` goes back to the session's game. `npm run client -- --demo` plays canned turns with no server at all. `/help` in the client lists its commands; `/quit` or Ctrl+C leaves.

Headless, for agents and QA (the prototype's QA verbs, one a process):

```sh
npm run play -- new --session qa --as "Pell Marrow: a disgraced herald" --build rogue
npm run play -- say --session qa "Sergeant, who found him?"
npm run play -- --help      # new, join, observe, say, retry, transcript
```

### Host mode and namespace mode

SpacetimeDB won't let the module call loopback or a private address. So the module always calls the AI service at `http://11.0.0.1:8787` (11.0.0.1 is a public address, kept on this machine), and `npm run dev` picks how that address reaches it:

| Mode | When | How |
|---|---|---|
| namespace | 11.0.0.1 isn't on this machine (the default) | SpacetimeDB runs inside `pasta`, which maps 11.0.0.1 to the host's loopback, where the AI service listens, and forwards SpacetimeDB's port to the host's `127.0.0.1`. No root needed |
| host | 11.0.0.1 is on one of this machine's interfaces | Everything runs on the host. The AI service listens on 11.0.0.1 and 127.0.0.1 |

For host mode, once per boot:

```sh
sudo ip addr add 11.0.0.1/32 dev lo
```

For good, a dummy interface: `sudo nmcli connection add type dummy ifname km0 con-name km0 ipv4.method manual ipv4.addresses 11.0.0.1/32 ipv6.method disabled`. CI runs host mode; `--mode` overrides the choice.

## Testing it

| Command | What it checks | Takes |
|---|---|---|
| `npm run check` | The type check (v2's, and the module's under its own lib); the unit tests: shared, the simulation on its memory host, the AI service and its prompt parity with the prototype, the client, the hosts, and the hanged clerk's endings played on the local host; then the client's screen check | about 5 s |
| `npm run e2e` | A line in a scene end to end on a real SpacetimeDB (ports 3310 and 8797, `runs/e2e`): two clients, a spectator's refusals, the AI service killed mid-reply and after it kept an answer, SpacetimeDB restarted mid-think, and an ending | about 70 s |
| `npm run live -- --lines 4` | A new game and four lines against the running dev stack, with real models, recorded in `docs/live/` (stops before $0.10) | about 40 s |
| `npm run campaign -- check campaigns/caerwyn` | The campaign folder is fit to install | a second |
| `npm run simulation:generate` | Regenerates `client/module_bindings` from the module: run it after any change to a table, reducer or view, and commit the result (CI checks) | seconds |

At the repo root, the prototype's `npm run typecheck`, `npm test` and `npm run build:web` cover v2/ai and v2/shared too, since the prototype runs that code.

## The rules

- **Imports.** `shared/` imports only itself (no `node:`, no packages). `ai/` imports `node:`, itself and `shared/`, never a package or the prototype. `simulation/src` imports `shared/`, `spacetimedb`, `spacetimedb/server` and itself, but only `index.ts` and `schema.ts` import `spacetimedb/server` at run time (it doesn't load in Node), so every move also runs on the memory host in the tests. `client/` imports `shared/`, its packages and the bindings. `hosts/` may import anything in v2. Tests hold the first three ([shared/imports.test.ts](shared/imports.test.ts), [ai/imports.test.ts](ai/imports.test.ts), [simulation/src/imports.test.ts](simulation/src/imports.test.ts)).
- **ES2021 in `shared/`,** the module's lib: no `.at`, `findLast`, `Object.hasOwn`, `structuredClone` or `toSorted`. The module's own type check (`tsc -p simulation`) catches them.
- **Erasable syntax, and `.ts` on every relative import.** `ai/`, `shared/` and `hosts/ai.ts` also run under plain `node` (the AI service's container, and the prototype's tests), so no JSX, enums, parameter properties or JSON imports there.
- **The simulation is deterministic.** No `Math.random`, `Date.now()` or `new Date()` in `simulation/src` or `shared/`: time is the transaction's, and every die comes from the game's `dice` row, so a game replays.
- **The bindings are the module's.** After any change to a table, reducer or view, run `npm run simulation:generate` and commit `client/module_bindings`.
