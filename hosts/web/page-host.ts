import { Identity } from "spacetimedb";
import { configureDocs } from "../../ai/docs/config.ts";
import { memoryVolume } from "../../ai/docs/volumes.ts";
import { configurePrompts } from "../../ai/prompts/index.ts";
import { dollars } from "../../ai/service/budget.ts";
import { campaigns } from "../../ai/service/campaigns.ts";
import { pipeline } from "../../ai/service/endpoints/pipeline.ts";
import { memoryStores, type Persistence } from "../../ai/service/memory-stores.ts";
import { aiService, type AiHttpRequest, type AiHttpResponse, type AiService } from "../../ai/service/server.ts";
import { memoryHost, type AiReply, type ChangeSet, type MemoryHost } from "../../simulation/src/host/memory.ts";
import { realClock } from "../../web/server/clock.ts";
import { serveClient } from "../../web/server/connections.ts";
import { campaignHash, contentCampaigns, type Content } from "../../web/server/content.ts";
import { recoverAfterRestart, startJobs } from "../../web/server/jobs.ts";
import type { Model } from "../../web/server/model.ts";
import { pushTo } from "../../web/server/push.ts";
import { randomSeed, randomUuid } from "../../web/server/random.ts";
import type { SimStore, Storage } from "../../web/server/sim-store.ts";
import type { Duplex } from "../../web/server/transport.ts";
import { install, streamArgsOf, streamInto } from "../in-process.ts";

/**
 * The page host (browser-design §2, §4.2, §5): the simulation on the memory host, from what the
 * page's database kept, and the AI service in the same worker, its stores kept there too, joined as
 * the local host joins them (hosts/in-process.ts). The build's campaign is installed in both when it
 * has changed (and the zoo in the simulation); every commit is kept, pushed to the clients and its jobs run, as SpacetimeDB's
 * scheduler runs them; each client is served its rows over its duplex. The server worker starts it
 * once it has its tab, its database and its content (server-worker.ts); the contract test starts it
 * on a database in memory and the repo's files.
 */

export interface HostConfig {
  /** How the model calls go out: the fake GM, or OpenRouter with the player's key (web/server/model.ts). */
  model: Model;
  /** OWNER_MOVES made as the database's owner (the page allows /end, for testing). */
  ownerMoves: boolean;
  /** Where the simulation's and the AI service's lines go. */
  log(line: string): void;
}

export interface PageHost {
  sim: MemoryHost;
  ai: AiService;
  /** A client served on its duplex. */
  serve(duplex: Duplex): void;
  /** Resolves once no job is running or due. */
  idle(): Promise<void>;
  /** No more jobs started, and the reaper and the town's clock stopped: another tab has the game. */
  stop(): void;
}

/** The bearer the simulation sends the AI service, and the AI service's identity in the simulation: the page host's own. */
const BEARER = "page-bearer";
const SERVICE = new Identity(0x9a6e5e7f1cen);
/** At most one post of a reply's words this often: each is a transaction, pushed to the client and written behind. */
const STREAM_PERIOD_MS = 100;
/** The daily ceiling on what the models cost in this browser, and what the player is told once it's reached. */
const DAILY_USD = 5;
const OVER_BUDGET = `The GM has spent today's budget in this browser (${dollars(DAILY_USD)}): it starts again at midnight UTC.`;
/** What the player is told when OpenRouter turns the key down (403 key_refused): the page's bar changes it. */
const KEY_REFUSED = "OpenRouter turned the key down: change it from the bar under the game.";
/** How long the AI service's answers are kept: a day, far past any think's retries. */
const KEEP_ANSWERS_MS = 24 * 60 * 60 * 1000;

export async function startHost(config: HostConfig, storage: Storage, content: Content): Promise<PageHost> {
  const commits = commitsTo(storage.sim.write, config.log);
  const sim = newSimulation(storage.sim, commits.tell, config, request => ai.answer(request));
  const ai = newAiService(storage.ai, content, sim, config);
  await installCampaign(content, ai, sim, storage.sim);

  const push = pushTo(sim);
  const jobs = startJobs(sim);
  commits.listen(push.commit, jobs.afterCommit);
  recoverAfterRestart(sim);

  return {
    sim, ai,
    serve: duplex => serveClient(duplex, { sim, push, sessions: storage.sim, ownerMoves: config.ownerMoves, log: config.log }),
    idle: jobs.idle,
    stop: jobs.stop,
  };
}

