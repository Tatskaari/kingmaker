/**
 * Writes V1's campaign data from the prototype (v1-design §3.9): builds.json's five ready-made
 * characters, and campaign.json's `creation` block, the world a backstory is written for.
 *
 *   node --no-warnings tools/v2/v1-campaign.mts --proto /home/jon/git/kingmaker/.claude/worktrees/v2 --out v2/campaigns/caerwyn
 *
 * - builds.json, by id in alphabetical order, each { concept, build }: cleric, fighter, rogue and
 *   wizard are PREGENS (src/game/combat/pregen.ts), builds and concepts as they are; ranger is the
 *   class defaults for the prototype's default concept (src/app/story.ts DEFAULT_CONCEPT, through
 *   src/rules/builds.ts defaultBuilds), with that concept. The rules engine makes the rest.
 * - creation: PREMISE from src/lore/backstory.ts at 44c6d4a (v2/ai/docs/backstory.ts since); its
 *   PLACE_WORDS as { doc, words }, each regular expression's source (they're read with the i flag);
 *   World/Caerwyn.md as the primer; and, as notCanon, the World docs of the campaign's lore that the
 *   prototype's pattern /(Fronts|Caerwyn now|index)\.md$/ left out.
 *
 * It reads and imports the prototype at 44c6d4a, which never changes, with its run output in a
 * temporary folder; it writes only those two files, every other field of campaign.json as it was.
 * v2 never imports it. Run it, review the diff, commit the output.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`usage: v1-campaign.mts --proto <the prototype at 44c6d4a> --out <v2>/campaigns/caerwyn (no ${name})`);
  return process.argv[i + 1]!;
};
const PROTO = arg("--proto");
const OUT = arg("--out");

// The prototype's run output somewhere that isn't the repo, and no model: set before its modules load.
const runs = mkdtempSync(join(tmpdir(), "km-v1-campaign-"));
process.env.KM_RUNS_DIR = runs;
process.env.OPENROUTER_API_KEY = "offline";
const proto = (path: string) => import(pathToFileURL(join(PROTO, path)).href);

try {
  writeJson(join(OUT, "builds.json"), await builds());
  const campaign = readJson(join(OUT, "campaign.json"));
  writeJson(join(OUT, "campaign.json"), { ...campaign, creation: await creation() });
} finally {
  rmSync(runs, { recursive: true, force: true });
}

/** The five ready-made characters, each { concept, build }. */
async function builds(): Promise<Record<string, unknown>> {
  const { PREGENS } = await proto("src/game/combat/pregen.ts");
  const { defaultBuilds } = await proto("src/rules/builds.ts");
  const { DEFAULT_CONCEPT } = await proto("src/app/story.ts");
  const ranger = defaultBuilds(DEFAULT_CONCEPT)[0];
  if (ranger?.build.classId !== "ranger") throw new Error(`the default concept's first build is ${ranger?.build.classId}, not a ranger`);
  const all: Record<string, unknown> = { ...PREGENS, ranger: { concept: DEFAULT_CONCEPT, build: ranger.build } };
  const ids = Object.keys(all).sort();
  if (ids.join() !== "cleric,fighter,ranger,rogue,wizard") throw new Error(`the ready-made builds are ${ids.join(", ")}`);
  return Object.fromEntries(ids.map(id => [id, all[id]]));
}

/** campaign.json's creation block: the prototype's premise, primer, World docs left out and places' words. */
async function creation(): Promise<Record<string, unknown>> {
  const { PREMISE } = await proto("src/lore/backstory.ts");
  return { name: "Caerwyn", premise: PREMISE, primer: "World/Caerwyn.md", notCanon: notCanon(), places: places() };
}

/** The campaign lore's World docs that the prototype's pattern left out of the lore check. */
function notCanon(): string[] {
  const world = readdirSync(join(OUT, "lore", "World")).filter(f => f.endsWith(".md")).sort().map(f => `World/${f}`);
  const left = world.filter(p => /(Fronts|Caerwyn now|index)\.md$/.test(p));
  if (left.length !== 3) throw new Error(`the pattern leaves out ${left.length} World docs, not 3: ${left.join(", ")}`);
  return left;
}

/** PLACE_WORDS from backstory.ts's source at 44c6d4a (it isn't exported): each place's doc and its words' source. */
function places(): Array<{ doc: string; words: string }> {
  const source = readFileSync(join(PROTO, "src", "lore", "backstory.ts"), "utf8");
  const block = /const PLACE_WORDS: Array<\[string, RegExp\]> = \[\n([\s\S]*?)\n\];/.exec(source)?.[1];
  if (!block) throw new Error("no PLACE_WORDS in backstory.ts");
  const found = block.split("\n").map(line => /^\s*\["([^"]+)", \/(.+)\/i\],$/.exec(line));
  if (found.some(m => !m) || found.length !== 7) throw new Error(`PLACE_WORDS isn't seven places, each [doc, /words/i]:\n${block}`);
  return found.map(m => ({ doc: m![1]!, words: new RegExp(m![2]!, "i").source }));
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
