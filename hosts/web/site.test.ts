import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSite, siteProblems, textOf, type Site } from "./site.ts";

/**
 * The page-only build (build.ts) and the rules it and the check hold a site to (site.ts): the site the
 * build makes keeps every one, and each rule catches what it's for, so a preview that would break in
 * play, or leak a key, isn't written. No rule's words ever hold the key they found.
 */

const V2 = join(import.meta.dirname, "..", "..");
const KEY = `sk-or-v1-${"ab".repeat(32)}`;
/** A line of the dev key file, as the build would look for it. */
const NEEDLE = "the-dev-key-itself";

test("the build's site keeps every rule, and each rule catches what it's for", () => {
  const site = built();
  assert.deepEqual(siteProblems(site, [NEEDLE]), []);

  const stamp = /data-build="(\w+)"/.exec(textOf(site, "index.html"))![1]!;
  const broken: Array<[what: string, change: (site: Site) => void, said: RegExp]> = [
    ["something shaped like a key in a worker", s => append(s, "server-worker.js", `const k="${KEY}";`), /hold something like an OpenRouter key: server-worker\.js/],
    ["the dev key in the page's script", s => append(s, "transport.js", `// ${NEEDLE}`), /hold something like an OpenRouter key: transport\.js/],
    ["an absolute URL", s => edit(s, "index.html", html => html.replace('src="page.js', 'src="/page.js')), /URLs that aren't relative: \/page\.js/],
    ["no CSP", s => edit(s, "index.html", html => html.replace(/\n\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, "")), /hasn't the page's CSP/],
    ["an import without the stamp", s => edit(s, "page.js", js => js.replace(`./transport.js?v=${stamp}`, "./transport.js")), /page\.js's imports aren't all stamped \(\.\/transport\.js\)/],
    ["the content left out of the preload list", s => edit(s, "index.html", html => html.replace(` content.json?v=${stamp}`, "")), /the preload list misses content\.json/],
    ["a file the allowlist doesn't let in", s => edit(s, "content.json", json => JSON.stringify({ ...JSON.parse(json), campaign: { ...JSON.parse(json).campaign, "notes.txt": "x" } })), /allowlist doesn't let in: campaigns\/caerwyn\/notes\.txt/],
    ["a stray file", s => s.set("notes.md", new Uint8Array()), /holds what it shouldn't: notes\.md/],
  ];
  for (const [what, change, said] of broken) {
    const copy = new Map(site);
    change(copy);
    const problems = siteProblems(copy, [NEEDLE]).join("\n");
    assert.match(problems, said, what);
    assert.ok(!problems.includes(KEY) && !problems.includes(NEEDLE), `${what}: the problem says the key`);
  }
});

/** The site as `npm run build:web` makes it, in a folder of its own, read back. */
function built(): Site {
  const out = mkdtempSync(join(tmpdir(), "km-web-"));
  try {
    const run = spawnSync(process.execPath, ["--no-warnings", "--import", "tsx", "hosts/web/build.ts", "--out", out], { cwd: V2, encoding: "utf8" });
    assert.equal(run.status, 0, `the build failed: ${run.stderr}`);
    return readSite(out);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

function edit(site: Site, path: string, change: (text: string) => string): void {
  site.set(path, new TextEncoder().encode(change(textOf(site, path))));
}

function append(site: Site, path: string, text: string): void {
  edit(site, path, before => `${before}\n${text}`);
}
