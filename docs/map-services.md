# Map interactions and presentation

The runtime injects a `map` service alongside documents, AI and presentation.

- `map.layout()` supplies detached tile and room geometry.
- `map.observe(characterId)` supplies observer-visible physical state and available actions.
- `map.interact(command, expected)` validates and commits movement, door/furniture interactions, or one NPC action step. It returns events, conversation handoffs and fresh generation tokens. Narrative documents are not included in observations.

Planning (`hooks.action`) chooses an action using observations from the map service. Execution (`hooks.actionExecution`) has its own classify/resolve pair: classification is currently an empty stub; the default resolver calls the map service. A talk result hands off to the existing conversation/resolution flow. Outcome review continues to update documents through its existing hooks.

`presentation.renderMap` is invoked after the worker persists a successful action. The browser publishes an updated view; headless defaults to no rendering. Browser layout data is supplied by the map service. Presentation failures do not roll back persisted world changes.

`PalaceMechanics` is an internal implementation of the current map rules, not a service exposed to hooks. The existing palace renderer remains the built-in presentation implementation.

## Document reviews and persistence

Map interactions and document edits are independent operations. The shared world
is a save container, not a transaction boundary. Reviews use the live docs service;
there is no review world fork, whole-world generation check, or snapshot merge.
Planning and dialogue likewise do not compare whole-world versions. Existing
physical action validation and conversation-turn/lifecycle checks remain.

The GM calls `commit_review` with notes and an active goal. The adapter writes through
the docs service using the reviewed document's SHA. A conflict writes nothing,
refreshes that document snapshot, and returns its text and SHA as a tool result.
The GM reconciles against that result and calls the tool again. Retries are bounded
at eight model calls. Separate participant documents commit independently.

The worker serializes individual mutations and their IndexedDB saves. Models run
outside that queue. Saving failure still restores the state immediately before
that mutation; saving is not the mechanism for merging model work. The docs
service merges each document write into the current state, preserving map changes
made while hashing the document.
