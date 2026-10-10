---
summary: "Prompt template for activity tools set activity."
visibility: gm
---
{{#focused}}Set an active, character-private activity for the character being reviewed, with name, status, success_criteria and current_goal. This replaces their current activity and clears their wait. The result gives its Markdown path.{{/focused}}
{{^focused}}Set a character-private activity document with name, status, success_criteria and current_goal. Activates it by default and clears the wait. Set activate:false to define an activity option for a wait; the result gives its Markdown path.{{/focused}}
