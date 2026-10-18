import { loadContent, Unloaded, type Content } from "../../web/server/content.ts";
import { pageDatabase } from "../../web/server/database.ts";
import { fakeModel, keyModel, redact, type Model } from "../../web/server/model.ts";
import { openStorage, type Storage } from "../../web/server/sim-store.ts";
import { claimTab, type Tab } from "../../web/server/tab.ts";
import { portDuplex, type PortLike } from "../../web/server/transport.ts";
import { onTop, wholeStory } from "../dev/fake.ts";
import { startHost, type PageHost } from "./page-host.ts";

/**
 * The page's server worker (browser-design §2, §5): the page host (page-host.ts), with the
 * simulation, the AI service and the page's database, behind a port to the client worker. It speaks
 * to the page in the prototype's messages (src/web/static/worker.ts), split between the two workers
 * as understand-web §5.4 routes them:
 *
 *   page → worker   {type: "start", port, key?, fake?: "dev" | "arc", seed?}, the port transferred (the
 *                   client worker has the channel's other end); then {type: "port", port} for a new
 *                   client worker's channel (Play again), {type: "key", key} for a new key,
 *                   {type: "flush"} as the page goes out of sight, {type: "quit"} when another tab
 *                   takes the game over
 *   worker → page   {type: "ready", channel} once it plays; {type: "busy", channel} while another tab
 *                   has the game (the page offers to take it over on that BroadcastChannel);
 *                   {type: "storage", ok, message?} when the browser won't keep the game, and when it
 *                   will again; {type: "key-refused"} when OpenRouter turns the key down; {type:
 *                   "flushed"} for each flush, and once a quit has let go; {type: "error", message, reload?}
 *
 * Its database, its lock and its channel are named after where it's published (its folder: the
 * site's play/): kingmaker-v2-web <path>, never the retired prototype's kingmaker-v2 <path>, which
 * was published at play/ too, so a browser that kept the prototype's games keeps them apart. The key
 * stays in this worker (web/server/model.ts): no message out of it, no log line and no record in the
 * database has it in.
 */

/** What the worker needs of its global scope (the DOM's types, no WebWorker lib). */
export interface WorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  location: { href: string; search: string };
}

/** The page's start: its end of the channel to the client worker, the key it keeps, the fake GM, if the player chose it, and the dice's seed, if the address fixes it (?seed). */
interface Start { type: "start"; port: PortLike; key?: unknown; fake?: unknown; seed?: unknown }

export interface ServerConfig {
  /** The name of its database, its lock, and the channel another tab asks on. */
  deployment: string;
  /** content.json, beside this worker, with its build's ?v=. */
  contentUrl: URL;
  /** Its end of the channel to the client worker. */
  port: PortLike;
  key: string | undefined;
  /** The fake GM (dev: hosts/dev/fake.json's; arc: the whole story's recipe on it), or none: OpenRouter with the key. */
  fake: "dev" | "arc" | undefined;
  /** The dice's seed the address fixed (?seed, a test's: the browser check's), or none: the page host draws its own. */
  seed: number | undefined;
}

/** What the server worker tells the page. */
export interface Page {
  ready(channel: string): void;
  busy(channel: string): void;
  storage(ok: boolean, message?: string): void;
  keyRefused(): void;
  flushed(): void;
  error(message: string, reload?: boolean): void;
}

/** The page host as it plays: what the page's later messages reach. */
export interface Running { model: Model; storage: Storage; host: PageHost; tab: Tab }

export async function runServer(config: ServerConfig, page: Page): Promise<Running> {
  const tab = await claimTab(config.deployment, page.busy);
  const storage = await openStorage(await pageDatabase(config.deployment, page.storage), page.storage);
  const content = await loadContent(config.contentUrl);
  const model = modelFor(config, content, page);
  const host = await startHost({ model, ownerMoves: true, log: line => console.log(model.redact(line)), ...(config.seed !== undefined ? { seed: config.seed } : {}) }, storage, content);
  host.serve(portDuplex(config.port));
  page.ready(config.deployment);
  return { model, storage, host, tab };
}

