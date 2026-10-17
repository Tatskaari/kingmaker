import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { allowed, CONTENT, contentPaths, type Content } from "./content.ts";

/**
 * The page's site, file by file (browser-design §5): what the build (build.ts) puts together and
 * writes to dist/web, and what the check (check.ts) reads back. Both hold it to the rules here: the
 * build's stamp (?v=) on every file whose name isn't its hash, the list of what the page loads at once,
 * the page's CSP, relative URLs only (a preview is served from a path), content.json by the allowlist,
 * and nothing like an OpenRouter key in any file. The build writes no site that breaks one.
 *
 * GitHub Pages lets a browser keep any file for ten minutes, so without the stamp a reload just after
 * a new build is published could mix the new page with an old worker, or an old worker with chunks
 * that are gone. The chunks are named by their hash; the rest are asked for with the stamp, a hash of
 * everything in the site.
 */

/** The site's files, by their path in it ("chunks/chunk-AB12CD34.js"). */
export type Site = Map<string, Uint8Array>;

/** What the site holds at its top: the page, both workers and the chunks they share, xterm.js, the fonts, the content. Nothing else. */
export const TOP = ["chunks", "client-worker.js", "content.json", "fonts", "fonts.css", "fonts.json", "index.html", "page.js", "server-worker.js", "style.css", "transport.js", "vendor"];

/** xterm.js and the addons the page loads, from the repo's node_modules. */
export const VENDOR = ["vendor/xterm.mjs", "vendor/xterm.css", "vendor/addon-fit.mjs", "vendor/addon-webgl.mjs", "vendor/addon-unicode11.mjs"];

/** The page's policy, a meta tag (GitHub Pages sends no headers, and it doesn't reach the workers): its own files, and OpenRouter for the key's check. */
export const CSP = [
  "default-src 'self'", "script-src 'self'", "worker-src 'self'", "connect-src 'self' https://openrouter.ai",
  "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'", "base-uri 'none'", "form-action 'none'", "object-src 'none'",
].join("; ");

/** What index.html refers to by a name with no hash in it: each asked for with the stamp. */
const STAMPED = ["vendor/xterm.css", "fonts.css", "style.css", "page.js"];

/** Anything shaped like an OpenRouter key. */
const KEYISH = /sk-or-v1-[0-9a-f]{32,}/;

/** The build's stamp: a hash of page.js (before it's stamped) and every file in the site but the two the stamp goes into. */
export function stampOf(site: Site, script: string): string {
  const hash = createHash("sha256").update(script);
  for (const path of [...site.keys()].sort()) hash.update(`\0${path}\0`).update(site.get(path)!);
  return hash.digest("hex").slice(0, 12);
}

/** page.js with the stamp on its imports (xterm.js, its addons and the transport). Throws if one is missed: page.js changed under the build. */
export function stampedScript(script: string, stamp: string): string {
  const stamped = script.replace(/(from\s+"\.\/[\w./-]+)"/g, `$1?v=${stamp}"`);
  if (!stamped.includes(`from "./transport.js?v=${stamp}"`) || !stamped.includes(`from "./vendor/xterm.mjs?v=${stamp}"`)) throw new Error("page.js changed: the build couldn't stamp its imports");
  return stamped;
}

/** What the page loads before its first screen, for it to ask for all at once: both workers, their chunks, the content. */
export function preloadOf(site: Site, stamp: string): string[] {
  const chunks = [...site.keys()].filter(path => path.startsWith("chunks/") && path.endsWith(".js")).sort();
  return [`client-worker.js?v=${stamp}`, `server-worker.js?v=${stamp}`, ...chunks, `content.json?v=${stamp}`];
}

/** index.html with the stamp (on it, and on what it refers to), the CSP, no referrer, and the preload list. Throws if a mark is missed: the page changed under the build. */
export function stampedPage(html: string, stamp: string, preload: string[]): string {
  const page = html
    .replace('<html lang="en">', `<html lang="en" data-build="${stamp}">`)
    .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">\n  <meta name="referrer" content="no-referrer">\n  <meta name="km-preload" content="${preload.join(" ")}">`)
    .replace(/((?:href|src)="(?:vendor\/xterm\.css|fonts\.css|style\.css|page\.js))"/g, `$1?v=${stamp}"`);
  if (!page.includes(`data-build="${stamp}"`) || !page.includes(CSP) || STAMPED.some(file => !page.includes(`"${file}?v=${stamp}"`))) throw new Error("index.html changed: the build couldn't stamp it");
  return page;
}

/** Everything wrong with a site, in words (none, for one fit to publish); `needles` are the dev key file's lines, never said. */
export function siteProblems(site: Site, needles: string[]): string[] {
  return [...layoutProblems(site), ...stampProblems(site), ...urlProblems(site), ...contentProblems(site), ...leaks(site, needles)];
}

/** The dev key file's lines (each a key to look for), when this machine has one: read here, never printed. */
export function keyNeedles(file: string): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").map(line => line.replace(/\r$/, "").trim()).filter(Boolean);
}

/** A built site, read back. */
export function readSite(dir: string): Site {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile());
  return new Map(files.map(entry => {
    const path = join(entry.parentPath, entry.name);
    return [relative(dir, path).split(sep).join("/"), new Uint8Array(readFileSync(path))];
  }));
}

