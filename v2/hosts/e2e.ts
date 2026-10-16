import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { FakeOptions } from "../ai/llm/fake-openrouter.ts";
import { connect, type Connection, type RowOp, type Watched } from "../client/net/connection.ts";
import type { SceneRows } from "../client/scene/rows.ts";
import { idempotencyKey, type Step } from "../shared/protocol/keys.ts";
import { run } from "./dev/child.ts";
import { reportLines } from "./dev/doctor.ts";
import type { Mode } from "./dev/mode.ts";
import { startStack, type Stack } from "./dev/stack.ts";

/**
 * The end to end test (v0-design §10.4): a line in a scene through every part. A real SpacetimeDB
 * with the module, the AI service as a node process on the fake model, and two clients on the
 * client's own connection, recording every row event they see; then the three kills: the AI service
 * mid-reply, the AI service after it kept an answer, and SpacetimeDB mid-think. Host mode in CI;
 * namespace mode where 11.0.0.1 isn't this machine's.
 *
 *   npm run e2e [-- --port 3310] [--ai-port 8797] [--root runs/e2e] [--mode host|namespace]
 *
 * Exits 0 when every step passed. At the first that doesn't, it says what it saw, stops the stack and
 * exits 1, leaving the logs in the root (logs/, and ai/games/<uid>/calls.jsonl for the model calls).
 */

const USAGE = `npm run e2e [-- options]
  --port <n>            SpacetimeDB's port (3310)
  --ai-port <n>         the AI service's port (8797)
  --root <dir>          the stack's folder (runs/e2e): emptied at the start, but for its keys
  --mode host|namespace detected when absent: host when 11.0.0.1 is on this machine`;

/** The fake model's words, a sentence or two each, streamed over 2 s so that a draft grows in several posts. */
const FAKE: FakeOptions = {
  streamMs: 2_000,
  replies: [
    "Sergeant Kell looks up from her notebook as you come through the gate, and nods at the shape under the sacking. “You'll be the King's investigator. That's Wendell Prout. The Captain says he hanged himself.”",
    "Kell taps her pencil on the notebook and looks up at the loft door, barred on the inside. “The boy found him. Cob. Says he didn't, mind, but he did.”",
    "Moll spits from the top of the wall. “Saw him jump, didn't I? Clear as day.” Cob says nothing, and keeps his left boot out of sight.",
    "The yard goes quiet but for the drip from the gutter. Kell writes something down, and underlines it twice.",
  ],
};
const NEW_GAME = { campaign: "caerwyn", name: "Wren Ashdown", concept: "a quick-witted investigator lent to the case by the King", build: "ranger" };
const NOTE = "The GM has lost the thread for a moment: trying again.";

/** A client and every row event it has seen, in the order it saw them. */
interface Player { name: string; conn: Connection; events: Array<{ table: Watched; op: RowOp; row: any }> }

/** The game the steps play: its row id, its uid (in every key and the AI service's folders) and its scene. */
interface Game { id: bigint; uid: string; scene: bigint }

/** A check that didn't pass, in the words of what it looked for. */
class Failed extends Error {}

const flags = flagsOf(process.argv.slice(2));
const began = performance.now();

console.log(`The e2e: a line in a scene, end to end (ports ${flags.port} and ${flags.aiPort}, ${flags.root})`);
const stack = await startStack({
  root: flags.root, stdbPort: flags.port, aiPort: flags.aiPort, ...(flags.mode ? { mode: flags.mode } : {}),
  model: "fake", fake: FAKE, fresh: true, log: line => console.log(`  … ${line}`),
});

