import { actorPosition } from "../../../packages/core/src/simulation-movement.js";
import { renderPrompt } from "../../../packages/prompts/src/index.js";
import { earshotNotes } from "./agent-setup.js";
import { arrestResponse } from "../../../packages/conversation/src/conversation-actions.js";
import { decideWait, waitObservation } from "../../../packages/conversation/src/wait.js";
import { characterIntent, routinePath, setIntent } from "../../../packages/lore/src/activity.js";
import { stringify } from "yaml";
import { retryResponses } from "../../../packages/conversation/src/ai.js";
import { traceAiService } from "../../../packages/conversation/src/ai-tracing.js";
import { createScenarioServices } from "../../../packages/lore/src/services.js";
import { beginStranger, strangerTurn, type StrangerState } from "./stranger-interview.js";
import { premadeCharacter } from "./premade-characters.js";
import { playerPublication } from "./stranger-draft.js";
import { portraitExpressions, type PortraitExpression } from "../../../packages/providers/src/conversation-expression.js";
import type { JsonValue } from "@bufbuild/protobuf";
import { runActionExecution, type ActionExecutionContext } from "../../../packages/conversation/src/action-execution.js";
import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { EventSchema, GamePhase, TranscriptMessageSchema, TranscriptRole, type Event } from "../../../packages/contracts/src/index.js";
import type { WorldState } from "../../../packages/contracts/src/v2.js";
import { WorldHost, type WorldSnapshot } from "./world-host.js";
import { characterId } from "../../../packages/lore/src/character-id.js";
import { ConversationRuntime, type ConversationRuntimeOptions } from "../../../packages/conversation/src/runtime.js";
import { prepareConversation } from "../../../packages/conversation/src/conversation.js";
import { runConversation } from "../../../packages/conversation/src/phases.js";
import { runConversationReview } from "../../../packages/conversation/src/review.js";
import { runResolution, type ResolutionContext } from "../../../packages/conversation/src/resolution.js";
import { defaultWorldStrategies } from "./world-strategies.js";
import { documentLoreService } from "../../../packages/conversation/src/document-lore.js";
import { DisclosureSession } from "../../../packages/conversation/src/disclosure.js";
import { runGameMaster } from "../../../packages/conversation/src/game-master.js";
import { checkMechanics, adjudicateResolvedChecks } from "../../../packages/conversation/src/checks.js";
import { ConversationReviews, liveConversationStrategy } from "../../../packages/conversation/src/live-conversation-strategy.js";
import { conversationStrategy } from "../../../packages/conversation/src/conversation-strategy.js";
import { aiService } from "../../../packages/conversation/src/adapters.js";
import { OpenRouterClient, type TextProgress } from "../../../packages/providers/src/openrouter.js";
import { JevClient } from "../../../packages/providers/src/jev.js";
import type { AiService, RollResult } from "../../../packages/conversation/src/services.js";
import { ModelTranscripts, type ModelCallKind } from "./model-transcripts.js";
import { planWorldAction, type PlanningFeedback } from "./world-action.js";
import { courtCharactersWithinEarshot, perceivesAt } from "./earshot.js";

export type WorldOptions = ConversationRuntimeOptions & { movementClock?: import("../../../packages/core/src/movement-service.js").MovementClock };
export { type WorldSnapshot } from "./world-host.js";

export type ConversationStartResult = { ok: true; text: string } | ({ ok: false } & PlanningFeedback);
const conversationChanged = (): ConversationStartResult => ({ ok: false, error: "conversation_changed",
  instruction: renderPrompt("world-runtime-retry-observation") });

