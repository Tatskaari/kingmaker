import type { ResolutionHooks } from "./resolution.js";
import type { ActionHooks } from "./action.js";
import type { RuntimeServices } from "./services.js";
import type { ConversationReviewHooks, ReviewLabels } from "./review.js";
import type { ConversationHooks } from "./phases.js";

export interface ConversationRuntimeOptions<Labels = Record<string, never>, Review = ReviewLabels> {
  services?: { [Service in keyof RuntimeServices]?: Partial<RuntimeServices[Service]> };
  hooks?: { conversation?: ConversationHooks<Labels>; review?: Partial<ConversationReviewHooks<Review>>; action?: Partial<ActionHooks>; resolution?: Partial<ResolutionHooks> };
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
  readonly hooks: { conversation: ConversationHooks<Labels>; review: ConversationReviewHooks<Review>; action: ActionHooks; resolution: ResolutionHooks };
  readonly maxPasses: number;

  constructor({ services = {}, hooks, maxPasses = 16 }: ConversationRuntimeOptions<Labels, Review> = {}) {
    if (!Number.isSafeInteger(maxPasses) || maxPasses < 1) throw new Error("maxPasses must be a positive integer.");
    this.maxPasses = maxPasses;
    this.hooks = { conversation: hooks?.conversation ?? {
      classify: async () => unimplemented("hooks.conversation.classify"),
      resolve: async () => unimplemented("hooks.conversation.resolve"),
    }, review: {
      classify: hooks?.review?.classify ?? (async () => unimplemented("hooks.review.classify")),
      resolve: hooks?.review?.resolve ?? (async () => unimplemented("hooks.review.resolve")),
    }, resolution: {
      classify: hooks?.resolution?.classify ?? (async () => unimplemented("hooks.resolution.classify")),
      resolve: hooks?.resolution?.resolve ?? (async () => unimplemented("hooks.resolution.resolve")),
    }, action: {
      classify: hooks?.action?.classify ?? (async () => unimplemented("hooks.action.classify")),
      resolve: hooks?.action?.resolve ?? (async () => unimplemented("hooks.action.resolve")),
    } };
    this.services = {
      scenario: {
        info: () => services.scenario?.info ? services.scenario.info() : unimplemented("scenario.info"),
        snapshot: () => services.scenario?.snapshot ? services.scenario.snapshot() : unimplemented("scenario.snapshot"),
        getDocument: async path => services.scenario?.getDocument
          ? services.scenario.getDocument(path) : unimplemented("scenario.getDocument"),
      },
      docs: {
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
      lore: {
        get initial() { return services.lore?.initial ?? unimplemented("lore.initial"); },
        links: (...args) => services.lore?.links
          ? services.lore.links(...args) : unimplemented("lore.links"),
        open: async (...args) => services.lore?.open
          ? services.lore.open(...args) : unimplemented("lore.open"),
      },
      character: {
        rollCheck: async (...args) => services.character?.rollCheck
          ? services.character.rollCheck(...args) : unimplemented("character.rollCheck"),
        rollSave: async (...args) => services.character?.rollSave
          ? services.character.rollSave(...args) : unimplemented("character.rollSave"),
        respond: async (...args) => services.character?.respond
          ? services.character.respond(...args) : unimplemented("character.respond"),
      },
      presentation: {
        showRoll: async (...args) => services.presentation?.showRoll
          ? services.presentation.showRoll(...args) : unimplemented("presentation.showRoll"),
        setPortrait: async (...args) => services.presentation?.setPortrait
          ? services.presentation.setPortrait(...args) : unimplemented("presentation.setPortrait"),
      },
      random: { integer: (...args) => services.random?.integer
        ? services.random.integer(...args) : unimplemented("random.integer") },
      debug: { record: (...args) => services.debug?.record
        ? services.debug.record(...args) : unimplemented("debug.record") },
    };
  }

  get character() { return this.services.character; }
}
