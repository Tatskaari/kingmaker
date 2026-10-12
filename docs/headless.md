# Headless play from TypeScript

`WorldHeadlessGame` in `packages/headless/src/world.ts` loads a document `WorldState`
or `WorldSnapshot`. `observe()` uses Jev's readable room view for the player;
`actions()` lists available IDs and `await act(id)` approaches and interacts through the
same player runtime methods as the UI. `talk(id, message)` and
`endConversation(id)` use real model-backed dialogue and review.

`inspect()` returns detached typed state; `edit(state => { ... })` applies direct
world edits. `snapshot()` and `load(snapshot)` capture and restore the entire
session, including conversations. `overview()` returns the browser view as an object. The underlying `runtime` is also available for setup and advanced use.

Run `npx tsx scripts/play-headless.ts` for an offline example. There are no eval
criteria, terminal choices, or turn limits. Dialogue requires an OpenRouter key
passed to the constructor. Background NPC scheduling is not automatically started;
actions return world events for explicit processing through the runtime. An
`act("enter_...")` call returns the same movement result as `move(x, y)`, including
`worldEvent` when entering private quarters without permission. Pass that event
to `runtime.assessWorldEvent`, then process its reactions with
`runtime.processPerceivedEvent` to drive NPC responses.

## Persistent TypeScript socket console

Start a process, then send snippets from another terminal:

```sh
npm run headless -- start --dev-player
npm run headless -- exec --code 'return game.observe();'
npm run headless -- exec --code 'return game.actions();'
npm run headless -- exec --code 'return await game.talk("rowan", "What brings you to court?");'
npm run headless -- exec --code 'await game.endConversation("rowan");'
```

For QA clients that must play only through the same choices available to a player,
start the socket in restricted mode:

```sh
npm run headless -- start --qa --dev-player
npm run headless -- observe
npm run headless -- act --id enter_entrance_hall
npm run headless -- act --id talk_rowan
npm run headless -- say --message 'What brings you to court?'
npm run headless -- end-conversation
npm run headless -- dump --description 'The door disappeared after I opened it' --output /tmp/door-disappeared.zip
```

QA mode exposes only `game.observe`, `game.act`, `game.say`,
`game.end_conversation` and `game.dump` over JSON-RPC. Observation returns Jev's player room view,
the current structured action list and any active conversation. GM-owned quest
graphs and stage guidance are deliberately omitted; objectives must be learned
through play. `act` accepts one of those action IDs and revalidates it against the
live player observation before moving or interacting. A `talk` action starts a
conversation and suppresses physical actions until `end_conversation`; `say`
accepts plain English and returns the character's reply. `end_conversation`
waits for all review work from that exchange before it returns and physical
actions become available, preventing a second conversation from starting against
stale character state. `game.execute` and all
direct runtime, service, snapshot, and JavaScript access return `Method not found`.
When reporting an issue, `dump` accepts a description of what happened and what
was expected plus an absolute destination filepath. The server writes the
standard diagnostic ZIP there with mode `0600` and refuses to overwrite an
existing file; no diagnostic contents cross JSON-RPC. The archive contains
internal debugging data and is an attachment, not a source of gameplay information. Use
`--dev-player` or a playable `--world` because a fresh character-creation game has
no placed player to observe. Developer and QA servers use the same default socket,
so run only one at a time or give each a distinct `--socket`.

Set `OPENROUTER_API_KEY` on the **server** for dialogue and reviews. `--dev-player`
uses the existing development envoy and skips character creation. Without this
flag, a fresh authored scenario starts in player creation. Use
`game.runtime.startIntroduction()` and `game.runtime.talkToGameMaster(...)` for
the interview, or `await game.runtime.startPremadeCharacter("bard")` to enter as
a pre-made character. Dialogue and pre-made character setup require the server's
OpenRouter key. Player observations and actions become available after setup.

Use `--world path.json` to load document-backed v2 WorldState JSON or a current WorldSnapshot JSON, and
`--socket path` on both commands to select a separate game.
`--dev-player` only affects fresh games; `--world` always preserves the supplied
world or snapshot's player and creation state. The default socket is
`/tmp/kingmaker-<uid>/game.sock` (under the system temp directory). Existing sockets
are never removed on startup: stop the previous server, or remove a stale socket
only after confirming its process is gone.

`exec --file script.ts` reads a snippet file; `exec` alone reads stdin. Code is an
async function body with `game` and a captured `console`. Use explicit `return`;
`undefined` becomes `null`. Type annotations are stripped, without type checking;
TypeScript syntax requiring transformation, such as enums, is unsupported. Each
snippet has fresh local variables but acts on the same persistent game. Requests
from all clients execute sequentially. There is no execution timeout; trusted
snippets that loop forever require restarting the process. Errors retain earlier
accepted commands, and disconnecting does not cancel or safely retry execution.

Save a full session with:

```sh
npm run --silent headless -- exec --code 'return game.snapshot();' > /tmp/palace-save.json
```

Inspect only what you need; apply changes through services:

```ts
return game.inspect().simulation.runtimeCharacters.rowan.activity;
// Or, in another snippet:
const map = game.inspect().simulation.map;
game.services.mechanics.commit({ ...map, day: 2 }, {});
return game.overview();
```

Simulation state returned by `inspect()` is frozen. Use `game.services` for
validated document, inventory and mechanics updates, or `game.move()` / `game.act()`
for gameplay. Direct assignment is rejected; `game.edit()` is no longer provided.

The socket speaks newline-delimited JSON-RPC 2.0. Each method's params and results
use the corresponding ProtoJSON request and response messages defined in
`packages/contracts/proto/kingmaker/headless/v1/console.proto`. Snippet errors use
code `-32000` with `ExecutionError` in `error.data`; protocol errors use standard
JSON-RPC codes. Logs are separate from the returned JSON value. Requests and
individual results are limited to approximately 1 MiB; select smaller state
fragments when needed. The TypeScript client is `execute(socketPath, code)` from
`packages/headless/src/client.ts`, returning `{ value, logs }`.

This is trusted local code execution, not a sandbox. The socket is user-only
(mode 0600); do not expose it to untrusted clients. Only explicit requests advance
the game: browser background NPC scheduling and automatic event reactions are
not started by this console.


See [local setup and validation](development.md) for prerequisites and checks.
