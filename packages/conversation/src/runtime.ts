import type { RuntimeServices } from "./services.js";

export interface ConversationRuntimeOptions {
  services?: { [Service in keyof RuntimeServices]?: Partial<RuntimeServices[Service]> };
}

export class UnimplementedServiceError extends Error {
  constructor(readonly operation: string) {
    super(`Unimplemented service: ${operation}`);
    this.name = "UnimplementedServiceError";
  }
}

const unimplemented = (operation: string): never => { throw new UnimplementedServiceError(operation); };

/** Unused service boundary for the new conversation engine. Implementations are opt-in. */
export class ConversationRuntime {
  readonly services: RuntimeServices;

  constructor({ services = {} }: ConversationRuntimeOptions = {}) {
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
