// Cut from the prototype's src/app/main.tsx at 44c6d4a: the terminal check, the renderer, the root and the shutdown; the look canvas, the browser overlay and reporting go, the Game is the AppModel over the simulation (or the demo).
import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { createRoot, type Root } from "@opentui/react";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { App } from "../client/app.tsx";
import { AppModel, type Intent } from "../client/app/model.ts";
import { newGameOf, type Backend } from "../client/backend.ts";
import { demoBackend } from "../client/demo.ts";
import { connect } from "../client/net/connection.ts";
import { keepToken, serverFor, sessionAt } from "../client/net/session.ts";

/**
 * The game's client in a terminal (v0-design §1.1, §7, v1-design §3.10): the title, character
 * creation and the scene on OpenTUI's native renderer. It plays through the simulation as the
 * session's identity, whose games the title lists; or through the demo's canned rows, with no server.
 */

const USAGE = `Kingmaker: the client

  npm run client -- --session <name>     the title: carry on one of the session's games, or make a character
  npm run client -- --session <name> --new "Name: concept"
                                         make a character from a sentence: three builds that fit, then your backstory
  npm run client -- --session <name> --new "Name: concept" --build cleric|fighter|ranger|rogue|wizard [--campaign caerwyn]
                                         start a game as a ready-made character, and play it
  npm run client -- --session <name> --join <game>
                                         watch someone's game (the number in their side panel)
  npm run client -- --demo               the title, a character made and a scene, canned: no server

--url and --db choose the server (else KM_STDB_URL and KM_STDB_DB, else the running dev stack's,
found in runs/dev/stack.json or the folder --stack names, else ws://127.0.0.1:3300 and kingmaker).
Sessions are kept in runs/play/ (KM_RUNS_DIR moves runs/).`;

type Args = ReturnType<typeof argsOf>["values"];

async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<void> {
  needTerminal();
  const args = argsOf(argv).values;
  if (args.help) { console.log(USAGE); return; }

  const campaign = args.campaign ?? "caerwyn";
  const game = await backendFor(args, env);
  const intent = await started(game, args, campaign).catch((error: unknown) => { game.close(); throw error; });

  await play(game, intent, campaign);
}

/** Refuses without a terminal on both ends: the headless client is for that. */
function needTerminal(): void {
  if (process.stdin.isTTY && process.stdout.isTTY) return;
  console.error("Kingmaker needs a real terminal. For headless play: npm run play -- --help");
  process.exit(1);
}

function argsOf(argv: string[]) {
  return parseArgs({
    args: argv,
    options: {
      session: { type: "string" }, new: { type: "string" }, build: { type: "string" }, campaign: { type: "string" },
      join: { type: "string" }, demo: { type: "boolean" }, url: { type: "string" }, db: { type: "string" }, stack: { type: "string" }, help: { type: "boolean", short: "h" },
    },
  });
}

/** The demo, or the server as the session's identity (its token kept for the next run). */
async function backendFor(args: Args, env: NodeJS.ProcessEnv): Promise<Backend> {
  if (args.demo) return demoBackend();
  if (!args.session) throw new Error(`Which session? The client takes --session <name> (or --demo).\n\n${USAGE}`);

  const runs = env.KM_RUNS_DIR ?? "runs";
  const session = sessionAt(runs, args.session);
  const url = args.url ?? env.KM_STDB_URL, db = args.db ?? env.KM_STDB_DB;
  const server = serverFor({ ...(url ? { url } : {}), ...(db ? { db } : {}) }, args.stack ?? join(runs, "dev"));
  return await connect({ ...server, ...(session.token ? { token: session.token } : {}), onIdentity: (identity, token) => keepToken(session, identity, token) });
}

/**
 * The move asked for made, and where the client opens: a ready-made character's game, or a game to
 * watch (the game); a character from a sentence (its creation: three builds that fit); else the title.
 */
async function started(game: Backend, args: Args, campaign: string): Promise<Intent> {
  if (args.new !== undefined) {
    const who = newGameOf(args.new, args.build ?? "", campaign);
    const refused = args.build
      ? await game.newGame(who)
      : await game.act("startCreation", { campaign, name: who.name, concept: who.concept, how: "three" });
    if (refused) throw new Error(refused.text);
    return args.build ? "game" : "creation";
  }
  if (args.join !== undefined) {
    if (!/^\d+$/.test(args.join)) throw new Error("--join takes a game's number: the one in its side panel.");
    const refused = await game.joinGame(BigInt(args.join));
    if (refused) throw new Error(refused.text);
    return "game";
  }
  return "title";
}

/** The screens, over the game: the app's model follows the rows and makes the moves, until the player quits. */
async function play(game: Backend, intent: Intent, campaign: string): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: false, autoFocus: false });
  const root = createRoot(renderer);
  const quit = leaving(root, renderer, game);
  const app = new AppModel(game, { campaign, intent, onQuit: () => quit(0) });

  process.on("SIGTERM", () => quit(0));
  process.on("SIGHUP", () => quit(0));
  // What goes wrong goes on the screen's own line, not over the screen.
  const say = (e: unknown) => app.trouble(`(Something went wrong: ${e instanceof Error ? e.message : String(e)})`);
  process.on("unhandledRejection", say);
  process.on("uncaughtException", say);

  root.render(<App app={app} />);
}

/** Leaving: the screen taken down, the connection closed, the terminal given back. */
function leaving(root: Root, renderer: CliRenderer, game: Backend): (code: number) => void {
  let closing = false;
  return code => {
    if (closing) return;
    closing = true;
    try { root.unmount(); } catch { /* already gone */ }
    try { renderer.destroy(); } catch { /* already gone */ }
    game.close();
    process.exit(code);
  };
}

main(process.argv.slice(2), process.env).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
