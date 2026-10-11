---
title: "Design: make inventory writes per-item, idempotent compare-and-swap"
labels: [design, tech-debt, simulation]
---

## Observation

Inventory has two write models that don't resemble each other or any sibling service:

- `addToInventory`, `removeFromInventory` and `transferBetweenInventories` are unchecked, return `void`, and only wrap the moves of the same name (`packages/core/src/inventory-service.ts:37-42`). Outside tests, their only callers are pass-through wrappers.
- `commit(changes)` replaces whole inventories behind a SHA of the entire inventory (`packages/core/src/inventory-service.ts:49-60`). The GM uses it through `update_inventories` (`packages/conversation/src/gm-tools.ts:24,64-79`). The model has to write back every item and equipment slot as JSON and is told to "preserve unrelated items".

## Why it doesn't pass the sniff test

- The SHA covers the whole inventory, so any unrelated change (the player picking up a coin) conflicts with a GM gift.
- The move underneath (`replaceInventories`) can't tell an intended removal from a dropped line in the model's JSON.
- `read`/`commit` only accept runtime characters (`inventory-service.ts:29-33`). The moves also accept rooms and fixtures (`packages/core/src/simulation-inventory.ts:8-15`), so the GM can't CAS-edit a chest.
- On a two-owner conflict, the tool returns only one owner's current state (`gm-tools.ts:76`). After success it re-reads instead of returning what was written, unlike `docs.replace` and quest writes.
- Inventory moves don't bump `map.revision`; door, fixture and movement moves do.

## Threads to pull

- Should every inventory write be `set_item_count(owner_id, item_id, expected_count, new_count)`, with transfer as two counts committed in one move? That is idempotent on retry and only conflicts when the same item changed.
- What is the identity of an item: a stackable `item_id` with a count, or unique instances (equipment, attunement, concealment)? Per-item CAS needs one answer.
- Should the CAS check live in the move itself (it returns `INVALID_MOVE` when `expected_count` doesn't match), so clients running moves optimistically get the same check, rather than a service-level SHA?
- Do inventory changes count toward the map revision?

## Possible direction

Replace `add/remove/transfer/commit` with `setItemCount` (plus `transfer` built from it) as boardgame.io moves keyed by any inventory owner. Each returns the new per-owner snapshot. Give the GM `set_item_count` in place of `update_inventories`.
