import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { connect } from "../client/net/connection.ts";
import { refuseTakenOut, writeRecord } from "./live/common.ts";
import { creationRun } from "./live/creation.ts";
import { playScript } from "./live/play.ts";
import { backgroundIn, offeredOf, recordOf, spentOf } from "./live/record.ts";
import { markdownOf } from "./live/report.ts";
import { SCRIPTS, type Script } from "./live/scripts.ts";
import { storyRun } from "./live/story.ts";
import { modelOf, runningStack } from "./live/stack.ts";
import { configureTerminal } from "./terminal.ts";

/**
 * The live runs (v0-design §1.4, §10.6; v5-design §4.6; v1-design §4.6; full-gm-design §1.5;
 * world-bridge-design §1.3), against
 * the running dev stack and its models, recorded as Markdown. A script's: a new game and its lines
 * (V0's six, V5's twelve, or the full GM's eight), each turn's timings (from the turn rows, and the
 * lines as they reached this client), who said what, the lines
 * offered and those screened out, the model calls and their cost (the AI service's call log), the
 * measures against the prototype's, what the scene holds back from the player, and for the full
 * GM's the GM's side (each line's memory review and co-GM review: npm run status), and for
 * the world bridge's the world's (each line's dice, what the place showed after, who reacted). V1's,
 * with --creation: three concepts' builds and Tamsin Vell made from a sentence through the lore
 * check to her first line (live/creation.ts). The whole story's, --script story: one game from the
 * yard to The End, each scene ended as the owner, so each boundary and opening is the models'
 * (live/story.ts).
 *
 *   npm run dev                                # real models, in another terminal
 *   npm run live -- --script v5               # writes docs/live/v5-<date>.md
 *   npm run live -- --script gm               # writes docs/live/gm-<date>.md
 *   npm run live -- --script world            # writes docs/live/world-<date>.md
 *   npm run live -- --script story            # writes docs/live/story-<date>.md
 *   npm run live -- --lines 4                 # V0's script: docs/live/v0-<date>.md
 *   npm run live -- --creation                # V1's run: docs/live/v1-<date>.md
 *
 * It finds the stack by its ports (the dev host's unless told) and stops before a step that would
 * take the run past its budget (--budget, $0.10), judging a step by the dearest so far. Neither run
 * writes over a record without being told to (--force: live/common.ts): a second run on the same day
 * is recorded beside the first (v5-<date>-2.md), an --out already there is refused before anything
 * is played, and a rehearsal on the fake model goes to runs/live/, which isn't committed.
 */

const USAGE = `npm run live [-- options]
  --creation         V1's run: three concepts' builds, then a character made through the lore check to a line
  --script v0|v5|gm|world|story
                     the lines to play (v0): V0's six, V5's twelve (two of them a suggested line picked),
                     the full GM's eight (two said once the memory review and the co-GM are done), or the
                     world bridge's eight spells and blows, with what the world showed after each; story: no
                     lines, the whole story from the yard to The End, each scene ended as the owner
  --lines <n>        how many of the script's lines (v0: 4; v5: 12; gm: 8; world: 5)
  --as "Name: concept" --build <id>   the character (the script's own)
  --port <n>         the dev stack's SpacetimeDB port (3300)
  --ai-port <n>      its AI service's port (8787)
  --stack <dir>      the dev stack's folder (else the one under runs/ on those ports)
  --out <file>       where the record goes (docs/live/<script>-<date>.md, or v1-<date>.md with --creation, or
                     beside it if that's there; a rehearsal's runs/live/<script>-<date>-rehearsal.md)
  --force            write over a record already there
  --budget <usd>     stop before a step that would spend past this (0.10)
  --rehearse         run against a stack on the fake model (the record says so)`;

const V2 = resolve(import.meta.dirname, "..");

