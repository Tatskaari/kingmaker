import { create } from "@bufbuild/protobuf";
import { EventSchema, EventVisibility, ObjectStateSchema, type Scenario } from "../../../packages/contracts/src/index.js";
import type { OpenRouterTool } from "../../../packages/providers/src/openrouter.js";

export const RECONCILIATION_INSTRUCTIONS = `Adjudicate the completed exchange or action run. Keep a feasible next task, replace it with a useful concrete step, or use cancel_task for a dead end. An inability/limit/error is evidence to reassess, not a reason to restart the same task under new wording.
Use create_item for a justified missing prop in an existing container or character inventory; inspection reveals its details. Cancel or narrow a task when adding a prop would not make progress possible.
This review stages its changes. Account for successful staging tools in the requested final memory JSON; publication follows validation. Return that JSON after tool results. A null goalUpdate means idle; clear obsolete tasks.`;

export const reconciliationTools: readonly OpenRouterTool[] = [
  { type: "function", function: { name: "record_witnessed", description: "Give one eligible nearby NPC a private memory of a physical action they could notice. Record only what the NPC could perceive, not the actor's private intent. Optionally propose a concrete reaction task; never invent a later confrontation or conversation as already completed.", parameters: {
    type: "object", additionalProperties: false, required: ["characterId", "summary", "reactionGoal"], properties: {
      characterId: { type: "string" }, summary: { type: "string", description: "The witnessed physical action from this NPC's perspective." },
      reactionGoal: { type: ["string", "null"], description: "A concrete feasible next task justified by the observation and witness's motives, or null to remember without acting. Existing active tasks take priority." },
    },
  } } },
  { type: "function", function: { name: "record_overheard", description: "Give one eligible nearby NPC a private, partial memory of spoken information. Sensitive internal affairs, secret plans, plots, bargains and accusations should normally leave a hint with interested listeners. Preserve uncertainty and distinguish rumours from facts. Optionally propose a concrete task to investigate or tell an existing NPC; never invent an exchange as already completed.", parameters: {
    type: "object", additionalProperties: false, required: ["characterId", "summary", "reactionGoal"], properties: {
      characterId: { type: "string" }, summary: { type: "string", description: "Only what this listener could hear at their supplied hearing level, from their perspective." },
      reactionGoal: { type: ["string", "null"], description: "A concrete feasible next task justified by this fragment and the listener's motives, or null to remember without acting. Existing active tasks take priority." },
    },
  } } },
  { type: "function", function: { name: "message_player", description: "Write a brief second-person message to the player's event feed, containing only what they can perceive or already know. For overhearing, use the supplied player earshot level: report fragments at Moderate and names/places without details at Distant. Never reveal private intent or GM-only facts. Stay silent when nothing meaningful is perceptible. Do not repeat messages already recorded.", parameters: {
    type: "object", additionalProperties: false, required: ["message"], properties: {
      message: { type: "string", description: "Player-facing prose, e.g. You overhear Corvin talking to Mara. The name Oswin comes up, but you cannot make out the details." },
    },
  } } },
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
export function applyReconciliationTool(scenario: Scenario, participants: readonly string[], cancelled: Map<string, string>, name: string, input: Record<string, unknown>, eligibleListeners: readonly string[] = []) {
  if (name === "record_overheard" || name === "record_witnessed") {
    const id = field(input, "characterId", 100);
    if (!eligibleListeners.includes(id) || participants.includes(id) || id === scenario.playerCharacterId) throw new Error("NPC is not an eligible earshot listener.");
    const summary = field(input, "summary", 1200);
    const reactionGoal = input.reactionGoal === null ? null : field(input, "reactionGoal", 500);
    const eventType = name === "record_overheard" ? "overheard" : "witnessed";
    const duplicate = scenario.events.find(event => event.type === eventType && event.day === scenario.world?.day && event.characterIds.includes(id) && event.summary === summary);
    if (duplicate) return { recorded: duplicate.id };
    const event = create(EventSchema, { id: `${eventType}-${crypto.randomUUID()}`, day: scenario.world?.day ?? 0,
      type: eventType, summary, characterIds: [id], visibility: EventVisibility.PRIVATE, details: { reactionGoal } });
    scenario.events.push(event);
    return { recorded: event.id, characterId: id };
  }
  if (name === "message_player") {
    const playerId = scenario.playerCharacterId;
    if (!playerId || !scenario.characters.some(character => character.id === playerId)) throw new Error("No player is available.");
    const message = field(input, "message", 1200);
    const duplicate = scenario.events.find(event => event.type === "player_message" && event.summary === message && event.day === scenario.world?.day && event.characterIds.includes(playerId));
    if (duplicate) return { recorded: duplicate.id };
    const event = create(EventSchema, {
      id: `player-message-${crypto.randomUUID()}`, type: "player_message", summary: message,
      day: scenario.world?.day ?? 0, visibility: EventVisibility.PRIVATE, characterIds: [playerId],
      details: { createdAt: new Date().toISOString() },
    });
    scenario.events.push(event);
    return { recorded: event.id };
  }
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
  if ([...world.objects, ...world.fixtures, ...world.rooms, ...scenario.characters].some(item => item.id === id)) throw new Error("That ID already exists. Use the existing item instead.");
  const fixture = world.fixtures.find(item => item.id === locationId && item.container);
  if (!fixture && !scenario.characters.some(item => item.id === locationId)) throw new Error("Location must be an existing container or character inventory.");
  world.objects.push(create(ObjectStateSchema, { id, name: name_, locationId, concealed: true, properties: { details } }));
  world.revision++;
  return { created: id, name: name_, locationId, details };
}
