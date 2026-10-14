import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { spawn, type IPty } from "node-pty";

/**
 * One game under a pseudo-terminal: the same command as `npm run game`, with the browser's terminal
 * size, and stopped the way Ctrl+C stops it (the app saves and quits) when the page goes away.
 *
 * After each turn the game starts background jobs (the memory review and the co-GM's repair, in
 * src/runtime/background.ts) in sessions of their own, so the game's process group never reaches
 * them. Every process the game starts inherits a tag in its environment, and that's how they're
 * found once the game has stopped: settle() waits for them, and stops whatever is left at its limit.
 */

export const GAME_ARGS = ["--experimental-ffi", "--no-warnings", "--import", "tsx", "src/app/main.tsx"];

// The name of the tag; its value is the game's own.
const TAG = "KM_WEB_GAME";

export interface GameOptions {
  cwd: string;
  cols: number;
  rows: number;
  env: Record<string, string>;
  onData: (chunk: Buffer) => void;
  onExit: (code: number, signal: number) => void;
}

export class GameTerminal {
  readonly pid: number;
  readonly started = Date.now();
  private readonly pty: IPty;
  private readonly tag = `${TAG}=${process.pid}-${randomBytes(9).toString("base64url")}`;
  private exited = false;
  private readonly exit: Promise<void>;
  private stopping: Promise<void> | undefined;
  private settling: Promise<{ jobs: number; stopped: number }> | undefined;
  private readonly hurry = new AbortController();
  private paused = false;

  constructor(options: GameOptions) {
    const [name, value] = this.tag.split("=") as [string, string];
    // encoding: null hands over the raw bytes; the page's terminal decodes UTF-8 across chunks.
    this.pty = spawn(process.execPath, GAME_ARGS, {
      name: "xterm-256color",
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: { ...options.env, [name]: value },
      encoding: null,
    });
    this.pid = this.pty.pid;
    this.pty.onData(chunk => options.onData(chunk as unknown as Buffer));
    this.exit = new Promise(resolve => {
      this.pty.onExit(({ exitCode, signal }) => {
        this.exited = true;
        resolve();
        options.onExit(exitCode, signal ?? 0);
      });
    });
  }

  get running(): boolean {
    return !this.exited;
  }

  write(data: Buffer | string): void {
    if (!this.exited && !this.stopping) this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.exited || (cols === this.pty.cols && rows === this.pty.rows)) return;
    try { this.pty.resize(cols, rows); } catch { /* it exited in between */ }
  }

  /** Stop reading the game's output while the page catches up (the game then waits on its writes). */
  pause(): void {
    if (!this.paused && !this.exited) { this.paused = true; this.pty.pause(); }
  }

  resume(): void {
    if (this.paused) { this.paused = false; this.pty.resume(); }
  }

  /** Ctrl+C (the app saves and quits), then SIGTERM (main.tsx saves on it too), then SIGKILL; resolves once nothing of the game's own group is left. */
  stop(): Promise<void> {
    this.stopping ??= (async () => {
      // A game blocked writing to a paused pty can't read its Ctrl+C.
      this.resume();
      if (!this.exited) {
        this.pty.write("\x03");
        if (!(await this.waitExit(5000))) {
          this.signal("SIGTERM");
          if (!(await this.waitExit(3000))) {
            this.signal("SIGKILL");
            await this.waitExit(3000);
          }
        }
      }
      // Whatever the game started in its session (tsx's esbuild service) goes with it.
      for (let i = 0; i < 20 && groupAlive(this.pid); i++) {
        this.signal(i < 10 ? "SIGTERM" : "SIGKILL");
        await sleep(50);
      }
    })();
    return this.stopping;
  }

  /** Whether any process of the game's session is still around. */
  get lingering(): boolean {
    return groupAlive(this.pid);
  }

  /** The game's background jobs that are still running: processes outside its own group that carry its tag. */
  background(): number[] {
    return tagged(this.tag).filter(pid => groupOf(pid) !== this.pid);
  }

  /**
   * Stops the game, then waits for its background jobs to finish, for up to limitMs (or until
   * hurryUp()), and stops whatever is left. Resolves with how many jobs there were and how many it
   * had to stop.
   */
  settle(limitMs: number): Promise<{ jobs: number; stopped: number }> {
    this.settling ??= (async () => {
      await this.stop();
      let jobs = this.background();
      const count = jobs.length;
      const end = Date.now() + limitMs;
      for (let i = 1; jobs.length && Date.now() < end && !this.hurry.signal.aborted; i++) {
        await sleep(500, this.hurry.signal);
        // Checking the pids it has is cheap. /proc is read again once they've all gone (for anything
        // they started) and every ten seconds (a zombie nobody has reaped still answers to its pid).
        if (i % 20 === 0 || !jobs.some(alive)) jobs = this.background();
      }
      return { jobs: count, stopped: jobs.length ? await this.stopBackground() : 0 };
    })();
    return this.settling;
  }

  /** Don't wait for the background jobs any longer: settle() stops them now. */
  hurryUp(): void {
    this.hurry.abort();
  }

  /** At exit, when there's no time to wait: SIGTERM to whatever background jobs are left. */
  abandonBackground(): void {
    for (const pid of this.background()) signalGroup(pid, "SIGTERM");
  }

  // SIGTERM, then SIGKILL to what hasn't gone in 3 seconds; each is checked for the tag again
  // first, so a reused pid is never signalled. Resolves with how many there were.
  private async stopBackground(): Promise<number> {
    let jobs = this.background();
    const count = jobs.length;
    for (const pid of jobs) signalGroup(pid, "SIGTERM");
    for (let i = 0; i < 30 && jobs.some(alive); i++) await sleep(100);
    jobs = this.background();
    for (const pid of jobs) signalGroup(pid, "SIGKILL");
    for (let i = 0; i < 10 && jobs.some(alive); i++) await sleep(100);
    return count;
  }

  private waitExit(ms: number): Promise<boolean> {
    if (this.exited) return Promise.resolve(true);
    return Promise.race([this.exit.then(() => true), sleep(ms).then(() => false)]);
  }

  // node-pty starts the game in a session of its own, so its pid is also its process group.
  private signal(signal: NodeJS.Signals): void {
    try { process.kill(-this.pid, signal); } catch { /* already gone */ }
  }
}

/**
 * The processes whose environment carries this entry (NAME=value). Reads /proc, so on a system
 * without it (macOS) nothing is found and background jobs aren't followed.
 */
function tagged(entry: string): number[] {
  const inside = Buffer.from(`\0${entry}\0`);
  const first = Buffer.from(`${entry}\0`);
  const pids: number[] = [];
  let entries: string[];
  try { entries = readdirSync("/proc"); } catch { return pids; }
  for (const name of entries) {
    if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
    let environ: Buffer;
    // Another user's process, or one that has just gone.
    try { environ = readFileSync(`/proc/${name}/environ`); } catch { continue; }
    if (environ.includes(inside) || environ.subarray(0, first.length).equals(first)) pids.push(Number(name));
  }
  return pids;
}

/** The process group a process is in, from /proc/<pid>/stat (after the command's name, which can hold anything). */
function groupOf(pid: number): number | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "latin1");
    return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]);
  } catch {
    return undefined;
  }
}

// A background job leads a session (and so a group) of its own; anything else gets the signal alone.
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try { process.kill(groupOf(pid) === pid ? -pid : pid, signal); } catch { /* already gone */ }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Cut short when the signal aborts (and leaves no listener on it either way).
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>(resolve => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
