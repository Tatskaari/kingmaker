# Kingmaker

An improvised political cRPG: talk to the court, explore the palace, and let NPCs
act on the intentions they form. Every hundred years, Ironmark, Greenweald and
Saltmere must formally recognise the sovereign over the four kingdoms. Ordinary
inheritance continues within the ruling house’s mandate. Time progression and
formal recognition resolution are not implemented yet.

## Run

```sh
proto install
proto run npm -- ci
proto run moon -- run workspace:dev
```

Open `http://127.0.0.1:5173`. The main game is the only page. Enter an OpenRouter
key, read the sandbox welcome, then meet the Stranger. His authored opening leads
into a short checklist: name, archetype and talents, backstory and delegation,
then relationships with the court. Motivation is optional; the Stranger infers
your starting build from your approach and history. Review the resulting character, choose an appearance,
correct any details, and save to enter the palace. The opening, conversation and
review draft persist through saves and reloads.
The key stays in tab-scoped session storage and is excluded from saves. Games
are saved in IndexedDB. Change OpenRouter key clears the remembered credential.

Left-click to walk or change destination mid-walk. Right-click a tile for ordered
actions. Interactions walk to the appropriate point before taking effect; illegal
actions are red. Conversations open over the map. NPCs start idle and act when a
DM reconciliation assigns a concrete task after a conversation or action run.
The DM sees the authoritative world and decides whether to keep, replace, or
cancel a proposed task. Its `create_item` tool can place an inspectable prop in an
existing container or character inventory; `cancel_task` clears a participant's
goal and leaves them idle. This is general adjudication, not a document-specific
workflow. During dialogue, characters can privately use `ask_the_game_master`
to check what they know, whether a player's proposed premise fits the world,
or whether they can accomplish work beyond the simulated mechanics—for example,
investigating house accounts to reveal a fact. The GM immediately rules on the
request, may update the character or add justified items, and returns a summary
and item descriptions before the character replies. The GM can confirm, qualify,
or reject a premise; a knowledge answer needs no inventory addition. NPCs can inspect item details, and
the player's character sheet shows the details of carried items.

Reconciliation uses a bounded tool loop and commits world additions and memories
together only after final validation. Concurrent inventory/container changes
invalidate the staged additions for retry. Tool requests and results appear in
the model transcripts. The DM can add props, but cannot invent new mechanics or
make an unsupported task executable merely by describing it.

The court includes Aldren, Corvin, Garran and three delegates from each vassal
kingdom. Their rival interests, Edric’s peace settlement and the grain crisis are
described in [the scenario premise](content/lore/premise.md). All physical items
use the live fixture/inventory system; regalia and documents cannot confer rule.

The Stranger introduces the court and delegations as they become relevant to
your character. No setting knowledge or identity choices are required upfront.
The Stranger starts with an amused portrait. After each reply, Jev classifies his
visible expression in the background; scared is displayed as amused. Portrait
updates do not delay dialogue or replace text in the reply composer. The last five
displayed portraits (including repeats and the scared-to-amused fallback) accompany
each classification. After three identical portraits, Jev looks for a plausible
change supported by the dialogue. This display history resets when a game is loaded.

## Models and debugging

GPT-6 Luna handles dialogue with reasoning off and the GM, reviews and NPC-to-NPC
exchanges with low reasoning. Settings live in
`apps/web/src/model-settings.ts`; every game-model request uses the OpenRouter ID
`openai/gpt-6-luna`.
Jev selects from currently reachable actions.

OpenRouter Chat Completions and Responses requests use streaming transport.
The Stranger and court dialogue appear progressively as text arrives. Reasoning
and tool arguments remain hidden. Provisional text is cleared on failure or retry and is
replaced by the committed transcript on completion. JSON validation, tool
execution and game-state changes still wait for the complete reply. Cancellation
and the request timeout remain active while reading the stream.

Action-execution Jev context is configured in `apps/web/src/feature-flags.ts`:

- Jev always receives the readable room/action text as its actual `state`, with
  room-scoped actions. The legacy palace-wide planner has been removed.