/**
 * Each commit to its listeners in turn, each on its own (one that throws is logged, and the rest
 * still hear it): the store from init's commit on (memoryHost tells it before it returns), then the
 * clients and the jobs once they're up.
 */
function commitsTo(store: (commit: ChangeSet) => void, log: (line: string) => void) {
  const listeners = [store];
  return {
    tell(commit: ChangeSet) {
      for (const listener of listeners) {
        try {
          listener(commit);
        } catch (error) {
          log(`[commit] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
        }
      }
    },
    listen(...more: Array<(commit: ChangeSet) => void>) {
      listeners.push(...more);
    },
  };
}

/**
 * The memory host for real play: a real clock, a dice seed and uuids of its own, the database's own
 * identity, what was kept restored, each commit told, its log the host's, and each think POSTed to
 * the AI service in this worker, given up on once the claim's time is up.
 */
function newSimulation(kept: SimStore, onCommit: (commit: ChangeSet) => void, config: HostConfig, answer: (request: AiHttpRequest) => Promise<AiHttpResponse>): MemoryHost {
  return memoryHost({
    ai: (endpoint, body, headers, options) => withinTime(answer({ method: "POST", path: endpoint, headers, body }), options?.timeoutMs),
    seed: randomSeed(), uuid: randomUuid, clock: realClock, database: kept.database,
    env: { AI_URL: "in-process", AI_TOKEN: BEARER, AI_IDENTITY: SERVICE.toHexString() }, service: SERVICE,
    onCommit, log: config.log,
    ...(kept.restore ? { restore: kept.restore } : {}),
  });
}

/**
 * The AI service's answer, or a throw once the claim's time is up, which makes the run a retry (the
 * reaper's deadline stays the backstop). The think itself goes on, and its retry joins it.
 */
function withinTime(answer: Promise<AiHttpResponse>, timeoutMs: number | undefined): Promise<AiReply> {
  if (!timeoutMs) return answer;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the AI service didn't answer in ${timeoutMs} ms`)), timeoutMs);
  });
  return Promise.race([answer, expired]).finally(() => clearTimeout(timer));
}

/**
 * The AI service in this worker, as hosts/ai.ts makes it but for the page: memory stores, kept in the
 * page's database, with the campaign served from the content; the prompts from the content; the docs
 * in memory volumes; the GM's pipeline on the model the page chose; each reply streamed into the
 * simulation as the service's identity, a post at most every 100 ms; the page's ceiling and words.
 */
function newAiService(kept: Persistence, content: Content, sim: MemoryHost, config: HostConfig): AiService {
  const stores = { ...memoryStores(kept), campaigns: contentCampaigns(content.campaign) };
  void stores.answers.sweep?.(KEEP_ANSWERS_MS);
  configurePrompts(name => content.prompts[name]);
  configureDocs({ lore: memoryVolume(), overlay: game => stores.docs.overlay(game) });

  return aiService({
    token: BEARER, stores, campaigns: campaigns(stores.campaigns, stores.docs), endpoints: pipeline,
    transport: turn => config.model.transport(turn),
    stream: { url: "in-process", db: "kingmaker", token: BEARER, periodMs: STREAM_PERIOD_MS, fetch: streamInto(post => sim.streamReply(streamArgsOf(post), SERVICE)) },
    serves: { model: config.model.name, gm: "pipeline" },
    dailyUsd: DAILY_USD, overBudget: OVER_BUDGET, keyRefused: KEY_REFUSED,
    // A game's own, read for a report, without the player's key.
    redact: text => config.model.redact(text),
    faults: {}, log: config.log,
    exit: code => { throw new Error(`the AI service asked to exit (${code}): the page host runs no faults`); },
  });
}

/**
 * The build's campaign into both, as the install tool puts one (hosts/in-process.ts), and the zoo into
 * the simulation (no GM plays it: M6), unless they're the ones the simulation installed when the
 * database was last kept. The AI service is served the campaign from the content either way.
 */
async function installCampaign(content: Content, ai: AiService, sim: MemoryHost, kept: SimStore): Promise<void> {
  const hash = await campaignHash({ ...content.campaign, ...prefixed("zoo/", content.zoo ?? {}) });
  if (kept.installed === hash) return;
  await install(content.campaign, ai, sim, BEARER);
  if (content.zoo) await install(content.zoo, ai, sim, BEARER);
  kept.markInstalled(hash);
}

/** Files by paths with a prefix: two folders' files in one hash, apart. */
const prefixed = (prefix: string, files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([path, text]) => [`${prefix}${path}`, text]));
