/// <reference lib="webworker" />

import { fromJsonString, type JsonValue } from "@bufbuild/protobuf";
import { ScenarioSchema, type Scenario } from "../../../packages/contracts/src/index.js";
import { BrowserGameRuntime, type RuntimeSnapshot } from "./runtime.js";

interface SaveRecord {
  id: string;
  characterName: string;
  normalizedName: string;
  createdAt: string;
  updatedAt: string;
  snapshot: RuntimeSnapshot;
}

interface WorkerRequest {
  id: number;
  type: string;
  payload?: Record<string, unknown>;
}

const worker = self as DedicatedWorkerGlobalScope;
const scenarioUrl = new URL("../../../content/scenarios/last-night.json", import.meta.url);
const scenarioPromise: Promise<Scenario> = fetch(scenarioUrl).then(async response => {
  if (!response.ok) throw new Error(`Could not load scenario (${response.status})`);
  return fromJsonString(ScenarioSchema, await response.text());
});

let apiKey = "";
let runtime: BrowserGameRuntime | undefined;
let activeSave: SaveRecord | undefined;

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("kingmaker", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("games", { keyPath: "id" });
      store.createIndex("characterName", "normalizedName", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("games", mode);
    const request = action(tx.objectStore("games"));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}

async function listSaves(): Promise<Array<Omit<SaveRecord, "snapshot" | "normalizedName">>> {
  const records = await transaction<SaveRecord[]>("readonly", store => store.getAll());
  return records
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(({ id, characterName, createdAt, updatedAt }) => ({ id, characterName, createdAt, updatedAt }));
}

async function persist(): Promise<void> {
  if (!runtime || !activeSave) return;
  const view = runtime.view();
  const player = view.player as { name?: string } | null;
  const now = new Date().toISOString();
  activeSave = {
    ...activeSave,
    characterName: player?.name || activeSave.characterName,
    normalizedName: (player?.name || activeSave.characterName).trim().toLocaleLowerCase(),
    updatedAt: now,
    snapshot: runtime.snapshot(),
  };
  await transaction("readwrite", store => store.put(activeSave!));
}

async function createGame(): Promise<Record<string, unknown>> {
  if (!apiKey) throw new Error("Enter an OpenRouter key first");
  const scenario = await scenarioPromise;
  const now = new Date().toISOString();
  runtime = new BrowserGameRuntime(scenario, apiKey);
  activeSave = {
    id: crypto.randomUUID(),
    characterName: "New emissary",
    normalizedName: "new emissary",
    createdAt: now,
    updatedAt: now,
    snapshot: runtime.snapshot(),
  };
  await persist();
  return { state: runtime.view(), activeSaveId: activeSave.id, saves: await listSaves() };
}

async function loadGame(saveId: string): Promise<Record<string, unknown>> {
  if (!apiKey) throw new Error("Enter an OpenRouter key first");
  const saved = await transaction<SaveRecord | undefined>("readonly", store => store.get(saveId));
  if (!saved) throw new Error("That saved game no longer exists");
  runtime = new BrowserGameRuntime(await scenarioPromise, apiKey, saved.snapshot);
  activeSave = saved;
  return { state: runtime.view(), activeSaveId: saved.id, saves: await listSaves() };
}

function requireRuntime(): BrowserGameRuntime {
  if (!runtime) throw new Error("Choose or create a game first");
  return runtime;
}

async function handle(type: string, payload: Record<string, unknown>): Promise<unknown> {
  if (type === "configure") {
    apiKey = String(payload.apiKey || "").trim();
    if (!apiKey) throw new Error("Enter an OpenRouter key first");
    runtime = undefined;
    activeSave = undefined;
    return { saves: await listSaves() };
  }
  if (type === "list_saves") return { saves: await listSaves() };
  if (type === "create_game") return createGame();
  if (type === "load_game") return loadGame(String(payload.saveId || ""));
  if (type === "delete_game") {
    const saveId = String(payload.saveId || "");
    await transaction("readwrite", store => store.delete(saveId));
    if (activeSave?.id === saveId) { activeSave = undefined; runtime = undefined; }
    return { saves: await listSaves() };
  }
  if (type === "state") return { state: requireRuntime().view(), activeSaveId: activeSave?.id };
  if (type === "gm") {
    const reply = await requireRuntime().talkToGameMaster(String(payload.message || ""));
    await persist();
    return { reply, state: requireRuntime().view(), saves: await listSaves(), activeSaveId: activeSave?.id };
  }
  if (type === "save_character") {
    const game = requireRuntime();
    const before = structuredClone(game.snapshot());
    try {
      game.confirmPlayer(payload.draft as JsonValue);
      await persist();
    } catch (error) {
      game.restore(before);
      throw error;
    }
    return { state: game.view(), saves: await listSaves() };
  }
  if (type === "talk") {
    const reply = await requireRuntime().talkToCharacter(String(payload.characterId || ""), String(payload.message || ""));
    await persist();
    return { reply, state: requireRuntime().view(), saves: await listSaves(), activeSaveId: activeSave?.id };
  }
  if (type === "reset") {
    requireRuntime().reset();
    if (activeSave) { activeSave.characterName = "New emissary"; activeSave.normalizedName = "new emissary"; }
    await persist();
    return { state: requireRuntime().view(), saves: await listSaves(), activeSaveId: activeSave?.id };
  }
  if (type === "debug_gm") return requireRuntime().debugGameMaster();
  if (type === "debug") return requireRuntime().debug();
  if (type === "debug_character") return requireRuntime().debugCharacter(String(payload.characterId || ""));
  throw new Error(`Unknown worker request: ${type}`);
}

worker.addEventListener("message", async event => {
  const request = event.data as WorkerRequest;
  try {
    const value = await handle(request.type, request.payload || {});
    worker.postMessage({ id: request.id, ok: true, value });
  } catch (error) {
    worker.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