export class WorldGameRuntime extends WorldHost {
  private provider: AiService;
  private traces: ModelTranscripts;
  private conversationRuns = new Map<string, string>();
  private liveConversations = new Map<string, { reviews: ConversationReviews; response: ReturnType<typeof liveConversationStrategy>; reviewedLive: boolean }>();
  private finishingReviews = new Set<ConversationReviews>();
  private persistChange: <T>(work: () => T | Promise<T>) => Promise<T> = async work => work();
  setPersistence(commit: <T>(work: () => T | Promise<T>) => Promise<T>) { this.persistChange = commit; }
  private commit<T>(work: () => T | Promise<T>, signal?: AbortSignal, persist = this.persistChange): Promise<T> {
    return persist(() => { signal?.throwIfAborted(); return work(); });
  }
  constructor(world: WorldState, apiKey: string, saved?: WorldSnapshot, changed = () => {}, private readonly warning = (_message: string) => {},
    readonly options: WorldOptions = {}) {
    super(world, saved, options.movementClock);
    Object.assign(this.map, options.services?.map);
    this.provider = aiService(new OpenRouterClient(apiKey, 60_000, globalThis.location?.origin || "http://localhost", warning), new JevClient(apiKey, undefined, undefined, warning), false);
    this.traces = new ModelTranscripts(apiKey, changed);
    this.movement.resume();
  }
  protected override writeSimulation<T>(work: () => T): Promise<T> { return this.commit(work); }
  protected override movementError(error: unknown) { this.warning(String(error)); }
  private random() {
    return { integer: (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1)), ...this.options.services?.random };
  }
  private runtime(id: string, kind: ModelCallKind, extra: WorldOptions = {}, runKey?: string, signal?: AbortSignal, participantIds = [id]) {
    const turnId = crypto.randomUUID(), conversationId = runKey ?? crypto.randomUUID();
    const persist = this.persistChange;
    const world = this.world();
    const random = { ...this.random(), ...extra.services?.random };
    const ai = { ...this.provider, ...this.options.services?.ai, ...extra.services?.ai };
    const scenario = {
      setPlayer: (path: string) => this.commit(() => this.worldServices.scenario.setPlayer(path), signal, persist),
      info: () => this.worldServices.scenario.info(), snapshot: () => this.worldServices.scenario.snapshot(),
      getDocument: (path: string) => this.worldServices.scenario.getDocument(path),
      ...this.options.services?.scenario, ...extra.services?.scenario,
    };
    const respond = extra.services?.character?.respond ?? this.options.services?.character?.respond;
    if (kind === "dialogue" && respond) ai.responses = respond;
    const traced = traceAiService(ai, (subject = id) => {
      const location = actorPosition(this.world().simulation!.map?.actors.find(actor => actor.characterId === subject), this.movement.now());
      return { characterId: subject, participantIds, conversationId, turnId,
        scenario: scenario.info().scenario,
        ...(location ? { location: { x: location.x, y: location.y } } : {}),
      };
    }, (span, request, call) => this.traces.record(span.operation as ModelCallKind, span.characterId, request, call, runKey, span.characterId, span), kind);
    return new ConversationRuntime({ services: {
      ...this.options.services, ...extra.services,
      scenario,
      lore: documentLoreService(scenario, { ...this.options.services?.lore, ...extra.services?.lore }),
      inventory: {
        addToInventory: (...args) => this.commit(() => this.worldServices.inventory.addToInventory(...args), signal, persist),
        removeFromInventory: (...args) => this.commit(() => this.worldServices.inventory.removeFromInventory(...args), signal, persist),
        transferBetweenInventories: (...args) => this.commit(() => this.worldServices.inventory.transferBetweenInventories(...args), signal, persist),
        read: id => this.worldServices.inventory.read(id), commit: changes => this.commit(() => this.worldServices.inventory.commit(changes), signal, persist), ...this.options.services?.inventory, ...extra.services?.inventory },
      docs: {
        commit: (writes, intents) => this.commit(() => this.worldServices.docs.commit(writes, intents), signal, persist),
        read: path => this.worldServices.docs.read(path),
        create: (...args) => this.commit(() => this.worldServices.docs.create(...args), signal, persist),
        replace: (...args) => this.commit(() => this.worldServices.docs.replace(...args), signal, persist),
        insert: (...args) => this.commit(() => this.worldServices.docs.insert(...args), signal, persist),
        delete: (...args) => this.commit(() => this.worldServices.docs.delete(...args), signal, persist),
        ...this.options.services?.docs, ...extra.services?.docs,
      },
      character: { create: input => this.commit(() => this.worldServices.character.create(input), signal, persist), rollCheck: checkMechanics(world.simulation!.runtimeCharacters.player?.dnd,
        () => random.integer(1, 20)), ...this.options.services?.character, ...extra.services?.character },
      map: { ...this.map, ...this.options.services?.map, ...extra.services?.map },
      ai: { ...traced, responses: retryResponses(traced.responses, this.warning) },
      random,
      debug: { record: () => {}, documentUpdated: event => this.traces.documentUpdated(event), ...this.options.services?.debug, ...extra.services?.debug },
      presentation: { renderMap: async () => {}, showRoll: async () => {}, setPortrait: async () => {}, ...this.options.services?.presentation, ...extra.services?.presentation },
    }, strategies: { ...defaultWorldStrategies, ...this.options.strategies, ...extra.strategies,
      review: { ...defaultWorldStrategies.review, ...this.options.strategies?.review, ...extra.strategies?.review },
      actionExecution: { ...defaultWorldStrategies.actionExecution, ...this.options.strategies?.actionExecution, ...extra.strategies?.actionExecution },
      action: { ...defaultWorldStrategies.action, ...this.options.strategies?.action, ...extra.strategies?.action },
      resolution: { ...defaultWorldStrategies.resolution, ...this.options.strategies?.resolution, ...extra.strategies?.resolution },
    } });
  }
  startIntroduction() {
    if (this.world().player || this.activity.stranger?.draft) throw new Error("Character creation is already complete.");
    this.activity.stranger ??= beginStranger(this.world());
  }
  async talkToGameMaster(message: string, onText?: TextProgress) {
    if (!this.activity.stranger) throw new Error("Meet the Stranger first.");
    const before = this.activity.stranger;
    const next = await strangerTurn(before, message, this.worldServices.scenario, this.runtime("gm", "game_master").services, undefined, onText);
    if (this.activity.stranger !== before) throw new Error("The interview changed; retry your reply.");
    this.activity.stranger = next;
    return next.history.at(-1)?.content ?? "";
  }
  async startPremadeCharacter(id: string) {
    const character = premadeCharacter(id);
    if (this.world().player || this.activity.stranger) throw new Error("Start a new game to choose a pre-made character.");
    const before = this.worldServices;
    const next = await strangerTurn({ history: [] }, "Play this pre-made character and enter the hall.",
      this.worldServices.scenario, this.runtime("gm", "game_master").services, undefined, undefined, character);
    if (!next.draft) throw new Error("The GM did not prepare a character. Please try again.");
    const draft = next.draft as { player: { sprite: number } };
    draft.player.sprite = character.sprite;
    if (this.worldServices !== before || this.activity.stranger || this.world().player) throw new Error("Character creation changed; retry saving.");
    await this.publishPlayer(next.draft, next);
    this.activity.stranger = next;
  }
  async confirmPlayer(value: JsonValue) {
    if (!this.activity.stranger?.draft) throw new Error("No character is awaiting review.");
    await this.publishPlayer(value, this.activity.stranger);
  }
  private async publishPlayer(value: JsonValue, stranger: StrangerState) {
    // Creation is single-threaded. Stage the workflow privately so failed document
    // writes cannot leave a half-created player or partially informed court.
    const before = this.worldServices;
    const { impressions, ...character } = playerPublication(value, stranger.draft!, this.world());
    const staged = createScenarioServices(this.world());
    await staged.character.create(character);
    const impressionWrites = [];
    for (const [path, impression] of Object.entries(impressions)) {
      const doc = await staged.docs.read(path);
      const prose = impression.trim().replace(/[\\`*_[\]<>#]/g, "\\$&");
      impressionWrites.push({ path, expectedSha: doc.sha, text: `${doc.text}\n\n## Initial impression of the player\n${prose}\n` });
    }
    await staged.docs.commit(impressionWrites);
    await staged.scenario.setPlayer(character.path);
    const map = staged.currentWorld().simulation!.map!;
    map.phase = GamePhase.CONVERSATIONS;
    map.day = 1;
    staged.mechanics.commit(map, {});
    if (this.worldServices !== before) throw new Error("Character creation changed; retry saving.");
    this.worldServices = staged;
    delete stranger.draft;
    delete stranger.replies;
  }
  async classifyStrangerExpression(recentPortraits: unknown = []): Promise<PortraitExpression | undefined> {
    if (!Array.isArray(recentPortraits) || recentPortraits.some(value => typeof value !== "string" || !Object.hasOwn(portraitExpressions, value))) throw new Error("Invalid portrait history.");
    if (this.world().player || this.activity.stranger?.draft) return;
    const history = (this.activity.stranger?.history ?? []).filter(turn => (turn.role === "user" || turn.role === "assistant") && !turn.tool_calls?.length && turn.content)
      .map(turn => ({ speakerId: turn.role === "assistant" ? "gm" : "player", text: turn.content }));
    if (history.at(-1)?.speakerId !== "gm") return;
    try {
      const result = await this.runtime("gm", "conversation_expression").services.ai.decisions({ characterId: "gm", history, recentPortraits: recentPortraits.slice(-5) },
        { expression: { type: "choice", instructions: renderPrompt("world-runtime-stranger-expression"), criteria: portraitExpressions } }, AbortSignal.timeout(30_000));
      const expression = result.expression?.choice;
      return expression && Object.hasOwn(portraitExpressions, expression) ? expression as PortraitExpression : undefined;
    } catch { return undefined; }
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
  private stopConversations() {
    for (const { reviews } of this.liveConversations.values()) reviews.cancel();
    this.liveConversations.clear();
    for (const reviews of this.finishingReviews) reviews.cancel();
    this.finishingReviews.clear();
    for (const key of this.conversationRuns.values()) this.traces.stop(key);
    this.conversationRuns.clear();
  }
  override restore(saved: WorldSnapshot) {
    if (this.conversationRuns) this.stopConversations();
    super.restore(saved);
  }
  override reset() { super.reset(); this.stopConversations(); this.traces.clearDocumentWrites(); }
  override resetCharacters() { super.resetCharacters(); this.stopConversations(); this.traces.clearDocumentWrites(); }
  recentTranscripts() { return this.traces.recent(); }
  transcriptRuns() { return this.traces.runs(); }
  debugDocuments() {
    const world = this.world();
    const paths = [...world.characters, ...(world.player ? [world.player] : [])];
    return { docs: world.docs, history: this.traces.documentWrites(), scenario: world.scenario,
      characterPaths: Object.fromEntries([...Object.values(world.simulation!.runtimeCharacters).map(character => [character.id, character.document]), ...(world.player ? [["player", world.player]] : [])]) };
  }
  startPlanningSession(id: string) { return this.traces.start("npc_goal", id); }
  endPlanningSession(key: string, stopped: boolean, error?: unknown) {
    if (error) this.traces.fail(key, error); else if (stopped) this.traces.stop(key); else this.traces.finish(key);
  }
  private conversationRun(id: string) {
    let key = this.conversationRuns.get(id);
    if (!key) {
      key = this.traces.start("character", id, id, { participants: [id, "player"] }, [id, "player"]);
      this.conversationRuns.set(id, key);
    }
    return key;
  }
  async checkedTalkToCharacter(id: string, message: string, thinking?: (text: string) => void, options: WorldOptions = {}, signal = new AbortController().signal, onText?: TextProgress) {
    const persist = this.persistChange;
    this.assertPlayerFree();
    if (!message.trim()) throw new Error("Say something first.");
    if (this.activity.conversationEndRequested?.[id]) throw new Error("Finish the conversation review first.");
    let session = this.liveConversations.get(id);
    if (!session) {
      const reviews = new ConversationReviews();
      session = { reviews, response: liveConversationStrategy({ characterId: id, reviews }), reviewedLive: true };
      this.liveConversations.set(id, session);
    }
    const strategyOverride = options.strategies?.conversation ?? this.options.strategies?.conversation;
    if (strategyOverride) session.reviewedLive = false;
    else signal = AbortSignal.any([signal, session.reviews.signal]);
    signal.throwIfAborted();
    const previous = structuredClone(this.activity.conversations[id] ?? []);
    const runtime = this.runtime(id, "dialogue", options, this.conversationRun(id), signal, [id, "player"]);
    const defending = !!this.activity.arrestChallenges?.[id], defenseRolls: RollResult[] = [];
    const rollCheck = runtime.services.character.rollCheck;
    runtime.services.character.rollCheck = async (...args) => {
      const result = await rollCheck(...args);
      if (defending && result.characterId === "player") defenseRolls.push(result);
      return result;
    };
    const lore = await runtime.services.lore.forCharacter(id, signal);
    const disclosure = new DisclosureSession(lore, runtime.services.ai, 0.7);
    const world = this.world(), build = world.simulation!.runtimeCharacters.player?.dnd;
    const strategies = conversationStrategy(disclosure, runtime.services.ai, build, message,
      async (_check, cancellation) => { cancellation.throwIfAborted(); return runtime.services.random.integer(1, 20); },
      () => {}, () => {}, runtime.services.presentation, runtime.services.character, { services: runtime.services, characterId: id }, () => {}, session.response);
    runtime.strategies.conversation = strategyOverride ?? strategies;
    runtime.services.character.respond = (request, cancellation) => runtime.services.ai.responses(request, cancellation);
    const transcript = previous.map(turn => fromJson(TranscriptMessageSchema, turn));
    const request = await prepareConversation({ snapshot: { world }, characterId: id, sources: lore.initial, transcript, message }, runtime.services, signal);
    if (defending) request.messages = [...request.messages, { role: "system", content: renderPrompt("world-runtime-arrest-defense") }];
    thinking?.("Considering your words…");
    const rulings: string[] = [], preparedRulings: string[] = [], arrestRulings: string[] = [];
    const entry = characterIntent(world, id).entry;
    const granted = entry && world.docs[entry]!.frontmatter?.conversation_actions;
    let arrested = false, challenged = false;
    const existingRulings = new Map<string, number>();
    for (const turn of request.messages) {
      if (turn.role === "system" && turn.content?.startsWith("# Binding DM ruling")) {
        existingRulings.set(turn.content, (existingRulings.get(turn.content) ?? 0) + 1);
      }
    }
    const prepared = (request: import("../../../packages/providers/src/openrouter.js").ChatCompletionRequest) => {
      // History is already saved. Count occurrences so a new, identical ruling is still retained.
      preparedRulings.length = 0;
      const remaining = new Map(existingRulings);
      for (const turn of request.messages) {
        if (turn.role !== "system" || !turn.content?.startsWith("# Binding DM ruling")) continue;
        const count = remaining.get(turn.content) ?? 0;
        if (count) remaining.set(turn.content, count - 1);
        else preparedRulings.push(turn.content);
      }
    };
    if (Array.isArray(granted) && granted.includes("arrest")) {
      const respond = arrestResponse(runtime.services.ai.responses, ruling => {
        arrested = true; arrestRulings.push(ruling);
      }, { outcome: () => !defending || !defenseRolls.length ? "unheard" : defenseRolls.some(roll => roll.success) ? "passed" : "failed",
        challenge: () => { challenged = true; } });
      runtime.services.character.respond = async (request, cancellation = signal) => {
        arrested = false; challenged = false; arrestRulings.length = 0;
        if (defending && !defenseRolls.length) {
          const result = await runtime.services.character.rollCheck({ characterId: "player", skill: "persuasion", difficulty: "normal" }, cancellation);
          const ruling = await adjudicateResolvedChecks({ results: [result], messages: request.messages, signal: cancellation,
            complete: (request, cancellation) => runGameMaster(request, runtime.services, cancellation, { characterId: id }),
            present: runtime.services.presentation.showRoll });
          if (ruling) rulings.push(ruling);
        }
        if (rulings.length) request = { ...request, messages: [...request.messages,
          ...rulings.map(content => ({ role: "system" as const, content })),
        ] };
        return respond(request, cancellation);
      };
    }
    const reply = await runConversation(request, runtime, signal, prepared);
    if (reply.tool_calls?.length || !reply.content?.trim()) throw new Error("Expected a character reply without tool calls.");
    await this.commit(() => {
      if (JSON.stringify(previous) !== JSON.stringify(this.activity.conversations[id] ?? [])) throw new Error("Conversation changed; retry the turn.");
      this.assertPlayerFree();
      if (!!this.activity.arrestChallenges?.[id] !== defending) throw new Error("Arrest challenge changed; retry the turn.");
      if (challenged) (this.activity.arrestChallenges ??= {})[id] = true;
      if (arrested || defenseRolls.some(roll => roll.success)) delete this.activity.arrestChallenges?.[id];
      if (arrested) {
        this.activity.jail = { characterId: id, message: reply.content! };
        (this.activity.conversationEndRequested ??= {})[id] = true;
      }
      this.activity.conversations[id] = [...previous,
        ...earshotNotes(request.messages, transcript).map(turn => toJson(TranscriptMessageSchema, turn)),
        toJson(TranscriptMessageSchema, create(TranscriptMessageSchema, { role: TranscriptRole.PLAYER, speakerId: "player", text: message })),
        ...[...preparedRulings, ...rulings, ...arrestRulings].map(text => toJson(TranscriptMessageSchema, create(TranscriptMessageSchema, { role: TranscriptRole.GAME_MASTER, speakerId: "GM", text }))),
        toJson(TranscriptMessageSchema, create(TranscriptMessageSchema, { role: TranscriptRole.CHARACTER, speakerId: id, text: reply.content! })),
      ];
    }, signal, persist);
    onText?.(reply.content!);
    return reply.content;
  }
  endConversationAsPlayer(id: string, message: string) {
    if (!message.trim()) throw new Error("Say something first.");
    const session = this.liveConversations.get(id);
    if (session) session.reviewedLive = false;
    (this.activity.conversations[id] ??= []).push(toJson(TranscriptMessageSchema,
      create(TranscriptMessageSchema, { role: TranscriptRole.PLAYER, speakerId: "player", text: message })));
    (this.activity.conversationEndRequested ??= {})[id] = true;
  }
  async endConversation(id: string, signal = new AbortController().signal) {
    const session = this.liveConversations.get(id), reviews = session?.reviews;
    if (reviews) signal = AbortSignal.any([signal, reviews.signal]);
    const persist = this.persistChange;
    const previous = structuredClone(this.activity.conversations[id] ?? []);
    const transcript = previous.map(turn => fromJson(TranscriptMessageSchema, turn));
    if (!transcript.length) return;
    const event = await this.commit(() => {
      if (JSON.stringify(previous) !== JSON.stringify(this.activity.conversations[id] ?? [])) throw new Error("Conversation changed.");
      const pending = (this.activity.pendingConversationEvents ??= {});
      const event = pending[id] ? fromJson(EventSchema, pending[id]) : this.worldEvent("having a conversation",
        transcript.filter(turn => turn.role !== TranscriptRole.GAME_MASTER).map(turn => `${turn.speakerId}: ${turn.text}`).join("\n"), [id, "player"]);
      pending[id] = toJson(EventSchema, event);
      (this.activity.conversationEndRequested ??= {})[id] = true;
      this.recordPlayerPerception(event, event.summary);
      return event;
    }, signal, persist);
    await this.presentMap().catch(error => this.warning(String(error)));
    const key = this.conversationRun(id);
    signal.throwIfAborted();
    if (!session?.reviewedLive) {
      await reviews?.drain();
      await runConversationReview({ characterId: id, participants: [id, "player"], transcript }, this.runtime(id, "conversation_review", {}, key, signal, [id, "player"]), signal);
    }
    await this.commit(() => {
      if (JSON.stringify(previous) !== JSON.stringify(this.activity.conversations[id] ?? [])) throw new Error("Conversation changed.");
      delete this.activity.conversations[id]; delete this.activity.conversationEndRequested?.[id]; delete this.activity.conversationReplyOptions?.[id];
      this.syncGoals();
      delete this.activity.pendingConversationEvents?.[id];
    }, signal, persist);
    const finishTrace = () => this.traces.finish(key, { participants: [id, "player"], messages: transcript });
    if (reviews && session?.reviewedLive) {
      this.finishingReviews.add(reviews);
      void reviews.drain().then(finishTrace, error => {
        if (reviews.signal.aborted) this.traces.stop(key);
        else { this.traces.fail(key, error); this.warning(`${id}: live conversation review: ${String(error)}`); }
      }).finally(() => { this.finishingReviews.delete(reviews); });
    } else finishTrace();
    this.conversationRuns.delete(id);
    this.liveConversations.delete(id);
    return event;
  }
  async planNpc(id: string, signal: AbortSignal, conflict?: PlanningFeedback, runKey?: string) {
    if (this.activity.conversations[id]?.length || this.activity.npcActivities?.[id]?.reviewPending) throw new Error("NPC paused for conversation or review.");
    const work = (key: string) => planWorldAction(id, this.runtime(id, "jev", {}, key), signal, this.activity.npcActivities?.[id]?.actionIds ?? [], conflict);
    const plan = await (runKey ? work(runKey) : this.traces.group("npc_goal", id, id, work));
    if (!plan) throw new Error("NPC has no active goal.");
    return plan;
  }
  private async resolve(context: ResolutionContext, signal: AbortSignal) {
    const persist = this.persistChange;
    const kind = context.kind === "npc_exchange" ? "npc_resolution" : context.kind === "world_event" ? "world_event" : "outcome_review";
    const participants = context.kind === "npc_exchange" ? [context.characterId, context.targetId] : [context.characterId];
    const key = this.traces.start(kind, context.characterId, context.characterId, context, participants);
    try {
      const result = await runResolution(context, this.runtime(context.characterId, kind, {}, key, signal, participants), signal);
      await this.commit(() => {
        this.syncGoals();
        if (context.kind === "task_outcome") {
          const activity = this.activity.npcActivities![context.characterId]!;
          activity.reviewPending = false; activity.status = activity.goal ? "active" : "idle";
          activity.history = []; activity.actionIds = [];
        }
        if (context.kind === "npc_exchange") (this.activity.npcActivities![context.characterId]!.actionIds ??= []).push(`talk_${context.targetId}`);
      }, signal, persist);
      this.traces.finish(key);
      return result;
    } catch (error) { this.traces.fail(key, error); throw error; }
  }
  async executeNpcTalk(id: string, actionId: string, revision: number, goal: string, signal: AbortSignal): Promise<ConversationStartResult> {
    signal.throwIfAborted();
    const observation = this.map.observe(id);
    const action = observation.actions.find(action => action.id === actionId && action.type === "talk");
    if (!action || action.path.length > 2 || revision !== observation.map.revision || this.activity.conversations[id]?.length
      || this.activity.conversations[action.target]?.length || this.activity.npcActivities?.[id]?.goal !== goal) return conversationChanged();
    return { ok: true, text: (await this.resolve({ kind: "npc_exchange", characterId: id, targetId: action.target, goal }, signal)).summary };
  }
  async reviewNpcOutcome(id: string, _allowNextGoal = true, signal = new AbortController().signal) {
    const pending = this.activity.pendingWaitReviews?.[id];
    if (pending) {
      await this.resolve({ kind: "wait_ended", characterId: id, ...pending }, signal);
      await this.commit(() => { delete this.activity.pendingWaitReviews?.[id]; }, signal);
      return;
    }
    const activity = this.activity.npcActivities?.[id];
    if (!activity?.reviewPending || !activity.result) return;
    if (activity.result.reason === "complete") {
      await this.commit(async () => {
        const world = this.world(), intent = characterIntent(world, id);
        const before = await this.worldServices.docs.read(intent.entry);
        await setIntent(this.worldServices, before, { activity: null, wait: routinePath(world, id) }, before.document.body, intent);
        this.syncGoals();
        const next = this.activity.npcActivities![id]!;
        next.reviewPending = false; next.history = []; next.actionIds = [];
      }, signal);
      return;
    }
    const { map } = this.map.observe(id), actor = map.actors.find(actor => actor.characterId === id);
    await this.resolve({ kind: "task_outcome", characterId: id, goal: activity.goal, actions: activity.history, result: activity.result,
      observation: { roomId: actor?.roomId, room: map.rooms.find(room => room.id === actor?.roomId)?.name, position: actorPosition(actor, this.movement.now()) } }, signal);
  }
  waitingCharacters(): string[] {
    const world = this.world();
    return Object.values(world.simulation!.runtimeCharacters).filter(character => character.characterId !== "player").flatMap(({ id }) => {
      const intent = characterIntent(world, id);
      return (!intent.activity && intent.wait || this.activity.pendingWaitReviews?.[id]) ? [id] : [];
    });
  }
  async checkWait(id: string, elapsedSeconds: number, signal = new AbortController().signal) {
    if (this.activity.conversations[id]?.length) return;
    if (this.activity.pendingWaitReviews?.[id]) { await this.reviewNpcOutcome(id, true, signal); return; }
    if (this.activity.npcActivities?.[id]?.reviewPending) return;
    const runtime = this.runtime(id, "jev", {}, undefined, signal);
    const decision = await decideWait(id, elapsedSeconds, runtime.services, signal);
    if (!decision) return;
    await this.commit(async () => {
      if (this.activity.conversations[id]?.length || waitObservation(runtime.services, id) !== decision.observation) return;
      const intent = characterIntent(this.world(), id);
      if (intent.actorId !== decision.intent.actorId || intent.activity || intent.wait !== decision.wait.path) return;
      const next = decision.choice.startsWith("set_activity:") ? decision.choice.slice("set_activity:".length) : null;

      await this.worldServices.docs.commit([
        ...[decision.wait, ...decision.targets].map(doc => ({ path: doc.path, expectedSha: doc.sha, text: doc.text })),
        { path: decision.character.path, expectedSha: decision.character.sha,
          text: decision.character.text },
      ], [{ ...decision.intent, activity: next, wait: decision.choice === "continue" ? decision.wait.path : null }]);
      if (decision.choice === "stop_waiting") (this.activity.pendingWaitReviews ??= {})[id] = {
        instructions: decision.wait.document.body, observation: decision.observation,
      };
      this.syncGoals();
    }, signal);
    if (this.activity.pendingWaitReviews?.[id]) await this.reviewNpcOutcome(id, true, signal);
    return decision.choice;
  }
  async processPerceivedEvent(id: string, event: Event, perception: string, signal = new AbortController().signal) {
    await this.resolve({ kind: "world_event", characterId: id, eventId: event.id, perception }, signal);
  }
  async assessWorldEvent(event: Event, signal: AbortSignal) {
    signal.throwIfAborted();
    const world = this.world(), map = world.simulation!.map;
    if (!map) throw new Error("A physical map is required.");
    // Perception needs identities and public names, not character lore or mechanics.
    const names = new Map([...Object.values(world.simulation!.runtimeCharacters).filter(character => character.characterId !== "player").map(character => ({ id: character.id, path: character.document })), ...(world.player ? [{ id: "player", path: world.player }] : [])].map(({ id, path }) => {
      const doc = world.docs[path];
      if (!doc) throw new Error(`Missing character document: ${path}`);
      return [id, typeof doc.frontmatter?.name === "string" ? doc.frontmatter.name : id];
    }));
    const random = this.random();
    const ownEvent = event.participantIds.includes("player");
    if (!event.position) return { reactions: [], ...(ownEvent ? { playerPerception: event.summary } : {}) };
    const source = { id: event.participantIds[0] ?? event.id, name: event.kind, position: event.position };
    const listeners = courtCharactersWithinEarshot(source, [...names].filter(([id]) => !event.participantIds.includes(id)).flatMap(([id, name]) => map.actors.filter(actor => actor.characterId === id)
      .map(actor => ({ id, name, position: actorPosition(actor, this.movement.now()) }))), map.doors, map.fixtures, map.layout).filter(listener => perceivesAt(listener.level, () => (random.integer(1, 100) - 1) / 100, listener.id === "player"));
    const perceptions = listeners.map(listener => ({ characterId: listener.id, level: listener.level,
      perception: listener.level === "Clear" ? event.summary : `You notice ${event.participantIds.map(id => names.get(id) ?? id).join(" and ")} ${event.kind}, but cannot make out the details.` }));
    const player = perceptions.find(p => p.characterId === "player");
    return { reactions: perceptions.filter(p => p.characterId !== "player"), ...(ownEvent ? { playerPerception: event.summary } : player ? { playerPerception: player.perception } : {}) };
  }
  async initiatePlayerConversation(id: string, actionId: string, revision: number, goal: string, signal: AbortSignal): Promise<ConversationStartResult> {
    signal.throwIfAborted();
    this.assertPlayerFree();
    const persist = this.persistChange;
    const world = this.world();
    const available = () => {
      const current = this.map.observe(id);
      const talk = current.actions.find(action => action.id === actionId && action.type === "talk" && action.target === "player");
      return talk && talk.path.length <= 2 && current.map.revision === revision
        && this.activity.npcActivities?.[id]?.goal === goal && !Object.values(this.activity.conversations).some(turns => turns.length);
    };
    if (!available()) return conversationChanged();
    const runtime = this.runtime(id, "dialogue", {}, this.conversationRun(id), signal, [id, "player"]);
    const lore = await runtime.services.lore.forCharacter(id, signal);
    // Opening speech can disclose lore, but there is no player utterance to check.
    const disclosure = new DisclosureSession(lore, runtime.services.ai, 0.7).strategy(() => {});
    runtime.strategies.conversation = this.options.strategies?.conversation ?? disclosure;
    let challenged = false;
    const granted = world.docs[characterIntent(world, id).entry]!.frontmatter?.conversation_actions;
    runtime.services.character.respond = Array.isArray(granted) && granted.includes("arrest")
      ? arrestResponse(runtime.services.ai.responses, () => { throw new Error("An opening cannot execute an arrest."); },
        { outcome: () => "unheard", challenge: () => { challenged = true; } }) : runtime.services.ai.responses;
    const request = await prepareConversation({ snapshot: { world }, characterId: id, sources: lore.initial, transcript: [],
      message: renderPrompt("world-runtime-npc-opening", { goal: goal }) }, runtime.services, signal);
    const actor = world.simulation!.map!.actors.find(actor => actor.characterId === id)!;
    const room = world.simulation!.map!.rooms.find(room => room.id === actor.roomId)!;
    const openingRequest = { ...request, messages: [...request.messages, { role: "user" as const, content: JSON.stringify({ currentObservation: JSON.parse(waitObservation(runtime.services, id)),
      roomAccess: { private: room.private, playerAuthorized: !room.private || room.allowedCharacterIds.includes("player") } }) }] };
    const reply = await runConversation(openingRequest, runtime, signal);
    signal.throwIfAborted();
    if (reply.tool_calls?.length || !reply.content?.trim()) throw new Error("Invalid conversation opening.");
    return this.commit((): ConversationStartResult => {
      if (!available()) return conversationChanged();
      if (challenged) (this.activity.arrestChallenges ??= {})[id] = true;
      this.activity.conversations[id] = [...earshotNotes(request.messages).map(turn => toJson(TranscriptMessageSchema, turn)), toJson(TranscriptMessageSchema, create(TranscriptMessageSchema, { role: TranscriptRole.CHARACTER, speakerId: id, text: reply.content! }))];
      (this.activity.npcActivities![id]!.actionIds ??= []).push(actionId);
      return { ok: true, text: reply.content! };
    }, signal, persist);
  }
  async logConversationExpression(_id: string) { /* Portrait policy is optional in this host. */ }
}
