import { mapActionHooks, runActionExecution, type ActionExecutionContext } from "../../../packages/conversation/src/action-execution.js";
import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, TranscriptRole, type Event } from "../../../packages/contracts/src/index.js";
import type { WorldState } from "../../../packages/contracts/src/v2.js";
import { WorldHost, type WorldSnapshot } from "./world-host.js";
import { projectWorld } from "./world-projection.js";
import { ConversationRuntime, type ConversationRuntimeOptions } from "../../../packages/conversation/src/runtime.js";
import { conversationRequest } from "../../../packages/conversation/src/conversation.js";
import { runConversation } from "../../../packages/conversation/src/phases.js";
import { runConversationReview } from "../../../packages/conversation/src/review.js";
import { runResolution, type ResolutionContext } from "../../../packages/conversation/src/resolution.js";
import { documentResolutionHooks } from "../../../packages/conversation/src/document-resolution.js";
import { documentReviewHooks } from "../../../packages/conversation/src/document-review.js";
import { jevActionHooks } from "../../../packages/conversation/src/action.js";
import { documentLore } from "../../../packages/conversation/src/document-lore.js";
import { DisclosureSession } from "../../../packages/conversation/src/disclosure.js";
import { cliHooks } from "../../../packages/conversation/src/cli-hooks.js";
import { aiService } from "../../../packages/conversation/src/adapters.js";
import { OpenRouterClient } from "../../../packages/providers/src/openrouter.js";
import { JevClient } from "../../../packages/providers/src/jev.js";
import type { AiService } from "../../../packages/conversation/src/services.js";
import { ModelTranscripts, type ModelCallKind } from "./model-transcripts.js";
import { planWorldAction } from "./world-action.js";
import { courtAgentObservation } from "./court-agent.js";
import { courtCharactersWithinEarshot, perceivesAt } from "./earshot.js";
import { generationIds, type ExpectedGenerations } from "../../../packages/core/src/generations.js";

export type WorldTurnLabels = Awaited<ReturnType<ReturnType<typeof cliHooks>["classify"]>>;
export type WorldOptions = ConversationRuntimeOptions<WorldTurnLabels>;
export { type WorldSnapshot } from "./world-host.js";

