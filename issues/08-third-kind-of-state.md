---
title: "Design: name (or eliminate) the third kind of state in WorldSnapshot"
labels: [design, tech-debt, state-boundary]
---

## Observation

`WorldSnapshot` and `WorldHost.activity` (`apps/web/src/world-host.ts:31-39`) hold persisted state that is neither simulation nor docs:

- `jail`, `arrestChallenges`
- `conversations`, `conversationEndRequested`, `pendingConversationEvents`
- `npcActivities` (status, `reviewPending`, history, `actionIds`), `pendingWaitReviews`
- `characterHistory`
- `stranger`, `playerMessages`

It is saved with `structuredClone` (`world-host.ts:80-91`) and has no compare-and-swap. Staleness is detected by `JSON.stringify(previous) !== …` (`apps/web/src/world-runtime.ts:366,415,432`).

Some of it has physical consequences:
- **Jail** blocks movement, doors and fixtures, but only through host `assertPlayerFree()` (`world-host.ts:174-201`). The moves don't know about it, so a client running moves optimistically would bypass jail.
- **NPC action gating** reads host state: `palace-mechanics.ts:120,141-142` checks `reviewPending`, `history.length >= 24` and `conversations[id]`.

## Why it doesn't pass the sniff test

The architecture describes two kinds of state with clear owners. This is a third, undocumented kind, with its own persistence and its own (string-compare) concurrency. It also holds rules that clients can't see.

## Threads to pull

- Which of these are physical (moves must check them), and so belong in the simulation? Jail, and "in a conversation" if it blocks movement.
- Which are AI or server state? Conversations, pending events and reviews, NPC activity bookkeeping, character history. Should they be documents, or a revisioned server-side service?
- Which are host UI state (`stranger`, `playerMessages`)? Should the architecture name that category explicitly?
