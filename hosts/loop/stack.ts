import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readStackFile } from "../dev/stack-file.ts";

/**
 * The GM loop's dev stack (qa/loop/README.md): the dev host (hosts/dev.ts, `--no-keys`) run in the
 * background, so a round's games have a stack to play on between the loop's commands, each its own
 * process; and stopped again. In its own folder and on its own ports (runs/loop-stack, 3330 and
 * 8817), so it never meets a dev stack someone is playing on (3300 and 8787), the e2e (3310) or the
 * arc (3320). The dev host does everything else as `npm run dev` does: the mode (namespace when
 * 11.0.0.1 isn't this machine's), the campaign installed in both services, the doctor.
 */

export interface StackAsk {
  root: string;
  port: number;
  aiPort: number;
  fake: boolean;
  fresh: boolean;
  mode?: string | undefined;
}

/** <root>/loop-stack.json: the background dev host, while it runs. */
interface Running { pid: number; started: string; args: string[] }

const LOG = "loop-stack.log";
const RUNNING = "loop-stack.json";
/** The dev host prints its screen once both services are up, the campaign installed and the doctor run: its first line. */
const READY = "Kingmaker dev stack ·";

/** The dev host started in the background, and waited for until its stack is up (its screen, as `npm run dev` prints it), or why not. */
export async function stackUp(ask: StackAsk, repo: string, wait = 8 * 60_000): Promise<string> {
  const running = runningIn(ask.root);
  if (running) return `A stack is up already in ${ask.root} (the dev host's pid ${running.pid}): npm run loop -- stack down first.`;

  mkdirSync(ask.root, { recursive: true });
  const args = devArgs(ask, repo);
  const pid = spawnDetached(args, repo, join(ask.root, LOG));
  writeFileSync(join(ask.root, RUNNING), `${JSON.stringify({ pid, started: new Date().toISOString(), args } satisfies Running, null, 1)}\n`);

  await readyOrNot(ask.root, pid, wait);
  return screenOf(ask.root);
}

/** The background dev host stopped (SIGTERM: it stops the AI service, then SpacetimeDB), and waited for. */
export async function stackDown(root: string, wait = 60_000): Promise<string> {
  const running = runningIn(root);
  if (!running) return `No stack of the loop's is up in ${root}.`;

  process.kill(running.pid, "SIGTERM");
  const stopped = await until(() => !alive(running.pid), wait);
  if (!stopped) process.kill(-running.pid, "SIGKILL");
  rmSync(join(root, RUNNING), { force: true });
  return stopped ? `The stack in ${root} is down.` : `The stack in ${root} didn't stop in ${wait / 1000} s: killed.`;
}

/** Whether the loop's stack is up, and where. */
export function stackStatus(root: string): string {
  const running = runningIn(root);
  const file = readStackFile(root);
  if (!running) return `No stack of the loop's is up in ${root}${file?.pids.host && alive(file.pids.host) ? `, but a dev host is (pid ${file.pids.host}): the loop can play on it all the same` : ""}.`;
  return `${screenOf(root)}\n(The dev host's pid ${running.pid}, started ${running.started}; its log is ${join(root, LOG)}.)`;
}

// ---------------------------------------------------------------------------------------------

function devArgs(ask: StackAsk, repo: string): string[] {
  return [
    "--no-warnings", "--import", "tsx", join(repo, "hosts", "dev.ts"), "--no-keys", "--root", ask.root, "--port", String(ask.port), "--ai-port", String(ask.aiPort),
    ...(ask.fake ? ["--fake"] : []), ...(ask.fresh ? ["--fresh"] : []), ...(ask.mode ? ["--mode", ask.mode] : []),
  ];
}

/** Node on the dev host, in a process group of its own with its output in the log, left running when this process ends. */
function spawnDetached(args: string[], cwd: string, log: string): number {
  const out = openSync(log, "w");
  const child = spawn(process.execPath, args, { cwd, detached: true, stdio: ["ignore", out, out], env: process.env });
  closeSync(out);
  child.unref();
  if (child.pid === undefined) throw new Error("the dev host didn't start");
  return child.pid;
}

/** Up once the dev host's screen is in its log; an error with the log's end if it exits first, or doesn't come up in time. */
async function readyOrNot(root: string, pid: number, wait: number): Promise<void> {
  const up = await until(() => logOf(root).includes(READY) || !alive(pid), wait);
  if (up && logOf(root).includes(READY)) return;
  rmSync(join(root, RUNNING), { force: true });
  if (alive(pid)) process.kill(pid, "SIGTERM");
  throw new Error(`The stack didn't come up${up ? "" : ` in ${wait / 1000} s`}. The end of ${join(root, LOG)}:\n${logOf(root).split("\n").slice(-15).join("\n")}`);
}

const logOf = (root: string) => (existsSync(join(root, LOG)) ? readFileSync(join(root, LOG), "utf8") : "");
const screenOf = (root: string) => logOf(root).slice(logOf(root).lastIndexOf(READY)).trim();

function runningIn(root: string): Running | undefined {
  const file = join(root, RUNNING);
  if (!existsSync(file)) return undefined;
  const running = JSON.parse(readFileSync(file, "utf8")) as Running;
  return alive(running.pid) ? running : undefined;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(done: () => boolean, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 500))) if (done()) return true;
  return done();
}
