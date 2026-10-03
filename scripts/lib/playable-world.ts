import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fromJsonString } from "@bufbuild/protobuf";
import { WorldStateSchema } from "../../packages/contracts/src/index.js";
import { playableWorld } from "../../apps/web/src/playable-world.js";
import { readVault } from "./lore-access.js";

/** Shared fresh-game fixture for the console, evals, and integration tests. */
export function loadPlayableWorld(root = resolve(import.meta.dirname, "../..")) {
  const markdown = new Map([...readVault(`${root}/lore`).keys()].map(path => [path, readFileSync(`${root}/lore/${path}`, "utf8")]));
  const sidecars = new Map([...markdown.keys()].filter(path => path.endsWith("/character.md")).flatMap(path => {
    const file = path.replace(/character\.md$/, "properties.json");
    return existsSync(`${root}/lore/${file}`) ? [[file, JSON.parse(readFileSync(`${root}/lore/${file}`, "utf8"))] as const] : [];
  }));
  return playableWorld(fromJsonString(WorldStateSchema, readFileSync(`${root}/content/palace-map.json`, "utf8")), markdown, sidecars);
}
