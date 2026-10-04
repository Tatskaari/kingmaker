import { loadPlayableWorld } from "./lib/playable-world.js";
import { WorldHeadlessGame } from "../packages/headless/src/world.js";

const game = new WorldHeadlessGame(loadPlayableWorld());
console.log(game.observe());
await game.act(game.actions().find(action => action.id.startsWith("open_treasury_door"))!.id);
await game.act("enter_treasury");
console.log(game.observe());
