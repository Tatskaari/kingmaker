import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dollars } from "../../ai/service/budget.ts";
import type { Health } from "../../shared/protocol/ai.ts";
import { refusalIn } from "../../shared/protocol/refusals.ts";
import { bearer, request } from "./http.ts";
import { AI_ADDRESS, localAddresses } from "./mode.ts";
import { call, cliVersion, CLI_VERSION, envGet, ping, POOL_SIZE, poolSizeIn, sql } from "./spacetime.ts";
import type { StackFile } from "./stack-file.ts";
import { nodeIsNew, which } from "./tools.ts";

/**
 * The doctor (v0-design §9.2): checks a running stack, each part on its own, and says how to fix
 * what's wrong. The two that matter most are the paths between the services: the module reaches the
 * AI service (ping_ai, as the owner), and the AI service reaches the module as itself (its deep
 * health calls service_ping with its own token).
 */

export interface Check { name: string; ok: boolean; detail: string; fix?: string }

export interface DoctorReport {
  ok: boolean;
  checks: Check[];
  /** The two paths in a line, for the dev host's screen. */
  summary: string;
}

/** What a check needs that the stack file doesn't say: the campaign the stack should have (its id, "caerwyn@0.1.0"). */
export interface DoctorOptions { campaign?: string }

export async function doctor(stack: StackFile, options: DoctorOptions = {}): Promise<DoctorReport> {
  const health = await aiHealth(stack, false);
  const deep = health.ok ? await aiHealth(stack, true) : health;

  const checks = [
    nodeCheck(),
    await cliCheck(stack),
    modeCheck(stack),
    toolCheck(stack),
    await stdbCheck(stack),
    await moduleCheck(stack),
    await envCheck(stack),
    poolCheck(stack),
    healthCheck(stack, health),
    budgetCheck(health),
    await moduleToAi(stack, health),
    aiToModule(stack, deep),
    await campaignCheck(stack, health, options.campaign),
  ];

  return { ok: checks.every(c => c.ok), checks, summary: summaryOf(checks) };
}

/** The report as lines: a tick or a cross, the check, what it saw, and the fix under a cross. */
export function reportLines(report: DoctorReport): string[] {
  const width = Math.max(...report.checks.map(c => c.name.length));
  return report.checks.flatMap(c => [
    `  ${c.ok ? "✓" : "✗"} ${c.name.padEnd(width)}  ${c.detail}`,
    ...(!c.ok && c.fix ? [`    ${" ".repeat(width)}  fix: ${c.fix}`] : []),
  ]);
}

// ---------------------------------------------------------------------------------------------
// The checks.

function nodeCheck(): Check {
  return { name: "Node", ok: nodeIsNew(process.versions.node), detail: process.versions.node, fix: "Node 26.4 or later: run from the repo, where proto picks 26.9" };
}

async function cliCheck(stack: StackFile): Promise<Check> {
  const version = existsSync(stack.cli.bin) ? await cliVersion(stack.cli) : undefined;
  return {
    name: "SpacetimeDB CLI", ok: version === CLI_VERSION, detail: version ? `${version} (${stack.cli.bin})` : `not found at ${stack.cli.bin}`,
    fix: `the pinned CLI: spacetime version install ${CLI_VERSION} --use`,
  };
}

function modeCheck(stack: StackFile): Check {
  const local = localAddresses().includes(AI_ADDRESS);
  if (stack.mode === "host") {
    return { name: "Mode", ok: local, detail: `host mode; ${AI_ADDRESS} ${local ? "is" : "isn't"} on this machine`, fix: `sudo ip addr add ${AI_ADDRESS}/32 dev lo, or restart in namespace mode` };
  }
  return { name: "Mode", ok: true, detail: `namespace mode; ${AI_ADDRESS} ${local ? "is on this machine too (host mode would do)" : "isn't on this machine: pasta maps it to the host's loopback"}` };
}

function toolCheck(stack: StackFile): Check {
  const needed = [...(stack.mode === "namespace" ? ["pasta"] : []), ...(stack.ai.container ? ["podman"] : [])];
  const missing = needed.filter(t => !which(t));
  if (!needed.length) return { name: "Tools", ok: true, detail: "host mode with the AI service as a node process: no pasta or podman needed" };
  return { name: "Tools", ok: !missing.length, detail: missing.length ? `${missing.join(" and ")} not found` : `${needed.join(" and ")} found`, fix: "pasta is in the passt package; podman in podman" };
}

