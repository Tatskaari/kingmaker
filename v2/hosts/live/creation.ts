import { homeWhen, type HomeRows, type MoveName, type Moves } from "../../client/backend.ts";
import { jsonOf } from "../../client/json.ts";
import type { Creation } from "../../client/module_bindings/types.ts";
import { connect, type Connection } from "../../client/net/connection.ts";
import type { Backstory, LoreIssue } from "../../shared/creation/types.ts";
import { cardText } from "../../shared/rules/index.ts";
import type { Offer } from "../../shared/rules/types.ts";
import { sql } from "../dev/spacetime.ts";
import type { StackFile } from "../dev/stack-file.ts";
import { byOperation, cell, entryText, ledgerFrom, modelsOf, settled, writeRecord, type Call, type RecordAt } from "./common.ts";

/**
 * V1's live run (v1-design §4.6), as the prototype's src/app/smoke/creation-live.tsx is the
 * prototype's: against the running dev stack and its models, the create screen's three example
 * concepts each offered three builds (printed whole, for a person to judge the fit); then Tamsin
 * Vell's first card, the nephew backstory through the lore check, its fixes taken and checked
 * again, what it says of her, the game made and begun, its opening and a line. Recorded as
 * Markdown, with each model call's operation, time and cost from the AI service's ledger. It stops
 * before a step that would take the run past its budget, judging a step by the dearest so far.
 */

export interface CreationFlags extends RecordAt { budget: number; rehearse: boolean; date: string }

/** The create screen's examples (client/ui/create.tsx), Tamsin last: hers goes on into the game. */
const CONCEPTS = [
  { name: "Brother Odo", concept: "a large, gentle hedge-priest who settles arguments by sitting on them" },
  { name: "Pell Marrow", concept: "a Nine Furrows weather-witch who is never wrong about rain and rarely right about people" },
  { name: "Tamsin Vell", concept: "a disgraced palace auditor with a ledger-keeper's eye, a sharp tongue and a borrowed rapier" },
];
/** The backstory the lore check should catch (v1-design §1.2, step 7): a tie to the King the lore would know of. */
const NEPHEW = "I'm the King's nephew, though nobody at court will say so. I owe Fat Jory three crowns.";
const LINE = "Sergeant, who found him?";
/** How long a creation step may take: its timeout, and the AI service's retries. */
const STEP_MS = 180_000;

/** What happened, step by step, for the record. */
interface Run {
  offers: Array<{ who: string; offer: Offer }>;
  checks: Array<{ round: number; issues: LoreIssue[] }>;
  story?: { written: string; fixed: string; unchecked?: string; backstory?: Backstory };
  made?: { build: string; status: string };
  scene?: { entries: Array<{ turn: number; kind: string; speaker: string; text: string }>; turns: Array<{ n: number; first?: number; settled?: number }> };
  steps: Array<{ what: string; cost: number; ms: number }>;
  stopped?: string;
}

export async function creationRun(stack: StackFile, flags: CreationFlags): Promise<void> {
  const conn = await connect({ url: stack.ws, db: stack.db });
  const ledger = ledgerFrom(stack.root);
  const run: Run = { offers: [], checks: [], steps: [] };
  const step = stepper(run, ledger, flags.budget);

  console.log(`The live run of character creation, against ${stack.http} (${stack.ai.model} model)`);
  try {
    for (const who of CONCEPTS) await step(`three builds for ${who.name}`, () => offered(conn, who, run));
    await step("Tamsin's card 1", () => act(conn, "chooseBuild", { index: 0 }));
    await step("the lore check", () => checked(conn, run, NEPHEW));
    await step("what it says of her, and the game made", () => made(conn, run));
    await step("begin: the opening", () => begun(conn));
    await step(`"${LINE}"`, () => said(conn, LINE));
    run.scene = await sceneOf(stack, conn);
  } catch (error) {
    run.stopped = error instanceof Error ? error.message : String(error);
    console.log(`  stopped: ${run.stopped}`);
  }

  const calls = ledger.calls();
  const where = writeRecord(flags, markdownOf(run, calls, stack, flags));
  console.log(`\nRecorded ${where}: ${calls.length} model calls, $${ledger.spent().toFixed(4)}`);
  conn.close();
  if (run.stopped) throw new Error(run.stopped);
}

/**
 * Each step timed and costed from the ledger; before one, the run stops if the dearest step so far
 * would take it past the budget.
 */
