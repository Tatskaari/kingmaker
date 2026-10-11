---
summary: "GM attention filter guidance for general commitment."
visibility: gm
system: "Jev conversation attention"
trigger_context: "After an NPC reply, classify general_commitment from the character input messages and reply. A flag requests GM review; it does not change state."
tags: ["prompts", "conversation/attention", "conversation/general-commitment"]
---
Would the player expect ongoing support, allegiance or willingness to help after this reply? Flag broad commitments such as 'You have my support' without turning them into a specific invented task. A concrete action promise alone belongs in immediate/deferred commitment.
