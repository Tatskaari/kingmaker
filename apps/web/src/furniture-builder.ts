import { create } from "@bufbuild/protobuf";
import { MapFixtureSchema, type MapFixture, type Scenario } from "../../../packages/contracts/src/index.js";
import { inventoryOwners, locatedItems } from "../../../packages/core/src/inventory.js";
import { type RoomBuilder } from "./room-builder.js";

type Point = { x: number; y: number };
type Furnishing = {
  id: string; name: string; sprite: number; owner?: string;
  items?: { id: string; name: string; details: string }[];
  approach?: Point;
};
const key = (p: Point) => `${p.x},${p.y}`;

/** Furnish using offsets from a room's main rectangle. Ownership and interaction
 * points are checked before anything is added; existing authored objects stay intact. */
export class FurnitureBuilder {
  readonly fixtures: MapFixture[] = [];
  readonly #blocked = new Set<string>();
  readonly #reserved = new Set<string>();
  readonly #ids = new Set<string>();
  constructor(readonly layout: RoomBuilder, scenario: Scenario, waypoints: readonly Point[] = []) {
    for (const item of [...locatedItems(inventoryOwners(scenario.characters, scenario.world)), ...scenario.world!.fixtures]) this.#ids.add(item.id);
    for (const fixture of scenario.world!.fixtures) {
      if (fixture.position) this.#blocked.add(key(fixture.position));
      if (fixture.interactionSpot) this.#reserved.add(key(fixture.interactionSpot));
    }
    for (const door of scenario.world!.doors) for (const point of door.tiles) this.#blocked.add(key(point));
    for (const point of [
      ...scenario.world!.doors.flatMap(door => [...door.tiles, ...door.interactionSpots]),
      ...scenario.world!.actors.flatMap(actor => actor.position ? [actor.position] : []),
      ...scenario.courtArrivalPlacements.flatMap(actor => actor.position ? [actor.position] : []), ...waypoints,
    ]) this.#reserved.add(key(point));
  }

  add(roomId: string, x: number, y: number, furnishing: Furnishing): void {
    const room = this.layout.rooms.find(room => room.id === roomId);
    if (!room) throw new Error(`Unknown room: ${roomId}`);
    const origin = room.regions[0]!, position = { x: origin.x + x, y: origin.y + y };
    if (this.layout.owners.get(key(position)) !== roomId || this.#blocked.has(key(position)) || this.#reserved.has(key(position))) {
      throw new Error(`${furnishing.id} blocks occupied/reserved floor or leaves ${roomId} at ${key(position)}`);
    }
    const candidates = furnishing.approach ? [{ x: origin.x + furnishing.approach.x, y: origin.y + furnishing.approach.y }] :
      [{ x: position.x, y: position.y + 1 }, { x: position.x, y: position.y - 1 },
        { x: position.x + 1, y: position.y }, { x: position.x - 1, y: position.y }];
    const interactionSpot = candidates.find(p => this.layout.owners.get(key(p)) === roomId && !this.#blocked.has(key(p))
      && Math.abs(p.x - position.x) + Math.abs(p.y - position.y) === 1);
    if (!interactionSpot) throw new Error(`No clear interaction spot for ${furnishing.id}`);
    const ids = [furnishing.id, ...(furnishing.items ?? []).map(item => item.id)];
    if (new Set(ids).size !== ids.length || ids.some(id => this.#ids.has(id))) throw new Error(`Duplicate furnishing/item ID: ${furnishing.id}`);
    const ownerCharacterId = furnishing.owner ?? (room.residents?.length === 1 ? room.residents[0]! : "");
    for (const id of ids) this.#ids.add(id);
    this.#blocked.add(key(position)); this.#reserved.add(key(interactionSpot));
    this.fixtures.push(create(MapFixtureSchema, {
      id: furnishing.id, name: furnishing.name, roomId, position, interactionSpot, sprite: furnishing.sprite,
      ownerCharacterId, container: !!furnishing.items?.length,
      ...(furnishing.items?.length ? { inventory: { items: furnishing.items.map(item => ({ ...item, quantity: 1, concealed: true })) } } : {}),
    }));
  }
}
