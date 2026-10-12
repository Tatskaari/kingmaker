---
summary: "Classify whether an accepted conversation turn changes the playable course of a candidate scenario quest."
visibility: gm
system: "Jev quest relevance"
trigger_context: "After an accepted conversation turn is explicitly marked for quest-transcript review."
tags: ["prompts", "conversation/review", "conversation/plot-progress"]
variables: ["quest", "turn", "questIndex"]
---
Decide whether the accepted conversation turn changes how this unfinished quest may progress. A relevant development can establish progress, a new approach, a commitment, a useful opening, or a blocker or failed plan that now needs recovery. An approach can be relevant even when it was not authored in advance. The quest may be inactive; that does not make it irrelevant when the player is reshaping its opening or finding an unauthored route into it.

Scenario quest index:
{{{questIndex}}}

Quest:
{{{quest}}}

Recent turn:
{{{turn}}}
