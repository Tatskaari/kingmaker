// After the prototype's src/report/inspect.ts at 44c6d4a: the summary (header, the screen as it was, the last turns, errors, failed and slow calls, calls by operation) and each part in full (callDetail, screensDetail, errorsDetail, callsList), read from the game's rows and the AI service's call log where it read the game's saves and calls.jsonl; a turn in full (the reply, the co-GM's roles and moves, the stage manager's operations) and a table's rows are new, its snapshots and world diffs gone with the saves.
import { turnKeyParts } from "../../shared/protocol/keys.ts";
import type { GameReport, Report } from "../../shared/report/format.ts";
import { bigOf } from "../../shared/report/rows.ts";
import { isWhole, type Call } from "../loop/calls.ts";

/**
 * Reading a report of a problem (V16, M5: `npm run report -- inspect`): a summary for investigating
 * first, then whatever's needed in full. The summary says what the player said, when, the build,
 * the settings and where they were (the screen and what was over it, the game, its scene and turn,
 * the map's tile, the fight's round), with the screen as it was; the last turns as the player saw
 * them (each line, what answered it, the dice) with each turn's calls; then the errors caught,
 * the failed and slow calls, and every operation's calls with what they cost. Each call has a
 * number (#n: its place among the report's whole calls) for `--call`, and each turn its number in
 * its scene for `--turn`, which shows the player's line, the reply, the co-GM's roles and moves and
 * the stage manager's operations.
 */

type Row = Record<string, unknown>;
interface Numbered { n: number; call: Call }

// ---------------------------------------------------------------------------------------------
// The summary.

export function summary(report: Report, options: { file?: string; turns?: number } = {}): string {
  return [
    header(report, options.file),
    screenNow(report),
    lastTurns(report, options.turns ?? 4),
    errorsSeen(report),
    callsSeen(report),
    "More: --turn <n> (or <scene>:<n>: the line, the reply, the co-GM's roles and moves, the stage manager's operations) · --call <n> (a call's whole prompt and answer) · --rows [<table>] · --errors · --screens · --calls · --docs [<path>] · --log · --turns <n> · --json",
  ].filter(Boolean).join("\n\n");
}

function header(report: Report, file?: string): string {
  const b = report.build, s = report.settings, game = gameOf(report);
  const settings = [s.glyphs ? `glyphs ${s.glyphs}` : "", s.terminal ? `terminal ${s.terminal.cols}x${s.terminal.rows}` : "", s.model ? `the GM ${s.model}` : "", s.reducedMotion ? "reduced motion" : ""].filter(Boolean);
  const lines = [
    `Report${file ? ` ${file}` : ""} (format ${report.format})`,
    `  The player said: ${JSON.stringify(report.words)}`,
    `  When: ${report.at.replace("T", " ").replace(/\.\d+Z$/, " UTC")}`,
    `  Build: ${b.commit ? b.commit.slice(0, 12) : b.stamp ? `stamp ${b.stamp}` : "commit unknown"}${b.dirty ? " (with local changes)" : ""}; ${HOSTS[b.host] ?? b.host}${b.node ? `; Node ${b.node}, ${b.platform}` : ""}`,
    ...(b.userAgent ? [`  Browser: ${b.userAgent}`] : []),
    ...(settings.length ? [`  Settings: ${settings.join(" · ")}`] : []),
    ...(Object.keys(s.env).length ? [`  Env: ${Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join(" ")}`] : []),
    `  Game: ${game ? `${game.id} (uid ${game.uid}), ${game.campaign}${playerSaid(report)}` : report.game && "error" in report.game ? `none in it: ${report.game.error}` : "none (no game had been played)"}`,
    `  Where: ${whereSaid(report)}`,
    ...(game ? [`  In it: ${inIt(game)}`] : []),
    `  Keys removed: ${report.redacted}`,
  ];
  return lines.join("\n");
}

