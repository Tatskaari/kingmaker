import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { registerLookCanvas } from "../game/look/opentui.ts";
import { App } from "./app.tsx";
import { Game, message } from "./game.ts";

/**
 * Kingmaker V2, the playable game: make a character, walk Caerwyn, talk your way through the
 * GM-run scenes, fight on the map, report to the King.
 *
 *   npm run game        (node --experimental-ffi --no-warnings --import tsx src/app/main.tsx)
 *
 * Needs a real terminal (OpenTUI) and OPENROUTER_API_KEY for the GM. Saves go under runs/sessions
 * (KM_RUNS_DIR moves them).
 */

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("Kingmaker needs a real terminal (try `npm run game` in one). For headless checks, see src/app/smoke/.");
  process.exit(1);
}

// The world's views paint themselves, live (<lookCanvas>).
registerLookCanvas();
const renderer = await createCliRenderer({ exitOnCtrlC: false, autoFocus: false });
const game = new Game();
const root = createRoot(renderer);

let closing = false;
function shutdown(code = 0): void {
  if (closing) return;
  closing = true;
  try { root.unmount(); } catch { /* already gone */ }
  try { renderer.destroy(); } catch { /* already gone */ }
  process.exit(code);
}

// A failure anywhere in the game shows up in it rather than tearing the terminal down.
process.on("unhandledRejection", error => { game.status = `Something went wrong: ${message(error)}`; game.busy = undefined; game.emit(); });
process.on("uncaughtException", error => { game.status = `Something went wrong: ${message(error)}`; game.busy = undefined; game.emit(); });
process.on("SIGTERM", () => { game.quit(); shutdown(0); });
process.on("SIGHUP", () => { game.quit(); shutdown(0); });

root.render(<App game={game} onQuit={() => shutdown(0)} />);
