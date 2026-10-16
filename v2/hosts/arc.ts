// The checks' words are the prototype's src/app/smoke/flow.ts at 44c6d4a (its sixteen asserts, in order); the run around them is v2's: a stack of its own, play new, and each check on once its vertical lands.
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { newGameOf, type HomeRows } from "../client/backend.ts";
import * as verbs from "../client/headless.ts";
import { connect, type Connection } from "../client/net/connection.ts";
import type { Mode } from "./dev/mode.ts";
import { startStack, type Stack } from "./dev/stack.ts";

/**
 * The arc check (verticals.md §2, v1-design §4.5): the prototype's whole-arc check
 * (src/app/smoke/flow.ts at 44c6d4a) on the split. A stack of its own on the fake model, the
 * headless client's `play new` as the prototype's flow makes its character (a sentence, no build:
 * the model picks one), then the flow's sixteen checks in its order, each on once the vertical that
 * brings it has landed. The rest say which unit turns them on. Exits 0 when every check that's on
 * passes.
 *
 *   npm run arc [-- --port 3320] [--ai-port 8807] [--root runs/arc] [--mode host|namespace]
 */

const USAGE = `npm run arc [-- options]
  --port <n>            SpacetimeDB's port (3320)
  --ai-port <n>         the AI service's port (8807)
  --root <dir>          the stack's folder (runs/arc): emptied at the start, but for its keys
  --mode host|namespace detected when absent: host when 11.0.0.1 is on this machine`;

/** The prototype's flow's character (flow.ts:31). */
const WHO = "Tamsin Vell: a disgraced palace auditor with a ledger-keeper's eye, a sharp tongue and a borrowed rapier";

/** What a check reads: the player's rows once the game is made and begun. */
interface Arc { conn: Connection; home: HomeRows }

/** One of the flow's checks: what it holds, the unit that turns it on, and, once on, what it found (or undefined when it doesn't hold). */
interface ArcCheck { what: string; unit: string; run?(arc: Arc): string | undefined }

/** The flow's sixteen, in its order (append-only: a vertical gives a check its `run`). */
const CHECKS: ArcCheck[] = [
  { what: "the character is built by the rules engine", unit: "V1", run: builtByTheEngine },
  { what: "the story starts in the morning, heading for the granary", unit: "V2" },
  { what: "observe: the lane by the granary gate, Kell to talk to", unit: "V2" },
  { what: "the granary yard opens the hanged clerk", unit: "V2" },
  { what: "the scene's place is drawn with the player in it", unit: "V9" },
  { what: "on to the Drowned Rat at dusk", unit: "V3" },
  { what: "Kell walks with the investigator", unit: "V3" },
  { what: "down the river stairs and into the Rat", unit: "V3" },
  { what: "on to the Heron at night", unit: "V4" },
  { what: "along the wharf to the Heron", unit: "V4" },
  { what: "Roll for initiative!", unit: "V12" },
  { what: "Sallow and the Crakes are in the fight", unit: "V12" },
  { what: "after the fight, back to the Heron for its aftermath", unit: "V12" },
  { what: "the King's morning opens straight away", unit: "V4" },
  { what: "The End", unit: "V4" },
  { what: "observe says The End", unit: "V4" },
];

/** Check 1 (flow.ts:32): the sheet's build line is the engine's ("<species> <class> 3 (<subclass>), <background> background"), and its status line its HP. */
function builtByTheEngine({ home }: Arc): string | undefined {
  const build = home.sheet?.build ?? "", status = home.sheet?.statusLine ?? "";
  return /^\S+ \S+ 3 \([^)]+\), .+ background$/.test(build) && status.startsWith("HP ") ? `${build}: ${status}` : undefined;
}

const flags = flagsOf(process.argv.slice(2));

console.log(`The arc: the prototype's flow on the split (ports ${flags.port} and ${flags.aiPort}, ${flags.root})`);
const stack = await startStack({
  root: flags.root, stdbPort: flags.port, aiPort: flags.aiPort, ...(flags.mode ? { mode: flags.mode } : {}),
  model: "fake", fake: { streamMs: 0 }, fresh: true, log: line => console.log(`  … ${line}`),
}).catch((error: unknown) => {
  console.error(`\n✗ the stack didn't start: ${error instanceof Error ? error.message : String(error)}\nFAIL`);
  process.exit(1);
});

let failed = 0;
try {
  const arc = await theStory(stack);
  failed = checked(arc);
  arc.conn.close();
} catch (error) {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  console.error(`  The logs are in ${flags.root}/logs.`);
  failed = 1;
} finally {
  await stack.down();
}

const on = CHECKS.filter(c => c.run).length;
console.log(failed ? `\nFAIL: ${failed} of the ${on} checks on` : `\nPASS: ${on} of ${CHECKS.length} checks on, the rest skipped until the units that bring them`);
process.exit(failed ? 1 : 0);

// ---------------------------------------------------------------------------------------------

/** The campaign installed, then play new as the flow makes its character: the game made and begun. */
async function theStory(stack: Stack): Promise<Arc> {
  await stack.install(join(import.meta.dirname, "..", "campaigns", "caerwyn"));
  const conn = await connect({ url: stack.ws, db: stack.db });
  const who = newGameOf(WHO, "", "caerwyn");
  const printed: string[] = [];
  const code = await verbs.newCharacter(conn, { campaign: who.campaign, name: who.name, concept: who.concept }, { print: text => printed.push(text), progress: () => {} });
  console.log(`\nplay new --as "${WHO}"\n${printed.join("\n").replace(/^/gm, "  | ")}\n`);
  if (code !== 0) throw new Error(`play new exited ${code}`);
  return { conn, home: conn.home() };
}

/** Each check in turn: "ok" or "FAIL" for those on, "skip" with the unit for the rest. How many failed. */
function checked(arc: Arc): number {
  let failures = 0;
  CHECKS.forEach((c, i) => {
    if (!c.run) return console.log(`skip: ${i + 1}. ${c.what} (${c.unit})`);
    const found = c.run(arc);
    if (!found) failures++;
    console.log(found ? `ok: ${i + 1}. ${c.what} (${found})` : `FAIL: ${i + 1}. ${c.what}`);
  });
  return failures;
}

function flagsOf(argv: string[]): { port: number; aiPort: number; root: string; mode?: Mode } {
  const { values } = parseArgs({ args: argv, options: { port: { type: "string" }, "ai-port": { type: "string" }, root: { type: "string" }, mode: { type: "string" }, help: { type: "boolean" } } });
  if (values.help) { console.log(USAGE); process.exit(0); }
  const mode = values.mode;
  if (mode !== undefined && mode !== "host" && mode !== "namespace") { console.error(`--mode ${mode}: host or namespace\n${USAGE}`); process.exit(2); }
  return {
    port: Number(values.port ?? 3320), aiPort: Number(values["ai-port"] ?? 8807), root: resolve(values.root ?? join("runs", "arc")),
    ...(mode ? { mode } : {}),
  };
}
