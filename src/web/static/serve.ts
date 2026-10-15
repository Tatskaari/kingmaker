import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/**
 * A plain static file server for dist/web, the way GitHub Pages serves it: files only, under a
 * path (/kingmaker/pr-preview/pr-650/ by default, as the PR previews are), no headers of the game's
 * own, and Pages' caching (any file may be kept for ten minutes, then asked about with
 * If-Modified-Since). For trying the static build locally and for its check (check.ts).
 *
 *   node --no-warnings src/web/static/serve.ts [--port 7312] [--base /kingmaker/pr-preview/pr-650/]
 */

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".ttf": "font/ttf", ".otf": "font/otf",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".map": "application/json",
};

export const DEFAULT_BASE = "/kingmaker/pr-preview/pr-650/";

export function serveStatic(root: string, base = DEFAULT_BASE, port = 0, host = "127.0.0.1"): Promise<{ server: Server; url: string; requests: string[] }> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    requests.push(req.url ?? "/");
    if (!path.startsWith(base)) { res.writeHead(404).end("Not found\n"); return; }
    let file = normalize(join(root, path.slice(base.length)));
    if (!file.startsWith(normalize(root) + sep) && file !== normalize(root)) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) { res.writeHead(404).end("Not found\n"); return; }
    const stat = statSync(file);
    const modified = new Date(Math.floor(stat.mtimeMs / 1000) * 1000);
    const since = Date.parse(req.headers["if-modified-since"] ?? "");
    if (since >= modified.getTime()) { res.writeHead(304, { "Cache-Control": "max-age=600", "Last-Modified": modified.toUTCString() }).end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Content-Length": stat.size, "Cache-Control": "max-age=600", "Last-Modified": modified.toUTCString() });
    createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(port, host, () => {
    const address = server.address();
    const p = typeof address === "object" && address ? address.port : port;
    resolve({ server, url: `http://${host}:${p}${base}`, requests });
  }));
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { port: { type: "string" }, base: { type: "string" }, dir: { type: "string" } } });
  const root = values.dir ?? fileURLToPath(new URL("../../../dist/web", import.meta.url));
  if (!existsSync(join(root, "index.html"))) { console.error(`No build in ${root}: npm run build:web first.`); process.exit(1); }
  const { url } = await serveStatic(root, values.base ?? DEFAULT_BASE, Number(values.port ?? 7312));
  console.log(`dist/web on ${url}`);
}
