import { newGameOf } from "../../client/backend.ts";
import * as verbs from "../../client/headless.ts";
import { connect, type Connection } from "../../client/net/connection.ts";
import { gmFromRow, type GmRow } from "../../shared/gm/state.ts";
import { camel } from "../dev/gm-status.ts";
import { sql } from "../dev/spacetime.ts";
import type { StackFile } from "../dev/stack-file.ts";
import { byOperation, cell, entryText, ledgerFrom, modelsOf, writeRecord, type Call, type RecordAt } from "./common.ts";

/**
 * The whole story's live run (story-design §1.4, §5): one game from the yard to The End against the
 * running dev stack and its models, each scene ended through the exit the prototype's flow takes
 * (src/app/smoke/flow.ts: open-case, hobb-talks, fight, caught-in-the-act, justice) as the dev
 * stack's owner, as the QA console's end does, so each boundary and each opening is the models'
 * and no line is. Through the headless client's verbs (end, go, act --id fight, observe), as an
 * agent plays it. Recorded as Markdown: each step's time and cost (the AI service's ledger), each
 * scene's opening, each boundary's hand-off and verdict (what it handed on: the adjustments, the
 * rewritten opening, the lead, who's absent, what's owed), the time between in Kell's words, the
 * aftermath of the fight's stand-in, The End, and the calls by operation. It stops before a step
 * that would take the run past its budget, judging a step by the dearest so far.
 */

export interface StoryFlags extends RecordAt { budget: number; rehearse: boolean; date: string; who: string; build: string }

/** The flow's endings, scene by scene (flow.ts:41-71), and between them the way on. */
const ENDINGS = { yard: "open-case", rat: "hobb-talks", heron: "fight", aftermath: "caught-in-the-act", king: "justice" };

/** A step: what it was, its time and cost, and what it printed. */
interface StepRecord { what: string; ms: number; cost: number; printed: string }

interface Run { steps: StepRecord[]; stopped?: string }

export async function storyRun(stack: StackFile, flags: StoryFlags): Promise<void> {
  // The dev stack's owner (its stack.json), for end_scene, as play end has it.
  const conn = await connect({ url: stack.ws, db: stack.db, owner: { http: stack.http, db: stack.db, token: stack.owner.token } });
  const ledger = ledgerFrom(stack.root);
  const run: Run = { steps: [] };
  const step = stepper(run, ledger, flags.budget);

  console.log(`The whole story's live run, against ${stack.http} (${stack.ai.model} model)`);
  try {
    await step(`new game (${flags.who}, ${flags.build}): the yard's opening`, out => verbs.newGame(conn, newGameOf(flags.who, flags.build, "caerwyn"), out));
    await step(`end --exit ${ENDINGS.yard}: the boundary`, out => verbs.end(conn, ENDINGS.yard, out));
    await step("go: the Drowned Rat's opening", out => verbs.go(conn, out));
    await step(`end --exit ${ENDINGS.rat}: the boundary`, out => verbs.end(conn, ENDINGS.rat, out));
    await step("go: the Heron's opening", out => verbs.go(conn, out));
    await step(`end --exit ${ENDINGS.heron}: Roll for initiative`, out => verbs.end(conn, ENDINGS.heron, out));
    await step("act --id fight: the stand-in, then the aftermath", out => verbs.fight(conn, out));
    await step(`end --exit ${ENDINGS.aftermath}: the boundary, and the King's morning (a summons)`, out => verbs.end(conn, ENDINGS.aftermath, out));
    await step(`end --exit ${ENDINGS.king}: The End`, out => verbs.end(conn, ENDINGS.king, out));
    await step("observe", out => verbs.observe(conn, out));
  } catch (error) {
    run.stopped = error instanceof Error ? error.message : String(error);
    console.log(`  stopped: ${run.stopped}`);
  }

  const game = conn.rows()?.game.id;
  const story = game === undefined ? undefined : await storyOf(stack, game);
  const calls = ledger.calls();
  const where = writeRecord(flags, markdownOf(run, story, calls, stack, flags));
  console.log(`\nRecorded ${where}: ${calls.length} model calls, $${ledger.spent().toFixed(4)}`);
  conn.close();
  if (run.stopped) throw new Error(run.stopped);
}

