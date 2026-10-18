// After the prototype's src/cli/report.ts at 44c6d4a: inspect (the summary, then each part in full), restore and list, its flags read the same way; make is the headless client's report verb now (npm run play -- report), and restore makes the game a new one in a local stack (a running dev stack's, or one it starts) for a session, where it wrote a session's folder.
import { createServer } from "node:net";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { connect } from "../client/net/connection.ts";
import { keepToken, sessionAt } from "../client/net/session.ts";
import { stampOf } from "../shared/report/format.ts";
import { callDetail, callsList, docsDetail, errorsDetail, logDetail, rowsDetail, screensDetail, summary, turnDetail } from "../qa/report/inspect.ts";
import { current, findReport, listReports, readReport, type Places } from "../qa/report/read.ts";
import { restoreReport, type StackAt } from "../qa/report/restore.ts";
import { readStackFile, type StackFile } from "./dev/stack-file.ts";
import { alive, stackDown, stackStatus, stackUp } from "./loop/stack.ts";
import { reportsDir } from "./reports.ts";

/**
 * Reports of a problem from the game (b, /report, an Esc menu's Report a problem…, the title's), for
 * investigating (V16, M5: README.md, Reporting a problem; docs/guide, Investigating a player's report).
 *
 *   npm run report -- inspect <file>          (node --no-warnings --import tsx hosts/report.ts inspect <file>)
 */

const USAGE = `Kingmaker reports: what a player reported from the game, to investigate

  report inspect <file> [--turns 4]          what they said, the build, where they were, the screen, the last
                                             turns as they saw them, errors and calls
  report inspect <file> --turn <n>           a turn in full: the player's line, the reply, the co-GM's roles and
                                             moves, the stage manager's operations, its calls (<scene>:<n> for
                                             another scene than theirs, by its row's id or key)
  report inspect <file> --call <n>           a call in full: its instructions, every message, its answer
  report inspect <file> --rows [<table>]     a table's rows in full (with none, every table and its count)
  report inspect <file> --errors | --screens | --calls | --docs [<path>] | --log | --json
  report restore <file> [--session <name>] [--stack <dir>] [--real]
                                             its game as a new game in a local stack, as it was reported, for a
                                             session to carry on: npm run dev's (runs/dev) when it's up, else one
                                             it starts in runs/report-stack on free ports (the fake GM unless
                                             --real); then npm run play or the client, as it says
  report stack status | down                 the stack restore started
  report list                                the reports on this machine, newest first

<file>: a path; a name in runs/reports (KM_RUNS_DIR's) or in ~/Downloads (the page's); or latest.
"report <file>", as the game says it, works too.`;

const RUNS = process.env.KM_RUNS_DIR ?? "runs";
const PLACES: Places = { reports: reportsDir(RUNS), downloads: join(homedir(), "Downloads") };
/** The stack a restore starts when no dev stack is up: on ports of its own, apart from the dev stack's (3300), the e2e's (3310), the arc's (3320) and the loop's (3330). */
const REPORT_STACK = join(RUNS, "report-stack");
const REPO = join(import.meta.dirname, "..");

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  switch (command) {
    case "inspect": return inspect(args);
    case "restore": return await restore(args);
    case "stack": return await stack(args);
    case "list": return list();
    default: console.log(USAGE);
  }
}

/** --name value (taken out of args); true for a flag with no value. */
function flag(args: string[], name: string, takesValue = true): string | true | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = takesValue ? args[i + 1] : undefined;
  const taken = takesValue && value !== undefined && !value.startsWith("--");
  args.splice(i, taken ? 2 : 1);
  return taken ? value : true;
}

function inspect(args: string[]): void {
  const turns = flag(args, "turns"), turn = flag(args, "turn"), call = flag(args, "call"), table = flag(args, "rows"), docs = flag(args, "docs");
  const shown = { errors: !!flag(args, "errors", false), screens: !!flag(args, "screens", false), calls: !!flag(args, "calls", false), log: !!flag(args, "log", false), json: !!flag(args, "json", false) };
  const said = args.filter(a => a !== "report")[0];
  if (!said) throw new Error("Which report? report inspect <file> (or latest)");
  const path = findReport(said, PLACES);
  const report = current(readReport(path));
  if (shown.json) console.log(JSON.stringify(report, null, 1));
  else if (typeof turn === "string") console.log(turnDetail(report, turn));
  else if (typeof call === "string") console.log(callDetail(report, Number(call)));
  else if (table !== undefined) console.log(rowsDetail(report, typeof table === "string" ? table : undefined));
  else if (docs !== undefined) console.log(docsDetail(report, typeof docs === "string" ? docs : undefined));
  else if (shown.errors) console.log(errorsDetail(report));
  else if (shown.screens) console.log(screensDetail(report));
  else if (shown.calls) console.log(callsList(report));
  else if (shown.log) console.log(logDetail(report));
  else console.log(summary(report, { file: basename(path), ...(typeof turns === "string" ? { turns: Number(turns) } : {}) }));
}

/**
 * A report's game made a new game in a local stack, as it was reported: the stack (asked for, the
 * dev stack when it's up, else one started), the session (its identity minted by connecting), the
 * restore, then the session's seat read back (the new game's number), and how to carry on.
 */
