import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { newGameOf } from "../client/backend.ts";
import { connect, type Connection } from "../client/net/connection.ts";
import type { SceneRows } from "../client/scene/rows.ts";
import { sql } from "./dev/spacetime.ts";
import { readStackFile, type StackFile } from "./dev/stack-file.ts";

/**
 * The live run (v0-design §1.4, §10.6): a new game and a few scripted lines against the running dev
 * stack, with the models it runs, recorded as Markdown: the transcript, each turn's timings (said,
 * first words, the reply final, the world settled) from the turn rows, and the model calls and their
 * cost from the AI service's call log.
 *
 *   npm run dev                       # real models, in another terminal
 *   npm run live -- --lines 4         # writes docs/live/v0-<date>.md
 *
 * It stops before a line that would take the run past its budget (--budget, $0.10), judging a turn
 * by the dearest so far.
 */

/** The lines, in order: a question, two checks (medicine, insight), a promise that wins Cob over, what it all means, and the boot. */
const LINES = [
  "Sergeant, who found him?",
  "*I climb up on the cart and look closely at Prout's neck, the back of his head and his hands.*",
  "Moll, you never saw him jump, did you? Who paid you to say it?",
  "Cob, nobody's taking your boots, and your name stays out of anybody's book. I'll keep the men from the loft off you. What did you hear last night?",
  "*I turn to Kell.* He didn't hang himself. Someone strung him up after. We need to know why.",
  "Cob, may I see what's crackling in your left boot? It stays yours.",
];

const USAGE = `npm run live [-- options]
  --lines <n>        how many of the scripted lines to say (4; at most ${LINES.length})
  --as "Name: concept" --build <id>   the character (Wren Ashdown, a hedge wizard from the fens; wizard)
  --stack <dir>      the running dev stack's folder (runs/dev)
  --out <file>       where the record goes (docs/live/v0-<date>.md)
  --budget <usd>     stop before a line that would spend past this (0.10)
  --rehearse         run against a stack on the fake model (the record says so)`;

const flags = flagsOf(process.argv.slice(2));

const stack = runningStack(flags.stack, flags.rehearse);
const conn = await connect({ url: stack.ws, db: stack.db });
const said: string[] = [];

console.log(`The live run: ${flags.lines} lines against ${stack.http} (${stack.ai.model} model)`);
await opening(conn, flags.who, flags.build);
for (const line of LINES.slice(0, flags.lines)) {
  const left = flags.budget - spent(conn);
  if (dearestTurn(conn) > left) { console.log(`  stopping: the dearest turn so far ($${dearestTurn(conn).toFixed(4)}) is more than the $${left.toFixed(4)} left`); break; }
  await turn(conn, line);
  said.push(line);
}

const record = await recordOf(stack, conn, said);
writeRecord(flags.out, markdownOf(record, flags));
console.log(`\nRecorded ${shown(flags.out)}: ${record.turns.length} turns, ${record.calls.length} model calls, $${record.cost.toFixed(4)}`);
conn.close();
process.exit(0);

// ---------------------------------------------------------------------------------------------
// Playing.

/** The dev stack stack.json describes, on real models unless this is a rehearsal. */
function runningStack(root: string, rehearse: boolean): StackFile {
  const stack = readStackFile(root);
  if (!stack?.pids.stdb || !stack.pids.ai) throw new Error(`there's no dev stack running from ${root}: start one with npm run dev`);
  if (stack.ai.model !== "openrouter" && !rehearse) throw new Error("the dev stack runs the fake model: start it with real models (npm run dev), or pass --rehearse to try this run on the fake");
  return stack;
}

async function opening(conn: Connection, who: string, build: string): Promise<void> {
  const refused = await conn.newGame(newGameOf(who, build, "caerwyn"));
  if (refused) throw new Error(`new_game was refused: ${refused.text}`);
  await settled(conn, 0);
  console.log(`  the opening: game ${conn.rows()!.game.id}`);
}

/** A line said, and its turn waited for until the world has settled behind the reply. */
async function turn(conn: Connection, line: string): Promise<void> {
  const n = (conn.rows()!.turns.reduce((m, t) => Math.max(m, t.n), 0)) + 1;
  const refused = await conn.say(line);
  if (refused) throw new Error(`"${line}" was refused: ${refused.text}`);
  await settled(conn, n);
  console.log(`  turn ${n}: done ($${spent(conn).toFixed(4)} so far)`);
}

