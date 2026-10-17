import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PAGES, pointed, sitePages } from "./site-pages.ts";

/**
 * The site around the game (site-pages.ts, build-site.ts): the pitch and the roadmap as saved in
 * web/site, their links pointed at the site's own pages, and the build that puts them beside the
 * game's page at play/. A page that changed under the build, or a link to a claude.ai artifact left
 * in it, fails it.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const SITE = join(ROOT, "web", "site");
const [PITCH, ROADMAP] = PAGES;

test("the pitch's buttons go to play/ and roadmap/, the roadmap's links to the pitch to ../, and no claude.ai artifact is linked", () => {
  const pages = sitePages(SITE);
  const pitch = pages.get("index.html")!;
  const roadmap = pages.get("roadmap/index.html")!;
  assert.match(pitch, /<a class="cta" href="play\/">Play the tech demo/);
  assert.match(pitch, /<a class="cta" href="roadmap\/">See the roadmap/);
  assert.match(roadmap, /<p>The pitch is the site's <a href="\.\.\/">front page<\/a>\.<\/p>/);
  for (const page of [pitch, roadmap]) {
    assert.ok(page.startsWith('<!doctype html><html lang="en-GB">'), "the page says its language");
    assert.doesNotMatch(page, /claude\.ai\/artifact/);
  }
});

test("a page that changed under the build, or a claude.ai artifact left in it, fails it", () => {
  const pitch = readFileSync(join(SITE, "index.html"), "utf8");
  const moved = pitch.replace(/Play the tech demo/, "Play the demo");
  assert.throws(() => pointed(PITCH!.path, moved, PITCH!.swaps), /web\/site\/index\.html changed: the site's build couldn't point its demo button at play\//);
  const stray = `${pitch}<a href="https://claude.ai/artifact/abc-123">more</a>`;
  assert.throws(() => pointed(PITCH!.path, stray, PITCH!.swaps), /still links to a claude\.ai artifact \(https:\/\/claude\.ai\/artifact\/abc-123\)/);
  const roadmap = readFileSync(join(SITE, "roadmap", "index.html"), "utf8").replace(/<p>The pitch: /, "<p>Our pitch: ");
  assert.throws(() => pointed(ROADMAP!.path, roadmap, ROADMAP!.swaps), /couldn't point its footer at the pitch/);
});

test("the site's build puts the pitch, the roadmap and the game's page together, every link between them inside it", () => {
  const out = mkdtempSync(join(tmpdir(), "km-site-"));
  try {
    const run = spawnSync(process.execPath, ["--no-warnings", "--import", "tsx", "hosts/web/build-site.ts", "--out", out], { cwd: ROOT, encoding: "utf8" });
    assert.equal(run.status, 0, `the build failed: ${run.stderr}`);
    for (const path of ["index.html", "roadmap/index.html", "play/index.html", "play/page.js", "play/content.json"]) assert.ok(existsSync(join(out, path)), `${path} is in the site`);
    const pitch = readFileSync(join(out, "index.html"), "utf8");
    for (const [, href] of pitch.matchAll(/<a class="cta" href="([^"]+)"/g)) assert.ok(existsSync(join(out, href!, "index.html")), `the pitch's ${href} is a page of the site`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
