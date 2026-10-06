import { INVALID_MOVE } from "boardgame.io/core";
import type { SimulationState } from "../../contracts/src/v2.js";
import { transferBetweenInventories } from "./simulation-inventory.js";
import { findItem, itemsFor, inventoryOwners, type InventoryOwner } from "./inventory.js";
import type { MapFixture } from "../../contracts/src/index.js";

export type FixtureVerb = "inspect" | "open" | "close" | "take";
export interface FixtureAction {
  id: string; label: string; target: string; verb: FixtureVerb; itemId?: string;
  order: number; legality: "normal" | "illegal";
}
export const fixtureName = (fixture: MapFixture, actorId: string): string =>
  fixture.examinedBy.includes(actorId) && fixture.revealedName ? fixture.revealedName : fixture.name;

/** Contents and lock requirements are exposed only after the relevant interaction. */
export function fixtureActions(fixtures: readonly MapFixture[] | undefined, owners: readonly InventoryOwner[], actorId: string): FixtureAction[] {
  if (!fixtures) return [];
  const actions = fixtures.flatMap(fixture => {
    const name = fixtureName(fixture, actorId);
    const illegal = fixture.ownerCharacterId !== "" && fixture.ownerCharacterId !== actorId;
    const actions: FixtureAction[] = [{ id: `inspect_${fixture.id}`, target: fixture.id, verb: "inspect", label: `Inspect ${name}`, order: 20, legality: "normal" }];
    if (!fixture.container) return actions;
    if (fixture.open) {
      actions.push({ id: `close_${fixture.id}`, target: fixture.id, verb: "close", label: `Close ${name}`, order: 30, legality: "normal" });
      for (const item of itemsFor(owners, fixture.id)) {
        actions.push({ id: `inspect_item_${item.id}`, target: fixture.id, verb: "inspect", itemId: item.id, label: `Inspect ${item.name}`, order: 35, legality: illegal ? "illegal" : "normal" });
        actions.push({
          id: `take_${item.id}`, target: fixture.id, verb: "take", itemId: item.id, label: `${illegal ? "Steal" : "Take"} ${item.name}`, order: 40, legality: illegal ? "illegal" : "normal",
        });
      }
    } else {
      // A locked container can be tried before the correct key has been found.
      actions.push({ id: `open_${fixture.id}`, target: fixture.id, verb: "open", label: `Open ${name}`, order: 30, legality: illegal ? "illegal" : "normal" });
    }
    return actions;
  });
  for (const item of itemsFor(owners, actorId)) actions.push({
    id: `inspect_item_${item.id}`, target: actorId, verb: "inspect", itemId: item.id, label: `Inspect ${item.name}`, order: 35, legality: "normal",
  });
  return actions;
}

/** Caller supplies a draft and validates the physical approach before applying the action. */
export function applyFixtureAction(G: SimulationState, actorId: string, actionId: string): string {
  const fixtures = G.map?.fixtures, owners = inventoryOwners(Object.values(G.runtimeCharacters), G.map);
  const action = fixtureActions(fixtures, owners, actorId).find(candidate => candidate.id === actionId);
  if (!action) throw new Error("That container action is no longer available.");
  if (action.verb === "inspect" && action.itemId) {
    const item = findItem(owners, action.itemId!)!;
    return `${item.name}: ${item.details || "No further details are recorded."}`;
  }
  const fixture = fixtures!.find(item => item.id === action.target)!;
  const remember = () => { if (!fixture.examinedBy.includes(actorId)) fixture.examinedBy.push(actorId); };
  if (action.verb === "inspect") {
    remember();
    return `${fixtureName(fixture, actorId)}${fixture.container ? fixture.open ? " is open." : fixture.requiredKeyId ? " is locked. A matching key is needed." : " is closed." : "."}`;
  }
  if (action.verb === "open") {
    remember();
    if (fixture.requiredKeyId && !itemsFor(owners, actorId).some(item => item.id === fixture.requiredKeyId)) {
      return `${fixtureName(fixture, actorId)} is locked. You need the matching key.`;
    }
    fixture.open = true;
    if (!fixture.searchedBy.includes(actorId)) fixture.searchedBy.push(actorId);
    const contents = itemsFor(owners, fixture.id);
    return `${fixtureName(fixture, actorId)} opened. ${contents.length ? contents.map(item => item.name).join(", ") : "It is empty."}`;
  }
  if (action.verb === "close") { fixture.open = false; return `${fixtureName(fixture, actorId)} closed.`; }
  const item = findItem(owners, action.itemId!)!;
  if (transferBetweenInventories({ G }, fixture.id, actorId, item.id, { reveal: true }) === INVALID_MOVE) {
    throw new Error("That inventory transfer is no longer available.");
  }
  return `Picked up ${item.name}.`;
}
