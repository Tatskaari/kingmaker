import type { WorldState } from "../../contracts/src/v2.js";
import type { ActorState } from "../../contracts/src/index.js";

export const actorId = (actor: ActorState) => actor.instanceId ?? actor.characterId;

/** Explicit body IDs are stable. A shared identity addresses the nearby interlocutor. */
export function runtimeActor(world: WorldState, id: string): ActorState {
  const exact = world.map?.actors.find(actor => actor.instanceId === id);
  if (exact) return exact;
  const bodies = world.map?.actors.filter(actor => actor.characterId === id) ?? [];
  const player = world.map?.actors.find(actor => actor.characterId === "player")?.position;
  const distance = (actor: ActorState) => player && actor.position
    ? Math.abs(actor.position.x - player.x) + Math.abs(actor.position.y - player.y) : Infinity;
  bodies.sort((a, b) => distance(a) - distance(b));
  if (!bodies[0]) throw new Error(`Unknown runtime character: ${id}`);
  return bodies[0];
}

/** Scene defaults are copied once; restored games already own their runtime intent. */
export function seedActorIntent(actor: ActorState, metadata: Record<string, unknown> = {}) {
  const path = (value: unknown) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string" || !value.endsWith(".md") || value.includes("\\")
      || value.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Expected a vault-relative Markdown path.");
    return value;
  };
  actor.activity = path(metadata.activity);
  actor.wait = path(metadata.wait);
  actor.intentRevision = 0;
}
