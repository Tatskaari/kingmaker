---
title: "Design: one authority clock for the simulation"
labels: [design, tech-debt, simulation]
---

## Observation

There are several independent notions of "now":

- Movement stores absolute wall-clock `Date.now()` as `startedAtMs` in `G` (`packages/core/src/movement-service.ts:11-13`). On load, every saved movement looks finished.
- The UI interpolates with its own `Date.now()` (`apps/web/src/court-map.ts:164,206,371`). It ignores the injectable `MovementClock` that headless and evals use.
- `WaitScheduler` uses `performance.now()` elapsed time (`apps/web/src/wait-scheduler.ts:15,40`).
- The Cressida cadence is an in-memory timer with an unsaved `warned` flag (`apps/web/src/cressida-scheduler.ts:15-36`), so it resets on reload.
- `worldView` and `foregroundBodies` default to `Date.now()`.
- `map.day` is the only time inside the simulation.

## Why it doesn't pass the sniff test

Moves are deliberately clock-free, which is good. But the authority and its clients share no synced "now", so optimistic interpolation is exact only because everything runs on one machine. Scheduled physical events, such as a transformation coming due, aren't in the state at all.

## Threads to pull

- Should the simulation carry an authority time base (epoch plus offset, or a tick), synced with `G`, that every interpolation and scheduler reads?
- Should scheduled physical events (due times) be stored in the simulation, so they survive reloads and are visible to clients?
- Should movement store times relative to that base, so saves resume correctly?
- This ties into the missing time progression mentioned in the README.
