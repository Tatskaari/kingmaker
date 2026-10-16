import { spawn } from "node:child_process";
import { createWriteStream, existsSync, readdirSync, readFileSync } from "node:fs";
import { constants } from "node:os";

/**
 * A process the stack runs (SpacetimeDB, pasta, the AI service, podman): in a process group of its
 * own, so a Ctrl+C at the terminal reaches only the dev host, which stops each in turn; with its
 * output through pipes into a log the stack writes (pasta's child lost its output when pasta wrote
 * to a file itself).
 */
export interface Child {
  pid: number;
  /** Resolves with the exit code once it's gone: 128 + the signal's number when a signal ended it. */
  exited: Promise<number>;
  running(): boolean;
  /**
   * Signals its whole group and waits until every process in it has gone (pasta's child outlives
   * pasta a moment), SIGKILL after graceMs. Resolves with its exit code.
   */
  stop(signal?: NodeJS.Signals, graceMs?: number): Promise<number>;
}

export function spawnLogged(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; log: string }): Child {
  const log = createWriteStream(options.log, { flags: "a" });
  log.write(`--- ${new Date().toISOString()} ${command} ${args.join(" ")}\n`);
  const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });

  // Exited when the process is gone; the log closed once its pipes are (a grandchild may hold them a moment longer).
  let code: number | undefined;
  const exited = new Promise<number>(resolve => {
    const done = (c: number | null, signal: NodeJS.Signals | null) => {
      if (code !== undefined) return;
      code = c ?? 128 + (signal ? constants.signals[signal] : 0);
      resolve(code);
    };
    child.on("exit", done);
    child.on("error", e => { log.write(`--- couldn't start: ${e.message}\n`); done(127, null); });
  });
  child.on("close", () => log.end(`--- exited ${code ?? "?"}\n`));
  const pid = child.pid ?? -1;

  return {
    pid,
    exited,
    running: () => code === undefined,
    async stop(signal = "SIGTERM", graceMs = 10_000) {
      await stopGroup(pid, signal, graceMs);
      return exited;
    },
  };
}

/** Signals a process group and waits until it's empty; SIGKILL after graceMs. */
export async function stopGroup(pgid: number, signal: NodeJS.Signals, graceMs: number): Promise<void> {
  if (!groupMembers(pgid).length) return;
  signalGroup(pgid, signal);
  if (await emptied(pgid, graceMs)) return;
  signalGroup(pgid, "SIGKILL");
  await emptied(pgid, 5_000);
}

async function emptied(pgid: number, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (groupMembers(pgid).length) {
    if (Date.now() >= until) return false;
    await new Promise(r => setTimeout(r, 100));
  }
  return true;
}

/** The live processes in a process group (Linux's /proc: field 5 of each stat, after the command's closing bracket). */
export function groupMembers(pgid: number): number[] {
  if (!(pgid > 1)) return [];
  return readdirSync("/proc").filter(d => /^\d+$/.test(d)).filter(d => {
    try {
      const stat = readFileSync(`/proc/${d}/stat`, "utf8");
      const [state, , pgrp] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      return Number(pgrp) === pgid && state !== "Z";
    } catch {
      return false;
    }
  }).map(Number);
}

/** Signals a process group (a stack child's: its pid is its group), ignoring one that's gone. Never group 0 or 1 (a child that never started has no pid). */
export function signalGroup(pid: number, signal: NodeJS.Signals): void {
  if (!(pid > 1)) return;
  try {
    process.kill(-pid, signal);
  } catch {
    /* already gone */
  }
}

/** Is this process alive? */
export function alive(pid: number | undefined): pid is number {
  if (!pid || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** A live process's command line and environment as text (Linux's /proc), or "" when they can't be read: how a leftover is told from a stranger reusing its pid. */
export function processText(pid: number): string {
  const read = (part: string) => (existsSync(`/proc/${pid}/${part}`) ? readFileSync(`/proc/${pid}/${part}`, "utf8").replaceAll("\0", " ") : "");
  try {
    return `${read("cmdline")}\n${read("environ")}`;
  } catch {
    return "";
  }
}

/** A log's last lines, for an error that says why something didn't start. */
export function tail(path: string, lines = 15): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
}

/** Runs a command to its end, its output gathered: never a throw (a command that won't start is code 127). */
export function run(bin: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(bin, args, { env: options.env ?? process.env, cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"], timeout: options.timeoutMs ?? 60_000 });
    let stdout = "", stderr = "";
    child.stdout.on("data", d => (stdout += d));
    child.stderr.on("data", d => (stderr += d));
    child.on("error", e => resolve({ code: 127, stdout, stderr: `${stderr}${e.message}` }));
    child.on("close", code => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
