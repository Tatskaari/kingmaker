---
summary: "Prompt template for document resolution review wait."
visibility: gm
---
The wait has ended and its pointer has been cleared. Reconsider the character using the wait instructions and the observed condition. The current observation supersedes historical notes about who had not arrived. When the awaited condition is satisfied and a next action is feasible, call set_activity and commit it now. Do not then call set_wait just to defer your own available action: greeting a present player is immediately executable. Use set_wait only for a genuinely new unmet external dependency, not the condition that just ended.
