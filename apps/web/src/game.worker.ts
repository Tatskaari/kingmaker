/// <reference lib="webworker" />
import "./logging.js";
import { fromJsonString, type JsonValue } from "@bufbuild/protobuf";
import { MapStateSchema } from "../../../packages/contracts/src/index.js";
import type { WorldState } from "../../../packages/contracts/src/v2.js";
import { playableWorld } from "./playable-world.js";
import { startGameWorker } from "./game-worker.js";

const scenarioUrl = new URL("../../../content/palace-map.json", import.meta.url);
const vault = (import.meta as ImportMeta & { glob: (pattern: string, options: object) => Record<string, string> }).glob("../../../lore/**/*.md", { query: "?raw", import: "default", eager: true });
const properties = (import.meta as ImportMeta & { glob: (pattern: string, options: object) => Record<string, string> }).glob("../../../lore/**/properties.json", { query: "?raw", import: "default", eager: true });
const scenarioPromise: Promise<WorldState> = fetch(scenarioUrl).then(async response => {
  if (!response.ok) throw new Error(`Could not load scenario (${response.status})`);
  const markdown = new Map(Object.entries(vault).map(([path, text]) => [path.replace("../../../lore/", ""), text]));
  const sidecars = new Map(Object.entries(properties).map(([path, text]) => [path.replace("../../../lore/", ""), JSON.parse(text) as JsonValue]));
  return playableWorld(fromJsonString(MapStateSchema, await response.text()), markdown, sidecars);
});


startGameWorker(self as DedicatedWorkerGlobalScope, scenarioPromise);
