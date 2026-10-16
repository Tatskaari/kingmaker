// Cut from the prototype's src/app/main.tsx at 44c6d4a: the terminal check, the renderer, the root and the shutdown; the look canvas, the browser overlay, reporting and the Game go, and the scene plays through the simulation (or the demo).
import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { createRoot, type Root } from "@opentui/react";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { App } from "../client/app.tsx";
import { newGameOf, viewWhen, type Backend } from "../client/backend.ts";
import { demoBackend } from "../client/demo.ts";
import { connect } from "../client/net/connection.ts";
import { keepToken, serverFor, sessionAt } from "../client/net/session.ts";
import { refusal } from "../shared/protocol/refusals.ts";
import { SceneModel } from "../client/scene/model.ts";
import type { SceneView } from "../client/scene/view.ts";

/**
 * The game's client in a terminal (v0-design §1.1, §7): the scene screen on OpenTUI's native
 * renderer. It plays through the simulation as the session's identity: a new game, someone's game
 * watched, or the game the session is in; or through the demo's canned turns, with no server.
 */

const USAGE = `Kingmaker: the client

  npm run client -- --session <name> --new "Name: concept" [--build ranger|rogue|wizard] [--campaign caerwyn]
                                         start a game as a ready-made character, and play it
  npm run client -- --session <name> --join <game>
                                         watch someone's game (the number in their side panel)
  npm run client -- --session <name>     back to the game the session is in
  npm run client -- --demo               canned turns, no server

--url and --db choose the server (else KM_STDB_URL and KM_STDB_DB, else the running dev stack's,
found in runs/dev/stack.json or the folder --stack names, else ws://127.0.0.1:3300 and kingmaker).
Sessions are kept in runs/play/ (KM_RUNS_DIR moves runs/).`;

type Args = ReturnType<typeof argsOf>["values"];

/** How long the move's own rows take to come: they come with its commit, in milliseconds. */
const ROWS_MS = 10_000;

/** What the status line says when the session's game has gone from the server (a stack started again with --fresh): the last view stays. */
const GONE = "(The game's server no longer has this game: /quit, then start one with --new, or watch one with --join.)";

async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<void> {
  needTerminal();
  const args = argsOf(argv).values;
  if (args.help) { console.log(USAGE); return; }

  const game = await backendFor(args, env);
  const view = await seated(game, args).catch((error: unknown) => { game.close(); throw error; });

  await play(game, view);
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

/** The move asked for (a new game, or a game to watch) made, and its scene's rows in; or the scene the session is already in. */
async function seated(game: Backend, args: Args): Promise<SceneView> {
  if (args.new !== undefined) {
    const before = game.view()?.game;
    const refused = await game.newGame(newGameOf(args.new, args.build ?? "ranger", args.campaign ?? "caerwyn"));
    if (refused) throw new Error(refused.text);
    return await viewWhen(game, v => v.game !== before, ROWS_MS);
  }
  if (args.join !== undefined) {
    if (!/^\d+$/.test(args.join)) throw new Error("--join takes a game's number: the one in its side panel.");
    const refused = await game.joinGame(BigInt(args.join));
    if (refused) throw new Error(refused.text);
    return await viewWhen(game, v => v.game === args.join, ROWS_MS);
  }
  const view = game.view();
  if (!view) throw new Error(`${refusal("not_in_game").text} Start one with --new "Name: concept", or watch one with --join <game>.`);
  return view;
}

/** The screen, over the game: its moves the model's actions, its views the model's updates, until the player quits. */
async function play(game: Backend, view: SceneView): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: false, autoFocus: false });
  const root = createRoot(renderer);
  const quit = leaving(root, renderer, game);

  const scene = new SceneModel(view, { say: text => void game.say(text), retry: () => void game.retry(), setSuggestions: on => game.setSuggestions(on), quit: () => quit(0) });
  game.onChange(() => { const next = game.view(); if (next) scene.update(next); else scene.lose(GONE); });

  process.on("SIGTERM", () => quit(0));
  process.on("SIGHUP", () => quit(0));
  // What goes wrong goes on the status line, not over the screen.
  const say = (e: unknown) => { scene.status = `(Something went wrong: ${e instanceof Error ? e.message : String(e)})`; scene.emit(); };
  process.on("unhandledRejection", say);
  process.on("uncaughtException", say);

  root.render(<App scene={scene} onQuit={() => quit(0)} />);
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
