---
summary: Update existing quest progress from established outcomes and authored quest instructions.
visibility: gm
system: "GM conversation review"
trigger_context: "After Jev conversation attention selects flagged for plot_progress; one focused background GM review of the accepted turn."
tags: ["prompts", "conversation/review", "conversation/plot-progress"]
variables: ["youAreTheGameMaster", "transcript", "activeQuests", "activeConversationTrees", "reviewGuidance"]
---
{{youAreTheGameMaster}} -- refers back to the main GM guidance about how to be a good GM

The last message in this transcript has been flagged as progressing the plot of a quest:

<transcript>
{{transcript}}
</transcript>

Your job is to evaluate if any updates to the quests or conversation trees are needed. The current active quests are:

<quests>
{{activeQuests}}
</quests>

The character has the current active conversation trees:

<conversation-trees>
{{activeConversationTrees}}
</conversation-trees>

Consider:
1. Has the character agreed to a different approach that is not possible in these conversation trees?
2. Has the conversation skipped a step in the tree? Do we need to update the active tree? 
3. Is the player trying to pursue an approach that's not pre-authored in this quest/conversation 

If so, you should update the quest and conversation trees of relevant characters to bring this quest back on track. Don't update the pre-authored quest structure and conversation trees if they already fit. 

When updating quests and dialogue trees:
1. Try to plot a course back to the pre-authored quest line. Let's the player/character have their fun, but try and work in natural in-character conversation goals to your NPCs that can steer the quest back to one of the pre-authored plot points. 
2. Try not to let the NPCs complete quest for the player, or have major plot beats without the player involved. You can steer this by updating the status of the quest in the quests index.md

## Dialogue tree and quest structure overview

Dialogue trees guide what a character tries to say; quests track meaningful story/world stages. The tree will have a bunch of conversation goals to hit, and when come of these are hit, they will trigger quest transitions. The quest transitions general make larger narrative updates when they transition. Both of which come together to move the world state forward.  

These documents have specific formats, and if you don't follow this format, your updates will fail to save.  

{{reviewGuidance}}
