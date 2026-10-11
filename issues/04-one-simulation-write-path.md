---
title: "Design: one write path for the simulation authority"
labels: [design, tech-debt, simulation]
---

## Observation

Simulation moves reach the boardgame.io client through several routes with different serialisation:

- `WorldStore.write` (`packages/lore/src/world-store.ts:21-25`) queues docs, quests, character and inventory writes.
- Movement and NPC steps use `WorldHost.writeSimulation` (`apps/web/src/world-host.ts:48,61,214,225`). `WorldGameRuntime` overrides that with its persistence `commit` (`apps/web/src/world-runtime.ts:77`), not `store.write`.
- Player `setDoor` and fixture use (`world-host.ts:189-201`), `mechanics.executeMove` and `mechanics.commit` run unqueued.
- Both CAS services carry hand-written "recheck after await" logic because moves can land while they hash: `inventory-service.ts:57-58` and `docs-service.ts:30-36`.
- `PalaceMechanics` still has a fallback to `executeLocalMove`, Immer outside boardgame.io (`apps/web/src/palace-mechanics.ts:96-101`, `packages/core/src/local-move-executor.ts`). It is reachable only in tests, and the authority isn't required by the type.
- `game.services` in headless returns the raw `worldServices` (`world-host.ts:68`), so headless writes skip persistence.

## Why it doesn't pass the sniff test

ARCHITECTURE.md says `WorldStore` serialises writes, but for the simulation it doesn't. With one boardgame.io client as the authority, there should be exactly one way in. Each service shouldn't need its own defence against moves running while it awaits.

## Threads to pull

- Should the injected authority (the boardgame.io client) be the only queue, with docs and quest writes queued separately as AI state? Or should both share `store.write`?
- Where does persistence ("dirty, save later") attach: to the authority's state changes, or to each service wrapper as now (`world-runtime.ts:123-147`)?
- Can `authority` become required in `PalaceMechanics`, with `executeLocalMove` moved to test helpers?
- Should headless `game.services` return the same persistence-wrapped services as the browser runtime?
