---
title: "Design: one player-turn flow with disclosure, checks and trees as hooks"
labels: [design, tech-debt, hooks]
---

## Observation

The other strategies (review, action, actionExecution, resolution) take `(context, labels?, signal, services)` and receive everything through `services`. The conversation pieces don't:

- `conversationStrategy(...)` takes 12 positional arguments, builds its own private `ConversationRuntime` from closed-over services, mostly ignores the `services` passed to `respond`, and calls `Date.now` (`packages/conversation/src/conversation-strategy.ts:16-46`).
- `checkStrategy(runtime, …)` returns `classify`/`resolve` with no `services` parameter and calls `classifyConversationTurn` from providers directly (`packages/conversation/src/check-strategy.ts:3,11-20`).
- `DisclosureSession` and `ProgressiveDisclosure` close over `lore` and `ai` in their constructors (`disclosure.ts:10`, `progressive-disclosure.ts:57`).
- Every host constructs `new DisclosureSession(…, 0.7)` directly instead of using `services.disclosure` (`apps/web/src/world-runtime.ts:305,670`, `scripts/conversation-cli.ts:59,80`).

So the player turn is re-assembled per host:
- web dialogue (`world-runtime.ts:280-398`: tree before and after, ruling capture, quest transitions)
- web opening line (:655-694, a different strategy)
- CLI (`apps/conversation-cli/app.tsx:145-175`, `scripts/conversation-cli.ts:59-82`, default `setupAgent` so no earshot notes)
- evals (`packages/evals/src/review-conversation.ts:24-45`)

`ConversationTreeSession` takes a `QuestService` through its constructor rather than through services. The host also builds a fresh runtime per call and then mutates its strategies and services (`world-runtime.ts:102-154,298-311,348,671-674`).

## Why it doesn't pass the sniff test

The hook system is meant to let a host swap policy while sharing the flow. For conversations, the flow lives in each host and the policy is closed over at construction time. Swapping a strategy in an eval doesn't test the same flow the game runs.

## Threads to pull

- Should there be a single `runPlayerTurn` in `packages/conversation` with `strategies.conversation.{disclosure, checks, respond, afterReply}` (trees and attention as `afterReply`)?
- Should disclosure, checks and trees receive services per call instead of capturing them?
- Should per-turn variations (opening line vs reply) be composed strategies rather than post-construction mutation?
