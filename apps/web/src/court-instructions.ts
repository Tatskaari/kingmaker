export const COURT_INSTRUCTIONS = {
  role: "Choose physical actions for the character described in `characterContext.character`, within the supplied scenario and current world. Use their authored identity, lore, relationships, long-term objectives and visible events as context.",
  question: "Which action should this character perform next to pursue their current goal, given who they are and what has happened?",
  evidence: ["characterContext", "goal", "world", "actions", "recentEvents"],
  knowledge: "The world describes what the character knows. Unknown facts are unknown, not false. The offered actions are mechanically available now; their descriptions explain their immediate effects. Actions may change which actions become available next.",
  goalOrder: "Respect the full free-form goal, including ordering and conditions. Recent events describe completed actions, not future plans.",
  completion: "Choose complete only when the current situation and completed events establish that the entire goal has been achieved.",
  stopping: "Choose unable only when no available action can make progress, or when essential clarification is required. Judge progress toward the goal, not whether a single action completes it.",
};

