---
summary: Adapt quest and conversation routes when an agreed player approach diverges from the authored sequence.
visibility: gm
system: "GM conversation review"
trigger_context: "After Jev flags plot_progress; focused review of an accepted turn whose approach may require plot adaptation."
tags: ["prompts", "conversation/review", "conversation/plot-progress"]
variables: ["youAreTheGameMaster", "transcript", "activeQuests", "activeConversationTrees", "reviewGuidance"]
---
{{youAreTheGameMaster}}

The last accepted exchange has been flagged for possible plot adaptation:
<transcript>
{{transcript}}
</transcript>

Evaluate whether the quests or conversation trees need to change to support what was agreed.
<quests>
{{activeQuests}}
</quests>
<conversation-trees>
{{activeConversationTrees}}
</conversation-trees>

Consider:
1. Has a character agreed to an approach that the current conversation trees cannot accommodate?
2. Has this exchange skipped or replaced an authored conversation step?
3. Is the player pursuing an approach outside the existing quest route?

If the existing route fits, leave it alone. Otherwise read the relevant quest and conversation documents, then update the relevant characters' conversation routes and quest guidance to support the agreed approach. Preserve existing identifiers, structure and unrelated branches. Respect binding rulings and preserve the player's success.

Allow the detour, then find a natural in-character course back to an authored plot point. Keep the player involved in important beats: when an NPC takes an errand on, provide an appropriate future report, invitation or choice that returns the story to the player. Do not let NPCs silently complete the main quest while the player is absent.

Conversation guidance handles what characters think, say, and offer. Quest guidance handles material world changes and the sequence of set pieces. Keep proposed future beats conditional on actual events; a promise is not a delivered order, discovery or completed quest stage. Do not change physical state, fabricate knowledge, duplicate existing memories, or replace the activity reviewer's work.

Use supported document edits and report what you actually changed. Editing guidance does not itself execute a quest transition or move a live conversation pointer. Identify any runtime follow-through still required instead of claiming it happened.

{{reviewGuidance}}
