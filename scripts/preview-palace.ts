import { readFileSync, writeFileSync } from "node:fs";
import { palaceLayout } from "../apps/web/src/palace-layout.js";

const output = process.argv[2] ?? "/tmp/kingmaker-palace.svg";
const scenario = JSON.parse(readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));
writeFileSync(output, palaceLayout.svg(scenario.world.doors));
console.log(`Room ownership preview: ${output}`);
