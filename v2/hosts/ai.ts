// The AI service's composition root (v0-design §5.7): the environment, then the config, the stores and
// the server. The only file of the service that reads env or argv. Run by plain node, as its container
// runs it: `npm run ai` here, `node --no-warnings hosts/ai.ts` in the image.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { apiKey } from "../ai/llm/openrouter.ts";
import { transports } from "../ai/service/calls.ts";
import { campaigns } from "../ai/service/campaigns.ts";
import { readConfig, type AiConfig } from "../ai/service/config.ts";
import type { Endpoints } from "../ai/service/context.ts";
import { canned } from "../ai/service/endpoints/canned.ts";
import { pipeline } from "../ai/service/endpoints/pipeline.ts";
import { folderStores } from "../ai/service/folder-stores.ts";
import { aiService, type AiService } from "../ai/service/server.ts";

/** Answers kept longer than this are swept at start: a turn that old has long been committed or given up. */
const KEEP_ANSWERS_MS = 7 * 24 * 60 * 60 * 1000;

const log = (line: string) => console.log(line);

async function main(): Promise<void> {
  const config = configured();
  const stores = folderStores(config.store);
  const swept = stores.sweepAnswers(KEEP_ANSWERS_MS);

  const service = aiService({
    token: config.token,
    stores,
    campaigns: campaigns(stores.campaigns, stores.docsRoot),
    endpoints: endpointsFor(config),
    transport: transports(config.model, { apiKey: config.apiKey, fake: config.fake }),
    stream: { ...config.stdb, periodMs: config.streamMs },
    serves: { model: config.model, gm: config.gm },
    dailyUsd: config.dailyUsd,
    faults: config.faults,
    log,
    exit: code => process.exit(code),
  });
  const servers = await Promise.all(config.listen.map(address => listening(service, address))).catch(cantListen);

  for (const server of servers) log(`[ai] listening on http://${hostPort(server)} (model ${config.model}, gm ${config.gm}, ${ceilingOf(config)}, store ${config.store}${swept ? `, ${swept} old answers swept` : ""})`);
  if (!config.stdb.token) log("[ai] no KM_STDB_TOKEN: replies aren't streamed, and health?deep=1 can't call the module (the answers still work)");
  stopOnSignals(servers, service);
}

/** The config from the environment, with the key from its file when the environment has none (and a model will be asked); or the process ends saying what's wrong. */
function configured(): AiConfig {
  try {
    const config = readConfig(process.env);
    if (config.model === "openrouter" && config.gm === "pipeline" && !config.apiKey) config.apiKey = apiKey();
    return config;
  } catch (error) {
    console.error(`[ai] can't start: ${error instanceof Error ? error.message : String(error)}${/OPENROUTER_API_KEY/.test(String(error)) ? " (or run on the stand-in: KM_AI_MODEL=fake)" : ""}`);
    process.exit(1);
  }
}

const endpointsFor = (config: AiConfig): Endpoints => (config.gm === "canned" ? canned : pipeline);

const ceilingOf = (config: AiConfig) => (config.dailyUsd > 0 ? `ceiling $${config.dailyUsd.toFixed(2)} a day` : "no ceiling");

function listening(service: AiService, address: { host: string; port: number }): Promise<Server> {
  const server = createServer((req, res) => service.handle(req, res));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(address.port, address.host, () => resolve(server));
  });
}

/** A port taken, or an address that isn't this machine's (11.0.0.1 in host mode, before it's set up): the process ends saying which. */
function cantListen(error: NodeJS.ErrnoException): never {
  console.error(`[ai] can't listen: ${error.code ?? ""} ${error.message}`);
  process.exit(1);
}

function hostPort(server: Server): string {
  const { address, port } = server.address() as AddressInfo;
  return address.includes(":") ? `[${address}]:${port}` : `${address}:${port}`;
}

/**
 * SIGTERM or SIGINT: take nothing new, give what's running ten seconds to finish and be sent, then
 * exit. A signal while that goes on changes nothing: under npm a terminal's Ctrl+C comes twice (from
 * the terminal, and passed on by npm), and with no listener for it node would die mid-drain.
 */
function stopOnSignals(servers: Server[], service: AiService): void {
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`[ai] ${signal}: finishing what's in flight`);
    for (const server of servers) { server.close(); server.closeIdleConnections(); }
    await service.shutdown(10_000);
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
}

await main();