main(flagsOf(process.argv.slice(2))).then(() => process.exit(0), (error: unknown) => {
  console.error(`The live run stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

async function main(flags: Flags): Promise<void> {
  refuseTakenOut(flags);
  configureTerminal(process.env);
  const stack = runningStack(join(V2, "runs"), flags);
  const model = await modelOf(stack, flags.rehearse);
  if (flags.creation) return await creationRun(stack, flags);
  if (flags.story) return await storyRun(stack, flags);
  const conn = await connect({ url: stack.ws, db: stack.db });

  console.log(`The live run: ${flags.script.name}, ${flags.lines} lines against ${stack.http} (${model} model)`);
  const run = await playScript(conn, flags.script, {
    who: flags.who, build: flags.build, lines: flags.lines, budget: flags.budget,
    spent: uid => spentOf(stack.root, uid), offered: scene => offeredOf(stack, scene), background: scene => backgroundIn(stack, scene),
    log: line => console.log(`  ${line}`),
  });
  if (run.stopped) console.log(`  stopped: ${run.stopped}`);
  if (!run.game) throw new Error(run.stopped ?? "the game didn't open");

  const record = await recordOf(stack, run, { script: flags.script, date: flags.date, rehearse: flags.rehearse, lines: flags.lines, model });
  const where = writeRecord(flags, markdownOf(record, commandOf(flags)));
  console.log(`\nRecorded ${where}: ${record.turns.length} turns, ${record.calls.length} model calls, $${record.cost.toFixed(4)}`);
  conn.close();
}

// ---------------------------------------------------------------------------------------------
// The record.

/** The command as it was typed, for the record: the flags that changed anything. */
function commandOf(flags: Flags): string {
  return ["npm run live --", `--script ${flags.script.name}`, `--lines ${flags.lines}`, ...(flags.portsGiven ? [`--port ${flags.port} --ai-port ${flags.aiPort}`] : []), ...(flags.rehearse ? ["--rehearse"] : [])].join(" ");
}

// ---------------------------------------------------------------------------------------------
// Flags.

interface Flags {
  /** V1's run (--creation) in place of a script's. */
  creation: boolean;
  /** The whole story's run (--script story) in place of a scene's script. */
  story: boolean;
  script: Script; lines: number; who: string; build: string;
  port: number; aiPort: number; portsGiven: boolean; stack?: string;
  out: string; outGiven: boolean; force: boolean; budget: number; rehearse: boolean; date: string;
}

function flagsOf(argv: string[]): Flags {
  const values = valuesOf(argv);
  if (values.help) { console.log(USAGE); process.exit(0); }
  const story = values.script === "story";
  // The story's run plays no scene's lines: its game and steps are its own (live/story.ts), as the gm script's character.
  const script = story ? { ...SCRIPTS.gm!, name: "story" } : SCRIPTS[values.script ?? "v0"];
  if (!script) usage(`--script is ${[...Object.keys(SCRIPTS), "story"].join(" or ")}, not ${values.script}`);
  const lines = Number(values.lines ?? script.lines);
  if (!story && (!Number.isInteger(lines) || lines < 1 || lines > script.steps.length)) usage(`--lines takes 1 to ${script.steps.length} for ${script.name}`);
  const date = new Date().toISOString().slice(0, 10);
  // A rehearsal's record isn't one to commit: it goes with the rest of the run output.
  const unit = values.creation ? "v1" : script.name;
  const record = values.rehearse ? join(V2, "runs", "live", `${unit}-${date}-rehearsal.md`) : join(V2, "docs", "live", `${unit}-${date}.md`);
  return {
    creation: !!values.creation, story, script, lines, who: values.as ?? script.who, build: values.build ?? script.build,
    port: portOf(values.port, 3300, "--port"), aiPort: portOf(values["ai-port"], 8787, "--ai-port"), portsGiven: values.port !== undefined || values["ai-port"] !== undefined,
    ...(values.stack ? { stack: resolve(values.stack) } : {}),
    out: resolve(values.out ?? record), outGiven: values.out !== undefined, force: !!values.force,
    budget: Number(values.budget ?? 0.1), rehearse: !!values.rehearse, date,
  };
}

function valuesOf(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      options: {
        creation: { type: "boolean" }, script: { type: "string" }, lines: { type: "string" }, as: { type: "string" }, build: { type: "string" },
        port: { type: "string" }, "ai-port": { type: "string" }, stack: { type: "string" },
        out: { type: "string" }, force: { type: "boolean" }, budget: { type: "string" }, rehearse: { type: "boolean" }, help: { type: "boolean" },
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