let passed = false;
try {
  await installedAndWell(stack);

  const a = await player(stack, "A"), b = await player(stack, "B");
  const game = await theOpening(stack, a);
  await aTurnBothSee(a, b);
  await killedMidReply(stack, a, game);
  await keptAnswer(stack, a, game);
  await spacetimeRestarted(stack, a, game);
  await anEnding(stack, a, b, game);
  await latencies(stack);

  a.conn.close();
  b.conn.close();
  passed = true;
} catch (error) {
  console.error(`\n✗ ${error instanceof Failed ? error.message : error instanceof Error ? error.stack : String(error)}`);
  console.error(`  The logs are in ${flags.root}: logs/spacetime.log, logs/ai.log, logs/dev.log, ai/games/<uid>/calls.jsonl.`);
} finally {
  await stack.down();
}

console.log(passed ? `\nPASS: every step, in ${seconds(performance.now() - began)}` : "\nFAIL");
process.exit(passed ? 0 : 1);

// ---------------------------------------------------------------------------------------------
// The steps (§10.4).

/** 1. The stack is up (--fresh); the campaign goes into both; the doctor finds all well. */
async function installedAndWell(stack: Stack): Promise<void> {
  step(`1. Up in ${stack.mode} mode, the campaign installed, the doctor`);
  const installed = await stack.install(join(import.meta.dirname, "..", "campaigns", "caerwyn"));
  ok(`${installed.id} installed in both`);
  const report = await stack.doctor({ campaign: installed.id });
  if (!report.ok) console.log(reportLines(report).join("\n"));
  check(`the doctor finds all well: ${report.summary}`, report.ok);
}

/** 2. A's new game: the opening streams into its draft before its entry lands, and the scene goes live. */
async function theOpening(stack: Stack, a: Player): Promise<Game> {
  step("2. A new game, its opening streamed");
  check("A's new_game is made", (await a.conn.newGame(NEW_GAME)) === undefined);
  const rows = await until(a, "the scene to go live", 60_000, r => r.scene.status === "live" && r);
  const entry = a.events.findIndex(e => e.table === "transcript" && e.op === "insert" && e.row.turn === 0);
  const drafts = a.events.slice(0, entry).filter(e => e.table === "reply_draft" && e.op !== "delete").length;
  check(`A saw the opening's draft grow (${drafts} posts) before its entry landed`, entry >= 0 && drafts >= 2);
  ok(`game ${rows.game.id}, its scene live`);
  return gameOf(stack, rows);
}

/** 3. B watches: A's line, A's second at once refused, B's refused; both clients see the turn's rows alike. */
async function aTurnBothSee(a: Player, b: Player): Promise<void> {
  step("3. A spectator joins; a turn both clients see alike");
  const game = a.conn.rows()!.game.id;
  check("B's join_game is made", (await b.conn.joinGame(game)) === undefined);
  await until(b, "B to see the scene", 10_000, r => r.scene.status === "live" && r.transcript.length > 0);
  const from = { a: a.events.length, b: b.events.length };

  const n = nextTurn(a);
  check("A says a line", (await a.conn.say("Sergeant, who found him?")) === undefined);
  check("A's second line at once is refused: turn_in_flight", (await a.conn.say("And when?"))?.code === "turn_in_flight");
  check("B's line is refused: not_controller", (await b.conn.say("Who are you, then?"))?.code === "not_controller");
  await doneTurn(a, n);
  await until(b, `B to see turn ${n} done`, 10_000, r => turnOf(r, n)?.phase === "done");
  await pause(500);

  const seenA = turnEvents(a.events.slice(from.a), n), seenB = turnEvents(b.events.slice(from.b), n);
  check(`A and B saw the same ${seenA.length} row events for the turn (its phases, the draft's posts, the entries)`, seenA.length > 5 && JSON.stringify(seenA) === JSON.stringify(seenB));
}

