import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { doorsModule } from "../bundle.ts";
import { fontFaceCss, fontList, webFonts } from "../fonts.ts";
import { CONTENT } from "./content.ts";
import { importMeta, openTuiFonts, stubModules, virtualModules } from "./plugins.ts";
import { shimProblems } from "./shims.ts";

/**
 * The static build (npm run build:web): the site in dist/web, for GitHub Pages' PR previews, with
 * only relative URLs so it works from any path. The pitch is its front page and the roadmap its
 * design doc (src/web/site: the two claude.ai artifacts as published, their links pointed at each
 * other and at the demo here), and the whole game, played in the browser, is at play/:
 *
 *   index.html, roadmap/index.html                               the pitch and the roadmap
 *   play/index.html, client.js, worker-transport.js, style.css   the game's page (src/web/page), in static mode
 *   play/vendor/                                                 xterm.js and its addons
 *   play/fonts.css, fonts.json, fonts/                           the glyph fonts (assets/fonts)
 *   play/worker.js, chunks/                                      the game, in a Web Worker
 *   play/content.json                                            the game's content, from an allowlist
 *
 * The game's modules are bundled as they are; what they need of Node comes from
 * src/web/static/node (a file system in memory, persisted to IndexedDB), and OpenTUI from
 * src/web/tui. Nothing outside the allowlist goes in, and the build fails if anything in dist/web
 * looks like an OpenRouter key, or if the game asks of Node what the browser's stand-ins can't do
 * (shims.ts), as a preview that breaks only in play would otherwise still publish.
 *
 * The files whose names don't carry a hash of their contents (worker.js, content.json, the page's)
 * are asked for with the build's stamp (?v=, from <html data-build>), and index.html lists what the
 * game loads before its first screen (<meta name="km-preload">) for the page to fetch at once.
 * GitHub Pages lets a browser keep any file for ten minutes, so without the stamp a reload just
 * after a new build is published could mix the new page with the old worker, or an old worker with
 * chunks that are gone.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SITE_OUT = join(ROOT, "dist", "web");
/** The game, in the site. */
const OUT = join(SITE_OUT, "play");
const STATIC = join(ROOT, "src", "web", "static");
const PAGE = join(ROOT, "src", "web", "page");
const SITE = join(ROOT, "src", "web", "site");
const require = createRequire(import.meta.url);
const started = performance.now();

const NODE_SHIMS: Record<string, string> = {
  fs: "fs.ts", "fs/promises": "fs.ts", path: "path.ts", os: "os.ts", url: "url.ts", crypto: "crypto.ts",
  module: "module.ts", child_process: "child_process.ts", util: "util.ts", process: "process.ts",
};

rmSync(SITE_OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// The commit it's built from (and whether there was more than the commit), written into the game for
// a report of a problem to say (src/report/dump.ts): there's no git in a browser to ask.
const git = (...args: string[]) => { try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return undefined; } };
const commit = git("rev-parse", "HEAD") ?? "";
const dirty = git("status", "--porcelain", "--untracked-files=no") ? "1" : "";

// ---------------------------------------------------------------------------------------------
// The game, in a worker

const alias: Record<string, string> = {
  "@opentui/core": join(ROOT, "src/web/tui/core.ts"),
  "@opentui/react/jsx-runtime": "react/jsx-runtime",
  "@opentui/react/jsx-dev-runtime": "react/jsx-dev-runtime",
  "@opentui/react": join(ROOT, "src/web/tui/react.ts"),
};
for (const [name, file] of Object.entries(NODE_SHIMS)) {
  alias[name] = join(STATIC, "node", file);
  alias[`node:${name}`] = join(STATIC, "node", file);
}

const result = await build({
  absWorkingDir: ROOT,
  entryPoints: { worker: join(STATIC, "worker.ts") },
  bundle: true,
  format: "esm",
  splitting: true,
  platform: "browser",
  target: "es2022",
  outdir: OUT,
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  minify: true,
  legalComments: "eof",
  jsx: "automatic",
  jsxImportSource: "@opentui/react",
  alias,
  inject: [join(STATIC, "node", "process.ts")],
  define: { "process.env.NODE_ENV": '"production"', "process.env.KM_BUILD_COMMIT": JSON.stringify(commit), "process.env.KM_BUILD_DIRTY": JSON.stringify(dirty) },
  plugins: [
    importMeta({ root: ROOT, virtualRoot: "/kingmaker" }),
    virtualModules({ "virtual:opentui-fonts": () => `export default ${JSON.stringify(openTuiFonts(ROOT))};` }),
    // boardgame.io's debug panel (Svelte, about 90 KB): its client shows it only outside production builds.
    stubModules([{ filter: /[\\/]boardgame\.io[\\/]dist[\\/]cjs[\\/]Debug-[0-9a-f]+\.js$/, contents: "module.exports = {};" }]),
  ],
  metafile: true,
  logLevel: "warning",
});
writeFileSync(join(ROOT, "dist", "web-meta.json"), JSON.stringify(result.metafile));

