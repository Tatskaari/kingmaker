// After the prototype's src/web/static/worker.ts at 44c6d4a, its terminal half (write :69-81, scrub :83-94, the messages :275-316, and a report's :254-258), and its game.tsx (startGame, :36-77, with its report sink :50-57 and the doors' overlay :47-48, M5): the App over an AppModel on the Replica over a port, where the prototype's was over its Game; the key, the saves, the lock, the content and the jobs are the server worker's, and a report goes to the page from here (M5), the game in it the server worker's answer. New: the game's sound goes to the page too (client/sound: what to play, which the page's audio thread makes).
import { App } from "../../client/app.tsx";
import { AppModel } from "../../client/app/model.ts";
import { GLYPH_SETS, glyphSet, setGlyphSet, type GlyphSet } from "../../client/look/glyphs.ts";
import { setPace } from "../../client/pace.ts";
import { attachOverlay, registerLookCanvas } from "../../client/look/opentui.ts";
import { portLink, type MessagePortLike } from "../../client/net/port.ts";
import { Replica } from "../../client/net/replica.ts";
import { attachReporting } from "../../client/report/attach.ts";
import { attachSound } from "../../client/sound/attach.ts";
import { setSoundOut } from "../../client/sound/cues.ts";
import type { SoundMessage } from "../../client/sound/engine.ts";
import type { Reporting } from "../../client/report/file.ts";
import { visit } from "../../client/zoo/zoo.ts";
import { stampOf } from "../../shared/report/format.ts";
import { createRoot, type Root } from "../../web/tui/react.ts";
import { createCliRenderer, type CliRenderer } from "../../web/tui/renderer.ts";

/**
 * The page's client worker (browser-design §2, §5): the client's App on the JS OpenTUI (web/tui),
 * over the Replica on a port to the server worker, drawing into the page's terminal. The page talks
 * to it in messages (understand-web.md §5.4):
 *
 *   page -> worker   {type: "start", port, cols, rows, glyphs?, reducedMotion?, zoo?, build?, foes?, doors?} (the port transferred), then
 *                    {type: "input", data}, {type: "resize", cols, rows}, {type: "redraw"}, {type: "quit"}
 *   worker -> page   {type: "started"}, {type: "output", data}, {type: "exit"}, {type: "error", message},
 *                    {type: "report", name, data} (a report of a problem, gzipped: the page downloads it),
 *                    {type: "sound", messages} (what the game's sound engine is to play: web/page/sound.ts)
 *
 * The port is the client's end of the page's MessageChannel: the server worker has the other end.
 * The client never sees the player's key (the server worker holds it), and a key pasted into the
 * game goes no further than here. Quitting (q on the title, Ctrl+C, or the page's quit) takes the
 * screen down, tells the server the client has gone, and says exit: the page starts a new client
 * worker, with a new port, to play again.
 */

/** What the worker needs of its global scope (the DOM's types, no WebWorker lib). */
export interface WorkerScope {
  postMessage(message: unknown): void;
  /** Where it was loaded from: its ?v= is the build's stamp, for a report. */
  location: { search: string };
  navigator: { userAgent: string };
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "unhandledrejection", listener: (event: PromiseRejectionEvent) => void): void;
}
const scope = self as unknown as WorkerScope;

/**
 * The page's start: its end of the channel to the server worker, the terminal's size, the glyph set its
 * fonts draw (kingmaker unless it says), whether the browser asks for reduced motion, and the zoo when the page's address asks for it (M6: ?zoo, the
 * zoo's menu on the title, "" here; ?zoo=ring, a visit to that exhibit at once, as `build` against `foes`); `doors` false when the page
 * draws no doors or lamps over the map (?doors=off).
 */
interface Start { type: "start"; port: MessagePortLike; cols: number; rows: number; glyphs?: string; reducedMotion?: boolean; zoo?: string; build?: string; foes?: string; doors?: boolean }
type PageMessage = Start | { type: "input"; data: Uint8Array | string } | { type: "resize"; cols: number; rows: number } | { type: "redraw" } | { type: "quit" };

/** What the client tells the page: the terminal's bytes, started, exit, why it couldn't start, and a report of a problem to download. */
interface Page {
  write(data: string): void;
  started(): void;
  exit(): void;
  fail(error: unknown): void;
  report(name: string, bytes: Uint8Array): void;
  sound(messages: SoundMessage[]): void;
}

/** The client, running: what the page's later messages reach. */
interface Running { renderer: CliRenderer; app: AppModel }

/**
 * The client, as hosts/client.tsx plays it in a terminal: the Replica over the port and its rows in
 * (the AppModel reads them whole as it's made), then the screens on the stand-in, writing to the
 * page, the title first.
 */
export async function runClient(start: Start, page: Page): Promise<Running> {
  setGlyphSet(glyphsOf(start.glyphs));
  // The browser's reduced motion (prefers-reduced-motion): a fight's moves at their ends, with their captions.
  setPace({ reducedMotion: start.reducedMotion === true });
  const game = new Replica(portLink(start.port, { session: "default" }));
  await game.ready;
  // ?zoo=<exhibit>: a visit to it at once, as the fighter unless the address says (its refusal on the title).
  const visited = start.zoo ? await visit(game, { exhibit: start.zoo, build: start.build ?? "fighter", foes: start.foes }) : undefined;

  // The scene's place paints itself, live (<lookCanvas>).
  registerLookCanvas();
  const renderer = await createCliRenderer({ exitOnCtrlC: false, autoFocus: false, width: start.cols, height: start.rows, terminal: { write: page.write } });
  // The page draws the doors and lamp posts as pictures over the ASCII (web/page/doors.ts): where they are goes out with each frame that moves them (M5).
  attachOverlay(renderer as unknown as Parameters<typeof attachOverlay>[0], { doors: start.doors !== false });
  const root = createRoot(renderer);
  const app = new AppModel(game, { campaign: "caerwyn", intent: start.zoo && !visited ? "game" : "title", surface: "page", onQuit: leaving(root, renderer, game, page), reporting: pageReporting(start, renderer, page) });
  attachReporting(app, renderer);
  // The game's sound, played by the page (web/page/sound.ts): its music, its voices, its effects.
  setSoundOut({ send: messages => page.sound(messages) });
  attachSound(app);
  // ?zoo: the zoo's menu on the title; a visit refused (an exhibit it hasn't got), the menu with why.
  if (start.zoo === "" || visited) app.title.openZoo();
  if (visited) { app.title.zooNote = visited.text; app.emit(); }

  troubleOnScreen(app);
  root.render(<App app={app} />);
  page.started();
  return { renderer, app };
}