/** 4. The AI service killed mid-reply, then started again: the reply streams again as a later attempt, at the cost of a second model call. */
async function killedMidReply(stack: Stack, a: Player, game: Game): Promise<void> {
  step("4. The AI service killed mid-reply");
  const slow = { ...FAKE, streamMs: 3_000 };
  await restartAi(stack, slow);
  const n = nextTurn(a);
  check("A says a line", (await a.conn.say("*I look up at the loft door.* Who barred that?")) === undefined);
  const turn = await until(a, "the reply's first draft", 30_000, r => { const t = turnOf(r, n); return t && r.drafts.some(d => d.turnId === t.id) && t.id; });

  await stack.ai.stop("SIGKILL");
  ok("the AI service is killed (SIGKILL) at the reply's first draft");
  const note = await until(a, "the turn's note", 30_000, r => turnOf(r, n)?.note);
  check(`the turn's note says "${note}"`, note === NOTE);
  await stack.ai.start({ KM_AI_FAKE: JSON.stringify(slow) });
  ok("the AI service is started again");

  const rows = await doneTurn(a, n);
  const attempts = [...new Set(a.events.filter(e => e.table === "reply_draft" && e.op !== "delete" && e.row.turnId === turn).map(e => e.row.attempt as number))];
  check(`the draft started again as a later attempt (attempts ${attempts.join(", ")})`, Math.max(...attempts) >= 2);
  check("the turn has one GM entry", rows.transcript.filter(t => t.turn === n && t.speaker === "gm").length === 1);
  const replies = modelCalls(game, "gm.reply", keyOf(game, n, "reply"));
  check(`gm.reply was asked ${replies} times for the reply's key: the killed one, and the one that finished`, replies === 2);
}

/** 5. The AI service exits right after it stores the settle's answer: started again, it answers from the store. */
async function keptAnswer(stack: Stack, a: Player, game: Game): Promise<void> {
  step("5. The AI service gone after it kept an answer");
  await restartAi(stack, FAKE, { KM_AI_FAULTS: "exit-after-store:settle" });
  const n = nextTurn(a);
  check("A says a line", (await a.conn.say("Moll, come down off that wall and tell it again.")) === undefined);
  const code = await stack.ai.exited();
  check(`the AI service exited (${code}) right after it stored the settle's answer`, code === 137);
  await stack.ai.start();
  ok("the AI service is started again, without the fault");

  await doneTurn(a, n);
  const key = keyOf(game, n, "settle");
  check("the AI service answered the settle from its store", new RegExp(`settle ${escaped(key)} attempt \\d+: 200 from the store`).test(aiLog()));
  const staged = modelCalls(game, "world.stage", key);
  check(`world.stage was asked ${staged} time for the settle's key`, staged === 1);
}

/** 6. SpacetimeDB stopped and started a second into a slow decide: the reaper re-dispatches it, and the AI service's kept answer carries the turn on. */
async function spacetimeRestarted(stack: Stack, a: Player, game: Game): Promise<void> {
  step("6. SpacetimeDB restarted mid-think");
  await restartAi(stack, { ...FAKE, decisionDelayMs: 3_000 });
  const n = nextTurn(a);
  const said = performance.now();
  check("A says a line", (await a.conn.say("Cob, what did you hear last night?")) === undefined);
  await until(a, `turn ${n} deciding`, 10_000, r => turnOf(r, n)?.phase === "deciding");
  await pause(1_000);

  await stack.stdb.stop();
  await stack.stdb.start();
  ok("SpacetimeDB stopped and started again on its data, a second into the decide");
  await doneTurn(a, n, 60_000 - (performance.now() - said));
  ok(`${seconds(performance.now() - said)} from the line to the turn's end, A's connection back by itself`);

  const asked = modelCalls(game, "director.before", keyOf(game, n, "decide"));
  check(`director.before was asked ${asked} time for the decide's key`, asked === 1);
  check("the module logged the decide re-dispatched after its deadline", /re-dispatched after its deadline/.test(await moduleLog(stack)));
}

