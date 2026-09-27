/// <reference lib="webworker" />

import { type TravellerIdentity } from "./introduction.js";

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
let generation = 0;

// Network waits never hold this queue; only validated mutations and saves do.
let requests: Promise<unknown> = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = requests.then(work); requests = result.catch(() => {}); return result;
}
let background: { id: string; controller: AbortController; participants: string[] } | undefined;
const pendingNpcs: Array<{ id: string; handoffs: number }> = [];
const conversationHolds = new Set<string>();
const conversationReviews = new Set<string>();

function publishNpc(status: string, trace?: unknown) {
  if (runtime) worker.postMessage({ type: "npc_update", state: runtime.view(), activeSaveId: activeSave?.id,
    running: background?.id ?? null, status, ...(trace ? { trace } : {}) });
}
function stopBackground(characterId?: string) {
  if (!characterId || background?.participants.includes(characterId)) {
    background?.controller.abort(); background = undefined;
  }
  for (let i = pendingNpcs.length - 1; i >= 0; i--) if (!characterId || pendingNpcs[i]!.id === characterId) pendingNpcs.splice(i, 1);
}
async function commitMutation<T>(game: BrowserGameRuntime, work: () => T): Promise<T> {
  return enqueue(async () => {
    if (runtime !== game) throw new Error("Game changed.");
    const before = game.snapshot(), saveBefore = activeSave;
    try { const result = work(); await persist(); return result; }
    catch (error) { game.restore(before); activeSave = saveBefore; throw error; }
  });
}
async function reviewBackground(game: BrowserGameRuntime, id: string, signal: AbortSignal, allowNextGoal: boolean) {
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    const before = game.snapshot(), fork = game.forkForNpc();
    await fork.reviewNpcOutcome(id, allowNextGoal, signal);
    try { await commitMutation(game, () => { signal.throwIfAborted(); game.commitCharacterFork(before, fork, [id]); }); return; }
    catch (error) { if (attempt === 2 || signal.aborted || runtime !== game) throw error; }
  }
}
function startBackground(id: string, handoffs = 3) {
  if (conversationHolds.has(id) || background?.id === id || pendingNpcs.some(item => item.id === id)) return;
  pendingNpcs.push({ id, handoffs });
  if (!background) void drainBackground();
}
async function drainBackground() {
  if (background) return;
  const next = pendingNpcs.shift(); if (!next || !runtime) return;
  const game = runtime, { id, handoffs } = next;
  const job = { id, controller: new AbortController(), participants: [id] }; background = job;
  const signal = job.controller.signal;
  let finalStatus = `${id}: idle.`;
  const valid = () => !signal.aborted && runtime === game && background === job && !conversationHolds.has(id);
  try {
    for (let round = 0; round < 3 && valid(); round++) {
      if (game.snapshot().npcActivities?.[id]?.reviewPending) await reviewBackground(game, id, signal, round < 2);
      if (game.snapshot().npcActivities?.[id]?.status !== "active") break;
      let reason: "complete" | "unable" | "limit" = "limit", detail = "Reached the 24-action limit.";
      for (let step = 0; step < 24 && valid(); step++) {
        publishNpc(`${id}: choosing an action…`);
        const plan = await game.planNpc(id, signal);
        if (!valid()) return;
        publishNpc(`${id}: ${plan.action?.description ?? plan.decision.choice}`, plan);
        if (plan.decision.choice === "complete" || plan.decision.choice === "unable") {
          // A changed world invalidates a terminal judgment as well as a physical action.
          if (game.view().revision !== plan.revision) continue;
          reason = plan.decision.choice; detail = JSON.stringify(plan.decision); break;
        }
        if (!plan.action) throw new Error("Jev returned an unavailable action.");
        let result: { done: boolean; talkTarget?: string } | undefined;
        try {
          while (valid()) {
            result = await commitMutation(game, () => { signal.throwIfAborted(); return game.stepNpcAction(id, plan.action!.id, plan.goal); });
            if (!valid()) return;
            publishNpc(`${id}: ${plan.action.description}`);
            if (result.done) break;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (error) {
          if (!valid()) return;
          // Doors, targets or goals may have changed while the player acted. Replan.
          if (/replan|changed|doorway/i.test(String(error))) continue;
          throw error;
        }
        if (!valid()) return;
        if (result?.talkTarget) {
          const target = result.talkTarget;
          if (conversationHolds.has(target)) continue;
          job.participants = [id, target];
          const before = game.snapshot(), fork = game.forkForNpc();
          await fork.executeNpcTalk(id, plan.action.id, Number(game.view().revision), plan.goal, signal);
          try { await commitMutation(game, () => { signal.throwIfAborted(); game.commitCharacterFork(before, fork, [id, target]); }); }
          catch (error) { if (!valid()) return; if (/changed/i.test(String(error))) continue; throw error; }
          finally { job.participants = [id]; }
          if (handoffs > 0) for (const listener of game.rumourListenersSince(before)) startBackground(listener, handoffs - 1);
          if (handoffs > 0 && game.snapshot().npcActivities?.[target]?.status === "active") startBackground(target, handoffs - 1);
          if (game.snapshot().npcActivities?.[id]?.status !== "active") return;
        }
      }
      if (!valid()) return;
      await commitMutation(game, () => { signal.throwIfAborted(); game.finishNpcRun(id, reason, detail); });
      publishNpc(`${id}: reviewing the result…`);
      await reviewBackground(game, id, signal, round < 2);
    }
  } catch (error) {
    if (valid()) {
      if (game.snapshot().npcActivities?.[id]?.status === "active") await commitMutation(game, () => { signal.throwIfAborted(); game.finishNpcRun(id, "error", String(error)); }).catch(() => {});
      finalStatus = `${id}: ${error instanceof Error ? error.message : String(error)}`;
    }
  } finally {
    if (background === job) { background = undefined; publishNpc(finalStatus); void drainBackground(); }
  }
}

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
  const identity = view.travellerIdentity as TravellerIdentity | null;
  const characterName = player?.name || identity?.name || activeSave.characterName;
  const now = new Date().toISOString();
  activeSave = {
    ...activeSave,
    characterName,
    normalizedName: characterName.trim().toLocaleLowerCase(),
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

async function createDevelopmentGame(): Promise<Record<string, unknown>> {
  await createGame();
  runtime!.createDevelopmentPlayer();
  await persist();
  return { state: runtime!.view(), activeSaveId: activeSave!.id, saves: await listSaves() };
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
  if (["configure", "create_game", "create_development_game", "load_game", "delete_game", "reset", "reset_world", "reset_characters"].includes(type)) {
    generation++; stopBackground(); conversationHolds.clear();
  }
  const reviewKey = `${generation}:${String(payload.characterId || "")}`;
  if (["start_npc", "pause_npc", "talk", "end_conversation"].includes(type) && conversationReviews.has(reviewKey)) {
    throw new Error("This character is still reviewing the conversation. Try again when the review finishes.");
  }
  if (type === "start_npc") { const id = String(payload.characterId); conversationHolds.delete(id); startBackground(id); return {}; }
  if (type === "pause_npc") { const id = String(payload.characterId); conversationHolds.add(id); stopBackground(id); publishNpc(`${id}: talking to you.`); void drainBackground(); return {}; }
  if (type === "configure") {
    apiKey = String(payload.apiKey || "").trim();
    if (!apiKey) throw new Error("Enter an OpenRouter key first");
    runtime = undefined;
    activeSave = undefined;
    return { saves: await listSaves() };
  }
  if (type === "list_saves") return { saves: await listSaves() };
  if (type === "create_game") return createGame();
  if (type === "create_development_game") return createDevelopmentGame();
  if (type === "load_game") return loadGame(String(payload.saveId || ""));
  if (type === "delete_game") {
    const saveId = String(payload.saveId || "");
    await transaction("readwrite", store => store.delete(saveId));
    if (activeSave?.id === saveId) { activeSave = undefined; runtime = undefined; }
    return { saves: await listSaves() };
  }
  if (type === "state") return { state: requireRuntime().view(), activeSaveId: activeSave?.id };
  if (type === "set_identity") {
    const game = requireRuntime();
    // This handler already runs inside the mutation queue. Enqueuing another
    // mutation here would make the request wait on itself forever.
    const before = game.snapshot(), saveBefore = activeSave;
    try {
      game.setTravellerIdentity(payload.identity as TravellerIdentity);
      await persist();
    } catch (error) {
      game.restore(before); activeSave = saveBefore;
      throw error;
    }
    return { state: game.view(), saves: await listSaves() };
  }
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
  if (type === "cancel_npc") { stopBackground(); publishNpc("NPC activity paused."); return {}; }
  if (type === "reset_world" || type === "reset_characters" || type === "interact_fixture") {
    const game = requireRuntime(), before = structuredClone(game.snapshot()), savedBefore = activeSave;
    let message: string | undefined;
    try {
      if (type === "reset_world") game.resetWorld();
      else if (type === "reset_characters") game.resetCharacters();
      else message = await game.interactFixtureWithWitnesses(String(payload.actionId || ""));
      await persist();
    } catch (error) { game.restore(before); activeSave = savedBefore; throw error; }
    if (type === "interact_fixture") for (const listener of game.rumourListenersSince(before)) startBackground(listener);
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
  if (type === "talk" || type === "end_conversation") {
    if (type === "end_conversation") conversationReviews.add(reviewKey);
    try {
      const game = requireRuntime(), id = String(payload.characterId || "");
      conversationHolds.add(id); stopBackground(id);
      const version = generation;
      const { before, fork } = await enqueue(async () => ({ before: game.snapshot(), fork: game.forkForNpc() }));
      const reply = type === "talk" ? await fork.talkToCharacter(id, String(payload.message || "")) : await fork.endConversation(id);
      await commitMutation(game, () => {
        if (generation !== version) throw new Error("Game changed.");
        game.commitCharacterFork(before, fork, [id]);
      });
      if (type === "end_conversation") {
        conversationHolds.delete(id);
        for (const listener of game.rumourListenersSince(before)) startBackground(listener);
      }
      return { reply, state: game.view(), saves: await listSaves(), activeSaveId: activeSave?.id };
    } finally { if (type === "end_conversation") conversationReviews.delete(reviewKey); }
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
  // Background work and dialogue wait outside the mutation queue. Their results
  // rejoin it only to validate, merge and save, keeping player commands responsive.
  if (request.type === "cancel_npc" || request.type === "debug_transcripts" || request.type === "start_npc" || request.type === "pause_npc" || request.type === "talk" || request.type === "end_conversation") void process();
  else void enqueue(process);
});
