import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { Mode } from "./mode.ts";
import { cliVersion, CLI_VERSION } from "./spacetime.ts";

/** A command on the PATH, or undefined. */
export function which(name: string): string | undefined {
  return (process.env.PATH ?? "").split(delimiter).map(d => join(d, name)).find(p => existsSync(p));
}

/** Node 26.4 or later: v2's engines (type stripping, the global WebSocket the client's SDK uses). */
export function nodeIsNew(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 26 || (major === 26 && minor >= 4);
}

/** The SpacetimeDB CLI: on the PATH, or where its installer puts it. */
export function findSpacetime(): string | undefined {
  const installed = join(homedir(), ".local", "bin", "spacetime");
  return which("spacetime") ?? (existsSync(installed) ? installed : undefined);
}

/**
 * The tools a stack needs (v0-design §9.1 step 1): Node 26.4 or later, the pinned SpacetimeDB CLI,
 * pasta for namespace mode, podman for the container. Throws, saying how to get what's missing.
 * Returns the CLI's path.
 */
export async function checkTools(needs: { mode: Mode; container: boolean; config: string }): Promise<string> {
  if (!nodeIsNew(process.versions.node)) throw new Error(`Node 26.4 or later is needed (this is ${process.versions.node}): run from the repo, where proto picks 26.9`);

  const bin = findSpacetime();
  if (!bin) throw new Error(`the SpacetimeDB CLI isn't installed: curl -sSf https://install.spacetimedb.com | sh, then spacetime version install ${CLI_VERSION} --use`);
  const version = await cliVersion({ bin, config: needs.config });
  if (version !== CLI_VERSION) throw new Error(`SpacetimeDB CLI ${CLI_VERSION} is needed (${bin} is ${version ?? "unreadable"}): spacetime version install ${CLI_VERSION} --use`);

  if (needs.mode === "namespace" && !which("pasta")) throw new Error("namespace mode needs pasta (the passt package: sudo dnf install passt), or host mode: sudo ip addr add 11.0.0.1/32 dev lo");
  if (needs.container && !which("podman")) throw new Error("--container needs podman");
  return bin;
}
