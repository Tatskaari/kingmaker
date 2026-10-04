# Development guide

For the game introduction and browser demo, see the [README](../README.md).
This guide covers local setup, model diagnostics, checks and deployment.

## Run locally

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
The key is remembered in local browser storage and is excluded from saves. Games
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

Action-execution Jev receives permitted character documents through disclosure,
followed by the current objective, room-scoped physical observations and a
chronological log of completed action IDs. The log starts with `None yet.` and
is scoped to the current activity.

Physical observations include room connections, local interactions with action
IDs and walking distances, known contents, inventory, blocked exits and illegal
action labels. The engine checks paths and current physical legality when an
action executes. Hidden character documents are not appended to observations.

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

Player conversation checks use the shared resolution pipeline; see
[conversation hooks and services](conversation-services.md) and the
[conversation debugger](conversation-debugger.md) for the current flow.

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

## Architecture

See [runtime architecture](architecture.md), [conversation hooks and services](conversation-services.md),
[map services](map-services.md) and [document-backed world state](lore-world-state.md).

## Dependency injection for implementations, tests and evals

Dependency injection (DI) is how we plug in new implementations: replace strategies
to change decision-making policy, replace services to change how operations are
performed, and change the host for scheduling or application integration.
`ConversationRuntime` accepts `services` and `strategies` options;
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
pattern for future eval harnesses; the obsolete Scenario-based runners have
been retired.

## Code and validation

- `lore/Scenarios/Centennial Assembly/`: document-authored characters and scenario context.
- `content/palace-map.json`: physical rooms, actors, doors and fixtures.
- `apps/web/src/world-host.ts`: authoritative document-backed world state and physical mechanics.
- `apps/web/src/world-runtime.ts`: service injection and game policy composition.
- `packages/conversation/src/runtime.ts`: shared hook and service contracts.
- `apps/web/src/world-action.ts`: document-native planner observations.
- `apps/web/src/court-map.ts`: map rendering, walking and interaction menus.
- `packages/conversation/src/disclosed-context.ts`: permitted document context.
- `packages/contracts/proto/kingmaker/v2/world.proto`: document-backed world contract.
- [Architecture](architecture.md), [navigation](navigation.md),
  [autotiling](autotiling.md), [cleanup audit](cleanup-audit.md).

```sh
proto run moon -- run workspace:check workspace:build
```

The legacy Scenario-based eval harnesses and fixtures have been retired.
Document-native strategy experiments use [the shared eval framework](evals.md); deterministic runtime
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

## Other tools and authoring

- [Headless play and socket console](headless.md)
- [Conversation debugger](conversation-debugger.md)
- [Lore vault](../lore/index.md) and [lore access tests](lore-access-audit.md)

The game loads character and scenario documents from the lore vault. Authoring
entrypoints and visibility rules are documented in the vault and access guide.
