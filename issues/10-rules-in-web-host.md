---
title: "Design: move physical rules (legal actions, perception, observation) out of apps/web"
labels: [design, tech-debt, simulation]
---

## Observation

Rules that decide what is physically legal or perceivable live in the browser host, not in `packages/core` or the moves:

- `apps/web/src/room-actions.ts:20-87` (`roomAgentActions`) is the authoritative list of legal NPC actions: room entry, door sides, fixture reachability, legality labels, talk and follow. `startMove` trusts whatever path, `allowedRoomIds` and `thresholds` the host supplies (`apps/web/src/world-host.ts:208-210`).
- `apps/web/src/earshot.ts`: perception ranges and chances, rolled by the host (`apps/web/src/world-runtime.ts:643-649`).
- `apps/web/src/background-characters.ts:40-53` (`foregroundBodies`): a time-dependent rule that defaults to `Date.now()`.
- `apps/web/src/physical-observation.ts`, `apps/web/src/guard-duty.ts`.
- `PalaceMechanics` re-implements fixture validation before calling the move (`apps/web/src/palace-mechanics.ts:186-191` duplicates `packages/core/src/simulation-fixtures.ts`).
- `packages/headless/src/world.ts:8` imports `apps/web/src/physical-observation.ts`.

## Why it doesn't pass the sniff test

If clients are to run moves optimistically, and a second host is to agree on what's legal, legality has to live with the moves. Today rules are split between core moves and web helpers, and the moves accept host-computed paths on trust.

## Threads to pull

- Should moves validate legality themselves (route, room access, door sides), or call a shared core validator, rather than trusting supplied paths and access lists?
- Should action enumeration (`roomAgentActions`), earshot and observation move into `packages/core` as pure functions of `G`, leaving only event prose and presentation in the host?
- Is `PalaceMechanics` still a needed layer once moves validate, or does it collapse into the map service?
