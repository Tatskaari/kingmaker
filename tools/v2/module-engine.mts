/**
 * Makes v2's vendored rules engine from the prototype's (v1-design §2.3, spacetime.md §8): the
 * module-ready copy of the bundle, its typings under the copy's name, the starter pack, the licence,
 * and the SRD's spell texts. The two READMEs are v2's own, written by hand. A SpacetimeDB module can't load the prototype's bundle as it is, so the
 * copy makes the two edits the spike found, and nothing else:
 *
 *   1. line 1, `import { createRequire as __cr } from 'node:module'; const require = …`, deleted (a
 *      module has no node: built-ins; the bundle's own `typeof require` guards cope without it);
 *   2. `process.env.NODE_ENV` replaced with `"production"`, in exactly five places (immer reads it as
 *      the bundle loads, and the CLI's bundler turns it into a bare `production` that throws).
 *
 *   node --no-warnings tools/v2/module-engine.mts --proto /home/jon/git/kingmaker/.claude/worktrees/v2 --out v2/vendor
 *
 * It reads the prototype at 44c6d4a (the bundle's sha256 is checked, so a rebuilt engine stops it)
 * and writes only under --out. It prints each file's sha256, for v2/vendor/dnd-srd-engine/README.md.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The prototype's bundle at 44c6d4a (vendor/dnd-srd-engine/dnd-srd-engine.js, ead852b with its patches). */
const SOURCE_SHA256 = "94b626995f2ec79f664fe8292668f413501f0eee4980a69b69a8595c839918f0";
const BANNER = "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);";
const NODE_ENV = "process.env.NODE_ENV";
const NODE_ENV_PLACES = 5;

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`usage: module-engine.mts --proto <the prototype at 44c6d4a> --out <v2>/vendor (no ${name})`);
  return process.argv[i + 1]!;
};
const PROTO = join(arg("--proto"), "vendor");
const OUT = arg("--out");

const written = [...engineFiles(), ...spellFiles()];
for (const path of written) console.log(`${sha256(readFileSync(path))}  ${path}`);

/** The engine: the module-ready bundle, its typings renamed to pair with it, the pack and the licence as they are. */
function engineFiles(): string[] {
  const from = join(PROTO, "dnd-srd-engine"), to = join(OUT, "dnd-srd-engine");
  mkdirSync(to, { recursive: true });
  writeFileSync(join(to, "dnd-srd-engine.module.js"), moduleReady(readFileSync(join(from, "dnd-srd-engine.js"))));
  copyFileSync(join(from, "dnd-srd-engine.d.ts"), join(to, "dnd-srd-engine.module.d.ts"));
  for (const file of ["starter-pack.json", "LICENSE", "NOTICE"]) copyFileSync(join(from, file), join(to, file));
  return ["dnd-srd-engine.module.js", "dnd-srd-engine.module.d.ts", "starter-pack.json", "LICENSE", "NOTICE"].map(f => join(to, f));
}

/** The SRD's spell texts, as they are (the sheet shows them; the JSON carries the SRD's attribution). */
function spellFiles(): string[] {
  const to = join(OUT, "srd-spells");
  mkdirSync(to, { recursive: true });
  copyFileSync(join(PROTO, "srd-spells", "spells.json"), join(to, "spells.json"));
  return [join(to, "spells.json")];
}

/** The bundle with the two edits, each checked: the source is the one expected, the banner is its first line, NODE_ENV is in five places. */
function moduleReady(source: Buffer): string {
  if (sha256(source) !== SOURCE_SHA256) throw new Error(`the prototype's bundle isn't 44c6d4a's (sha256 ${sha256(source)}): the edits below were checked against that one only`);
  const [first, ...rest] = source.toString("utf8").split("\n");
  if (first !== BANNER) throw new Error(`line 1 isn't the node:module banner: ${first?.slice(0, 80)}`);
  const body = rest.join("\n");
  const places = body.split(NODE_ENV).length - 1;
  if (places !== NODE_ENV_PLACES) throw new Error(`${NODE_ENV} is in ${places} places, not ${NODE_ENV_PLACES}`);
  return body.replaceAll(NODE_ENV, '"production"');
}

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}
