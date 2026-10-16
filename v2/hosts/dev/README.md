# The dev stack

`npm run dev` runs v2 on one machine: SpacetimeDB with the module published, the AI service, and the campaign installed in both. Then it checks that each service can reach the other, and gives you keys to break and mend the AI service while you play. The blueprint is `v0-design` §1.1 and §9, and for the fake model `v5-design` §3.10.

```sh
cd v2 && npm ci
npm run dev -- --fake        # the fake model: no key, no cost
npm run dev                  # real models: OPENROUTER_API_KEY, or ~/secrets/kingmaker-dev-openrouter.txt
```

Then play from other terminals with `npm run client` or `npm run play`. They find the stack through `runs/dev/stack.json`.

## Flags

| Flag | What |
|---|---|
| `--fake` | the fake model (`KM_AI_MODEL=fake`), playing [fake.json](fake.json) (below): the GM's golden replies with notes and suggested lines, each written over two seconds, as a model takes about that long, so you see it grow and `k` can land in it. `KM_AI_FAKE`'s options, JSON, go on top: `'{"streamMs":0}'` answers at once, `'{"choices":{"attempt":"examine-body"}}'` makes the decider take the body's examination (a Medicine roll) where it can, `'{"replies":["…"]}'` gives the GM other words |
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
| `f` | restart it so it exits right after it stores its next answer, before answering (`KM_AI_FAULTS=exit-after-store:any`); `s` starts it again without the fault, and the retried request is answered from the store |
| `p` | build and republish the module, then install the campaign again |
| `d` | run the doctor |
| `q`, Ctrl+C | stop the AI service, then SpacetimeDB. Press again to kill both at once. While the stack is still starting, Ctrl+C stops what has started |

## The fake model

`--fake` plays [fake.json](fake.json), so a game looks like one on real models, at no cost:

- **The replies** are the GM's four golden ones (`tools/v2/golden-replies.json`), marked up as the model writes them: Kell, Cob and Moll each in their colour, the girl in the shawl by what you call her, a line nobody can place in gold. Turn 0 hears the opening, turn 1 the first reply, and so on, round again after the fourth, whatever you say.
- **The notes** come 3.5 s after each reply, once the world has settled (2 s), so "The GM makes a note…" shows for a moment and you can type a line through it: a know and a why on the opening, two whys on the first reply, a you and a why on the second, a know on the third. Each has its card. A you is about something you did, so it lands only when one of your lines shares its words (the golden line before the second reply asked Moll what she saw from the wall). The notes' writer gives the same answer at every call, and each note is on words only its reply has. The know on the Royal Purveyor's office names its lore doc by its place in the notes' brief (`D18`, the 18th once Kell, Cob and Moll have been named): if the public lore changes, find its new place.
- **The suggested lines** come 2.8 s after each reply, as the prototype's did live: twelve lines (seven to say, two deeds, two risky tries, a way out), of which four are offered each time (two to say, a deed, a risky try), since the lines offered last time are screened out, and so are the last three you said. A way out joins them after four lines. A line said before a reply's lines come leaves them behind: the next set is offered against the one before.
- **Every model call streams** over 2 s: the reply, so you see it written, and the stage manager, the notes and the lines too. The notes wait 1.5 s more, and the lines 0.8 s.

`KM_AI_FAKE`'s options go on top of the file's, key by key: `KM_AI_FAKE='{"streamMs":6000}'` is a slower model, `'{"suggestions":""}'` offers no lines. The e2e plays the file too, with its own holds on top where a step needs the notes or the lines late.

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
| `stack.json` | the URLs, the mode, the identities' tokens, the bearer and the pids. Local dev credentials: private to you, and gitignored with `runs/` |
| `stdb/` | SpacetimeDB's data. `config.toml` sets the procedure pool to 16 |
| `keys/` | the keys that sign this server's tokens |
| `cli.toml` | the CLI's config for this stack, logged in as the owner (never `~/.config/spacetime`) |
| `ai/` | the AI service's store: kept answers, call logs, the ledger, installed campaigns |
| `logs/` | `spacetime.log`, `ai.log`, and `dev.log` (each step, and the CLI's output) |

The module's own log: `spacetime --config-path runs/dev/cli.toml logs kingmaker -s kingmaker-dev -f`.

## The other tools

- **`npm run doctor`** checks a running stack and says how to fix what's wrong. It checks the versions, the mode, SpacetimeDB, the module and its env, the pool, the AI service's health and bearer, both paths between the services, and the campaign in both. It exits 1 if anything is wrong. `--root` picks another stack.
- **`npm run install-campaign -- campaigns/caerwyn`** checks the campaign, sends every file to the AI service, then the structure to the module. The dev host does this at every start.
- **`npm run live -- --script v5`** plays V5's twelve lines of the hanged clerk against the running stack, with its models, and writes `docs/live/v5-<date>.md`: each turn's timings, who said what, the notes with their cards, the lines offered and those screened out, the calls and their cost, the measures against the prototype's, and what the scene holds back. It stops before a line that would take it past $0.10 (`--budget`). It finds the stack by its ports (`--port`, `--ai-port`, else 3300 and 8787) or its folder (`--stack`), and refuses the fake model unless it's a rehearsal (`--rehearse`). `--lines 2` plays two; `--script v0` (the default) is V0's six.
- **`npm run campaign -- check campaigns/caerwyn`** checks a campaign folder without a stack, its `vocabulary.json` too: what the suggested lines are vetted against of the prototype's scenes, written by `tools/v2/export-vocabulary.mts`. Each scene the campaign installs must agree with its entry (prep, hook, ways on, cast, world names): when a scene changes, write the vocabulary again from a prototype whose scene matches.

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
