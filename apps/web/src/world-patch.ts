import { fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import jsonPatch, { type Operation } from "fast-json-patch";
import { ScenarioSchema, type Scenario } from "../../../packages/contracts/src/index.js";
import type { OpenRouterTool } from "../../../packages/providers/src/openrouter.js";

type JsonObject = Record<string, JsonValue>;

function member(object: JsonObject, key: string): JsonValue {
  const value = object[key];
  if (value === undefined) throw new Error(`world_state is missing ${key}.`);
  return value;
}


export const patchWorldStateTool: OpenRouterTool = {
  type: "function",
  function: {
    name: "patch_world_state",
    description: "Atomically apply an RFC 6902 JSON Patch to mutable world_state. Use this for physical and durable world changes, including creating, transferring, changing or removing items; changing actors, doors, fixtures, rooms or facts; and justified changes to characters, notes or the premise. Paths use the supplied ID-keyed world_state. Use test operations when an exact fact is an explicit precondition. All operations succeed together or none are applied. On state_conflict, reconsider the complete patch using the returned current values. Include a concise reason grounded in the reviewed event or conversation.",
    parameters: {
      type: "object", additionalProperties: false, required: ["patch", "reason"], properties: {
        patch: { type: "array", minItems: 1, maxItems: 40, items: { oneOf: [
          { type: "object", additionalProperties: false, required: ["op", "path", "value"], properties: {
            op: { enum: ["add", "replace", "test"] }, path: { type: "string" }, value: {},
          } },
          { type: "object", additionalProperties: false, required: ["op", "path"], properties: {
            op: { const: "remove" }, path: { type: "string" },
          } },
          { type: "object", additionalProperties: false, required: ["op", "path", "from"], properties: {
            op: { enum: ["move", "copy"] }, path: { type: "string" }, from: { type: "string" },
          } },
        ] } },
        reason: { type: "string", minLength: 1, maxLength: 1000 },
      },
    },
  },
};

function keyed(items: JsonValue[], key: string): JsonObject {
  return Object.fromEntries(items.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item[key] !== "string") throw new Error(`Invalid ${key}`);
    return [item[key], structuredClone(item)];
  }));
}

/** Stable, ID-keyed JSON shown to GM agents. Prompt/configuration and runtime metadata are deliberately absent. */
export function worldPatchState(scenario: Scenario): JsonObject {
  const json = toJson(ScenarioSchema, scenario, { alwaysEmitImplicit: true }) as JsonObject;
  const world = json.world as JsonObject;
  return {
    premise: member(json, "premise"),
    charactersById: keyed(json.characters as JsonValue[], "id"),
    notesById: keyed(json.notes as JsonValue[], "id"),
    world: {
      day: member(world, "day"), phase: member(world, "phase"), facts: structuredClone(member(world, "facts")),
      roomsById: keyed(world.rooms as JsonValue[], "id"),
      actorsById: keyed(world.actors as JsonValue[], "characterId"),
      objectsById: keyed(world.objects as JsonValue[], "id"),
      doorsById: keyed(world.doors as JsonValue[], "id"),
      fixturesById: keyed(world.fixtures as JsonValue[], "id"),
    },
  };
}

const missing = Symbol("missing");

function checkedPointer(path: string): void {
  if (!path.startsWith("/") || path.length > 500) throw new Error("Patch paths must be non-empty JSON Pointers.");
  if (/~(?:[^01]|$)/.test(path)) throw new Error(`Invalid JSON Pointer escape in ${path}`);
  const tokens = path.slice(1).split("/").map(jsonPatch.unescapePathComponent);
  if (tokens.some(token => ["__proto__", "prototype", "constructor"].includes(token))) {
    throw new Error("Unsafe JSON Pointer path.");
  }
}

function pointerValue(document: JsonObject, path: string): JsonValue | typeof missing {
  checkedPointer(path);
  try {
    if (path.endsWith("/-")) {
      const parent = jsonPatch.getValueByPointer(document, path.slice(0, path.lastIndexOf("/")));
      if (Array.isArray(parent)) return parent;
    }
    const value = jsonPatch.getValueByPointer(document, path);
    return value === undefined ? missing : value as JsonValue;
  } catch {
    return missing;
  }
}

