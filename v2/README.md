# v2: the production build

The production build of Kingmaker, as the design has it: a client, a simulation and a stateless AI service.

- **The client** is the prototype's OpenTUI screens, in a terminal: the title, character creation, the sheet and the scene. It talks only to the simulation.
- **The simulation** is a SpacetimeDB module, the authority on everything that happens: the moves, the world, every die.
- **The AI service** (`kingmaker-ai`) is an HTTP service that does all the model work and keeps the words: the prompts, the lore and each game's documents. It holds nothing between requests, since each one carries the working set it needs, so it runs as a local process or a container for now, and on Cloud Run or as a Lambda later. It's the only part that calls OpenRouter. The simulation calls it from a scheduled procedure, and it streams the GM's words back through a reducer only it may call.

It's built a vertical at a time ([docs/verticals.md](docs/verticals.md)): a slice of the game end to end through the parts, with the prototype ([ARCHITECTURE.md](../ARCHITECTURE.md)) playable throughout. The design is the roadmap ([src/web/site/roadmap](../src/web/site/roadmap/index.html)).

## What you can play

The whole story ([docs/story-design.md](docs/story-design.md)) on the full GM ([docs/full-gm-design.md](docs/full-gm-design.md)), V1, who you are ([docs/v1-design.md](docs/v1-design.md)), V5, the reply as drawn ([docs/v5-design.md](docs/v5-design.md)), and V0, a line in a scene ([docs/v0-design.md](docs/v0-design.md)): the title, a character made from a sentence, and every scene of the arc from the hanged clerk to The End, with its replies drawn as the prototype draws them and its GM playing it as the prototype's default (`v2`) approach does, end to end.

- **The title:** carry on one of your games (the three played last), start a new one, or delete one (x twice).
- **A character from a sentence:** a name and who they are, and the GM offers three builds of three classes, each made legal by the rules engine and shown as a card; or make your own from the SRD's species, classes, subclasses and backgrounds.
- **A backstory:** write it, have the GM draft one or work your notes in, and the GM checks it against Caerwyn's lore: what doesn't fit comes with a fix to accept or rewrite. Or skip it.
- **The sheet the engine made**, before you set off: choose again, or set off into the hanged clerk. `/sheet` (or `/c`) shows it over the scene; `/quit` goes back to the title, the game kept.
- **The scene, as V0 plays it:** talk with Kell, Cob and Moll; routes, checks, cues and endings work, and every check rolls through the rules engine on your sheet. The GM knows your backstory. A second terminal can watch the scene, row for row.
- **The plumbing holds:** kill the AI service mid-turn, or SpacetimeDB, start it again, and the turn (or the character) finishes. A daily ceiling on what the models cost (`KM_AI_DAILY_USD`, $5) fails a move in the game's words once it's spent.


The reply as drawn (V5), in every scene:

- Each speaker's lines in their own colour as the reply is written (Kell, Cob and Moll each have theirs), your own words in yours, and a voice nobody can place in gold italics.
- A note on up to three phrases a reply, underlined on its kind's tint: coral for why someone acts as they do, teal for something you'd know, lavender for something you did. Tab picks one out and Enter (or a click) opens it: the note, written only from what you know, and a card of what you know of who or what it's about. "The GM makes a note…" while they're written: the box stays open, and a line you say then waits for them. If the AI service is lost meanwhile, the status line says the GM has lost the thread; a minute on, the reply goes without its notes and the turn ends.
- Three to five suggested lines over the box after each reply: things to say, a deed, a risky try in yellow, a way out near an ending. A number or a click puts one in the box, to send or change. `/suggestions off` and `/suggestions on`.
- A spectator sees the same colours and notes, and no suggested lines: they're the lead's.
- Headless: `ACTIONS:` lists the lines, `act --id say_2` says one, `suggestions on|off`; who says what, the notes and their cards print as `⟨…⟩` lines.

The full GM, in every scene, as the prototype's `v2` approach plays it:

