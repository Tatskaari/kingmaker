import type { Call, EntryRecord, LiveRecord, TurnRecord } from "./record.ts";

/**
 * A live run's record as Markdown (v5-design §4.6): the run at a glance, each turn's moments, the
 * measures against the prototype's live ones, the calls, the GM's side when the script records it
 * (full-gm-design §1.5: each line's ruling, memory review and co-GM review, and where the co-GM left
 * the scene), then turn by turn who said what, the notes with their cards and the lines offered with
 * what was screened out, and last what the scene holds back from the player, for a reader to check
 * every note and line against.
 */

/** The prototype's live measures (docs/LOG.md, 15 October): the notes over 19 calls, the lines over 21 replies, speakers over 52 lines. */
const PROTOTYPE = {
  notes: "2.2 s / 3.9 s (19 calls)",
  lines: "2.8 s (21 replies)",
  tagged: "43 of 52 (83%)",
  speaker: "51 of 52 (the right one)",
  notesAReply: "1.6 (32 in 20 replies)",
  notesCall: "$0.00024",
  linesCall: "$0.0009",
  turn: "$0.0040",
};

export function markdownOf(r: LiveRecord, command: string): string {
  return [
    ...heading(r, command),
    ...turnsTable(r),
    ...againstPrototype(r),
    ...callsByOperation(r.calls),
    ...models(r.calls),
    ...gmSide(r),
    ...worldSide(r),
    "## Turn by turn",
    "",
    ...r.turns.flatMap(turnSection),
    ...heldBack(r),
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// The sections.

function heading(r: LiveRecord, command: string): string[] {
  const lines = r.turns.length - 1;
  return [
    `# ${r.script.title}, ${r.date}`,
    "",
    `${r.script.about}, with ${r.rehearse ? "**the fake model: a rehearsal, not a live run**" : "real models"}: \`npm run dev\` in ${r.mode} mode, then \`${command}\` (hosts/live-run.ts wrote this file).`,
    "",
    "| | |",
    "|---|---|",
    `| Character | ${cell(r.who)} (${cell(r.build)}) |`,
    `| Turns | ${r.turns.length}: the opening and ${lines} line${lines === 1 ? "" : "s"}, of ${r.lines} asked for |`,
    `| Model calls | ${r.calls.length} (${r.model}) |`,
    `| Cost | $${r.cost.toFixed(4)} (the AI service's call log) |`,
    `| Game | ${r.game} |`,
    ...(r.ending ? [`| The scene ended | ${r.ending} |`] : []),
    ...(r.stopped ? [`| Stopped early | ${cell(r.stopped)} |`] : []),
    ...r.skipped.map(s => `| Skipped | ${cell(s.step)}: ${cell(s.skipped ?? "")} |`),
    "",
  ];
}

function turnsTable(r: LiveRecord): string[] {
  return [
    "## The turns",
    "",
    "From the line being said (the turn's start): its first words, the reply final (its transcript entry) and the turn done (its notes in and the world settled). The notes and the lines: after the reply's entry reached this client, to their commit. Calls and cost: the turn's key's, from the call log.",
    "",
    "| Turn | Line | First words | Reply final | Notes | Lines | Done | Calls | Cost |",
    "|---|---|---|---|---|---|---|---|---|",
    ...r.turns.map(t => `| ${t.n} | ${t.n === 0 ? "(the opening)" : cell(lineOf(t))} | ${since(t, t.firstAt)} | ${since(t, t.finalAt)} | ${extra(t.notes, t.notesMs)} | ${extra(t.suggest, t.linesMs)} | ${since(t, t.doneAt)} | ${t.calls.length} | $${costOf(t.calls).toFixed(4)} |`),
    "",
  ];
}

function againstPrototype(r: LiveRecord): string[] {
  const notes = r.turns.filter(t => t.notes === "written" && t.notesMs !== undefined).map(t => t.notesMs!);
  const lines = r.turns.filter(t => t.suggest === "landed" && t.linesMs !== undefined).map(t => t.linesMs!);
  const replies = r.turns.flatMap(t => t.entries.filter(e => e.speaker === "gm"));
  const spoken = replies.flatMap(e => e.spoken);
  const marks = replies.reduce((n, e) => n + e.notes.length, 0);
  const op = (name: string) => r.calls.filter(c => c.operation === name);
  const suggestAsks = new Set(op("scene.suggest").map(c => c.key)).size;
  return [
    "## Against the prototype",
    "",
    "| | This run | The prototype, live (docs/LOG.md, 15 October) |",
    "|---|---|---|",
    `| The notes after the reply, p50 / p90 | ${notes.length ? `${secs(percentile(notes, 0.5))} / ${secs(percentile(notes, 0.9))} (${count(notes.length, "turn")})` : "none written"} | ${PROTOTYPE.notes} |`,
    `| The lines after the reply, p50 | ${lines.length ? `${secs(percentile(lines, 0.5))} (${count(lines.length, "set")})` : "none landed"} | ${PROTOTYPE.lines} |`,
    `| Spoken lines the GM tagged | ${share(spoken.filter(s => s.tag).length, spoken.length)} | ${PROTOTYPE.tagged} |`,
    `| Spoken lines with a speaker | ${spoken.filter(s => s.who !== "nobody can tell").length} of ${spoken.length} (whether it's the right one is below) | ${PROTOTYPE.speaker} |`,
    `| Notes a reply | ${replies.length ? `${(marks / replies.length).toFixed(1)} (${marks} in ${replies.length} replies)` : "no replies"} | ${PROTOTYPE.notesAReply} |`,
    `| A notes call | ${perCall(op("notes"), op("notes").length)} | ${PROTOTYPE.notesCall} |`,
    `| A reply's lines (the call and the judge) | ${perCall([...op("scene.suggest"), ...op("scene.suggest.judge")], suggestAsks)} | ${PROTOTYPE.linesCall} |`,
    `| A turn | ${r.turns.length ? `$${(r.cost / r.turns.length).toFixed(4)}` : "no turns"} | ${PROTOTYPE.turn} |`,
    "",
  ];
}

function callsByOperation(calls: Call[]): string[] {
  const groups = new Map<string, Call[]>();
  for (const c of calls) groups.set(c.operation, [...(groups.get(c.operation) ?? []), c]);
  return [
    "## Calls by operation",
    "",
    "| Operation | Calls | Cost | Median time |",
    "|---|---|---|---|",
    ...[...groups].sort(([a], [b]) => a.localeCompare(b)).map(([operation, cs]) => `| ${operation} | ${cs.length} | $${costOf(cs).toFixed(4)} | ${secs(percentile(cs.map(c => c.latencyMs), 0.5))} |`),
    "",
  ];
}

function models(calls: Call[]): string[] {
  const used = [...new Set(calls.map(c => `${c.operation.replace(/^memory\.disclose\..*/, "memory.disclose.*")}: ${c.model}`))].sort();
  return ["## The models", "", ...used.map(m => `- ${m}`), ""];
}

/** A turn: the line, the dice, the reply; who says what; the notes with their cards; the lines offered and those screened out; its calls. */
function turnSection(t: TurnRecord): string[] {
  const reply = t.entries.filter(e => e.speaker === "gm");
  return [
    `### ${t.n === 0 ? "The opening" : `Turn ${t.n}: ${lineOf(t)}`}`,
    "",
    ...t.entries.flatMap(e => [entryText(e), ""]),
    ...reply.flatMap(spokenLines),
    ...notesLines(t, reply),
    ...linesOffered(t),
    `Calls: ${byOperation(t.calls) || "none"}.`,
    "",
  ];
}

function spokenLines(e: EntryRecord): string[] {
  if (!e.spoken.length) return ["Who says what: no spoken lines.", ""];
  return ["Who says what:", ...e.spoken.map(s => `- ${s.who}${s.tag ? ` [${s.tag}]` : ""}: ${s.text}`), ""];
}

function notesLines(t: TurnRecord, reply: EntryRecord[]): string[] {
  const notes = reply.flatMap(e => e.notes);
  const when = t.notesMs !== undefined ? `, ${secs(t.notesMs)} after the reply` : "";
  if (!notes.length) return [`Notes: none (${NOTES[t.notes] ?? t.notes}${when}).`, ""];
  return [
    `Notes (${NOTES[t.notes] ?? t.notes}${when}):`,
    ...notes.map(n => `- **${n.kind}** on ${quoted(n.phrase)}: ${n.note}${n.link ? ` (→ ${n.link})` : ""}${n.card ? `\n  Card: **${n.card.title}**: ${n.card.lines.join(" · ")}` : ""}`),
    "",
  ];
}

function linesOffered(t: TurnRecord): string[] {
  const when = t.linesMs !== undefined ? `, ${secs(t.linesMs)} after the reply` : "";
  return [
    ...(t.lines.length ? [`Lines offered (${LINES[t.suggest] ?? t.suggest}${when}):`, ...t.lines.map(l => `${l.ord}. ${l.kind}: ${l.text}`)] : [`Lines offered: none (${LINES[t.suggest] ?? t.suggest}${when}).`]),
    ...(t.dropped.length ? ["", `Screened out: ${t.dropped.map(d => `${quoted(d.text)} (${d.why})`).join("; ")}.`] : []),
    "",
  ];
}

/**
 * The GM's side (npm run status, once the run was over): for each turn, whether the GM ruled on it
 * (the ruling, its roll and what it changed), what the memory review flagged and saved, and the
 * co-GM's review of it, merged or waiting; then the co-GM's steering as it was left.
 */
function gmSide(r: LiveRecord): string[] {
  if (!r.gm) return [];
  const byTurn = (field: string) => {
    const lines = new Map<number, string[]>();
    for (const line of (r.gm![field] as string[] | undefined) ?? []) {
      const m = /^(\d+): (.*)$/s.exec(line);
      if (m) lines.set(Number(m[1]), [...(lines.get(Number(m[1])) ?? []), m[2]!]);
    }
    return (n: number) => (lines.get(n) ?? []).map(cell).join("; ");
  };
  const ruled = byTurn("rulings"), remembered = byTurn("memoryReviews"), reviewed = byTurn("repairs");
  const waited = (t: TurnRecord) => (t.waited !== undefined ? ` (after ${secs(t.waited)} waiting for the background jobs)` : "");
  const list = (field: string) => ((r.gm![field] as string[] | undefined) ?? []);
  const value = (field: string) => (r.gm![field] === null || r.gm![field] === undefined ? "none" : String(r.gm![field]));
  return [
    "## The GM's side",
    "",
    `What \`npm run status\` showed once the run was over${r.settledMs !== undefined ? ` (the background jobs waited for: ${secs(r.settledMs)})` : ""}: for each turn, the GM's ruling on it, what the memory review flagged and saved, and the co-GM's review of it.`,
    "",
    "| Turn | Line | Ruled | Memory review | The co-GM |",
    "|---|---|---|---|---|",
    ...r.turns.map(t => `| ${t.n} | ${t.n === 0 ? "(the opening)" : `${cell(lineOf(t))}${waited(t)}`} | ${ruled(t.n) || "no"} | ${remembered(t.n)} | ${reviewed(t.n)} |`),
    "",
    `Where it was left: beat ${value("beat")}; the scene ${value("sceneStatus")}; the co-GM's notes: ${r.gm.notes === null || r.gm.notes === undefined ? "none" : `${cell(String(r.gm.notes))} (from turn ${value("notesTurn")})`}; the last turn off the graph with nothing ruled on it: ${value("offGraphTurn")}; the turn the co-GM last reviewed (merged): ${value("lastRepairTurn")}.`,
    "",
    ...[["Whispers", "whispers"], ["Canon", "canon"], ["Patches", "patches"], ["Established", "established"]].flatMap(([title, field]) => {
      const items = list(field!);
      return items.length ? [`**${title}**`, "", ...items.map(l => `- ${l}`), ""] : [`**${title}**: none.`, ""];
    }),
  ];
}

/**
 * The world's side (world-bridge-design §1.3), for a script that records it: per line, the rules'
 * dice lines, the act the rules resolved, what the place showed changed once the turn was done, who
 * reacted and how, the first words and the cost.
 */
function worldSide(r: LiveRecord): string[] {
  if (!r.script.worldSide) return [];
  const dice = (t: TurnRecord) => t.entries.filter(e => e.kind === "roll").map(e => cell(e.text)).join("<br>") || "none";
  return [
    "## The world",
    "",
    "Per line: the rules' dice lines (before the reply), the act the rules resolved (the path's step), what the place's rows showed changed once the turn was done, who reacted to the act and how, the first words from the line, and the turn's cost.",
    "",
    "| Turn | Line | The dice lines | The act | What the world showed | Reactions | First words | Cost |",
    "|---|---|---|---|---|---|---|---|",
    ...r.turns.filter(t => t.n > 0).map(t => `| ${t.n} | ${cell(lineOf(t))} | ${dice(t)} | ${t.act ?? "none"} | ${t.world?.length ? t.world.map(cell).join("; ") : "nothing changed"} | ${t.reactions ?? "none"} | ${since(t, t.firstAt)} | $${costOf(t.calls).toFixed(4)} |`),
    "",
  ];
}

function heldBack(r: LiveRecord): string[] {
  return [
    "## What the scene holds back",
    "",
    "Every note and line above is to be read against these: none should tell the player any of it before the scene has shown it.",
    "",
    "**The cast's secrets**",
    "",
    ...r.held.secrets.map(s => `- ${s.who}: ${s.text}`),
    "",
    `**What the scene needs the player to come across, and they haven't${r.held.essentials.length ? "" : ": nothing left"}**`,
    "",
    ...r.held.essentials.map(e => `- ${e.what} (with: ${e.with.join("; ")})`),
    "",
  ];
}

// ---------------------------------------------------------------------------------------------
// Words and numbers.

/** How a turn's notes and lines stood at the end (turn.notes, turn.suggest), in words. */
const NOTES: Record<string, string> = { none: "nothing to note", writing: "still being written", written: "written", lost: "lost: the job gave up" };
const LINES: Record<string, string> = {
  none: "none asked for: suggestions off, or the scene ending", coming: "still coming after 15 s", landed: "landed",
  dropped: "dropped: the scene had moved on", lost: "lost: the job gave up",
};

/** The line said, after the step that picked it when it was a suggested line ("act say_1 → …"). */
const lineOf = (t: TurnRecord) => `${t.step && t.step !== t.said ? `${t.step} → ` : ""}${t.said ?? ""}`;

function entryText(e: EntryRecord): string {
  if (e.kind === "player") return `> ${e.text}`;
  if (e.kind === "roll") return `*${e.text}*`;
  if (e.kind === "system") return `**— ${e.text} —**`;
  return e.text;
}

/** "gm.reply 1 ($0.0005), notes 1 ($0.0002)". */
function byOperation(calls: Call[]): string {
  const groups = new Map<string, Call[]>();
  for (const c of calls) groups.set(c.operation, [...(groups.get(c.operation) ?? []), c]);
  return [...groups].map(([op, cs]) => `${op} ${cs.length} ($${costOf(cs).toFixed(4)})`).join(", ");
}

const costOf = (calls: Call[]) => calls.reduce((sum, c) => sum + c.costUsd, 0);

/** Cost a call (or an ask), or "none". */
const perCall = (calls: Call[], count: number) => (count ? `$${(costOf(calls) / count).toFixed(5)} (${count})` : "none");

/** The value at a fraction of the way through the sorted values (nearest rank). */
export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** How long after the turn's start, in seconds (server times in microseconds). */
const since = (t: TurnRecord, at: number | undefined) => (at === undefined ? "" : `${((at - t.saidAt) / 1e6).toFixed(1)} s`);

/** A note's or a set's time after the reply, or how it stands when it has none (none, coming). */
const extra = (state: string, ms: number | undefined) => (ms === undefined ? state : `${secs(ms)}${state === "landed" || state === "written" ? "" : ` (${state})`}`);

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** Words in quotation marks, unless they're a spoken line in its own. */
const quoted = (words: string) => (/^[“"].*[”"]$/s.test(words) ? words : `“${words}”`);

const share = (part: number, whole: number) => (whole ? `${part} of ${whole} (${Math.round((100 * part) / whole)}%)` : "no spoken lines");

/** Text for a table's cell: its bars escaped, on one line. */
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");
