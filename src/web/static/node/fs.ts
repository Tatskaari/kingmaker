import { ROOT } from "./cwd.ts";
import { dirname, resolve } from "./path.ts";
import { fileURLToPath } from "./url.ts";

/**
 * node:fs for the browser build: a file system in memory. The game's content (lore, prompts, the
 * rules' content pack) is mounted read-only under /kingmaker from what the build bundled; runs/
 * (saves, logs, the look cache) is writable, and every change to it is noted for the worker to
 * persist (IndexedDB, persist.ts). The synchronous API the game uses, with Node's error codes.
 */

interface FileEntry { kind: "file"; data: string | Uint8Array; mtimeMs: number; readonly: boolean }
interface DirEntry { kind: "dir"; mtimeMs: number; readonly: boolean }
type Entry = FileEntry | DirEntry;

const entries = new Map<string, Entry>([[ "/", { kind: "dir", mtimeMs: 0, readonly: true } ]]);
const children = new Map<string, Set<string>>([["/", new Set()]]);

/** Where changes are persisted from. */
export const PERSISTED = `${ROOT}/runs`;
type Change = "put" | "delete";
const changes = new Map<string, Change>();
const listeners = new Set<() => void>();

const persisted = (path: string) => path === PERSISTED || path.startsWith(`${PERSISTED}/`);

function noteChange(path: string, change: Change): void {
  if (!persisted(path)) return;
  changes.set(path, change);
  for (const l of listeners) l();
}

/** Changes to persist since the last call (path -> put or delete). */
export function takeChanges(): Map<string, Change> {
  const out = new Map(changes);
  changes.clear();
  return out;
}

/** Changes that couldn't be persisted, back to be tried with the next (a newer change to the same path wins). */
export function requeue(pending: Map<string, Change>): void {
  for (const [path, change] of pending) if (!changes.has(path)) changes.set(path, change);
}

export function onChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The data and time of a file (for persisting it). */
export function peek(path: string): { data: string | Uint8Array; mtimeMs: number } | undefined {
  const e = entries.get(path);
  return e?.kind === "file" ? { data: e.data, mtimeMs: e.mtimeMs } : undefined;
}

export class FsError extends Error {
  code: string;
  errno: number;
  syscall: string;
  path: string;
  constructor(code: string, errno: number, description: string, syscall: string, path: string) {
    super(`${code}: ${description}, ${syscall} '${path}'`);
    this.code = code;
    this.errno = errno;
    this.syscall = syscall;
    this.path = path;
  }
}

const enoent = (syscall: string, path: string) => new FsError("ENOENT", -2, "no such file or directory", syscall, path);
const eexist = (syscall: string, path: string) => new FsError("EEXIST", -17, "file already exists", syscall, path);
const enotdir = (syscall: string, path: string) => new FsError("ENOTDIR", -20, "not a directory", syscall, path);
const eisdir = (syscall: string, path: string) => new FsError("EISDIR", -21, "illegal operation on a directory", syscall, path);
const erofs = (syscall: string, path: string) => new FsError("EROFS", -30, "read-only file system", syscall, path);
const enotempty = (syscall: string, path: string) => new FsError("ENOTEMPTY", -39, "directory not empty", syscall, path);

type PathLike = string | URL | { href: string };

function toPath(p: PathLike): string {
  const s = typeof p === "string" ? p : p instanceof URL ? p.href : p.href;
  return resolve(s.startsWith("file:") ? fileURLToPath(s) : s);
}

function addChild(path: string): void {
  const parent = dirname(path);
  let set = children.get(parent);
  if (!set) { set = new Set(); children.set(parent, set); }
  set.add(path.slice(path.lastIndexOf("/") + 1));
}

function removeChild(path: string): void {
  children.get(dirname(path))?.delete(path.slice(path.lastIndexOf("/") + 1));
}

function ensureDirs(path: string, readonly: boolean, now: number): void {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    const e = entries.get(current);
    if (e?.kind === "file") throw enotdir("mkdir", current);
    if (!e) {
      entries.set(current, { kind: "dir", mtimeMs: now, readonly });
      children.set(current, new Set());
      addChild(current);
    }
  }
}

