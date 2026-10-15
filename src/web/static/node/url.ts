/** node:url for the browser build: file: URLs to the browser file system's paths and back. */

export function fileURLToPath(url: string | URL): string {
  const u = typeof url === "string" ? new URL(url) : url;
  if (u.protocol !== "file:") throw new TypeError(`The URL must be of scheme file: ${u.href}`);
  return decodeURIComponent(u.pathname);
}

export function pathToFileURL(path: string): URL {
  return new URL(`file://${encodeURI(path).replace(/[?#]/g, encodeURIComponent)}`);
}

const NodeURL = globalThis.URL;
const NodeURLSearchParams = globalThis.URLSearchParams;
export { NodeURL as URL, NodeURLSearchParams as URLSearchParams };
export default { fileURLToPath, pathToFileURL, URL: NodeURL, URLSearchParams: NodeURLSearchParams };
