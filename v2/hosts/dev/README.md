# The dev stack

`npm run dev` runs V0 on one machine: SpacetimeDB with the module published, the AI service, and the campaign installed in both. Then it checks that each service can reach the other, and gives you keys to break and mend the AI service while you play. The blueprint is `v0-design` §1.1 and §9.

```sh
cd v2 && npm ci
npm run dev -- --fake        # the fake model: no key, no cost
npm run dev                  # real models: OPENROUTER_API_KEY, or ~/secrets/kingmaker-dev-openrouter.txt
```

Then play from other terminals with `npm run client` or `npm run play`. They find the stack through `runs/dev/stack.json`.

## Flags

| Flag | What |
|---|---|
| `--fake` | the fake model (`KM_AI_MODEL=fake`): its GM writes each reply over four seconds, as a model takes about that long, so you see it grow and `k` can land in it. Its options are `KM_AI_FAKE`'s, JSON, on top: `'{"streamMs":0}'` answers at once, `'{"choices":{"attempt":"examine-body"}}'` makes the decider take the body's examination (a Medicine roll) where it can, `'{"replies":["…"]}'` gives the GM its words |
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
- **`npm run campaign -- check campaigns/caerwyn`** checks a campaign folder without a stack.

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