function writable(path: string, syscall: string): void {
  // Read-only: the content mounted from the build (and the directories it's in), not runs/.
  const e = entries.get(path);
  if (e?.readonly) throw erofs(syscall, path);
  const parent = entries.get(dirname(path));
  if (!e && parent?.readonly && !persisted(path)) throw erofs(syscall, path);
}

/** Mount the build's content, read-only (paths relative to the root). */
export function mountReadOnly(files: Record<string, string>): void {
  for (const [rel, data] of Object.entries(files)) {
    const path = resolve(ROOT, rel);
    ensureDirs(dirname(path), true, 0);
    entries.set(path, { kind: "file", data, mtimeMs: 0, readonly: true });
    addChild(path);
  }
  ensureDirs(PERSISTED, false, 0);
  const runs = entries.get(PERSISTED);
  if (runs) runs.readonly = false;
}

/** Put back persisted files (the worker reads them from IndexedDB before the game starts); a record that isn't a file's is left out. */
export function restore(files: Array<{ path: string; data: string | Uint8Array; mtimeMs: number }>): void {
  for (const f of files) {
    if (typeof f?.path !== "string" || !persisted(f.path) || !(typeof f.data === "string" || f.data instanceof Uint8Array)) continue;
    ensureDirs(dirname(f.path), false, f.mtimeMs);
    entries.set(f.path, { kind: "file", data: f.data, mtimeMs: f.mtimeMs, readonly: false });
    addChild(f.path);
  }
}

// ---------------------------------------------------------------------------------------------
// The API

type Encoding = "utf8" | "utf-8" | "latin1" | "ascii" | null | undefined;
type ReadOptions = Encoding | { encoding?: Encoding; flag?: string };

const encodingOf = (o: ReadOptions | undefined): Encoding => (typeof o === "string" || o === null || o === undefined ? (o as Encoding) : o.encoding);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

class BufferLike extends Uint8Array {
  override toString(encoding?: string): string { return encoding === "latin1" ? String.fromCharCode(...this) : decoder.decode(this); }
  equals(other: Uint8Array): boolean { return this.length === other.length && this.every((b, i) => b === other[i]); }
}

export function existsSync(p: PathLike): boolean {
  try { return entries.has(toPath(p)); } catch { return false; }
}

export function readFileSync(p: PathLike, options?: ReadOptions): any {
  const path = toPath(p);
  const e = entries.get(path);
  if (!e) throw enoent("open", path);
  if (e.kind === "dir") throw eisdir("read", path);
  const enc = encodingOf(options);
  if (enc) return typeof e.data === "string" ? e.data : decoder.decode(e.data);
  const bytes = typeof e.data === "string" ? encoder.encode(e.data) : e.data;
  return new BufferLike(bytes);
}

function toData(data: unknown): string | Uint8Array {
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  return String(data);
}

export function writeFileSync(p: PathLike, data: unknown, _options?: unknown): void {
  const path = toPath(p);
  const existing = entries.get(path);
  if (existing?.kind === "dir") throw eisdir("open", path);
  const parent = entries.get(dirname(path));
  if (!parent) throw enoent("open", path);
  if (parent.kind !== "dir") throw enotdir("open", path);
  writable(path, "open");
  entries.set(path, { kind: "file", data: toData(data), mtimeMs: Date.now(), readonly: false });
  addChild(path);
  noteChange(path, "put");
}

export function appendFileSync(p: PathLike, data: unknown, _options?: unknown): void {
  const path = toPath(p);
  const existing = entries.get(path);
  if (!existing) { writeFileSync(path, data); return; }
  if (existing.kind === "dir") throw eisdir("open", path);
  writable(path, "open");
  const add = toData(data);
  if (typeof existing.data === "string" && typeof add === "string") existing.data += add;
  else {
    const a = typeof existing.data === "string" ? encoder.encode(existing.data) : existing.data;
    const b = typeof add === "string" ? encoder.encode(add) : add;
    const joined = new Uint8Array(a.length + b.length);
    joined.set(a); joined.set(b, a.length);
    existing.data = joined;
  }
  existing.mtimeMs = Date.now();
  noteChange(path, "put");
}

