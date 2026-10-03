# Map interactions and presentation

The runtime injects a `map` service alongside documents, AI and presentation.

- `map.layout()` supplies detached tile and room geometry.
- `map.observe(characterId)` supplies observer-visible physical state and available actions.
- `map.interact(command, expected)` validates and commits movement, door/furniture interactions, or one NPC action step. It returns events, conversation handoffs and fresh generation tokens. Narrative documents are not included in observations.

Planning (`hooks.action`) chooses an action using observations from the map service. Execution (`hooks.actionExecution`) has its own classify/resolve pair: classification is currently an empty stub; the default resolver calls the map service. A talk result hands off to the existing conversation/resolution flow. Outcome review continues to update documents through its existing hooks.

`presentation.renderMap` is invoked after the worker persists a successful action. The browser publishes an updated view; headless defaults to no rendering. Browser layout data is supplied by the map service. Presentation failures do not roll back persisted world changes.

`PalaceMechanics` is an internal implementation of the current map rules, not a service exposed to hooks. The existing palace renderer remains the built-in presentation implementation.