/** 7. A line that makes the case: the ending is the player's own, the next line winds down, the scene ends, and a further line is refused. */
async function anEnding(stack: Stack, a: Player, b: Player, game: Game): Promise<void> {
  step("7. An ending");
  await restartAi(stack, { ...FAKE, choices: { outcome: "make-case", own_exit: "theirs" } });
  check("A says the line that makes the case", (await a.conn.say("The cord mark, the barred door and Cob's page: Prout was murdered for what he found. That's the case made. We take it to the King.")) === undefined);
  await until(a, "the scene to close", 60_000, r => r.scene.status === "closing");
  ok("the scene is closing: the ending is the player's own, with one wind-down turn to go");

  const n = nextTurn(a);
  check("A says the wind-down line", (await a.conn.say("*to Kell, at the gate* Coming, Sergeant?")) === undefined);
  const rows = await until(a, "the scene to end", 60_000, r => r.scene.status === "ended" && r);
  const last = [...rows.transcript].sort((x, y) => x.seq - y.seq).at(-1)!;
  check(`"${last.text}" closes the transcript`, last.kind === "system" && last.text === "Scene ends: The case is made");
  check("the GM closed it with gm.closing", modelCalls(game, "gm.closing", keyOf(game, n, "reply")) === 1);
  check("a further line is refused: scene_over", (await a.conn.say("Wait!"))?.code === "scene_over");
  await until(b, "B to see the scene end", 10_000, r => r.scene.status === "ended");
  ok("B saw it end too");
}

/** 8. Each turn's first words and its end, from the turn rows. */
async function latencies(stack: Stack): Promise<void> {
  step("8. Each turn's first words, from the turn rows");
  const turns = (await stack.sql("SELECT * FROM turn")).sort((x, y) => Number(x.n) - Number(y.n));
  for (const t of turns) {
    const from = Number(t.started_at);
    const first = t.first_text_at === null ? "no text" : `first words ${millis(Number(t.first_text_at) - from)}`;
    const done = t.ended_at === null ? "" : `, done ${millis(Number(t.ended_at) - from)}`;
    console.log(`  turn ${t.n}: ${first}${done} (${t.phase}, ${t.calls} model calls)`);
  }
}

// ---------------------------------------------------------------------------------------------
// Players, and waiting on their rows.

async function player(stack: Stack, name: string): Promise<Player> {
  const conn = await connect({ url: stack.ws, db: stack.db });
  const events: Player["events"] = [];
  conn.onEvent((table, op, row) => events.push({ table, op, row }));
  return { name, conn, events };
}

/** Resolves with what `test` finds in the player's rows, once it finds it; a Failed after `ms`. */
function until<T>(p: Player, what: string, ms: number, test: (rows: SceneRows) => T | undefined | null | false | 0): Promise<T> {
  return new Promise((resolve, reject) => {
    const look = () => {
      const rows = p.conn.rows();
      const found = rows && test(rows);
      if (!found) return;
      clearTimeout(timer);
      stop();
      resolve(found);
    };
    const timer = setTimeout(() => { stop(); reject(new Failed(`${p.name} waited ${seconds(ms)} for ${what}; its last turn: ${JSON.stringify(lastTurn(p), bigints)}`)); }, Math.max(ms, 0));
    const stop = p.conn.onChange(look);
    look();
  });
}

/** Turn n done: its rows once it is; a Failed at once if it fails instead. */
async function doneTurn(p: Player, n: number, ms = 60_000): Promise<SceneRows> {
  const rows = await until(p, `turn ${n} to finish`, ms, r => ["done", "failed"].includes(turnOf(r, n)?.phase ?? "") && r);
  const turn = turnOf(rows, n)!;
  check(`turn ${n} done`, turn.phase === "done");
  return rows;
}

function turnOf(rows: SceneRows, n: number) {
  return rows.turns.find(t => t.n === n);
}

function lastTurn(p: Player) {
  return p.conn.rows()?.turns.reduce<SceneRows["turns"][number] | undefined>((a, t) => (!a || t.n > a.n ? t : a), undefined);
}

