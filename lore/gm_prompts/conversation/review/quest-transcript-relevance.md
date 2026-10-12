---
summary: "Classify whether an accepted conversation turn changes the playable course of one active quest."
visibility: gm
system: "Jev quest relevance"
trigger_context: "After an accepted conversation turn is explicitly marked for quest-transcript review."
tags: ["prompts", "conversation/review", "conversation/plot-progress"]
variables: ["quest", "turn"]
---
Decide whether the accepted conversation turn changes how this quest may progress. A relevant development can establish progress, a new approach, a commitment, a useful opening, or a blocker or failed plan that now needs recovery. An approach can be relevant even when it was not authored in advance.

Quest:
{{{quest}}}

Recent turn:
{{{turn}}}