function stepper(run: Run, ledger: ReturnType<typeof ledgerFrom>, budget: number) {
  return async (what: string, body: () => Promise<unknown>): Promise<void> => {
    const spent = ledger.spent(), dearest = Math.max(0, ...run.steps.map(s => s.cost));
    if (spent + dearest > budget) throw new Error(`the dearest step so far ($${dearest.toFixed(4)}) would take the run past its $${budget.toFixed(2)} ($${spent.toFixed(4)} spent)`);
    const started = performance.now();
    await body();
    const cost = ledger.spent() - spent, ms = performance.now() - started;
    run.steps.push({ what, cost, ms });
    console.log(`  ${what}: ${(ms / 1000).toFixed(1)} s, $${cost.toFixed(4)} ($${ledger.spent().toFixed(4)} so far)`);
  };
}

// ---------------------------------------------------------------------------------------------
// The steps.

/** start_creation (three): the offer, once the builds have come. */
async function offered(conn: Connection, who: { name: string; concept: string }, run: Run): Promise<void> {
  await act(conn, "startCreation", { campaign: "caerwyn", ...who, how: "three" });
  const row = await homeWhen(conn, r => !r.creation?.busy && (!!r.creation?.offer || !!r.creation?.note), STEP_MS);
  const offer = jsonOf<Offer>(row.creation?.offer);
  if (!offer) throw new Error(`no builds for ${who.name}: ${row.creation?.note ?? "(no word why)"}`);
  run.offers.push({ who: `${who.name}: ${who.concept}`, offer });
}

/**
 * Done with the nephew in the box: the lore check, each issue's fix taken as the screens take them,
 * then the check again with the fixes in. A fix whose words have gone stops the run (the player
 * would rewrite it themselves).
 */
async function checked(conn: Connection, run: Run, story: string): Promise<void> {
  run.story = { written: story, fixed: story };
  await act(conn, "finishBackstory", { text: story });
  for (let round = 1; ; round++) {
    const row = await homeWhen(conn, r => !r.creation?.busy || r.creation.busy === "traits", STEP_MS);
    const issues = jsonOf<LoreIssue[]>(row.creation?.issues) ?? [];
    run.checks.push({ round, issues });
    if (!issues.length) return;
    for (let i = 0; i < issues.length; i++) {
      await act(conn, "acceptFix", {});
      const rewriting = jsonOf<LoreIssue>(conn.home().creation?.rewriting);
      if (rewriting) throw new Error(`check ${round} flagged words no longer in the story ("${rewriting.problem}"), so the player would rewrite it themselves`);
    }
    run.story.fixed = conn.home().creation?.story ?? story;
  }
}

/** The traits, then the game made with the chosen build: the sheet the engine made. */
async function made(conn: Connection, run: Run): Promise<void> {
  const row = await homeWhen(conn, r => r.creation?.step === "made" && !!r.sheet?.build, STEP_MS);
  const c = row.creation as Creation;
  run.story = { ...run.story!, ...(c.unchecked ? { unchecked: c.unchecked } : {}), ...(c.backstory ? { backstory: jsonOf<Backstory>(c.backstory)! } : {}) };
  run.made = { build: row.sheet!.build, status: row.sheet!.statusLine };
}

async function begun(conn: Connection): Promise<void> {
  await act(conn, "begin", {});
  await homeWhen(conn, r => r.seat?.sceneId !== undefined, 10_000);
  await settled(conn, 0);
}

async function said(conn: Connection, line: string): Promise<void> {
  const refused = await conn.say(line);
  if (refused) throw new Error(`"${line}" was refused: ${refused.text}`);
  await settled(conn, 1);
}

/** A move, or the run stops with the simulation's words for why not. */
async function act<K extends MoveName>(conn: Connection, move: K, args: Moves[K]): Promise<HomeRows> {
  const refused = await conn.act(move, args);
  if (refused) throw new Error(`${move} was refused: ${refused.text}`);
  return conn.home();
}

/** The scene's entries and each turn's times (from the line said: first words, settled), as the owner reads them. */
async function sceneOf(stack: StackFile, conn: Connection): Promise<Run["scene"]> {
  const scene = conn.rows()!.scene.id;
  const query = (q: string) => sql(stack.http, q, stack.owner.token);
  const entries = (await query(`SELECT * FROM transcript WHERE scene_id = ${scene}`)).sort((a, b) => Number(a.seq) - Number(b.seq));
  const turns = (await query(`SELECT * FROM turn WHERE scene_id = ${scene}`)).sort((a, b) => Number(a.n) - Number(b.n));
  const from = (t: Record<string, unknown>, at: unknown) => (at === null ? undefined : (Number(at) - Number(t.started_at)) / 1e6);
  return {
    entries: entries.map(e => ({ turn: Number(e.turn), kind: String(e.kind), speaker: String(e.speaker), text: String(e.text) })),
    turns: turns.map(t => ({ n: Number(t.n), ...opt("first", from(t, t.first_text_at)), ...opt("settled", from(t, t.ended_at)) })),
  };
}

