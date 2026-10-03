import { characterId } from "../../../packages/lore/src/character-id.js";
import { clone, create } from "@bufbuild/protobuf";
import { CharacterSchema, ScenarioSchema, WorldStateSchema as MapSchema } from "../../../packages/contracts/src/index.js";
import type { WorldState } from "../../../packages/contracts/src/v2.js";
import { foregroundBodies } from "./background-characters.js";
import { activeGoal } from "../../../packages/lore/src/active-goal.js";

/** Disposable adapter for existing palace rules and views. Never a saved authority. */
export function projectWorld(world: WorldState, observerId = "player") {
  if (!world.map) throw new Error("A physical map is required.");
  const paths = [...world.characters, ...(world.player ? [world.player] : [])];
  const characters = paths.map(path => {
    const doc = world.docs[path];
    if (!doc) throw new Error(`Missing character document: ${path}`);
    const id = characterId(path, world);
    return create(CharacterSchema, { id, name: typeof doc.frontmatter?.name === "string" ? doc.frontmatter.name : id,
      gender: typeof doc.frontmatter?.gender === "string" ? doc.frontmatter.gender : "",
      delegation: typeof doc.frontmatter?.delegation === "string" ? doc.frontmatter.delegation : "",
      ...(typeof doc.frontmatter?.sprite === "number" ? { sprite: doc.frontmatter.sprite } : {}),
      lore: doc.body, currentGoal: doc.frontmatter?.background === true ? "" : activeGoal(doc) ?? "", inventory: doc.characterProperties?.inventory, dnd: doc.characterProperties?.dnd });
  });
  const map = clone(MapSchema, world.map);
  map.actors = foregroundBodies(map.actors, map.actors.find(actor => actor.characterId === observerId)?.position);
  return create(ScenarioSchema, { id: world.scenario, world: map,
    characters, playerCharacterId: world.player ? "player" : "" });
}
