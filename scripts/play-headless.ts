import { readFileSync } from "node:fs";
import { fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { HeadlessGame } from "../packages/headless/src/index.js";

const game = new HeadlessGame(fromJsonString(ScenarioSchema,
  readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8")));
game.runtime.createDevelopmentPlayer();
console.log(game.observe());
game.act(game.actions().find(action => action.id.startsWith("open_treasury_door"))!.id);
game.act("enter_treasury");
console.log(game.observe());
