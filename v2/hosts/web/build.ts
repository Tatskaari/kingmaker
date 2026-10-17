import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { fontFaceCss, fontList, webFonts } from "../../web/fonts/fonts.ts";
import { readContent } from "./content.ts";
import { keyNeedles, preloadOf, siteProblems, stampedPage, stampedScript, stampOf, writeSite, type Site } from "./site.ts";
import { tuiAliases, tuiFonts } from "./tui.ts";

/**
 * The page-only build (browser-design §5, npm run build:web): v2 in the browser, with no server, in
 * dist/web, every URL relative so it works from any path (the PR preview's /v2/, or web:serve's):
 *
 *   index.html, page.js, transport.js, style.css    the page (web/page): xterm.js, the key form, the workers' transport
 *   vendor/                                         xterm.js and its addons, from v2's node_modules
 *   fonts.css, fonts.json, fonts/                   the glyph fonts (web/fonts)
 *   client-worker.js, server-worker.js, chunks/     the two workers (hosts/web), bundled in one esbuild call, sharing chunks
 *   content.json                                    the campaign, the prompts and the fake model, from an allowlist (content.ts)
 *
 * The workers are taken by path, so the real ones drop in for the stubs. What they ask of OpenTUI is
 * the JS stand-in's (web/tui, as tui.ts points a bundle at it, with OpenTUI's ASCII fonts), with React
 * from v2's node_modules (one React, or the screens die on their first hook). What they still ask of
 * Node is web/node's stand-in for it, each file there standing for the module its name says
 * ("fs-promises.ts" for node:fs/promises), or the build fails. The site is put together in memory and
 * held to site.ts's rules (the stamp, the preload list, the CSP, relative URLs, the allowlist, and
 * nothing like an OpenRouter key: the dev key is read from ~/secrets to look for, and never printed);
 * a site that breaks one isn't written.
 *
 *   npm run build:web [-- --out <dir>]      (dist/web by default; --out for the preview)
 */

const V2 = resolve(import.meta.dirname, "..", "..");

async function main(argv: string[]): Promise<void> {
  const started = performance.now();
  const out = outOf(argv);

  const site = await bundleWorkers(out);
  addFiles(site, vendorFiles());
  addFiles(site, fontFiles());
  site.set("content.json", encode(JSON.stringify(readContent(V2))));
  addFiles(site, pageFiles(["transport.js", "style.css"]));
  stampThePage(site);

  refuseProblems(site);
  writeSite(out, site);
  say(site, out, started);
}

/** Where the site goes: emptied first, so a build that fails leaves none. A folder that isn't a site of the page's isn't touched. */
function outOf(argv: string[]): string {
  const { values } = parseArgs({ args: argv, options: { out: { type: "string" } } });
  const out = resolve(values.out ?? join(V2, "dist", "web"));
  if (existsSync(out) && readdirSync(out).length && !existsSync(join(out, "index.html"))) throw new Error(`${out} isn't a build of the page's (no index.html), so it isn't emptied: choose another --out`);
  rmSync(out, { recursive: true, force: true });
  return out;
}

/** Both workers and the chunks they share, for the browser: one esbuild call, in memory. */
async function bundleWorkers(out: string): Promise<Site> {
  const result = await build({
    absWorkingDir: V2,
    entryPoints: { "client-worker": join(V2, "hosts", "web", "client-worker.tsx"), "server-worker": join(V2, "hosts", "web", "server-worker.ts") },
    bundle: true,
    format: "esm",
    splitting: true,
    platform: "browser",
    target: "es2022",
    outdir: out,
    entryNames: "[name]",
    chunkNames: "chunks/[name]-[hash]",
    minify: true,
    legalComments: "eof",
    jsx: "automatic",
    jsxImportSource: "@opentui/react",
    alias: aliases(),
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [tuiFonts(V2)],
    write: false,
    logLevel: "warning",
  });
  return new Map(result.outputFiles.map(file => [relative(out, file.path).split("\\").join("/"), file.contents]));
}

/**
 * OpenTUI as the JS stand-in (web/tui: tui.ts), React, react-reconciler and scheduler from v2's
 * node_modules by name (one React), and each node: module web/node stands in for.
 */
