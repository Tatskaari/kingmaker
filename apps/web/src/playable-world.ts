import { parseConversationTree } from "../../../packages/lore/src/conversation-tree.js";
import { palaceMap } from "./palace-map.js";
import { seedPresentation, presentationPath } from "../../../packages/lore/src/presentation.js";
import { create, fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import { clone } from "@bufbuild/protobuf";
import { GamePhase, DndCharacterSchema, WorldMapSchema, MapStateSchema as MapSchema, type MapState as PalaceMap } from "../../../packages/contracts/src/index.js";
import { CharacterPropertiesSchema, QuestStateSchema, WorldStateSchema, type WorldState } from "../../../packages/contracts/src/v2.js";
import { grantGuardAccess } from "./guard-duty.js";
import { placeBackgroundCharacters } from "./background-characters.js";
import { worldState, refreshDocumentGraph } from "../../../packages/lore/src/world-state.js";
import envoySheet from "../../../content/envoy-sheet.json" with { type: "json" };

/** Explicit fresh-game palace baseline; not a saved-game conversion. */
export function playableWorld(baseline: PalaceMap, markdown: ReadonlyMap<string, string>, sidecars: ReadonlyMap<string, JsonValue> = new Map(), conversationTrees: readonly string[] = []) {
  const map = clone(MapSchema, baseline);
  map.layout = clone(WorldMapSchema, baseline.layout ?? palaceMap);
  const player = "Players/envoy.md";
  const notes = new Map(markdown);
  notes.set(player, "---\nname: Visiting Envoy\nvisibility: private\nsummary: A visiting envoy attending the Centennial Assembly.\nreaders: [\"character:player\"]\n---\nYou are a visiting envoy attending the Centennial Assembly.");
  const trees = conversationTrees.map(source => ({ source, tree: parseConversationTree(source) }));
  for (const { source, tree } of trees) notes.set(`Conversations/${tree.characterId}.md`, source);
  const world = worldState(map, notes, "Centennial Assembly", player);
  for (const { tree } of trees) {
    if (world.quests[tree.quest.id]) throw new Error(`Duplicate conversation tree: ${tree.quest.id}`);
    world.quests[tree.quest.id] = create(QuestStateSchema, { quest: tree.quest, currentStageId: tree.quest.initialStageId });
  }
  placeBackgroundCharacters(world);
  for (const path of world.characters) {
    const properties = sidecars.get(path.replace(/character\.md$/, "properties.json"));
    if (properties) for (const actor of Object.values(world.simulation!.runtimeCharacters).filter(actor => actor.document === path)) {
      const authored = fromJson(CharacterPropertiesSchema, properties);
      actor.dnd = authored.dnd; actor.inventory = authored.inventory;
    }
    const heading = /^# (.+?)(?: —|\n|$)/m.exec(world.docs[path]!.body)?.[1];
    if (heading) (world.docs[path]!.frontmatter ??= {}).name = heading;
    const id = /\/Characters\/([^/]+)\//.exec(path)![1]!;
    if (!world.simulation!.map!.actors.some(actor => actor.characterId === id || world.simulation!.runtimeCharacters[actor.characterId]?.characterId === id)) throw new Error(`Missing palace actor for ${id}`);
  }
  world.simulation!.runtimeCharacters.player!.dnd = fromJson(DndCharacterSchema, envoySheet);
  for (const path of [...world.characters, player]) seedPresentation(world, path);
  grantGuardAccess(world);
  return refreshDocumentGraph(world);
}

/** A normal fresh game starts before the interview; the development envoy remains an explicit shortcut. */
export function characterCreationWorld(baseline: WorldState): WorldState {
  const world = clone(WorldStateSchema, baseline);
  if (world.player) {
    delete world.docs[presentationPath(world.player)];
    delete world.docs[world.player];
  }
  delete world.simulation!.runtimeCharacters.player;
  delete world.player;
  world.simulation!.map!.phase = GamePhase.PLAYER_CREATION;
  world.simulation!.map!.day = 0;
  return world;
}