- **People remember what you did.** After each of your lines, in the background, the GM's memory reviews write what people saw into their own notes (in the game's copy of the lore): give Cob a coin, and Kell may remember it. From your next line on, the GM knows what each person remembers, and brings a memory up when the moment bears on it. Nothing shows on screen, as in the prototype; the reviews never hold a turn.
- **The GM steers a scene that drifts.** A co-GM reviews the scene in the background when you take it off its routes, when it drifts or stalls, or every third line: notes for the GM's next two replies, a whisper of what someone wants for the next one, details to keep true, and new ways through the scene. They take effect as your next line starts. Nothing shows on screen either.
- **The GM rules on a risky act no route covers.** "The GM is considering the ramifications of your actions…" for a few seconds, then a dice line (the skill and DC the GM judged, rolled by the rules engine on your sheet) or a plain yes or no, then a reply that plays what was decided. If the ruling takes more than 12 s, a plain check is rolled instead.
- **Walking out of the place ends the scene**, on an ending of your own.
- **`npm run status -- --game <n>`** shows the GM's side of a game, as the prototype's `scene status` does: the beat, the co-GM's notes, whispers and routes, the rulings, the reviews; `--memories` prints every memory written.

The whole story, from the yard to The End, as the prototype plays it:

- **Every scene of the arc:** the hanged clerk, the Drowned Rat at evening, the Heron warehouse at night and the King's morning, with the afternoon and the wharf at night between them (interludes the story passes over). A scene ends through any of its endings, and each ending writes what it means: a quest moved on, a flag, a line in the notebook, how someone stands towards you, who walks with you.
- **The story moves on as the prototype's does:** at a scene's end the GM writes the hand-off, checks the scenes to come against what happened (one play has overtaken is skipped), rewrites the next one's opening where the story has moved, and gives you the lead; the world's fronts move on, people remember how the scene ended, and anything you were owed (the page in Cob's boot) goes with whoever has it. "Continue, once the story has moved on" while it does (about 10 s on real models); if it gets stuck, "try again".
- **Between scenes:** Kell, a line at a time, reads the entry back and walks on with you ("The Drowned Rat, then."), or a card says how the time passed. Enter goes on, and the next scene opens where the story is. `/journal` (`j` between scenes) is the investigator's notebook, `/quests` the quests.
- **The fight is a stand-in:** at the Heron, a line that goes for Sallow brings it on ("Roll for initiative!"); "Fight it out" tells it as won, and the GM plays the aftermath. The notebook says the fight wasn't played.
- **A summons:** the Heron's end brings the King's morning at once, with no card between. Its ending is The End: how it went, scene by scene, and the GM's bar tab.
- **A spectator** follows the lead from scene to scene: "Watching: Wren Ashdown goes on when ready".
- **For testing,** `/end <exit>` (or `npm run play -- end --exit <exit>`) ends a scene at once as the dev stack's owner; `/end` alone lists the endings. `npm run status` shows what each boundary handed on, the chapters, quests and flags.

The map (walking to the lead), the fight played on the map, and the rules between scenes (time passing, the King's level-up) come with later units ([docs/story-design.md](docs/story-design.md) §2).

Spells and blows aren't the rules' yet (the world bridge brings them): the GM rules on a spell as on any risky act.

Recorded runs with real models are in [docs/live/](docs/live/): V0's four lines, V5's twelve, V1's characters made from a sentence, the full GM's seven lines, the first three beside the prototype's, and the whole story from the yard to The End, beside the prototype's QA console.

## The layout

| Folder | What it is |
|---|---|
| [shared/](shared/) | Plain TypeScript the other three run: the requests and answers between the simulation and the AI service ([protocol/ai.ts](shared/protocol/ai.ts)), the idempotency keys, the refusals in the game's words, the markup's types, the dice, the scene's types, loader and graph, the GM's bookkeeping (`GmState`) and its row, the world with its rows, the rules code its hosts hand the engine ([rules/](shared/rules/), with the shim the engine needs) and character creation's types and text helpers ([creation/](shared/creation/)) |
| [simulation/](simulation/) | The SpacetimeDB module: [schema.ts](simulation/src/schema.ts) (every table), [index.ts](simulation/src/index.ts) (every reducer, procedure and view), the moves (a scene's, and character creation's) and the job loop, each a plain function over the tables, the GM's bookkeeping with its rulings and the co-GM's merge (gm/), the story between scenes (story/: a scene's end and its effects, the boundary as a job, the lead, the fight's stand-in; world/cross.ts moves people and things between places), the rules engine loaded and pinned (rules/), and the memory host that runs them in the tests |
| [ai/](ai/README.md) | The AI service: its HTTP server and stores (service/), the GM pipeline ported from the prototype (gm/), and the model client, prompts and docs service it shares with the prototype |
| [client/](client/) | The client: the screens (ui/: the title, character creation, the sheet, the scene), the models over the rows that pick and feed them (app/, title/, creation/, scene/, sheet/), the connection that follows the player's seat (net/), the demo, the headless verbs, and the bindings the CLI generates from the module ([module_bindings/](client/module_bindings/), committed) |
| [campaigns/caerwyn/](campaigns/caerwyn/) | The campaign as data: campaign.json (with the world a backstory is written for, and the quests), every scene of the arc as scene.json and its Markdown (the hanged clerk, the Drowned Rat, the Heron warehouse, the King's morning and the two interludes, each ending's effects as data), their places as worlds (the granary yard, the Rat, the Heron, the dressing room), the ready-made characters (builds.json: a concept and a build each), the cast's looks, and the 154 lore docs. Made from the prototype's scenes by [tools/v2/scene-files.mts](../tools/v2/scene-files.mts) |
| [vendor/](vendor/) | Vendored code, as it is but for what its README says: the D&D rules engine made ready for a SpacetimeDB module, its content pack, and the SRD's spell texts |
| [hosts/](hosts/) | The composition roots, the only code that reads env or argv: the AI service, the client and the headless client, the dev stack ([hosts/dev/README.md](hosts/dev/README.md)), the doctor, the campaign tool and its install, the local host, the e2e and the live run |
| [docs/](docs/) | The plan ([verticals.md](docs/verticals.md)), the blueprints with how each was built ([v0-design.md](docs/v0-design.md), [v5-design.md](docs/v5-design.md), [v1-design.md](docs/v1-design.md), [full-gm-design.md](docs/full-gm-design.md), [story-design.md](docs/story-design.md)) and the recorded live runs ([live/](docs/live/)) |
| `runs/` | Run output, never committed: the stacks' data, keys and logs, the client's sessions, the live run's rehearsals, the CLI's config for building |

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

The fake model plays [hosts/dev/fake.json](hosts/dev/fake.json): the GM's four golden replies in turn (whatever you say, so they won't always answer it), each written over two seconds with Kell, Cob and Moll in their colours, the notes on their words a moment later, and twelve suggested lines, four offered after each reply (those offered last time, and the last three you said, are screened out). Its decider takes the quietest choice, so nothing rolls and no ending comes. `KM_AI_FAKE` (JSON) goes on top of the file: with `KM_AI_FAKE='{"choices":{"attempt":"examine-body"}}' npm run dev -- --fake` the decider takes the examination of the body whenever it's on offer, so a line in the yard rolls the Medicine check. The whole story's recipe ends each scene at the first of a list of endings it offers, the player's own doing, so a scene closes in two lines (the first reaches the ending, the second winds it down):

```sh
KM_AI_FAKE='{"choices":{"ending":["open-case","hobb-talks","fight","caught-in-the-act","justice"],"own_exit":"theirs"}}' npm run dev -- --fresh --fake
```

On the fake, every scene's opening and reply is one of the yard's golden replies, and the boundary's verdict is the least it can be (the next scene on, nothing rewritten, no lead), so Kell says the afternoon went in paperwork. [hosts/dev/README.md](hosts/dev/README.md) has more.

It brings everything up, installs the campaign in both services, checks that each can reach the other, and prints where things are. Then it takes keys while you play:

| Key | What |
|---|---|
| `k` | kill the AI service, as a crash would |
| `s` | start it again: a turn waiting for it goes on at once |
| `r` | restart it: what's in flight is finished and answered first |
| `f` | make it exit right after it stores its next reply, before sending it; `s` then starts it, and the kept reply lands at once, from the store |
| `n` | the same for the next notes on a reply: press it, then say a line; after `s` the notes come from the store |
| `p` | build and republish the module (the data kept) |
| `d` | run the doctor |
| `q`, Ctrl+C | stop everything |

Its flags (`--port`, `--ai-port`, `--root`, `--fresh`, `--mode`, `--container`, `--gm canned`, `--no-keys`), its folder and what to do when it won't start are in [hosts/dev/README.md](hosts/dev/README.md). `npm run doctor` checks a running stack from another terminal.

### Playing

In another terminal, while the stack runs:

```sh
npm run client -- --session tamsin       # the title: New game makes a character, Continue carries one on
npm run client -- --session wren --join 1     # watch game 1: the number in its player's side panel
```

The session (`runs/play/<name>`) keeps one identity, so `--session tamsin` comes back to the same games. `--new "Name: concept"` goes straight to making that character; `--new "Name: concept" --build cleric|fighter|ranger|rogue|wizard` starts a ready-made one at once. `npm run client -- --demo` plays the title, a character and a scene on canned rows with no server at all. `/help` in a scene says how to play and lists its commands; `/quit` goes to the title; Ctrl+C leaves. The cards in the notes need room: at 80x24, with the lines over the box, a note shows without its card (the prototype's rule), so try 100x30 or more.

Headless, for agents and QA (the prototype's QA verbs, one a process):

```sh
npm run play -- builds --session t --as "Tamsin Vell: a disgraced palace auditor with a ledger-keeper's eye"
npm run play -- new --session t --as "Tamsin Vell: a disgraced palace auditor with a ledger-keeper's eye" \
  --build 2 --backstory "I'm the King's nephew. I owe Fat Jory three crowns." --accept-fixes
npm run play -- sheet --session t
npm run play -- say --session t "Sergeant, who found him?"
npm run play -- act --session t --id say_2         # say the second suggested line
npm run play -- suggestions --session t off        # or on: asks for this moment's at once
npm run play -- end --session t --exit open-case   # testing, as the dev stack's owner: end the scene now (no --exit: the endings)
npm run play -- journal --session t                # the notebook, the quests, the flags, the attitudes
npm run play -- go --session t                     # on to the lead (act --id go_to_lead too); at the Heron's fight, act --id fight
npm run play -- --help      # builds, new, sheet, games, continue, delete, begin, join, observe, say, act, suggestions, retry, transcript, end, go, journal
```

`observe` says `MODE: between` (Kell's talk or the card, and the way on), `MODE: fight` and `MODE: end` between scenes, as the prototype's QA console does.

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
| `npm run check` | The type check (v2's, and the module's under its own lib); the unit tests: shared, the simulation on its memory host, the AI service and its prompt parity with the prototype, the client, the hosts, and the hanged clerk's endings, notes and suggested lines played on the local host; then the client's screen check | about 20 s |
| `npm run e2e` | A line in a scene, a character made and the full GM, end to end on a real SpacetimeDB (ports 3310 and 8797, `runs/e2e`): two clients, a spectator's refusals, the AI service killed mid-reply, restarted mid-reply and gone after it kept an answer, SpacetimeDB restarted mid-think, and an ending; the reply as drawn: who says each line as it streams, the notes the turn waits for, a line said while they're written, the suggested lines (a spectator gets none, `act` says one, a late set is dropped, off and on), and the notes kept by the AI service as it died; then a concept to the opening, the AI service gone after it kept the lore check, SpacetimeDB restarted while the builds are made, a character made and checks rolled beside another game's stream, the daily ceiling, continue and delete; then the full GM: a memory written after a line and in the next reply's prompt, the co-GM's review waiting in its row and merged at the next line's start (its route taken, its whisper lapsing after one reply and its note after two), a risky act ruled with its dice line before the reply (both clients see the turn considering), the plain check when the ruling stalls past its deadline, and walking out of the place; then the whole story: one game from the yard to The End with a spectator, each scene's end crossing the boundary (its chapter, the endings' rows, the hand-off, the verdict and the fronts asked once), the lead walked to with the story so far in its opening, a scene ended by the owner, the fight's stand-in and its aftermath, a summons, The End | about 7 min |
| `npm run arc` | The prototype's whole-arc check on a stack of its own (3320 and 8807, `runs/arc`): the checks the verticals so far turn on (11 of 16: the character is built by the rules engine, then the story from the yard to The End as the flow takes it, each scene ended through its exit as the owner), the rest skipped with the unit that brings each (the map's walking, and the fight on the map) | about 30 s |
| `npm run live -- --script v5` | A new game and V5's twelve lines against the running dev stack, with real models, recorded in `docs/live/` with each turn's speakers, notes, cards and lines (stops before $0.10); `--script gm` is the full GM's eight, with each line's ruling, memory review and co-GM review; `--lines 4` without `--script` is V0's; `--creation` is V1's: three concepts' builds, then a character made through the lore check to the opening and a line (about $0.02); `--script story` is the whole story from the yard to The End, each scene ended as the owner, so every boundary and opening is the models' (about $0.035). None writes over a record: a second run the same day goes beside the first (`v5-<date>-2.md`), and `--rehearse`, on the fake model, writes to `runs/live/` | about 90 s, $0.06 |
| `npm run campaign -- check campaigns/caerwyn` | The campaign folder is fit to install | a second |
| `npm run simulation:generate` | Regenerates `client/module_bindings` from the module: run it after any change to a table, reducer or view, and commit the result (CI checks) | seconds |

At the repo root, the prototype's `npm run typecheck`, `npm test` and `npm run build:web` cover v2/ai and v2/shared too, since the prototype runs that code.

## The rules

- **Imports.** `shared/` imports only itself (no `node:`, no packages), and the rules engine's typings from `vendor/` as types only: it's handed the engine. `ai/` imports `node:`, itself, `shared/` and `vendor/`, never a package or the prototype. `simulation/src` imports `shared/`, `vendor/`, `spacetimedb`, `spacetimedb/server` and itself, but only `index.ts` and `schema.ts` import `spacetimedb/server` at run time (it doesn't load in Node), so every move also runs on the memory host in the tests. `client/` imports `shared/`, its packages and the bindings, never the engine. `hosts/` may import anything in v2. Tests hold the first three ([shared/imports.test.ts](shared/imports.test.ts), [ai/imports.test.ts](ai/imports.test.ts), [simulation/src/imports.test.ts](simulation/src/imports.test.ts)).
- **ES2021 in `shared/`,** the module's lib: no `.at`, `findLast`, `Object.hasOwn`, `structuredClone` or `toSorted`. The module's own type check (`tsc -p simulation`) catches them.
- **Erasable syntax, and `.ts` on every relative import.** `ai/`, `shared/` and `hosts/ai.ts` also run under plain `node` (the AI service's container, and the prototype's tests), so no JSX, enums, parameter properties or JSON imports there.
- **The simulation is deterministic.** No `Math.random`, `Date.now()` or `new Date()` in `simulation/src` or `shared/`: time is the transaction's, and every die comes from the game's `dice` row, so a game replays. The rules engine reads a clock and makes random ids, so the simulation runs it pinned to both ([shared/rules/shim.ts](shared/rules/shim.ts), the one file that touches them).
- **The bindings are the module's.** After any change to a table, reducer or view, run `npm run simulation:generate` and commit `client/module_bindings`.
