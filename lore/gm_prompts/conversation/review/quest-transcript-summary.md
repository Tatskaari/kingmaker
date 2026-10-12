---
summary: "Summarize one accepted development for a quest-specific running transcript."
visibility: gm
system: "Quest development summary"
trigger_context: "After Jev identifies an active quest affected by an accepted conversation turn."
tags: ["prompts", "conversation/review", "conversation/plot-progress"]
variables: ["quest", "questTranscript", "turn"]
---
Add one compact entry to this quest's running transcript. Capture what the player is trying to achieve, what changed, any commitment or outcome, any blocker, and the next opening the development creates. Write an account of the development, not instructions for changing the quest.

Quest now:
{{{quest}}}

Earlier quest transcript:
{{{questTranscript}}}

Recent accepted turn:
{{{turn}}}
