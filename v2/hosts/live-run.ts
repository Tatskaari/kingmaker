import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { connect } from "../client/net/connection.ts";
import { playScript } from "./live/play.ts";
import { offeredOf, recordOf, spentOf } from "./live/record.ts";
import { markdownOf } from "./live/report.ts";
import { SCRIPTS, type Script } from "./live/scripts.ts";
import { modelOf, runningStack } from "./live/stack.ts";

/**
 * The live run (v0-design §10.6, v5-design §4.6): a new game and a script's lines against the running
 * dev stack, with the models it runs, recorded as Markdown: each turn's timings (from the turn rows,
 * and the notes and lines as they reached this client), who said what, the notes with their cards,
 * the lines offered and those screened out, the model calls and their cost (the AI service's call
 * log), the measures against the prototype's, and what the scene holds back from the player.
 *
 *   npm run dev                                # real models, in another terminal
 *   npm run live -- --script v5               # writes docs/live/v5-<date>.md
 *   npm run live -- --lines 4                 # V0's script: docs/live/v0-<date>.md
 *
 * It finds the stack by its ports (the dev host's unless told) and stops before a line that would
 * take the run past its budget (--budget, $0.10), judging a turn by the dearest so far.
 */

const USAGE = `npm run live [-- options]
  --script v0|v5     the lines to play (v0): V0's six, or V5's twelve, two of them a suggested line picked
  --lines <n>        how many of the script's lines (v0: 4; v5: 12)
  --as "Name: concept" --build <id>   the character (the script's own)
  --port <n>         the dev stack's SpacetimeDB port (3300)
  --ai-port <n>      its AI service's port (8787)
  --stack <dir>      the dev stack's folder (else the one under runs/ on those ports)
  --out <file>       where the record goes (docs/live/<script>-<date>.md)
  --budget <usd>     stop before a line that would spend past this (0.10)
  --rehearse         run against a stack on the fake model (the record says so)`;

const V2 = resolve(import.meta.dirname, "..");

main(flagsOf(process.argv.slice(2))).then(() => process.exit(0), (error: unknown) => {
  console.error(`The live run stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

async function main(flags: Flags): Promise<void> {
  const stack = runningStack(join(V2, "runs"), flags);
  const model = await modelOf(stack, flags.rehearse);
  const conn = await connect({ url: stack.ws, db: stack.db });

  console.log(`The live run: ${flags.script.name}, ${flags.lines} lines against ${stack.http} (${model} model)`);
  const run = await playScript(conn, flags.script, {
    who: flags.who, build: flags.build, lines: flags.lines, budget: flags.budget,
    spent: uid => spentOf(stack.root, uid), offered: scene => offeredOf(stack, scene), log: line => console.log(`  ${line}`),
  });
  if (run.stopped) console.log(`  stopped: ${run.stopped}`);
  if (!run.game) throw new Error(run.stopped ?? "the game didn't open");

  const record = await recordOf(stack, run, { script: flags.script, date: flags.date, rehearse: flags.rehearse, lines: flags.lines, model });
  writeRecord(flags.out, markdownOf(record, commandOf(flags)));
  console.log(`\nRecorded ${shown(flags.out)}: ${record.turns.length} turns, ${record.calls.length} model calls, $${record.cost.toFixed(4)}`);
  conn.close();
}

// ---------------------------------------------------------------------------------------------
// The record.

/** The command as it was typed, for the record: the flags that changed anything. */
function commandOf(flags: Flags): string {
  return ["npm run live --", `--script ${flags.script.name}`, `--lines ${flags.lines}`, ...(flags.portsGiven ? [`--port ${flags.port} --ai-port ${flags.aiPort}`] : []), ...(flags.rehearse ? ["--rehearse"] : [])].join(" ");
}

/** A path as the reader typed it: relative to here when it's under here. */
function shown(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel.startsWith("..") ? path : rel;
}

function writeRecord(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

// ---------------------------------------------------------------------------------------------
// Flags.

interface Flags {
  script: Script; lines: number; who: string; build: string;
  port: number; aiPort: number; portsGiven: boolean; stack?: string;
  out: string; budget: number; rehearse: boolean; date: string;
}

function flagsOf(argv: string[]): Flags {
  const values = valuesOf(argv);
  if (values.help) { console.log(USAGE); process.exit(0); }
  const script = SCRIPTS[values.script ?? "v0"];
  if (!script) usage(`--script is ${Object.keys(SCRIPTS).join(" or ")}, not ${values.script}`);
  const lines = Number(values.lines ?? script.lines);
  if (!Number.isInteger(lines) || lines < 1 || lines > script.steps.length) usage(`--lines takes 1 to ${script.steps.length} for ${script.name}`);
  const date = new Date().toISOString().slice(0, 10);
  return {
    script, lines, who: values.as ?? script.who, build: values.build ?? script.build,
    port: portOf(values.port, 3300, "--port"), aiPort: portOf(values["ai-port"], 8787, "--ai-port"), portsGiven: values.port !== undefined || values["ai-port"] !== undefined,
    ...(values.stack ? { stack: resolve(values.stack) } : {}),
    out: resolve(values.out ?? join(V2, "docs", "live", `${script.name}-${date}.md`)),
    budget: Number(values.budget ?? 0.1), rehearse: !!values.rehearse, date,
  };
}

function valuesOf(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      options: {
        script: { type: "string" }, lines: { type: "string" }, as: { type: "string" }, build: { type: "string" },
        port: { type: "string" }, "ai-port": { type: "string" }, stack: { type: "string" },
        out: { type: "string" }, budget: { type: "string" }, rehearse: { type: "boolean" }, help: { type: "boolean" },
      },
    }).values;
  } catch (e) {
    return usage((e as Error).message);
  }
}

function portOf(value: string | undefined, fallback: number, flag: string): number {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) usage(`${flag} is a port number, not ${value}`);
  return port;
}

function usage(why: string): never {
  console.error(`${why}\n\n${USAGE}`);
  process.exit(2);
}
