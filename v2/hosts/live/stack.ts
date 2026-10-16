import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Health } from "../../shared/protocol/ai.ts";
import { request } from "../dev/http.ts";
import { readStackFile, type StackFile } from "../dev/stack-file.ts";

/**
 * The dev stack a live run plays against: found by its ports (the dev host's, 3300 and 8787, unless
 * told), or by its folder; and the model its AI service runs, which must be a real one unless the run
 * is a rehearsal.
 */

export interface StackWanted { port: number; aiPort: number; portsGiven: boolean; stack?: string }

/** The running stack: --stack's folder, else the one under runs/ whose stack.json has the ports asked for. */
export function runningStack(runs: string, wanted: StackWanted): StackFile {
  const stack = wanted.stack ? readStackFile(wanted.stack) : stackOn(runs, wanted.port, wanted.aiPort);
  if (!stack?.pids.stdb || !stack.pids.ai) {
    const where = wanted.stack ? `from ${wanted.stack}` : `on ports ${wanted.port} and ${wanted.aiPort}`;
    const start = wanted.stack || (wanted.port === 3300 && wanted.aiPort === 8787) ? "npm run dev" : `npm run dev -- --port ${wanted.port} --ai-port ${wanted.aiPort}`;
    throw new Error(`there's no dev stack running ${where}: start one with ${start}`);
  }
  if (wanted.portsGiven && (stack.ports.stdb !== wanted.port || stack.ports.ai !== wanted.aiPort)) {
    throw new Error(`the stack in ${stack.root} is on ports ${stack.ports.stdb} and ${stack.ports.ai}, not ${wanted.port} and ${wanted.aiPort}`);
  }
  return stack;
}

/** The stack under runs/ (runs/dev first) on these ports, if one is running. */
export function stackOn(runs: string, port: number, aiPort: number): StackFile | undefined {
  if (!existsSync(runs)) return undefined;
  const dirs = readdirSync(runs, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
    .sort((a, b) => Number(b === "dev") - Number(a === "dev") || a.localeCompare(b));
  return dirs.map(d => readStackFile(join(runs, d))).find(s => s?.ports.stdb === port && s.ports.ai === aiPort && !!s.pids.stdb && !!s.pids.ai);
}

/** The model the AI service runs, as its health says ("openrouter", "fake"); the fake model or the canned GM only for a rehearsal. */
export async function modelOf(stack: StackFile, rehearse: boolean): Promise<string> {
  const answer = await request(`${stack.aiFromHost}/v1/health`, { timeoutMs: 5_000 });
  if ("error" in answer || answer.status !== 200) throw new Error(`the AI service doesn't answer at ${stack.aiFromHost} (${"error" in answer ? answer.error : answer.status}): is the dev stack up?`);
  const health = JSON.parse(answer.body) as Health;
  if ((health.model !== "openrouter" || health.gm === "canned") && !rehearse) {
    throw new Error("the dev stack runs the fake model: start it with real models (npm run dev), or pass --rehearse to try this run on the fake");
  }
  return `${health.model}${health.gm === "canned" ? ", canned GM" : ""}`;
}
