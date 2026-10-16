import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { refuseTakenOut, runningStack } from "./live/common.ts";
import { creationRun } from "./live/creation.ts";
import { LINES, sceneRun } from "./live/scene.ts";

/**
 * The live runs (v0-design §1.4, §10.6; v1-design §4.6), against the running dev stack and its
 * models, recorded as Markdown in docs/live/: V0's, a new game and a few scripted lines
 * (live/scene.ts); V1's with --creation, three concepts' builds and Tamsin Vell made from a
 * sentence through the lore check to her first line (live/creation.ts). Each stops before a step
 * that would take it past its budget. Neither writes over a record without being told to (--force):
 * a second run on the same day is recorded beside the first (v1-<date>-2.md), an --out already
 * there is refused before anything is played, and a rehearsal on the fake model goes to runs/live/,
 * which isn't committed.
 *
 *   npm run dev                          # real models, in another terminal
 *   npm run live -- --lines 4            # writes docs/live/v0-<date>.md
 *   npm run live -- --creation           # writes docs/live/v1-<date>.md
 */

const USAGE = `npm run live [-- options]
  --creation         V1's run: three concepts' builds, then a character made through the lore check to a line
  --lines <n>        V0's run: how many of the scripted lines to say (4; at most ${LINES.length})
  --as "Name: concept" --build <id>   V0's character (Wren Ashdown, a hedge wizard from the fens; wizard)
  --stack <dir>      the running dev stack's folder (runs/dev)
  --out <file>       where the record goes (docs/live/v0-<date>.md, or v1-<date>.md with --creation, or beside it
                     if that's there; a rehearsal's runs/live/v0-<date>-rehearsal.md)
  --force            write over a record already there
  --budget <usd>     stop before a step that would spend past this (0.10)
  --rehearse         run against a stack on the fake model (the record says so)`;

main(process.argv.slice(2)).then(() => process.exit(0), (error: unknown) => {
  console.error(`The live run stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

async function main(argv: string[]): Promise<void> {
  const flags = flagsOf(argv);
  refuseTakenOut(flags);
  const stack = runningStack(flags.stack, flags.rehearse);
  if (flags.creation) await creationRun(stack, flags);
  else await sceneRun(stack, flags);
}

function flagsOf(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      creation: { type: "boolean" }, lines: { type: "string" }, as: { type: "string" }, build: { type: "string" }, stack: { type: "string" },
      out: { type: "string" }, force: { type: "boolean" }, budget: { type: "string" }, rehearse: { type: "boolean" }, help: { type: "boolean" },
    },
  });
  if (values.help) { console.log(USAGE); process.exit(0); }
  const date = new Date().toISOString().slice(0, 10);
  const lines = Number(values.lines ?? 4);
  if (!Number.isInteger(lines) || lines < 1 || lines > LINES.length) throw new Error(`--lines takes 1 to ${LINES.length}`);
  // A rehearsal's record isn't one to commit: it goes with the rest of the run output.
  const unit = values.creation ? "v1" : "v0";
  const record = values.rehearse ? join("runs", "live", `${unit}-${date}-rehearsal.md`) : join("docs", "live", `${unit}-${date}.md`);
  return {
    creation: !!values.creation, lines, who: values.as ?? "Wren Ashdown: a hedge wizard from the fens", build: values.build ?? "wizard",
    stack: resolve(values.stack ?? join("runs", "dev")),
    out: resolve(values.out ?? record), outGiven: values.out !== undefined, force: !!values.force,
    budget: Number(values.budget ?? 0.1), rehearse: !!values.rehearse, date,
  };
}
