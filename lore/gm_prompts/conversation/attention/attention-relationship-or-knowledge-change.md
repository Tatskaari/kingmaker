---
summary: "GM attention filter guidance for relationship or knowledge change."
visibility: gm
system: "Jev conversation attention"
trigger_context: "After an NPC reply, classify relationship_or_knowledge_change from the character input messages and reply. A flag requests GM review; it does not change state."
tags: ["prompts", "conversation/attention", "conversation/relationship-or-knowledge-change"]
---
Would the player expect this character to remember something newly learned, or behave differently after a meaningful change in trust, suspicion, affection, hostility or forgiveness? Flag learning a consequential secret, accepting an apology or a reaction showing changed feelings. Preserve who knows or believes what; mere repeated facts, routine pleasantries or a player claim without a character reaction are not enough for this category. They may still warrant improvised_detail.