const HOSTS: Record<string, string> = { terminal: "the terminal client", headless: "the headless client (npm run play)", page: "the page (a browser)" };

/** The player's character, as the game's rows have them: ": Wren Ashdown (human ranger 3…)". */
function playerSaid(report: Report): string {
  const player = rows(report, "player")[0];
  if (!player) return "";
  const sheet = rows(report, "sheet").find(s => idOf(s.playerId) === idOf(player.id));
  return `: ${String(player.name)}${sheet?.build ? ` (${String(sheet.build)})` : ""}`;
}

/** Where the player was, in words: the screen and what was over it, then where the game was. */
function whereSaid(report: Report): string {
  const w = report.where;
  const app = [`the ${w.screen} screen`, w.overlay ? `with ${w.overlay === "menu" ? "the Esc menu" : w.overlay} open` : "", w.latest ? "about the latest game" : "", w.watching ? `watching ${w.watching}'s game` : ""].filter(Boolean).join(", ");
  const scene = w.scene ? `in the scene ${w.scene.title}${w.scene.id ? ` (row ${w.scene.id})` : ""}${w.scene.talk ? ", a talk" : ""}, turn ${w.scene.turn ?? "?"} (${w.scene.phase ?? "?"})${w.scene.over ? ", over" : ""}` : "";
  const map = w.map ? `on the map ${w.map.key} at ${w.map.at.x},${w.map.at.y}` : "";
  const fight = w.fight ? `in a fight, round ${w.fight.round}${w.fight.turn ? `, ${w.fight.turn}'s turn` : ""} (${w.fight.status})` : "";
  const game = [scene, map, fight].filter(Boolean).join("; ") || "nowhere in particular";
  return `${app}. The game: ${game}${w.time ? `, ${w.time}` : ""}.${w.busy ? ` A turn under way: "${w.busy}".` : ""}${w.status ? ` The screen said: "${w.status}".` : ""}`;
}

/** What the game's report has in it: its rows, calls, memory reviews, docs and the host's log. */
function inIt(game: GameReport): string {
  const tables = Object.entries(game.rows).filter(([, list]) => list.length);
  const ai = "error" in game.ai ? [`the AI service's own couldn't be had: ${game.ai.error}`]
    : [`${game.ai.calls.calls.length} call lines${game.ai.calls.total.calls > game.ai.calls.calls.length ? ` (the last of ${game.ai.calls.total.calls})` : ""}`, `${game.ai.calls.reviews.length} memory reviews`, `${game.ai.docs.docs.length} docs`];
  return [`${tables.reduce((n, [, list]) => n + list.length, 0)} rows in ${tables.length} tables`, ...ai, ...(game.log ? [`${game.log.length} host log lines`] : [])].join(" · ");
}

/** The screen as it was reported from, or the last one noted before it. */
function screenNow(report: Report): string {
  const now = report.screens.now ?? report.screens.recent[report.screens.recent.length - 1]?.text;
  if (!now) return "(No screen in the report.)";
  const size = report.settings.terminal ? ` (${report.settings.terminal.cols}x${report.settings.terminal.rows})` : "";
  return `── ${report.screens.now !== undefined ? "The screen as it was" : "The last screen noted before it"}${size} ──\n${plain(now)}`;
}

/** Private-use glyphs (Kingmaker Glyphs' sprites, Nerd Font icons) as ¤: a terminal without the fonts can't show them. */
const plain = (text: string) => text.replace(/[\u{e000}-\u{f8ff}\u{f0000}-\u{10ffff}]/gu, "¤");

// ---------------------------------------------------------------------------------------------
// The last turns, and a turn in full.

