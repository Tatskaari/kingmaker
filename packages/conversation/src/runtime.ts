import { setupAgent, type AgentSetupHook } from "./agent-setup.js";
import { ProgressiveDisclosure } from "./progressive-disclosure.js";
import type { ActionExecutionStrategy } from "./action-execution.js";
import type { ResolutionStrategy } from "./resolution.js";
import type { ActionStrategy } from "./action.js";
import type { RuntimeServices } from "./services.js";
import type { ConversationReviewStrategy, ReviewLabels } from "./review.js";
import type { ConversationStrategy } from "./phases.js";

/** Strategies group policy hooks; each callback (respond, prepare, classify, resolve) is a hook. */
export interface RuntimeStrategies<Review = ReviewLabels> { setup: { prepare: AgentSetupHook }; conversation: ConversationStrategy; review: ConversationReviewStrategy<Review>; action: ActionStrategy; actionExecution: ActionExecutionStrategy; resolution: ResolutionStrategy }

export interface ConversationRuntimeOptions<Review = ReviewLabels> {
  services?: { [Service in keyof RuntimeServices]?: Partial<RuntimeServices[Service]> };
  strategies?: { setup?: { prepare: AgentSetupHook }; conversation?: ConversationStrategy; review?: Partial<ConversationReviewStrategy<Review>>; action?: Partial<ActionStrategy>; actionExecution?: Partial<ActionExecutionStrategy>; resolution?: Partial<ResolutionStrategy> };
  maxPasses?: number;
}

export class UnimplementedServiceError extends Error {
  constructor(readonly operation: string) {
    super(`Unimplemented service: ${operation}`);
    this.name = "UnimplementedServiceError";
  }
}

const unimplemented = (operation: string): never => { throw new UnimplementedServiceError(operation); };

/** Conversation, review and action dependencies and strategies, supplied by the host. */
export class ConversationRuntime<Review = ReviewLabels> {
  readonly services: RuntimeServices;
  readonly strategies: RuntimeStrategies<Review>;
  readonly maxPasses: number;

  constructor({ services = {}, strategies, maxPasses = 16 }: ConversationRuntimeOptions<Review> = {}) {
    if (!Number.isSafeInteger(maxPasses) || maxPasses < 1) throw new Error("maxPasses must be a positive integer.");
    this.maxPasses = maxPasses;
    this.strategies = { setup: strategies?.setup ?? { prepare: setupAgent }, conversation: strategies?.conversation ?? {
      respond: async () => unimplemented("strategies.conversation.respond"),
    }, review: {
      classify: strategies?.review?.classify ?? (async () => unimplemented("strategies.review.classify")),
      resolve: strategies?.review?.resolve ?? (async () => unimplemented("strategies.review.resolve")),
    }, resolution: {
      classify: strategies?.resolution?.classify ?? (async () => unimplemented("strategies.resolution.classify")),
      resolve: strategies?.resolution?.resolve ?? (async () => unimplemented("strategies.resolution.resolve")),
    }, actionExecution: {
      classify: strategies?.actionExecution?.classify ?? (async () => unimplemented("strategies.actionExecution.classify")),
      resolve: strategies?.actionExecution?.resolve ?? (async () => unimplemented("strategies.actionExecution.resolve")),
    }, action: {
      classify: strategies?.action?.classify ?? (async () => unimplemented("strategies.action.classify")),
      resolve: strategies?.action?.resolve ?? (async () => unimplemented("strategies.action.resolve")),
    } };
    this.services = {
      agents: { prepare: async (context, signal) => {
        signal.throwIfAborted();
        const messages = await (services.agents?.prepare
          ? services.agents.prepare(context, signal)
          : this.strategies.setup.prepare({ ...context, messages: structuredClone(context.messages) }, signal, this.services));
        signal.throwIfAborted();
        return messages;
      } },
      map: {
        layout: () => services.map?.layout ? services.map.layout() : unimplemented("map.layout"),
        observe: (...args) => services.map?.observe ? services.map.observe(...args) : unimplemented("map.observe"),
        interact: (...args) => services.map?.interact ? services.map.interact(...args) : unimplemented("map.interact"),
      },
      scenario: {
        setPlayer: async path => services.scenario?.setPlayer ? services.scenario.setPlayer(path) : unimplemented("scenario.setPlayer"),
        info: () => services.scenario?.info ? services.scenario.info() : unimplemented("scenario.info"),
        snapshot: () => services.scenario?.snapshot ? services.scenario.snapshot() : unimplemented("scenario.snapshot"),
        getDocument: async path => services.scenario?.getDocument
          ? services.scenario.getDocument(path) : unimplemented("scenario.getDocument"),
      },
      docs: {
        commit: async (writes, intents) => services.docs?.commit ? services.docs.commit(writes, intents) : unimplemented("docs.commit"),
        read: async (...args) => services.docs?.read ? services.docs.read(...args) : unimplemented("docs.read"),
        create: async (...args) => services.docs?.create ? services.docs.create(...args) : unimplemented("docs.create"),
        replace: async (...args) => services.docs?.replace ? services.docs.replace(...args) : unimplemented("docs.replace"),
        insert: async (...args) => services.docs?.insert ? services.docs.insert(...args) : unimplemented("docs.insert"),
        delete: async (...args) => services.docs?.delete ? services.docs.delete(...args) : unimplemented("docs.delete"),
      },
      ai: {
        decisions: async (...args) => services.ai?.decisions
          ? services.ai.decisions(...args) : unimplemented("ai.decisions"),
        responses: async (...args) => services.ai?.responses
          ? services.ai.responses(...args) : unimplemented("ai.responses"),
      },
      disclosure: { disclose: (...args) => services.disclosure?.disclose
        ? services.disclosure.disclose(...args)
        : new ProgressiveDisclosure(this.services.ai).disclose(...args) },
      lore: {
        forCharacter: async (...args) => services.lore?.forCharacter
          ? services.lore.forCharacter(...args) : unimplemented("lore.forCharacter"),
        get initial() { return services.lore?.initial ?? unimplemented("lore.initial"); },
        links: (...args) => services.lore?.links
          ? services.lore.links(...args) : unimplemented("lore.links"),
        open: async (...args) => services.lore?.open
          ? services.lore.open(...args) : unimplemented("lore.open"),
      },
      character: {
        create: async input => services.character?.create ? services.character.create(input) : unimplemented("character.create"),
        rollCheck: async (...args) => services.character?.rollCheck
          ? services.character.rollCheck(...args) : unimplemented("character.rollCheck"),
        rollSave: async (...args) => services.character?.rollSave
          ? services.character.rollSave(...args) : unimplemented("character.rollSave"),
        respond: async (...args) => services.character?.respond
          ? services.character.respond(...args) : unimplemented("character.respond"),
      },
      presentation: {
        renderMap: async (...args) => services.presentation?.renderMap ? services.presentation.renderMap(...args) : unimplemented("presentation.renderMap"),
        showRoll: async (...args) => services.presentation?.showRoll
          ? services.presentation.showRoll(...args) : unimplemented("presentation.showRoll"),
        setPortrait: async (...args) => services.presentation?.setPortrait
          ? services.presentation.setPortrait(...args) : unimplemented("presentation.setPortrait"),
      },
      random: { integer: (...args) => services.random?.integer
        ? services.random.integer(...args) : unimplemented("random.integer") },
      debug: { documentUpdated: event => services.debug?.documentUpdated?.(event), record: (...args) => services.debug?.record
        ? services.debug.record(...args) : unimplemented("debug.record") },
    };
  }

  get character() { return this.services.character; }
}
