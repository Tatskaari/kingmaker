---
name: kingmaker-move-authoring
description: Author Kingmaker simulation moves and authoritative service updates, including synchronous draft callbacks and data-only player commands. Use when implementing world-state mutations or quest/dialogue effect handlers.
---

# Authoring authoritative moves

## Agreed design and current implementation

Use one entity-level move, such as `updateFixture`, for trusted host updates rather than introducing a move for every editable field. The agreed map-service API is `updateFixture(fixtureId, update)`, where `update` is a synchronous callback operating on the current fixture draft. Apply the same pattern to other authoritative simulation updates where appropriate.

This is the agreed implementation direction, not an existing API: at the time of writing `MapService` provides `layout`, `observe` and `interact`. Fixture action data and the callback helper still need implementation. Inspect the current code before assuming either exists:

- `packages/conversation/src/map.ts`: map-service interface and player command shapes.
- `packages/core/src/simulation-authority.ts`: registered boardgame.io moves and host dispatch.
- `packages/core/src/simulation-move.ts`: synchronous move contract.
- `packages/core/src/simulation-fixtures.ts`: current fixture interaction validation.

## Two kinds of caller

**Trusted authoritative code:** registered quest/dialogue hooks and host services may supply callbacks written by the application. The service dispatches a generic registered move; that move finds the entity in current draft `G`, invokes the callback and validates the result before publication. This is an internal capability, not a player command or model-generated executable code.

**Player/client commands:** retain simple, serializable data arguments, such as an action ID, target or destination. Resolve and validate the requested action on the authoritative side. Do not accept callbacks from the player, expose the generic mutation helper as a player command, or send functions through a worker/network boundary.

Read-only world access does not require a move. Treat those reads as immutable; never retain them as writable references. Mutation happens through the registered move.

## Draft and execution contract

A boardgame.io move receives the Immer copy-on-write draft as `G`. Find the fixture inside that draft; do not create a separate world or replace it with a stale captured snapshot. The synchronous callback reads the latest entity when the move executes and edits it without another JavaScript task interleaving on the same authority. Draft changes are finalized as one simulation update, not published field by field.

This is a synchronous transaction boundary, not an asynchronous lock or conflict detector. Immer does not detect that an external value captured earlier is stale. Do asynchronous work first, then validate its decision against current state inside the move. Never clone `WorldState` or the simulation to manufacture isolation; copy-on-write handles the affected paths.

Moves and callbacks must be deterministic from current state and supplied inputs, with no external side effects. No AI, I/O, timers, nested move dispatch, or `await` belongs inside the callback. Even awaiting an already-resolved Promise yields execution. Do not let drafts escape into stored references or later tasks. Multiple service calls are separate moves, not one transaction across simulation, quest records and documents.

Awaiting the outer service call is fine: it may queue the move. The move itself must remain synchronous. Illustrative use of the planned API, using an existing fixture field:

```ts
await services.map.updateFixture(fixtureId, fixture => {
  fixture.open = true;
});
```

For Holt's permission, the same callback will update the cart action's permission when action data exists. It must not change ownership or grant unrelated inventory access.

Do not add fixture versions just to protect this synchronous read-and-edit path. Retain existing version checks on other APIs where callers submit replacements prepared across asynchronous work; this design does not authorise removing them indiscriminately.

## Helper implementation requirements

- Register the generic move with the existing simulation authority; keep the service's queue and persistence conventions.
- Resolve the entity and validate input, identity and resulting invariants within the move. Missing entities and rejected updates must publish no changes. Update existing revision/invalidation fields as required by the simulation.
- Explicitly reject Promise/thenable callback results before the move commits, even if the callback already edited the draft. Do not merely ignore the return value. TypeScript's `() => void` can accept an async function, so that annotation alone is insufficient. Ensure rejection does not leave an unhandled async rejection.
- An ignored async callback can commit its pre-await mutations and later access a revoked draft. That failure is not stale-write detection. Returning the callback's Promise is also outside the move contract.
- Keep callbacks pure so rejecting a draft cannot leave external effects behind. If a multi-entity invariant requires all-or-nothing changes, update those entities in one appropriately scoped move.

Callbacks work in the current in-process boardgame.io executor, but are not serializable move arguments. Serializing an argument array turns a function into `null`; serialized move-log replay and network transport cannot reproduce that callback. Saving resulting state is distinct from saving executable move history. If replay/transport becomes necessary, introduce a data representation or registered operation identifier rather than claiming lambdas support it.

## Validation when implementing the helper

Test current-state edits after an intervening completed move, preservation of unrelated fields and previous state, missing/invalid targets, and rejection of async callbacks without partial publication. Check that player commands remain data-only. Test saving/resuming resulting state separately from move-log replay. Follow repository checks and delivery instructions; documentation alone does not establish that these safeguards are implemented.

Boardgame.io's [move type](https://github.com/boardgameio/boardgame.io/blob/main/src/types.ts) returns `void`, state or `INVALID_MOVE`; its [Immer wrapper](https://github.com/boardgameio/boardgame.io/blob/main/src/plugins/plugin-immer.ts) calls the move synchronously within `produce`. Check the installed version when implementing; the wrapper is not an async transaction manager.
