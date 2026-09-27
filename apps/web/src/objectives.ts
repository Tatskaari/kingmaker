import { create } from "@bufbuild/protobuf";
import { ActiveObjectiveSchema, type Character, type Scenario } from "../../../packages/contracts/src/index.js";

const INITIAL_GREETING = "Remain in the Great Hall and greet the visiting player. Be available for conversation.";

/** Upgrade authored/old-save NPC goals so the planner never runs detached work. */
export function ensureNpcActiveObjectives(scenario: Scenario): void {
  for (const character of scenario.characters) {
    for (const name of character.objectives) character.parkedObjectives.push(create(ActiveObjectiveSchema, {
      name,
      status: "This enduring ambition is parked. No current execution plan has been adopted.",
      successCriteria: name,
      currentGoal: "",
    }));
    character.objectives = [];
    if (character.id === scenario.playerCharacterId || character.activeObjective || !character.currentGoal.trim()) continue;
    const greeting = character.currentGoal === INITIAL_GREETING;
    character.activeObjective = create(ActiveObjectiveSchema, {
      name: greeting ? "Welcome the visiting player" : character.currentGoal.split(".")[0]!,
      status: greeting
        ? "The visiting player is expected in the Great Hall. I should remain there, greet them when they arrive, and stay available for conversation."
        : "No progress has been recorded yet. I should begin with: " + character.currentGoal,
      successCriteria: greeting
        ? "I have greeted the visiting player and remain available if they want to speak."
        : "The task described by this objective has been completed in the world, not merely promised.",
      currentGoal: character.currentGoal,
    });
  }
}

export const ACTIVE_OBJECTIVE_GUIDANCE = [
  "An active objective has name (the full undertaking), status (current work, known facts, progress, obstacles and remaining execution plan), success_criteria (observable evidence of success), and current_goal (one concrete action-planner task). Parked objectives retain the same fields but are non-active; their current_goal records the last planned step and is not executed while parked.",
  "On accepting an undertaking (from a conversation, or something you overheard etc.), set an active objective and success criteria. Use the status to track progress, and use the current goal to set the next action you'd like the character to take in the world. This will be used by the action planner. After each goal completion or event, update status from actual outcomes and set the next feasible goal toward the same success criteria. Completing a step or receiving a promise is not completing the objective.",
  "Prioritize the active objective and recent relevant notes, while respecting urgency, agency and existing commitments. Keep facts distinct from claims and promises. Plans must use supported mechanics; never invent fulfilled success criteria.",
  "When progress fails, explicitly consider demote (retain as non-active), drop (abandon), or set (revise to an achievable compromise). Record the reason. Do not loop on a failed goal without a concrete change. A busy person or an execution-budget pause is not proof the objective is impossible.",
  "Waiting for another character to act is not an executable current goal. If the next progress depends entirely on another character initiating a conversation, arriving, deciding, or completing their own work, demote this objective while blocked. The waiting character should become idle and available for other work. When the awaited character later initiates the relevant conversation or event, use that new evidence to set the objective active again with a concrete next action.",
  "If progress towards an objective becomes impossible, it can be demoted to a normal objective. This can be brought up in conversation e.g. with the player who may be able to help the character out.",
  "Use changes.active_objective to set/update the four fields together, or demote/drop/complete it. complete requires evidence that the success criteria have actually been met. While active, always provide a useful current_goal. If none is feasible, demote, drop or revise instead of silently forgetting the objective.",
  `Example of a well-formed active objective:
Name: Find out who stole my ring
Status: I cannot find my ring. I left it in my lockbox, but it was missing when I checked. I suspect Everlyn, although I do not yet have evidence that she took it. First I should speak to Malcom to learn whether he heard her moving around last night. Depending on what he knows, I can inspect the lockbox and surrounding room for evidence before deciding whether to confront Everlyn.
Success criteria: I have credible evidence identifying who removed the ring from my lockbox. Suspicion or an unsupported accusation is not sufficient.
Current goal: Talk to Malcom and ask whether he heard or saw anyone near my lockbox last night.`,
].join("\n");

export function applyObjectiveChange(character: Character, value: unknown): string {
  const previous = character.activeObjective;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("active_objective must be a transition object.");
  const change = value as Record<string, unknown>;
  const text = (key: string) => {
    const value = change[key];
    if (typeof value !== "string" || !value.trim()) throw new Error("Objective " + key + " must be nonempty.");
    return value.trim();
  };
  const reason = text("reason"), action = text("action");
  const allowed = action === "set" ? ["action", "reason", "name", "status", "success_criteria", "current_goal"] : ["action", "reason"];
  if (Object.keys(change).some(key => !allowed.includes(key))) throw new Error("Unknown objective transition fields.");
  if (action === "set") {
    const objective = create(ActiveObjectiveSchema, { name: text("name"), status: text("status"),
      successCriteria: text("success_criteria"), currentGoal: text("current_goal") });
    character.activeObjective = objective;
    character.currentGoal = objective.currentGoal;
    character.parkedObjectives = character.parkedObjectives.filter(item => item.name !== objective.name);
  } else {
    if (!["demote", "drop", "complete"].includes(action)) throw new Error("Unknown objective action.");
    if (!character.activeObjective) throw new Error("There is no active objective to transition.");
    const previous = character.activeObjective;
    character.parkedObjectives = character.parkedObjectives.filter(item => item.name !== previous.name);
    if (action === "demote") character.parkedObjectives.push(create(ActiveObjectiveSchema, previous));
    delete character.activeObjective;
    character.currentGoal = "";
  }
  const subject = character.activeObjective ?? previous!;
  return "Objective " + action + " (" + subject.name + "): " + reason
    + (action === "demote" ? " Deferred plan: " + subject.status + " Success criteria: " + subject.successCriteria : "");
}

/** Explicitly revise or remove passive (parked) objectives without activating them. */
export function applyParkedObjectiveChanges(character: Character, value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("parked_objectives must be an array.");
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid parked objective transition.");
    const change = item as Record<string, unknown>;
    const field = (name: string) => {
      const result = change[name];
      if (typeof result !== "string" || !result.trim()) throw new Error(`Parked objective ${name} must be nonempty.`);
      return result.trim();
    };
    const action = field("action"), name = field("name"), reason = field("reason");
    if (character.activeObjective?.name === name) throw new Error("The active objective must be changed through active_objective.");
    if (action === "drop") {
      if (Object.keys(change).some(key => !["action", "name", "reason"].includes(key))) throw new Error("Unknown parked objective transition fields.");
      character.parkedObjectives = character.parkedObjectives.filter(objective => objective.name !== name);
    } else if (action === "set") {
      if (Object.keys(change).some(key => !["action", "name", "reason", "status", "success_criteria", "current_goal"].includes(key))) throw new Error("Unknown parked objective transition fields.");
      const objective = create(ActiveObjectiveSchema, { name, status: field("status"), successCriteria: field("success_criteria"),
        currentGoal: typeof change.current_goal === "string" ? change.current_goal.trim() : "" });
      character.parkedObjectives = [...character.parkedObjectives.filter(existing => existing.name !== name), objective];
    } else throw new Error("Unknown parked objective action.");
    return `Parked objective ${action} (${name}): ${reason}`;
  });
}
