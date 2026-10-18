import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { describeInstall, installCampaign } from "./dev/install.ts";
import { readStackFile } from "./dev/stack-file.ts";

/**
 * Installs a campaign into a running stack's two services (v0-design §8): it's checked, its words go
 * to the AI service and its structure to the module. The dev host does this at every start; this is
 * for a campaign changed while the stack runs. The stack is found through <root>/stack.json.
 *
 *   npm run install-campaign -- campaigns/caerwyn [--root runs/dev]
 *   npm run install-campaign -- campaigns/zoo      (the zoo: its scenes are played by the GM, docs/combat-gm.md)
 */

const V2 = resolve(import.meta.dirname, "..");
const { values, positionals } = parseArgs({ args: process.argv.slice(2), options: { root: { type: "string" } }, allowPositionals: true });
const dir = positionals[0];
if (!dir) {
  console.error("usage: npm run install-campaign -- <campaign folder> [--root runs/dev]   (e.g. campaigns/caerwyn)");
  process.exit(2);
}
const root = resolve(values.root ?? join(V2, "runs", "dev"));

const stack = readStackFile(root);
if (!stack) {
  console.error(`There's no stack in ${relative(process.cwd(), root) || root}: start one with npm run dev`);
  process.exit(1);
}

try {
  const installed = await installCampaign(resolve(dir), stack);
  console.log(`${dir}: ${describeInstall(installed)}`);
  if (installed.words.ok && "answer" in installed.words) console.log(`  the AI service stored ${installed.words.answer.files} files; scenes with their words: ${installed.words.answer.scenes.join(", ")}`);
  process.exit(installed.words.ok && installed.structure.ok ? 0 : 1);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
