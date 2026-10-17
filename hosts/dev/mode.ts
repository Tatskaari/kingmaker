import { networkInterfaces } from "node:os";

/**
 * How the module reaches the AI service on one machine (v0-design §1.5). SpacetimeDB's HTTP client
 * refuses every special-purpose address (loopback, the private ranges, link-local), so the module
 * always calls 11.0.0.1, an ordinary address, and the stack makes that address reach the service:
 *
 * - host: 11.0.0.1 is on one of this machine's interfaces (`sudo ip addr add 11.0.0.1/32 dev lo`).
 *   SpacetimeDB runs on the host; the AI service listens on 11.0.0.1 and 127.0.0.1.
 * - namespace: otherwise. SpacetimeDB runs inside pasta, which forwards the host's 127.0.0.1:<port>
 *   to it and makes 11.0.0.1 inside mean the host's loopback, where the AI service listens.
 */

export type Mode = "host" | "namespace";

/** The address the module calls the AI service at, in either mode. */
export const AI_ADDRESS = "11.0.0.1";

/** This machine's IPv4 addresses, every interface's. */
export function localAddresses(): string[] {
  return Object.values(networkInterfaces()).flatMap(list => (list ?? []).filter(a => a.family === "IPv4").map(a => a.address));
}

/** Host mode when 11.0.0.1 is this machine's; namespace mode otherwise. */
export function detectMode(addresses: string[]): Mode {
  return addresses.includes(AI_ADDRESS) ? "host" : "namespace";
}

/** Where SpacetimeDB listens: the host's loopback, or every address inside the namespace (pasta forwards the host's loopback port to it). */
export function stdbListen(mode: Mode, port: number): string {
  return mode === "host" ? `127.0.0.1:${port}` : `0.0.0.0:${port}`;
}

/** Where the AI service listens (KM_AI_LISTEN): 11.0.0.1 too in host mode, for the module; the host's loopback in both, for the host's tools. */
export function aiListen(mode: Mode, port: number): string {
  return mode === "host" ? `${AI_ADDRESS}:${port},127.0.0.1:${port}` : `127.0.0.1:${port}`;
}

/** The AI service's URL from the host (the tools, the doctor) and from the module (AI_URL). */
export function aiUrls(port: number): { fromHost: string; fromSimulation: string } {
  return { fromHost: `http://127.0.0.1:${port}`, fromSimulation: `http://${AI_ADDRESS}:${port}` };
}

/**
 * pasta's command line for a command run in a namespace of its own: the network configured
 * (--config-net), the host's 127.0.0.1:<port> forwarded in, and 11.0.0.1 mapped to the host's
 * loopback. pasta stays in the foreground, so stopping it stops the command, and it runs the command
 * through /usr/bin/env: SELinux won't let pasta exec a binary in the home folder itself.
 */
export function pastaArgs(port: number, command: string[]): string[] {
  return ["--config-net", "--quiet", "--foreground", "--tcp-ports", `127.0.0.1/${port}`, "--map-host-loopback", AI_ADDRESS, "--", "/usr/bin/env", ...command];
}

/** What to do when a mode can't run here, or undefined when it can. */
export function modeProblem(mode: Mode, addresses: string[], hasPasta: boolean): string | undefined {
  if (mode === "host" && !addresses.includes(AI_ADDRESS)) return `host mode needs ${AI_ADDRESS} on this machine: sudo ip addr add ${AI_ADDRESS}/32 dev lo (or run in namespace mode)`;
  if (mode === "namespace" && !hasPasta) return `namespace mode needs pasta (the passt package: sudo dnf install passt), or host mode: sudo ip addr add ${AI_ADDRESS}/32 dev lo`;
  return undefined;
}
