import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { newGameOf } from "../../client/backend.ts";
import { connect, type Connection } from "../../client/net/connection.ts";
import type { SceneRows } from "../../client/scene/rows.ts";
import { sql } from "../dev/spacetime.ts";
import type { StackFile } from "../dev/stack-file.ts";
import { byOperation, cell, modelsOf, settled, shown, writeRecord, type Call } from "./common.ts";

/**
 * V0's live run (v0-design §1.4, §10.6): a new game and a few scripted lines against the running dev
 * stack, recorded as Markdown: the transcript, each turn's timings (said, first words, the reply
 * final, the world settled) from the turn rows, and the model calls and their cost from the AI
 * service's call log. It stops before a line that would take the run past its budget, judging a
 * turn by the dearest so far.
 */

/** The lines, in order: a question, two checks (medicine, insight), a promise that wins Cob over, what it all means, and the boot. */
export const LINES = [
  "Sergeant, who found him?",
  "*I climb up on the cart and look closely at Prout's neck, the back of his head and his hands.*",
  "Moll, you never saw him jump, did you? Who paid you to say it?",
  "Cob, nobody's taking your boots, and your name stays out of anybody's book. I'll keep the men from the loft off you. What did you hear last night?",
  "*I turn to Kell.* He didn't hang himself. Someone strung him up after. We need to know why.",
  "Cob, may I see what's crackling in your left boot? It stays yours.",
];

export interface SceneFlags { lines: number; who: string; build: string; out: string; budget: number; rehearse: boolean; date: string }

export async function sceneRun(stack: StackFile, flags: SceneFlags): Promise<void> {
  const conn = await connect({ url: stack.ws, db: stack.db });
  const said: string[] = [];

  console.log(`The live run: ${flags.lines} lines against ${stack.http} (${stack.ai.model} model)`);
  await opening(conn, flags.who, flags.build);
  for (const line of LINES.slice(0, flags.lines)) {
    if (!affordable(conn, flags.budget)) break;
    await turn(conn, line);
    said.push(line);
  }

  const record = await recordOf(stack, conn, said);
  writeRecord(flags.out, markdownOf(record, flags));
  console.log(`\nRecorded ${shown(flags.out)}: ${record.turns.length} turns, ${record.calls.length} model calls, $${record.cost.toFixed(4)}`);
  conn.close();
}

// ---------------------------------------------------------------------------------------------
// Playing.

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

/** What the game's turns have cost so far, in dollars (each answer's usage, committed on its turn). */
function spent(conn: Connection): number {
  return turnsOf(conn).reduce((sum, t) => sum + Number(t.costMicros) / 1e6, 0);
}

/** Whether another line fits the budget, judging it by the dearest turn so far; says why not when it doesn't. */
function affordable(conn: Connection, budget: number): boolean {
  const left = budget - spent(conn);
  const dearest = Math.max(0, ...turnsOf(conn).map(t => Number(t.costMicros) / 1e6));
  if (dearest <= left) return true;
  console.log(`  stopping: the dearest turn so far ($${dearest.toFixed(4)}) is more than the $${left.toFixed(4)} left`);
  return false;
}

/** The turn rows as the client holds them: every column, though the view's type picks only some. */
function turnsOf(conn: Connection): Array<SceneRows["turns"][number] & { costMicros: bigint }> {
  return (conn.rows()?.turns ?? []) as Array<SceneRows["turns"][number] & { costMicros: bigint }>;
}

// ---------------------------------------------------------------------------------------------
// The record.

interface Turn { n: number; line?: string; saidAt: number; firstAt?: number; finalAt?: number; settledAt?: number; calls: number; cost: number }
interface Entry { turn: number; kind: string; speaker: string; text: string }
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
    .map(c => ({ key: String(c.key), game: uid, operation: String(c.operation), model: String(c.model ?? c.request.model ?? "?"), costUsd: c.costUsd, latencyMs: Number(c.latencyMs ?? 0) }));
}

function markdownOf(record: LiveRecord, options: SceneFlags): string {
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
    ...modelsOf(record.calls),
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

export function entryText(e: Entry): string {
  if (e.kind === "player") return `> **Turn ${e.turn}.** ${e.text}`;
  if (e.kind === "roll") return `*${e.text}*`;
  if (e.kind === "system") return `**— ${e.text} —**`;
  return e.text;
}

/** How long after the line was said, in seconds. */
function after(t: Turn, at: number | undefined): string {
  return at === undefined ? "" : `${((at - t.saidAt) / 1e6).toFixed(1)} s`;
}