- `JEV_ACTION_CONTEXT_LEVEL = 1`: world text and the full active objective
  (name, status, success criteria, current task).
- Level `2` adds biography and full parked objectives.
- Level `3` also adds relationships and character-visible notes.
- `JEV_ACTION_INCLUDE_RECENT_RESULTS = true` includes the exact completed action
  IDs, one per line, in every tier. It defaults to `true`; disable it for ablation evals.

The input is ordered: who you are (including selected character context), current
objective, world state, action log. The log is chronological and starts with
`None yet.`. It records completed actions, not rejected plans or walking ticks,
and is scoped to the current activity. Older saves without action IDs start an
empty log; existing prose history is retained in saved activity state.

The text includes room connections, actions to enter adjacent rooms, local
interactions with action IDs and walking distances, known contents, inventory,
blocked exits, and illegal-action labels. Paths and generation guards remain in
the engine. No scenario premise or hidden character context is appended. The API
still receives the short execution instructions and selectable choice criteria.
Event-reaction Jev, dialogue, and GM context are unaffected by these settings.

The debug inspector shows world state, character context and recent transcripts:
requests, responses, summaries, duration and errors for the latest 50 calls.
These logs survive rollback but are not saved across reloads. NPC conversations
record the initiating request and the GM resolution separately.

NPC execution is serial and bounded. Stop Jev cancels pending planning or walking;
active goals and pending reviews can be resumed after loading a save.

### Conversation check classifiers

`packages/providers/src/conversation-checks.ts` exports an independent Jev
classifier for each of the 18 skills, including persuasion, deception,
intimidation, and insight:

```ts
const result = await conversationCheckClassifiers.persuasion(client, {
  playerTurn: "Please let us in; we can help protect the council.",
  history: [{ speaker: "guard", text: "Entry is forbidden." }],
  context: "The guard is reluctant to admit visitors without authorization.",
}, signal);
// result: { skill, needsCheck, decision }
```

Each classifier sends only its own binary question. `classifyConversationTurn`
optionally batches all the same questions in one request and returns
`{ needsCheck, checks, decisions }`. Provide established facts and obstacles as
context; unknown facts are not assumed to warrant a check. These APIs classify
attempts only and do not resolve dice rolls. Decision
probabilities are model evidence, not roll success odds. Errors propagate rather
than silently becoming a no-check result.

The browser runs these classifiers alongside each submitted player conversation
turn (including a spoken farewell), without delaying the reply. Jev receives the
same complete initial `messages` as the dialogue LLM, including character system
prompts, conversation history, and the current player turn. These messages are
evidence for Jev's separate classification instructions. Look for
`kind: "conversation_check"` in the structured browser console logs, or
**Jev conversation checks** in the debug inspector. Results include `needsCheck`,
the matching `checks`, and all per-skill `decisions` with probabilities and
confidence when supplied. Calls share the conversation's run ID. Classification
failures are logged without interrupting dialogue; results do not change game state.

## Reset while developing

With a loaded character, use the browser console:

```js
await resetWorld();       // Reset physical state and positions; NPCs become idle.
await resetCharacters();  // Restore authored NPCs and notes; clear conversations/tasks.
```

Both commands save automatically and preserve the player character. `resetWorld`
keeps character memories and conversations. `resetCharacters` keeps positions,
doors, containers and inventories. Reload after changing authored scenario data.
Old saves are not migrated to the renamed characters and expanded court; start a
fresh game for this scenario.

## World v2 architecture

Hooks define game policy, services provide operations, and the host owns state
and coordinates execution. These are in-process TypeScript interfaces, injected
through `ConversationRuntime`, rather than separately deployed services.

### Services and state