/** The last `count` turns of the scene the player was in (or the game's latest), as they saw them, each with its calls. */
function lastTurns(report: Report, count: number): string | undefined {
  const scene = sceneOf(report);
  if (!scene) return undefined;
  const turns = turnsOf(report, scene).filter(t => Number(t.n) > 0);
  const shown = turns.slice(-count);
  const head = `── The last ${shown.length === 1 ? "turn" : `${shown.length} turns`} the player took in ${String(scene.title)} (of ${turns.length}), as they saw them ──`;
  if (!shown.length) return `${head}\n  (none yet: only its opening)\n${linesOf(report, scene, 0).map(l => `  ${l}`).join("\n")}`;
  return [head, ...shown.map(t => turnSaid(report, scene, t))].join("\n\n");
}

/** A turn in a few lines: its number, when, how it went; what was said and done; its calls. */
function turnSaid(report: Report, scene: Row, turn: Row): string {
  const calls = callsFor(report, scene, Number(turn.n));
  return [
    `Turn ${String(turn.n)} · ${String(scene.title)}${clockOf(turn.startedAt)} · ${String(turn.phase)}${turn.error ? `: ${String(turn.error)}` : ""}`,
    ...linesOf(report, scene, Number(turn.n)),
    ...(calls.length ? [`  calls: ${calls.map(callTag).join(" · ")}`] : []),
  ].join("\n");
}

/**
 * A turn in full (`--turn <n>`, or `<scene>:<n>` for another scene than the player's, by its row's id
 * or its key): the player's line and what answered it, the reply as the mouthpiece wrote it, the
 * co-GM's roles and moves, the stage manager's operations, its timing and its calls.
 */
export function turnDetail(report: Report, which: string): string {
  const [sceneAsked, nAsked] = which.includes(":") ? which.split(":") : [undefined, which];
  const scene = sceneOf(report, sceneAsked);
  if (!scene) throw new Error(`No scene ${sceneAsked ?? ""} in the report (its scenes: ${rows(report, "scene").map(s => `${idOf(s.id)} ${String(s.sceneKey)}`).join(", ") || "none"})`);
  const n = Number(nAsked);
  const turn = turnsOf(report, scene).find(t => Number(t.n) === n);
  if (!turn) throw new Error(`No turn ${nAsked} in ${String(scene.title)}: its turns are ${turnsOf(report, scene).map(t => String(t.n)).join(", ") || "none"}`);
  const calls = callsFor(report, scene, n);
  const of = (op: string) => calls.filter(c => c.call.operation === op);
  return [
    `Turn ${n} of ${String(scene.title)} (scene row ${idOf(scene.id)}, ${String(scene.sceneKey)}) · ${String(turn.phase)}${turn.error ? `: ${String(turn.error)}` : ""}${timing(turn)}`,
    section("What was said and done", linesOf(report, scene, n).join("\n") || "(nothing in the transcript)"),
    ...[...of("two-part.reply"), ...of("two-part.closing"), ...of("two-part.opening")].map(c => section(`The reply (${callTag(c)})`, c.call.error ? `failed: ${c.call.error}` : replyOf(c.call))),
    ...of("two-part.co-gm").map(c => section(`The co-GM (${callTag(c)})`, coGmOf(c.call))),
    ...of("world.stage").map(c => section(`The stage manager (${callTag(c)})`, opsOf(c.call))),
    section("Its calls", calls.map(c => `  ${callTag(c)}`).join("\n") || "  none in the report"),
  ].join("\n\n");
}

/** The transcript of a turn as the player saw it: their line, the GM's words and who said them, the dice, the system's words. */
function linesOf(report: Report, scene: Row, n: number): string[] {
  const names = namesOf(report);
  const player = String(rows(report, "player")[0]?.name ?? "The player");
  return rows(report, "transcript").filter(r => idOf(r.sceneId) === idOf(scene.id) && Number(r.turn) === n).sort((a, b) => Number(a.seq) - Number(b.seq)).map(r => {
    const text = String(r.text).replace(/\n+/g, "\n    ");
    switch (r.kind) {
      case "player": return `> ${player}: ${text}`;
      case "roll": return `  🎲 ${text}`;
      case "system": return `  — ${text} —`;
      case "dialogue": return `  ${names.get(String(r.speaker)) ?? String(r.speaker)}: ${text}`;
      default: return `  GM: ${text}`;
    }
  });
}

