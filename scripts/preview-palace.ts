import { readFileSync, writeFileSync } from "node:fs";
import { palaceLayout } from "../apps/web/src/palace-layout.js";

const output = process.argv[2] ?? "/tmp/kingmaker-palace.svg";
const scenario = JSON.parse(readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));
const atlas = "data:image/png;base64," + readFileSync(new URL("../apps/web/public/assets/kenney-tiny-dungeon.png", import.meta.url)).toString("base64");
writeFileSync(output, palaceLayout.svg(scenario.world.doors, scenario.world.fixtures, atlas));
console.log(`Room ownership preview: ${output}`);
