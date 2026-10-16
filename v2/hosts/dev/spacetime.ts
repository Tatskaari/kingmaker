import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./child.ts";
import { bearer, request, type Answer } from "./http.ts";

/**
 * SpacetimeDB for the stack: the CLI (always with the stack's own config, never the user's, and
 * always naming the stack's server), its server's command line, and the HTTP API as the owner or the
 * AI service (spacetime.md §2, §5).
 */

/** The CLI as the stack drives it: the binary, the stack's own cli.toml, and the server's nickname in it. */
export interface SpacetimeCli { bin: string; config: string; server: string }

export const DB = "kingmaker";
export const CLI_VERSION = "2.12.0";

/** A local server's identity and the token that proves it. */
export interface Identity { identity: string; token: string }

/** The CLI's version ("2.12.0"), or undefined when it doesn't run. */
export async function cliVersion(cli: Pick<SpacetimeCli, "bin" | "config">): Promise<string | undefined> {
  const { stdout } = await run(cli.bin, ["--config-path", cli.config, "--version"]);
  return /tool version (\d+\.\d+\.\d+)/.exec(stdout)?.[1];
}

/** `spacetime start`'s command line: listening where the mode says, its data and keys in the stack's folders. */
export function startArgs(cli: Pick<SpacetimeCli, "bin" | "config">, at: { listen: string; dataDir: string; keysDir: string }): string[] {
  return [
    cli.bin, "--config-path", cli.config, "start", "--listen-addr", at.listen, "--data-dir", at.dataDir,
    "--jwt-pub-key-path", join(at.keysDir, "id_ecdsa.pub"), "--jwt-priv-key-path", join(at.keysDir, "id_ecdsa"), "--non-interactive",
  ];
}

/**
 * A fresh cli.toml for the stack: the server under its nickname and the CLI logged in as the owner,
 * so `spacetime --config-path <root>/cli.toml logs kingmaker -s <server>` works by hand. Rewritten at
 * every start, as the port may have changed.
 */
