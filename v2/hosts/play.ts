import { parseArgs } from "node:util";
import { newGameOf, type Backend } from "../client/backend.ts";
import { demoBackend } from "../client/demo.ts";
import * as verbs from "../client/headless.ts";
import { connect } from "../client/net/connection.ts";
import { keepToken, serverFor, sessionAt } from "../client/net/session.ts";

/**
 * The headless client (v0-design §7), one verb a process: what an agent or a QA run plays
 * through, printing what the player would see. The session keeps the identity (runs/play/); the
 * simulation keeps the game.
 */

const USAGE = `Kingmaker: headless play

  play new --session <name> --as "Name: concept" [--build ranger|rogue|wizard] [--campaign caerwyn]
                                                start a game as a ready-made character; waits for the opening
  play join --session <name> --game <id>        watch someone's game (you see it as they do; you can't speak)
  play observe --session <name>                 the scene as the player sees it, and whose turn it is
  play say --session <name> <what you say or do>
                                                plain words are said; *asterisks* or (brackets) are done
      [--wait settled]                          wait for the world to settle too, not just the reply
      [--stream]                                the reply as it's written, on stderr
  play retry --session <name> [--wait settled] [--stream]
                                                carry a turn the GM lost on from where it got to
  play transcript --session <name>              everything said in the scene

Every verb also takes --demo (canned turns, no server), and --url and --db for the server (else
KM_STDB_URL and KM_STDB_DB, else the running dev stack's, else ws://127.0.0.1:3300 and kingmaker).
Sessions are kept in runs/play/ (KM_RUNS_DIR moves runs/). A refusal or a failed turn exits 1.

Begin with observe; observe again after anything changes.`;

/** The prototype's QA console's default character. */
const DEFAULT_WHO = "Wren Ashdown: a quick-witted investigator lent to the case by the King";

type Args = ReturnType<typeof argsOf>;

async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const args = argsOf(argv);
  if (!args.verb || args.values.help) { console.log(USAGE); return args.verb || args.values.help ? 0 : 1; }

  const game = await backendFor(args, env);
  try {
    return await run(game, args);
  } finally {
    game.close();
  }
}

function argsOf(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      session: { type: "string" }, as: { type: "string" }, build: { type: "string" }, campaign: { type: "string" },
      game: { type: "string" }, wait: { type: "string" }, stream: { type: "boolean" }, demo: { type: "boolean" },
      url: { type: "string" }, db: { type: "string" }, help: { type: "boolean", short: "h" },
    },
  });
  const [verb, ...words] = positionals;
  return { verb, text: words.join(" "), values };
}

/** The demo, or the server as the session's identity (its token kept for the next process). */
async function backendFor(args: Args, env: NodeJS.ProcessEnv): Promise<Backend> {
  if (args.values.demo) return demoBackend({ ms: 5 });
  if (!args.values.session) throw new Error(`Which session? Every verb takes --session <name> (or --demo).\n\n${USAGE}`);

  const runs = env.KM_RUNS_DIR ?? "runs";
  const session = sessionAt(runs, args.values.session);
  const server = serverFor({ ...defined({ url: args.values.url ?? env.KM_STDB_URL, db: args.values.db ?? env.KM_STDB_DB }) }, runs);
  return await connect({ ...server, ...(session.token ? { token: session.token } : {}), onIdentity: (identity, token) => keepToken(session, identity, token) });
}

/** One verb, its words on stdout (the reply's progress on stderr), its exit code back. */
async function run(game: Backend, args: Args): Promise<number> {
  const out: verbs.Out = { print: text => console.log(text), progress: text => process.stderr.write(text) };
  const waiting = { settled: args.values.wait === "settled", stream: args.values.stream ?? false };

  switch (args.verb) {
    case "new": return await verbs.newGame(game, newGameOf(args.values.as ?? DEFAULT_WHO, args.values.build ?? "ranger", args.values.campaign ?? "caerwyn"), out, waiting);
    case "join": return await verbs.joinGame(game, gameId(args.values.game), out);
    case "observe": return verbs.observe(game, out);
    case "say": return await verbs.say(game, args.text, out, waiting);
    case "retry": return await verbs.retry(game, out, waiting);
    case "transcript": return verbs.transcript(game, out);
    default: console.log(`There's no "${args.verb}" to play.\n\n${USAGE}`); return 1;
  }
}

function gameId(game: string | undefined): bigint {
  if (!game || !/^\d+$/.test(game)) throw new Error("Which game? join takes --game <id>: the number in the side panel of the game you'll watch.");
  return BigInt(game);
}

/** An object without its undefined values. */
const defined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

main(process.argv.slice(2), process.env).then(code => process.exit(code), (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
