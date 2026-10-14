import { spawn, type IPty } from "node-pty";

/**
 * One game under a pseudo-terminal: the same command as `npm run game`, with the browser's terminal
 * size, and stopped the way Ctrl+C stops it (the app saves and quits) when the page goes away.
 */

export const GAME_ARGS = ["--experimental-ffi", "--no-warnings", "--import", "tsx", "src/app/main.tsx"];

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
  private exited = false;
  private readonly exit: Promise<void>;
  private stopping: Promise<void> | undefined;
  private paused = false;

  constructor(options: GameOptions) {
    // encoding: null hands over the raw bytes; the page's terminal decodes UTF-8 across chunks.
    this.pty = spawn(process.execPath, GAME_ARGS, {
      name: "xterm-256color",
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: options.env,
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

  /** Ctrl+C (the app saves and quits), then SIGTERM (main.tsx saves on it too), then SIGKILL; resolves once nothing of the game is left. */
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

  private waitExit(ms: number): Promise<boolean> {
    if (this.exited) return Promise.resolve(true);
    return Promise.race([this.exit.then(() => true), sleep(ms).then(() => false)]);
  }

  // node-pty starts the game in a session of its own, so its pid is also its process group.
  private signal(signal: NodeJS.Signals): void {
    try { process.kill(-this.pid, signal); } catch { /* already gone */ }
  }
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