export function mkdirSync(p: PathLike, options?: { recursive?: boolean; mode?: number } | number): string | undefined {
  const path = toPath(p);
  const recursive = typeof options === "object" && !!options?.recursive;
  const existing = entries.get(path);
  if (existing) {
    if (recursive && existing.kind === "dir") return undefined;
    throw eexist("mkdir", path);
  }
  if (!recursive && !entries.has(dirname(path))) throw enoent("mkdir", path);
  if (!persisted(path) && entries.get(dirname(path))?.readonly) throw erofs("mkdir", path);
  ensureDirs(path, false, Date.now());
  return recursive ? path : undefined;
}

class Dirent {
  name: string;
  parentPath: string;
  path: string;
  private readonly dir: boolean;
  constructor(name: string, parentPath: string, dir: boolean) { this.name = name; this.parentPath = parentPath; this.path = parentPath; this.dir = dir; }
  isFile(): boolean { return !this.dir; }
  isDirectory(): boolean { return this.dir; }
  isSymbolicLink(): boolean { return false; }
}

export function readdirSync(p: PathLike, options?: { withFileTypes?: boolean; recursive?: boolean } | Encoding): any[] {
  const path = toPath(p);
  const e = entries.get(path);
  if (!e) throw enoent("scandir", path);
  if (e.kind !== "dir") throw enotdir("scandir", path);
  const names = [...(children.get(path) ?? [])].sort();
  const withTypes = typeof options === "object" && options !== null && !!options.withFileTypes;
  const recursive = typeof options === "object" && options !== null && !!options.recursive;
  if (!recursive) return withTypes ? names.map(n => new Dirent(n, path, entries.get(`${path === "/" ? "" : path}/${n}`)?.kind === "dir")) : names;
  const out: Array<string | Dirent> = [];
  const walk = (dir: string, prefix: string) => {
    for (const n of [...(children.get(dir) ?? [])].sort()) {
      const full = `${dir === "/" ? "" : dir}/${n}`;
      const isDir = entries.get(full)?.kind === "dir";
      out.push(withTypes ? new Dirent(n, dir, isDir) : `${prefix}${n}`);
      if (isDir) walk(full, `${prefix}${n}/`);
    }
  };
  walk(path, "");
  return out;
}

class Stats {
  mtimeMs: number;
  mtime: Date;
  atimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  size: number;
  mode: number;
  private readonly dir: boolean;
  constructor(e: Entry) {
    this.mtimeMs = e.mtimeMs;
    this.mtime = new Date(e.mtimeMs);
    this.atimeMs = this.ctimeMs = this.birthtimeMs = e.mtimeMs;
    this.size = e.kind === "file" ? (typeof e.data === "string" ? encoder.encode(e.data).length : e.data.length) : 0;
    this.mode = e.kind === "dir" ? 0o40755 : 0o100644;
    this.dir = e.kind === "dir";
  }
  isFile(): boolean { return !this.dir; }
  isDirectory(): boolean { return this.dir; }
  isSymbolicLink(): boolean { return false; }
}

export function statSync(p: PathLike, options?: { throwIfNoEntry?: boolean }): Stats | undefined {
  const path = toPath(p);
  const e = entries.get(path);
  if (!e) { if (options?.throwIfNoEntry === false) return undefined; throw enoent("stat", path); }
  return new Stats(e);
}
export const lstatSync = statSync;

/** Everything at and under a path (a file, or a directory and what's in it), deepest last. */
function subtree(path: string): string[] {
  const out = [path];
  for (const name of children.get(path) ?? []) out.push(...subtree(`${path === "/" ? "" : path}/${name}`));
  return out;
}

