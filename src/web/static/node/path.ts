/**
 * node:path for the browser build: POSIX paths, as Node's path.posix has them. The game's files
 * live under /kingmaker in the browser's file system (fs.ts), and its working directory is there.
 */

import { cwd } from "./cwd.ts";

export const sep = "/";
export const delimiter = ":";

export function normalize(path: string): string {
  if (path === "") return ".";
  const absolute = path.startsWith("/");
  const trailing = path.endsWith("/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length && parts[parts.length - 1] !== "..") parts.pop();
      else if (!absolute) parts.push("..");
      continue;
    }
    parts.push(part);
  }
  let out = parts.join("/");
  if (absolute) out = `/${out}`;
  if (trailing && out !== "/" && out !== "") out += "/";
  return out || (absolute ? "/" : ".");
}

export function join(...paths: string[]): string {
  const joined = paths.filter(p => p !== "").join("/");
  return joined ? normalize(joined) : ".";
}

export function resolve(...paths: string[]): string {
  let resolved = "";
  for (let i = paths.length - 1; i >= 0 && !resolved.startsWith("/"); i--) {
    const p = paths[i]!;
    if (!p) continue;
    resolved = resolved ? `${p}/${resolved}` : p;
  }
  if (!resolved.startsWith("/")) resolved = `${cwd()}/${resolved}`;
  const out = normalize(resolved);
  return out.length > 1 && out.endsWith("/") ? out.slice(0, -1) : out;
}

export function isAbsolute(path: string): boolean { return path.startsWith("/"); }

export function dirname(path: string): string {
  if (!path) return ".";
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const i = trimmed.lastIndexOf("/");
  if (i < 0) return ".";
  if (i === 0) return "/";
  return trimmed.slice(0, i);
}

export function basename(path: string, ext?: string): string {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
  let base = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  if (ext && base.endsWith(ext) && base !== ext) base = base.slice(0, -ext.length);
  return base;
}

export function extname(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i);
}

export function relative(from: string, to: string): string {
  const a = resolve(from).split("/").filter(Boolean);
  const b = resolve(to).split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill(".."), ...b.slice(i)].join("/");
}

export function parse(path: string): { root: string; dir: string; base: string; ext: string; name: string } {
  const base = basename(path);
  const ext = extname(path);
  return { root: path.startsWith("/") ? "/" : "", dir: dirname(path), base, ext, name: ext ? base.slice(0, -ext.length) : base };
}

export function format(p: { root?: string; dir?: string; base?: string; ext?: string; name?: string }): string {
  const base = p.base ?? `${p.name ?? ""}${p.ext ?? ""}`;
  const dir = p.dir ?? p.root ?? "";
  return dir ? (dir.endsWith("/") ? `${dir}${base}` : `${dir}/${base}`) : base;
}

export function toNamespacedPath(path: string): string { return path; }

const path = { sep, delimiter, normalize, join, resolve, isAbsolute, dirname, basename, extname, relative, parse, format, toNamespacedPath };
export const posix = path;
export default path;