/** The fake GM the player chose (with the whole story's recipe on it, for ?fake=arc), or OpenRouter with their key. */
function modelFor(config: ServerConfig, content: Content, page: Page): Model {
  if (config.fake === "arc") return fakeModel(onTop(content.fake, wholeStory()));
  if (config.fake === "dev") return fakeModel(content.fake);
  return keyModel(config.key, page.keyRefused);
}

/** Another tab takes the game over: no more jobs, everything written, and the lock let go of (the page ends this worker). */
async function letGo({ host, storage, tab }: Running): Promise<void> {
  host.stop();
  await storage.close();
  tab.release();
}

// ---------------------------------------------------------------------------------------------
// The worker: its config from where it's published and the page's start, and the page's messages.

const scope = self as unknown as WorkerScope;
const page = pageOf(scope);
let running: Promise<Running> | undefined;

scope.addEventListener("message", event => {
  const message = event.data as { type?: unknown; key?: unknown; port?: PortLike } | null;
  switch (message?.type) {
    case "start":
      running ??= start(message as Start);
      return;
    case "port":
      if (message.port) whenRunning(server => server.host.serve(portDuplex(message.port!)));
      return;
    case "key":
      if (typeof message.key === "string") whenRunning(server => server.model.setKey(message.key as string));
      return;
    case "flush":
      whenRunning(server => server.storage.flush().then(page.flushed));
      return;
    case "quit":
      whenRunning(server => letGo(server).then(page.flushed));
      return;
  }
});

function start(message: Start): Promise<Running> {
  const config = configOf(message);
  const started = runServer(config, page);
  started.catch(error => fail(error, config));
  return started;
}

/** Something for the page host to do once it plays (a start that failed has said so already). */
function whenRunning(act: (server: Running) => unknown): void {
  running?.then(act).catch(() => {});
}

function configOf(message: Start): ServerConfig {
  return {
    deployment: `kingmaker-v2-web ${new URL("./", scope.location.href).pathname}`,
    contentUrl: new URL(`content.json${scope.location.search}`, scope.location.href),
    port: message.port,
    key: typeof message.key === "string" && message.key ? message.key : undefined,
    fake: message.fake === "dev" || message.fake === "arc" ? message.fake : undefined,
    seed: typeof message.seed === "number" && Number.isSafeInteger(message.seed) && message.seed >= 0 ? message.seed : undefined,
  };
}

/**
 * What stopped the start, to the page (with a reload offered when the build's files didn't all load:
 * the preview published again since the page opened) and to the client worker, cut off in the same
 * words, without the key.
 */
function fail(error: unknown, config: ServerConfig): void {
  const said = redact(error instanceof Error ? error.message : String(error), config.key);
  console.warn("The game couldn't start:", said);
  if (unloaded(error)) page.error(`The game's files didn't all load, perhaps because this preview was updated since the page opened. Reload the page to get the new ones. (${said})`, true);
  else page.error(said);
  portDuplex(config.port).send({ kind: "status", cutOff: `(The game couldn't start: ${said})` });
}

/** How a browser says a module of the build wouldn't load (Chromium, Firefox, Safari), or content.json wouldn't. */
const unloaded = (error: unknown) =>
  error instanceof Unloaded || /dynamically imported module|Importing a module script failed/i.test(String((error as Error)?.message ?? error));

function pageOf(to: WorkerScope): Page {
  return {
    ready: channel => to.postMessage({ type: "ready", channel }),
    busy: channel => to.postMessage({ type: "busy", channel }),
    storage: (ok, message) => to.postMessage({ type: "storage", ok, ...(message ? { message } : {}) }),
    keyRefused: () => to.postMessage({ type: "key-refused" }),
    flushed: () => to.postMessage({ type: "flushed" }),
    error: (message, reload) => to.postMessage({ type: "error", message, ...(reload ? { reload: true } : {}) }),
  };
}
