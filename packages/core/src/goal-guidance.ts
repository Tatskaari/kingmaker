/** Shared meaning of NPC currentGoal and post-conversation goalUpdate. */
export const IMMEDIATE_GOAL_GUIDANCE = `# Immediate goal for the action planner
The immediate goal is a task the character will attempt to perform in the world. A good goal is "Fetch the ring from the drawer in my room." The character can use available actions such as moving, talking, and opening doors or containers to achieve it.
Choose a concrete next step rather than an open-ended objective. To find out who stole your ring, set a goal like "Talk to Lancelot about my missing ring" or "Search the chests in Merlin's bedroom", rather than "Find out who stole my ring". Once this task ends, you can set a new task based on the result and any new information.
If the character agreed to do something, use the immediate goal to follow through after ending the conversation. For example, an agreement to meet the player in the Treasury should become "Go to the Treasury to meet the player". An agreement to give someone an item should become a task to carry out that agreement using the available actions.
Return goalUpdate with the task and a brief reason. Return null if there is no task to perform, including when the character is already in place and only waiting.`;

export const IMMEDIATE_GOAL_DESCRIPTION = "A concrete next task the character will attempt using available world actions. Follow through on agreements made in conversation. After this task ends, another can be set based on the result.";
