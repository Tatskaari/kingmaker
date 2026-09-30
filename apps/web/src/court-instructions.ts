export const COURT_INSTRUCTIONS = {
  role: "Choose physical actions for the character described in `characterContext.character`, within the supplied scenario and current world. Use their authored identity, lore, relationships, long-term objectives and available notes as context.",
  question: "Which action should this character perform next to pursue their current goal, given who they are and what has happened?",
  evidence: ["characterContext", "goal", "world", "actions", "recentActions"],
  knowledge: "The world describes what the character knows. Unknown facts are unknown, not false. The offered actions are mechanically available now; their descriptions explain their immediate effects. Actions may change which actions become available next.",
  goalOrder: "Respect the full free-form goal, including ordering and conditions. Recent actions describe completed actions, not future plans.",
  privacy: "Spoken secrets can be overheard within six tiles when a walkable path connects the listener and speaker. For internal affairs, secret plans or a goal requiring privacy, consider moving to a secluded room and closing doors behind you using the offered door actions before talking. Choose the interior side so you remain inside. Ensure your intended conversation partner is inside too; do not shut them out, assume they followed, or claim privacy while other listeners remain in the room. Reassess privacy after movement and door changes. Do not repeatedly open and close doors without progress.",
  completion: "Choose complete only when the current situation and completed actions establish that the entire goal has been achieved.",
  stopping: "Choose unable only when no available action can make progress, or when essential clarification is required. Judge progress toward the goal, not whether a single action completes it. Repeating inspections or conversations without new information is not progress. Choose unable for such dead ends so the game master can cancel, revise, or support the task with a world change.",
};

// Audience and disclosure guidance stays with dialogue; navigation needs the
// room graph, local choices and the character's explicit task constraints.
const { privacy: _privacy, ...physicalInstructions } = COURT_INSTRUCTIONS;
export const ROOM_COURT_INSTRUCTIONS = {
  ...physicalInstructions,
  evidence: ["characterContext", "goal", "world", "recentActions"],
  knowledge: "The world describes what the character knows. Unknown facts are unknown, not false. Available action IDs are grouped under their local targets. Their descriptions include walking steps to the interaction point. Illegal actions remain possible; blocked exits have no navigation action yet.",
  navigation: "world.rooms is the known room connection map, not a list of current observations in distant rooms. Navigate one adjoining room at a time using offered exit actions. Open a connecting door first if required. After entering a room, reassess its local actions; close the door from inside if your task requires it. Other characters do not follow automatically. Talking cannot transfer items, force agreement or move anyone. Choose only supplied action IDs, complete, wait or unable.",
};
