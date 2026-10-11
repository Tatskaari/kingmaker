---
title: "Design: replace live whole-world reads with narrow typed reads"
labels: [design, tech-debt, services]
---

## Observation

Every per-resource read is detached: `docs.read` and `quests.read` clone, `inventory.read` clones, `map.layout()` clones. Yet the main read path for strategies and tools is the live world:

- `scenario.read()` (`packages/lore/src/scenario-service.ts:7`), `currentWorld()` (`packages/lore/src/services.ts:23`) and `WorldHost.world()` (`apps/web/src/world-host.ts:66-68`)
- used by GM tools (`packages/conversation/src/gm-tools.ts:43-55,80,86,92`), lore (`packages/conversation/src/document-lore.ts:10-32`) and activity tools (`packages/conversation/src/activity-tools.ts:30,63`)
- `currentWorld` is an extra member of `createScenarioServices` that isn't in any service interface.
- `docs/headless.md:74-76` calls `inspect()` "frozen". It returns the live `runtime.world()` (`packages/headless/src/world.ts:24`); only the simulation half is frozen, by boardgame.io.
- `MapObservation.map` is commented as "Detached" (`packages/conversation/src/map.ts:7`), but `worldForCharacter` deliberately shares unchanged records with the live map (`packages/core/src/physical-view.ts:8-14`).

## Why it doesn't pass the sniff test

The rule is "read live, stage only what changes". But handing out the whole live `WorldState` means any hook can see, and in the docs half mutate, everything. That includes other characters' documents, which the lore service exists to scope. The deletion test fails: delete `scenario.read()` and the complexity would move behind small typed reads, not spread across callers.

## Threads to pull

- Which narrow reads do callers actually need? Candidates: `listDocuments(prefix)`, `runtimeCharacter(id)`, `intent(id)`, `characters()`.
- Should whole-world access be limited to hosts and save/export, and kept out of `RuntimeServices`?
- Should live reads be read-only at the type level (`DeepReadonly`), even if they aren't frozen at runtime?
