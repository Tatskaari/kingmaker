import type { TransitionResult } from "../quest-transition.js";
import { create } from "@bufbuild/protobuf";
import { FixtureInteractionSchema } from "../../../contracts/src/index.js";
import { isCartPart } from "../../../core/src/cart.js";
import type { createScenarioServices } from "../../../lore/src/services.js";

export type CartHookServices = Pick<ReturnType<typeof createScenarioServices>, "map" | "quests" | "scenario">;

/** Idempotent setup: starting/revisiting the quest never revokes Holt's permission. */
export async function cartActions(services: CartHookServices, authorised = false): Promise<void> {
  const ids = services.scenario.read().simulation!.map!.fixtures.filter(isCartPart).map(fixture => fixture.id);
  for (const id of ids) await services.map.updateFixture(id, fixture => {
    const actionId = `smash_${fixture.id}`;
    const existing = fixture.actions.find(action => action.id === actionId);
    if (existing) {
      if (authorised) existing.illegal = false;
    } else fixture.actions.push(create(FixtureInteractionSchema, {
      id: actionId, label: "Smash cart · Strength check (DC 15)", handler: "smash-cart",
      actorId: "player", illegal: !authorised, order: 25,
    }));
  });
}

export async function authoriseCartSmash(services: CartHookServices, signal: AbortSignal): Promise<TransitionResult> {
  signal.throwIfAborted();
  await cartActions(services, true);
  return { status: "accepted", message: "Holt authorised the player to smash the cart." };
}
