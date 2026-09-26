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
let npcPlanning: AbortController | undefined;
let npcInteraction: AbortController | undefined;

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
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error("Save transaction aborted")); };
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
  runtime = new BrowserGameRuntime(scenario, apiKey, undefined, () => worker.postMessage({ type: "transcripts_changed" }));
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
  runtime = new BrowserGameRuntime(await scenarioPromise, apiKey, saved.snapshot, () => worker.postMessage({ type: "transcripts_changed" }));
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
  if (type === "cancel_npc") { npcPlanning?.abort(); npcInteraction?.abort(); return {}; }
  if (type === "plan_npc") {
    npcPlanning?.abort();
    const controller = new AbortController(); npcPlanning = controller;
    try { return await requireRuntime().planNpc(String(payload.characterId), Array.isArray(payload.history) ? payload.history.map(String).slice(-24) : [], controller.signal); }
    finally { if (npcPlanning === controller) npcPlanning = undefined; }
  }
  if (type === "finish_npc" || type === "review_npc") {
    const game = requireRuntime(), before = structuredClone(game.snapshot()), savedBefore = activeSave;
    try {
      if (type === "finish_npc") game.finishNpcRun(String(payload.characterId), String(payload.reason) as "complete" | "unable" | "error" | "limit" | "cancelled", String(payload.detail || ""));
      else await game.reviewNpcOutcome(String(payload.characterId), payload.allowNextGoal !== false);
      await persist(); return { state: game.view(), saves: await listSaves() };
    } catch (error) { game.restore(before); activeSave = savedBefore; throw error; }
  }
  if (type === "execute_npc") {
    const game = requireRuntime(), before = structuredClone(game.snapshot()), savedBefore = activeSave;
    const controller = new AbortController(); npcInteraction = controller;
    try {
      const message = String(payload.actionId).startsWith("talk_")
        ? await game.executeNpcTalk(String(payload.characterId), String(payload.actionId), Number(payload.revision), String(payload.goal), controller.signal)
        : game.executeNpcAction(String(payload.characterId), String(payload.actionId), Number(payload.revision), String(payload.goal));
      await persist(); return { message, state: game.view(), saves: await listSaves() };
    } catch (error) { game.restore(before); activeSave = savedBefore; throw error; }
    finally { if (npcInteraction === controller) npcInteraction = undefined; }
  }
  if (type === "reset_world" || type === "reset_characters" || type === "interact_fixture") {
    const game = requireRuntime(), before = structuredClone(game.snapshot()), savedBefore = activeSave;
    let message: string | undefined;
    try {
      if (type === "reset_world") game.resetWorld();
      else if (type === "reset_characters") game.resetCharacters();
      else message = game.interactFixture(String(payload.actionId || ""));
      await persist();
    } catch (error) { game.restore(before); activeSave = savedBefore; throw error; }
    return { state: game.view(), saves: await listSaves(), message };
  }
  if (type === "set_door") {
    if (typeof payload.open !== "boolean") throw new Error("Door state must be open or closed.");
    const game = requireRuntime(), before = structuredClone(game.snapshot());
    try { game.setDoor(String(payload.id), payload.open); await persist(); }
    catch (error) { game.restore(before); throw error; }
    return { state: game.view(), saves: await listSaves() };
  }
  if (type === "move_player") {
    const game = requireRuntime(), before = structuredClone(game.snapshot());
    try { game.movePlayer({ x: Number(payload.x), y: Number(payload.y) }); await persist(); }
    catch (error) { game.restore(before); throw error; }
    return { state: game.view(), saves: await listSaves() };
  }
  if (type === "talk") {
    const reply = await requireRuntime().talkToCharacter(String(payload.characterId || ""), String(payload.message || ""));
    await persist();
    return { reply, state: requireRuntime().view(), saves: await listSaves(), activeSaveId: activeSave?.id };
  }
  if (type === "end_conversation") {
    const game = requireRuntime();
    const before = structuredClone(game.snapshot());
    const savedBefore = activeSave;
    try {
      await game.endConversation(String(payload.characterId || ""));
      await persist();
    } catch (error) {
      game.restore(before);
      activeSave = savedBefore;
      throw error;
    }
    return { state: game.view(), saves: await listSaves(), activeSaveId: activeSave?.id };
  }
  if (type === "reset") {
    requireRuntime().reset();
    if (activeSave) { activeSave.characterName = "New emissary"; activeSave.normalizedName = "new emissary"; }
    await persist();
    return { state: requireRuntime().view(), saves: await listSaves(), activeSaveId: activeSave?.id };
  }
  if (type === "debug_transcripts") return { transcripts: requireRuntime().recentTranscripts() };
  if (type === "debug_gm") return requireRuntime().debugGameMaster();
  if (type === "debug") return requireRuntime().debug();
  if (type === "debug_character") return requireRuntime().debugCharacter(String(payload.characterId || ""));
  throw new Error(`Unknown worker request: ${type}`);
}

// Keep state changes and their saves in order, including while a model is running.
let requests = Promise.resolve();
worker.addEventListener("message", event => {
  const request = event.data as WorkerRequest;
  const process = async () => {
    try {
      const value = await handle(request.type, request.payload || {});
      worker.postMessage({ id: request.id, ok: true, value });
    } catch (error) {
      worker.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  // Decisions operate on a snapshot and never mutate the game. Keep cancellation
  // responsive while the network request runs; execution still uses the save queue.
  if (request.type === "plan_npc" || request.type === "cancel_npc" || request.type === "debug_transcripts") void process();
  else requests = requests.then(process);
});
