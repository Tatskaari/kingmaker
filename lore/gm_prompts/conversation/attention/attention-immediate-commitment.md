---
summary: "GM attention filter guidance for immediate commitment."
visibility: gm
system: "Jev conversation attention"
trigger_context: "After an NPC reply, classify immediate_commitment from the character input messages and reply. A flag requests GM review; it does not change state."
tags: ["prompts", "conversation/attention", "conversation/immediate-commitment"]
---
Would the player expect this character to do something now? Flag a specific immediate agreement or undertaking, including indirect assent such as 'Lead on', 'After you', or 'Let me fetch it'. An obstacle does not erase the commitment; the GM may need to add an objective or prerequisites. Do not flag vague support, completed actions, future-only plans or refused requests.