/** The reply as the mouthpiece wrote it: its narration (the structured call's), and the check it called with its outcomes. */
function replyOf(call: Call): string {
  const answer = parsedText(call);
  const narration = typeof answer?.narration === "string" ? answer.narration : call.text ?? "";
  const check = answer?.check as { skill?: string; dc?: number } | undefined;
  return `${narration}${check?.skill ? `\n(It called a check: ${check.skill} DC ${check.dc})` : ""}`;
}

/** The co-GM's tool calls: each role it set, and each move it made with what came of it. */
function coGmOf(call: Call): string {
  if (call.error) return `failed: ${call.error}`;
  const tools = call.calls ?? [];
  if (!tools.length) return "(it changed nothing)";
  return tools.map(t => {
    const a = (t.args ?? {}) as Record<string, unknown>;
    if (t.name === "update_character_role") return `  role ${String(a.char_id)}: ${String(a.status)} | ${String(a.mental_state)} | ${String(a.conversation_role)}`;
    if (t.name === "move_scene") return `  move ${String(a.route_id)} (${String(a.outcome)}): ${String(a.why)}\n    → ${typeof t.result === "string" ? t.result : JSON.stringify(t.result)}`;
    return `  ${t.name} ${JSON.stringify(a)}`;
  }).join("\n");
}

/** The stage manager's operations, from its answer. */
function opsOf(call: Call): string {
  if (call.error) return `failed: ${call.error}`;
  const ops = (parsedText(call)?.ops ?? []) as Array<Record<string, unknown>>;
  if (!ops.length) return "  nothing to change";
  return ops.map(o => `  ${[o.op, o.what || o.name, o.to ? `→ ${String(o.to)}` : "", o.how ? `(${String(o.how)})` : "", o.quantity ? `×${String(o.quantity)}` : "",
    (o.add as string[] | undefined)?.length ? `+${(o.add as string[]).join(" +")}` : "", (o.remove as string[] | undefined)?.length ? `-${(o.remove as string[]).join(" -")}` : "",
    o.text ? `"${String(o.text).slice(0, 120)}"` : ""].filter(Boolean).join(" ")}`).join("\n");
}

/** When the turn started, its first text and its end, and what it cost. */
function timing(turn: Row): string {
  const at = (v: unknown) => micros(v);
  const start = at(turn.startedAt), first = at(turn.firstTextAt), end = at(turn.endedAt);
  const after = (t: number | undefined) => (t !== undefined && start !== undefined ? ` +${((t - start) / 1e6).toFixed(1)} s` : "");
  return `${clockOf(turn.startedAt)}${first !== undefined ? ` → first text${after(first)}` : ""}${end !== undefined ? ` → done${after(end)}` : ""} · ${String(turn.calls ?? 0)} calls, $${(Number(bigOf(turn.costMicros) ?? 0) / 1e6).toFixed(4)}`;
}

// ---------------------------------------------------------------------------------------------
// Errors and calls.

function errorsSeen(report: Report): string {
  if (!report.errors.length) return "── Errors: none caught ──";
  const game = gameOf(report)?.id;
  return [`── Errors caught (${report.errors.length}, the newest last) ──`, ...report.errors.slice(-8).flatMap(e => [
    `  ${clock(e.at)} · ${e.where}${e.game && e.game !== game ? ` (in another game: ${e.game})` : !e.game ? " (no game on)" : ""}: ${e.message}`,
    ...(e.stack ?? "").split("\n").filter(l => /^\s+at /.test(l)).slice(0, 3).map(l => `      ${l.trim()}`),
  ])].join("\n");
}