async function restore(args: string[]): Promise<void> {
  const asked = { session: flag(args, "session"), stack: flag(args, "stack"), real: !!flag(args, "real", false) };
  const said = args.filter(a => a !== "report")[0];
  if (!said) throw new Error("Which report? report restore <file> [--session <name>] [--stack <dir>]");
  const report = current(readReport(findReport(said, PLACES)));

  const { root, file, started } = await stackFor(typeof asked.stack === "string" ? asked.stack : undefined, asked.real);
  const session = sessionAt(RUNS, typeof asked.session === "string" ? asked.session : `report-${stampOf(new Date().toISOString())}`);
  const identity = await sessionIdentity(session, file);
  const restored = await restoreReport(report, stackAt(file), identity);
  const game = await seatOf(session, file);

  const where = root === join(RUNS, "dev") ? "" : ` --stack ${root}`;
  console.log([
    `Restored game ${restored.from} as game ${game ?? "?"} (uid ${restored.uid}) in the stack at ${root}${started ? " (started for it)" : ""}, for the session ${session.name}, as it was reported${restored.turn ? ` (${restored.turn}: it thinks again there, or waits for /retry)` : ""}; ${restored.docs} docs went with it.`,
    `  Headless: npm run play -- observe --session ${session.name}${where}`,
    `  The client: npm run client -- --session ${session.name}${where}, then Continue (it's the latest game).`,
    ...(started ? [`  The stack: npm run report -- stack down stops it (its log: ${join(root, "loop-stack.log")}).`] : []),
  ].join("\n"));
}

/** The stack to restore into: the one asked for, the dev stack when its host is up, or one started in runs/report-stack on free ports. */
async function stackFor(asked: string | undefined, real: boolean): Promise<{ root: string; file: StackFile; started: boolean }> {
  if (asked) return { root: asked, file: upIn(asked) ?? fail(`No stack is up in ${asked} (its stack.json, its dev host running).`), started: false };
  const dev = upIn(join(RUNS, "dev"));
  if (dev) return { root: join(RUNS, "dev"), file: dev, started: false };
  const kept = upIn(REPORT_STACK);
  if (kept) return { root: REPORT_STACK, file: kept, started: false };

  console.error(`No dev stack is up: starting one in ${REPORT_STACK}${real ? "" : " on the fake GM (--real for real models)"}…`);
  const [port, aiPort] = [await freePort(), await freePort()];
  console.error(await stackUp({ root: REPORT_STACK, port, aiPort, fake: !real, fresh: true, down: "npm run report -- stack down" }, REPO));
  return { root: REPORT_STACK, file: upIn(REPORT_STACK) ?? fail(`The stack in ${REPORT_STACK} didn't come up.`), started: true };
}

/** A stack's file, when its dev host is running. */
function upIn(root: string): StackFile | undefined {
  const file = readStackFile(root);
  return file?.pids.host && alive(file.pids.host) ? file : undefined;
}

const stackAt = (file: StackFile): StackAt => ({ http: file.http, db: file.db, ownerToken: file.owner.token, ai: file.aiFromHost, bearer: file.ai.bearer });

/** The session's identity: connected as it (a new one is minted and kept with it). */
async function sessionIdentity(session: ReturnType<typeof sessionAt>, file: StackFile): Promise<string> {
  const connection = await connect({ url: file.ws, db: file.db, ...(session.token ? { token: session.token } : {}), onIdentity: (identity, token) => keepToken(session, identity, token) });
  const identity = connection.identity;
  connection.close();
  return identity;
}

/** The session's seat once it's restored: the new game's number. */
async function seatOf(session: ReturnType<typeof sessionAt>, file: StackFile): Promise<string | undefined> {
  const connection = await connect({ url: file.ws, db: file.db, ...(session.token ? { token: session.token } : {}) });
  const seat = connection.home().seat;
  connection.close();
  return seat ? String(seat.gameId) : undefined;
}

/** A port nobody's listening on, as the system hands one out. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });
}

async function stack(args: string[]): Promise<void> {
  const [what] = args;
  if (what === "down") console.log(await stackDown(REPORT_STACK));
  else if (what === "status") console.log(stackStatus(REPORT_STACK));
  else console.log("report stack takes status or down: the stack restore started, in runs/report-stack.");
}

function list(): void {
  const found = listReports(PLACES);
  if (!found.length) { console.log(`No reports yet (${PLACES.reports}, ~/Downloads).`); return; }
  for (const r of found) {
    let words = "";
    try {
      const report = readReport(r.path);
      words = `${report.where.scene?.title ?? report.where.map?.key ?? report.where.screen}: ${JSON.stringify(report.words).slice(0, 90)}`;
    } catch (error) {
      words = `(unreadable: ${(error as Error).message})`;
    }
    console.log(`${new Date(r.mtimeMs).toISOString().slice(0, 19).replace("T", " ")}  ${r.file}  ${words}`);
  }
}

function fail(words: string): never {
  throw new Error(words);
}

main(process.argv.slice(2)).then(() => process.exit(0), (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