| Service | Responsibility |
| --- | --- |
| `scenario` | Scenario identity, character entrypoints and detached world snapshots |
| `docs` | Read and edit narrative documents with SHA-checked writes |
| `map` | Layout, character-visible physical observations, available actions and validated interactions |
| `ai` | Structured decisions and model responses; policy supplies the prompts |
| `lore` | `forCharacter(id, signal)` supplies fresh character-scoped initial documents, permitted links and disclosure |
| `character` | Character replies and check/save operations |
| `presentation` | Display rolls, portraits and committed map updates |
| `random`, `debug` | Replaceable randomness and observational tracing |

The [service interfaces](packages/conversation/src/services.ts) are the compiled
contract. Missing operations throw explicitly; hosts supply the dependencies
their flows need.

The world host resolves lore through `services.lore.forCharacter` for dialogue,
planning, reviews and each participant in an NPC exchange. Its default document
adapter also accepts partial `initial`, `links` and `open` overrides; a complete
scoped override avoids loading document lore. Use `forCharacter` when replacing
lore for multiple characters, so each receives only their permitted knowledge.
Per-turn service methods override host methods. Check hooks call
`services.character.rollCheck` once per classified check and pass the returned
outcome unchanged to presentation and narration; the host supplies default dice
mechanics when no override is provided.

[`createScenarioServices`](packages/lore/src/services.ts) owns one authoritative
v2 world: narrative documents, the physical map and typed character properties.
Document writes preserve physical properties. An internal mechanics commit
updates the map and typed properties without rewriting narrative documents;
hooks reach physical mutations through `map.interact`.

[`WorldHost`](apps/web/src/world-host.ts) projects that world into disposable
`PalaceMechanics` instances to reuse the physical rules. The projection is not a
second source of truth. A character's `activity` and `wait` properties reference
private Markdown documents; the activity holds its name, status, success criteria
and current goal. The host keeps conversations and execution bookkeeping alongside
the world in its snapshot. See [activities and waits](docs/activity-waits.md). Incompatible older saves require a fresh game.

### Hook pipelines

Hooks separate classification from resolution: classifiers return labels from
evidence, and resolvers use those labels to perform operations. Classification
receives detached context; it does not mutate the live turn or execute actions.

| Hook family | Responsibility |
| --- | --- |
| `conversation` | Resolve disclosure and checks, reclassify when context expands, then generate the character reply |
| `review` | Review a completed conversation and publish notes, activities and waits |
| `action` | Plan a concrete action or return `complete`, `wait` or `unable` |
| `actionExecution` | Execute a physical command through the map service |
| `resolution` | Handle NPC exchanges, task outcomes and perceived world events |

Planning and execution are separate. Choosing an action does not move a character;
execution validates current state and advances the action, potentially one tile
at a time. A talk result hands off to conversation or exchange resolution.
Narrative review records knowledge and intentions, not completed physical effects.
Review and action-execution classifiers currently return empty labels; perceived
event classification decides whether an event warrants attention.

The normal cycle is conversation → review → notes and active goal → observe →
plan → execute, repeating planning as needed. Exchanges, task outcomes and
perceived events feed back into notes and goals through resolution hooks.

[`WorldGameRuntime`](apps/web/src/world-runtime.ts) composes the default policies
and services. Hosts coordinate scheduling, cancellation, persistence and fork
publication. SHA checks protect document edits; world generations and transcript
checks reject stale plans or model results. The browser worker persists an action
before presenting its map update, so a rendering failure cannot undo a saved
action. Headless map presentation defaults to a no-op.

### Dependency injection for implementations, tests and evals

Dependency injection (DI) is how we plug in new implementations: replace hooks
to change decision-making policy, replace services to change how operations are
performed, and change the host for scheduling or application integration.
`ConversationRuntime` accepts `services` and `hooks` options;
`WorldGameRuntime` composes overrides with its defaults, and `WorldHeadlessGame`
accepts these options as its third constructor argument. Overrides are retained
when the world runtime forks or the headless game reloads.

Tests can inject fake or mocked AI responses, map interactions, presentation and
deterministic randomness while exercising the shared pipelines. Individual hook
phases can also be replaced to test a policy independently.

