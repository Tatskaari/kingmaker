import { foregroundBodies } from "../apps/web/src/background-characters.js";
import { characterId } from "../packages/lore/src/character-id.js";
import { clone, create } from "@bufbuild/protobuf";
import { CharacterSchema, ScenarioSchema, WorldStateSchema as MapSchema } from "../packages/contracts/src/index.js";
import type { WorldState } from "../packages/contracts/src/v2.js";
import { activityGoal, intentContext } from "../packages/lore/src/activity.js";

/** Test-only fixture for consumers of the legacy Scenario runtime. */
export function projectWorld(world: WorldState, observerId = "player") {
  if (!world.map) throw new Error("A physical map is required.");
  const entries = Object.values(world.runtimeCharacters).filter(character => character.characterId !== "player")
    .map(character => ({ id: character.id, path: character.document }));
  if (world.player) entries.push({ id: "player", path: world.player });
  const characters = entries.map(({ id, path }) => {
    const doc = world.docs[path];
    if (!doc) throw new Error(`Missing character document: ${path}`);
    return create(CharacterSchema, { id, name: typeof doc.frontmatter?.name === "string" ? doc.frontmatter.name : id,
      gender: typeof doc.frontmatter?.gender === "string" ? doc.frontmatter.gender : "",
      delegation: typeof doc.frontmatter?.delegation === "string" ? doc.frontmatter.delegation : "",
      ...(typeof doc.frontmatter?.sprite === "number" ? { sprite: doc.frontmatter.sprite } : {}),
      lore: doc.body, currentGoal: id === "player" ? "" : activityGoal(world, id) ?? "", inventory: doc.characterProperties?.inventory, dnd: doc.characterProperties?.dnd });
  });
  const map = clone(MapSchema, world.map);
  map.actors = foregroundBodies(map.actors, map.actors.find(actor => actor.characterId === observerId)?.position);
  return create(ScenarioSchema, { id: world.scenario, world: map,
    characters, playerCharacterId: world.player ? "player" : "" });
}
