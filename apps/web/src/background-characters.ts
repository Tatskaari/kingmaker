import { create } from "@bufbuild/protobuf";
import { ActorStateSchema, type ActorState } from "../../../packages/contracts/src/index.js";
import type { WorldState } from "../../../packages/contracts/src/v2.js";
import { canWalk, pointKey } from "./navigation.js";
import { courtDoorBlockers, courtRoomAt } from "./court-map.js";
import { palaceMap } from "./palace-map.js";

/** A background entry is one reusable mind with several stationary map bodies. */
export function placeBackgroundCharacters(world: WorldState) {
  const map = world.map!;
  const occupied = new Set(map.actors.flatMap(actor => actor.position ? [pointKey(actor.position)] : []));
  const blocked = courtDoorBlockers(map.doors, map.fixtures);
  for (const path of world.characters) {
    const metadata = world.docs[path]!.frontmatter;
    if (metadata?.background !== true) continue;
    const id = /\/Characters\/([^/]+)\/character\.md$/.exec(path)![1]!;
    if (!Array.isArray(metadata.placements) || !metadata.placements.length || map.actors.some(actor => actor.characterId === id)) {
      throw new Error(`Invalid background placements: ${id}`);
    }
    for (const [index, placement] of metadata.placements.entries()) {
      if (!placement || typeof placement !== "object" || Array.isArray(placement)
        || typeof placement.x !== "number" || typeof placement.y !== "number"
        || !Number.isInteger(placement.x) || !Number.isInteger(placement.y)) throw new Error(`Invalid background position: ${id}`);
      const position = { x: placement.x, y: placement.y }, room = courtRoomAt(position);
      if (!room || !canWalk(palaceMap, position, blocked) || occupied.has(pointKey(position))) throw new Error(`Blocked background position: ${id}`);
      occupied.add(pointKey(position));
      map.actors.push(create(ActorStateSchema, { characterId: id, instanceId: `${id}-${index + 1}`,
        position, roomId: room.id, homeRoomId: room.id, awake: true }));
    }
  }
}

/** Existing single-character mechanics use the body nearest the player as the interlocutor.
 * Body IDs remain stable; reordering never moves or merges a physical body. */
export function foregroundBodies(actors: readonly ActorState[], player = actors.find(actor => actor.characterId === "player")?.position): ActorState[] {
  if (!player) return [...actors];
  const distance = (actor: ActorState) => actor.position
    ? Math.abs(actor.position.x - player.x) + Math.abs(actor.position.y - player.y) : Infinity;
  const ordered = [...actors];
  const ids = new Set(actors.filter(actor => actor.instanceId).map(actor => actor.characterId));
  for (const id of ids) {
    const bodies = actors.filter(actor => actor.characterId === id).sort((a, b) => distance(a) - distance(b));
    let index = 0;
    for (let slot = 0; slot < ordered.length; slot++) if (ordered[slot]!.characterId === id) ordered[slot] = bodies[index++]!;
  }
  return ordered;
}
