/**
 * Posix paths, as Node's path.posix has them for the paths the AI service names files by: a doc's in
 * its volume ("Cast/Kell/private.md", a link's "../World/Secret.md" from it), a campaign file's in its
 * version, a prompt's in its folder, and a folder's on disk. No node:path, so the docs service and the
 * campaigns run in a browser too. paths.test.ts holds them to Node's.
 */

/** "." and ".." resolved and repeated slashes made one: a relative path keeps the ".." above its start, "/" has none above it, and a trailing slash stays. */
export function normalize(path: string): string {
  if (!path) return ".";
  const absolute = path.startsWith("/");
  const trailing = path.endsWith("/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part !== "..") parts.push(part);
    else if (parts.length && parts[parts.length - 1] !== "..") parts.pop();
    else if (!absolute) parts.push(part);
  }
  const joined = parts.join("/");
  if (!joined) return absolute ? "/" : trailing ? "./" : ".";
  return `${absolute ? "/" : ""}${joined}${trailing ? "/" : ""}`;
}

/** The paths one after another, made normal ("." for none). */
export const join = (...paths: string[]): string => normalize(paths.filter(Boolean).join("/") || ".");

/** The folder a path is in: up to the slash before its last part (a trailing slash isn't one), "." for a name alone, "/" for one at the root. */
export function dirname(path: string): string {
  let end = -1;
  let named = false;
  for (let i = path.length - 1; i >= 1 && end < 0; i--) {
    if (path[i] !== "/") named = true;
    else if (named) end = i;
  }
  if (end < 0) return path.startsWith("/") ? "/" : ".";
  return path.startsWith("/") && end === 1 ? "//" : path.slice(0, end);
}

/** A path's last part, without `suffix` when it ends with it (and is more than it). */
export function basename(path: string, suffix?: string): string {
  const base = path.replace(/\/+$/, "").split("/").pop() ?? "";
  return suffix && base !== suffix && base.endsWith(suffix) ? base.slice(0, -suffix.length) : base;
}

export const isAbsolute = (path: string): boolean => path.startsWith("/");
