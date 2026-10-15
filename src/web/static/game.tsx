import { App } from "../../app/app.tsx";
import { Game, message } from "../../app/game.ts";
import { registerLookCanvas } from "../../game/look/opentui.ts";
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

export async function startGame(options: { cols: number; rows: number; write: (data: string) => void; onQuit: () => void; onJob: (job: Promise<void>) => void }): Promise<Started> {
  setBackgroundRunner(runInProcess(options.onJob));
  // The world's views paint themselves, live (<lookCanvas>).
  registerLookCanvas();
  const renderer = await createCliRenderer({ exitOnCtrlC: false, autoFocus: false, width: options.cols, height: options.rows, terminal: { write: options.write } });
  const game = new Game();
  const root = createRoot(renderer);
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    try { root.unmount(); } catch { /* already gone */ }
    try { renderer.destroy(); } catch { /* already gone */ }
    options.onQuit();
  };
  // A failure anywhere in the game shows up in it rather than tearing the terminal down.
  const fail = (error: unknown) => { game.status = `Something went wrong: ${message(error)}`; game.busy = undefined; game.emit(); };
  self.addEventListener("unhandledrejection", event => { event.preventDefault(); fail(event.reason); });
  self.addEventListener("error", event => { event.preventDefault(); fail(event.error ?? event.message); });
  root.render(<App game={game} onQuit={shutdown} />);
  return { renderer, game };
}
