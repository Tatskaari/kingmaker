import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fromJsonString } from "@bufbuild/protobuf";
import { MapStateSchema } from "../../packages/contracts/src/index.js";
import { playableWorld } from "../../apps/web/src/playable-world.js";
import { loadDocumentLayers } from "../../packages/service-tools/src/layered-docs.js";

/** Shared fresh-game fixture for the console, evals, and integration tests. */
export function loadPlayableWorld(root = resolve(import.meta.dirname, "../.."), overlays: readonly string[] = []) {
  const { markdown, sidecars } = loadDocumentLayers([`${root}/lore`, ...overlays]);
  return playableWorld(fromJsonString(MapStateSchema, readFileSync(`${root}/content/palace-map.json`, "utf8")), markdown, sidecars);
}
