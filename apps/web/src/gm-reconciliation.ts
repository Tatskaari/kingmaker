import { inventoryOwners, inventoryFor, locatedItems } from "../../../packages/core/src/inventory.js";
import { create } from "@bufbuild/protobuf";
import { ItemInstanceSchema, type Scenario } from "../../../packages/contracts/src/index.js";
import type { OpenRouterTool } from "../../../packages/providers/src/openrouter.js";

export const RECONCILIATION_INSTRUCTIONS = `Adjudicate the completed exchange or action run. Keep a feasible next task, replace it with a useful concrete step, or use cancel_task for a dead end. An inability/limit/error is evidence to reassess, not a reason to restart the same task under new wording.
Use create_item for a justified missing prop in an existing container or character inventory; inspection reveals its details. Cancel or narrow a task when adding a prop would not make progress possible.
This review stages its changes. Account for successful staging tools in the requested final memory JSON; publication follows validation. Return that JSON after tool results. A null goalUpdate means idle; clear obsolete tasks.`;

export const reconciliationTools: readonly OpenRouterTool[] = [
  { type: "function", function: { name: "create_item", description: "Make a justified missing physical item real in an existing container or character inventory. Use meaningful unique IDs. Its details become available through inspection. Does not move or duplicate an existing item.", parameters: {
    type: "object", additionalProperties: false, required: ["id", "name", "locationId", "details", "reason"], properties: {
      id: { type: "string" }, name: { type: "string" }, locationId: { type: "string", description: "Exact existing character ID or container fixture ID." }, details: { type: "string", description: "Concrete inspectable description, including text if this is a written item." }, reason: { type: "string" },
    },
  } } },
  { type: "function", function: { name: "cancel_task", description: "Clobber a participant's dead-end task. They become idle until a later exchange gives them a fresh task. Overrides any goal in the final JSON. Give a reason safe to remember from that character’s perspective, without revealing GM secrets.", parameters: {
    type: "object", additionalProperties: false, required: ["characterId", "reason"], properties: { characterId: { type: "string" }, reason: { type: "string" } },
  } } },
];

function field(input: Record<string, unknown>, key: string, max = 8000): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${key}`);
  return value.trim();
}

/** Only mutates the caller's staged world. Publication happens after the final review validates. */
export function applyReconciliationTool(scenario: Scenario, participants: readonly string[], cancelled: Map<string, string>, name: string, input: Record<string, unknown>) {
  const reason = field(input, "reason", 1000);
  if (name === "cancel_task") {
    const id = field(input, "characterId", 100);
    if (!participants.includes(id)) throw new Error("Only participants' tasks may be cancelled.");
    cancelled.set(id, reason);
    return { cancelled: id, reason };
  }
  if (name !== "create_item") throw new Error(`Unknown reconciliation tool: ${name}`);
  const world = scenario.world!;
  const id = field(input, "id", 100), name_ = field(input, "name", 200), locationId = field(input, "locationId", 100), details = field(input, "details");
  if (!/^[a-z][a-z0-9_]*$/.test(id)) throw new Error("Use a lowercase snake_case item ID.");
  if ([...locatedItems(inventoryOwners(scenario.characters, scenario.world)), ...world.fixtures, ...world.rooms, ...scenario.characters].some(item => item.id === id)) throw new Error("That ID already exists. Use the existing item instead.");
  const fixture = world.fixtures.find(item => item.id === locationId && item.container);
  if (!fixture && !scenario.characters.some(item => item.id === locationId)) throw new Error("Location must be an existing container or character inventory.");
  inventoryFor(inventoryOwners(scenario.characters, scenario.world), locationId).items.push(create(ItemInstanceSchema, { id, name: name_, quantity: 1, concealed: true, details }));
  world.revision++;
  return { created: id, name: name_, locationId, details };
}
