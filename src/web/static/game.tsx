import { App } from "../../app/app.tsx";
import { Game, message } from "../../app/game.ts";
import { attachReporting, unhandled } from "../../app/report.ts";
import { attachOverlay, registerLookCanvas } from "../../game/look/opentui.ts";
import { setReportSink, stampOf } from "../../report/dump.ts";
import { setBackgroundRunner } from "../../runtime/background.ts";
import { rememberJob, repairJob } from "../../runtime/jobs.ts";
import { createRoot } from "../tui/react.ts";
import { createCliRenderer, type CliRenderer } from "../tui/renderer.ts";

/**
 * The game, as src/app/main.tsx starts it in a terminal: the App over a Game, on a renderer whose
 * terminal is the page's (its bytes go out as the worker's messages). What main.tsx gets from the
 * process here comes from the worker: a failure shows up in the game, and quitting hands back to
 * the page. The background jobs between turns run here, as the scene CLI's commands would.
 */

export interface Started { renderer: CliRenderer; game: Game }

/**
 * The scene CLI's arguments for a job ("remember <id> --turn N --scene S", "repair <id> --turn N")
 * to the job, run soon and never awaited by the turn. `onJob` hears of each as it's scheduled.
 * KM_JOB_DELAY_MS holds each back that long first (the static check's ?jobdelay, to catch one running).
 */
function runInProcess(onJob: (job: Promise<void>) => void) {
  return (args: string[]) => {
    const [command, id, ...rest] = args;
    const flag = (name: string) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
    const turn = Number(flag("turn"));
    if (!id || (command !== "remember" && command !== "repair")) return;
    const soon = new Promise<void>(resolve => setTimeout(resolve, Number(process.env.KM_JOB_DELAY_MS) || 0));
    onJob(soon.then(() => (command === "remember" ? rememberJob(id, turn, flag("scene"), { ownLog: false }) : repairJob(id, turn, { ownLog: false }))));
  };
}

export async function startGame(options: {
  cols: number; rows: number; write: (data: string) => void; onQuit: () => void; onJob: (job: Promise<void>) => void;
  /** A failure that's a part of the game not loading (a lazily loaded chunk gone since a new build was published), and what to do then. */
  unloaded: (error: unknown) => boolean; onUnloaded: (error: unknown) => void;
  /** A report of a problem, made: the page downloads it. */
  onReport: (file: string, bytes: Uint8Array) => void;
}): Promise<Started> {
  setBackgroundRunner(runInProcess(options.onJob));
  // The world's views paint themselves, live (<lookCanvas>).
  registerLookCanvas();
  const renderer = await createCliRenderer({ exitOnCtrlC: false, autoFocus: false, width: options.cols, height: options.rows, terminal: { write: options.write } });
  // The page draws the doors as pictures over the ASCII (src/web/page/doors.ts): where they are goes out with each frame that moves them.
  attachOverlay(renderer as unknown as Parameters<typeof attachOverlay>[0]);
  const game = new Game();
  // A report of a problem (b, /report, the Esc menu) has what was on screen, and goes to the page to
  // download: what's kept here is in this browser, where nobody investigating can read it.
  attachReporting(game, renderer);
  setReportSink(async report => {
    const file = `kingmaker-report-${stampOf(report.at)}.json.gz`;
    options.onReport(file, report.bytes);
    return { file, said: `Downloaded ${file} (your browser's downloads): tell Claude 'report ${file}'` };
  });
  const root = createRoot(renderer);
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    try { root.unmount(); } catch { /* already gone */ }
    try { renderer.destroy(); } catch { /* already gone */ }
    options.onQuit();
  };
  // A failure anywhere in the game shows up in it rather than tearing the terminal down (but a part of it that won't load is the page's to say).
  const fail = (error: unknown) => {
    if (options.unloaded(error)) return options.onUnloaded(error);
    unhandled(error);
    game.status = `Something went wrong: ${message(error)}`; game.busy = undefined; game.emit();
  };
  self.addEventListener("unhandledrejection", event => { event.preventDefault(); fail(event.reason); });
  self.addEventListener("error", event => { event.preventDefault(); fail(event.error ?? event.message); });
  root.render(<App game={game} onQuit={shutdown} />);
  return { renderer, game };
}
