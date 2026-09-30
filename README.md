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
key, read the four history pages, choose a delegation, name, gender and sprite,
then meet the Stranger. Review the resulting character and conversation, correct
any details, and save to enter the palace. Identity choices and review drafts
persist through saves and reloads.
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

The introduction covers the civil war, Edric’s uneasy peace, Aldren’s decline and
the coming centennial succession before introducing the three delegations.

## Models and debugging

GPT-6 Luna handles dialogue with reasoning off and the GM, reviews and NPC-to-NPC
exchanges with low reasoning. Settings live in
`apps/web/src/model-settings.ts`; every game-model request uses the OpenRouter ID
`openai/gpt-6-luna`.
Jev selects from currently reachable actions.

The action-execution Jev experiment is configured in `apps/web/src/feature-flags.ts`:

- `ROOM_SCOPED_JEV = true` sends the readable room/action text as Jev's actual
  `state`. It defaults to `false` to retain the legacy baseline.
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
empty log; existing prose history remains available to the legacy planner.

The text includes room connections, actions to enter adjacent rooms, local
interactions with action IDs and walking distances, known contents, inventory,
blocked exits, and illegal-action labels. Paths and generation guards remain in
the engine. No scenario premise or hidden character context is appended. The API
still receives the short execution instructions and selectable choice criteria.
Event-reaction Jev, dialogue, and GM context are unaffected by these settings.

Evals can override both settings per runtime:
`new BrowserGameRuntime(scenario, key, snapshot, undefined, undefined, Math.random, true, { level: 1, includeRecentResults: true })`.
Pass `false` as the seventh argument for the legacy baseline. Configuration follows
runtime forks and is not saved as game state. The debug inspector displays the
same text `state` supplied to the action planner.

Render all three tiers through the production action-planning path without an
API key or model call:
`proto run node -- node_modules/tsx/dist/cli.mjs scripts/render-jev-contexts.ts /tmp/kingmaker-jev-contexts king`.
This writes court-arrival and authored-initial examples. Each `*-state.txt` is the
exact text sent in `state`; `*-request.txt` also includes every execution
instruction and selectable choice. Recent action results are disabled in these
samples, and the output README records the activation/placement assumptions.

The debug inspector shows world state, character context and recent transcripts:
requests, responses, summaries, duration and errors for the latest 50 calls.
These logs survive rollback but are not saved across reloads. NPC conversations
record the initiating request and the GM resolution separately.

NPC execution is serial and bounded. Stop Jev cancels pending planning or walking;
active goals and pending reviews can be resumed after loading a save.

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

## Code and validation

- `content/scenarios/last-night.json`: characters, notes and physical world data.
- `apps/web/src/runtime.ts`: authoritative interactions and model workflows.
- `apps/web/src/court-agent.ts`: grounded actions and planner observations.
- `apps/web/src/court-map.ts`: map rendering, walking and interaction menus.
- `packages/core/src/context.ts`: character knowledge and dialogue context.
- `packages/contracts/proto/kingmaker/v1/game.proto`: persisted data contracts.
- [Architecture](docs/architecture.md), [navigation](docs/navigation.md),
  [autotiling](docs/autotiling.md), [cleanup audit](docs/cleanup-audit.md).

```sh
proto run moon -- run workspace:check workspace:build
```

Unit eval scenarios live in `evals/`. Each scenario names a generation model,
a transcript fixture, optional toolset, repeated-run settings and a weighted rubric. The runner
sends the transcript to the named model, captures its response, then asks Jev to
score every criterion in one judgment. By default, the runner executes the
king-accusation eval:

Transcript fixtures are declarative. A `character_conversation_sys_prompt` step
loads an editable character fixture and expands it with the production
`FullContextBuilder`; ordinary dialogue steps then append messages:

```json
{
  "transcript": [
    { "type": "character_conversation_sys_prompt", "character": "../characters/king.json" },
    { "type": "user_message", "value": "I know about the boy." }
  ]
}
```

The character fixture selects the source scenario and character. Its
`within_earshot` array is currently the only synthetic world-state override, so
evals can control conversation privacy without artificial actor coordinates.
This fixture is the extension point for other character-local world state when
an eval eventually needs it.

The same character fixture can optionally contain `patch`, an RFC 6902 JSON
Patch applied to a context document containing the scenario's selected
`character` and `notes`. This lets one patch change character fields and add or
remove private facts. When the patch contains an operation, the runner evaluates
the untouched scenario context as the baseline and then the patched context,
reporting score deltas. Without it, the eval runs once.

```sh
OPENROUTER_API_KEY=... npm run eval:unit
```

The equivalent Moon task is `proto run moon -- run workspace:unitEval`. Pass one
or more scenario paths after `--` to run only those fixtures, for example:

```sh
proto run moon -- run workspace:unitEval -- evals/king-accusation-response.json
```

The production site is built into `dist/web`. Merges to main deploy through
`.github/workflows/pages.yml`. Relative asset URLs support GitHub Pages paths.
