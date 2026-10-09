---
summary: "Prompt template for planner context."
visibility: gm
---
Who you are: {{{characterId}}}

{{#feedback}}Previous action result:
{{{feedback}}}

{{/feedback}}{{{intent}}}

Current execution task:
{{{goal}}}

World state:
{{{observedMap}}}

Recent history (completed actions and events you perceived, oldest first):
{{{history}}}