/**
 * Each step timed and costed from the ledger, its verb's words kept; before one, the run stops if the
 * dearest step so far would take it past the budget. A verb that exits 1 stops the run.
 */
function stepper(run: Run, ledger: ReturnType<typeof ledgerFrom>, budget: number) {
  return async (what: string, verb: (out: verbs.Out) => Promise<number> | number): Promise<void> => {
    const spent = ledger.spent(), dearest = Math.max(0, ...run.steps.map(s => s.cost));
    if (spent + dearest > budget) throw new Error(`the dearest step so far ($${dearest.toFixed(4)}) would take the run past its $${budget.toFixed(2)} ($${spent.toFixed(4)} spent)`);
    const started = performance.now();
    const printed: string[] = [];
    const code = await verb({ print: text => printed.push(text), progress: () => {} });
    const cost = ledger.spent() - spent, ms = performance.now() - started;
    run.steps.push({ what, ms, cost, printed: printed.join("\n") });
    console.log(`  ${what}: ${(ms / 1000).toFixed(1)} s, $${cost.toFixed(4)} ($${ledger.spent().toFixed(4)} so far)`);
    if (code !== 0) throw new Error(`${what} exited ${code}: ${printed.join("\n").slice(-300)}`);
  };
}

// ---------------------------------------------------------------------------------------------
// The rows.

type Row = Record<string, unknown>;

/** A scene of the game as it stood at the end: its row, what was handed on to it, its entries; and its chapter, once played. */
interface SceneRecord { scene: Row; handed: { adjustments: string[]; opening?: string; lead?: string; absent: string[]; owed: string[]; fought: string[] }; entries: Row[]; chapter?: Row }

/** The game's scenes in the order played, as the owner reads them. */
async function storyOf(stack: StackFile, game: bigint): Promise<SceneRecord[]> {
  const query = (q: string) => sql(stack.http, q, stack.owner.token);
  const [scenes, chapters] = await Promise.all([query(`SELECT * FROM scene WHERE game_id = ${game}`), query(`SELECT * FROM chapter WHERE game_id = ${game}`)]);
  return Promise.all(scenes.sort((a, b) => Number(a.id) - Number(b.id)).map(async scene => {
    const [[gmRow], entries] = await Promise.all([query(`SELECT * FROM gm_state WHERE scene_id = ${String(scene.id)}`), query(`SELECT * FROM transcript WHERE scene_id = ${String(scene.id)}`)]);
    const gm = gmRow ? gmFromRow(camel(gmRow) as GmRow) : undefined;
    const chapter = chapters.find(c => String(c.scene_id) === String(scene.id));
    return {
      scene,
      handed: {
        adjustments: gm?.adjustments ?? [], ...(gm?.opening ? { opening: gm.opening } : {}), ...(gm?.lead ? { lead: gm.lead } : {}), absent: gm?.absent ?? [],
        owed: (gm?.owed ?? []).map(o => `${o.id} (from ${o.from}): ${[...o.things].reverse().join(" in ")}${o.holders.length ? `, with ${o.holders.join(", ")}` : ""}${o.where ? `, ${o.where}` : ""}`),
        fought: gm?.fought ?? [],
      },
      entries: entries.sort((a, b) => Number(a.seq) - Number(b.seq)),
      ...(chapter ? { chapter } : {}),
    };
  }));
}

// ---------------------------------------------------------------------------------------------
// The record.

