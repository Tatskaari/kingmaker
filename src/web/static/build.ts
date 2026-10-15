import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { fontFaceCss, fontList, webFonts } from "../fonts.ts";
import { importMeta, openTuiFonts, virtualModules } from "./plugins.ts";

/**
 * The static build (npm run build:web): the whole game as a static site in dist/web, for GitHub
 * Pages' PR previews, with only relative URLs so it works from any path.
 *
 *   index.html, client.js, worker-transport.js, style.css   the page (src/web/page), in static mode
 *   vendor/                                                 xterm.js and its addons
 *   fonts.css, fonts.json, fonts/                           the glyph fonts (assets/fonts)
 *   worker.js, chunks/                                      the game, in a Web Worker
 *   content.json                                            the game's content, from an allowlist
 *
 * The game's modules are bundled as they are; what they need of Node comes from
 * src/web/static/node (a file system in memory, persisted to IndexedDB), and OpenTUI from
 * src/web/tui. Nothing outside the allowlist goes in, and the build fails if anything in dist/web
 * looks like an OpenRouter key.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const OUT = join(ROOT, "dist", "web");
const STATIC = join(ROOT, "src", "web", "static");
const PAGE = join(ROOT, "src", "web", "page");
const require = createRequire(import.meta.url);
const started = performance.now();

/** The game's files, by repo directory: only these are bundled (what the game reads with node:fs). */
const CONTENT: Array<{ dir: string; include: RegExp }> = [
  { dir: "lore", include: /\.md$/ },
  { dir: "prompts", include: /\.md$/ },
  { dir: "vendor/dnd-srd-engine", include: /^starter-pack\.json$/ },
];

const NODE_SHIMS: Record<string, string> = {
  fs: "fs.ts", "fs/promises": "fs.ts", path: "path.ts", os: "os.ts", url: "url.ts", crypto: "crypto.ts",
  module: "module.ts", child_process: "child_process.ts", util: "util.ts", process: "process.ts",
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

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
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    importMeta({ root: ROOT, virtualRoot: "/kingmaker" }),
    virtualModules({ "virtual:opentui-fonts": () => `export default ${JSON.stringify(openTuiFonts(ROOT))};` }),
  ],
  metafile: true,
  logLevel: "warning",
});
writeFileSync(join(ROOT, "dist", "web-meta.json"), JSON.stringify(result.metafile));

// ---------------------------------------------------------------------------------------------
// The page, in static mode

const csp = [
  "default-src 'self'", "script-src 'self'", "worker-src 'self'", "connect-src 'self' https://openrouter.ai",
  "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'", "base-uri 'none'", "form-action 'none'", "object-src 'none'",
].join("; ");
const html = readFileSync(join(PAGE, "index.html"), "utf8")
  .replace('<html lang="en">', '<html lang="en" data-mode="static">')
  .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${csp}">\n  <meta name="referrer" content="no-referrer">`);
if (!html.includes('data-mode="static"')) throw new Error("index.html changed: the static build couldn't mark it");
writeFileSync(join(OUT, "index.html"), html);
for (const file of ["client.js", "worker-transport.js", "style.css"]) copyFileSync(join(PAGE, file), join(OUT, file));

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
// The game's content, from the allowlist

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
// Nothing secret goes out

const outputs: string[] = [];
const walk = (dir: string): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else outputs.push(path);
  }
};
walk(OUT);
// The dev key (read here, never printed), when this machine has one; and anything shaped like an OpenRouter key.
const keyFile = join(homedir(), "secrets", "kingmaker-dev-openrouter.txt");
const devKey = existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : "";
const leaks = outputs.filter(path => {
  const text = readFileSync(path, "latin1");
  return (devKey && text.includes(devKey)) || /sk-or-v1-[0-9a-f]{32,}/.test(text);
});
if (leaks.length) {
  rmSync(OUT, { recursive: true, force: true });
  throw new Error(`refusing to ship dist/web: ${leaks.length} file(s) hold something like an OpenRouter key (${leaks.map(p => relative(ROOT, p)).join(", ")})`);
}

const bytes = outputs.reduce((n, p) => n + statSync(p).size, 0);
const gzipped = outputs.reduce((n, p) => n + gzipSync(readFileSync(p)).length, 0);
const mb = (n: number) => `${(n / 1e6).toFixed(2)} MB`;
console.log(`dist/web: ${outputs.length} files, ${mb(bytes)} (${mb(gzipped)} gzipped); ${Object.keys(files).length} content files; built in ${((performance.now() - started) / 1000).toFixed(1)} s`);