The same boundaries support evals that A/B test a candidate implementation
against a baseline. Start each variant from the same world snapshot and evidence,
inject the baseline or candidate hook/service, and keep the remaining dependencies,
randomness and scoring criteria fixed. Compare outcomes and recorded traces across
repeated runs. This allows policy, prompt, provider or service changes to be
evaluated through the same execution flow used by the game. It is an injection
pattern for eval harnesses, not a claim that every existing eval runner already
supports arbitrary v2 overrides.

The migration is still in progress: some host paths retain palace-specific
observations and perception rules, conversation setup still wires some dependencies
directly, and legacy runtime/eval cleanup remains. See
[map services](docs/map-services.md) and
[conversation hooks and services](docs/conversation-services.md) for more detail;
the compiled interfaces and v2 host take precedence over older v1 examples.

## Code and validation

- `content/scenarios/last-night.json`: characters, notes and physical world data.
- `apps/web/src/world-host.ts`: authoritative v2 state and physical mechanics adapter.
- `apps/web/src/world-runtime.ts`: service injection and game policy composition.
- `packages/conversation/src/runtime.ts`: shared hook and service contracts.
- `apps/web/src/court-agent.ts`: grounded actions and planner observations.
- `apps/web/src/court-map.ts`: map rendering, walking and interaction menus.
- `packages/core/src/context.ts`: character knowledge and dialogue context.
- `packages/contracts/proto/kingmaker/v2/world.proto`: document-backed world contract.
- [Architecture](docs/architecture.md), [navigation](docs/navigation.md),
  [autotiling](docs/autotiling.md), [cleanup audit](docs/cleanup-audit.md).

```sh
proto run moon -- run workspace:check workspace:build
```

The legacy Scenario-based eval harnesses and fixtures have been retired.
Document-native evaluations will be designed separately; deterministic runtime
and provider tests remain part of the checks above.

The production site is built into `dist/web`. Merges to main deploy through
`.github/workflows/pages.yml`. Relative asset URLs support GitHub Pages paths.

Pull requests from branches in this repository get a sticky QA comment linking to
`https://tatskaari.github.io/kingmaker/pr-preview/pr-<number>/`. Each push updates
the preview; closing or merging the PR removes it. Fork PRs do not publish previews.
The comment appears when the preview build is stored; wait for **Deploy GitHub
Pages** to finish before opening it (or refresh if it still shows the previous build).

`preview.yml` stores compiled previews on `gh-pages`. On successful completion,
`pages.yml` builds production from `main`, includes the stored `pr-preview/` tree,
and deploys the combined site. Production deploys preserve other open previews.
Keep the repository Pages source set to **GitHub Actions**. The workflows must land
on `main` once before the completion trigger can publish previews; existing PRs
get a preview on their next push or reopen. A manual Pages run republishes the
latest production and stored previews if a deployment needs retrying.

The OpenRouter key is remembered in local browser storage across tabs, browser
restarts, production and previews on the same origin. Enter it once in that browser;
**Change OpenRouter key** removes the remembered key. Clearing site data or using a
different browser requires entering it again. Only open trusted previews: their
JavaScript can access the remembered key, as can other sites on the same GitHub
Pages origin. No key is embedded in deployed files, comments or game saves.


## Game logs