// What the game asks of Node that the browser's stand-ins can't do (shims.ts), in the modules that ask node:crypto for anything.
const cryptoShim = join(STATIC, "node", "crypto.ts");
const problems = shimProblems(Object.entries(result.metafile.inputs)
  .filter(([, input]) => input.imports.some(i => resolve(ROOT, i.path) === cryptoShim))
  .map(([path]) => ({ path, source: readFileSync(resolve(ROOT, path), "utf8") })));
if (problems.length) {
  rmSync(SITE_OUT, { recursive: true, force: true });
  throw new Error(`the browser build can't do what the game asks of Node here:\n  ${problems.join("\n  ")}`);
}

// ---------------------------------------------------------------------------------------------
// The page's files (index.html last, with the build's stamp)

for (const file of ["worker-transport.js", "style.css"]) copyFileSync(join(PAGE, file), join(OUT, file));
// The doors' pictures over the terminal (src/web/page/doors.ts, and the art it shares with the game).
writeFileSync(join(OUT, "doors.js"), doorsModule(true));

const xterm = dirname(dirname(require.resolve("@xterm/xterm")));
const addon = (name: string) => dirname(dirname(require.resolve(`@xterm/addon-${name}`)));
mkdirSync(join(OUT, "vendor"), { recursive: true });
copyFileSync(join(xterm, "lib", "xterm.mjs"), join(OUT, "vendor", "xterm.mjs"));
copyFileSync(join(xterm, "css", "xterm.css"), join(OUT, "vendor", "xterm.css"));
for (const name of ["fit", "webgl", "unicode11"]) copyFileSync(join(addon(name), "lib", `addon-${name}.mjs`), join(OUT, "vendor", `addon-${name}.mjs`));
// xterm's modules name source maps that aren't shipped; without the comment the browser doesn't go looking.
for (const file of readdirSync(join(OUT, "vendor")).filter(f => f.endsWith(".mjs"))) {
  const path = join(OUT, "vendor", file);
  writeFileSync(path, readFileSync(path, "utf8").replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "\n"));
}

// The glyph fonts (src/web/fonts.ts makes these at serve time for the server).
const fonts = webFonts(join(ROOT, "assets", "fonts"));
mkdirSync(join(OUT, "fonts"), { recursive: true });
for (const font of fonts) copyFileSync(join(ROOT, "assets", "fonts", font.file), join(OUT, "fonts", font.file));
writeFileSync(join(OUT, "fonts.css"), fontFaceCss(fonts, "fonts/"));
writeFileSync(join(OUT, "fonts.json"), JSON.stringify(fontList(fonts)));

// ---------------------------------------------------------------------------------------------
// The game's content, from the allowlist (content.ts)

const files: Record<string, string> = {};
function collect(dir: string, include: RegExp): void {
  const full = join(ROOT, dir);
  if (!existsSync(full)) throw new Error(`content directory ${dir} is missing`);
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collect(path, include);
    else if (entry.isFile() && include.test(entry.name)) files[path.split("\\").join("/")] = readFileSync(join(ROOT, path), "utf8");
  }
}
for (const { dir, include } of CONTENT) collect(dir, include);
writeFileSync(join(OUT, "content.json"), JSON.stringify({ files }));

// ---------------------------------------------------------------------------------------------
// The page, in static mode, with the build's stamp: a hash of everything else in it