export function renameSync(from: PathLike, to: PathLike): void {
  const a = toPath(from), b = toPath(to);
  const e = entries.get(a);
  if (!e) throw enoent("rename", a);
  writable(a, "rename");
  if (!entries.has(dirname(b))) throw enoent("rename", b);
  writable(b, "rename");
  if (a === b) return;
  const target = entries.get(b);
  if (target?.kind === "dir" && e.kind === "dir" && (children.get(b)?.size ?? 0) > 0) throw enotempty("rename", b);
  if (target?.kind === "dir" && e.kind === "file") throw eisdir("rename", b);
  if (target) for (const old of subtree(b).reverse()) { entries.delete(old); children.delete(old); removeChild(old); noteChange(old, "delete"); }
  const moving = subtree(a);
  const moved: Array<[string, Entry, Set<string> | undefined]> = moving.map(old => [old, entries.get(old)!, children.get(old)]);
  for (const old of [...moving].reverse()) { entries.delete(old); children.delete(old); removeChild(old); noteChange(old, "delete"); }
  for (const [old, entry, kids] of moved) {
    const next = b + old.slice(a.length);
    entries.set(next, entry);
    if (kids) children.set(next, new Set(kids));
    addChild(next);
    if (entry.kind === "file") noteChange(next, "put");
  }
}

export function rmSync(p: PathLike, options?: { force?: boolean; recursive?: boolean }): void {
  const path = toPath(p);
  const e = entries.get(path);
  if (!e) { if (options?.force) return; throw enoent("rm", path); }
  writable(path, "rm");
  if (e.kind === "dir" && !options?.recursive) throw new FsError("ERR_FS_EISDIR", -21, "Path is a directory", "rm", path);
  for (const old of subtree(path).reverse()) { entries.delete(old); children.delete(old); removeChild(old); noteChange(old, "delete"); }
}

export function unlinkSync(p: PathLike): void {
  const path = toPath(p);
  const e = entries.get(path);
  if (!e) throw enoent("unlink", path);
  if (e.kind === "dir") throw eisdir("unlink", path);
  rmSync(path);
}

export function rmdirSync(p: PathLike, options?: { recursive?: boolean }): void {
  const path = toPath(p);
  const e = entries.get(path);
  if (!e) throw enoent("rmdir", path);
  if (e.kind !== "dir") throw enotdir("rmdir", path);
  if (!options?.recursive && (children.get(path)?.size ?? 0) > 0) throw enotempty("rmdir", path);
  rmSync(path, { recursive: true });
}

export function copyFileSync(src: PathLike, dest: PathLike): void {
  writeFileSync(dest, readFileSync(src));
}

let temp = 0;
export function mkdtempSync(prefix: string): string {
  const path = `${toPath(prefix)}${Date.now().toString(36)}${(temp++).toString(36)}`;
  mkdirSync(path, { recursive: true });
  return path;
}

export function accessSync(p: PathLike): void {
  if (!existsSync(p)) throw enoent("access", toPath(p));
}

export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 };

// The promise API, over the same calls.
export const promises = {
  readFile: async (p: PathLike, o?: ReadOptions) => readFileSync(p, o),
  writeFile: async (p: PathLike, d: unknown) => writeFileSync(p, d),
  appendFile: async (p: PathLike, d: unknown) => appendFileSync(p, d),
  mkdir: async (p: PathLike, o?: { recursive?: boolean }) => mkdirSync(p, o),
  readdir: async (p: PathLike, o?: { withFileTypes?: boolean }) => readdirSync(p, o),
  stat: async (p: PathLike) => statSync(p),
  rename: async (a: PathLike, b: PathLike) => renameSync(a, b),
  rm: async (p: PathLike, o?: { force?: boolean; recursive?: boolean }) => rmSync(p, o),
  unlink: async (p: PathLike) => unlinkSync(p),
  access: async (p: PathLike) => accessSync(p),
};

const fs = {
  existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, statSync, lstatSync, renameSync, rmSync, unlinkSync, rmdirSync,
  copyFileSync, mkdtempSync, accessSync, constants, promises,
};
export default fs;
