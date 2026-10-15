import { existsSync } from "node:fs";
import { basename } from "node:path";
import { fileReport } from "../report/dump.ts";
import { callDetail, callsList, errorsDetail, findReport, listReports, readDump, screensDetail, snapshotDetail, summary, worldDiff, worldNow } from "../report/inspect.ts";
import { restoreDump } from "../report/restore.ts";
import { sessionDir } from "../runtime/session.ts";

/**
 * Reports of problems from the game (b on the map, /report in a scene, the Esc menu's Report a
 * problem…), for investigating: src/cli/README.md.
 *
 *   npm run report -- inspect <file>     (node --no-warnings src/cli/report.ts inspect <file>)
 */

const USAGE = `Kingmaker reports: what a player reported from the game, to investigate (src/cli/README.md)

  report inspect <file> [--turns 4]              what they said, the build, where they were, the screen,
                                                 the last turns, the world's changes, errors and calls
  report inspect <file> --call <n>               a call in full: its prompt (or state and questions) and reply
  report inspect <file> --snapshot <turn>        a snapshot: the scene's state, transcript and world (--raw: JSON)
  report inspect <file> --diff <turn> [<turn>]   the world between two turns (one: from the turn before it)
  report inspect <file> --screens | --errors | --calls | --world | --json
  report restore <file> [--as <id>]              its game as a new session, as it was reported
  report list                                    the reports on this machine, newest first
  report make --session <id> "<what went wrong>" a report from a saved game (a QA session, say)

<file>: a path; a name in runs/reports (KM_RUNS_DIR's), or in ~/Downloads (the static
build's); or latest. "report <file>", as the game says it, works too.`;

/** --name value (taken out of args); true for a flag with no value. */
function flag(args: string[], name: string, takesValue = true): string | true | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = takesValue ? args[i + 1] : undefined;
  args.splice(i, takesValue && value !== undefined && !value.startsWith("--") ? 2 : 1);
  return takesValue && value !== undefined && !value.startsWith("--") ? value : true;
}

function inspect(args: string[]): void {
  const turns = flag(args, "turns"), call = flag(args, "call"), snapshot = flag(args, "snapshot"), diff = flag(args, "diff");
  const raw = !!flag(args, "raw", false), json = !!flag(args, "json", false);
  const screens = !!flag(args, "screens", false), errors = !!flag(args, "errors", false), calls = !!flag(args, "calls", false), world = !!flag(args, "world", false);
  // The rest: the report's name, and (for --diff) a second turn.
  const said = args.find(a => a !== "report" && !/^\d+$/.test(a));
  const second = args.find(a => /^\d+$/.test(a));
  if (!said) throw new Error("Which report? report inspect <file> (or latest)");
  const path = findReport(said);
  const dump = readDump(path);
  if (json) console.log(JSON.stringify(dump, null, 1));
  else if (call !== undefined) console.log(callDetail(dump, Number(call)));
  else if (snapshot !== undefined) console.log(snapshotDetail(dump, snapshot === true ? "latest" : snapshot, raw));
  else if (diff !== undefined) console.log(worldDiff(dump, diff === true ? "latest" : diff, second));
  else if (screens) console.log(screensDetail(dump));
  else if (errors) console.log(errorsDetail(dump));
  else if (calls) console.log(callsList(dump));
  else if (world) console.log(worldNow(dump));
  else console.log(summary(dump, { file: basename(path), ...(typeof turns === "string" ? { turns: Number(turns) } : {}) }));
}

function restore(args: string[]): void {
  const as = flag(args, "as");
  const said = args.filter(a => a !== "report")[0];
  if (!said) throw new Error("Which report? report restore <file> [--as <id>]");
  const dump = readDump(findReport(said));
  const restored = restoreDump(dump, typeof as === "string" ? { id: as } : {});
  const place = dump.where.place;
  const zoo = place?.hub === "zoo";
  console.log([
    `Restored ${restored.from} as ${restored.id} (${restored.dir}), as it was reported${dump.game?.live ? " (a turn was under way: this is the save from before it)" : ""}.`,
    `  The QA console: npm run qa -- observe --session ${restored.id}`,
    `  The game: npm run game, then ${zoo ? "The zoo (it's the latest visit now)" : place?.mode === "end" ? "nothing to Continue (it had reached The End)" : "Continue (it's the latest game now)"}.`,
  ].join("\n"));
}

function list(): void {
  const found = listReports();
  if (!found.length) { console.log("No reports yet (runs/reports, ~/Downloads)."); return; }
  for (const r of found) {
    let words = "";
    try { const d = readDump(r.path); words = `${d.where.place?.scene ?? d.where.place?.mode ?? d.where.screen}: ${JSON.stringify(d.words).slice(0, 90)}`; } catch (error) { words = `(unreadable: ${(error as Error).message})`; }
    console.log(`${new Date(r.mtimeMs).toISOString().slice(0, 19).replace("T", " ")}  ${r.file}  ${words}`);
  }
}

async function make(args: string[]): Promise<void> {
  const session = flag(args, "session");
  const words = args.join(" ").trim();
  if (typeof session !== "string" || !words) throw new Error('Usage: report make --session <id> "<what went wrong>"');
  if (!existsSync(sessionDir(session))) throw new Error(`No game ${session} (looked in ${sessionDir(session)})`);
  const filed = await fileReport({ words, session, where: { screen: "saves" } });
  console.log(filed.said);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "inspect": inspect(args); return;
    case "restore": restore(args); return;
    case "list": list(); return;
    case "make": await make(args); return;
    default: console.log(USAGE);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