export async function configureCli(cli: SpacetimeCli, url: string, owner: Identity): Promise<void> {
  rmSync(cli.config, { force: true });
  const host = url.replace(/^https?:\/\//, "");
  const added = await run(cli.bin, ["--config-path", cli.config, "server", "add", cli.server, "--url", url, "--no-fingerprint"]);
  // The CLI's default config has "local" at 127.0.0.1:3000 and allows one nickname a host.
  if (added.code !== 0 && /already configured for host/.test(added.stderr)) await must(cli.bin, ["--config-path", cli.config, "server", "edit", host, "--new-name", cli.server, "--no-fingerprint", "--yes"]);
  else if (added.code !== 0) throw new Error(`spacetime server add failed: ${added.stderr.trim()}`);
  await must(cli.bin, ["--config-path", cli.config, "login", "--token", owner.token]);
}

/** A CLI command that must work ("spacetime login failed: …" when it doesn't; the token in its arguments is never shown). */
async function must(bin: string, args: string[]): Promise<void> {
  const { code, stderr } = await run(bin, args);
  if (code !== 0) throw new Error(`spacetime ${args.slice(2, 4).join(" ")} failed: ${stderr.trim()}`);
}

/** What a publish did: the data kept, or deleted because the schema changed in a way that needs it (--delete-data=on-conflict). */
export interface Published { ok: boolean; created: boolean; wiped: boolean; output: string }

/** Builds and publishes the module with its env (AI_URL, AI_TOKEN, AI_IDENTITY), as the logged-in owner (v0-design §3.6). */
export async function publish(cli: SpacetimeCli, modulePath: string, env: Record<string, string>, abort?: AbortSignal): Promise<Published> {
  const { code, stdout, stderr } = await run(cli.bin, [
    "--config-path", cli.config, "publish", DB, "-s", cli.server, "-p", modulePath, "--no-config",
    // delete-data answers the CLI's "this will DESTROY … ALL corresponding data" for --delete-data=on-conflict, which a schema
    // change that can't migrate asks (V1's job columns did): with no terminal to ask, the publish was aborted. Never remote.
    "--yes=migrate,break-clients,skip-login,delete-data", "--delete-data=on-conflict",
  ], { env: { ...process.env, ...env }, cwd: modulePath, timeoutMs: 300_000, ...(abort ? { abort } : {}) });
  const output = `${stdout}${stderr}`;
  return { ok: code === 0, ...publishedHow(output), output };
}

/** What a publish's output says it did: made the database, or cleared it first ("Proceeding with database clear due to --delete-data=on-conflict", as the 2.12 CLI says it). */
export function publishedHow(output: string): Pick<Published, "created" | "wiped"> {
  return { created: /Created new database/.test(output), wiped: /Proceeding with database clear|Deleting the database|Deleted database/.test(output) };
}

/** One of the published module's env values, or undefined when it isn't set. */
export async function envGet(cli: SpacetimeCli, key: string): Promise<string | undefined> {
  const { code, stdout } = await run(cli.bin, ["--config-path", cli.config, "env", "get", DB, key, "-s", cli.server, "--no-config"]);
  return code === 0 ? stdout.replace(/\n$/, "") : undefined;
}

// ---------------------------------------------------------------------------------------------
// The HTTP API.

export async function ping(http: string): Promise<boolean> {
  const answer = await request(`${http}/v1/ping`, { timeoutMs: 2_000 });
  return "status" in answer && answer.status === 200;
}

/** A new identity on this server (POST /v1/identity): its tokens are signed by the server's keys, so they last as long as the keys. */
export async function newIdentity(http: string): Promise<Identity> {
  const answer = await request(`${http}/v1/identity`, { method: "POST" });
  if (!("status" in answer) || answer.status !== 200) throw new Error(`POST ${http}/v1/identity: ${"error" in answer ? answer.error : `${answer.status} ${answer.body}`}`);
  const { identity, token } = JSON.parse(answer.body) as Identity;
  return { identity, token };
}

/** Does this token still prove this identity here (the keys unchanged)? */
export async function stillValid(http: string, id: Identity): Promise<boolean> {
  const answer = await request(`${http}/v1/identity/${id.identity}/verify`, { headers: bearer(id.token) });
  return "status" in answer && answer.status === 204;
}

/** A reducer or procedure called by name with named arguments (their TypeScript names), as an identity. */
export function call(http: string, name: string, args: unknown, token: string, timeoutMs = 30_000): Promise<Answer> {
  return request(`${http}/v1/database/${DB}/call/${name}`, { method: "POST", headers: { ...bearer(token), "content-type": "application/json" }, body: JSON.stringify(args), timeoutMs });
}

/** A SQL query as an identity (the owner reads private tables too): rows as objects by column name, values decoded. */
export async function sql(http: string, query: string, token: string): Promise<Array<Record<string, unknown>>> {
  const answer = await request(`${http}/v1/database/${DB}/sql`, { method: "POST", headers: bearer(token), body: query });
  if ("error" in answer) throw new Error(`${query}: ${answer.error}`);
  if (answer.status !== 200) throw new Error(`${query}: ${answer.status} ${answer.body.trim()}`);
  return (JSON.parse(answer.body) as SqlResult[]).flatMap(rowsOf);
}

/** The SQL API's answer: each statement's schema and rows, values in SpacetimeDB's JSON (spacetime.md §5.3). */
interface SqlResult { schema: { elements: Element[] }; rows: unknown[][] }
interface Element { name: { some: string } | { none: [] }; algebraic_type: Type }
type Type = { Product: { elements: Element[] } } | { Sum: { variants: Element[] } } | { Array: Type } | Record<string, unknown>;

export function rowsOf(result: SqlResult): Array<Record<string, unknown>> {
  return result.rows.map(row => Object.fromEntries(result.schema.elements.map((e, i) => [nameOf(e, i), decode(e.algebraic_type, row[i])])));
}

const nameOf = (e: Element, i: number) => ("some" in e.name ? e.name.some : String(i));

/** A value by its type: an identity as its hex, a time as its microseconds, an option as its value or null, a product as an object. */
function decode(type: Type, value: unknown): unknown {
  if ("Product" in type) {
    const elements = (type as { Product: { elements: Element[] } }).Product.elements;
    const special = elements.length === 1 && /^__\w+__$/.test(nameOf(elements[0]!, 0));
    if (special) return (value as unknown[])[0];
    return Object.fromEntries(elements.map((e, i) => [nameOf(e, i), decode(e.algebraic_type, (value as unknown[])[i])]));
  }
  if ("Sum" in type) {
    const variants = (type as { Sum: { variants: Element[] } }).Sum.variants;
    const [tag, payload] = value as [number, unknown];
    const variant = variants[tag]!;
    if (variants.length === 2 && nameOf(variants[0]!, 0) === "some" && nameOf(variants[1]!, 1) === "none") return tag === 0 ? decode(variant.algebraic_type, payload) : null;
    return { [nameOf(variant, tag)]: decode(variant.algebraic_type, payload) };
  }
  if ("Array" in type) return (value as unknown[]).map(v => decode((type as { Array: Type }).Array, v));
  return value;
}

// ---------------------------------------------------------------------------------------------
// The server's config.

/** Procedure isolates: each think holds one while it waits on the AI service, so the pool is sized above the default (one per core). */
export const POOL_SIZE = 16;

/** Writes the pool size into the data folder's config.toml before the server first reads it (a file already there is kept by the server). */
export function ensurePoolSize(dataDir: string, size = POOL_SIZE): void {
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, "config.toml");
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  const after = withPoolSize(before, size);
  if (after !== before) writeFileSync(path, after);
}

/** config.toml with `[v8] procedure-instance-pool-size` set: the line replaced, put under [v8], or [v8] added. ([wasm] has a key of the same name, left alone.) */
export function withPoolSize(toml: string, size: number): string {
  const lines = toml.split("\n");
  const v8 = lines.findIndex(l => l.trim() === "[v8]");
  const line = `procedure-instance-pool-size = ${size}`;
  if (v8 < 0) return `${toml}${toml && !toml.endsWith("\n") ? "\n" : ""}${toml ? "\n" : ""}[v8]\n${line}\n`;
  const end = sectionEnd(lines, v8);
  const at = lines.slice(v8 + 1, end).findIndex(l => /^\s*procedure-instance-pool-size\s*=/.test(l));
  if (at >= 0) lines[v8 + 1 + at] = line;
  else lines.splice(v8 + 1, 0, line);
  return lines.join("\n");
}

/** The [v8] pool size a config.toml sets, or undefined (the server's default: the core count). */
export function poolSizeIn(toml: string): number | undefined {
  const lines = toml.split("\n");
  const v8 = lines.findIndex(l => l.trim() === "[v8]");
  if (v8 < 0) return undefined;
  const set = lines.slice(v8 + 1, sectionEnd(lines, v8)).map(l => /^\s*procedure-instance-pool-size\s*=\s*(\d+)/.exec(l)).find(m => m);
  return set ? Number(set[1]) : undefined;
}

const sectionEnd = (lines: string[], header: number) => {
  const next = lines.slice(header + 1).findIndex(l => /^\s*\[/.test(l));
  return next < 0 ? lines.length : header + 1 + next;
};
