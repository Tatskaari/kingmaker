---
title: "Design: what does a client actually receive? Simulation sync vs views vs debug"
labels: [design, tech-debt, state-boundary]
---

## Observation

The intended model is that clients receive the simulation (and run moves optimistically) plus player-scoped views of AI state. Today:

- On every mutation the worker posts a host-built `worldView` (`apps/web/src/world-view.ts:15-57`, posted from `apps/web/src/game-worker.ts:115-117`). It includes every NPC's `currentGoal` from their activity documents, full `npcActivities` with action history, and the player's document. `app.js:366-379` renders activity names, status and success criteria.
- The UI never receives the simulation `G`, and has no way to run a move.
- Debug and diagnostics send the whole store:
  - `debugCharacter` returns `documents: this.world().docs`, all of them (`apps/web/src/world-host.ts:121`).
  - `debugDocuments` (`apps/web/src/world-runtime.ts:250-255`) feeds `document-explorer.js`.
  - `debug()`/`debugGameMaster()` send `toJson(WorldStateSchema, world)` (`world-host.ts:120,124`).
  - The issue report posts the live `WorldState` (`game-worker.ts:544`). The debug button isn't behind a feature flag (`app.js:444,449`).

## Why it doesn't pass the sniff test

AI state isn't "server-only, views only", and the simulation isn't what gets synced. In a single-process browser game this is harmless. But it means nothing currently exercises the client/server split the architecture relies on, and it will be the first thing to break when hosting moves server-side.

## Threads to pull

- Should the worker → UI channel mirror the future network channel: (a) the simulation, or a per-player physical view from `worldForCharacter`, and (b) explicit player-scoped AI views?
- Should NPC goals and activity details reach the player UI at all outside debug?
- Should debug and issue-report endpoints be a separate, flagged, GM-privileged channel, with redaction for the issue report?
