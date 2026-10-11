---
title: "Design: scenario prose and one-off rules inside core simulation moves"
labels: [design, tech-debt, state-boundary]
---

## Observation

- `applyFixtureAction`, called from the `interactWithFixture` move, renames `furn_cart_right` to `furn_gift_tree` ("Potted gift tree beside the smashed cart") and removes `furn_cart_left` by ID (`packages/core/src/fixtures.ts:58-64`). It throws `Error` instead of returning `INVALID_MOVE` (:52,87).
- The simulation carries prose: fixture `name`/`revealedName`, item `details`, room `description`, and a free-form `MapState.facts` Struct (v1 `world.proto`).
- The reverse also happens: physical data authored in documents.
  - Character frontmatter holds `placements` x/y positions (`apps/web/src/background-characters.ts:16-27`).
  - `conversation_actions: arrest` silently grants room access (`apps/web/src/guard-duty.ts:7-11`).
  - Both are applied at setup (`apps/web/src/playable-world.ts:27,41`).

## Why it doesn't pass the sniff test

The architecture says "documents contain no positions, the simulation contains no prose". A generic core move that knows about one scenario's cart is a scenario rule hidden in the engine. Moves that throw also behave differently from moves that return `INVALID_MOVE`.

## Threads to pull

- Should fixture outcomes be authored data (for example a `brokenVariant` on the fixture), so the move stays generic?
- Do display names and descriptions belong in documents keyed by fixture or room ID, or is short physical labelling acceptable in the simulation? Where is the line?
- Should placements and guard access move into authored map content (`content/`), or into a setup step that is explicitly authoring-only?
- Should all moves return `INVALID_MOVE` and never throw?
