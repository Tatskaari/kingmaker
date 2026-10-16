import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HEADERS, STEP_ENDPOINT, type AiError, type CampaignPut, type Endpoint, type Health } from "../../shared/protocol/ai.ts";
import { isTurnKey, keyParts, type CreationKeyParts, type CreationStep, type Step, type TurnKeyParts } from "../../shared/protocol/keys.ts";
import { budget } from "./budget.ts";
import type { Campaign, Campaigns } from "./campaigns.ts";
import { callContext, type Transport } from "./calls.ts";
import type { Faults } from "./config.ts";
import { Failure, type AiContext, type Endpoints } from "./context.ts";
import type { Stores } from "./stores.ts";
import { streamSink, type StreamTarget } from "./stream.ts";

/**
 * The AI service's HTTP API (v0-design §5.1, v1-design §3.7): the thinks (a scene's four, and
 * character creation's builds and backstories), a campaign's words, and its health.
 *
 * - Every route but health wants the bearer the module sends (401 otherwise).
 * - A think is answered by its idempotency key, which names its step (a creation's endpoints serve
 *   several): an answer kept from before is sent again with no model call (X-Km-Replayed: 1); a
 *   duplicate that comes while the first is still running waits for its answer; otherwise the
 *   endpoint runs, and its answer is stored before it's sent, so a crash after the store loses
 *   nothing. The same key with another body is 409 key_reused.
 * - The daily ceiling (budget.ts): past it, a think that may call a model is 402 over_budget before
 *   it runs; a kept answer is served all the same.
 * - Errors are { error: { code, message } }: 400 bad_request, 401 unauthorised, 402 over_budget,
 *   409 other_campaign or key_reused, 500 model_failed (after the model client's own retries), 503
 *   not_ready.
 * - Shutting down, it takes nothing new and gives what's running ten seconds to finish and be sent.
 */

export interface ServiceOptions {
  /** The bearer the module sends (KM_AI_TOKEN). */
  token: string;
  stores: Stores;
  campaigns: Campaigns;
  endpoints: Endpoints;
  /** How a request's model calls go out, by its turn's number (the stand-in begins its replies there). */
  transport(turn: number): Transport;
  /** Where replies stream to (and service_ping goes), and as whom. */
  stream: Omit<StreamTarget, "log">;
  /** For the health answer: which model, and which GM (the canned GM calls none, so the ceiling never stops it). */
  serves: Pick<Health, "model" | "gm">;
  /** The daily ceiling on what the models cost, in dollars (KM_AI_DAILY_USD); 0 or absent: none. */
  dailyUsd?: number;
  faults: Faults;
  log(line: string): void;
  /** How a fault ends the process (process.exit; a test's stand-in). */
  exit(code: number): void;
}

/** A request and its answer, as plain data: node:http's adapter (handle) and an in-process host both use them. */
export interface AiHttpRequest { method: string; path: string; headers: Record<string, string | undefined>; body: string }
export interface AiHttpResponse { status: number; headers: Record<string, string>; body: string }

export interface AiService {
  answer(request: AiHttpRequest): Promise<AiHttpResponse>;
  /** node:http's request handler. */
  handle(req: IncomingMessage, res: ServerResponse): void;
  /** Take nothing new, and wait (at most `graceMs`) for what's running, and for handle's answers to be sent. */
  shutdown(graceMs?: number): Promise<void>;
}

/** The thinks, by endpoint: the handler that serves each (STEP_ENDPOINT says which steps are whose). */
const THINKS: Record<Endpoint, keyof Endpoints> = {
  "/v1/scenes/open": "open", "/v1/turns/decide": "decide", "/v1/turns/reply": "reply", "/v1/turns/settle": "settle",
  "/v1/characters": "characters", "/v1/backstories": "backstories",
};
/** The steps that never call a model: the ceiling doesn't stop them. */
const NO_MODEL: ReadonlyArray<Step | CreationStep> = ["own"];
const LIMIT = { think: 2 << 20, campaign: 16 << 20 };

