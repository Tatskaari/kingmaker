import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { newGameOf, type Backend } from "../client/backend.ts";
import { demoBackend } from "../client/demo.ts";
import * as verbs from "../client/headless.ts";
import { connect } from "../client/net/connection.ts";
import { ownerAt, ownerFor } from "../client/net/owner.ts";
import { keepToken, serverFor, sessionAt } from "../client/net/session.ts";

/**
 * The headless client (v0-design §7, v5-design §3.9, v1-design §3.10), one verb a process: what an agent or a QA
 * run plays through, printing what the player would see. The session keeps the identity
 * (runs/play/), whose games the simulation keeps.
 */

const USAGE = `Kingmaker: headless play

  play builds --session <name> --as "Name: concept"
                                                three builds that fit, as the game offers them (play new --build takes one)
  play new --session <name> --as "Name: concept" [--campaign caerwyn]
                                                make a character, and set off; waits for the opening. With no --build the GM picks one
      [--build 1|2|3]                           one of the three builds (play builds' offer, or a new one)
      [--build own:<species>,<class>,<subclass>,<background>]
                                                one of your own making, from the SRD's ids
      [--build cleric|fighter|ranger|rogue|wizard]
                                                a ready-made character instead (no backstory: it goes straight in)
      [--backstory "..." | --backstory-file <path>]
                                                your backstory, checked against the lore: what doesn't fit is said, with
                                                a fix, and stops it there; --accept-fixes takes the fixes (and checks once more)
  play sheet --session <name>                   your character sheet
  play games --session <name>                   your games, as the title lists them
  play continue --session <name> --game <id>    carry one of your games on
  play delete --session <name> --game <id>      delete one of your games, for good
  play begin --session <name>                   set off, from the sheet of a character just made
  play join --session <name> --game <id>        watch someone's game (you see it as they do; you can't speak)
  play observe --session <name>                 what you see: your games, your sheet before you set off, or the scene and whose turn it is
  play say --session <name> <what you say or do>
                                                plain words are said; *asterisks* or (brackets) are done
      [--wait settled]                          wait for the world to settle too, not just the reply
      [--stream]                                the reply as it's written, on stderr
  play act --session <name> --id say_2 [--wait settled] [--stream]
                                                say one of the lines suggested (ACTIONS: lists them)
  play suggestions --session <name> [on|off]    the suggested lines: on (the default) or off; on asks
                                                for this moment's at once, and lists them
  play retry --session <name> [--wait settled] [--stream]
                                                carry a turn the GM lost on from where it got to
  play transcript --session <name>              everything said in the scene
  play end --session <name> [--exit <exit id>]  for testing, as the dev stack's owner: end the scene now through one of
                                                its exits (lists them without --exit); waits for the story to move on
  play go --session <name> [--stream]           on from a scene that's over: to the lead (its scene opens; act --id
                                                go_to_lead too), the fight, or a story that got stuck tried again
  play act --session <name> --id fight          the fight's stand-in: fought out, and the scene picks up from it
  play journal --session <name>                 the investigator's notebook, the quests, the flags, the attitudes
  play map --session <name> [--w 100 --h 30]    the scene's place: as the player sees it, then from above with what's what

new, begin, say, act, retry and go wait for the notes on the reply's marks (the opening's, for new,
begin and go) and the lines suggested after it (15 s at most), and print them. Every verb also takes --demo (canned turns, no server), and --url
and --db for the server (else KM_STDB_URL and KM_STDB_DB, else the running dev stack's, found in
runs/dev/stack.json or the folder --stack names, else ws://127.0.0.1:3300 and kingmaker). Sessions
are kept in runs/play/ (KM_RUNS_DIR moves runs/). A refusal or a failed turn exits 1.

Begin with observe; observe again after anything changes.`;

/** The prototype's QA console's default character. */
const DEFAULT_WHO = "Wren Ashdown: a quick-witted investigator lent to the case by the King";

type Args = ReturnType<typeof argsOf>;

