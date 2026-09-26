# Palace integration cleanup audit

## Removed

- Standalone `palace.html`, its CSS and entry point. The production build has one page.
- Prototype-only planner loop, dialogue adapter, door graph, furniture state and
  interaction executor. Main-game implementations and their tests remain.
- Renderer room/solid overlays and the inspection fallback used by the old demo.
- Hidden fallback furniture blockers in the main map. Saved fixtures are the only
  dynamic furniture source for rendering, collision and interactions.
- Runtime Entrance Hall creation. Authored rooms must match map regions; movement
  rejects inconsistent data rather than silently adding rooms.
- Unimplemented night-turn/provider/renderer interfaces and unused direct dialogue
  and GM commit paths. Conversation review is the sole memory-commit path.
- Unused dialogue/decision/action-result proto messages, search-spot schema and
  unimplemented phase values. Removed field/enum numbers and names are reserved.
- Duplicate narrative key/box objects and search spots. The crown now lives in the
  real royal coffer, opened with the key from Merlin's drawers. Authored character
  knowledge uses the same fixture records; the player still starts without it.
- Unused caller-supplied planner history. Planner decisions use saved activity history.
- Stale navigation/architecture documentation and a disconnected premise draft
  claiming a clock, portable box and signet key that the current game does not have.

## Kept deliberately

- `palace-map.ts`, `palace-navigation.ts`, A*, autotiling and door rendering are
  active main-game components. Their names describe the palace, not a demo.
- `palace_` fixture/item IDs are stable authored identifiers, not a parallel state.
- Debug controls, recent transcripts and reset commands support iteration on the
  main game and are still used.
- Event day and the authored solstice day remain narrative context. There is no
  time-advancement or coronation implementation; the UI no longer implies a day loop.
- The map's geometric regions and the scenario's semantic rooms have distinct
  responsibilities. Tests enforce matching room IDs and valid exits/fixture rooms.

## Remaining limitations

- NPC execution is serial and pauses map controls. It is not a background simulation.
- Character knowledge includes remembered container contents; there is no line-of-sight
  or general belief model. Open containers are currently globally visible in context.
- There is no give-item action despite characters being able to promise a transfer.
- The static palace geometry is authored in code; there is no GM map editor.
- Model choice quality and latency need live evaluation; transport tests use mocks.

## Validation and save compatibility

Keep tests for the integrated runtime, A*, map topology, knowledge filtering,
player/NPC key and crown retrieval, persistence, cancellation and model transport.
Delete tests that only exercise the removed demo implementations.

Old search-spot saves are not migrated. Start a fresh game after this schema
cleanup. New saves use one set of live fixtures and objects.
