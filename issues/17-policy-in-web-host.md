---
title: "Design: NPC planning/wait policy and default strategies live in apps/web"
labels: [design, tech-debt, hooks]
---

## Observation

- `ActionStrategy` (`packages/conversation/src/action.ts:13-16`) covers only Jev's choice and ID validation. The real planning policy (observation context, A→B→A heuristic, prompt) is in `apps/web/src/world-action.ts:27-60`.
- `defaultWorldStrategies` lives in `apps/web/src/world-strategies.ts`, so the baseline strategy set belongs to the browser host. Evals import it and `planWorldAction` from apps/web (`packages/evals/src/corvin-planner-experiment.ts:11-12`, `packages/evals/src/review-experiment.ts:11`).
- `decideWait` (`packages/conversation/src/wait.ts:139`) isn't a strategy; the host calls it and commits the result (`apps/web/src/world-runtime.ts:566-586`).
- Prompts are written inline in the host: the follow-wait document (`world-runtime.ts:524-532`) and Cressida goal and message text (:593-603). There is also a character-specific Cressida special case in `apps/web/src/agent-setup.ts:33-35`.

## Why it doesn't pass the sniff test

- Evals compare candidate strategies against a baseline, but the baseline is partly host code that the strategy contract doesn't cover.
- Dependencies point the wrong way: `packages/evals` → `apps/web`.
- Character-specific behaviour in host code bypasses the lore vault, which is meant to be the source of characterisation.

## Threads to pull

- Should `defaultWorldStrategies` and the planner context move into `packages/conversation`?
- Should waits get a `wait` classify/resolve strategy, like actions?
- Should character-specific text and rules (Cressida, follow waits) move into lore or prompt templates?
- Once policy moves out, is `apps/web` left as UI + host only? Then headless and evals could depend on a host package instead of the browser app.