/** The page's glyph set, if it's one: its fonts have Kingmaker Glyphs, so that by default. */
function glyphsOf(said: string | undefined): GlyphSet {
  return GLYPH_SETS.find(set => set === said) ?? "kingmaker";
}

/** Leaving: the screen taken down, the server told the client has gone (the port closed), the page told. */
function leaving(root: Root, renderer: CliRenderer, game: Replica, page: Page): () => void {
  let closing = false;
  return () => {
    if (closing) return;
    closing = true;
    try { root.unmount(); } catch { /* already gone */ }
    try { renderer.destroy(); } catch { /* already gone */ }
    game.close();
    page.exit();
  };
}

/** What goes wrong goes on the screen's own line, not over the screen, and is noted for a report (hosts/client.tsx's, for a worker's events). */
function troubleOnScreen(app: AppModel): void {
  const say = (where: string, e: unknown) => {
    app.report.noted.error(where, e);
    app.trouble(`(Something went wrong: ${e instanceof Error ? e.message : String(e)})`);
  };
  scope.addEventListener("unhandledrejection", event => { event.preventDefault(); say("unhandled rejection", event.reason); });
  scope.addEventListener("error", event => { event.preventDefault(); say("error", event.error ?? event.message); });
}

/**
 * Where the page's reports of a problem go (M5): to the page, which downloads them (what's kept in
 * the browser is out of reach of whoever investigates it); what it says of itself in one: the build's
 * stamp and the browser, the glyphs, the terminal's size and reduced motion. It knows no key: the
 * player's is the server worker's, which takes it out of the game it answers with, and the page
 * takes it out of anything typed or pasted before it reaches this worker.
 */
function pageReporting(start: Start, renderer: CliRenderer, page: Page): Reporting {
  const stamp = new URLSearchParams(scope.location.search).get("v") ?? "";
  return {
    build: () => ({ host: "page", ...(stamp ? { stamp } : {}), userAgent: scope.navigator.userAgent }),
    settings: () => ({ glyphs: glyphSet(), terminal: { cols: renderer.width, rows: renderer.height }, reducedMotion: start.reducedMotion === true, env: {} }),
    keys: () => [],
    keep: async packed => {
      const file = `kingmaker-report-${stampOf(packed.at)}.json.gz`;
      page.report(file, packed.bytes);
      return { file, said: `Downloaded ${file} (your browser's downloads): tell Claude 'report ${file}'` };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The page's side: its messages in, the client's out.

/** The terminal's bytes go out in batches: whatever was drawn in one turn of the event loop is one message. */
function pageOf(post: (message: unknown) => void): Page {
  let output: string[] = [];
  let queued = false;
  const flush = () => {
    queued = false;
    if (!output.length) return;
    const data = output.join("");
    output = [];
    post({ type: "output", data });
  };
  return {
    write: data => { output.push(data); if (!queued) { queued = true; queueMicrotask(flush); } },
    started: () => post({ type: "started" }),
    // The screen's last bytes (the terminal given back) go before the word that it's gone.
    exit: () => { flush(); post({ type: "exit" }); },
    fail: error => post({ type: "error", message: error instanceof Error ? error.message : String(error) }),
    report: (name, bytes) => post({ type: "report", name, data: bytes }),
    sound: messages => post({ type: "sound", messages }),
  };
}

/** What an OpenRouter key looks like. One pasted into the game (meant for the key form, say) goes no further: typed into a scene, it would go to the GM and into the saves. */
const KEYISH = /sk-or-v1-[0-9a-f]{32,}/gi;
const decoder = new TextDecoder();

function scrub(data: Uint8Array | string): Uint8Array | string {
  const text = typeof data === "string" ? data : decoder.decode(data);
  KEYISH.lastIndex = 0;
  return KEYISH.test(text) ? text.replace(KEYISH, "") : data;
}

const page = pageOf(message => scope.postMessage(message));
let running: Promise<Running> | undefined;
/** Once the client is running (the page's input during its start waits for it); nothing, if it couldn't start. */
const whenRunning = (act: (client: Running) => void) => void running?.then(act, () => {});

/** The page's messages: start once, then the terminal's input and size, a redraw, and quitting. */
function onPage(message: PageMessage): void {
  switch (message.type) {
    case "start":
      if (running) return;
      running = runClient(message, page);
      running.catch(page.fail);
      return;
    case "input": return whenRunning(({ renderer }) => renderer.processInput(scrub(message.data)));
    case "resize": return whenRunning(({ renderer }) => renderer.resize(Number(message.cols), Number(message.rows)));
    case "redraw": return whenRunning(({ renderer }) => renderer.invalidate());
    case "quit": return whenRunning(({ app }) => app.quit());
  }
}

scope.addEventListener("message", event => onPage(event.data as PageMessage));
