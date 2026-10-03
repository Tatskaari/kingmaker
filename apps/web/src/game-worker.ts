/// <reference lib="webworker" />
import { type TravellerIdentity } from "./introduction.js";
import { type JsonValue } from "@bufbuild/protobuf";
import { type Event } from "../../../packages/contracts/src/index.js";
import type { WorldState } from "../../../packages/contracts/src/v2.js";
import { WorldGameRuntime as BrowserGameRuntime, type WorldSnapshot as RuntimeSnapshot } from "./world-runtime.js";
import { GenerationConflict, generationIds, type ExpectedGenerations } from "../../../packages/core/src/generations.js";

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


/** Injectable worker host: tests and browser run the same queue and persistence code. */
export function startGameWorker(worker: DedicatedWorkerGlobalScope, scenarioPromise: Promise<WorldState>) {
let apiKey = "";
let runtime: BrowserGameRuntime | undefined;
let activeSave: SaveRecord | undefined;
let generation = 0;

// Network waits never hold this queue; only validated mutations and saves do.
let requests: Promise<unknown> = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = requests.then(work); requests = result.catch(() => {}); return result;
}
const background = new Map<string, { id: string; controller: AbortController; participants: string[] }>();
const worldEvents = new Set<AbortController>();
const pendingNpcs: Array<{ id: string; handoffs: number }> = [];
const conversationHolds = new Set<string>();
const conversationReviews = new Set<string>();
const pendingDice = new Map<string, { requestId: number; resolve: () => void; reject: (error: Error) => void }>();

function alertUser(level: "warning" | "error", message: string) {
  const safe = (apiKey ? message.split(apiKey).join("[redacted]") : message).replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted]");
  worker.postMessage({ type: "alert", level, message: safe.slice(0, 2000) });
}
const providerWarning = (message: string) => alertUser("warning", message);

