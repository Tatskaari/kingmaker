/**
 * The page's server worker (browser-design §2, §5): the simulation's page host, the AI service in
 * process and IndexedDB, behind a port to the client worker. Not built yet: a stub, so the page and
 * the build have an entry to load. It answers the page's start with an error the page shows.
 */

/** What the worker needs of its global scope (the DOM's types, no WebWorker lib). */
export interface WorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}
const scope = self as unknown as WorkerScope;

scope.addEventListener("message", event => {
  if ((event.data as { type?: unknown } | null)?.type === "start") scope.postMessage({ type: "error", message: "not built" });
});