/** The site written out, into a folder that's empty (the build empties it first). */
export function writeSite(dir: string, site: Site): void {
  for (const [path, bytes] of site) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), bytes);
  }
}

export const textOf = (site: Site, path: string): string => new TextDecoder().decode(site.get(path) ?? new Uint8Array());

/** The site's top is TOP's (the chunks only when the workers share code), with xterm.js and a font. */
function layoutProblems(site: Site): string[] {
  const top = new Set([...site.keys()].map(path => path.split("/")[0]!));
  const strays = [...top].filter(name => !TOP.includes(name));
  const missing = [...TOP.filter(name => name !== "chunks" && !top.has(name)), ...VENDOR.filter(path => !site.has(path))];
  const fonts = [...site.keys()].filter(path => /^fonts\/[\w.-]+\.(ttf|otf)$/.test(path));
  return [
    ...(strays.length ? [`the site holds what it shouldn't: ${strays.join(", ")}`] : []),
    ...(missing.length ? [`the site is missing ${missing.join(", ")}`] : []),
    ...(fonts.length ? [] : ["the site has no glyph font (fonts/*.ttf)"]),
  ];
}

/** The stamp on the page and on everything it asks for by a name with no hash in it; the CSP; the preload list, each file in it there. */
function stampProblems(site: Site): string[] {
  const html = textOf(site, "index.html");
  const stamp = /<html[^>]* data-build="([0-9a-f]{12})"/.exec(html)?.[1];
  if (!stamp) return ["index.html has no build stamp (<html data-build>)"];
  const unstamped = STAMPED.filter(file => !html.includes(`"${file}?v=${stamp}"`));
  const imports = [...textOf(site, "page.js").matchAll(/from\s+"(\.\/[^"]+)"/g)].map(m => m[1]!);
  const bare = imports.filter(path => !path.endsWith(`?v=${stamp}`));
  const preload = (/<meta name="km-preload" content="([^"]*)">/.exec(html)?.[1] ?? "").split(/\s+/).filter(Boolean);
  const wanted = preloadOf(site, stamp);
  const unlisted = wanted.filter(path => !preload.includes(path));
  const absent = preload.filter(path => !site.has(path.replace(/\?.*$/, "")));
  return [
    ...(unstamped.length ? [`index.html asks for ${unstamped.join(", ")} without the stamp`] : []),
    ...(imports.length < 5 || bare.length ? [`page.js's imports aren't all stamped (${bare.join(", ") || `${imports.length} of them`})`] : []),
    ...(html.includes(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`) ? [] : ["index.html hasn't the page's CSP"]),
    ...(html.includes('<meta name="referrer" content="no-referrer">') ? [] : ["index.html doesn't say no-referrer"]),
    ...(unlisted.length ? [`the preload list misses ${unlisted.join(", ")}`] : []),
    ...(absent.length ? [`the preload list names files that aren't there: ${absent.join(", ")}`] : []),
  ];
}

/** Every URL to the site's own files is relative: in index.html, the page's imports and workers, and fonts.css. */
function urlProblems(site: Site): string[] {
  const html = [...textOf(site, "index.html").matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1]!);
  const scripts = ["page.js", "transport.js"].flatMap(path => [...textOf(site, path).matchAll(/(?:from\s+|import\(\s*|new URL\(\s*)["'`]([^"'`$]+)/g)].map(m => m[1]!));
  const css = [...textOf(site, "fonts.css").matchAll(/url\("?([^")]+)"?\)/g)].map(m => m[1]!);
  const absolute = [...html.filter(url => !url.startsWith("https://openrouter.ai/")), ...scripts, ...css].filter(url => url.startsWith("/") || /^[a-z]+:/i.test(url) && !url.startsWith("data:"));
  return absolute.length ? [`URLs that aren't relative: ${absolute.join(", ")}`] : [];
}

/** content.json holds only what the allowlist lets in, and some of each kind (the campaign whole enough to install, the GM's prompt). */
function contentProblems(site: Site): string[] {
  let content: Content;
  try {
    content = JSON.parse(textOf(site, "content.json")) as Content;
  } catch {
    return ["content.json isn't JSON"];
  }
  const paths = contentPaths(content);
  const strays = paths.filter(path => !allowed(path));
  const absent = CONTENT.filter(c => !paths.some(path => path.startsWith(`${c.dir}/`))).map(c => c.what);
  return [
    ...(strays.length ? [`content.json holds what the allowlist doesn't let in: ${strays.slice(0, 5).join(", ")}`] : []),
    ...(absent.length ? [`content.json has none of ${absent.join(", ")}`] : []),
    ...(content.campaign?.["campaign.json"] && content.prompts?.["gm"] ? [] : ["content.json has no campaign.json or no GM's prompt"]),
  ];
}

/** Files holding the dev key, or anything shaped like an OpenRouter key: by name only (the site's build, build-site.ts, holds the whole site to it too). */
export function leaks(site: Site, needles: string[]): string[] {
  const leaking = [...site].filter(([, bytes]) => {
    const text = Buffer.from(bytes).toString("latin1");
    return needles.some(needle => text.includes(needle)) || KEYISH.test(text);
  }).map(([path]) => path);
  return leaking.length ? [`${leaking.length} file(s) hold something like an OpenRouter key: ${leaking.join(", ")}`] : [];
}
