import type { Event, Scenario } from "../../../packages/contracts/src/index.js";

/** Rendering is replaceable; it cannot mutate world state or call model APIs. */
export interface Renderer {
  render(scenario: Scenario, playerCharacterId: string): void;
  animate(events: readonly Event[]): Promise<void>;
  dispose(): void;
}
export interface WebDependencies {
  renderer: Renderer;
}