function markdownOf(run: Run, story: SceneRecord[] | undefined, calls: Call[], stack: StackFile, flags: StoryFlags): string {
  const cost = calls.reduce((s, c) => s + c.costUsd, 0);
  const by = (prefix: string) => run.steps.find(s => s.what.startsWith(prefix));
  return [
    `# The whole story live run, ${flags.date}`,
    "",
    `The whole story (story-design §1.2) with ${flags.rehearse ? "**the fake model: a rehearsal, not a live run**" : "real models"}: \`npm run dev\` in ${stack.mode} mode, then \`npm run live -- --script story\` (hosts/live-run.ts wrote this file). One game from the yard to The End through the headless client, each scene ended by the exit the prototype's flow takes (src/app/smoke/flow.ts), as the dev stack's owner (\`play end --exit\`, the QA console's \`end\`), so every boundary and every opening is the models' and no line is.`,
    "",
    "| | |",
    "|---|---|",
    `| Who | ${cell(flags.who)} (${flags.build}) |`,
    `| Model calls | ${calls.length} |`,
    `| Cost | $${cost.toFixed(4)} (the AI service's ledger) |`,
    ...(run.stopped ? [`| Stopped | ${cell(run.stopped)} |`] : []),
    "",
    "## The steps",
    "",
    "| Step | Time | Cost |",
    "|---|---|---|",
    ...run.steps.map(s => `| ${cell(s.what)} | ${(s.ms / 1000).toFixed(1)} s | $${s.cost.toFixed(4)} |`),
    "",
    "## Scene by scene",
    "",
    ...(story ?? []).flatMap(s => sceneSection(s, story!)),
    ...(by("end --exit") ? ["## Between the scenes, as the headless client printed them", "", ...run.steps.filter(s => s.what.startsWith("end --exit") || s.what.startsWith("act --id fight")).flatMap(s => [`### ${s.what}`, "", "```text", s.printed.trim(), "```", ""])] : []),
    ...(by("observe") ? ["## The End, as observe printed it", "", "```text", by("observe")!.printed.trim(), "```", ""] : []),
    "## The models",
    "",
    ...modelsOf(calls),
    "",
    "## Calls by operation",
    "",
    "| Operation | Calls | Cost | Median time |",
    "|---|---|---|---|",
    ...byOperation(calls),
    "",
  ].join("\n");
}

/** A scene: when and where it played, what was handed on to it, its opening (and the fight's aftermath), how it ended and its boundary. */
function sceneSection(s: SceneRecord, all: SceneRecord[]): string[] {
  const title = String(s.scene.title), time = s.scene.time === null || s.scene.time === undefined ? "" : `, ${String(s.scene.time)}`;
  const opening = s.entries.filter(e => Number(e.turn) === 0);
  const later = s.entries.filter(e => Number(e.turn) > 0);
  const first = all[0] === s;
  const h = s.handed;
  const c = s.chapter;
  const skipped = (c?.skipped as Array<Record<string, unknown>> | undefined ?? []).map(k => `${String(k.scene_key ?? k.sceneKey)} (${String(k.why)})`);
  return [
    `### ${title}${time} (${String(s.scene.status)})`,
    "",
    ...(first ? [] : [
      "What the boundary handed on to it:",
      "",
      `- Adjustments: ${h.adjustments.length ? h.adjustments.map(a => `"${a}"`).join(" ") : "none"}`,
      `- The opening rewritten: ${h.opening ? `"${h.opening}"` : "no (the author's stands)"}`,
      `- The lead: ${h.lead ? `"${h.lead}"` : "none (the card says the time passing)"}`,
      `- Absent: ${h.absent.join(", ") || "nobody"}`,
      `- Owed: ${h.owed.join("; ") || "nothing"}`,
      "",
    ]),
    "The opening:",
    "",
    ...opening.flatMap(e => [entryText({ turn: Number(e.turn), kind: String(e.kind), text: String(e.text) }), ""]),
    ...(later.length ? ["Then:", "", ...later.flatMap(e => [entryText({ turn: Number(e.turn), kind: String(e.kind), text: String(e.text) }), ""])] : []),
    ...(c ? [
      `Ended: ${String(c.exit_key)} (${String(c.ending)}). Its boundary: ${Number(c.calls)} calls, $${(Number(c.cost_micros ?? 0) / 1e6).toFixed(4)}${skipped.length ? `; skipped ${skipped.join(", ")}` : ""}.`,
      "",
      "The hand-off (the chapter's summary):",
      "",
      ...String(c.summary || "(none: The End has no boundary after it)").split("\n").map(l => `> ${l}`),
      "",
      ...((c.fronts as string[] | undefined)?.length ? [`The fronts moved: ${(c.fronts as string[]).join("; ")}`, ""] : []),
    ] : []),
  ];
}
