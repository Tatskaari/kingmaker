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

Action log (completed actions, oldest first):
{{{history}}}
