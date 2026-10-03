import { clone, create } from "@bufbuild/protobuf";
import { CharacterSchema, ScenarioSchema, WorldStateSchema as MapSchema } from "../../../packages/contracts/src/index.js";
import type { WorldState } from "../../../packages/contracts/src/v2.js";
import { activeGoal } from "../../../packages/lore/src/active-goal.js";

export function characterId(path: string, world: WorldState): string {
  if (path === world.player) return "player";
  const id = /\/Characters\/([^/]+)\/character\.md$/.exec(path)?.[1];
  if (!id) throw new Error(`Invalid character entry: ${path}`);
  return id;
}
/** Disposable adapter for existing palace rules and views. Never a saved authority. */
export function projectWorld(world: WorldState) {
  if (!world.map) throw new Error("A physical map is required.");
  const paths = [...world.characters, ...(world.player ? [world.player] : [])];
  const characters = paths.map(path => {
    const doc = world.docs[path];
    if (!doc) throw new Error(`Missing character document: ${path}`);
    const id = characterId(path, world);
    return create(CharacterSchema, { id, name: typeof doc.frontmatter?.name === "string" ? doc.frontmatter.name : id,
      currentGoal: activeGoal(doc) ?? "", inventory: doc.characterProperties?.inventory, dnd: doc.characterProperties?.dnd });
  });
  return create(ScenarioSchema, { id: world.scenario, world: clone(MapSchema, world.map),
    characters, playerCharacterId: world.player ? "player" : "" });
}
