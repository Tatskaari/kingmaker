---
summary: "Classify whether an accepted conversation turn changes the playable course of a candidate scenario quest."
visibility: gm
system: "Jev quest relevance"
trigger_context: "After an accepted conversation turn is explicitly marked for quest-transcript review."
tags: ["prompts", "conversation/review", "conversation/plot-progress"]
variables: ["quest", "turn", "activeQuests", "questIndex"]
---
Decide whether the accepted conversation turn changes how this quest may progress. A relevant development can establish progress, a new approach, a commitment, a useful opening, or a blocker or failed plan that now needs recovery. An approach can be relevant even when it was not authored in advance.

{{^activeQuests}}
There are no active story quests. Consider this candidate against the whole scenario quest catalogue below. An inactive quest can still be relevant when the player is reshaping its opening or finding an unauthored route into it.

Scenario quest index:
{{{questIndex}}}
{{/activeQuests}}

Quest:
{{{quest}}}

Recent turn:
{{{turn}}}