function aliases(): Record<string, string> {
  const alias = tuiAliases(V2);
  for (const name of ["react", "react-reconciler", "scheduler"]) alias[name] = join(V2, "node_modules", name);
  for (const [name, file] of nodeStandIns(join(V2, "web", "node"))) {
    alias[name] = file;
    alias[`node:${name}`] = file;
  }
  return alias;
}

/** web/node's stand-ins, by the Node module each is for: a file's name, a hyphen for each slash ("timers-promises.ts": timers/promises). */
function nodeStandIns(dir: string): Array<[name: string, file: string]> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(file => /^[a-z_]+(-[a-z_]+)*\.ts$/.test(file) && !file.endsWith(".test.ts")).map(file => [file.slice(0, -3).replaceAll("-", "/"), join(dir, file)]);
}

/** xterm.js and its addons, from v2's node_modules, without the source maps they name (which aren't shipped, so the browser needn't look). */
function vendorFiles(): Site {
  const require = createRequire(join(V2, "package.json"));
  const root = (name: string) => dirname(dirname(require.resolve(name)));
  const files: Array<[string, string]> = [
    ["vendor/xterm.mjs", join(root("@xterm/xterm"), "lib", "xterm.mjs")],
    ["vendor/xterm.css", join(root("@xterm/xterm"), "css", "xterm.css")],
    ...["fit", "webgl", "unicode11"].map(name => [`vendor/addon-${name}.mjs`, join(root(`@xterm/addon-${name}`), "lib", `addon-${name}.mjs`)] as [string, string]),
  ];
  return new Map(files.map(([path, file]) => [path, encode(readFileSync(file, "utf8").replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "\n"))]));
}

/** The glyph fonts (web/fonts), their @font-face rules, and what the page loads before it measures its cells. */
function fontFiles(): Site {
  const dir = join(V2, "web", "fonts");
  const fonts = webFonts(dir);
  return new Map([
    ...fonts.map(font => [`fonts/${font.file}`, new Uint8Array(readFileSync(join(dir, font.file)))] as [string, Uint8Array]),
    ["fonts.css", encode(fontFaceCss(fonts, "fonts/"))],
    ["fonts.json", encode(JSON.stringify(fontList(fonts)))],
  ]);
}

/** The page's own files (web/page), as they are. */
function pageFiles(names: string[]): Site {
  return new Map(names.map(name => [name, new Uint8Array(readFileSync(join(V2, "web", "page", name)))]));
}

/** page.js and index.html, last: the build's stamp is a hash of everything else, and they carry it, with the preload list. */
function stampThePage(site: Site): void {
  const script = readFileSync(join(V2, "web", "page", "page.js"), "utf8");
  const stamp = stampOf(site, script);
  site.set("page.js", encode(stampedScript(script, stamp)));
  site.set("index.html", encode(stampedPage(readFileSync(join(V2, "web", "page", "index.html"), "utf8"), stamp, preloadOf(site, stamp))));
}

/** A site that breaks site.ts's rules isn't written: what's wrong, said (a leaked key by its file alone). */
function refuseProblems(site: Site): void {
  const problems = siteProblems(site, keyNeedles(join(homedir(), "secrets", "kingmaker-dev-openrouter.txt")));
  if (problems.length) throw new Error(`refusing to write the site:\n  ${problems.join("\n  ")}`);
}

function say(site: Site, out: string, started: number): void {
  const files = [...site.values()];
  const bytes = files.reduce((n, file) => n + file.length, 0);
  const gzipped = files.reduce((n, file) => n + gzipSync(file).length, 0);
  const stamp = /data-build="(\w+)"/.exec(new TextDecoder().decode(site.get("index.html")))?.[1];
  const mb = (n: number) => `${(n / 1e6).toFixed(2)} MB`;
  console.log(`${relative(process.cwd(), out) || out}: ${site.size} files, ${mb(bytes)} (${mb(gzipped)} gzipped); the build's stamp ${stamp}; built in ${((performance.now() - started) / 1000).toFixed(1)} s`);
}

function addFiles(site: Site, files: Site): void {
  for (const [path, bytes] of files) site.set(path, bytes);
}

const encode = (text: string) => new TextEncoder().encode(text);

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