function publishNpc(status: string, trace?: unknown, initiatedConversation?: string) {
  if (runtime) worker.postMessage({ type: "npc_update", state: runtime.view(), activeSaveId: activeSave?.id,
    running: [...new Set([...background.values()].flatMap(job => job.participants))], status, ...(trace ? { trace } : {}), ...(initiatedConversation ? { initiatedConversation } : {}) });
}
function stopBackground(characterId?: string) {
  for (const [id, job] of background) {
    if (!characterId || job.participants.includes(characterId)) {
      job.controller.abort(); background.delete(id);
    }
  }
  for (let i = pendingNpcs.length - 1; i >= 0; i--) if (!characterId || pendingNpcs[i]!.id === characterId) pendingNpcs.splice(i, 1);
}
function stopWorldEvents() {
  for (const controller of worldEvents) controller.abort();
  worldEvents.clear();
}
async function commitMutation<T>(game: BrowserGameRuntime, work: () => T): Promise<T> {
  return enqueue(async () => {
    if (runtime !== game) throw new Error("Game changed.");
    const before = game.snapshot(), saveBefore = activeSave;
    try { const result = await work(); await persist(); return result; }
    catch (error) { game.restore(before); activeSave = saveBefore; throw error; }
  });
}
async function reviewBackground(game: BrowserGameRuntime, id: string, signal: AbortSignal, allowNextGoal: boolean) {
  signal.throwIfAborted();
  const fork = reviewFork(game, signal);
  await fork.reviewNpcOutcome(id, allowNextGoal, signal);
}
function reviewFork(game: BrowserGameRuntime, signal?: AbortSignal) {
  const version = generation;
  return game.forkForResourceReview(work => commitMutation(game, () => {
    signal?.throwIfAborted();
    if (generation !== version) throw new Error("Game changed.");
    return work();
  }), work => enqueue(async () => {
    signal?.throwIfAborted();
    if (runtime !== game || generation !== version) throw new Error("Game changed.");
    return work();
  }));
}
function startBackground(id: string, handoffs = 3) {
  if (conversationHolds.has(id) || background.has(id) || pendingNpcs.some(item => item.id === id)) return;
  pendingNpcs.push({ id, handoffs });
  drainBackground();
}
function drainBackground() {
  if (!runtime) return;
  for (let index = 0; index < pendingNpcs.length;) {
    const next = pendingNpcs[index]!;
    if ([...background.values()].some(job => job.participants.includes(next.id)) || conversationHolds.has(next.id)) { index++; continue; }
    pendingNpcs.splice(index, 1);
    void runBackground(next);
  }
}
async function handleWorldEvent(game: BrowserGameRuntime, event: Event, signal: AbortSignal, handoffs = 3) {
  const assessed = await game.assessWorldEvent(event, signal);
  if (assessed.playerPerception) {
    await commitMutation(game, () => game.recordPlayerPerception(event, assessed.playerPerception!));
    publishNpc("You perceived a world event.");
  }
  await Promise.all(assessed.reactions.map(async reaction => {
    signal.throwIfAborted();
    stopBackground(reaction.characterId);
    publishNpc(`${reaction.characterId}: processing a perceived event…`);
    await reviewFork(game, signal).processPerceivedEvent(reaction.characterId, event, reaction.perception, signal);
    publishNpc(`${reaction.characterId}: processed a perceived event.`);
    if (handoffs > 0 && game.snapshot().npcActivities?.[reaction.characterId]?.status === "active") startBackground(reaction.characterId, handoffs - 1);
  }));
}
function scheduleWorldEvent(game: BrowserGameRuntime, event: Event, handoffs = 3) {
  const controller = new AbortController(), version = generation;
  worldEvents.add(controller);
  setTimeout(() => {
    if (controller.signal.aborted || runtime !== game || generation !== version) {
      worldEvents.delete(controller); return;
    }
    void handleWorldEvent(game, event, controller.signal, handoffs).catch(error => {
      if (!controller.signal.aborted) alertUser("error", `world event: ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => worldEvents.delete(controller));
  }, 0);
}
async function runBackground(next: { id: string; handoffs: number }) {
  if (!runtime) return;
  const game = runtime, { id, handoffs } = next;
  const job = { id, controller: new AbortController(), participants: [id] }; background.set(id, job);
  const signal = job.controller.signal;
  let finalStatus = `${id}: idle.`;
  let continueObjective = false;
  const valid = () => !signal.aborted && runtime === game && background.get(id) === job && !conversationHolds.has(id);
  try {
    for (let round = 0; round < 3 && valid(); round++) {
      if (game.snapshot().npcActivities?.[id]?.reviewPending) await reviewBackground(game, id, signal, true);
      if (game.snapshot().npcActivities?.[id]?.status !== "active") break;
      const planningSession = game.startPlanningSession(id);
      let planningError: unknown;
      try {
        let reason: "complete" | "unable" | "wait" | "limit" = "limit", detail = "Reached the 24-action limit.";
        let finishGenerations: ExpectedGenerations | undefined;
        let conflict: { error: string; instruction: string } | undefined;
        for (let step = 0; step < 24 && valid(); step++) {
          publishNpc(`${id}: choosing an action…`);
          const plan = await game.planNpc(id, signal, conflict, planningSession);
          conflict = undefined;
          if (!valid()) return;
          publishNpc(`${id}: ${plan.action?.description ?? plan.decision.choice}`, plan);
          if (plan.decision.choice === "complete" || plan.decision.choice === "unable" || plan.decision.choice === "wait") {
            // A changed world invalidates a terminal judgment as well as a physical action.
            reason = plan.decision.choice; detail = JSON.stringify(plan.decision); finishGenerations = plan.generations; break;
          }
          if (!plan.action) throw new Error("Jev returned an unavailable action.");
          let expected: ExpectedGenerations = plan.generations;
          let result: { done: boolean; talkTarget?: string; worldEvent?: Event; generations: ExpectedGenerations } | undefined;
          try {
            while (valid()) {
              result = await commitMutation(game, () => { signal.throwIfAborted(); return game.stepNpcAction(id, plan.action!.id, plan.goal, expected); });
              expected = result.generations;
              if (!valid()) return;
              publishNpc(`${id}: ${plan.action.description}`);
              if (result.done) break;
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          } catch (error) {
            if (!valid()) return;
            if (error instanceof GenerationConflict) {
              conflict = { error: error.response.error, instruction: "The previous action was not applied because its generation IDs changed. Inspect this fresh observation, reconcile your intention, and choose an action again." };
              continue;
            }
            // Doors, targets or goals may have changed while the player acted. Replan.
            if (/replan|changed|doorway/i.test(String(error))) continue;
            throw error;
          }
          if (!valid()) return;
          if (result?.worldEvent) scheduleWorldEvent(game, result.worldEvent, handoffs);
          if (result?.talkTarget) {
            const target = result.talkTarget;
            const targetBusy = () => conversationHolds.has(target)
              || [...background.values()].some(other => other !== job && other.participants.includes(target) && other.participants.length > 1);
            if (targetBusy()) publishNpc(`${id}: waiting for ${target} to finish a conversation…`);
            while (valid() && targetBusy()) await new Promise(resolve => setTimeout(resolve, 100));
            if (!valid()) return;
            // A pair owns both participants until its review commits. Interrupt a
            // solo run, but never steal someone from another conversation.
            const interrupted = background.has(target);
            stopBackground(target);
            job.participants = [id, target];
            publishNpc(`${id}: talking to ${target}…`);
            let before: RuntimeSnapshot;
            try {
              before = game.snapshot();
              const fork = reviewFork(game, signal);
              if (target === (game.view().player as { id?: string } | null)?.id) {
                if (conversationHolds.size) continue;
                await fork.initiatePlayerConversation(id, plan.action.id, Number(game.view().revision), plan.goal, signal);
                if (!valid()) return;
                if (conversationHolds.size) continue;
                try { await commitMutation(game, () => { signal.throwIfAborted(); game.commitCharacterFork(before, fork, [id], undefined, true); }); }
                catch (error) { if (!valid()) return; if (/changed/i.test(String(error))) continue; throw error; }
                conversationHolds.add(id);
                publishNpc(`${id}: started a conversation with you.`, undefined, id);
                return;
              }
              const summary = await fork.executeNpcTalk(id, plan.action.id, Number(game.view().revision), plan.goal, signal);
              scheduleWorldEvent(game, game.worldEvent("having a conversation", summary, [id, target]), handoffs);
            } finally {
              job.participants = [id];
              if (valid() && interrupted) startBackground(target, handoffs);
              drainBackground();
              if (valid()) publishNpc(`${id}: conversation finished.`);
            }
            if (!valid()) return;
            if (handoffs > 0 && game.snapshot().npcActivities?.[target]?.status === "active") startBackground(target, handoffs - 1);
            if (game.snapshot().npcActivities?.[id]?.status !== "active") return;
          }
        }
        if (!valid()) return;
        const expectedFinish = finishGenerations ?? generationIds(game.readResources([`character:${id}`]));
        await commitMutation(game, () => { signal.throwIfAborted(); game.finishNpcRun(id, reason, detail, expectedFinish); });
        publishNpc(`${id}: reviewing the result…`);
        await reviewBackground(game, id, signal, true);
      } catch (error) {
        planningError = error;
        throw error;
      } finally {
        game.endPlanningSession(planningSession, !valid(), planningError);
      }
    }
    continueObjective = valid() && game.hasActiveObjective(id);
  } catch (error) {
    if (valid() && (error instanceof GenerationConflict || /World changed; (replan|retry)/.test(String(error)))) {
      pendingNpcs.push({ id, handoffs });
      finalStatus = `${id}: state changed; choosing again.`;
      return;
    }
    if (valid()) {
      if (game.snapshot().npcActivities?.[id]?.status === "active") await commitMutation(game, () => { signal.throwIfAborted(); game.finishNpcRun(id, "error", String(error)); }).catch(() => {});
      finalStatus = `${id}: ${error instanceof Error ? error.message : String(error)}`;
      alertUser("error", finalStatus);
    }
  } finally {
    if (background.get(id) === job) {
      background.delete(id); publishNpc(finalStatus);
      if (continueObjective && game.hasActiveObjective(id) && game.snapshot().npcActivities?.[id]?.status === "active") startBackground(id, handoffs);
      drainBackground();
    }
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
  runtime = new BrowserGameRuntime(scenario, apiKey, undefined, () => worker.postMessage({ type: "transcripts_changed" }), providerWarning);
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
  await persist();
  return { state: runtime!.view(), activeSaveId: activeSave!.id, saves: await listSaves() };
}

async function loadGame(saveId: string): Promise<Record<string, unknown>> {
  if (!apiKey) throw new Error("Enter an OpenRouter key first");
  const saved = await transaction<SaveRecord | undefined>("readonly", store => store.get(saveId));
  if (!saved) throw new Error("That saved game no longer exists");
  runtime = new BrowserGameRuntime(await scenarioPromise, apiKey, saved.snapshot, () => worker.postMessage({ type: "transcripts_changed" }), providerWarning);
  activeSave = saved;
  return { state: runtime.view(), activeSaveId: saved.id, saves: await listSaves() };
}

function requireRuntime(): BrowserGameRuntime {
  if (!runtime) throw new Error("Choose or create a game first");
  return runtime;
}

async function handle(type: string, payload: Record<string, unknown>, requestId: number): Promise<unknown> {
  if (["configure", "create_game", "create_development_game", "load_game", "delete_game", "reset", "reset_world", "reset_characters"].includes(type)) {
    for (const pending of pendingDice.values()) pending.reject(new Error("Game changed during a dice roll."));
    pendingDice.clear();
    generation++; stopBackground(); stopWorldEvents(); conversationHolds.clear();
  }
  const reviewKey = `${generation}:${String(payload.characterId || "")}`;
  if (["move_player", "set_door", "interact_fixture"].includes(type)
    && (!payload.generations || typeof payload.generations !== "object" || Array.isArray(payload.generations))) throw new Error("Expected generation IDs are required for physical updates.");
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
  if (type === "stranger_expression") return {};
  if (["set_identity", "start_introduction", "gm", "save_character"].includes(type)) {
    throw new Error("Character creation is not available in this scenario. Start a fresh game with the visiting envoy.");
  }
  if (type === "cancel_npc") { stopBackground(); publishNpc("NPC activity paused."); return {}; }
  if (type === "reset_world" || type === "reset_characters") {
    const game = requireRuntime(), before = structuredClone(game.snapshot()), savedBefore = activeSave;
    try {
      if (type === "reset_world") game.resetWorld();
      else game.resetCharacters();
      await persist();
    } catch (error) { game.restore(before); activeSave = savedBefore; throw error; }
    return { state: game.view(), saves: await listSaves() };
  }
  if (type === "interact_fixture") {
    const game = requireRuntime();
    const { message, event } = await commitMutation(game, () => game.interactFixtureWithEvent(
      String(payload.actionId || ""), payload.generations as ExpectedGenerations | undefined));
    scheduleWorldEvent(game, event);
    return { state: game.view(), saves: await listSaves(), message };
  }
  if (type === "set_door") {
    if (typeof payload.open !== "boolean") throw new Error("Door state must be open or closed.");
    const game = requireRuntime();
    const open = payload.open;
    const event = await commitMutation(game, () => game.setDoor(String(payload.id), open, payload.generations as ExpectedGenerations | undefined));
    scheduleWorldEvent(game, event);
    return { state: game.view(), saves: await listSaves() };
  }
  if (type === "move_player") {
    const game = requireRuntime(), before = structuredClone(game.snapshot());
    try { game.movePlayer({ x: Number(payload.x), y: Number(payload.y) }, payload.generations as ExpectedGenerations | undefined); await persist(); }
    catch (error) { game.restore(before); throw error; }
    return { state: game.view(), saves: await listSaves() };
  }
  if (type === "talk" || type === "end_conversation") {
    if (type === "end_conversation") conversationReviews.add(reviewKey);
    try {
      const game = requireRuntime(), id = String(payload.characterId || "");
      conversationHolds.add(id); stopBackground(id);
      const finalMessage = type === "end_conversation" && typeof payload.message === "string";
      const version = generation;
      const { before, fork } = await enqueue(async () => ({ before: game.snapshot(), fork: type === "end_conversation" && !finalMessage ? reviewFork(game) : game.forkForNpc() }));
      let reply = type === "talk" || finalMessage ? await fork.checkedTalkToCharacter(id, String(payload.message || ""), text => {
        if (generation === version && runtime === game) worker.postMessage({
          type: "dialogue_thinking", requestId, characterId: id, text,
        });
      }, { services: { presentation: { showRoll: async (result, signal) => {
        if (generation !== version || runtime !== game) throw new Error("Game changed.");
        const rollId = crypto.randomUUID();
        await new Promise<void>((resolve, reject) => {
          signal.throwIfAborted();
          const abort = () => {
            pendingDice.delete(rollId);
            worker.postMessage({ type: "cancel_conversation_roll", rollId });
            reject(signal.reason);
          };
          const cleanup = () => signal.removeEventListener("abort", abort);
          pendingDice.set(rollId, { requestId, resolve: () => { cleanup(); resolve(); }, reject: error => { cleanup(); reject(error); } });
          signal.addEventListener("abort", abort, { once: true });
          worker.postMessage({ type: "conversation_roll", requestId, characterId: id, rollId, result });
        });
        if (generation !== version || runtime !== game) throw new Error("Game changed.");
      } } } }) : await fork.endConversation(id);
      if (generation !== version || runtime !== game) throw new Error("Game changed.");
      if (type === "talk" || finalMessage) await commitMutation(game, () => {
          if (generation !== version) throw new Error("Game changed.");
          game.commitCharacterFork(before, fork, [id]);
        });
      if (type === "talk") void game.logConversationExpression(id).catch(() => {});
      if (finalMessage) reply = await reviewFork(game).endConversation(id);
      if (type === "end_conversation") {
        conversationHolds.delete(id);
        if (game.hasActiveObjective(id)) startBackground(id);
        if (reply) scheduleWorldEvent(game, reply as Event);
      }
      return { reply: type === "talk" ? reply : undefined, state: game.view(), saves: await listSaves(), activeSaveId: activeSave?.id };
    } finally { if (type === "end_conversation") conversationReviews.delete(reviewKey); }
  }
  if (type === "reset") {
    requireRuntime().reset();
    if (activeSave) { activeSave.characterName = "New emissary"; activeSave.normalizedName = "new emissary"; }
    await persist();
    return { state: requireRuntime().view(), saves: await listSaves(), activeSaveId: activeSave?.id };
  }
  if (type === "debug_override_objective") {
    const game = requireRuntime(), id = String(payload.characterId || "");
    const before = game.snapshot(), saveBefore = activeSave;
    try {
      await game.overrideActiveObjective(id, payload.objective);
      stopBackground(id);
      await persist();
    } catch (error) {
      game.restore(before); activeSave = saveBefore;
      throw error;
    }
    publishNpc(`${id}: objective overridden. Ready to run the new goal.`);
    return { state: game.view(), saves: await listSaves(), activeSaveId: activeSave?.id };
  }
  if (type === "debug_transcripts") return { requests: requireRuntime().recentTranscripts(), agentRuns: requireRuntime().transcriptRuns() };
  if (type === "issue_report") return { worldState: requireRuntime().snapshot(), requests: requireRuntime().recentTranscripts(), agentRuns: requireRuntime().transcriptRuns() };
  if (type === "debug_gm") return requireRuntime().debugGameMaster();
  if (type === "debug") return requireRuntime().debug();
  if (type === "debug_character") return requireRuntime().debugCharacter(String(payload.characterId || ""));
  throw new Error(`Unknown worker request: ${type}`);
}

// Keep state changes and their saves in order, including while a model is running.
worker.addEventListener("message", event => {
  const request = event.data as WorkerRequest;
  if (request.type === "acknowledge_roll") {
    const rollId = String(request.payload?.rollId), pending = pendingDice.get(rollId);
    if (!pending || pending.requestId !== request.payload?.requestId) return;
    pendingDice.delete(rollId);
    if (request.payload?.completed === true) pending.resolve();
    else pending.reject(new Error("Dice roll cancelled. No conversation turn was saved."));
    return;
  }
  const process = async () => {
    try {
      const value = await handle(request.type, request.payload || {}, request.id);
      worker.postMessage({ id: request.id, ok: true, value });
    } catch (error) {
      if (error instanceof GenerationConflict) publishNpc("State changed. Review the updated palace and choose again.");
      alertUser(error instanceof GenerationConflict ? "warning" : "error", `${request.type}: ${error instanceof Error ? error.message : String(error)}`);
      worker.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  // Background work and dialogue wait outside the mutation queue. Their results
  // rejoin it only to validate, merge and save, keeping player commands responsive.
  if (request.type === "stranger_expression" || request.type === "cancel_npc" || request.type === "debug_transcripts" || request.type === "issue_report" || request.type === "start_npc" || request.type === "pause_npc" || request.type === "talk" || request.type === "end_conversation" || request.type === "interact_fixture" || request.type === "set_door") void process();
  else void enqueue(process);
});

}
