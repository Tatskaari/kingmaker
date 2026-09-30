import type { ActiveObjective, Scenario } from "../../../packages/contracts/src/index.js";
import type { courtAgentObservation, CourtAgentAction } from "./court-agent.js";
import { JEV_ACTION_CONTEXT_LEVEL, JEV_ACTION_INCLUDE_RECENT_RESULTS, type JevActionContextLevel } from "./feature-flags.js";

export interface JevActionContextOptions {
  level?: JevActionContextLevel;
  includeRecentResults?: boolean;
}
type Observation = ReturnType<typeof courtAgentObservation>;
const steps = (count: number) => `${count} ${count === 1 ? "step" : "steps"}`;
const objectiveText = (objective: ActiveObjective) => [
  `Name: ${objective.name}`, `Status: ${objective.status}`,
  `Success criteria: ${objective.successCriteria}`, `Current task: ${objective.currentGoal || "None"}`,
].join("\n");

/** This text is the world interface sent to Jev, not a separate debug summary. */
export function renderJevRoomView(scenario: Scenario, observation: Observation): string {
  const world = scenario.world!, roomId = observation.world.location.roomId;
  const room = world.rooms.find(item => item.id === roomId)!;
  const nameOfRoom = (id: string) => world.rooms.find(item => item.id === id)?.name ?? id;
  const actionsFor = (target: string) => observation.actions.filter(action => action.target === target);
  const renderActions = (actions: CourtAgentAction[], name: string, distance?: number) => actions.map(action => {
    let label = action.description.replace(/ \(\d+ steps\)\.$/, "");
    if (label.endsWith(` ${name}`)) label = label.slice(0, -name.length - 1);
    return `    - ${label}${action.legality === "illegal" ? " (illegal)" : ""}`
      + (distance === action.path.length - 1 ? "" : ` — ${steps(action.path.length - 1)}`) + ` [${action.id}]`;
  });
  const entities = [
    ...observation.world.nearbyCharacters.filter(item => item.characterId !== observation.characterContext.character.id)
      .map(({ characterId }) => ({ id: characterId, name: scenario.characters.find(item => item.id === characterId)?.name ?? characterId, details: [] as string[] })),
    ...observation.world.furniture.map(item => ({ id: item.id, name: item.name, details:
      world.fixtures.find(fixture => fixture.id === item.id)?.container ? [
        `State: ${item.open ? "open" : item.requiredKeyId ? "locked" : "closed"}`,
        `Contents: ${typeof item.contents === "string" ? item.contents : item.contents?.map(content => content.name).join(", ") || "empty"}`,
      ] : [] })),
  ].map(entity => ({ ...entity, actions: actionsFor(entity.id) }))
    .sort((a, b) => Math.min(...a.actions.map(action => action.path.length)) - Math.min(...b.actions.map(action => action.path.length)) || a.id.localeCompare(b.id));
  const lines = [`You: ${observation.characterContext.character.name} [${observation.characterContext.character.id}]`,
    "", `${room.name} (current room) [${room.id}]:`];
  for (const entity of entities) {
    const distance = Math.min(...entity.actions.map(action => action.path.length - 1));
    lines.push(`  ${Number.isFinite(distance) ? distance === 0 ? "Within reach" : steps(distance) + " away" : "No available actions"}: ${entity.name} [${entity.id}]`,
      ...entity.details.map(detail => `    ${detail}`), ...renderActions(entity.actions, entity.name, distance));
  }
  if (!entities.length) lines.push("  No other characters or furniture.");
  lines.push("", "Exits:");
  for (const id of room.exitRoomIds) {
    lines.push(`  ${nameOfRoom(id)} [${id}]:`);
    for (const door of world.doors.filter(door => door.roomIds.includes(roomId) && door.roomIds.includes(id))) {
      lines.push(`    ${door.name}: ${door.open ? "open" : "closed"}`, ...renderActions(actionsFor(door.id), ""));
    }
    const travel = actionsFor(id);
    lines.push(...(travel.length ? renderActions(travel, "") : ["    Entry blocked: no reachable route; a connecting door may need opening first."]));
  }
  lines.push("", "Inventory:");
  for (const item of observation.world.inventory) lines.push(`  ${item.name} [${item.id}]`,
    ...renderActions(observation.actions.filter(action => action.id === `inspect_item_${item.id}`), item.name, 0));
  if (!observation.world.inventory.length) lines.push("  Empty.");
  lines.push("", "Room connections (map, not live observations):");
  for (const item of world.rooms) lines.push(`  ${item.name} → ${item.exitRoomIds.map(nameOfRoom).join(", ") || "No exits"}`);
  return lines.join("\n");
}

/** Only the action planner uses these tiers. No premise, audience, or other
 * character context is implicitly appended to the rendered input. */
export function renderJevActionState(scenario: Scenario, observation: Observation, recentResults: readonly string[] = [], options: JevActionContextOptions = {}): string {
  const level = options.level ?? JEV_ACTION_CONTEXT_LEVEL;
  if (![1, 2, 3].includes(level)) throw new Error("Jev action context level must be 1, 2 or 3.");
  const { character, notes } = observation.characterContext;
  const sections = [renderJevRoomView(scenario, observation), "Current objective:\n" + (character.activeObjective
    ? objectiveText(character.activeObjective) : "None recorded.")];
  if (!character.activeObjective || character.activeObjective.currentGoal !== observation.goal) sections.push(`Current execution task:\n${observation.goal}`);
  if (level >= 2) sections.push(`Biography:\n${character.lore || "None recorded."}`, "Parked objectives (not active tasks):\n"
    + (character.parkedObjectives.map(objectiveText).join("\n\n") || "None."));
  if (level >= 3) sections.push("Relationships:\n" + (character.relationships.map(item =>
    `- ${scenario.characters.find(other => other.id === item.characterId)?.name ?? item.characterId}: ${item.description}`).join("\n") || "None."),
  "Notes known to this character:\n" + (notes.map(note => `- Day ${note.day}: ${note.text}`).join("\n") || "None."));
  if (options.includeRecentResults ?? JEV_ACTION_INCLUDE_RECENT_RESULTS) sections.push("Recent action results (already happened):\n"
    + (recentResults.map(result => `- ${result}`).join("\n") || "None."));
  return sections.join("\n\n");
}
