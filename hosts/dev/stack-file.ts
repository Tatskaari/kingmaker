import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Mode } from "./mode.ts";
import type { Identity, SpacetimeCli } from "./spacetime.ts";

/**
 * <root>/stack.json: a running stack as the other tools find it (v0-design §9.1 step 9). The client
 * and the headless client read `ws` and `db`; install-campaign and the doctor read the rest. It holds
 * local dev credentials (tokens signed by this stack's keys, the bearer), so it's private to the
 * user and gitignored with runs/.
 */
export interface StackFile {
  root: string;
  mode: Mode;
  /** SpacetimeDB from the host: http://127.0.0.1:<port>, and the same as a WebSocket for the client. */
  http: string;
  ws: string;
  db: string;
  /** The AI service from the host, and as the module calls it (AI_URL). */
  aiFromHost: string;
  aiFromSimulation: string;
  /** The database's owner: the CLI is logged in as it, and it calls install_campaign and ping_ai. */
  owner: Identity;
  /** The AI service's identity (AI_IDENTITY, KM_STDB_TOKEN), the bearer the module sends it (AI_TOKEN, KM_AI_TOKEN), and how it runs. */
  ai: Identity & { bearer: string; model: "openrouter" | "fake"; gm?: "pipeline" | "canned"; container: boolean };
  /** The CLI as the stack drives it: `spacetime --config-path <config> logs kingmaker -s <server>`. */
  cli: SpacetimeCli;
  ports: { stdb: number; ai: number };
  /** The dev host (or the e2e), SpacetimeDB's group (pasta's in namespace mode) and the AI service's, while they run. */
  pids: { host?: number; stdb?: number; ai?: number };
}

export const stackPath = (root: string) => join(root, "stack.json");

/** The stack a folder holds, or undefined when there's none. */
export function readStackFile(root: string): StackFile | undefined {
  const path = stackPath(root);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as StackFile;
}

export function writeStackFile(file: StackFile): void {
  const path = stackPath(file.root);
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}