/** A think's answer as sent: its body, and how it came (run now; kept from before; another request's, still running when this came). */
interface Answered { body: string; how: "ran" | "kept" | "joined"; usage?: { calls: number; costUsd: number } }

const HOW = { kept: "from the store, no model call", joined: "joined the same request in flight, no model call of its own" };

export function aiService(options: ServiceOptions): AiService {
  const ceiling = budget(options.dailyUsd ?? 0, options.stores.ledger);
  const inFlight = new Map<string, { hash: string; answer: Promise<Answered> }>();
  /** handle's responses until they're sent (or their connection is gone): the process mustn't exit before an answer it ran is sent. */
  const unsent = new Set<Promise<void>>();
  let closing = false;

  async function answer(request: AiHttpRequest): Promise<AiHttpResponse> {
    const url = new URL(request.path, "http://ai.local");
    try {
      if (request.method === "GET" && url.pathname === "/v1/health") return json(200, await health(request, url.searchParams.has("deep")));
      const endpoint = Object.hasOwn(THINKS, url.pathname) ? (url.pathname as Endpoint) : undefined;
      const campaign = /^\/v1\/campaigns\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (!(request.method === "POST" && endpoint) && !(request.method === "PUT" && campaign)) throw new Failure(404, "bad_request", `nothing at ${request.method} ${url.pathname}`);
      if (closing) throw new Failure(503, "not_ready", "the AI service is shutting down");
      checkBearer(request, options.token);
      if (endpoint) return await think(endpoint, request);
      return json(200, await install(decodeURIComponent(campaign![1]!), decodeURIComponent(campaign![2]!), request.body));
    } catch (error) {
      return failed(error);
    }
  }

  /** A think: checked, then answered by its key (kept, joined, or run and kept). */
  async function think(endpoint: Endpoint, request: AiHttpRequest): Promise<AiHttpResponse> {
    const body = parsed(request.body);
    const { key, parts } = checkedKey(body, endpoint, request.headers[HEADERS.idempotencyKey]);
    const step = parts.step;
    const attempt = Number(request.headers[HEADERS.attempt]) || 1;
    const campaign = options.campaigns.use(body.game.campaign, body.game.version);
    const started = performance.now();

    const answered = await byKey(key, sha256(request.body), () => run(THINKS[endpoint], parts, body, campaign, attempt, started));

    const took = answered.how === "ran" ? `in ${Math.round(performance.now() - started)} ms, ${answered.usage?.calls ?? 0} calls, $${(answered.usage?.costUsd ?? 0).toFixed(4)}` : HOW[answered.how];
    options.log(`[ai] ${step} ${key} attempt ${attempt}: 200 ${took}`);
    return { status: 200, headers: { "content-type": "application/json", ...(answered.how === "ran" ? {} : { [HEADERS.replayed]: "1" }) }, body: answered.body };
  }

  /** The answer for a key: from the store, from the same request still running, or run now and stored before it's sent. */
  async function byKey(key: string, hash: string, run: () => Promise<{ usage: { calls: number; costUsd: number } }>): Promise<Answered> {
    const running = inFlight.get(key);
    if (running) {
      if (running.hash !== hash) throw keyReused(key);
      return { ...(await running.answer), how: "joined" };
    }
    const answer = (async (): Promise<Answered> => {
      const kept = await options.stores.answers.get(key);
      if (kept) {
        if (kept.requestHash !== hash) throw keyReused(key);
        return { body: kept.body, how: "kept" };
      }
      const result = await run();
      const body = JSON.stringify(result);
      await options.stores.answers.put(key, { requestHash: hash, status: 200, body, at: new Date().toISOString() });
      fault(key);
      return { body, how: "ran", usage: result.usage };
    })();
    inFlight.set(key, { hash, answer });
    try { return await answer; } finally { inFlight.delete(key); }
  }

  /**
   * The endpoint, under the ceiling, with this request's own model calls and stream; anything it
   * throws but a Failure is the model's.
   */
  async function run(handler: keyof Endpoints, parts: KeyParts, body: ThinkBody, campaign: Campaign, attempt: number, started: number) {
    await withinCeiling(parts.step);
    const { calls, usage } = callContext(options.transport(transportTurn(parts)), options.stores, { game: body.game.id, key: body.key, attempt });
    const ctx: AiContext = { campaign, calls, usage, attempt, stream: turn => streamSink({ ...options.stream, log: options.log }, { turn, attempt, started }) };
    try {
      return await (options.endpoints[handler] as (req: unknown, ctx: AiContext) => Promise<{ usage: { calls: number; costUsd: number } }>)(body, ctx);
    } catch (error) {
      if (error instanceof Failure) throw error;
      throw new Failure(500, "model_failed", error instanceof Error ? error.message : String(error));
    }
  }

  /** Past the daily ceiling, a 402 for a think that may call a model (the canned GM and own's never do). */
  async function withinCeiling(step: Step | CreationStep): Promise<void> {
    if (options.serves.gm === "canned" || NO_MODEL.includes(step)) return;
    await ceiling.check();
  }

  /** KM_AI_FAULTS=exit-after-store: the process ends with the answer stored and not sent (code 137, as a kill). */
  function fault(key: string): void {
    const wanted = options.faults.exitAfterStore;
    if (!wanted || (wanted !== "any" && wanted !== keyParts(key)?.step)) return;
    options.log(`[ai] exit-after-store: ${key} is stored; exiting before it's sent (KM_AI_FAULTS)`);
    options.exit(137);
  }

  async function install(campaign: string, version: string, text: string) {
    const put = parsed(text) as unknown as CampaignPut;
    if (!put || typeof put.files !== "object" || put.files === null) throw new Failure(400, "bad_request", "a campaign is { files: { <path>: <text> } }");
    const answer = await options.campaigns.put(campaign, version, put.files);
    options.log(`[ai] campaign ${campaign}@${version} installed: ${answer.files} files, scenes ${answer.scenes.join(", ")}`);
    return answer;
  }

  async function health(request: AiHttpRequest, deep: boolean): Promise<Health> {
    return {
      ok: !closing, ...options.serves, campaigns: options.campaigns.list(), token: tokenOf(request, options.token),
      ...(deep ? { stdb: await servicePing(options.stream) } : {}),
      budget: await ceiling.health(),
    };
  }

  function failed(error: unknown): AiHttpResponse {
    const f = error instanceof Failure ? error : new Failure(500, "model_failed", error instanceof Error ? error.message : String(error));
    if (f.status !== 404) options.log(`[ai] ${f.status} ${f.code}: ${f.message}`);
    const body: AiError = { error: { code: f.code, message: f.message } };
    return json(f.status, body);
  }

  return {
    answer,
    handle(req, res) {
      untilSent(res, unsent);
      const limit = req.method === "PUT" ? LIMIT.campaign : LIMIT.think;
      readBody(req, limit)
        .then(body => answer({ method: req.method ?? "GET", path: req.url ?? "/", headers: headersOf(req), body }), error => failed(error))
        .then(response => { res.writeHead(response.status, response.headers); res.end(response.body); });
    },
    async shutdown(graceMs = 10_000) {
      closing = true;
      const running = Promise.allSettled([...[...inFlight.values()].map(r => r.answer), ...unsent]);
      await Promise.race([running, new Promise(resolve => setTimeout(resolve, graceMs).unref())]);
    },
  };
}