/** Resolves once turn n is done; throws if it fails, or takes more than three minutes. */
function settled(conn: Connection, n: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const look = () => {
      const phase = conn.rows()?.turns.find(t => t.n === n)?.phase;
      if (phase !== "done" && phase !== "failed") return;
      clearTimeout(timer);
      stop();
      if (phase === "done") resolve();
      else reject(new Error(`turn ${n} failed: ${conn.rows()!.turns.find(t => t.n === n)!.error}`));
    };
    const timer = setTimeout(() => { stop(); reject(new Error(`turn ${n} wasn't done in three minutes`)); }, 180_000);
    const stop = conn.onChange(look);
    look();
  });
}

/** What the game's turns have cost so far, in dollars (each answer's usage, committed on its turn). */
function spent(conn: Connection): number {
  return turnsOf(conn).reduce((sum, t) => sum + Number(t.costMicros) / 1e6, 0);
}

function dearestTurn(conn: Connection): number {
  return Math.max(0, ...turnsOf(conn).map(t => Number(t.costMicros) / 1e6));
}

/** The turn rows as the client holds them: every column, though the view's type picks only some. */
function turnsOf(conn: Connection): Array<SceneRows["turns"][number] & { costMicros: bigint }> {
  return (conn.rows()?.turns ?? []) as Array<SceneRows["turns"][number] & { costMicros: bigint }>;
}

// ---------------------------------------------------------------------------------------------
// The record.

interface Turn { n: number; line?: string; saidAt: number; firstAt?: number; finalAt?: number; settledAt?: number; calls: number; cost: number }
interface Entry { turn: number; kind: string; speaker: string; text: string }
interface Call { key: string; operation: string; model: string; costUsd: number; latencyMs: number }
interface LiveRecord { game: string; mode: string; who: string; build: string; turns: Turn[]; transcript: Entry[]; calls: Call[]; cost: number }

/** The game's rows as the owner reads them (times in microseconds), and its model calls from the AI service's call log. */
async function recordOf(stack: StackFile, conn: Connection, lines: string[]): Promise<LiveRecord> {
  const scene = conn.rows()!.scene.id, game = conn.rows()!.game.id;
  const query = (q: string) => sql(stack.http, q, stack.owner.token);
  const [uidRow] = await query(`SELECT uid FROM game WHERE id = ${game}`);
  const uid = String(uidRow!.uid);
  const entries = (await query(`SELECT * FROM transcript WHERE scene_id = ${scene}`)).sort((a, b) => Number(a.seq) - Number(b.seq));
  const turns = (await query(`SELECT * FROM turn WHERE scene_id = ${scene}`)).sort((a, b) => Number(a.n) - Number(b.n));
  const [player] = await query(`SELECT * FROM player WHERE game_id = ${game}`);
  const [sheet] = await query(`SELECT * FROM sheet WHERE game_id = ${game}`);

  return {
    game: uid, mode: stack.mode, who: `${player!.name}: ${player!.concept}`, build: String(sheet!.build),
    turns: turns.map(t => turnOf(t, entries, lines)),
    transcript: entries.map(e => ({ turn: Number(e.turn), kind: String(e.kind), speaker: String(e.speaker), text: String(e.text) })),
    calls: callsOf(stack.root, uid),
    cost: turns.reduce((sum, t) => sum + Number(t.cost_micros) / 1e6, 0),
  };
}

/** A turn's timings: said (the turn's start), first words, the reply final (its entry's time), settled (the turn's end). */
function turnOf(t: Record<string, unknown>, entries: Array<Record<string, unknown>>, lines: string[]): Turn {
  const n = Number(t.n);
  const reply = entries.find(e => Number(e.turn) === n && e.speaker === "gm");
  return {
    n, ...(n > 0 && lines[n - 1] ? { line: lines[n - 1] } : {}),
    saidAt: Number(t.started_at),
    ...(t.first_text_at !== null ? { firstAt: Number(t.first_text_at) } : {}),
    ...(reply ? { finalAt: Number(reply.at) } : {}),
    ...(t.ended_at !== null ? { settledAt: Number(t.ended_at) } : {}),
    calls: Number(t.calls), cost: Number(t.cost_micros) / 1e6,
  };
}

