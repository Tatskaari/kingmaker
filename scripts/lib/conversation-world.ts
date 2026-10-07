import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { create, fromJson } from "@bufbuild/protobuf";
import { MapStateSchema as MapSchema } from "../../packages/contracts/src/index.js";
import { CharacterPropertiesSchema } from "../../packages/contracts/src/v2.js";
import { worldState } from "../../packages/lore/src/world-state.js";
import { readVault } from "./lore-access.js";

/** Fresh CLI world; all narrative context comes from Markdown, with optional typed mechanics. */
export function loadConversationWorld(root: string, scenario: string, player?: string) {
  const markdown = new Map([...readVault(root).keys()].map(path => [path, readFileSync(join(root, path), "utf8")]));
  const state = worldState(create(MapSchema), markdown, scenario, player);
  for (const entry of new Set([...state.characters, ...(state.player ? [state.player] : [])])) {
    const path = join(root, dirname(entry), "properties.json");
    if (existsSync(path)) for (const actor of Object.values(state.simulation!.runtimeCharacters).filter(actor => actor.document === entry)) {
      const properties = fromJson(CharacterPropertiesSchema, JSON.parse(readFileSync(path, "utf8")));
      actor.dnd = properties.dnd; actor.inventory = properties.inventory;
    }
  }
  return state;
}