export class WorldGameRuntime extends WorldHost {
  private provider: AiService;
  private traces: ModelTranscripts;
  private live: { host: WorldGameRuntime; commit: <T>(work: () => T) => Promise<T> } | undefined;
  constructor(world: WorldState, apiKey: string, saved?: WorldSnapshot, changed = () => {}, warning = (_message: string) => {},
    readonly options: WorldOptions = {}) {
    super(world, saved);
    Object.assign(this.map, options.services?.map);
    this.provider = aiService(new OpenRouterClient(apiKey, 60_000, globalThis.location?.origin || "http://localhost", warning), new JevClient(apiKey));
    this.traces = new ModelTranscripts(apiKey, changed);
  }
  private runtime(id: string, kind: ModelCallKind, extra: WorldOptions = {}, runKey?: string) {
    const ai = { ...this.provider, ...this.options.services?.ai, ...extra.services?.ai };
    return new ConversationRuntime<WorldTurnLabels>({ services: {
      ...this.options.services, ...extra.services, ...this.documents,
      map: { ...this.map, ...this.options.services?.map, ...extra.services?.map },
      ai: {
        responses: (request, signal) => this.traces.record(kind, id, request, () => ai.responses(request, signal), runKey),
        decisions: (state, questions, signal) => this.traces.record("jev", id, { state, questions }, () => ai.decisions(state, questions, signal), runKey),
      },
      random: { integer: (min, max) => min + Math.floor(Math.random() * (max - min + 1)), ...this.options.services?.random, ...extra.services?.random },
      debug: { record: () => {}, ...this.options.services?.debug, ...extra.services?.debug },
      presentation: { renderMap: async () => {}, showRoll: async () => {}, setPortrait: async () => {}, ...this.options.services?.presentation, ...extra.services?.presentation },
    }, hooks: { ...this.options.hooks, ...extra.hooks,
      review: { ...documentReviewHooks, ...this.options.hooks?.review, ...extra.hooks?.review },
      actionExecution: { ...mapActionHooks, ...this.options.hooks?.actionExecution, ...extra.hooks?.actionExecution },
      action: { ...jevActionHooks, ...this.options.hooks?.action, ...extra.hooks?.action },
      resolution: { ...documentResolutionHooks, ...this.options.hooks?.resolution, ...extra.hooks?.resolution },
    } });
  }
  async executeAction(context: ActionExecutionContext, signal = new AbortController().signal) {
    const id = context.command.kind === "step" ? context.command.characterId : "player";
    return runActionExecution(context, this.runtime(id, "npc_request"), signal);
  }
  /** Called after persistence; presentation failure must not roll back a committed action. */
  async presentMap(id = "player", result?: import("../../../packages/conversation/src/map.js").MapResult) {
    const { services } = this.runtime(id, "npc_request");
    await services.presentation.renderMap(services.map.observe(id), result);
  }
  recentTranscripts() { return this.traces.recent(); }
  transcriptRuns() { return this.traces.runs(); }
  startPlanningSession(id: string) { return this.traces.start("npc_goal", id); }
  endPlanningSession(key: string, stopped: boolean, error?: unknown) {
    if (error) this.traces.fail(key, error); else if (stopped) this.traces.stop(key); else this.traces.finish(key);
  }
  forkForNpc() {
    const fork = new WorldGameRuntime(this.initial, "", this.snapshot(), undefined, undefined, this.options);
    fork.provider = this.provider; fork.traces = this.traces;
    return fork;
  }
  forkForResourceReview(commit: <T>(work: () => T) => Promise<T>, _read = commit) {
    const fork = this.forkForNpc(); fork.live = { host: this, commit }; return fork;
  }
  commitCharacterFork(before: WorldSnapshot, fork: WorldGameRuntime, ids: string[], _expected?: ExpectedGenerations, allConversations = false) {
    const current = this.snapshot(), next = fork.snapshot();
    if (current.worldGeneration !== before.worldGeneration) throw new Error("World changed; retry the operation.");
    if (allConversations && JSON.stringify(current.conversations) !== JSON.stringify(before.conversations)) throw new Error("Conversation changed.");
    for (const id of ids) {
      if (JSON.stringify(current.conversations[id]) !== JSON.stringify(before.conversations[id])
        || JSON.stringify(current.npcActivities?.[id]) !== JSON.stringify(before.npcActivities?.[id])) throw new Error("Character changed; retry the operation.");
      for (const key of ["conversations", "npcActivities", "conversationReplyOptions", "conversationEndRequested"] as const) {
        const target = current[key] ??= {};
        if (next[key]?.[id] === undefined) delete target[id];
        else Object.assign(target, { [id]: next[key]![id] });
      }
    }
    this.restore({ ...current, world: next.world, worldGeneration: next.worldGeneration });
  }
  private async publish(before: WorldSnapshot, ids: string[], signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.live) await this.live.commit(() => {
      signal.throwIfAborted(); this.live!.host.commitCharacterFork(before, this, ids);
    });
  }
  async checkedTalkToCharacter(id: string, message: string, thinking?: (text: string) => void, options: WorldOptions = {}, signal = new AbortController().signal) {
    if (!message.trim()) throw new Error("Say something first.");
    if (this.activity.conversationEndRequested?.[id]) throw new Error("Finish the conversation review first.");
    const generation = this.worldGeneration();
    const previous = structuredClone(this.activity.conversations[id] ?? []);
    const lore = await documentLore(this.documents.scenario, id), runtime = this.runtime(id, "dialogue", options);
    const disclosure = new DisclosureSession(lore, runtime.services.ai, 0.7);
    const world = this.world(), build = world.player ? world.docs[world.player]?.characterProperties?.dnd : undefined;
    const hooks = cliHooks(disclosure, runtime.services.ai, build, message,
      async (_check, cancellation) => { cancellation.throwIfAborted(); return runtime.services.random.integer(1, 20); },
      () => {}, () => {}, runtime.services.presentation);
    runtime.hooks.conversation = options.hooks?.conversation ?? this.options.hooks?.conversation ?? hooks;
    runtime.services.character.respond = options.services?.character?.respond ?? this.options.services?.character?.respond ?? runtime.services.ai.responses;
    const transcript = previous.map(turn => fromJson(TranscriptMessageSchema, turn));
    const request = conversationRequest({ snapshot: { world }, characterId: id, sources: lore.initial, transcript, message });
    thinking?.("Considering your words…");
    const rulings: string[] = [];
    const reply = await runConversation(request, runtime, signal, prepared => {
      for (const turn of prepared.messages) if (turn.role === "system" && turn.content?.startsWith("# Binding DM ruling")) rulings.push(turn.content);
    });
    if (reply.tool_calls?.length || !reply.content?.trim()) throw new Error("Expected a character reply without tool calls.");
    if (generation !== this.worldGeneration() || JSON.stringify(previous) !== JSON.stringify(this.activity.conversations[id] ?? [])) throw new Error("Conversation changed; retry the turn.");
    this.activity.conversations[id] = [...previous,
      toJson(TranscriptMessageSchema, create(TranscriptMessageSchema, { role: TranscriptRole.PLAYER, speakerId: "player", text: message })),
      ...rulings.map(text => toJson(TranscriptMessageSchema, create(TranscriptMessageSchema, { role: TranscriptRole.GAME_MASTER, speakerId: "GM", text }))),
      toJson(TranscriptMessageSchema, create(TranscriptMessageSchema, { role: TranscriptRole.CHARACTER, speakerId: id, text: reply.content })),
    ];
    return reply.content;
  }
  endConversationAsPlayer(id: string, message: string) {
    if (!message.trim()) throw new Error("Say something first.");
    (this.activity.conversations[id] ??= []).push(toJson(TranscriptMessageSchema,
      create(TranscriptMessageSchema, { role: TranscriptRole.PLAYER, speakerId: "player", text: message })));
    (this.activity.conversationEndRequested ??= {})[id] = true;
  }
  async endConversation(id: string, signal = new AbortController().signal) {
    const before = this.snapshot(), transcript = (before.conversations[id] ?? []).map(turn => fromJson(TranscriptMessageSchema, turn));
    if (!transcript.length) return;
    await runConversationReview({ characterId: id, participants: [id, "player"], transcript }, this.runtime(id, "conversation_review"), signal);
    if (JSON.stringify(before.conversations[id]) !== JSON.stringify(this.activity.conversations[id])) throw new Error("Conversation changed.");
    delete this.activity.conversations[id]; delete this.activity.conversationEndRequested?.[id]; delete this.activity.conversationReplyOptions?.[id];
    this.syncGoals();
    const event = this.worldEvent("having a conversation", transcript.filter(turn => turn.role !== TranscriptRole.GAME_MASTER).map(turn => `${turn.speakerId}: ${turn.text}`).join("\n"), [id, "player"]);
    await this.publish(before, [id], signal);
    return event;
  }
  async planNpc(id: string, signal: AbortSignal, _conflict?: unknown, runKey?: string) {
    if (this.activity.conversations[id]?.length || this.activity.npcActivities?.[id]?.reviewPending) throw new Error("NPC paused for conversation or review.");
    const token = this.worldGeneration();
    const plan = await planWorldAction(id, this.runtime(id, "jev", {}, runKey), signal, this.activity.npcActivities?.[id]?.actionIds ?? []);
    if (!plan) throw new Error("NPC has no active goal.");
    if (token !== this.worldGeneration()) throw new Error("World changed; replan.");
    return { ...plan, revision: this.world().map!.revision, generations: { ...generationIds(this.readResources()), "v2:world": token } };
  }
  private async resolve(context: ResolutionContext, signal: AbortSignal) {
    const before = this.snapshot();
    const result = await runResolution(context, this.runtime(context.characterId, context.kind === "npc_exchange" ? "npc_resolution" : context.kind === "world_event" ? "world_event" : "outcome_review"), signal);
    this.syncGoals();
    if (context.kind === "task_outcome") {
      const activity = this.activity.npcActivities![context.characterId]!;
      activity.reviewPending = false; activity.status = activity.goal ? "active" : "idle";
      activity.history = []; activity.actionIds = [];
    }
    if (context.kind === "npc_exchange") (this.activity.npcActivities![context.characterId]!.actionIds ??= []).push(`talk_${context.targetId}`);
    await this.publish(before, context.kind === "npc_exchange" ? [context.characterId, context.targetId] : [context.characterId], signal);
    return result;
  }
  async executeNpcTalk(id: string, actionId: string, revision: number, goal: string, signal: AbortSignal) {
    const action = courtAgentObservation(projectWorld(this.world()), id).actions.find(action => action.id === actionId && action.type === "talk");
    if (!action || action.path.length > 2 || revision !== this.world().map!.revision || this.activity.conversations[id]?.length
      || this.activity.conversations[action.target]?.length || this.activity.npcActivities?.[id]?.goal !== goal) throw new Error("Conversation changed; replan.");
    return (await this.resolve({ kind: "npc_exchange", characterId: id, targetId: action.target, goal }, signal)).summary;
  }
  async reviewNpcOutcome(id: string, _allowNextGoal = true, signal = new AbortController().signal) {
    const activity = this.activity.npcActivities?.[id];
    if (!activity?.reviewPending || !activity.result) return;
    await this.resolve({ kind: "task_outcome", characterId: id, goal: activity.goal, actions: activity.history, result: activity.result,
      observation: courtAgentObservation(projectWorld(this.world()), id).world.location }, signal);
  }
  async processPerceivedEvent(id: string, event: Event, perception: string, signal = new AbortController().signal) {
    await this.resolve({ kind: "world_event", characterId: id, eventId: event.id, perception }, signal);
  }
  async assessWorldEvent(event: Event, signal: AbortSignal) {
    signal.throwIfAborted();
    const world = this.world(), scenario = projectWorld(world);
    if (!event.position) return { reactions: [] };
    const source = { id: event.participantIds[0] ?? event.id, name: event.kind, position: event.position };
    const listeners = courtCharactersWithinEarshot(source, scenario.characters.filter(c => !event.participantIds.includes(c.id)).map(c => ({
      id: c.id, name: c.name, position: world.map!.actors.find(actor => actor.characterId === c.id)?.position,
    })), world.map!.doors, world.map!.fixtures).filter(listener => perceivesAt(listener.level));
    const perceptions = listeners.map(listener => ({ characterId: listener.id, level: listener.level,
      perception: listener.level === "Clear" ? event.summary : `You notice ${event.participantIds.join(" and ")} ${event.kind}, but cannot make out the details.` }));
    const player = perceptions.find(p => p.characterId === "player");
    return { reactions: perceptions.filter(p => p.characterId !== "player"), ...(player ? { playerPerception: player.perception } : {}) };
  }
  async initiatePlayerConversation(id: string, actionId: string, revision: number, goal: string, signal: AbortSignal) {
    const world = this.world(), token = this.worldGeneration();
    const action = courtAgentObservation(projectWorld(world), id).actions.find(action => action.id === actionId && action.target === "player");
    if (!action || action.path.length > 2 || world.map!.revision !== revision || Object.values(this.activity.conversations).some(turns => turns.length)) throw new Error("Conversation changed; replan.");
    const lore = await documentLore(this.documents.scenario, id);
    const reply = await this.runtime(id, "dialogue").services.ai.responses({ model: "openai/gpt-6-luna", api: "responses", max_tokens: 1000,
      messages: [...lore.initial.map(doc => ({ role: "system" as const, content: doc.markdown })),
        { role: "user", content: `Open a conversation with the player to advance this goal: ${goal}. Speak only your own opening words; do not invent the player's response or physical outcomes.` }],
    }, signal);
    signal.throwIfAborted();
    if (token !== this.worldGeneration() || reply.tool_calls?.length || !reply.content?.trim()) throw new Error("Conversation changed or invalid opening.");
    this.activity.conversations[id] = [toJson(TranscriptMessageSchema, create(TranscriptMessageSchema, { role: TranscriptRole.CHARACTER, speakerId: id, text: reply.content }))];
    (this.activity.npcActivities![id]!.actionIds ??= []).push(actionId);
    return reply.content;
  }
  async logConversationExpression(_id: string) { /* Portrait policy is optional in this host. */ }
}
