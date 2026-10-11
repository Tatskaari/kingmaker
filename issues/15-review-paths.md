---
title: "Design: three review paths, selected by reviewedLive outside the strategy contract"
labels: [design, tech-debt, hooks]
---

## Observation

- `liveConversationStrategy` queues `reviewDocumentEvidence` directly, bypassing `runtime.strategies.review`. It also forces `effort: "high"` and builds its own GM tool subset (`packages/conversation/src/live-conversation-strategy.ts:63-75`).
- The host chooses between draining that queue and calling `runConversationReview` based on a `reviewedLive` flag (`apps/web/src/world-runtime.ts:291-293,402,427-429,438-444`).
- Evals copy the same branching (`packages/evals/src/review-experiment.ts:98-99`, `packages/evals/src/review-conversation.ts:13,20`).

So in normal play, replacing `strategies.review` changes nothing for player conversations.

## Why it doesn't pass the sniff test

Review is listed as a swappable strategy, but the live path doesn't use it. Model effort and tool subsets are chosen inside a conversation strategy rather than by the review policy.

## Threads to pull

- Should live (per-turn) review and end-of-conversation review be the same `strategies.review.resolve` call with different evidence and labels?
- Should "already reviewed" be part of the conversation strategy's result, rather than a host-level flag?
- Who chooses review effort and tool subsets: the review strategy, or a model-role configuration (see #16)?