const client = readFileSync(join(PAGE, "client.js"), "utf8");
const stamp = (() => {
  const hash = createHash("sha256").update(client);
  for (const file of filesIn(OUT).sort()) hash.update(`\0${relative(OUT, file)}\0`).update(readFileSync(file));
  return hash.digest("hex").slice(0, 12);
})();
const v = `?v=${stamp}`;
// client.js's own imports (xterm.js and its addons, the doors) carry the stamp too.
const versionedClient = client.replace(/(from\s+"\.\/(?:vendor\/[\w.-]+\.mjs|doors\.js))"/g, `$1${v}"`);
if (versionedClient === client || !versionedClient.includes(`"./doors.js${v}"`)) throw new Error("client.js changed: the static build couldn't stamp its imports");
writeFileSync(join(OUT, "client.js"), versionedClient);
// What the game loads before its first screen, for the page to fetch all at once (client.js): the worker, its chunks, the content.
const preload = [
  `worker.js${v}`,
  ...Object.keys(result.metafile.outputs).filter(path => path.endsWith(".js") && path.includes("/chunks/")).map(path => relative(OUT, resolve(ROOT, path))).sort(),
  `content.json${v}`,
];
const csp = [
  "default-src 'self'", "script-src 'self'", "worker-src 'self'", "connect-src 'self' https://openrouter.ai",
  "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'", "base-uri 'none'", "form-action 'none'", "object-src 'none'",
].join("; ");
const html = readFileSync(join(PAGE, "index.html"), "utf8")
  .replace('<html lang="en">', `<html lang="en" data-mode="static" data-build="${stamp}">`)
  .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${csp}">\n  <meta name="referrer" content="no-referrer">\n  <meta name="km-preload" content="${preload.join(" ")}">`)
  .replace(/((?:href|src)="(?:vendor\/xterm\.css|fonts\.css|style\.css|client\.js))"/g, `$1${v}"`);
if (!html.includes('data-mode="static"') || (html.match(/\?v=/g) ?? []).length < 5) throw new Error("index.html changed: the static build couldn't mark it");
writeFileSync(join(OUT, "index.html"), html);

// ---------------------------------------------------------------------------------------------
// The site around the game: the pitch and the roadmap, as their artifacts are published on claude.ai
// (where they're edited), with their links to each other and the demo button pointed here

/** The artifacts' links, as patterns. */
const ARTIFACT = { pitch: String.raw`https://claude\.ai/artifact/1Ck3UDwhFdG7PwPB7DZWWe`, roadmap: String.raw`https://claude\.ai/artifact/SdWwGZBtvKZ3JuAt73Hxq6` };
/** A page of the site, its links swapped for the site's own. Each swap has to happen: if one doesn't, the page changed under the build. */
function sitePage(path: string, swaps: Array<[pattern: RegExp, to: string, what: string]>): void {
  let page = readFileSync(join(SITE, path), "utf8").replace(/^<!doctype html><html>/i, '<!doctype html><html lang="en-GB">');
  for (const [pattern, to, what] of swaps) {
    const swapped = page.replace(pattern, to);
    if (swapped === page) throw new Error(`src/web/site/${path} changed: the static build couldn't point ${what}`);
    page = swapped;
  }
  const stray = /https:\/\/claude\.ai\/artifact\/[\w-]+/.exec(page);
  if (stray) throw new Error(`src/web/site/${path} still links to a claude.ai artifact (${stray[0]})`);
  mkdirSync(dirname(join(SITE_OUT, path)), { recursive: true });
  writeFileSync(join(SITE_OUT, path), page);
}
sitePage("index.html", [
  [/<a class="cta" href="[^"]*"(?: target="_blank" rel="noopener")?>Play the tech demo/, '<a class="cta" href="play/">Play the tech demo', "its demo button at play/"],
  [new RegExp(`<a class="cta" href="${ARTIFACT.roadmap}"(?: target="_blank" rel="noopener")?>See the roadmap`), '<a class="cta" href="roadmap/">See the roadmap', "its roadmap button at roadmap/"],
]);
sitePage("roadmap/index.html", [
  [new RegExp(`<p>The pitch: <a href="${ARTIFACT.pitch}">[^<]*</a></p>`), '<p>The pitch is the site\'s <a href="../">front page</a>.</p>', "its footer at the pitch"],
  [new RegExp(`href="${ARTIFACT.pitch}"`, "g"), 'href="../"', "its links to the pitch at ../"],
]);

// ---------------------------------------------------------------------------------------------
// Nothing secret goes out

const outputs = filesIn(SITE_OUT);
// The dev key (read here, never printed), when this machine has one; and anything shaped like an OpenRouter key.
const keyFile = join(homedir(), "secrets", "kingmaker-dev-openrouter.txt");
const devKey = existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : "";
const leaks = outputs.filter(path => {
  const text = readFileSync(path, "latin1");
  return (devKey && text.includes(devKey)) || /sk-or-v1-[0-9a-f]{32,}/.test(text);
});
if (leaks.length) {
  rmSync(SITE_OUT, { recursive: true, force: true });
  throw new Error(`refusing to ship dist/web: ${leaks.length} file(s) hold something like an OpenRouter key (${leaks.map(p => relative(ROOT, p)).join(", ")})`);
}

const bytes = outputs.reduce((n, p) => n + statSync(p).size, 0);
console.log(`the build's stamp: ${stamp}`);
const gzipped = outputs.reduce((n, p) => n + gzipSync(readFileSync(p)).length, 0);
const mb = (n: number) => `${(n / 1e6).toFixed(2)} MB`;
console.log(`dist/web: ${outputs.length} files, ${mb(bytes)} (${mb(gzipped)} gzipped); ${Object.keys(files).length} content files; built in ${((performance.now() - started) / 1000).toFixed(1)} s`);

function filesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesIn(path));
    else out.push(path);
  }
  return out;
}