function callsSeen(report: Report): string | undefined {
  const game = gameOf(report);
  if (!game || "error" in game.ai) return undefined;
  const calls = numbered(report);
  if (!calls.length) return "── Calls: none ──";
  const failed = calls.filter(c => c.call.error || c.call.warning);
  const slow = calls.filter(c => (c.call.latencyMs ?? 0) >= 8000 || (c.call.firstTextMs ?? 0) >= 3000).sort((a, b) => (b.call.latencyMs ?? 0) - (a.call.latencyMs ?? 0)).slice(0, 10);
  const parts: string[] = [];
  if (failed.length) parts.push([`── Failed or warned calls (${failed.length}) ──`, ...failed.slice(-12).map(c => `  ${clock(c.call.at)} ${callTag(c)}`)].join("\n"));
  if (slow.length) parts.push(["── Slow calls (8 s or more, or first text after 3 s) ──", ...slow.map(c => `  ${clock(c.call.at)} ${callTag(c)}`)].join("\n"));
  const cost = calls.reduce((n, c) => n + (c.call.costUsd ?? 0), 0);
  parts.push(["── Calls by operation ──", ...table(calls.map(c => c.call)), `  ${calls.length} calls, $${cost.toFixed(4)}${game.ai.calls.total.calls > game.ai.calls.calls.length ? ` (the call log's last ${game.ai.calls.calls.length} lines of ${game.ai.calls.total.calls})` : ""}`].join("\n"));
  return parts.join("\n\n");
}

function table(calls: Call[]): string[] {
  const byOp = new Map<string, Call[]>();
  for (const c of calls) byOp.set(c.operation ?? "?", [...(byOp.get(c.operation ?? "?") ?? []), c]);
  const out = [...byOp.entries()].sort((a, b) => b[1].length - a[1].length).map(([op, list]) => {
    const latencies = list.map(c => c.latencyMs).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
    const cost = list.reduce((n, c) => n + (c.costUsd ?? 0), 0);
    const failed = list.filter(c => c.error).length;
    return [op, String(list.length), latencies.length ? ms(latencies[Math.floor(latencies.length / 2)]!) : "-", latencies.length ? ms(latencies[latencies.length - 1]!) : "-", `$${cost.toFixed(4)}`, failed ? `${failed} failed` : ""];
  });
  const head = ["operation", "calls", "median", "slowest", "cost", ""];
  const widths = head.map((h, i) => Math.max(h.length, ...out.map(r => r[i]!.length)));
  return [head, ...out].map(r => `  ${r.map((cell, i) => cell.padEnd(widths[i]!)).join("  ").trimEnd()}`);
}

/** "#12 two-part.reply, 812 ms, first text 300 ms, $0.0012", flagged when it failed. */
function callTag({ n, call }: Numbered): string {
  const bits = [`#${n} ${call.operation ?? "?"}`];
  if (call.latencyMs !== undefined) bits.push(ms(call.latencyMs));
  if (call.firstTextMs) bits.push(`first text ${ms(call.firstTextMs)}`);
  if (call.costUsd) bits.push(`$${call.costUsd.toFixed(4)}`);
  if (call.error) bits.push(`FAILED: ${String(call.error).slice(0, 160)}`);
  if (call.warning) bits.push(String(call.warning));
  return bits.join(", ");
}

// ---------------------------------------------------------------------------------------------
// In full: a call, a table's rows, the errors, the screens, every call, the docs, the host's log.

/** A call in full: when, which key and turn, the model, its cost; its instructions, every message, the rest of the request; its tool calls, its answer, its error. */
export function callDetail(report: Report, n: number): string {
  const calls = numbered(report);
  const found = calls[n - 1];
  if (!found) throw new Error(`No call #${n}: the report has ${calls.length} (numbered from 1)`);
  const { call } = found;
  const { request, text, answers, error, calls: tools, ...rest } = call;
  const parts = call.key ? turnKeyParts(call.key) : undefined;
  const out = [[
    `Call #${n} of ${calls.length}: ${call.operation}${parts ? ` (scene row ${parts.scene}, turn ${parts.turn}, ${parts.step})` : ""}`,
    `  ${[call.at, call.key, call.attempt ? `attempt ${call.attempt}` : "", call.provider, call.model, call.effort ? `effort ${call.effort}` : ""].filter(Boolean).join(" · ")}`,
    `  ${[call.latencyMs !== undefined ? `latency ${ms(call.latencyMs)}` : "", call.firstTextMs ? `first text ${ms(call.firstTextMs)}` : "", call.costUsd !== undefined ? `$${call.costUsd.toFixed(6)}` : "", call.tokens ? `tokens ${JSON.stringify(call.tokens)}` : ""].filter(Boolean).join(" · ")}`,
  ].join("\n")];
  const req = request ?? {};
  if (req.instructions) out.push(section("Instructions", String(req.instructions)));
  for (const m of req.input ?? []) out.push(section(`Input (${m.role})`, typeof m.content === "string" ? m.content : JSON.stringify(m.content, null, 1)));
  const other = Object.fromEntries(Object.entries(req).filter(([k]) => !["instructions", "input"].includes(k)));
  if (Object.keys(other).length) out.push(section("The rest of the request", JSON.stringify(other, null, 1)));
  if (tools?.length) out.push(section("Its tool calls", tools.map(t => `${t.name} ${JSON.stringify(t.args)}\n  → ${typeof t.result === "string" ? t.result : JSON.stringify(t.result)}`).join("\n")));
  if (answers) out.push(section("Answers", JSON.stringify(answers, null, 1)));
  if (text !== undefined) out.push(section("The answer", text));
  if (error) out.push(section("Error", String(error)));
  const left = Object.fromEntries(Object.entries(rest).filter(([k]) => !["at", "key", "attempt", "provider", "operation", "model", "effort", "latencyMs", "firstTextMs", "costUsd", "tokens"].includes(k)));
  if (Object.keys(left).length) out.push(section("The rest of the call", JSON.stringify(left, null, 1)));
  return out.join("\n\n");
}

/** A table's rows in full (its u64s as their digits), or, with no table, every table and how many rows it has. */
export function rowsDetail(report: Report, table?: string): string {
  const game = gameOf(report);
  if (!game) throw new Error("The report has no game's rows in it.");
  if (!table) return Object.entries(game.rows).map(([name, list]) => `${name.padEnd(18)} ${list.length}`).join("\n");
  const list = game.rows[table];
  if (!list) throw new Error(`No table ${table} in the report: there's ${Object.keys(game.rows).join(", ")}`);
  return JSON.stringify(list, (_k, v: unknown) => bigOf(v) ?? v, 1);
}

export function errorsDetail(report: Report): string {
  if (!report.errors.length) return "No errors were caught.";
  return report.errors.map(e => `${e.at} · ${e.where}${e.game ? ` (game ${e.game})` : ""}\n${e.stack ?? e.message}`).join("\n\n");
}

export function screensDetail(report: Report): string {
  const shots = [...report.screens.recent.map(s => ({ title: `${clock(s.at)} · ${s.screen}`, text: s.text })), ...(report.screens.now !== undefined ? [{ title: "as it was reported", text: report.screens.now }] : [])];
  if (!shots.length) return "No screens in the report.";
  return shots.map(s => `── ${s.title} ──\n${plain(s.text)}`).join("\n\n");
}

/** Every call, a line each: when, which turn, its tag. */
export function callsList(report: Report): string {
  return numbered(report).map(c => {
    const parts = c.call.key ? turnKeyParts(c.call.key) : undefined;
    return `${clock(c.call.at)} ${parts ? `s${parts.scene} t${parts.turn} ${parts.step}`.padEnd(18) : "".padEnd(18)} ${callTag(c)} ${c.call.model ?? ""}`.trimEnd();
  }).join("\n") || "No calls.";
}

/** The game's docs: their paths, or one in full. */
export function docsDetail(report: Report, path?: string): string {
  const game = gameOf(report);
  if (!game || "error" in game.ai) return "No docs in the report.";
  const docs = game.ai.docs.docs;
  if (!path) return docs.map(d => d.path).join("\n") || "No docs: the game hadn't written any.";
  const doc = docs.find(d => d.path === path);
  if (!doc) throw new Error(`No doc ${path}: there's ${docs.map(d => d.path).join(", ")}`);
  return doc.text;
}

/** The host's own latest log lines (the page host's). */
export function logDetail(report: Report): string {
  return gameOf(report)?.log?.join("\n") || "No host log in the report (a terminal's game: its stack's logs are its own).";
}

// ---------------------------------------------------------------------------------------------
// Helpers.

/** The report's game, when it has one. */
export function gameOf(report: Report): GameReport | undefined {
  return report.game && !("error" in report.game) ? report.game : undefined;
}

const rows = (report: Report, table: string): Row[] => gameOf(report)?.rows[table] ?? [];

/** An id as its digits: a tagged u64's, or what it is. */
const idOf = (value: unknown): string => bigOf(value) ?? String(value);

/** The scene asked for (its row's id or key), else the one the player was in, else the game's latest. */
function sceneOf(report: Report, asked?: string): Row | undefined {
  const scenes = rows(report, "scene");
  if (asked) return scenes.find(s => idOf(s.id) === asked || s.sceneKey === asked);
  const here = report.where.scene?.id;
  return scenes.find(s => idOf(s.id) === here) ?? [...scenes].sort((a, b) => Number(idOf(b.id)) - Number(idOf(a.id)))[0];
}

const turnsOf = (report: Report, scene: Row) => rows(report, "turn").filter(t => idOf(t.sceneId) === idOf(scene.id)).sort((a, b) => Number(a.n) - Number(b.n));

/** The cast's names by their keys, as the game's entities have them. */
const namesOf = (report: Report) => new Map(rows(report, "entity").map(e => [String(e.key), String(e.name)]));

/** The report's whole calls (an answer, a failure or tool calls: not a call going out or a try again), numbered from 1. */
function numbered(report: Report): Numbered[] {
  const game = gameOf(report);
  const calls = game && !("error" in game.ai) ? (game.ai.calls.calls as Call[]) : [];
  return calls.filter(isWhole).map((call, i) => ({ n: i + 1, call }));
}

/** A turn's calls: those keyed to its scene's row and its number. */
function callsFor(report: Report, scene: Row, n: number): Numbered[] {
  return numbered(report).filter(c => { const p = c.call.key ? turnKeyParts(c.call.key) : undefined; return p?.scene === idOf(scene.id) && p.turn === n; });
}

/** A structured call's answer, parsed (the mouthpiece's narration, the stage manager's ops). */
function parsedText(call: Call): Record<string, unknown> | undefined {
  try { return JSON.parse(call.text ?? "") as Record<string, unknown>; } catch { return undefined; }
}

/** A Timestamp as the report keeps it (its micros), as microseconds. */
function micros(value: unknown): number | undefined {
  const big = bigOf((value as { __timestamp_micros_since_unix_epoch__?: unknown } | undefined)?.__timestamp_micros_since_unix_epoch__);
  return big === undefined ? undefined : Number(big);
}

/** " · 15:02:01" from a row's Timestamp; nothing without one. */
function clockOf(value: unknown): string {
  const at = micros(value);
  return at === undefined ? "" : ` · ${new Date(at / 1000).toISOString().slice(11, 19)}`;
}

const section = (title: string, body: string) => `── ${title} ──\n${body}`;
const ms = (n: number | null | undefined) => (n === null || n === undefined ? "-" : n >= 10000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`);
const clock = (iso: string | undefined) => (iso ? iso.slice(11, 19) : "--:--:--");