/** The model calls the AI service made for the game, done (its call log's entries with a cost). */
function callsOf(root: string, uid: string): Call[] {
  const path = join(root, "ai", "games", uid, "calls.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, any>)
    .filter(c => c.request && typeof c.costUsd === "number")
    .map(c => ({ key: String(c.key), operation: String(c.operation), model: String(c.model ?? c.request.model ?? "?"), costUsd: c.costUsd, latencyMs: Number(c.latencyMs ?? 0) }));
}

function markdownOf(record: LiveRecord, options: Flags): string {
  const models = [...new Set(record.calls.map(c => `${c.operation.replace(/^memory\.disclose\..*/, "memory.disclose.*")}: ${c.model}`))].sort();
  return [
    `# V0 live run, ${options.date}`,
    "",
    `The hanged clerk's scene through V0's split (client, SpacetimeDB, the AI service) with ${options.rehearse ? "**the fake model: a rehearsal, not a live run**" : "real models"}: \`npm run dev\` in ${record.mode} mode, then \`npm run live -- --lines ${options.lines}\` (hosts/live-run.ts wrote this file).`,
    "",
    "| | |",
    "|---|---|",
    `| Character | ${record.who} (${record.build}) |`,
    `| Turns | ${record.turns.length}: the opening and ${record.turns.length - 1} lines |`,
    `| Model calls | ${record.calls.length} |`,
    `| Cost | $${record.cost.toFixed(4)} (each answer's usage, as committed on its turn) |`,
    `| Game | ${record.game} |`,
    "",
    "## The turns",
    "",
    "Times from the line being said (the turn row's start): its first words in the draft, the reply final (its transcript entry), and the world settled behind it (the turn done).",
    "",
    "| Turn | Line | First words | Reply final | Settled | Calls | Cost |",
    "|---|---|---|---|---|---|---|",
    ...record.turns.map(t => `| ${t.n} | ${t.n === 0 ? "(the opening)" : cell(t.line ?? "")} | ${after(t, t.firstAt)} | ${after(t, t.finalAt)} | ${after(t, t.settledAt)} | ${t.calls} | $${t.cost.toFixed(4)} |`),
    "",
    "## The models",
    "",
    ...models.map(m => `- ${m}`),
    "",
    "## Calls by operation",
    "",
    "| Operation | Calls | Cost | Median time |",
    "|---|---|---|---|",
    ...byOperation(record.calls),
    "",
    "## The transcript",
    "",
    ...record.transcript.flatMap(e => [entryText(e), ""]),
  ].join("\n");
}

function byOperation(calls: Call[]): string[] {
  const groups = new Map<string, Call[]>();
  for (const c of calls) groups.set(c.operation, [...(groups.get(c.operation) ?? []), c]);
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([operation, cs]) => {
    const times = cs.map(c => c.latencyMs).sort((a, b) => a - b);
    return `| ${operation} | ${cs.length} | $${cs.reduce((s, c) => s + c.costUsd, 0).toFixed(4)} | ${(times[Math.floor(times.length / 2)]! / 1000).toFixed(1)} s |`;
  });
}

function entryText(e: Entry): string {
  if (e.kind === "player") return `> **Turn ${e.turn}.** ${e.text}`;
  if (e.kind === "roll") return `*${e.text}*`;
  if (e.kind === "system") return `**— ${e.text} —**`;
  return e.text;
}

/** How long after the line was said, in seconds. */
function after(t: Turn, at: number | undefined): string {
  return at === undefined ? "" : `${((at - t.saidAt) / 1e6).toFixed(1)} s`;
}

/** Text for a table's cell: its bars escaped. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|");
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

interface Flags { lines: number; who: string; build: string; stack: string; out: string; budget: number; rehearse: boolean; date: string }

function flagsOf(argv: string[]): Flags {
  const { values } = parseArgs({
    args: argv,
    options: { lines: { type: "string" }, as: { type: "string" }, build: { type: "string" }, stack: { type: "string" }, out: { type: "string" }, budget: { type: "string" }, rehearse: { type: "boolean" }, help: { type: "boolean" } },
  });
  if (values.help) { console.log(USAGE); process.exit(0); }
  const date = new Date().toISOString().slice(0, 10);
  const lines = Number(values.lines ?? 4);
  if (!Number.isInteger(lines) || lines < 1 || lines > LINES.length) throw new Error(`--lines takes 1 to ${LINES.length}`);
  return {
    lines, who: values.as ?? "Wren Ashdown: a hedge wizard from the fens", build: values.build ?? "wizard",
    stack: resolve(values.stack ?? join("runs", "dev")), out: resolve(values.out ?? join("docs", "live", `v0-${date}.md`)),
    budget: Number(values.budget ?? 0.1), rehearse: !!values.rehearse, date,
  };
}
