---
title: "Design: is there a sanctioned multi-service transaction? (player publish, reset)"
labels: [design, tech-debt, state-boundary]
---

## Observation

Two paths go around the services instead of through them:

- **Player publish** (`apps/web/src/world-runtime.ts:184-205`) builds `createScenarioServices(this.world())`. The `WorldStore` constructor clones the whole world (`packages/lore/src/world-store.ts:16`) and starts a second boardgame.io client. The path then runs create, impression writes, `setPlayer` and a phase flip via `mechanics.commit` there, and swaps `this.worldServices` wholesale (:202).
- **Debug reset** (`apps/web/src/world-host.ts:261-284`) builds and validates a draft, then throws it away and assigns `current.docs = docs` (:278) straight onto live store state. That skips `publishDocuments`, so the store's cached `DocumentGraph` goes stale. It then pushes runtime characters through unqueued `mechanics.commit` (:279). `resetWorld` (:253-260) does the same for the map.

## Why it doesn't pass the sniff test

- It breaks "one live world, never cloned" and "no whole-world transaction" (ARCHITECTURE.md invariants).
- A new authority means a new boardgame.io `_stateID` history, which would break any client sync.
- No other caller writes `store.state` from outside.

The motivation is real: a failed creation shouldn't leave a half-created player or a partially informed court.

## Threads to pull

- Is atomic "create docs + spawn actor + enter court" a genuine requirement? If so, should it be one explicit, documented transaction primitive (stage only the new documents and actor, publish together) rather than a cloned world?
- Or can creation be idempotent steps (create docs → `spawnActor` move → impression writes → `enterCourt` move), each retryable, with the phase flip last as the commit point?
- Should reset rebuild services from `initial`, as `reset()` already does (`world-host.ts:247-252`), rather than patching live state?
