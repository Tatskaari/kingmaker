import { EventEmitter } from "../../tui/events.ts";
import { chdir, cwd } from "./cwd.ts";
import * as fs from "./fs.ts";
import * as path from "./path.ts";

/**
 * The `process` the game sees in the browser (the static build injects this for every use of the
 * global): its environment (the worker fills it in before the game's modules load), a working
 * directory in the browser's file system, events for the worker to forward, exit() handing over to
 * the worker, and the built-ins asked for by name rather than imported (getBuiltinModule: v2/ai's
 * folders of docs and prompts ask for node:fs that way). Nothing here reaches a real process.
 */

/** The stand-ins getBuiltinModule hands out, by name. */
const BUILTINS: Record<string, unknown> = { fs, path };

type ExitHandler = (code: number) => void;
let exitHandler: ExitHandler | undefined;

export function onExit(handler: ExitHandler): void { exitHandler = handler; }

const stream = (write: (s: string) => void) => ({
  isTTY: true,
  columns: 80,
  rows: 24,
  write(chunk: unknown) { write(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk as Uint8Array)); return true; },
  on() { return this; },
  once() { return this; },
  off() { return this; },
  removeListener() { return this; },
  end() {},
});

class BrowserProcess extends EventEmitter {
  env: Record<string, string | undefined> = { NODE_ENV: "production", HOME: "/home/player", LANG: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor" };
  argv = ["/usr/local/bin/node", "/kingmaker/src/app/main.tsx"];
  execArgv: string[] = [];
  execPath = "/usr/local/bin/node";
  pid = 1;
  ppid = 0;
  platform = "linux";
  arch = "wasm";
  version = "v26.9.0";
  versions = { node: "26.9.0" };
  release = { name: "node" };
  exitCode: number | undefined;
  stdout = stream(s => console.log(s.replace(/\n$/, "")));
  stderr = stream(s => console.warn(s.replace(/\n$/, "")));
  stdin = { ...stream(() => {}), setRawMode() {}, resume() {}, pause() {} };
  cwd = cwd;
  chdir = chdir;
  nextTick(fn: (...args: unknown[]) => void, ...args: unknown[]): void { queueMicrotask(() => fn(...args)); }
  hrtime = Object.assign((prev?: [number, number]) => {
    const t = performance.now();
    const s = Math.floor(t / 1000), ns = Math.floor((t % 1000) * 1e6);
    return prev ? [s - prev[0], ns - prev[1]] : [s, ns];
  }, { bigint: () => BigInt(Math.floor(performance.now() * 1e6)) });
  memoryUsage = () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 });
  uptime = () => performance.now() / 1000;
  umask = () => 0o22;
  kill(): boolean { return false; }
  getBuiltinModule(id: string): unknown { return BUILTINS[id.replace(/^node:/, "")]; }
  emitWarning(): void {}
  exit(code = 0): never {
    this.exitCode = code;
    exitHandler?.(code);
    throw new Error(`process.exit(${code})`);
  }
}

export const process = new BrowserProcess();
(globalThis as { process?: unknown }).process = process;
export default process;
