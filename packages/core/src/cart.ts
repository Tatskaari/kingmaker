import type { DndCharacter, MapFixture } from "../../contracts/src/index.js";
import { resolveDiceCheck } from "./ability-checks.js";

export const cartParts = ["furn_cart_left", "furn_cart_right"] as const;
export const isCartPart = (fixture: MapFixture) => cartParts.some(id => id === fixture.id);
export const hasIntactCart = (fixtures: readonly MapFixture[]) => cartParts.every(id => fixtures.some(f => f.id === id));

/** A raw Strength check: skill proficiency does not apply. */
export function cartStrengthCheck(build: DndCharacter | undefined, roll: number) {
  const dc = 15, modifier = Math.floor(((build?.abilityScores?.strength ?? 10) - 10) / 2);
  return { roll, dc, modifier, label: "Strength — smash cart", ...resolveDiceCheck(roll, dc, modifier) };
}
export type CartStrengthCheck = ReturnType<typeof cartStrengthCheck>;
