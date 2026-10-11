---
title: "Cleanup: stale design docs and code paths no host runs"
labels: [tech-debt, docs]
---

## Observation

- `docs/state-generations.md` describes a model that no longer exists:
  - `RuntimeSnapshot.generations` (:4)
  - the `update_character`/`update_inventory`/`read_state` tools (:28,45,51)
  - `apps/web/src/resource-review.ts` and `apps/web/src/objectives.ts` (:82), neither of which exists
  - Nothing links to the doc.
- `docs/architecture.md` still describes v1-era snapshot merges. That contradicts `docs/map-services.md` ("no review world fork… or snapshot merge").
- `docs/map-services.md:46-47` calls `executeLocalMove` "the temporary local Immer adapter used by the authority". The authority is now a boardgame.io `Client` (`packages/core/src/simulation-authority.ts`), and `local-move-executor.ts:6-9` has a stale header.
- `docs/lore-world-state.md:60-61` still says `createScenarioServices` creates "a pair" of services.
- `ARCHITECTURE.md` describes inventory as "SHA-checked reads and transfers", but transfers are the unchecked path (see #01).
- `packages/conversation/src/lore.ts` is a second lore implementation that reads the vault from disk via `scripts/lib/lore-access.ts`. It has a different starting document set from `documentLore`, and only tests use it (`tests/conversation-disclosure.test.ts:8`, `tests/conversation-cli.test.ts:9`). Those tests exercise code that no host runs.

## Why it doesn't pass the sniff test

Agents and new contributors read `docs/` first. Docs describing removed models, and tests covering unused implementations, steer work toward the wrong design.

## Threads to pull

- Delete `state-generations.md`, or rewrite it against the current docs-service model?
- Retire or rewrite `docs/architecture.md` now that `ARCHITECTURE.md` exists?
- Delete `lore.ts` and re-point those tests at `documentLore` over a world fixture?
