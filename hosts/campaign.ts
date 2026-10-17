import { resolve } from "node:path";
import { checkCampaign, describePack, packOf, readCampaignFiles } from "./dev/campaign.ts";

/**
 * The campaign tool (v0-design §8, v5-design §3.8):
 *
 *   npm run campaign -- check campaigns/caerwyn
 *
 * check: the campaign loads as both services will load it: its scenario (<id>.kmscenario) and every
 * scene, place and map it lists are there and of their formats' shapes; every scene (scenes/<id>.kmscene)
 * is held to the scene format's rules (docs/scene-format.md, "Rules the campaign check enforces"), and
 * the scenario, maps and places to the scenario format's (docs/scenario-format.md: shared/scene/
 * scenario-rules.ts); and every id it names exists: its ready-made builds on the rules engine's pack,
 * which is the one the scenario names, and the docs character creation's world reads in lore/
 * (v1-design §3.9). Its maps (maps/<key>.kmmap) build from their legends, their regions play the
 * scenario's scenes, laying each scene's place on the map or opening it, their ways out land where a
 * person can stand, and the story starts on one (map-design §3.1), from where every scene can be
 * reached; its places (places/<key>.kmplace) hold together; and its vocabulary.json (what the
 * suggested lines are vetted against of the prototype's scenes) is whole, with no entry for a scene
 * the campaign installs. It prints what's there, or each problem, and exits 1 on any. A path is
 * relative to the repo's root, where npm runs it.
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
