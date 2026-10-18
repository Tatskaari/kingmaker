// New (M5: problem reports): the e2e's step for a report of a problem, on a real SpacetimeDB.
import { join } from "node:path";
import type { FakeOptions } from "../../ai/llm/fake-openrouter.ts";
import * as verbs from "../../client/headless.ts";
import { callDetail, rowsDetail, summary, turnDetail } from "../../qa/report/inspect.ts";
import { findReport, readReport } from "../../qa/report/read.ts";
import { restoreReport } from "../../qa/report/restore.ts";
import type { GameAnswer, GameReport } from "../../shared/report/format.ts";
import type { Stack } from "../dev/stack.ts";
import { reportsDir, terminalReporting } from "../reports.ts";
import { RAISED } from "./gm.ts";
import { check, doneTurn, ok, player, restartAi, step, until, type Player } from "./kit.ts";

/**
 * 41. A problem reported (V16, M5: docs/migration-log.md): a game played a few turns on the fake
 * model, reported from the headless client as a terminal's reports are kept (runs/reports under the
 * e2e's root), its game from report_game on SpacetimeDB (its rows, and the AI service's calls and
 * docs for it), which anyone but its owner is refused; read as `npm run report -- inspect` reads it
 * (the summary, a turn, a call, a table); restored as `restore` restores it, into this stack for a
 * session of its own (restore_game as the owner over HTTP, the docs to the AI service); and played on
 * a turn there, from where it was reported. `other` (B) asks for the game that isn't theirs.
 */
export async function aProblemReported(stack: Stack, root: string, other: Player, fake: FakeOptions): Promise<void> {
  step("41. A problem reported: a game played a few turns, reported from the headless client, its game from report_game (refused to anyone but its owner), inspected, restored into the stack for another session, and played on a turn there");
  // Step 20 left $10 in today's ledger: the ceiling raised, as from step 22 on.
  await restartAi(stack, fake, RAISED);
  const r = await player(stack, "R");
  await played(r);

  const report = await reported(r, root);
  const game = gameIn(report);
  const refused = JSON.parse(String(await other.conn.reportGame(BigInt(game.id)))) as GameAnswer;
  check(`B's report_game of R's game is refused: ${"refusal" in refused ? refused.refusal.code : "it was given"}`, "refusal" in refused && refused.refusal.code === "not_yours");
  inspected(report);

  const s = await player(stack, "S");
  const restored = await restoreReport(report, { http: stack.http, db: stack.db, ownerToken: stack.owner.token, ai: stack.aiFromHost, bearer: stack.ai.bearer }, s.conn.identity);
  ok(`restored as ${restored.uid}, ${restored.docs} docs with it`);
  await playedOn(s, game);
  r.conn.close();
  s.conn.close();
}

/** R's game: a ready-made rogue talked into the yard, its opening and two lines played. */
async function played(r: Player): Promise<void> {
  check("R's new_game is made", (await r.conn.newGame({ campaign: "caerwyn", name: "Tamsin Vell", concept: "a disgraced palace auditor", build: "rogue" })) === undefined);
  check("R talks to Kell, and the hanged clerk opens", (await r.conn.interact({ verb: "talk", target: "kell" })) === undefined);
  await until(r, "the yard's opening", 60_000, rows => rows.scene.status === "live" && rows.turns.some(t => t.n === 0 && t.phase === "done") && rows);
  for (const [n, line] of [[1, "Sergeant, who found him?"], [2, "(I look closely at Prout's boots)"]] as const) {
    check(`R says "${line}"`, (await r.conn.say(line)) === undefined);
    await doneTurn(r, n);
  }
}

/** R's report, as the headless client files one: kept under the root's runs/reports, and read back by its bare name. */
async function reported(r: Player, root: string) {
  const runs = join(root, "report");
  const said: string[] = [];
  const code = await verbs.report(r.conn, "Kell never says who found him", { print: text => said.push(text), progress: () => {} }, terminalReporting({ runs, host: "headless", env: {}, glyphs: () => "ascii" }));
  const file = /tell Claude 'report (.+?)'$/.exec(said[said.length - 1] ?? "")?.[1];
  check(`the report is kept: ${said[said.length - 1]}`, code === 0 && !!file);
  return readReport(findReport(file!, { reports: reportsDir(runs), downloads: join(runs, "downloads") }));
}

/** The report's game, as report_game gave it on SpacetimeDB: its rows and the AI service's calls and docs. */
function gameIn(report: ReturnType<typeof readReport>): GameReport {
  const game = report.game && !("error" in report.game) ? report.game : undefined;
  const rows = game ? Object.values(game.rows).reduce((n, list) => n + list.length, 0) : 0;
  const ai = !game ? "" : "error" in game.ai ? `no AI service's own (${game.ai.error})` : `${game.ai.calls.calls.length} call lines and ${game.ai.docs.docs.length} docs`;
  check(`its game came from report_game: ${game ? `game ${game.id}, ${rows} rows in ${Object.keys(game.rows).length} tables, ${ai}` : JSON.stringify(report.game)}`, !!game && !("error" in game.ai) && game.ai.calls.calls.length > 0 && !!game.rows.transcript?.length);
  return game!;
}

/** Read as npm run report -- inspect reads it: the summary, turn 1 in full, a call, a table. */
function inspected(report: ReturnType<typeof readReport>): void {
  const text = summary(report);
  check("its summary says what was said and where, and the two turns as R saw them with their calls", /The player said: "Kell never says who found him"/.test(text) && /The game: in the scene The Hanged Clerk/.test(text) && /Turn 2 · The Hanged Clerk/.test(text) && /calls: #\d+ two-part\.reply/.test(text));
  const turn = turnDetail(report, "1");
  check("turn 1 in full: the line, the reply, the co-GM's and the stage manager's part", /> Tamsin Vell: Sergeant, who found him\?/.test(turn) && /── The reply/.test(turn) && /── The co-GM/.test(turn) && /── The stage manager/.test(turn));
  check("a call in full, and a table's rows", /^Call #1 of \d+: two-part\.opening/.test(callDetail(report, 1)) && /Sergeant, who found him/.test(rowsDetail(report, "transcript")));
}

/** S, seated in the restored game: a new game, its transcript the reported one, and a turn played on. */
async function playedOn(s: Player, from: GameReport): Promise<void> {
  const rows = await until(s, "S seated in the restored game's scene", 30_000, r => r.scene.status === "live" && r);
  const lines = rows.transcript.filter(t => t.kind === "player").map(t => t.text).join(" | ");
  check(`S is in a new game (${rows.game.id}, not ${from.id}), its transcript the reported one: ${lines}`, String(rows.game.id) !== from.id && lines === "Sergeant, who found him? | (I look closely at Prout's boots)");
  check(`S says "And the boy with the stones?"`, (await s.conn.say("And the boy with the stones?")) === undefined);
  await doneTurn(s, 3);
  ok("played on a turn from where it was reported");
}
