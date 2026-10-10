---
summary: "Review commitments and set executable activities that support existing quest and dialogue plots using only set_activity."
visibility: gm
system: "GM conversation review"
trigger_context: "After Jev flags any commitment or immediate_feasibility selects gms_discretion; runs before other focused reviews."
tags: ["prompts", "conversation/review", "conversation/activity"]
variables: ["transcript", "activeQuests", "activeConversationTrees", "npc_locations"]
---
This conversation has been flagged as having an activity that the character must undertake once this conversation completes. This task will be passed to the action planner for execution. The action planner will get a textual representation of the world state, but won't have access to the details from this transcript. You should extract any context useful for execution of this action.

<transcript>
{{transcript}}
</transcript>

Only set an activity for the character being reviewed, and only when it should become active now. Deferred promises and their timing or conditions are preserved by the separate commitment memory reviewer; do not activate future-only work early or invent a trigger. Broad support or allegiance alone does not justify inventing an activity; leave intent unchanged. If no executable undertaking is supported, make no tool call.

The current active quests and their progress are:

<quests>
{{activeQuests}}
</quests>

The character's current dialogue trees and their progress are:

<conversation-trees>
{{activeConversationTrees}}
</conversation-trees>

When setting or activating an activity, try to choose a goal in service of progressing a pre-existing plot line. Look for a concrete next step toward an authored quest or dialogue beat that fits the character's commitments, motives and permitted knowledge. Preserve prerequisites and unfinished work; do not invent a new objective merely to create activity. If no existing plot naturally fits, honour the supported commitment without forcing a connection.

Use the activity's status to preserve the character-known motivation, unfinished steps and any planned report back to the player. Keep important player choices and revelations for the player rather than having NPCs silently finish the plot offstage. The quest and tree context is GM guidance: do not copy hidden outcomes, private motives or other GM-only facts into the activity. Set activities only; do not claim to advance quest stages, edit dialogue trees or complete physical actions in this review.

The action planner works in a loop: 
1. Work towards `current_goal`, until the task is complete, seems unachievable, or something happens that makes the action planner think you should re-prioritise
2. Pass back to you to update the status and goal based on new information. 

The action planner can move between room, open and interact with doors and fixtures, take items from storage etc. and start a conversation with an NPC. They cannot make arbitrary world state updates. A good `current_goal` can be something simple like `go to the parlor, and wait for the player`, or something more advanced like `search the kings bedroom for evidence of his infidelities`. A bad goal might be `convince the king to join me in our cuase`. A better version of that would be `talk to the king`. Record why you want to talk to the king in the status.  

Use the status field to save context, and record progress towards the overall objective. Consider:

1. What context would you and the action planner need to complete this task? Use the `status` field of `set_activity()` to give the action planner the current state of the task.
	1. If you say "find and talk to each of the heads of each noble houses", you must also tell the action planner who these noble houses are, and, ideally, where they can be found (if you know from context). 
2. Consider what success looks like e.g. for the goal "Wait for the player in the nobles parlor", success might look like "I am in the nobles parlor and I have begun waiting"
3. Do: include the characters motivation for this activity in the task. 
4. Do: try and break the task down for the action planner e.g. go to X, then do Y, then finally give Y the Z. 
5. Use `current_goal` to set the next step towards achieving the desired outcome. 

Use your discretion to decide if, based on the context provided, you should set an activity. If in doubt, you can set the activity, and the action planner will gracefully give up.

Current NPC locations and routes from your room - the action planner will have this information as well:
{{{npc_locations}}}
