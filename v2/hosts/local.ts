import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Identity } from "spacetimedb";
import type { FakeOptions } from "../ai/llm/fake-openrouter.ts";
import { transports } from "../ai/service/calls.ts";
import { campaigns } from "../ai/service/campaigns.ts";
import { canned } from "../ai/service/endpoints/canned.ts";
import { pipeline } from "../ai/service/endpoints/pipeline.ts";
import { folderStores } from "../ai/service/folder-stores.ts";
import { aiService, type AiService } from "../ai/service/server.ts";
import type { StreamReplyArgs } from "../shared/protocol/ai.ts";
import { memoryHost, type MemoryHost } from "../simulation/src/host/memory.ts";
import { readCampaignFiles } from "./dev/campaign.ts";
import { install, streamArgsOf, streamInto } from "./in-process.ts";

/**
 * The local host (v0-design §4.5, §10.3): the simulation on the memory host and the AI service in
 * the same process, on the fake model, with no SpacetimeDB and no sockets. Each think goes to the
 * service's own handler as the HTTP API carries it (the body as JSON, the bearer, the idempotency
 * key, the attempt), and each draft the service streams comes back through stream_reply as the AI
 * service's identity. So the module's moves and job loop meet the service's pipeline end to end.
 * What joins the two touches no Node (in-process.ts), so the page's server worker joins them the same.
 *
 * The docs service has one lore root a process (v2/ai/README.md), which each local host's install
 * points at its own store: play one local host at a time.
 */

export interface LocalOptions {
  /** The game's randomness: its dice seed and its uuids. */
  seed?: number;
  /** The fake model's options for a request of turn n (0 is the opening): its replies, its decisions. */
  fake?: (turn: number) => FakeOptions;
  /** The AI service's GM: the pipeline (the default), or canned answers with no model at all. */
  gm?: "pipeline" | "canned";
  /** The campaign folder to install in both: campaigns/caerwyn. */
  campaign?: string;
}

export interface LocalHost {
  /** The simulation: the moves as each player, drain() for the jobs, the tables. */
  sim: MemoryHost;
  ai: AiService;
  /** The AI service's store: kept answers, each game's call log (games/<uid>/calls.jsonl), the campaign. */
  store: string;
  /** What the AI service logged. */
  aiLogs: string[];
  /** Deletes the store. */
  close(): void;
}

const CAERWYN = resolve(import.meta.dirname, "..", "campaigns", "caerwyn");
/** The bearer the module sends, and the AI service's identity in the module: the local host's own. */
const BEARER = "local-bearer";
const SERVICE = new Identity(0x10ca1a1n);

export async function localHost(options: LocalOptions = {}): Promise<LocalHost> {
  const store = mkdtempSync(join(tmpdir(), "km-local-"));
  const aiLogs: string[] = [];

  const sim = memoryHost({
    seed: options.seed ?? 1,
    ai: (endpoint, body, headers) => ai.answer({ method: "POST", path: endpoint, headers, body }),
    env: { AI_URL: "http://ai.local", AI_TOKEN: BEARER, AI_IDENTITY: SERVICE.toHexString() },
    service: SERVICE,
  });
  const ai = localAi(store, options, line => aiLogs.push(line), post => sim.streamReply(streamArgsOf(post), SERVICE));

  await install(readCampaignFiles(options.campaign ?? CAERWYN), ai, sim, BEARER);

  return { sim, ai, store, aiLogs, close: () => rmSync(store, { recursive: true, force: true }) };
}

/** The AI service as hosts/ai.ts makes it, but in this process: a folder store, the fake model per turn, the stream into the simulation. */
function localAi(store: string, options: LocalOptions, log: (line: string) => void, post: (args: StreamReplyArgs) => void): AiService {
  const stores = folderStores(store);
  const fake = options.fake ?? (() => ({}));

  return aiService({
    token: BEARER,
    stores,
    campaigns: campaigns(stores.campaigns, stores.docs),
    endpoints: options.gm === "canned" ? canned : pipeline,
    transport: turn => transports("fake", { fake: fake(turn) })(turn),
    stream: { url: "http://stdb.local", db: "kingmaker", token: "local", periodMs: 0, fetch: streamInto(post) },
    serves: { model: "fake", gm: options.gm ?? "pipeline" },
    faults: {},
    log,
    exit: code => { throw new Error(`the AI service asked to exit (${code}): the local host runs no faults`); },
  });
}
