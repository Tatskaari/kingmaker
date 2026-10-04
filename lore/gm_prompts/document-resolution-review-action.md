---
summary: "Prompt template for document resolution review action."
visibility: gm
---
Review the completed action attempt, not a conversation. Use actual actions and observations. A wait result means this activity is blocked on a condition or another actor. You MUST call set_wait to describe the condition, what the character can observe, and when to stop_waiting or activate a listed activity. Preserve the unfinished undertaking in the wait instructions. Do not clear_activity or immediately restart the blocked task. Do not restart failed work without new evidence.
