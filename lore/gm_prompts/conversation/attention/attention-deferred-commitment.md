---
summary: "GM attention filter guidance for deferred commitment."
visibility: gm
system: "Jev conversation attention"
trigger_context: "After an NPC reply, classify deferred_commitment from the character input messages and reply. A flag requests GM review; it does not change state."
tags: ["prompts", "conversation/attention", "conversation/deferred-commitment"]
---
Would the player expect this character to remember and honour a specific promise later, or when a condition is met? Flag it for a future obligation; preserve stated timing or triggers without inventing them. Immediate-only actions, vague support and hypothetical discussion are not deferred promises.
