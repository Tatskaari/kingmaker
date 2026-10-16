/**
 * Writes the campaign's vocabulary (v5-design §3.8): what the AI service's suggested lines are vetted
 * against of the scenes it doesn't hold. The prototype's suggest.ts screens a line by the story's
 * names and places and by "the words any scene might use", read from all 25 of its scenes; v2's
 * campaign installs only the scenes built so far, so this records each scene's part of that, from the
 * prototype, once:
 *
 *   node --no-warnings tools/v2/export-vocabulary.mts [--prototype <checkout>] [--out <file>] [--check]
 *
 * --prototype: the prototype's checkout to read, this repo's own when left out; the file's `source`
 * is its commit, so write it from a checkout of the commit it should name (44c6d4a was a worktree of
 * its own). --out: where to write (v2/campaigns/caerwyn/vocabulary.json). --check: write nothing,
 * and exit 1 if the file's scenes aren't what the checkout's give (its source isn't compared).
 *
 * Each of the prototype's scenes, SCENES then ZOO_SCENES in their order: its id, hook, the scenes its
 * ways on lead to (`next`, in exit order, each once), its cast as the story's names read them (id,
 * name, and `called` and `aka` when the card has them), the names of its world's areas then its things
 * (`worldNames`, when it has a world), `companion` when it's a talk, and `prep`, all its prep as one
 * text (prepText, copied below). The scenes are as authored, without the "ending of their own" the
 * runtime adds: that's how the prototype's `everyday` reads them, and it names nobody.
 *
 * It imports the prototype's scenes at run time, read only, with its run output (KM_RUNS_DIR, the call
 * log, the cost ledger) in a folder outside the repo that's removed after. v2 never imports this.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import type { Scene, Transition } from "../../src/runtime/scene.ts";

/** A scene as the vocabulary keeps it. */
interface Entry {
  id: string;
  hook: string;
  next: string[];
  cast: Array<{ id: string; name: string; called?: string; aka?: string[] }>;
  worldNames?: string[];
  companion?: string;
  prep: string;
}

// Copied from the prototype's src/runtime/suggest.ts:728-741 at 44c6d4a, unchanged.

/** All the scene's prep: the cards, the beats and their routes, the endings, what it needs, its limits. */
function prepText(scene: Scene): string {
  return [
    scene.setting, scene.premise, ...(scene.background ?? []),
    ...scene.cast.flatMap(c => [c.name, c.voice, c.wants, c.fears ?? "", ...c.knows, ...(c.secrets ?? []), c.attitude, c.group ?? ""]),
    ...scene.beats.flatMap(b => [b.direction, ...Object.values(b.cast ?? {}), b.pressure ?? "", ...b.transitions.flatMap(routeText)]),
    ...(scene.anytime ?? []).flatMap(routeText),
    ...scene.exits.flatMap(e => [e.outcome, e.closing]),
    ...(scene.essentials ?? []).flatMap(e => [e.what, ...e.placedWith, e.unlocks]),
    ...(scene.limits ?? []),
  ].join("\n");
}

const routeText = (t: Transition) => [t.when, ...(t.check ? [t.check.reason ?? "", t.check.success, t.check.failure] : []), ...(t.establishes ?? [])];

// ---------------------------------------------------------------------------------------------

const REPO = resolve(import.meta.dirname, "../..");
const { values: args } = parseArgs({ options: { prototype: { type: "string" }, out: { type: "string" }, check: { type: "boolean" } } });
const prototype = resolve(args.prototype ?? REPO);
const out = resolve(args.out ?? join(REPO, "v2/campaigns/caerwyn/vocabulary.json"));

const scenes = await prototypeScenes(prototype);
const vocabulary = { source: commitOf(prototype), scenes: scenes.map(entryOf) };

if (args.check) check(vocabulary.scenes, out);
else write(vocabulary, out);

// ---------------------------------------------------------------------------------------------

/** The prototype's scenes in its order, imported with its run output kept out of every repo. */
async function prototypeScenes(checkout: string): Promise<Scene[]> {
  const runs = mkdtempSync(join(tmpdir(), "km-vocabulary-"));
  Object.assign(process.env, { KM_RUNS_DIR: runs, KM_CALL_LOG: join(runs, "calls.jsonl"), KM_COST_LEDGER: join(runs, "cost-ledger.jsonl") });
  const cwd = process.cwd();
  process.chdir(runs);
  try {
    const { SCENES, ZOO_SCENES } = await import(pathToFileURL(join(checkout, "scenes/index.ts")).href) as { SCENES: Scene[]; ZOO_SCENES: Scene[] };
    return [...SCENES, ...ZOO_SCENES];
  } finally {
    process.chdir(cwd);
    rmSync(runs, { recursive: true, force: true });
  }
}

function entryOf(scene: Scene): Entry {
  return {
    id: scene.id,
    hook: scene.hook,
    next: [...new Set(scene.exits.flatMap(e => (e.next ? [e.next] : [])))],
    cast: scene.cast.map(c => ({ id: c.id, name: c.name, ...(c.called ? { called: c.called } : {}), ...(c.aka?.length ? { aka: c.aka } : {}) })),
    ...(scene.world ? { worldNames: [...scene.world.areas.map(a => a.name), ...scene.world.things.map(t => t.name)] } : {}),
    ...(scene.companion ? { companion: scene.companion } : {}),
    prep: prepText(scene),
  };
}

// ---------------------------------------------------------------------------------------------

/** The checkout's commit, short, as the file records its source. */
function commitOf(checkout: string): string {
  return execFileSync("git", ["-C", checkout, "rev-parse", "--short=7", "HEAD"], { encoding: "utf8" }).trim();
}

function write(value: { source: string; scenes: Entry[] }, path: string): void {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, text);
  console.log(`${path}: ${value.scenes.length} scenes from ${value.source}, ${Math.round(text.length / 1024)} KB`);
}

/** The file's scenes against the checkout's: the same, or what differs first. */
function check(scenes: Entry[], path: string): void {
  const kept = JSON.parse(readFileSync(path, "utf8")) as { source: string; scenes: Entry[] };
  const why = kept.scenes.length !== scenes.length ? `it has ${kept.scenes.length} scenes, the checkout ${scenes.length}`
    : scenes.filter((s, i) => JSON.stringify(s) !== JSON.stringify(kept.scenes[i])).map(s => `${s.id} differs`)[0];
  if (why) {
    console.error(`${path} is out of date (recorded from ${kept.source}): ${why}. Write it again without --check.`);
    process.exit(1);
  }
  console.log(`${path}: its ${kept.scenes.length} scenes are the checkout's (recorded from ${kept.source})`);
}