async function stdbCheck(stack: StackFile): Promise<Check> {
  const ok = await ping(stack.http);
  return { name: "SpacetimeDB", ok, detail: ok ? `${stack.http} answers` : `nothing answers at ${stack.http}/v1/ping`, fix: "start the stack: npm run dev (its log is logs/spacetime.log in the stack's folder)" };
}

async function moduleCheck(stack: StackFile): Promise<Check> {
  try {
    const rows = await sql(stack.http, "SELECT * FROM campaign", stack.owner.token);
    return { name: "Module", ok: true, detail: `${stack.db} is published; campaigns: ${rows.map(r => r.id).join(", ") || "none"}` };
  } catch (e) {
    return { name: "Module", ok: false, detail: `${stack.db} doesn't answer SQL as its owner: ${(e as Error).message}`, fix: "republish it: p in the dev host" };
  }
}

/** The module's env as the stack set it: AI_URL the address the module calls, AI_IDENTITY the AI service's, AI_TOKEN the bearer (compared, never shown). */
async function envCheck(stack: StackFile): Promise<Check> {
  const [url, identity, token] = await Promise.all([envGet(stack.cli, "AI_URL"), envGet(stack.cli, "AI_IDENTITY"), envGet(stack.cli, "AI_TOKEN")]);
  const wrong = [
    url === stack.aiFromSimulation ? "" : `AI_URL is ${url ?? "unset"}, not ${stack.aiFromSimulation}`,
    hex(identity) === hex(stack.ai.identity) ? "" : `AI_IDENTITY is ${identity ? `${identity.slice(0, 12)}…` : "unset"}, not the AI service's ${stack.ai.identity.slice(0, 12)}…`,
    token === stack.ai.bearer ? "" : `AI_TOKEN ${token ? "isn't" : "is unset, not"} the stack's bearer`,
  ].filter(Boolean);
  return {
    name: "Module env", ok: !wrong.length, detail: wrong.length ? wrong.join("; ") : `AI_URL ${url}; AI_IDENTITY the AI service's; AI_TOKEN the stack's bearer`,
    fix: "republish with the stack's env: p in the dev host",
  };
}

function poolCheck(stack: StackFile): Check {
  const path = join(stack.root, "stdb", "config.toml");
  const size = existsSync(path) ? poolSizeIn(readFileSync(path, "utf8")) : undefined;
  return {
    name: "Procedure pool", ok: size !== undefined && size >= POOL_SIZE, detail: size ? `${size} isolates` : "the default (one per core)",
    fix: `[v8] procedure-instance-pool-size = ${POOL_SIZE} in ${path}, then restart the stack`,
  };
}

type HealthSeen = { ok: true; health: Health; ms: number } | { ok: false; error: string };

async function aiHealth(stack: StackFile, deep: boolean): Promise<HealthSeen> {
  const started = Date.now();
  const answer = await request(`${stack.aiFromHost}/v1/health${deep ? "?deep=1" : ""}`, { headers: bearer(stack.ai.bearer), timeoutMs: 10_000 });
  if ("error" in answer) return { ok: false, error: answer.error };
  if (answer.status !== 200) return { ok: false, error: `${answer.status} ${answer.body.trim().slice(0, 200)}` };
  return { ok: true, health: JSON.parse(answer.body) as Health, ms: Date.now() - started };
}

function healthCheck(stack: StackFile, seen: HealthSeen): Check {
  const name = "AI service";
  if (!seen.ok) return { name, ok: false, detail: `nothing answers at ${stack.aiFromHost}/v1/health (${seen.error})`, fix: "start it: s in the dev host (its log is logs/ai.log in the stack's folder)" };
  const h = seen.health;
  const ok = h.token === "accepted";
  return {
    name, ok, detail: `${stack.aiFromHost} answers in ${seen.ms} ms: ${h.model} model, ${h.gm} GM${stack.ai.container ? ", in podman" : ""}; the stack's bearer ${h.token}`,
    fix: "the service has another bearer: restart it from the dev host (r)",
  };
}

/**
 * The AI service's daily ceiling (KM_AI_DAILY_USD, v1-design §3.7) and what today's (UTC) calls
 * have cost: past it, every move that needs a model fails in the ceiling's words until midnight.
 */
