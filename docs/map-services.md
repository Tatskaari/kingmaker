# Map interactions and presentation

The runtime injects a `map` service alongside documents, AI and presentation.

- `map.layout()` supplies detached tile and room geometry.
- `map.observe(characterId)` supplies observer-visible physical state and available actions without pathfinding. Discovery paths are empty; step counts use a Manhattan estimate to the nearest interaction candidate, ignoring obstacles. Passing a selected action ID as the second argument plans only that action. Until [flood-fill reachability](https://github.com/Tatskaari/kingmaker/issues/473) is implemented, discovery assumes authored local targets are reachable; known closed exits and door sides still use authored topology, and execution validates the actual route.
- `map.interact(command, signal?)` validates and commits movement or door/furniture interactions. Movement resolves on arrival; an NPC action then revalidates its interaction. Results carry events, conversation handoffs and movement outcomes (`arrived`, `cancelled`, `superseded`). Narrative documents are not included in observations.

Planning (`strategies.action`) chooses an action using observations from the map service. Execution (`strategies.actionExecution`) has its own classify/resolve pair: classification is currently an empty stub; the default resolver calls the map service. A talk result hands off to the existing conversation/resolution flow. Outcome review continues to update documents through its existing strategies.

`presentation.renderMap` follows an accepted action. The browser also publishes each accepted mutation immediately; headless defaults to no rendering. Browser layout data is supplied by the map service. Presentation failures do not roll back persisted world changes.

`PalaceMechanics` is an internal implementation of the current map rules, not a service exposed to strategies. The existing palace renderer remains the built-in presentation implementation.

## Document reviews and persistence

Map interactions and document edits are independent operations. The shared world
is a save container, not a transaction boundary. Reviews use the live docs service;
there is no review world fork, whole-world generation check, or snapshot merge.
Planning and dialogue likewise do not compare whole-world versions. Existing
physical action validation and conversation-turn/lifecycle checks remain.

The GM writes memories using document tools and finishes with a plain-text summary.
The host then commits staged activity/wait changes through the docs service. A
conflict publishes none of the staged changes, refreshes the affected document,
and returns control to the GM to reconcile. The tool loop is bounded at sixteen
model calls. Earlier successful document edits remain saved.

The worker serializes individual mutations and publishes accepted state immediately.
Models, time spent travelling, and IndexedDB writes run outside that queue. Dirty
state is saved every five seconds, with no writes during clean periods. Changes
accepted while a save is running remain dirty for the next save. Saving failure does not rewind
accepted writes; the next successful autosave saves the current state. The docs
service merges each document write into the current state, preserving map changes
made while hashing the document.

## Timed movement

`SimulationState.map` owns the layout, physical actors, doors and fixtures. Actor
positions are grid coordinates: integers are tile centres. An active movement
stores its ID, route, authority start timestamp and duration. The route is
calculated once; an NPC can submit its already selected route for validation.

`startMove`, `completeMove` and `cancelMove` accept `{ G }` and explicit arguments,
so the same functions can be registered as boardgame.io moves. They never read a
clock or schedule a callback. `executeLocalMove` is the temporary local Immer
adapter used by the authority; multiplayer hosting is not introduced here.

The movement service supplies time and schedules completion. Start and completion
are separate simulation updates; periodic autosave stores the latest state. Actor jobs run concurrently. A new movement supersedes
the previous request; cancellation commits the interpolated position. Only an
`arrived` result may continue an interaction. Loading rebuilds timers from saved
movement records, but does not restore unsaved interaction callbacks.

Presentation uses `actorPosition` / `getActorPosition`, which interpolate the
stored route in grid coordinates without pathfinding. `actorTile` rounds to the
occupied tile. The renderer converts grid coordinates to pixels. Rules can use
`mapAtTime` for an ephemeral observation; never commit that projection as state.
Closing a door across the remaining route is still tracked in issue #460.

The browser requests an immediate flush when the page becomes hidden or receives
`pagehide`. These are best-effort lifecycle saves: refresh/back can terminate the
worker before IndexedDB finishes. The in-app Saved games action and game switches
explicitly await a flush. Periodic saving remains the fallback for abrupt exits.