/** The response in `unsent` until it's handed to the network ("finish") or its connection is gone ("close"). */
function untilSent(res: ServerResponse, unsent: Set<Promise<void>>): void {
  const sent = new Promise<void>(resolve => { res.once("finish", resolve); res.once("close", resolve); });
  unsent.add(sent);
  void sent.then(() => unsent.delete(sent));
}

/** A think's body as far as the server reads it: the key, and the game it's for. */
interface ThinkBody { key: string; game: { id: string; campaign: string; version: string } }

type KeyParts = TurnKeyParts | CreationKeyParts;

/** The turn a request's model calls are made for (the stand-in's replies begin there): a creation's step has none, so its first. */
const transportTurn = (parts: KeyParts) => (isTurnKey(parts) ? parts.turn : 0);

function parsed(text: string): ThinkBody {
  try {
    const value = JSON.parse(text) as unknown;
    if (value && typeof value === "object") return value as ThinkBody;
  } catch { /* below */ }
  throw new Failure(400, "bad_request", "the body isn't a JSON object");
}

/**
 * The key a think is for, and its parts: the body's, the header's too, of a step the endpoint
 * serves, for the game the body names (its uid is a folder name in the store, so it's checked too).
 */
function checkedKey(body: ThinkBody, endpoint: Endpoint, header: string | undefined): { key: string; parts: KeyParts } {
  const parts = typeof body.key === "string" ? keyParts(body.key) : undefined;
  if (!parts) throw new Failure(400, "bad_request", "the body's key isn't <game>:s<scene>:t<turn>:<step> or <uid>:c<rev>:<step>");
  if (header !== body.key) throw new Failure(400, "bad_request", `the Idempotency-Key header (${header ?? "none"}) isn't the body's key (${body.key})`);
  if (STEP_ENDPOINT[parts.step] !== endpoint) throw new Failure(400, "bad_request", `${body.key} is for the ${parts.step} step, which ${endpoint} doesn't serve`);
  const game = body.game;
  if (!game || typeof game.campaign !== "string" || typeof game.version !== "string") throw new Failure(400, "bad_request", "the body has no game { id, campaign, version }");
  if (game.id !== parts.game || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(game.id)) throw new Failure(400, "bad_request", `the game "${game.id}" isn't the key's, or isn't a game's id`);
  return { key: body.key, parts };
}

