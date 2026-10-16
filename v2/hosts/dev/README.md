# The dev stack

`npm run dev` runs the game on one machine: SpacetimeDB with the module published, the AI service, and the campaign installed in both. Then it checks that each service can reach the other, and gives you keys to break and mend the AI service while you play. The blueprints are `v0-design` §1.1 and §9, `v1-design` §3.7 for the budget, `v5-design` §3.10 for the fake model, and `full-gm-design` §4.4 for the fake's full GM and `npm run status`.

```sh
cd v2 && npm ci
npm run dev -- --fake        # the fake model: no key, no cost
npm run dev                  # real models: OPENROUTER_API_KEY, or ~/secrets/kingmaker-dev-openrouter.txt
```

Then play from other terminals with `npm run client` or `npm run play`. They find the stack through `runs/dev/stack.json`.

## The budget

The AI service keeps a daily ceiling on what the models cost: `KM_AI_DAILY_USD` ($5 unless it's set, 0 for none), held against today's (UTC) lines in its ledger (`runs/dev/ai/ledger.jsonl`). Past it, every move that needs a model fails in the game's words ("The GM has spent today's budget ($5.00): it starts again at midnight UTC, or raise KM_AI_DAILY_USD."), and a kept answer is still served. The dev host passes the variable on, to the node process or the container, and its screen and the doctor say where today stands: `Budget  $0.12 of $5.00 today`.

```sh
KM_AI_DAILY_USD=0.001 npm run dev    # the ceiling, met at once: say a line and it fails in the ceiling's words
KM_AI_DAILY_USD=5 npm run dev        # raised (without --fresh, so the game is kept): /retry finishes the turn
```

The ledger is the stack's folder's, so `--fresh` starts today's count again.

## Flags

| Flag | What |
|---|---|
| `--fake` | the fake model (`KM_AI_MODEL=fake`), playing [fake.json](fake.json) (below): the GM's golden replies with notes and suggested lines, each written over two seconds, as a model takes about that long, so you see it grow and `k` can land in it. `KM_AI_FAKE`'s options, JSON, go on top: `'{"streamMs":0}'` answers at once, `'{"choices":{"attempt":"examine-body"}}'` makes the decider take the body's examination (a Medicine roll) where it can, `'{"choices":{"roll_call":"new"}}'` has the GM rule on every line (a considered turn: the file's ruling, a dice line, then the reply), `'{"replies":["…"]}'` gives the GM other words, and `"byName"` answers a structured call by its schema's name, beside the file's notes, co-GM and ruling (`builds`, `build`, `backstory`, `lore_check`, `traits` at character creation: otherwise the least JSON, so the builds are the class defaults, there's no draft, and the lore check finds nothing) |
| `--gm canned` | the AI service's canned GM: no model at all, for checking the plumbing |
| `--container` | the AI service in its podman image, built from `ai/Containerfile` at every start |
| `--fresh` | start with no data: deletes `runs/dev/stdb`, `runs/dev/ai` and `runs/play`. The keys stay, so the identities do |
| `--mode host\|namespace` | detected when absent (below) |
| `--port`, `--ai-port` | SpacetimeDB's port (3300) and the AI service's (8787) |
| `--root` | the stack's folder (`runs/dev`) |
| `--no-keys` | no keyboard; SIGTERM or Ctrl+C stops it |

## Keys

| Key | What |
|---|---|
| `k` | kill the AI service (SIGKILL), as a crash would |
| `s` | start it; a turn waiting to try it again goes on at once (`dispatch_waiting`), not when the module's backoff is up |
| `r` | restart it (SIGTERM: what's in flight is finished and answered first) |
| `f` | restart it so it exits right after it stores its next reply, before sending it (`KM_AI_FAULTS=exit-after-store:reply`); `s` starts it again without the fault, and the reply, asked for again, is answered from the store at once (the world then settles behind it, as after any reply) |
| `n` | the same, but it exits after the next notes on a reply it stores (`KM_AI_FAULTS=exit-after-store:notes`): press it, then say a line. The turn waits, noting ("The GM has lost the thread…"), until `s`, and then the notes come from the store |
| `p` | build and republish the module, then install the campaign again |
| `d` | run the doctor |
| `q`, Ctrl+C | stop the AI service, then SpacetimeDB. Press again to kill both at once. While the stack is still starting, Ctrl+C stops what has started |

## The fake model

`--fake` plays [fake.json](fake.json), so a game looks like one on real models, at no cost:

- **The replies** are the GM's four golden ones (`tools/v2/golden-replies.json`), marked up as the model writes them: Kell, Cob and Moll each in their colour, the girl in the shawl by what you call her, a line nobody can place in gold. Turn 0 hears the opening, turn 1 the first reply, and so on, round again after the fourth, whatever you say.
- **The notes** come 3.5 s after each reply, once the world has settled (2 s), so "The GM makes a note…" shows for a moment and you can type a line through it: a know and a why on the opening, two whys on the first reply, a you and a why on the second, a know on the third. Each has its card. A you is about something you did, so it lands only when one of your lines shares its words (the golden line before the second reply asked Moll what she saw from the wall). The notes' writer gives the same answer at every call, and each note is on words only its reply has. The know on the Royal Purveyor's office names its lore doc by its place in the notes' brief (`D18`, the 18th once Kell, Cob and Moll have been named): if the public lore changes, find its new place.
- **The suggested lines** come 2.8 s after each reply, as the prototype's did live: twelve lines (seven to say, two deeds, two risky tries, a way out), of which four are offered each time (two to say, a deed, a risky try), since the lines offered last time are screened out, and so are the last three you said. A way out joins them after four lines. A line said before a reply's lines come leaves them behind: the next set is offered against the one before.
- **Every model call streams** over 2 s: the reply, so you see it written, and the stage manager, the notes and the lines too. The notes wait 1.5 s more, and the lines 0.8 s.
- **The full GM** answers quietly, so a scene of many lines plays as it would on real models. The memory review after each line flags only what someone witnessed (the file's `choices` say `not_flagged` for the attention filter's other seven categories: the fake's decider would otherwise flag all eight), and its memories agent saves one memory for Kell, "What the investigator did" (`toolCalls.save_memory`): `npm run status -- --game <n> --memories` shows it a second after a line. The co-GM, after every third line, finds the scene on track with a short note and leaves the tracker where it is (`byName.co_gm_notes`: the least JSON would name the first beat and move the scene back). No line is considered unless a recipe says so (`roll_call` and `off_graph` take their quiet choices); with `'{"choices":{"roll_call":"new"}}'` every line is, and the ruling (`byName.ruling`) is a contest with Cob: lifting the folded paper from his boot, Sleight of Hand at DC 12 (guarded, plausible cover, wary), the reply waiting behind "The GM is considering the ramifications of your actions…" and its dice line.
- **Spells and blows** (the world bridge, `world-bridge-design` §1.4): the decider rules nothing unless a recipe says so (`mechanic` takes its quiet choice, none), and when the rules do resolve an act, the yard's people react quietly: Kell intervenes, Cob flees, Moll cowers and Tull is unmoved (`react_<id>`; the fake's default for a reaction is its first option, fight). `'{"choices":{"mechanic":"cast","spell":"magic-missile","aim_thing":"hoist-rope"}}'` casts Magic Missile at the hoist rope on every line, until the slots run out; `spell` and `aim_thing` take any of the sheet's spells and the place's things (`fire-bolt` and `elm`, `burning-hands` and `gate`); `'{"choices":{"threat":"attack:kell"}}'` has every reply leave Kell's blow hanging, to land as the next line begins.

- **Between scenes** (the whole story, `docs/story-design.md`), the hand-off is the file's plain one (`handoff`), which fits any boundary, so the notebook's "how things stood" reads as it would; the boundary's verdict is the least JSON (the next scene on, nothing rewritten, no lead, so Kell says the afternoon went in paperwork), presence the quiet "here", and no front moves. Every scene's opening is a golden reply, the yard's words wherever you are. The decider reaches no ending unless a recipe says so: the whole story's, `'{"choices":{"ending":["open-case","hobb-talks","fight","caught-in-the-act","justice"],"own_exit":"theirs"}}'`, ends each scene at the first of those it offers, the player's own doing, so a scene closes in two lines (the first reaches the ending, the second winds it down), and the Heron's fight comes on a line.

`KM_AI_FAKE`'s options go on top of the file's, key by key, and `byName`, `byNameDelayMs`, `choices` and `toolCalls` name by name, beside the file's (`hosts/dev/fake.ts`), so a recipe's choice keeps the full GM's quiet ones (a choice may be a list: the first the question offers is taken): `KM_AI_FAKE='{"streamMs":6000}'` is a slower model, `'{"suggestions":""}'` offers no lines, `'{"byNameDelayMs":{"notes":12000}}'` writes the notes 14 s after each reply, time to type a line while they're written, and character creation's answers in `byName` (the prototype's own, recorded in `ai/rules/golden/`) leave the notes' answer as it is. The e2e plays the file too, with its own holds on top where a step needs the notes or the lines late.

## Host mode and namespace mode

SpacetimeDB's HTTP client refuses loopback and the private address ranges. So the module always calls the AI service at `http://11.0.0.1:<ai port>`, and the stack makes that address reach it.

| Mode | When | SpacetimeDB | The AI service listens on |
|---|---|---|---|
| host | 11.0.0.1 is on one of this machine's interfaces | on the host's `127.0.0.1:<port>` | `11.0.0.1` and `127.0.0.1` |
| namespace | otherwise; needs `pasta` (the passt package) | inside pasta, which forwards the host's `127.0.0.1:<port>` in and maps 11.0.0.1 to the host's loopback | `127.0.0.1` |

For host mode, once per boot: `sudo ip addr add 11.0.0.1/32 dev lo`. For good: `sudo nmcli connection add type dummy ifname km0 con-name km0 ipv4.method manual ipv4.addresses 11.0.0.1/32 ipv6.method disabled`. CI uses host mode.

## What's in the stack's folder

| Path | What |
|---|---|
| `stack.json` | the URLs, the mode, the identities' tokens, the bearer and the pids. Local dev credentials: private to you, and gitignored with `runs/`. The client's `/end` and `npm run play -- end` read the owner's token here, to end a scene for testing as the database's owner (`end_scene`), and only on the stack they play on |
| `stdb/` | SpacetimeDB's data. `config.toml` sets the procedure pool to 16 |
| `keys/` | the keys that sign this server's tokens |
| `cli.toml` | the CLI's config for this stack (never `~/.config/spacetime`): the stack's server is its default and Maincloud isn't in it, so a command without `-s` stays on this machine. Logged in as the owner |
| `ai/` | the AI service's store: kept answers, call logs, the ledger, installed campaigns |
| `logs/` | `spacetime.log`, `ai.log`, and `dev.log` (each step, and the CLI's output) |

The module's own log: `spacetime --config-path runs/dev/cli.toml logs kingmaker -s kingmaker-dev -f`.

## The other tools

- **`npm run doctor`** checks a running stack and says how to fix what's wrong. It checks the versions, the mode, SpacetimeDB, the module and its env, the pool, the AI service's health and bearer, its budget, both paths between the services, and the campaign in both. It exits 1 if anything is wrong. `--root` picks another stack.
- **`npm run install-campaign -- campaigns/caerwyn`** checks the campaign, sends every file to the AI service, then the structure to the module. The dev host does this at every start.
- **`npm run status -- --game <n>`** shows the GM's side of a game, as the prototype's `scene status` does: its scene's beat, path, the co-GM's notes (and the turn it wrote them), whispers, canon and routes (`patches`), the GM's rulings, the co-GM's reviews (`repairs`: pending, or merged at the start of a turn), the memory reviews (`memoryReviews`, from the AI service's `memory-reviews.jsonl`), the notes disclosure opened, and the scene's background jobs in flight; then what the boundary handed on to the scene (the adjustments, the rewritten opening, the lead, who's absent, what's owed, the fights fought) and the story between scenes (`story`: the game's status and time, the lead and a boundary in flight, each chapter with its hand-off's first line and what its boundary cost, the quests, the flags, who walks with the player, the attitudes). It reads the latest scene of the game: a waiting one, once a boundary has crossed. It reads the stack's rows as the database's owner, and the AI service's store. `--memories` prints every memory the reviews wrote (each person's index and notes), as `scene memories` does. `--game` is the number in the side panel (the newest game when it's left out); `--root` picks another stack. Not for blind QA: it shows what the player hasn't seen.
- **`npm run live -- --script gm`** plays the full GM's eight lines (`full-gm-design` §1.2) as Wren Ashdown, the hedge wizard: a coin for Cob, a question at once, a lift from his boot, what Kell remembers, a plan off the graph, two lines that drift, and walking out. The fourth and the eighth wait for the memory review and the co-GM to be done, as a tester reading the reply would, and so does the record after the last; the record, `docs/live/gm-<date>.md`, adds the GM's side: each line's ruling, memory review and co-GM review, and where the co-GM left the scene. `--rehearse` runs it on the fake.
- **`npm run live -- --script story`** plays the whole story from the yard to The End as Wren Ashdown, the hedge wizard, through the headless client as the stack's owner: each scene ended by the exit the prototype's flow takes (`open-case`, `hobb-talks`, `fight`, `caught-in-the-act`, `justice`), the lead walked to, the fight's stand-in fought out, so every boundary and every opening is the models' and no line is. The record, `docs/live/story-<date>.md`, has each step's time and cost, and scene by scene what the boundary handed on, the opening, the ending and the hand-off, then Kell's words between the scenes and The End. It stops before a step the budget (`--budget`, $0.10) can't cover. `--rehearse` runs it on the fake.
- **`npm run live -- --script v5`** plays V5's twelve lines of the hanged clerk against the running stack, with its models, and writes `docs/live/v5-<date>.md` (beside it, `v5-<date>-2.md`, if that's there: `--force` writes over a record, and nothing else does): each turn's timings, who said what, the notes with their cards, the lines offered and those screened out, the calls and their cost, the measures against the prototype's, and what the scene holds back. It stops before a line that would take it past $0.10 (`--budget`). It finds the stack by its ports (`--port`, `--ai-port`, else 3300 and 8787) or its folder (`--stack`), and refuses the fake model unless it's a rehearsal (`--rehearse`), whose record goes to `runs/live/`. `--lines 2` plays two; `--script v0` (the default) is V0's six. `npm run live -- --creation` is V1's run instead, to `docs/live/v1-<date>.md`: three concepts' builds, then Tamsin Vell made through the lore check to her first line.
- **`npm run campaign -- check campaigns/caerwyn`** checks a campaign folder without a stack: its scenes, places and looks, its ready-made builds against the rules engine's pack, the lore character creation's world reads, and its `vocabulary.json`: what the suggested lines are vetted against of the prototype's scenes, written by `tools/v2/export-vocabulary.mts`. Each scene the campaign installs must agree with its entry (prep, hook, ways on, cast, world names): when a scene changes, write the vocabulary again from a prototype whose scene matches.

## When it doesn't start

| It says | Do |
|---|---|
| there's no OpenRouter key | add `--fake`, or set `OPENROUTER_API_KEY` |
| `127.0.0.1:<port>` is in use | another stack is running (`npm run doctor` says), or choose another `--port` or `--ai-port` |
| a stack is already running from `runs/dev` | quit that dev host first |
| host mode needs 11.0.0.1 | add the address (above), or leave `--mode` out |
| spacetime publish failed: the database belongs to another identity | the keys changed under old data: `--fresh` |
| the AI service didn't answer | the end of `logs/ai.log` is in the message |

A dev host that was killed leaves its processes running. The next start stops them, but only processes whose command line or environment names this folder.

## For the e2e

`stack.ts` is the library under the dev host, and F's e2e shares it:

```ts
const stack = await startStack({ root: "runs/e2e", stdbPort: 3310, aiPort: 8797, model: "fake", fresh: true });
await stack.install("campaigns/caerwyn");
const report = await stack.doctor();
await stack.ai.stop("SIGKILL");
await stack.ai.start({ KM_AI_FAULTS: "exit-after-store:settle" });
await stack.stdb.stop(); await stack.stdb.start();
await stack.down();
```

`call` and `sql` work as the owner or the AI service. A refusal throws a `CallError` with the status (530) and the refusal's JSON. `install` throws unless both services took the campaign. `StackOptions.signal` (an `AbortSignal`) stops a start under way and whatever it has started.
