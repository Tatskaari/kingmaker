import { writeFileSync } from "node:fs";
import { palaceLayout } from "../apps/web/src/palace-layout.js";

const output = process.argv[2] ?? "/tmp/kingmaker-palace.svg";
writeFileSync(output, palaceLayout.svg());
console.log(`Room ownership preview: ${output}`);