function checkBearer(request: AiHttpRequest, token: string): void {
  if (tokenOf(request, token) !== "accepted") throw new Failure(401, "unauthorised", "the bearer token is missing or wrong");
}

function tokenOf(request: AiHttpRequest, token: string): Health["token"] {
  const auth = request.headers.authorization;
  if (!auth) return "absent";
  return auth === `Bearer ${token}` ? "accepted" : "refused";
}

const keyReused = (key: string) => new Failure(409, "key_reused", `${key} was used before for another request`);

/** service_ping as the service's own identity: "ok", or why not. */
async function servicePing(target: Omit<StreamTarget, "log">): Promise<string> {
  if (!target.token) return "no KM_STDB_TOKEN: the service can't call the module";
  try {
    const response = await (target.fetch ?? fetch)(`${target.url}/v1/database/${encodeURIComponent(target.db)}/call/service_ping`, {
      method: "POST", headers: { authorization: `Bearer ${target.token}`, "content-type": "application/json" }, body: "[]", signal: AbortSignal.timeout(5_000),
    });
    return response.ok ? "ok" : `${response.status} ${(await response.text()).slice(0, 200)}`;
  } catch (error) {
    return error instanceof Error ? `${error.message}${error.cause instanceof Error ? `: ${error.cause.message}` : ""}` : String(error);
  }
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const json = (status: number, value: unknown): AiHttpResponse => ({ status, headers: { "content-type": "application/json" }, body: JSON.stringify(value) });

function headersOf(req: IncomingMessage): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
}

/** The whole body, or a 413 past the limit (what comes after it is read and dropped, never kept). */
function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on("end", () => (size > limit ? reject(new Failure(413, "bad_request", `the body is over ${limit >> 20} MB`)) : resolve(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", reject);
  });
}
