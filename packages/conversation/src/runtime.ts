import { setupAgent, type AgentSetupHook } from "./agent-setup.js";
import { ProgressiveDisclosure } from "./progressive-disclosure.js";
import type { ActionExecutionHooks } from "./action-execution.js";
import type { ResolutionHooks } from "./resolution.js";
import type { ActionHooks } from "./action.js";
import type { RuntimeServices } from "./services.js";
import type { ConversationReviewHooks, ReviewLabels } from "./review.js";
import type { ConversationHooks } from "./phases.js";

export interface ConversationRuntimeOptions<Labels = Record<string, never>, Review = ReviewLabels> {
  services?: { [Service in keyof RuntimeServices]?: Partial<RuntimeServices[Service]> };
  hooks?: { setup?: AgentSetupHook; conversation?: ConversationHooks<Labels>; review?: Partial<ConversationReviewHooks<Review>>; action?: Partial<ActionHooks>; actionExecution?: Partial<ActionExecutionHooks>; resolution?: Partial<ResolutionHooks> };
  maxPasses?: number;
}

export class UnimplementedServiceError extends Error {
  constructor(readonly operation: string) {
    super(`Unimplemented service: ${operation}`);
    this.name = "UnimplementedServiceError";
  }
}

const unimplemented = (operation: string): never => { throw new UnimplementedServiceError(operation); };

/** Conversation, review and action dependencies and hooks, supplied by the host. */
export class ConversationRuntime<Labels = Record<string, never>, Review = ReviewLabels> {
  readonly services: RuntimeServices;
  readonly hooks: { setup: AgentSetupHook; conversation: ConversationHooks<Labels>; review: ConversationReviewHooks<Review>; action: ActionHooks; actionExecution: ActionExecutionHooks; resolution: ResolutionHooks };
  readonly maxPasses: number;

  constructor({ services = {}, hooks, maxPasses = 16 }: ConversationRuntimeOptions<Labels, Review> = {}) {
    if (!Number.isSafeInteger(maxPasses) || maxPasses < 1) throw new Error("maxPasses must be a positive integer.");
    this.maxPasses = maxPasses;
    this.hooks = { setup: hooks?.setup ?? setupAgent, conversation: hooks?.conversation ?? {
      classify: async () => unimplemented("hooks.conversation.classify"),
      resolve: async () => unimplemented("hooks.conversation.resolve"),
    }, review: {
      classify: hooks?.review?.classify ?? (async () => unimplemented("hooks.review.classify")),
      resolve: hooks?.review?.resolve ?? (async () => unimplemented("hooks.review.resolve")),
    }, resolution: {
      classify: hooks?.resolution?.classify ?? (async () => unimplemented("hooks.resolution.classify")),
      resolve: hooks?.resolution?.resolve ?? (async () => unimplemented("hooks.resolution.resolve")),
    }, actionExecution: {
      classify: hooks?.actionExecution?.classify ?? (async () => unimplemented("hooks.actionExecution.classify")),
      resolve: hooks?.actionExecution?.resolve ?? (async () => unimplemented("hooks.actionExecution.resolve")),
    }, action: {
      classify: hooks?.action?.classify ?? (async () => unimplemented("hooks.action.classify")),
      resolve: hooks?.action?.resolve ?? (async () => unimplemented("hooks.action.resolve")),
    } };
    this.services = {
      agents: { prepare: async (context, signal) => {
        signal.throwIfAborted();
        const messages = await (services.agents?.prepare
          ? services.agents.prepare(context, signal)
          : this.hooks.setup({ ...context, messages: structuredClone(context.messages) }, signal, this.services));
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
