import type { RuntimeServices } from "./services.js";
import type { ConversationHooks } from "./phases.js";

export interface ConversationRuntimeOptions<Labels = Record<string, never>> {
  services?: { [Service in keyof RuntimeServices]?: Partial<RuntimeServices[Service]> };
  hooks?: { conversation: ConversationHooks<Labels> };
  maxPasses?: number;
}

export class UnimplementedServiceError extends Error {
  constructor(readonly operation: string) {
    super(`Unimplemented service: ${operation}`);
    this.name = "UnimplementedServiceError";
  }
}

const unimplemented = (operation: string): never => { throw new UnimplementedServiceError(operation); };

/** Conversation-only dependencies and hooks, supplied by the host. */
export class ConversationRuntime<Labels = Record<string, never>> {
  readonly services: RuntimeServices;
  readonly hooks: { conversation: ConversationHooks<Labels> };
  readonly maxPasses: number;

  constructor({ services = {}, hooks, maxPasses = 16 }: ConversationRuntimeOptions<Labels> = {}) {
    if (!Number.isSafeInteger(maxPasses) || maxPasses < 1) throw new Error("maxPasses must be a positive integer.");
    this.maxPasses = maxPasses;
    this.hooks = hooks ?? { conversation: {
      classify: async () => unimplemented("hooks.conversation.classify"),
      resolve: async () => unimplemented("hooks.conversation.resolve"),
    } };
    this.services = {
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
