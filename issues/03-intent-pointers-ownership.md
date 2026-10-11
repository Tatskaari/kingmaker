---
title: "Design: who owns activity/wait pointers and intentRevision — docs or simulation?"
labels: [design, tech-debt, state-boundary]
---

## Observation

- `RuntimeCharacter.activity`, `wait` and `intent_revision` live in the simulation (`packages/contracts/proto/kingmaker/v2/world.proto:33-42`).
- But the docs service writes them. `docs.commit(writes, intents)` copies runtime characters into a draft, checks `intentRevision`, sets the pointers and increments the revision (`packages/lore/src/docs-service.ts:63-79`). `publishDocuments` then sends the changed simulation through `publishSimulationChanges` (`packages/lore/src/world-store.ts:31-45`).
- An intent mismatch throws `DocumentConflictError(entry, …)`. Here `entry` comes from `.find(path => path.endsWith("/Characters/<id>/character.md"))!`, which can be `undefined` for the player (`Players/player.md`). `GameMasterTools.conflict` would then call `docs.read(undefined)` (`packages/conversation/src/gm-tools.ts:133-138`).
- `character.create` takes the same route: it pushes map actors, sheets and inventories, and bumps `map.revision` by hand, all as a "document" write (`packages/lore/src/character-service.ts:13-47`).

## Why it doesn't pass the sniff test

The architecture says the two halves meet only through document paths, and that document edits don't touch mechanics. Instead, the docs path is the main route for some physical changes. Also, the version counter for an AI write lives in synced simulation state. So every Jev wait decision and GM activity call is a simulation change sent to clients, and it leaks activity and wait document names (for example `follow-<uuid>.md`) and NPC plan timing.

## Threads to pull

- Are activity and wait AI state (what the NPC intends) or simulation state (what the body is doing)? If AI state, the pointers and revision belong in the docs service or a server-side intent service keyed by runtime character ID. Only the identity link `document` would stay in the simulation.
- If they stay in the simulation, should they be set by a `setIntent(actorId, expectedRevision, activity, wait)` move? Its own conflict type would then be coordinated with document writes by the caller, not hidden inside `docs.commit`.
- Should a document publish ever be allowed to change `draft.simulation`?