function budgetCheck(seen: HealthSeen): Check {
  const name = "Budget";
  if (!seen.ok) return { name, ok: false, detail: `the AI service doesn't answer (${seen.error})`, fix: "start it: s in the dev host" };
  const { dailyUsd, spentToday } = seen.health.budget;
  if (dailyUsd <= 0) return { name, ok: true, detail: `${dollars(spentToday)} today, with no ceiling (KM_AI_DAILY_USD=0)` };
  return {
    name, ok: spentToday < dailyUsd, detail: `${dollars(spentToday)} of ${dollars(dailyUsd)} today`,
    fix: "today's budget is spent: quit and start the stack again with KM_AI_DAILY_USD raised (or wait for midnight UTC); /retry carries a failed turn on",
  };
}

/** ping_ai: the module GETs the AI service's health with its bearer, from inside SpacetimeDB, through 11.0.0.1. */
async function moduleToAi(stack: StackFile, health: HealthSeen): Promise<Check> {
  const name = "Module → AI service";
  const answer = await call(stack.http, "ping_ai", [], stack.owner.token, 15_000);
  if ("error" in answer || answer.status !== 200) {
    return { name, ok: false, detail: `ping_ai didn't run: ${"error" in answer ? answer.error : refusalIn(answer.body)?.text ?? `${answer.status} ${answer.body.trim()}`}`, fix: "is SpacetimeDB up and the module published? (above)" };
  }
  const said = JSON.parse(answer.body) as string;
  const reached = /^200 in \d+ ms: /.test(said);
  const accepted = reached && /"token":"accepted"/.test(said);
  return {
    name, ok: accepted, detail: `ping_ai: ${said.length > 160 ? `${said.slice(0, 160)}…` : said}`,
    fix: reached ? "the module's AI_TOKEN isn't the service's bearer: p in the dev host republishes it"
      : !health.ok ? "the AI service doesn't answer on the host either: start it first (s in the dev host)"
      : stack.mode === "namespace" ? `SpacetimeDB must run inside pasta (npm run dev does), and the AI service listen on the host's 127.0.0.1:${stack.ports.ai}`
      : `the AI service must listen on ${AI_ADDRESS}:${stack.ports.ai} (KM_AI_LISTEN), and ${AI_ADDRESS} be on this machine`,
  };
}

/** The AI service's deep health: it calls service_ping as itself, with its own token. */
function aiToModule(stack: StackFile, seen: HealthSeen): Check {
  const name = "AI service → module";
  if (!seen.ok) return { name, ok: false, detail: `the AI service doesn't answer (${seen.error})`, fix: "start it: s in the dev host" };
  const ok = seen.health.stdb === "ok";
  return {
    name, ok, detail: ok ? "service_ping as the AI service's identity: ok" : `service_ping: ${seen.health.stdb ?? "not tried (the service didn't take ?deep=1)"}`,
    fix: "the service's KM_STDB_TOKEN must be the identity in the module's AI_IDENTITY: restart the stack (or p, then r)",
  };
}

/** The campaign in both: the module's campaign rows and the AI service's installed versions. */
async function campaignCheck(stack: StackFile, seen: HealthSeen, expected: string | undefined): Promise<Check> {
  const inModule = await sql(stack.http, "SELECT * FROM campaign", stack.owner.token).then(rows => rows.map(r => String(r.id)), () => [] as string[]);
  const inAi = seen.ok ? seen.health.campaigns : [];
  const want = expected ? [expected] : [...new Set([...inModule, ...inAi])];
  const missing = [
    ...want.filter(c => !inModule.includes(c)).map(c => `${c} isn't in the module`),
    ...(seen.ok ? want.filter(c => !inAi.includes(c)).map(c => `${c} isn't in the AI service`) : ["the AI service doesn't answer"]),
  ];
  return {
    name: "Campaign", ok: want.length > 0 && !missing.length, detail: !want.length ? "none installed" : missing.length ? missing.join("; ") : `${want.join(", ")} in both`,
    fix: "npm run install-campaign -- campaigns/caerwyn (the dev host installs it at every start)",
  };
}

/** "the module reached the AI service (200 in 3 ms); the AI service called the module as itself", or what failed. */
function summaryOf(checks: Check[]): string {
  const there = checks.find(c => c.name === "Module → AI service")!, back = checks.find(c => c.name === "AI service → module")!;
  const ms = /ping_ai: (200 in \d+ ms)/.exec(there.detail)?.[1];
  return [
    there.ok ? `the module reached the AI service (${ms})` : `the module didn't reach the AI service: ${there.detail.replace(/^ping_ai: /, "")}`,
    back.ok ? "the AI service called the module as itself" : `the AI service didn't reach the module: ${back.detail}`,
  ].join("; ");
}

const hex = (id: string | undefined) => (id ?? "").toLowerCase().replace(/^0x/, "");
