# Conversation debugger

Conversation turns share a swappable `respond()` strategy, dispatched by
`packages/conversation/src/phases.ts`. Hooks and conversation services are supplied
to `ConversationRuntime`; the [runtime architecture](architecture.md) extends
these boundaries to review, action planning, execution and resolution.
The CLI, browser and headless player conversations use progressive lore disclosure,
the existing skill-check policy and live conversation review. The CLI defaults to
`--strategy game`; `--strategy live-review` selects the same policy. Resolution can request
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
once. Game requests omit output-token caps, leaving the allowance to the provider.
Truncated responses, cancellation and non-retryable provider errors stop immediately. Dice stay resolved and the
popup remains open during a retry; exhausted failures cancel the paired operation.

Run `proto install` to install the pinned Node 26 runtime and `npm ci` to install
the locked dependencies (repeat after pulling dependency changes), then
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
stops when nothing passes or no unopened links remain. Before each player turn,
the CLI waits for pending reviews and rebuilds disclosure from the current world,
so reviewed document changes are available to the next reply. Links in player speech are not retrieval candidates.

The RHS includes selectable `Jev <turn>.<round>` entries with exact input context,
questions, returned choices/probabilities, threshold and stop/error status. Each
opened file also gets an entry showing the Markdown supplied to the character.
These are actual model outputs, not an invented explanation of Jev's reasoning.

The loader applies the vault's existing visibility rules before offering or
opening a link. The source vault is loaded at startup; restart to pick up external lore edits.
Missing/ambiguous links, provider failures, or the per-turn limits (16 rounds and
120,000 context characters) stop that reply with a debug error instead of silently
claiming sufficient context. Snapshot relationships, goals, objectives and notes
are never injected. Knowledge and scenario stubs remain as authored. Portraits are outside this prototype. Review exports remain JSON.

When Jev requests a check, the CLI pauses and asks for the raw d20 result (1–20).
Enter the natural roll, not the total: the displayed player modifier is applied
by the check resolver. Without a player build the debugger uses +0. The GM then
receives the resolved outcome, and its request/reply appears under **GM roll
ruling** in the sidebar and in the review export. Ctrl+D cancels a pending roll.

See [local setup and validation](development.md) for prerequisites and checks.

The RHS shows GM review calls by default. Flagged replies queue background
review to persist supported consequences in the in-memory world. Review triggering
is model-dependent; an unflagged reply does not produce a review call. The CLI
drains outstanding reviews before exporting the final world.
Each call appears while pending and updates to completed or failed in place.
Select it to inspect the full request, response/tool calls or error and duration;
later tool-loop requests include earlier tool results. Background review entries
continue updating after the character reply appears. Dice calls remain labelled
GM roll ruling. All these entries are included in the exported `gmTurns` list.
