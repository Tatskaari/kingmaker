import type { Scenario } from "../../../packages/contracts/src/index.js";
import { characterDecisionContext, worldForCharacter } from "../../../packages/core/src/context.js";
import { fixtureActions, fixtureName } from "../../../packages/core/src/fixtures.js";
import { doorActionLegality } from "../../../packages/core/src/access.js";
import { courtPath, courtRoomAt, courtInteractionPoint } from "./court-map.js";
import { palaceNodes } from "./palace-navigation.js";
import type { Point } from "./navigation.js";

export interface CourtAgentAction {
  id: string; type: "move" | "door" | "fixture" | "talk"; target: string;
  description: string; path: Point[]; interactionRoomId?: string; open?: boolean; legality?: "normal" | "illegal";
}

export function actionResourceIds(scenario: Scenario, characterId: string, action?: CourtAgentAction): string[] {
  const keys = ["world:context", `character:${characterId}`, `actor:${characterId}`, `inventory:${characterId}`,
    ...(scenario.world?.doors.map(door => `door:${door.id}`) ?? [])];
  if (action?.type === "talk") keys.push(`character:${action.target}`, `actor:${action.target}`);
  if (action?.type === "door") keys.push(`doorway:${action.target}`);
  if (action?.type === "fixture") {
    const fixtureAction = fixtureActions(scenario, characterId).find(item => item.id === action.id);
    if (action.target !== characterId) keys.push(`fixture:${action.target}`, `inventory:${action.target}`);
    if (fixtureAction?.itemId) keys.push(`item:${fixtureAction.itemId}`);
  }
  return [...new Set(keys)];
}

export function courtAgentObservation(scenario: Scenario, characterId: string) {
  const character = scenario.characters.find(item => item.id === characterId);
  const world = scenario.world, actor = world?.actors.find(item => item.characterId === characterId);
  if (!character || !world || !actor?.position || characterId === scenario.playerCharacterId) throw new Error("NPC is not placed in the palace.");
  const start = actor.position;
  const pathTo = (point: Point) => courtPath(start, point, world.doors, world.fixtures);
  const actions: CourtAgentAction[] = [];
  for (const node of palaceNodes) {
    const path = pathTo(node);
    if (path && path.length > 1) actions.push({ id: `move_${node.id}`, type: "move", target: node.id, path,
      description: `Walk to ${node.name} in ${courtRoomAt(node)?.name ?? "the palace"} (${path.length - 1} steps).` });
  }
  for (const door of world.doors) for (const [side, spot] of door.interactionSpots.entries()) {
    const path = pathTo(spot);
    if (!path) continue;
    const interactionRoom = courtRoomAt(spot);
    actions.push({ id: `${door.open ? "close" : "open"}_${door.id}_${side}`, type: "door", target: door.id, path, open: !door.open,
      ...(interactionRoom ? { interactionRoomId: interactionRoom.id } : {}),
      legality: doorActionLegality(door, world.rooms, characterId),
      description: `Walk ${path.length - 1} steps to the ${interactionRoom?.name ?? "palace"} side, then ${door.open ? "close" : "open"} ${door.name}, connecting ${door.roomIds.join(" and ")}. You finish on the ${interactionRoom?.name ?? "palace"} side of the door.` });
  }
  for (const action of fixtureActions(scenario, characterId)) {
    if (action.target === characterId) {
      actions.push({ id: action.id, target: action.target, type: "fixture", path: [start], legality: "normal", description: action.label });
      continue;
    }
    const fixture = world.fixtures.find(item => item.id === action.target)!;
    if (fixture.roomId !== actor.roomId || !fixture.position) continue;
    if (action.verb === "open" && fixture.requiredKeyId && !world.objects.some(item => item.id === fixture.requiredKeyId && item.locationId === characterId)) continue;
    const spot = courtInteractionPoint(start, fixture.position, fixture.interactionSpot, world.doors, world.fixtures);
    const path = spot && pathTo(spot);
    if (path) actions.push({ id: action.id, target: action.target, type: "fixture", path, legality: action.legality,
      description: `Walk ${path.length - 1} steps to the interaction spot, then ${action.label}.` });
  }
  for (const other of world.actors) {
    if (other.characterId === characterId || !other.awake || !other.position) continue;
    const target = scenario.characters.find(item => item.id === other.characterId);
    if (!target) continue;
    const position = other.position;
    const paths = [{ x: position.x - 1, y: position.y }, { x: position.x + 1, y: position.y },
      { x: position.x, y: position.y - 1 }, { x: position.x, y: position.y + 1 }]
      .filter(point => courtRoomAt(point)?.id === other.roomId)
      .map(pathTo).filter((path): path is Point[] => !!path).sort((a, b) => a.length - b.length);
    const path = paths[0];
    if (path) actions.push({ id: `talk_${other.characterId}`, type: "talk", target: other.characterId, path,
      description: `Walk ${path.length - 1} steps to ${target.name} and initiate a conversation about your immediate goal. They may agree, refuse, or propose conditions; talking cannot transfer items or move them.` });
  }
  const known = worldForCharacter(world, characterId);
  return {
    revision: world.revision, goal: character.currentGoal, characterContext: characterDecisionContext(scenario, characterId, character.currentGoal),
    world: {
      location: { roomId: actor.roomId, room: world.rooms.find(room => room.id === actor.roomId)?.name, position: start },
      rooms: world.rooms.map(({ id, name }) => ({ id, name })),
      doors: world.doors.map(({ id, name, roomIds, open }) => ({ id, name, roomIds, open })),
      nearbyCharacters: world.actors.filter(other => other.roomId === actor.roomId).map(({ characterId, position }) => ({ characterId, position })),
      inventory: known.objects.filter(item => item.locationId === characterId).map(({ id, name }) => ({ id, name })),
      furniture: known.fixtures.filter(item => item.roomId === actor.roomId).map(item => ({ id: item.id, name: fixtureName(item, characterId),
        open: item.open, ...(item.requiredKeyId ? { requiredKeyId: item.requiredKeyId } : {}),
        ...(item.open || item.searchedBy.includes(characterId) ? { contents: known.objects.filter(object => object.locationId === item.id).map(({ id, name }) => ({ id, name })) } : { contents: "Unknown until opened" }),
      })),
    },
    actions,
  };
}