[LogTape](https://logtape.org/) sends structured game logs to the browser console
(including the game worker). Enable **Verbose** in DevTools to see debug records;
filter by `kingmaker` or an event/character ID. Log properties are expandable objects.

`npm test` and `npm run check` write JSON-lines files under `test-output/logs/`.
Each test process gets its own timestamp/PID file, with its test filename in the
first record. Tests run without Moon caching so each invocation produces fresh logs.
Set `KINGMAKER_LOG_DIR` to override the directory. Files accumulate across runs;
remove `test-output/logs/` when no longer needed. Logs are ignored by Git.
For a focused test with file logging:

```sh
node --import tsx --import ./scripts/test-logging.ts --test tests/contracts.test.ts
```

Shared code uses `gameLogger(component)`; entry points choose the sink with
`configureGameLogging`. The default threshold is `debug`; callers may select a
higher level or `disabled`. The Node file sink is never imported by browser code.

The `events` category records event creation, earshot candidates/exclusions,
each perception roll (a uniform 0–1 value, compared with its chance), perceived
text, and Jev's process/ignore choice, probabilities, and confidence when supplied.
Use `properties.eventId` and `properties.characterId` to follow an event.
`npc` records selected plans, executed actions, and activity stops. `models` records
requests, responses, failures, duration, and run/call IDs; `providers` records HTTP
failures and rate-limit retries. Model payloads use the existing transcript key
redaction. Debug logs contain story spoilers and conversation text, so inspect them
before sharing. A completed review on a runtime snapshot can still be rejected
when it is published to the live game.

The `decisions` category covers **every provider call**, including chat completions,
Responses API tool calls, Jev's single/multiple-choice decisions, and direct eval
calls. Pair request and response records using `properties.requestId`. Requests
include model inputs and available tools/criteria; responses include returned text,
tool arguments, choices and probabilities. These are the model's returned outputs,
not hidden reasoning. Runtime `models` logs add character/run context and explicit
`LLM tool result` records (matched by tool-call ID), including rejected writes and
successful review completion. Both provider and runtime model logs redact API keys.

### Headless play from TypeScript

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
actions return world events for explicit processing through the runtime.

### Persistent TypeScript socket console

Start a process, then send snippets from another terminal:

```sh
npm run headless -- start --dev-player
npm run headless -- exec --code 'return game.observe();'
npm run headless -- exec --code 'return game.actions();'
npm run headless -- exec --code 'return await game.talk("rowan", "What brings you to court?");'
npm run headless -- exec --code 'await game.endConversation("rowan");'
```

Set `OPENROUTER_API_KEY` on the **server** for dialogue and reviews. `--dev-player`
uses the existing development envoy, whose speech can directly command NPCs. To
try normal roleplay, change its delegation through `game.edit(...)`, or load a
normal player save. Without this flag, an authored scenario starts in player
creation; the normal setup methods remain accessible through `game.runtime`.

Use `--world path.json` to load a Scenario JSON or RuntimeSnapshot JSON, and
`--socket path` on both commands to select a separate game. The default socket is
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
mutations, and disconnecting does not cancel or safely retry execution.

Save a full session with:

```sh
npm run --silent headless -- exec --code 'return game.snapshot();' > /tmp/palace-save.json
```

Inspect or edit only what you need:

```ts
return game.inspect().characters.find(c => c.id === "rowan").currentGoal;
// Or, in another snippet:
game.edit(state => { state.world.day = 2; });
return game.overview();
```

The socket speaks newline-delimited JSON-RPC 2.0. `game.execute` params/results
use ProtoJSON for `ExecuteRequest`/`ExecuteResponse`, defined in
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

## Lore authoring

Open [`lore/`](lore/index.md) as an Obsidian vault and begin at `index.md`.
It organizes the direction in issues 108–111 into world, cast and plot notes,
with empty scenario stubs ready for author sketches. The running game still
reads `content/` and does not import the vault.

Lore visibility is checked by the normal test suite. Every scenario character
entry must link only to permitted notes, including through further links.
See [lore access tests](docs/lore-access-audit.md) for the metadata format and
focused test command.

## Conversation debugger

Conversation turns share a `classify → resolve → respond` handler in
`packages/conversation/src/phases.ts`. Hooks and conversation services are supplied
to `ConversationRuntime`; the [v2 architecture](#world-v2-architecture) extends
these boundaries to review, action planning, execution and resolution.
The CLI uses disclosure hooks, while browser and headless player conversations
use the existing skill-check policy through check hooks. Resolution can request
another classification pass after adding information. Only resolution changes
the prepared context; classification receives a detached view.

`WorldHeadlessGame` accepts conversation runtime options as its third constructor
argument, including custom hooks and individual service overrides. The browser
worker supplies `presentation.showRoll` for its popup; the default headless
presentation returns immediately. Jev classifies the required checks and their difficulty categories. Resolution
generates every roll first, then runs sequential dice presentations alongside one
GM request for the actual outcomes. Dialogue waits for both. Cancelling either
operation cancels its sibling. Very easy/easy/normal/hard/very hard map to DC
5/10/15/20/25; trivial only fails on natural 1 and impossible only succeeds on
natural 20, irrespective of modifiers.

The AI response service retries transient provider/network failures and timeouts
once. A truncated response retries with twice the output-token budget. Cancellation
and non-retryable provider errors stop immediately. Dice stay resolved and the
popup remains open during a retry; exhausted failures cancel the paired operation.

Run `proto install` to install the pinned Node 26 runtime, then
`OPENROUTER_API_KEY=… npm run conversation -- --character corvin` in an
interactive terminal. OpenTUI renders React components directly in the terminal.
The conversation takes 80% of the width; individual model
messages take 20%. The sidebar lists system prompts, user messages and assistant
replies in order, without repeating history for each call. Click a message (in
terminals supporting SGR mouse reporting) or press Tab to inspect its full text.
System prompts are available before the first reply. Use Up/Down to select
messages, the mouse wheel over the left pane or Page Up/Down to scroll, and Escape
to return to chat. Shift+Up/Down scrolls one line at a time. The header shows
the latest call's duration; pending replies and errors appear in the sidebar.
Drag normally within either pane to select its text, then press Ctrl+Y to copy.
Ctrl+C also copies when text is selected; otherwise it finishes the conversation.
Selection is managed by the app, so selecting multiple lines within one pane
does not collect text from the neighbouring pane. Click a sidebar row to inspect
it; dragging over rows selects their text. Both panes support wheel scrolling.
Enter sends a message. Ctrl+D (or Ctrl+C with no selection) finishes and writes
the transcript, model calls, Jev rounds and opened Markdown to
`test-output/conversation-<timestamp>.json` for review.

The CLI builds a fresh Markdown world from `--scenario 'Centennial Assembly'`.
Character identities and linked context come from scenario/docs services; typed
`properties.json` sidecars are loaded for mechanics and never placed in character
prompts. `--player document.md` selects an optional player document.
`--snapshot path` loads a v2 world JSON or a CLI review file's `world` field;
old scenario/runtime saves are not accepted. Each run starts a fresh conversation.
`--output path` chooses the review file, which includes the world snapshot.
The vault itself is never edited by the CLI.

All character context comes from Markdown. The initial context contains the
selected Cast `private.md` and scenario `character.md`. Before each reply, Jev
independently scores every permitted unopened link in the current context. Notes
whose opening probability exceeds `--threshold` (default `0.7`) are added together;
Jev runs again with the expanded context and newly discovered links. The loop
stops when nothing passes or no unopened links remain. Opened notes stay available
throughout the conversation; skipped links are reconsidered on later rounds and
player turns. Links in player speech are not retrieval candidates.

The RHS includes selectable `Jev <turn>.<round>` entries with exact input context,
questions, returned choices/probabilities, threshold and stop/error status. Each
opened file also gets an entry showing the Markdown supplied to the character.
These are actual model outputs, not an invented explanation of Jev's reasoning.

The loader applies the vault's existing visibility rules before offering or
opening a link. Notes are pinned for the session; restart to pick up lore edits.
Missing/ambiguous links, provider failures, or the per-turn limits (16 rounds and
120,000 context characters) stop that reply with a debug error instead of silently
claiming sufficient context. Snapshot relationships, goals, objectives and notes
are never injected. Knowledge and scenario stubs remain as authored. Portraits,
dice checks and GM adjudication are outside this prototype. Review exports remain JSON.

When Jev requests a check, the CLI pauses and asks for the raw d20 result (1–20).
Enter the natural roll, not the total: the displayed player modifier is applied
by the check resolver. Without a player build the debugger uses +0. The GM then
receives the resolved outcome, and its request/reply appears under **GM roll
ruling** in the sidebar and in the review export. Ctrl+D cancels a pending roll.
