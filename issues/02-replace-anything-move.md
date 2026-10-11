---
title: "Design: replace publishSimulationChanges / mechanics.commit with semantic moves"
labels: [design, tech-debt, simulation]
---

## Observation

`publishSimulationChanges` (`packages/core/src/simulation-publication.ts:7-12`) assigns `G.map = changes.map` and `Object.assign`s whole runtime characters. Its only check is that each `actor.id` matches its key. It is reached through:

- `mechanics.commit(map, characters)`, which has no version check and doesn't use `store.write` (`packages/lore/src/mechanics-service.ts:8-12`)
- `WorldStore.publishDocuments`, whenever a document draft's simulation reference changed (`packages/lore/src/world-store.ts:34-42`)
- debug resets (`apps/web/src/world-host.ts:258,279`)
- player publish, to flip phase and day (`apps/web/src/world-runtime.ts:199-200`)
- the headless docs' "bump the day" example (`docs/headless.md:71`)

## Why it doesn't pass the sniff test

The architecture says every physical change is a move, so clients can run it optimistically. This move carries no meaning, only a new state. It can teleport actors, flip doors, change phase, or overwrite sheets and inventories with no rule validation. A client can't reproduce or check it. In practice it is direct assignment to the world, wrapped in a move.

"commit" also means three different things across services: a batched SHA-checked write in `docs.commit`, a SHA-checked whole-inventory swap in `inventory.commit`, and a blind replace in `mechanics.commit`.

## Threads to pull

- What is the full list of semantic moves the callers actually need? Candidates: `enterCourt`/`setPhase`, `advanceDay`, `spawnActor`, `setIntentPointers`, `resetSimulation`.
- Is there any legitimate "replace the simulation" operation outside fresh-game setup and load? If so, should it be host-only and never exposed to strategies or the GM?
- Should `publishDocuments` reject a draft whose simulation differs from the live one? See #03.

## Possible direction

Delete `mechanics.commit` and `publishSimulationChanges` once each caller has a named move. Keep a single `resetSimulation(initial)` for reset and debug.
