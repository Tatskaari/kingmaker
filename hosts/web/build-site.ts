// After the prototype's src/web/static/build.ts at bc2ab1f (its site around the game, :194-220, and "Nothing secret goes out", :222-236), with the game's own page build at play/.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { keyNeedles, leaks, readSite } from "./site.ts";
import { sitePages } from "./site-pages.ts";

/**
 * The site GitHub Pages publishes (npm run build:site), in dist/site, every URL in it relative so it
 * works from any path (main's Pages at the root, a PR's preview at pr-preview/pr-<N>/):
 *
 *   index.html            the pitch (web/site/index.html), its buttons pointed at play/ and roadmap/
 *   roadmap/index.html    the roadmap (web/site/roadmap/index.html), its links to the pitch at ../
 *   play/                 the game's page with no server: the page-only build (build.ts) put here
 *
 * The pitch and the roadmap are pointed by site-pages.ts, which fails the build if a page changed
 * under it. Nothing secret goes out: a file anywhere in the site that holds the dev key (read from
 * ~/secrets to look for, and never printed) or anything shaped like an OpenRouter key fails the build,
 * and a build that fails leaves no site.
 *
 *   npm run build:site [-- --out <dir> --tunes <lore/Tunes>]      (dist/site by default)
 */

const ROOT = resolve(import.meta.dirname, "..", "..");

function main(argv: string[]): void {
  const started = performance.now();
  const out = outOf(argv);
  const { values } = parseArgs({ args: argv, options: { out: { type: "string" }, tunes: { type: "string" } } });
  try {
    buildPage(join(out, "play"), values.tunes);
    for (const [path, html] of sitePages(join(ROOT, "web", "site"))) {
      mkdirSync(dirname(join(out, path)), { recursive: true });
      writeFileSync(join(out, path), html);
    }
    const site = readSite(out);
    const leaking = leaks(site, keyNeedles(join(homedir(), "secrets", "kingmaker-dev-openrouter.txt")));
    if (leaking.length) throw new Error(`refusing to keep the site: ${leaking.join("; ")}`);
    console.log(`${relative(process.cwd(), out) || out}: the pitch, the roadmap and the game at play/, ${site.size} files; built in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  } catch (error) {
    rmSync(out, { recursive: true, force: true });
    throw error;
  }
}

/** Where the site goes: emptied first. A folder that isn't a site of this build's (no index.html) isn't touched. */
function outOf(argv: string[]): string {
  const { values } = parseArgs({ args: argv, options: { out: { type: "string" }, tunes: { type: "string" } } });
  const out = resolve(values.out ?? join(ROOT, "dist", "site"));
  if (existsSync(out) && readdirSync(out).length && !existsSync(join(out, "index.html"))) throw new Error(`${out} isn't a build of the site's (no index.html), so it isn't emptied: choose another --out`);
  rmSync(out, { recursive: true, force: true });
  return out;
}

/** The game's page, as npm run build:web makes it (build.ts holds it to its own rules), into the site's play/. */
function buildPage(dir: string, tunes?: string): void {
  const run = spawnSync(process.execPath, ["--no-warnings", "--import", "tsx", join(ROOT, "hosts", "web", "build.ts"), "--out", dir, ...(tunes ? ["--tunes", tunes] : [])], { cwd: ROOT, stdio: "inherit" });
  if (run.status !== 0) throw new Error("the page's build failed (above), so there's no site");
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