function nextTurn(p: Player): number {
  return (lastTurn(p)?.n ?? 0) + 1;
}

/** A turn's row events as both clients should see them, in order: its phases, the draft's posts, its entries. */
function turnEvents(events: Player["events"], n: number): string[] {
  const turnId = events.find(e => e.table === "turn" && e.row.n === n)?.row.id;
  return events.flatMap(({ table, op, row }) => {
    if (table === "turn" && row.id === turnId) return [`turn ${op} ${row.phase}`];
    if (table === "reply_draft" && row.turnId === turnId) return [`draft ${op} ${row.attempt}/${row.seq}`];
    if (table === "transcript" && row.turn === n) return [`entry ${op} ${row.seq} ${row.kind}`];
    return [];
  });
}

// ---------------------------------------------------------------------------------------------
// The stack: the AI service restarted with other options, the logs, the call log.

/** The AI service stopped (SIGTERM: what's in flight finishes) and started with the fake model's options and anything else. */
async function restartAi(stack: Stack, fake: FakeOptions, env: Record<string, string> = {}): Promise<void> {
  await stack.ai.stop();
  await stack.ai.start({ KM_AI_FAKE: JSON.stringify(fake), ...env });
}

/** The game's uid and scene, which every idempotency key names. */
async function gameOf(stack: Stack, rows: SceneRows): Promise<Game> {
  const [game] = await stack.sql(`SELECT uid FROM game WHERE id = ${rows.game.id}`);
  return { id: rows.game.id, uid: String(game!.uid), scene: rows.scene.id };
}

function keyOf(game: Game, n: number, step: Step): string {
  return idempotencyKey(game.uid, game.scene, n, step);
}

/** How many times the AI service asked the model for `operation` under a key: the call log's lines as each call went out. */
function modelCalls(game: Game, operation: string, key: string): number {
  const path = join(flags.root, "ai", "games", game.uid, "calls.jsonl");
  if (!existsSync(path)) return 0;
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as { key?: string; operation?: string; started?: string })
    .filter(c => c.started && c.operation === operation && c.key === key).length;
}

function aiLog(): string {
  return readFileSync(join(flags.root, "logs", "ai.log"), "utf8");
}

/** The module's own log (console.info in the module), through the stack's CLI config. */
async function moduleLog(stack: Stack): Promise<string> {
  const { cli, db } = stack.file();
  const { stdout, stderr } = await run(cli.bin, ["--config-path", cli.config, "logs", db, "-s", cli.server, "--no-config"]);
  return `${stdout}${stderr}`;
}

// ---------------------------------------------------------------------------------------------
// Saying how it went.

function step(title: string): void {
  console.log(`\n${title} (${seconds(performance.now() - began)})`);
}

function ok(what: string): void {
  console.log(`  ✓ ${what}`);
}

function check(what: string, passes: boolean): void {
  if (!passes) throw new Failed(what);
  ok(what);
}

function pause(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function millis(micros: number): string {
  return `${Math.round(micros / 1000)} ms`;
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** JSON.stringify's replacer for rows: a u64 as its digits. */
function bigints(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? String(value) : value;
}

function flagsOf(argv: string[]): { port: number; aiPort: number; root: string; mode?: Mode } {
  const { values } = parseArgs({ args: argv, options: { port: { type: "string" }, "ai-port": { type: "string" }, root: { type: "string" }, mode: { type: "string" }, help: { type: "boolean" } } });
  if (values.help) { console.log(USAGE); process.exit(0); }
  const mode = values.mode;
  if (mode !== undefined && mode !== "host" && mode !== "namespace") { console.error(`--mode ${mode}: host or namespace\n${USAGE}`); process.exit(2); }
  return {
    port: Number(values.port ?? 3310), aiPort: Number(values["ai-port"] ?? 8797), root: resolve(values.root ?? join("runs", "e2e")),
    ...(mode ? { mode } : {}),
  };
}
