import { create, fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import { clone } from "@bufbuild/protobuf";
import { DndCharacterSchema, WorldStateSchema as MapSchema, type WorldState as PalaceMap } from "../../../packages/contracts/src/index.js";
import { CharacterPropertiesSchema } from "../../../packages/contracts/src/v2.js";
import { worldState } from "../../../packages/lore/src/world-state.js";
import envoySheet from "../../../content/envoy-sheet.json" with { type: "json" };

/** Explicit fresh-game palace baseline; not a saved-game conversion. */
export function playableWorld(baseline: PalaceMap, markdown: ReadonlyMap<string, string>, sidecars: ReadonlyMap<string, JsonValue> = new Map()) {
  const map = clone(MapSchema, baseline);
  const player = "Players/envoy.md";
  const notes = new Map(markdown);
  notes.set(player, "---\nname: Visiting Envoy\nvisibility: private\nreaders:\n  characters: [player]\n---\nYou are a visiting envoy attending the Centennial Assembly.");
  const world = worldState(map, notes, "Centennial Assembly", player);
  for (const path of world.characters) {
    const properties = sidecars.get(path.replace(/character\.md$/, "properties.json"));
    if (properties) world.docs[path]!.characterProperties = fromJson(CharacterPropertiesSchema, properties);
    const heading = /^# (.+?)(?: —|\n|$)/m.exec(world.docs[path]!.body)?.[1];
    if (heading) (world.docs[path]!.frontmatter ??= {}).name = heading;
    const id = /\/Characters\/([^/]+)\//.exec(path)![1]!;
    if (!map.actors.some(actor => actor.characterId === id)) throw new Error(`Missing palace actor for ${id}`);
  }
  world.docs[player]!.characterProperties = create(CharacterPropertiesSchema, { dnd: fromJson(DndCharacterSchema, envoySheet) });
  return world;
}