/** Canonical JSON is a collision-free content fingerprint for a targeted value. */
function contentHash(value: JsonValue | typeof missing): string {
  if (value === missing) return "missing";
  if (Array.isArray(value)) return `[${value.map(contentHash).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${contentHash(value[key] as JsonValue)}`).join(",")}}`;
  return JSON.stringify(value);
}

function currentValue(value: JsonValue | typeof missing): JsonValue {
  return value === missing ? null : structuredClone(value);
}


function mapValues(value: JsonValue, name: string): JsonValue[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object keyed by ID.`);
  return Object.entries(value).map(([id, item]) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Invalid ${name} entry ${id}.`);
    const identity = name === "actorsById" ? "characterId" : "id";
    if (item[identity] !== id) throw new Error(`${name} key ${id} must match ${identity}.`);
    return item;
  });
}

function scenarioFromWorldPatchState(original: Scenario, document: JsonObject): Scenario {
  if (!document.world || typeof document.world !== "object" || Array.isArray(document.world)) throw new Error("world must be an object.");
  const source = toJson(ScenarioSchema, original, { alwaysEmitImplicit: true }) as JsonObject;
  const oldWorld = source.world as JsonObject, world = document.world as JsonObject;
  const json: JsonObject = {
    ...source,
    premise: member(document, "premise"),
    characters: mapValues(member(document, "charactersById"), "charactersById"),
    notes: mapValues(member(document, "notesById"), "notesById"),
    world: {
      ...oldWorld,
      day: member(world, "day"), phase: member(world, "phase"), facts: member(world, "facts"),
      rooms: mapValues(member(world, "roomsById"), "roomsById"),
      actors: mapValues(member(world, "actorsById"), "actorsById"),
      objects: mapValues(member(world, "objectsById"), "objectsById"),
      doors: mapValues(member(world, "doorsById"), "doorsById"),
      fixtures: mapValues(member(world, "fixturesById"), "fixturesById"),
      revision: Number(oldWorld.revision) + 1,
    },
  };
  const scenario = fromJson(ScenarioSchema, json);
  validateScenario(scenario);
  return scenario;
}

function validateScenario(scenario: Scenario) {
  const world = scenario.world;
  if (!world) throw new Error("The patched scenario must retain a world.");
  const characters = new Set(scenario.characters.map(item => item.id));
  const rooms = new Set(world.rooms.map(item => item.id));
  const fixtures = new Map(world.fixtures.map(item => [item.id, item]));
  const allIds = [...scenario.characters, ...world.rooms, ...world.fixtures, ...world.objects, ...world.doors].map(item => item.id);
  if (allIds.some(id => !id) || new Set(allIds).size !== allIds.length) throw new Error("All world entity IDs must be non-empty and globally unique.");
  for (const actor of world.actors) {
    if (!characters.has(actor.characterId)) throw new Error(`Actor ${actor.characterId} has no character.`);
    if (!rooms.has(actor.roomId) || !rooms.has(actor.homeRoomId)) throw new Error(`Actor ${actor.characterId} references an unknown room.`);
  }
  for (const item of world.objects) {
    const fixture = fixtures.get(item.locationId);
    if (!characters.has(item.locationId) && !fixture?.container) throw new Error(`Item ${item.id} must be in a character or container inventory.`);
  }
  for (const fixture of world.fixtures) if (!rooms.has(fixture.roomId)) throw new Error(`Fixture ${fixture.id} references an unknown room.`);
  for (const door of world.doors) if (door.roomIds.some(id => !rooms.has(id))) throw new Error(`Door ${door.id} references an unknown room.`);
}

function parseOperations(input: Record<string, unknown>): Operation[] {
  if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 1000) throw new Error("A concise patch reason is required.");
  if (!Array.isArray(input.patch) || !input.patch.length || input.patch.length > 40) throw new Error("patch must contain 1–40 operations.");
  return input.patch.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid patch operation.");
    const operation = value as Record<string, unknown>, op = operation.op;
    if (!["add", "remove", "replace", "move", "copy", "test"].includes(String(op)) || typeof operation.path !== "string") throw new Error("Invalid patch operation.");
    const required = op === "move" || op === "copy" ? ["op", "path", "from"]
      : op === "remove" ? ["op", "path"] : ["op", "path", "value"];
    if (Object.keys(operation).some(key => !required.includes(key)) || required.some(key => !(key in operation))) throw new Error("Invalid patch operation fields.");
    checkedPointer(operation.path);
    if ((op === "move" || op === "copy") && typeof operation.from !== "string") throw new Error(`${op} requires a from path.`);
    if (typeof operation.from === "string") checkedPointer(operation.from);
    return operation as unknown as Operation;
  });
}

/** One model session's semantic baseline. No generation/version identifiers cross the tool boundary. */
export class WorldPatchSession {
  #baseline: JsonObject;
  constructor(scenario: Scenario) { this.#baseline = worldPatchState(scenario); }
  state() { return structuredClone(this.#baseline); }

  apply(liveScenario: Scenario, input: Record<string, unknown>) {
    const operations = parseOperations(input);
    const baseline = this.#baseline, live = worldPatchState(liveScenario);
    const paths = new Set(operations.flatMap(operation =>
      "from" in operation ? [operation.path, operation.from] : [operation.path]));
    const current: JsonObject = {};
    for (const path of paths) {
      const observed = pointerValue(baseline, path), latest = pointerValue(live, path);
      if (contentHash(observed) !== contentHash(latest)) current[path] = currentValue(latest);
    }
    if (Object.keys(current).length) {
      this.#baseline = live;
      return { ok: false as const, error: "state_conflict", instruction: "Nothing was written. Reconsider the complete patch using current, then call patch_world_state again.", current };
    }
    const liveCandidate = structuredClone(live);
    let patched: JsonObject;
    try {
      patched = jsonPatch.applyPatch(liveCandidate, structuredClone(operations), true, true, true).newDocument;
    } catch (error) {
      const detail = error instanceof jsonPatch.JsonPatchError
        ? `${error.name}: ${error.message.split("\n")[0]}`
        : error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSON Patch: ${detail}`);
    }
    const scenario = scenarioFromWorldPatchState(liveScenario, patched);
    this.#baseline = worldPatchState(scenario);
    return { ok: true as const, scenario, state: this.state() };
  }
}

export function applyWorldPatch(scenario: Scenario, session: WorldPatchSession, input: Record<string, unknown>) {
  const result = session.apply(scenario, input);
  if (!result.ok) return result;
  Object.assign(scenario, result.scenario);
  return { ok: true as const, world_state: result.state };
}