const opt = <K extends string>(key: K, value: number | undefined) => (value === undefined ? {} : { [key]: value }) as Partial<Record<K, number>>;

// ---------------------------------------------------------------------------------------------
// The record.

function markdownOf(run: Run, calls: Call[], stack: StackFile, flags: CreationFlags): string {
  const cost = calls.reduce((s, c) => s + c.costUsd, 0);
  return [
    `# V1 live run, ${flags.date}`,
    "",
    `Character creation through V1's split with ${flags.rehearse ? "**the fake model: a rehearsal, not a live run**" : "real models"}: \`npm run dev\` in ${stack.mode} mode, then \`npm run live -- --creation\` (hosts/live-run.ts wrote this file). The create screen's three example concepts offered builds; then Tamsin Vell's first card, a backstory that claims kin to the King, the lore check and its fixes, the game made and begun, and a line.`,
    "",
    "| | |",
    "|---|---|",
    `| Model calls | ${calls.length} |`,
    `| Cost | $${cost.toFixed(4)} (the AI service's ledger) |`,
    ...(run.made ? [`| Tamsin Vell | ${run.made.build} · ${run.made.status} |`] : []),
    ...(run.stopped ? [`| Stopped | ${cell(run.stopped)} |`] : []),
    "",
    "## The steps",
    "",
    "| Step | Time | Cost |",
    "|---|---|---|",
    ...run.steps.map(s => `| ${cell(s.what)} | ${(s.ms / 1000).toFixed(1)} s | $${s.cost.toFixed(4)} |`),
    "",
    "## Three concepts, three builds each",
    "",
    "Each card is the engine's: the model's build made legal by the rules engine (settleBuild), its numbers off the sheet the engine made. For a person to judge the fit.",
    "",
    ...run.offers.flatMap(({ who, offer }) => [
      `### ${who}`,
      "",
      ...(offer.note ? [`*${offer.note}*`, ""] : []),
      `Classes: ${offer.options.map(o => o.build.classId).join(", ")} (${new Set(offer.options.map(o => o.build.classId)).size === offer.options.length ? "all different" : "**not all different**"}); from ${[...new Set(offer.options.map(o => o.from))].join(", ")}.`,
      "",
      "```text",
      ...offer.options.map((o, i) => `${i + 1}. ${cardText(o).split("\n").join("\n   ")}`),
      "```",
      "",
    ]),
    "## Tamsin's backstory and the lore check",
    "",
    ...(run.story ? [
      `As written: "${run.story.written}"`,
      "",
      ...run.checks.flatMap(c => c.issues.length
        ? [`Check ${c.round}${c.round > 1 ? ", with the fixes in" : ""}: ${c.issues.length} ${c.issues.length === 1 ? "issue" : "issues"}, each fix taken.`, "", ...c.issues.flatMap(i => [`- "${i.quote ?? "(words not found)"}": ${i.problem}`, `  - The fix: "${i.fix}"`]), ""]
        : [`Check ${c.round}${c.round > 1 ? ", with the fixes in" : ""}: ${run.story!.unchecked ? "not checked (below)" : "it fits"}.`, ""]),
      `With the fixes in: "${run.story.fixed}"`,
      "",
      ...(run.story.unchecked ? [`Unchecked: ${run.story.unchecked}`, ""] : []),
      ...(run.story.backstory ? [
        `What it says of her: ${run.story.backstory.summary}`,
        "",
        `Personality: ${run.story.backstory.personality.join("; ") || "none"} · Ideals: ${run.story.backstory.ideals.join("; ") || "none"} · Bonds: ${run.story.backstory.bonds.join("; ") || "none"} · Flaws: ${run.story.backstory.flaws.join("; ") || "none"}`,
        "",
      ] : []),
    ] : ["(The run stopped before it.)", ""]),
    "## The opening and a line",
    "",
    ...(run.scene ? [
      ...run.scene.turns.map(t => `Turn ${t.n}: first words ${t.first?.toFixed(1) ?? "?"} s, settled ${t.settled?.toFixed(1) ?? "?"} s after ${t.n ? "the line" : "begin"}.`),
      "",
      ...run.scene.entries.flatMap(e => [entryText(e), ""]),
    ] : ["(The run stopped before it.)", ""]),
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
    "## Every call",
    "",
    "| Key | Operation | Model | Time | Cost |",
    "|---|---|---|---|---|",
    ...calls.map(c => `| ${c.key.replace(/^[^:]+:/, "…:")} | ${c.operation} | ${c.model} | ${(c.latencyMs / 1000).toFixed(1)} s | $${c.costUsd.toFixed(4)} |`),
    "",
  ].join("\n");
}
