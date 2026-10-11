---
title: "Design: one versioning and conflict contract across services"
labels: [design, tech-debt, services]
---

## Observation

Services that do the same job (compare-and-swap writes) each do it their own way:

| Service | Version token | Conflict error | Read shape |
| --- | --- | --- | --- |
| docs | content SHA (async) | `DocumentConflictError {path, expectedSha, actualSha}` (`packages/lore/src/service-types.ts:52-57`) | detached, async |
| quests | revision counter | `QuestConflictError {questId}` (`packages/lore/src/quest-service.ts:19-24`) | detached, sync |
| inventory | whole-inventory SHA (async) | `InventoryConflictError {actorId}`, no `name` (`packages/core/src/inventory-service.ts:9-11`) | detached, async |
| intents | `intentRevision` counter | reported as `DocumentConflictError` (`packages/lore/src/docs-service.ts:68-70`) | live |
| map / NPC steps | `map.revision` (not exposed on `MapObservation`) | plain `Error("World changed; replan…")` (`apps/web/src/palace-mechanics.ts:142`) | projection, sync |
| conversation trees | quest revision | plain `Error("Conversation tree changed…")` (`packages/conversation/src/conversation-tree.ts:70`) | — |

Smaller inconsistencies:
- `docs.create` on an existing path throws a plain `Error` (`docs-service.ts:84-87`), but `docs.commit` with `expectedSha: null` throws `DocumentConflictError` (:48-49).
- Docs hash `canonical(toJson(...))` in one place and raw `canonical(message)` in another (`docs-service.ts:33,55,107`).
- Reads are async only because SHA-256 uses `crypto.subtle` (`packages/core/src/state-version.ts:6-9`).
- `map.interact` returns `MapResult | Promise<MapResult>` (`packages/conversation/src/map.ts:31`).

Probable bug in the same area: `stepNpcAction` passes `this.#world.revision`, read just before the call, into `executeNpcAction` (`apps/web/src/palace-mechanics.ts:133,142`), so the revision check can't fail.

## Why it doesn't pass the sniff test

A GM tool, a strategy or a client has to learn a different conflict shape and recovery for every resource. Tools then convert them into different result shapes (see #12).

## Threads to pull

- One `StaleWriteError { resource, expected, actual }` that every service throws, which tools turn into one `{ok:false, error:"conflict", current}` result?
- Counter or content hash? Quests need a counter (a repeated transition must conflict even when the content is identical). Is a sync revision counter good enough everywhere, so that reads can be uniformly sync and writes uniformly async?
- A shared `versioned(schema)` helper in `state-version.ts` instead of per-service hashing?
- Should `MapObservation` expose a revision that `step` carries, like quests do? Or should NPC steps rely only on re-validating the action ID, with the dead revision check removed?
