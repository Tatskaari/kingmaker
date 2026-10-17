import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { CampaignFile } from "../shared/scene/files.ts";
import { doctor, reportLines } from "./dev/doctor.ts";
import { readStackFile } from "./dev/stack-file.ts";

/**
 * The doctor (v0-design §9.2): checks a running stack, both directions between the services
 * included, and says how to fix what's wrong. It reads the stack from <root>/stack.json, which the
 * dev host writes. Exits 1 when anything's wrong.
 *
 *   npm run doctor [-- --root runs/dev] [--campaign campaigns/caerwyn]
 */

const V2 = resolve(import.meta.dirname, "..");
const { values } = parseArgs({ args: process.argv.slice(2), options: { root: { type: "string" }, campaign: { type: "string" } } });
const root = resolve(values.root ?? join(V2, "runs", "dev"));
const campaign = JSON.parse(readFileSync(join(resolve(values.campaign ?? join(V2, "campaigns", "caerwyn")), "campaign.json"), "utf8")) as CampaignFile;

const stack = readStackFile(root);
if (!stack) {
  console.error(`There's no stack in ${relative(process.cwd(), root) || root}: start one with npm run dev`);
  process.exit(1);
}

const report = await doctor(stack, { campaign: `${campaign.id}@${campaign.version}` });

console.log(`Kingmaker doctor · ${relative(process.cwd(), root) || root} (${stack.mode} mode)`);
for (const line of reportLines(report)) console.log(line);
console.log(report.ok ? "All well." : "Something's wrong: see the fixes above.");
process.exit(report.ok ? 0 : 1);
