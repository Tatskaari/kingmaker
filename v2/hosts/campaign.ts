import { resolve } from "node:path";
import { checkCampaign, describePack, packOf, readCampaignFiles } from "./dev/campaign.ts";

/**
 * The campaign tool (v0-design §8):
 *
 *   npm run campaign -- check campaigns/caerwyn
 *
 * check: the campaign loads as both services will load it, and every id it names exists (the
 * converter's checks that need no prototype). It prints what's there, or each problem, and exits 1
 * on any. A path is relative to v2/, where npm runs it.
 */

const USAGE = "usage: npm run campaign -- check <campaign folder>   (e.g. campaigns/caerwyn)";

const [command, dir] = process.argv.slice(2);
if (command !== "check" || !dir) {
  console.error(USAGE);
  process.exit(2);
}

const files = readCampaignFiles(resolve(dir));
const problems = checkCampaign(files);

if (problems.length) {
  console.error(`${dir}: ${problems.length} problem${problems.length === 1 ? "" : "s"}`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`${dir}: ${describePack(packOf(files), files)}; no problems`);
