import { Autosave } from "./autosave.js";
/// <reference lib="webworker" />
import { WaitScheduler } from "./wait-scheduler.js";
import { characterIntent, followingTarget } from "../../../packages/lore/src/activity.js";
import { characterCreationWorld } from "./playable-world.js";
import { type TravellerIdentity } from "./introduction.js";
import { type JsonValue } from "@bufbuild/protobuf";
import { type Event } from "../../../packages/contracts/src/index.js";
import type { WorldState } from "../../../packages/contracts/src/v2.js";
import { WorldGameRuntime as BrowserGameRuntime, type WorldSnapshot as RuntimeSnapshot } from "./world-runtime.js";

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
let activeSave: Omit<SaveRecord, "snapshot"> | undefined;
let generation = 0;

// Only validated mutations hold this queue. Network waits and autosave run outside it.
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
let waitsPaused = false;
const checkingWaits = new Set<string>();
const followers = new WaitScheduler({
  candidates: () => !runtime || waitsPaused ? new Map() : runtime.followingCharacters(),
  delayMs: () => 100,
  busy: id => checkingWaits.has(id) || conversationHolds.has(id) || conversationReviews.has(`${generation}:${id}`),
  run: async (id, _elapsed, signal) => { await runtime?.moveFollower(id, signal); },
  error: (id, error) => alertUser("error", `${id}: following: ${String(error)}`),
});
function syncWaits() { waits.sync(); followers.sync(); }
const waits = new WaitScheduler({
  delayMs: id => runtime && followingTarget(runtime.world(), id) ? 15_000 : 12_000 + Math.random() * 6_000,
  candidates: () => {
    if (!runtime || waitsPaused || !runtime.world().player) return new Map();
    const world = runtime.world();
    return new Map(runtime.waitingCharacters().map(id => [id, characterIntent(world, id).wait ?? `review:${id}`]));
  },
  busy: id => conversationHolds.has(id) || conversationReviews.has(`${generation}:${id}`) || worldEvents.size > 0
    || pendingNpcs.some(next => next.id === id) || [...background.values()].some(job => job.participants.includes(id)),
  run: async (id, elapsed, signal) => {
    const game = runtime;
    if (!game) return;
    checkingWaits.add(id);
    try {
      if (followingTarget(game.world(), id)) {
        followers.cancel(id);
        await game.movement.cancel(id);
      }
      await game.checkWait(id, elapsed, signal);
    } finally { checkingWaits.delete(id); followers.sync(); }
    if (signal.aborted || runtime !== game) return;
    publishNpc(`${id}: checked waiting conditions.`);
    if (game.hasActiveObjective(id)) startBackground(id);
  },
  error: (id, error) => alertUser("error", `${id}: wait check: ${String(error)}`),
});


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
  if (characterId) { waits.cancel(characterId); followers.cancel(characterId); }
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
/** The world service owns write validation; autosave failure never rewinds accepted writes. */
async function commitMutation<T>(game: BrowserGameRuntime, work: () => T | Promise<T>): Promise<T> {
  return enqueue(async () => {
    if (runtime !== game) throw new Error("Game changed.");
    const result = await work();
    // Clients render accepted state immediately; autosave must not delay animation.
    publishNpc("");
    autosave.markDirty();
    return result;
  });
}
const autosave = new Autosave({ save: () => persist(), error: error => {
  alertUser("error", `Autosave failed. Your latest progress is still in memory; autosave will retry. ${String(error)}`);
} });
async function mutationResponse(game: BrowserGameRuntime) {
  // A storage outage must not turn a successful action into a rejected UI move.
  return { state: game.view() };
}
async function reviewBackground(game: BrowserGameRuntime, id: string, signal: AbortSignal, allowNextGoal: boolean) {
  signal.throwIfAborted();
  await game.reviewNpcOutcome(id, allowNextGoal, signal);
}
function attachPersistence(game: BrowserGameRuntime) {
  const version = generation;
  game.setPersistence(work => commitMutation(game, () => {
    if (generation !== version) throw new Error("Game changed.");
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
    await game.processPerceivedEvent(reaction.characterId, event, reaction.perception, signal);
    publishNpc(`${reaction.characterId}: processed a perceived event.`);
    if (handoffs > 0 && game.hasActiveObjective(reaction.characterId)) startBackground(reaction.characterId, handoffs - 1);
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
    }).finally(() => { worldEvents.delete(controller); syncWaits(); });
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
      if (game.needsNpcReview(id)) await reviewBackground(game, id, signal, true);
      if (!game.hasActiveObjective(id)) break;
      const planningSession = game.startPlanningSession(id);
      let planningError: unknown;
      try {
        let reason: "complete" | "unable" | "wait" | "limit" = "limit", detail = "Reached the 24-action limit.";
        let conflict: { error: string; instruction: string } | undefined;
        for (let step = 0; step < 24 && valid(); step++) {
          publishNpc(`${id}: choosing an action…`);
          const plan = await game.planNpc(id, signal, conflict, planningSession);
          conflict = undefined;
          if (!valid()) return;
          publishNpc(`${id}: ${plan.action?.description ?? plan.decision.choice}`, plan);
          if (plan.decision.choice === "complete" || plan.decision.choice === "unable" || plan.decision.choice === "wait") {
            reason = plan.decision.choice; detail = JSON.stringify(plan.decision); break;
          }
          if (!plan.action) throw new Error("Jev returned an unavailable action.");
          let result: { done: boolean; talkTarget?: string; worldEvent?: Event } | undefined;
          try {
            while (valid()) {
              result = await game.executeAction({ command: { kind: "step", characterId: id, actionId: plan.action!.id, goal: plan.goal } }, signal);
              await game.presentMap("player", result).catch(error => providerWarning(String(error)));
              if (!valid()) return;
              publishNpc(`${id}: ${plan.action.description}`);
              if (result.done) break;
            }
          } catch (error) {
            if (!valid()) return;
            // Doors, targets or goals may have changed while the player acted. Replan.
            if (/replan|changed|doorway/i.test(String(error))) continue;
            throw error;
          }
          if (!valid()) return;
          if (plan.action.type === "follow") {
            finalStatus = `${id}: following ${plan.action.target}.`;
            return;
          }
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
            try {
              if (target === (game.view().player as { id?: string } | null)?.id) {
                if (conversationHolds.size) continue;
                const opening = await game.initiatePlayerConversation(id, plan.action.id, Number(game.view().revision), plan.goal, signal);
                if (!opening.ok) { conflict = opening; continue; }
                if (!valid()) return;
                if (conversationHolds.size) continue;
                conversationHolds.add(id);
                publishNpc(`${id}: started a conversation with you.`, undefined, id);
                return;
              }
              const conversation = await game.executeNpcTalk(id, plan.action.id, Number(game.view().revision), plan.goal, signal);
              if (!conversation.ok) { conflict = conversation; continue; }
              scheduleWorldEvent(game, game.worldEvent("having a conversation", conversation.text, [id, target]), handoffs);
            } finally {
              job.participants = [id];
              if (valid() && interrupted) startBackground(target, handoffs);
              drainBackground();
              if (valid()) publishNpc(conflict ? `${id}: conversation changed; choosing again.` : `${id}: conversation finished.`);
            }
            if (!valid()) return;
            if (handoffs > 0 && game.hasActiveObjective(target)) startBackground(target, handoffs - 1);
            if (!game.hasActiveObjective(id)) return;
          }
        }
        if (!valid()) return;
        await commitMutation(game, () => { signal.throwIfAborted(); game.finishNpcRun(id, reason, detail); });
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
    if (valid() && /World changed; (replan|retry)/.test(String(error))) {
      pendingNpcs.push({ id, handoffs });
      finalStatus = `${id}: state changed; choosing again.`;
      return;
    }
    if (valid()) {
      if (game.hasActiveObjective(id)) await commitMutation(game, () => { signal.throwIfAborted(); game.finishNpcRun(id, "error", String(error)); }).catch(() => {});
      finalStatus = `${id}: ${error instanceof Error ? error.message : String(error)}`;
      alertUser("error", finalStatus);
    }
  } finally {
    if (background.get(id) === job) {
      background.delete(id); publishNpc(finalStatus);
      if (continueObjective && game.hasActiveObjective(id)) startBackground(id, handoffs);
      drainBackground();
      syncWaits();
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
  const game = runtime;
  const saved = {
    ...activeSave,
    characterName,
    normalizedName: characterName.trim().toLocaleLowerCase(),
    updatedAt: now,
    snapshot: runtime.snapshot(),
  };
  await transaction("readwrite", store => store.put(saved));
  if (runtime === game && activeSave?.id === saved.id) activeSave = saved;
}

async function createGame(development = false): Promise<Record<string, unknown>> {
  if (!apiKey) throw new Error("Enter an OpenRouter key first");
  const baseline = await scenarioPromise;
  const scenario = development ? baseline : characterCreationWorld(baseline);
  const now = new Date().toISOString();
  runtime = new BrowserGameRuntime(scenario, apiKey, undefined, () => worker.postMessage({ type: "transcripts_changed", activeSaveId: activeSave?.id, speechBubbles: runtime?.speechBubbles() ?? [] }), providerWarning, { services: { presentation: { renderMap: async () => publishNpc("") } } });
  activeSave = {
    id: crypto.randomUUID(),
    characterName: "New emissary",
    normalizedName: "new emissary",
    createdAt: now,
    updatedAt: now,
  };
  attachPersistence(runtime);
  await persist();
  return { mapLayout: runtime.map.layout(), state: runtime.view(), activeSaveId: activeSave.id, saves: await listSaves() };
}

async function createDevelopmentGame(): Promise<Record<string, unknown>> {
  await createGame(true);
  return { mapLayout: runtime!.map.layout(), state: runtime!.view(), activeSaveId: activeSave!.id, saves: await listSaves() };
}

async function loadGame(saveId: string): Promise<Record<string, unknown>> {
  if (!apiKey) throw new Error("Enter an OpenRouter key first");
  const saved = await transaction<SaveRecord | undefined>("readonly", store => store.get(saveId));
  if (!saved) throw new Error("That saved game no longer exists");
  runtime = new BrowserGameRuntime(await scenarioPromise, apiKey, saved.snapshot, () => worker.postMessage({ type: "transcripts_changed", activeSaveId: activeSave?.id, speechBubbles: runtime?.speechBubbles() ?? [] }), providerWarning, { services: { presentation: { renderMap: async () => publishNpc("") } } });
  attachPersistence(runtime);
  activeSave = saved;
  return { mapLayout: runtime.map.layout(), state: runtime.view(), activeSaveId: saved.id, saves: await listSaves() };
}

function requireRuntime(): BrowserGameRuntime {
  if (!runtime) throw new Error("Choose or create a game first");
  return runtime;
}

async function handle(type: string, payload: Record<string, unknown>, requestId: number): Promise<unknown> {
  if (["configure", "create_game", "create_development_game", "load_game", "delete_game", "reset", "reset_world", "reset_characters"].includes(type)) {
    for (const pending of pendingDice.values()) pending.reject(new Error("Game changed during a dice roll."));
    pendingDice.clear();
    waits.stop(); followers.stop(); waitsPaused = false;
    await autosave.flush();
    if (["configure", "create_game", "create_development_game", "load_game", "delete_game"].includes(type)) runtime?.movement.dispose();
    generation++; stopBackground(); stopWorldEvents(); conversationHolds.clear();
    if (runtime) attachPersistence(runtime);
  }
  const reviewKey = `${generation}:${String(payload.characterId || "")}`;
  if (["start_npc", "pause_npc", "talk", "end_conversation"].includes(type) && conversationReviews.has(reviewKey)) {
    throw new Error("This character is still reviewing the conversation. Try again when the review finishes.");
  }
  if (type === "start_npc") { waitsPaused = false; const id = String(payload.characterId); conversationHolds.delete(id); startBackground(id); return {}; }
  if (type === "pause_npc") { const id = String(payload.characterId); conversationHolds.add(id); stopBackground(id);
    for (const actor of requireRuntime().world().simulation!.map!.actors.filter(actor => actor.characterId === id)) await requireRuntime().movement.cancel(actor.instanceId || id);
    publishNpc(`${id}: talking to you.`); void drainBackground(); return {}; }
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
  if (type === "save_game") { await autosave.flush(); return {}; }
  if (type === "state") return { state: requireRuntime().view(), activeSaveId: activeSave?.id };
  if (type === "stranger_expression") return { expression: await requireRuntime().classifyStrangerExpression(payload.recentPortraits ?? []) };
  if (["start_introduction", "start_premade", "gm", "save_character"].includes(type)) {
    const game = requireRuntime();
    const version = generation;
    if (type === "start_introduction") game.startIntroduction();
    if (type === "start_premade") await game.startPremadeCharacter(String(payload.characterId || ""));
    if (type === "gm") await game.talkToGameMaster(String(payload.message || ""), text => {
      if (generation === version && runtime === game) worker.postMessage({ type: "dialogue_stream", requestId, characterId: "gm", text });
    });
    if (type === "save_character") await game.confirmPlayer(payload.draft as JsonValue);
    autosave.markDirty();
    return { state: game.view(), activeSaveId: activeSave?.id };
  }
  if (type === "cancel_npc") { waitsPaused = true; waits.stop(); followers.stop(); stopBackground(); publishNpc("NPC activity paused."); return {}; }
  if (type === "reset_world" || type === "reset_characters") {
    const game = requireRuntime();
    if (type === "reset_world") game.resetWorld();
    else game.resetCharacters();
    autosave.markDirty();
    return mutationResponse(game);
  }
  if (type === "release_from_jail") {
    const game = requireRuntime();
    await commitMutation(game, () => game.releaseFromJail());
    return mutationResponse(game);
  }
  if (type === "interact_fixture") {
    const game = requireRuntime();
    const result = await commitMutation(game, () => game.executeAction({ command: { kind: "fixture", id: String(payload.actionId || "") } }));
    if (result.worldEvent) scheduleWorldEvent(game, result.worldEvent);
    return { ...await mutationResponse(game), message: result.message };
  }
  if (type === "set_door" || type === "move_player") {
    if (type === "set_door" && typeof payload.open !== "boolean") throw new Error("Door state must be open or closed.");
    const game = requireRuntime();
    const command = type === "set_door" ? { kind: "door" as const, id: String(payload.id), open: payload.open as boolean }
      : { kind: "move" as const, destination: { x: Number(payload.x), y: Number(payload.y) } };
    const result = command.kind === "move" ? await game.executeAction({ command })
      : await commitMutation(game, () => game.executeAction({ command }));
    if (result.worldEvent) scheduleWorldEvent(game, result.worldEvent);
    return { ...await mutationResponse(game), movementOutcome: result.movementOutcome ?? "arrived" };
  }
  if (type === "talk" || type === "end_conversation") {
    if (type === "end_conversation") conversationReviews.add(reviewKey);
    try {
      const game = requireRuntime(), id = String(payload.characterId || "");
      conversationHolds.add(id); stopBackground(id);
      const finalMessage = type === "end_conversation" && typeof payload.message === "string";
      const version = generation;
      let reply = type === "talk" || finalMessage ? await game.checkedTalkToCharacter(id, String(payload.message || ""), text => {
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
      } } } }, undefined, text => {
        if (generation === version && runtime === game) worker.postMessage({ type: "dialogue_stream", requestId, characterId: id, text });
      }) : await game.endConversation(id);
      if (generation !== version || runtime !== game) throw new Error("Game changed.");
      if (type === "talk") void game.logConversationExpression(id).catch(() => {});
      if (finalMessage) reply = await game.endConversation(id);
      if (type === "end_conversation") {
        conversationHolds.delete(id);
        if (game.hasActiveObjective(id)) startBackground(id);
        if (reply) scheduleWorldEvent(game, reply as Event);
      }
      return { reply: type === "talk" ? reply : undefined, state: game.view(), activeSaveId: activeSave?.id };
    } finally { if (type === "end_conversation") conversationReviews.delete(reviewKey); }
  }
  if (type === "reset") {
    requireRuntime().reset();
    if (activeSave) { activeSave.characterName = "New emissary"; activeSave.normalizedName = "new emissary"; }
    autosave.markDirty();
    return { state: requireRuntime().view(), activeSaveId: activeSave?.id };
  }
  if (type === "debug_override_objective") {
    const game = requireRuntime(), id = String(payload.characterId || "");
    await game.overrideActiveObjective(id, payload.objective);
    stopBackground(id);
    autosave.markDirty();
    publishNpc(`${id}: objective overridden. Ready to run the new goal.`);
    return { state: game.view(), activeSaveId: activeSave?.id };
  }
  if (type === "debug_transcripts") return { requests: requireRuntime().recentTranscripts(), agentRuns: requireRuntime().transcriptRuns() };
  if (type === "debug_documents") return requireRuntime().debugDocuments();
  if (type === "issue_report") return { worldState: requireRuntime().world(), requests: requireRuntime().recentTranscripts(), agentRuns: requireRuntime().transcriptRuns() };
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
      alertUser("error", `${request.type}: ${error instanceof Error ? error.message : String(error)}`);
      worker.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally { syncWaits(); }
  };
  // Background work and dialogue wait outside the mutation queue. Their results
  // rejoin it only to validate, merge and save, keeping player commands responsive.
  if (request.type === "save_game" || request.type === "release_from_jail" || request.type === "stranger_expression" || request.type === "cancel_npc" || request.type === "debug_transcripts" || request.type === "issue_report" || request.type === "start_npc" || request.type === "pause_npc" || request.type === "talk" || request.type === "end_conversation" || request.type === "interact_fixture" || request.type === "set_door" || request.type === "move_player") void process();
  else void enqueue(process);
});

}