async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const args = argsOf(argv);
  if (args.values.help) { console.log(USAGE); return 0; }
  if (!args.verb) { console.log(USAGE); return 1; }

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
      backstory: { type: "string" }, "backstory-file": { type: "string" }, "accept-fixes": { type: "boolean" },
      game: { type: "string" }, id: { type: "string" }, exit: { type: "string" }, wait: { type: "string" }, stream: { type: "boolean" }, demo: { type: "boolean" },
      url: { type: "string" }, db: { type: "string" }, stack: { type: "string" }, help: { type: "boolean", short: "h" },
      w: { type: "string" }, h: { type: "string" },
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
  const stack = args.values.stack ?? join(runs, "dev");
  const server = serverFor(defined({ url: args.values.url ?? env.KM_STDB_URL, db: args.values.db ?? env.KM_STDB_DB }), stack);
  // The dev stack's owner, for end (testing): only when it's the stack being played on.
  const owner = ownerFor(ownerAt(stack), server);
  return await connect({ ...server, ...(session.token ? { token: session.token } : {}), ...(owner ? { owner } : {}), onIdentity: (identity, token) => keepToken(session, identity, token) });
}

/** One verb, its words on stdout (the reply's progress on stderr), its exit code back. */
async function run(game: Backend, args: Args): Promise<number> {
  const out: verbs.Out = { print: text => console.log(text), progress: text => process.stderr.write(text) };
  const waiting = { settled: args.values.wait === "settled", stream: args.values.stream ?? false };

  switch (args.verb) {
    case "builds": return await verbs.builds(game, characterOf(args), out, waiting);
    case "new": return await verbs.newCharacter(game, characterOf(args), out, waiting);
    case "sheet": return verbs.sheet(game, out);
    case "games": return verbs.games(game, out);
    case "continue": return await verbs.continueGame(game, gameId(args.values.game, "continue"), out);
    case "delete": return await verbs.deleteGame(game, gameId(args.values.game, "delete"), out);
    case "begin": return await verbs.begin(game, out, waiting);
    case "join": return await verbs.joinGame(game, gameId(args.values.game, "join"), out);
    case "observe": return verbs.observe(game, out);
    case "say": return await verbs.say(game, args.text, out, waiting);
    case "act": return await verbs.act(game, lineId(args.values.id), out, waiting);
    case "suggestions": return await verbs.suggestions(game, setting(args.text), out);
    case "retry": return await verbs.retry(game, out, waiting);
    case "transcript": return verbs.transcript(game, out);
    case "end": return await verbs.end(game, args.values.exit, out, waiting);
    case "go": return await verbs.go(game, out, waiting);
    case "journal": return verbs.journal(game, out);
    case "map": return verbs.map(game, out, { w: cells(args.values.w, 100), h: cells(args.values.h, 30) });
    default: console.log(`There's no "${args.verb}" to play.\n\n${USAGE}`); return 1;
  }
}

/** Who to make, and how, from new's (or builds') arguments: --as, --build, the backstory from --backstory or its file, --accept-fixes. */
function characterOf(args: Args): verbs.NewCharacter {
  const { name, concept, campaign } = newGameOf(args.values.as ?? DEFAULT_WHO, "", args.values.campaign ?? "caerwyn");
  const file = args.values["backstory-file"];
  const backstory = file ? readFileSync(file, "utf8") : args.values.backstory;
  return { campaign, name, concept, build: args.values.build, backstory, acceptFixes: args.values["accept-fixes"] ?? false, session: args.values.session };
}

/** act's id: say_1, say_2…, or the way on's (go_to_lead, fight, carry_on). */
function lineId(id: string | undefined): string {
  if (!id) throw new Error("Which line? act takes --id say_1, say_2… (or go_to_lead, fight, carry_on) as ACTIONS: lists them (observe shows them).");
  return id;
}

/** suggestions on, off, or neither (which it is now). */
function setting(word: string): boolean | undefined {
  if (!word) return undefined;
  if (/^(on|off)$/i.test(word)) return word.toLowerCase() === "on";
  throw new Error(`suggestions takes on or off (or neither, to say which it is), not "${word}".`);
}

function gameId(game: string | undefined, verb: string): bigint {
  if (!game || !/^\d+$/.test(game)) throw new Error(`Which game? ${verb} takes --game <id>: ${verb === "join" ? "the number in the side panel of the game you'll watch" : "its number in play games"}.`);
  return BigInt(game);
}

/** map's --w or --h: a whole number of cells, from 10 to 400. */
function cells(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 10 || Number(value) > 400) throw new Error(`map's --w and --h take a whole number of cells, 10 to 400, not "${value}".`);
  return Number(value);
}

/** An object without its undefined values. */
const defined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

main(process.argv.slice(2), process.env).then(code => process.exit(code), (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
