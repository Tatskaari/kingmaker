import { Client } from "boardgame.io/client";
import type { SimulationState } from "../../contracts/src/v2.js";
import type { SimulationMove } from "./simulation-move.js";
import { startMove, completeMove, cancelMove } from "./simulation-movement.js";
import { setDoor } from "./simulation-doors.js";
import { interactWithFixture } from "./simulation-fixtures.js";
import { addToInventory, removeFromInventory, transferBetweenInventories, replaceInventories } from "./simulation-inventory.js";
import { publishSimulationChanges } from "./simulation-publication.js";

const moves = { startMove, completeMove, cancelMove, setDoor, interactWithFixture,
  addToInventory, removeFromInventory, transferBetweenInventories, replaceInventories, publishSimulationChanges };

/** Trusted host executor. The browser sends service requests, never arbitrary moves. */
export function createSimulationAuthority(initial: SimulationState) {
  const client = Client<SimulationState>({
    game: { name: "kingmaker-simulation", setup: () => initial, moves, disableUndo: true },
    numPlayers: 1,
    debug: false,
  });
  return {
    read: () => client.getState()!.G,
    executeMove<Args extends unknown[]>(move: SimulationMove<Args>, ...args: Args) {
      const name = Object.entries(moves).find(([, candidate]) => Object.is(candidate, move))?.[0];
      if (!name) throw new Error("Unregistered simulation move");
      const before = client.getState()!._stateID;
      client.moves[name]!(...args);
      if (client.getState()!._stateID === before) throw new Error("Invalid simulation move");
    },
  };
}
