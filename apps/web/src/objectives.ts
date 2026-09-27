import { create } from "@bufbuild/protobuf";
import { ActiveObjectiveSchema, type Character } from "../../../packages/contracts/src/index.js";

export const ACTIVE_OBJECTIVE_GUIDANCE = [
  "An active objective has name (the full undertaking), status (current work, known facts, progress, obstacles and remaining execution plan), success_criteria (observable evidence of success), and current_goal (one concrete action-planner task). Other objectives are non-active ambitions.",
  "On accepting an undertaking, set an active objective without losing later commitments. After each goal or conversation, update status from actual events and select the next feasible goal toward the same success criteria. Completing a step or receiving a promise is not completing the objective.",
  "Prioritize the active objective and recent relevant events, while respecting urgency, agency and existing commitments. Keep facts distinct from claims and promises. Plans must use supported mechanics; never invent fulfilled success criteria.",
  "When progress fails, explicitly consider demote (retain as non-active), drop (abandon), or set (revise to an achievable compromise). Record the reason. Do not loop on a failed goal without a concrete change. A busy person or an execution-budget pause is not proof the objective is impossible.",
  "Use changes.active_objective to set/update the four fields together, or demote/drop/complete it. complete requires evidence that the success criteria have actually been met. While active, always provide a useful current_goal. If none is feasible, demote, drop or revise instead of silently forgetting the objective.",
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
    character.objectives = character.objectives.filter(item => item !== objective.name);
  } else {
    if (!["demote", "drop", "complete"].includes(action)) throw new Error("Unknown objective action.");
    if (!character.activeObjective) throw new Error("There is no active objective to transition.");
    const previous = character.activeObjective;
    character.objectives = character.objectives.filter(item => item !== previous.name);
    if (action === "demote") character.objectives.push(previous.name);
    delete character.activeObjective;
    character.currentGoal = "";
  }
  const subject = character.activeObjective ?? previous!;
  return "Objective " + action + " (" + subject.name + "): " + reason
    + (action === "demote" ? " Deferred plan: " + subject.status + " Success criteria: " + subject.successCriteria : "");
}
