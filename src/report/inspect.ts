import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { sceneById } from "../../scenes/index.ts";
import { describeRoll } from "../runtime/dice.ts";
import type { Entry, SessionState, TurnMetric } from "../runtime/session.ts";
import { asciiMap, type Entity, type SceneWorld, type WorldEvent } from "../world/scene-world.ts";
import { REPORT_KIND, reportsDir, type Dump } from "./dump.ts";

/**
 * Reading a report (src/cli/report.ts inspect): a summary for investigating, then whatever's needed
 * in full. The summary says:
 *
 * - what the player said, the build, the settings, and where they were (the mode, the scene, its
 *   beat and turn), with the screen as it was;
 * - the last turns: the player's lines, the decider's answers, the mechanics and the rules' lines,
 *   the GM's reply, and the stage manager's operations with what came of them ("(not done)");
 * - the world's changes; on the map, What happens; in a fight, its last lines; in the zoo, its state;
 * - errors, and failed or slow calls, with their latency and cost.
 *
 * Calls go with the turn whose player's words their request holds (the latest such turn), and the
 * calls without any (a scene's opening) with the call before them. Each has a number (#n, its place
 * in the report's calls) for callDetail.
 */

type Json = Record<string, unknown>;
type Call = Json & { at?: string; operation?: string; provider?: string; model?: string; latencyMs?: number; firstTextMs?: number | null; costUsd?: number; error?: string; text?: string; request?: Json; answers?: Record<string, Answer> };
interface Answer { choice: string; probabilities?: Record<string, number>; confidence?: number }

// ---------------------------------------------------------------------------------------------
// Finding and reading a report

/**
 * A report's file from what was said of it: a path; or a name in runs/reports (KM_RUNS_DIR's), or
 * in ~/Downloads (the static build's download); or "latest", the newest of those.
 */
export function findReport(said: string): string {
  if (said === "latest") {
    const found = listReports()[0];
    if (!found) throw new Error(`No reports in ${reportsDir()} or ~/Downloads yet.`);
    return found.path;
  }
  const name = said.replace(/^report\s+/, "").trim();
  for (const path of [resolve(name), join(reportsDir(), name), join(homedir(), "Downloads", name)]) if (existsSync(path) && statSync(path).isFile()) return path;
  throw new Error(`No report "${name}" (looked as given, in ${reportsDir()} and in ~/Downloads)`);
}

/** Reports on this machine, newest first: runs/reports, and the static build's downloads. */
export function listReports(): Array<{ path: string; file: string; mtimeMs: number }> {
  const dirs = [reportsDir(), join(homedir(), "Downloads")];
  return dirs.flatMap(dir => {
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return []; }
    return names.filter(f => f.endsWith(".json.gz") && (dir === dirs[0] || f.startsWith("kingmaker-report-")))
      .map(file => ({ path: join(dir, file), file, mtimeMs: statSync(join(dir, file)).mtimeMs }));
  }).sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function readDump(path: string): Dump {
  const bytes = readFileSync(path);
  const text = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
  const dump = JSON.parse(text) as Dump;
  if (dump.kind !== REPORT_KIND) throw new Error(`${basename(path)} isn't a Kingmaker report (no "kind": "${REPORT_KIND}")`);
  return dump;
}

// ---------------------------------------------------------------------------------------------
// The summary

export function summary(dump: Dump, options: { file?: string; turns?: number } = {}): string {
  return [
    header(dump, options.file),
    screenNow(dump),
    lastTurns(dump, options.turns ?? 4),
    onTheMap(dump),
    theFight(dump),
    theZoo(dump),
    worldChanges(dump),
    errorsSeen(dump),
    callsSeen(dump),
    "More: --call <n> (a call's whole prompt and reply) · --snapshot <turn> · --diff <turn> [<turn>] (the world between turns) · --turns <n> · --screens · --errors · --calls · --json",
  ].filter(Boolean).join("\n\n");
}

function header(dump: Dump, file?: string): string {
  const b = dump.build, s = dump.settings, game = dump.game;
  const session = state(dump);
  const lines = [
    `Report${file ? ` ${file}` : ""} (format ${dump.format})`,
    `  The player said: ${JSON.stringify(dump.words)}`,
    `  When: ${dump.at.replace("T", " ").replace(/\.\d+Z$/, " UTC")}`,
    `  Build: ${b.commit ? b.commit.slice(0, 12) : "commit unknown"}${b.dirty ? " (with local changes)" : ""}${b.stamp ? `, stamp ${b.stamp}` : ""}; ${HOSTS[b.host] ?? b.host}${b.node ? `; Node ${b.node}, ${b.platform}` : ""}`,
    `  Settings: ${[s.approach ? `approach ${s.approach}` : "", s.glyphs ? `glyphs ${s.glyphs}` : "", s.terminal ? `terminal ${s.terminal.cols}x${s.terminal.rows}` : "", s.window ? `window ${s.window}` : "", s.offline ? "offline (no GM)" : "the GM online"].filter(Boolean).join(" · ")}`,
    ...(s.userAgent ? [`  Browser: ${s.userAgent}`] : []),
    ...(Object.keys(s.env).length ? [`  Env: ${Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join(" ")}`] : []),
    `  Game: ${game ? `${game.id}${session?.player ? `: ${session.player.name}${session.player.build ? ` (${session.player.build})` : ""}` : ""}${dump.where.place?.hub ? `, a ${dump.where.place.hub} visit` : ""}` : "none (no game had been played)"}`,
    `  Where: ${whereSaid(dump)}`,
  ];
  if (game) {
    const folder = [
      ["game.json", game.files.game], ["state.json", game.files.state], ["app.json", game.files.app],
    ].filter(([, v]) => v !== undefined).map(([name, v]) => `${name}${(v as Json)?.["unreadable"] !== undefined ? " (unreadable!)" : ""}`);
    lines.push(`  In its folder: ${[...folder, `${game.snapshots.length} snapshots`, `${game.calls.kept.length} calls${game.calls.total > game.calls.kept.length ? ` (the last of ${game.calls.total})` : ""}`,
      `${game.memoryReviews.length} memory reviews`, `${game.repairs.length} co-GM reviews`, `${game.docs.length} docs`, `${game.ledger.length} ledger lines`, ...game.others].join(" · ")}`);
    if (game.live) lines.push("  A turn was under way: its game and session as they were in memory are in the report too (game.live), beside the last save.");
  }
  lines.push(`  Keys removed: ${dump.redacted}`);
  return lines.join("\n");
}

const HOSTS: Record<string, string> = { terminal: "the terminal app", server: "the server's game (npm run web)", static: "the static build (a browser)" };

/** Where the player was, in words: the app's screen, and where the game was. */
function whereSaid(dump: Dump): string {
  const w = dump.where, p = w.place ?? {};
  const scene = p.scene ? `${titleOf(p.scene)} (${p.scene})` : undefined;
  const game = p.mode === "scene" ? `in ${p.talk ? `a talk with ${p.talk}, ` : ""}the scene ${scene}, beat ${p.beat}, turn ${p.turn} (${p.turnsInBeat ?? 0} in the beat)${p.ended ? `; it had ended (${p.ended}) and the story hadn't moved on` : ""}`
    : p.mode === "combat" ? `in a fight${w.fight ? ` (round ${w.fight.round}${w.fight.turn ? `, ${w.fight.turn}'s turn` : ""})` : ""} ${p.fightOnMap ? `on the map, ${p.map} (${p.at?.x},${p.at?.y})` : `from the scene ${scene}`}`
    : p.mode === "explore" ? `on the map, ${p.map} (${p.at?.x},${p.at?.y})${p.lead ? `; the lead: ${titleOf(p.lead)}` : ""}`
    : p.mode === "end" ? "at The End" : "no game";
  const app = [
    w.screen === "saves" ? "made from the game's saves (npm run report -- make), not in the game" : `the ${w.screen} screen${w.overlay ? ` with the ${w.overlay} open` : ""}`,
    w.latest ? "about the latest game" : "",
    w.busy ? `a turn under way ("${w.busy}")` : "",
    w.over ? `the scene over (${w.over}), waiting to go on` : "",
    w.status ? `the screen said "${w.status}"` : "",
  ].filter(Boolean).join("; ");
  return `${app}. The game: ${game}${p.time ? `, ${p.time}` : ""}.`;
}

/** The screen as it was reported from, or (when it couldn't be read just then) the last one noted before it. */
function screenNow(dump: Dump): string {
  const now = dump.screens.now ?? dump.screens.recent.at(-1)?.text;
  if (!now) return "(No screen in the report.)";
  const size = dump.settings.terminal ? ` (${dump.settings.terminal.cols}x${dump.settings.terminal.rows})` : "";
  return `── ${dump.screens.now ? "The screen as it was" : "The last screen noted before it"}${size} ──\n${plain(now)}`;
}

/** Private-use glyphs (Kingmaker Glyphs' sprites, Nerd Font icons) as ¤: a terminal without the fonts can't show them. */
const plain = (text: string) => text.replace(/[\u{e000}-\u{f8ff}\u{f0000}-\u{10ffff}]/gu, "¤");

// ---------------------------------------------------------------------------------------------
// The last turns

interface Group { scene: string; turn: number; entries: Entry[] }

/** The transcript in groups: what the player said or did in a turn and all that answered it, or what came without a turn (a scene's opening). */
function groupsOf(session: SessionState): Group[] {
  const groups: Group[] = [];
  for (const e of session.transcript ?? []) {
    const scene = e.scene ?? session.sceneId;
    const last = groups.at(-1);
    if (last && last.scene === scene && last.turn === e.turn && e.kind !== "player") last.entries.push(e);
    else groups.push({ scene, turn: e.turn, entries: [e] });
  }
  return groups;
}

/** Each call's turn: the latest turn whose player's words its request holds; a call with none goes with the one before it. */
function turnsOfCalls(calls: Call[], session: SessionState): number[] {
  const said = (session.transcript ?? []).filter(e => e.kind === "player" && e.text.trim().length >= 4)
    .map(e => ({ turn: e.turn, needle: JSON.stringify(e.text).slice(1, -1) })).sort((a, b) => b.turn - a.turn);
  let last = 0;
  return calls.map(call => {
    const blob = call.request ? JSON.stringify(call.request) : "";
    const hit = blob ? said.find(s => blob.includes(s.needle)) : undefined;
    if (hit) last = hit.turn;
    return hit ? hit.turn : last;
  });
}

/** The last `count` turns the player took, with what came between them (a scene's opening, how it ended). */
function lastTurns(dump: Dump, count: number): string | undefined {
  const session = state(dump);
  if (!session?.transcript?.length) return undefined;
  const calls = callsOf(dump);
  const turnOf = turnsOfCalls(calls, session);
  const logs = worldLogs(dump);
  const all = groupsOf(session);
  const taken = all.filter(isTurn);
  const from = taken.length > count ? all.indexOf(taken.at(-count)!) : 0;
  const groups = all.slice(from).slice(taken.length ? 0 : -count * 2);
  // A turn's calls go with its player's line; the calls of a turn the player didn't take (the first
  // scene's opening) with what came. With no turns taken at all, there's nothing to tie calls to:
  // they're in the lists of calls below.
  const home = new Map<number, Group>();
  if (taken.length) for (const g of all) if (!home.has(g.turn) || (isTurn(g) && !isTurn(home.get(g.turn)!))) home.set(g.turn, g);
  const shown = Math.min(count, taken.length);
  const out = [taken.length ? `── The last ${shown === 1 ? "turn" : `${shown} turns`} the player took (of ${taken.length}), with what came between ──` : "── No turns taken: what the transcript has ──"];
  for (const g of groups) {
    const player = isTurn(g) ? g.entries[0] : undefined;
    const mine = calls.map((call, i) => ({ n: i + 1, call })).filter((_, i) => turnOf[i] === g.turn && home.get(g.turn) === g);
    const metric = player ? (session.metrics ?? []).find(m => m.turn === g.turn) : undefined;
    const steps = player ? (session.path ?? []).filter(p => p.turn === g.turn) : [];
    out.push(turnSaid(session, g, player, mine, metric, steps, (logs.get(g.scene) ?? []).filter(l => l.turn === g.turn && home.get(g.turn) === g)));
  }
  return out.join("\n\n");
}

const isTurn = (g: Group) => g.entries[0]?.kind === "player";

const DECIDER = new Set(["director.before"]);
const AFTER = new Set(["director.after"]);
const STAGE = new Set(["world.stage"]);
const isGm = (op: string) => /^(gm\.|narrator\.|actor\.)/.test(op);

/** One turn: the player's line, the decider's answers, the rules, the GM's reply, the decision after it, the stage manager's operations and what came of them. */
function turnSaid(session: SessionState, g: Group, player: Entry | undefined, calls: Array<{ n: number; call: Call }>, metric: TurnMetric | undefined,
  steps: SessionState["path"], world: WorldEvent[]): string {
  const scene = titleOf(g.scene);
  const head = player
    ? `Turn ${g.turn} · ${scene}${calls[0]?.call.at ? ` · ${clock(calls[0].call.at)}` : ""}`
    : `${g.entries.some(e => e.kind === "narration") ? "The GM, between turns" : "Between turns"} (after turn ${g.turn}) · ${scene}`;
  const lines = [head];
  if (player) lines.push(`> ${session.player?.name ?? "The player"}: ${player.text}`);
  const by = (set: (op: string) => boolean) => calls.filter(c => set(String(c.call.operation)));
  const decided = (what: string, c: { n: number; call: Call }) => `  ${what} (${callTag(c)})${c.call.error ? "" : `: ${answersSaid(c.call)}`}`;
  for (const c of by(op => DECIDER.has(op))) lines.push(decided("decider", c));
  for (const c of by(op => op.startsWith("director.") && !DECIDER.has(op) && !AFTER.has(op))) lines.push(decided(String(c.call.operation).slice(9), c));
  for (const s of steps) lines.push(`  path: ${s.from === s.to ? s.via : `${s.from} → ${s.to} via ${s.via}`}${s.roll ? ` (${describeRoll(s.roll)})` : ""} [${s.source}]`);
  const gm = by(isGm);
  for (const e of g.entries.slice(player ? 1 : 0)) {
    if (e.kind === "roll") lines.push(`  🎲 ${e.text}`);
    else if (e.kind === "system") lines.push(`  — ${e.text} —`);
    else if (e.kind === "dialogue") lines.push(`  ${castName(e.speaker, g.scene)}: ${e.text}`);
    else if (e.kind === "narration") lines.push(`  GM${gm.length ? ` (${gm.map(callTag).join("; ")})` : ""}:\n${indent(e.text, 4)}`);
    else if (e.kind === "player") lines.push(`> ${e.text}`);
  }
  if (!g.entries.some(e => e.kind === "narration" || e.kind === "dialogue") && (player || gm.length)) lines.push(`  (no reply from the GM${gm.length ? `: ${gm.map(callTag).join("; ")}` : ""})`);
  for (const c of by(op => AFTER.has(op))) lines.push(decided("after", c));
  for (const c of by(op => STAGE.has(op))) lines.push(`  stage (${callTag(c)})${c.call.error ? "" : `: ${opsSaid(c.call)}`}`);
  for (const l of world) lines.push(`    → ${l.by}: ${l.text}`);
  const rest = calls.filter(c => { const op = String(c.call.operation); return !op.startsWith("director.") && !isGm(op) && !STAGE.has(op); });
  if (rest.length) lines.push(`  also: ${rest.map(callTag).join(" · ")}`);
  if (metric) lines.push(`  timing: decided ${ms(metric.preDecisionMs)} · first text ${ms(metric.firstTextMs)} · reply ${ms(metric.replyMs)} · after ${ms(metric.postDecisionMs)} · $${metric.costUsd.toFixed(4)} over ${metric.calls} calls`);
  return lines.join("\n");
}

/** "#12 director.before, 320 ms, $0.0004", flagged when it failed. */
function callTag({ n, call }: { n: number; call: Call }): string {
  const bits = [`#${n} ${call.operation ?? "?"}`];
  if (call.latencyMs !== undefined) bits.push(ms(call.latencyMs));
  if (call.firstTextMs) bits.push(`first text ${ms(call.firstTextMs)}`);
  if (call.costUsd) bits.push(`$${call.costUsd.toFixed(4)}`);
  if (call.error) bits.push(`FAILED: ${String(call.error).slice(0, 160)}`);
  if (call.warning) bits.push(String(call.warning));
  return bits.join(", ");
}

const NEUTRAL = new Set(["none", "not_yet", "on_track", "in_character", "covered", "harmless", "here", "no", "nothing"]);

/** A decision's answers: the ones that say something first, with how sure; the quiet ones after, in brackets. */
function answersSaid(call: Call): string {
  if (call.error) return `failed: ${call.error}`;
  const answers = Object.entries(call.answers ?? {});
  if (!answers.length) return call.text ? JSON.stringify(call.text).slice(0, 300) : "(no answers)";
  const said = ([q, a]: [string, Answer]) => `${q}=${a.choice}${a.probabilities?.[a.choice] !== undefined ? ` ${p(a.probabilities[a.choice]!)}` : ""}`;
  const loud = answers.filter(([, a]) => !NEUTRAL.has(a.choice));
  const quiet = answers.filter(([, a]) => NEUTRAL.has(a.choice));
  return `${loud.length ? loud.map(said).join(" · ") : "nothing out of the way"}${quiet.length ? ` [${quiet.map(([q, a]) => `${q}=${a.choice}`).join(" ")}]` : ""}`;
}

/** The stage manager's operations, from its reply. */
function opsSaid(call: Call): string {
  if (call.error) return `failed: ${call.error}`;
  let ops: Array<Record<string, unknown>> = [];
  try { ops = (JSON.parse(String(call.text ?? "{}")) as { ops?: Array<Record<string, unknown>> }).ops ?? []; } catch { return `(unreadable: ${String(call.text).slice(0, 200)})`; }
  if (!ops.length) return "nothing to change";
  return ops.map(o => [o["op"], o["what"] || o["name"], o["to"] ? `→ ${o["to"]}` : "", o["how"] ? `(${o["how"]})` : "", o["quantity"] ? `×${o["quantity"]}` : "",
    (o["add"] as string[] | undefined)?.length ? `+${(o["add"] as string[]).join(" +")}` : "", (o["remove"] as string[] | undefined)?.length ? `-${(o["remove"] as string[]).join(" -")}` : "",
    o["text"] ? `"${String(o["text"]).slice(0, 120)}"` : ""].filter(Boolean).join(" ")).join("; ");
}

// ---------------------------------------------------------------------------------------------
// The map, the fight, the zoo, the world

function onTheMap(dump: Dump): string | undefined {
  const app = dump.game?.files.app as { messages?: string[] } | undefined;
  const game = (dump.game?.live?.game ?? dump.game?.files.game) as { mode?: string; explore?: { log?: string[] } } | undefined;
  if (!app?.messages?.length || (game?.mode !== "explore" && dump.where.screen !== "explore")) return undefined;
  const lines = ["── On the map: What happens (the newest last) ──", ...app.messages.slice(-8).map(m => `  ${m}`)];
  if (game?.explore?.log?.length) lines.push("  The way they came:", ...game.explore.log.slice(-5).map(l => `    ${l}`));
  return lines.join("\n");
}

function theFight(dump: Dump): string | undefined {
  const game = (dump.game?.live?.game ?? dump.game?.files.game) as { combat?: { combat?: { G?: FightG } } } | undefined;
  const G = game?.combat?.combat?.G;
  if (!G) return undefined;
  const lines = [`── The fight: ${G.map?.name ?? "?"}, round ${G.round}${G.outcome ? `, over (${G.outcome})` : ""} ──`];
  for (const id of G.order ?? []) {
    const u = G.units?.[id];
    if (u) lines.push(`  ${id === G.order?.[G.active ?? -1] ? "▶" : " "} ${u.name} [${id}] ${u.side}: HP ${u.hp}/${u.maxHp}, ${u.state} at ${u.at?.x},${u.at?.y}${u.conditions?.length ? ` (${u.conditions.join(", ")})` : ""}`);
  }
  if (G.error) lines.push(`  last refused: ${G.error}`);
  lines.push("  Its last lines:", ...(G.log ?? []).slice(-14).map(l => `    r${l.round} ${l.kind}: ${l.text}`));
  return lines.join("\n");
}
interface FightG {
  round: number; active?: number; order?: string[]; outcome?: string; error?: string; map?: { name?: string };
  units?: Record<string, { name: string; side: string; hp: number; maxHp: number; state: string; at?: { x: number; y: number }; conditions?: string[] }>;
  log?: Array<{ round: number; kind: string; text: string }>;
}

function theZoo(dump: Dump): string | undefined {
  const z = dump.zoo as { wing?: string; seen?: string[]; news?: { seq: number; map: string; lines: string[] }; show?: unknown; fight?: unknown; turns?: Record<string, number> } | undefined;
  if (!z) return undefined;
  return [
    `── The zoo: in ${z.wing ?? "?"}; ${z.seen?.length ?? 0} exhibits seen ──`,
    ...(z.news ? [`  The last thing set off (#${z.news.seq}, in ${z.news.map}):`, ...z.news.lines.map(l => `    ${l}`)] : []),
    ...(z.show ? [`  Shown beyond the map: ${JSON.stringify(z.show)}`] : []),
    ...(z.fight ? [`  A ring's fight: ${JSON.stringify(z.fight)}`] : []),
    `  Seen: ${(z.seen ?? []).join(", ") || "nothing yet"}`,
  ].join("\n");
}

/** The world's log (the rules' and the stage manager's changes, "(not done)" too), by scene: the latest of the game's state and its snapshots. */
function worldLogs(dump: Dump): Map<string, WorldEvent[]> {
  const logs = new Map<string, WorldEvent[]>();
  const states = [...(dump.game?.snapshots ?? []).map(s => s.state), state(dump)] as Array<SessionState | undefined>;
  for (const s of states) if (s?.world?.log) logs.set(s.world.scene, s.world.log);
  return logs;
}

function worldChanges(dump: Dump): string | undefined {
  const session = state(dump);
  const world = session?.world;
  if (!world?.log.length) return undefined;
  const recent = world.log.slice(-24);
  return [`── The world's changes (${titleOf(world.scene)}; the last ${recent.length} of ${world.log.length}) ──`, ...recent.map(l => `  turn ${l.turn} · ${l.by}: ${l.text}`)].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Errors and calls

function errorsSeen(dump: Dump): string | undefined {
  if (!dump.errors.length) return "── Errors: none caught ──";
  return [`── Errors caught this sitting (${dump.errors.length}, the newest last) ──`, ...dump.errors.slice(-8).flatMap(e => [
    `  ${clock(e.at)} · ${e.where}${elsewhere(dump, e.game)}: ${e.message}`,
    ...(e.stack ?? "").split("\n").filter(l => /^\s+at /.test(l)).slice(0, 3).map(l => `      ${l.trim()}`),
  ])].join("\n");
}

/** " (in another game: <id>)", for an error caught while another game was being played, or on the title. */
const elsewhere = (dump: Dump, game: string | undefined) => (game === dump.game?.id ? "" : game ? ` (in another game: ${game})` : " (no game on)");

function callsSeen(dump: Dump): string | undefined {
  const calls = callsOf(dump);
  if (!calls.length) return dump.game ? "── Calls: none ──" : undefined;
  const numbered = calls.map((call, i) => ({ n: i + 1, call }));
  const failed = numbered.filter(c => c.call.error || c.call.retry || c.call.warning);
  const slow = numbered.filter(c => (c.call.latencyMs ?? 0) >= 8000 || (c.call.firstTextMs ?? 0) >= 3000).sort((a, b) => (b.call.latencyMs ?? 0) - (a.call.latencyMs ?? 0)).slice(0, 10);
  const parts: string[] = [];
  if (failed.length) parts.push([`── Failed, retried or warned calls (${failed.length}) ──`, ...failed.slice(-12).map(c => `  ${clock(c.call.at)} ${callTag(c)}${c.call.retry ? `: retry ${c.call.retry} after HTTP ${c.call.status}` : ""}`)].join("\n"));
  if (slow.length) parts.push([`── Slow calls (8 s or more, or first text after 3 s) ──`, ...slow.map(c => `  ${clock(c.call.at)} ${callTag(c)}`)].join("\n"));
  const cost = calls.reduce((n, c) => n + (c.costUsd ?? 0), 0);
  const ledger = (dump.game?.ledger ?? []).reduce((n, l) => n + Number(l["costUsd"] ?? 0), 0);
  parts.push(["── Calls by operation ──", ...table(numbered.map(c => c.call)),
    `  ${calls.length} calls${dump.game && dump.game.calls.total > calls.length ? ` (the last of ${dump.game.calls.total})` : ""}, $${cost.toFixed(4)}; the cost ledger has $${ledger.toFixed(4)} over ${dump.game?.ledger.length ?? 0} lines for this game`].join("\n"));
  return parts.join("\n\n");
}

function table(calls: Call[]): string[] {
  const byOp = new Map<string, Call[]>();
  for (const c of calls) byOp.set(String(c.operation ?? "?"), [...(byOp.get(String(c.operation ?? "?")) ?? []), c]);
  const rows = [...byOp.entries()].sort((a, b) => b[1].length - a[1].length).map(([op, list]) => {
    const latencies = list.map(c => c.latencyMs).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
    const cost = list.reduce((n, c) => n + (c.costUsd ?? 0), 0);
    const failed = list.filter(c => c.error).length;
    return [op, String(list.length), latencies.length ? ms(latencies[Math.floor(latencies.length / 2)]!) : "-", latencies.length ? ms(latencies.at(-1)!) : "-", `$${cost.toFixed(4)}`, failed ? `${failed} failed` : ""];
  });
  const head = ["operation", "calls", "median", "slowest", "cost", ""];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i]!.length)));
  return [head, ...rows].map(r => `  ${r.map((cell, i) => cell.padEnd(widths[i]!)).join("  ").trimEnd()}`);
}

// ---------------------------------------------------------------------------------------------
// In full: a call, a snapshot, the world between turns, the screens, the errors, every call

/** A call's whole prompt and reply (or state, questions and answers, for a decision). */
export function callDetail(dump: Dump, n: number): string {
  const calls = callsOf(dump);
  const call = calls[n - 1];
  if (!call) throw new Error(`No call #${n}: the report has ${calls.length} (numbered from 1)`);
  const session = state(dump);
  const turn = session ? turnsOfCalls(calls, session)[n - 1] : undefined;
  const { request, text, answers, error, ...rest } = call;
  const out = [[
    `Call #${n} of ${calls.length}: ${call.operation}${turn ? ` (turn ${turn})` : ""}`,
    `  ${[call.at, call.provider, call.model, rest["effort"] ? `effort ${rest["effort"]}` : ""].filter(Boolean).join(" · ")}`,
    `  ${[call.latencyMs !== undefined ? `latency ${ms(call.latencyMs)}` : "", call.firstTextMs ? `first text ${ms(call.firstTextMs)}` : "", call.costUsd !== undefined ? `$${call.costUsd}` : "", rest["tokens"] ? `tokens ${JSON.stringify(rest["tokens"])}` : ""].filter(Boolean).join(" · ")}`,
  ].join("\n")];
  const req = request ?? {};
  if (req["instructions"]) out.push(section("Instructions", String(req["instructions"])));
  for (const m of (req["input"] as Array<{ role: string; content: string }> | undefined) ?? []) out.push(section(`Input (${m.role})`, typeof m.content === "string" ? m.content : JSON.stringify(m.content, null, 1)));
  if (req["state"] !== undefined) out.push(section("State", typeof req["state"] === "string" ? req["state"] : JSON.stringify(req["state"], null, 1)));
  if (req["questions"]) out.push(section("Questions", questionsSaid(req["questions"] as Record<string, { instructions?: string; criteria?: Record<string, string> }>)));
  const other = Object.fromEntries(Object.entries(req).filter(([k]) => !["instructions", "input", "state", "questions"].includes(k)));
  if (Object.keys(other).length) out.push(section("The rest of the request", JSON.stringify(other, null, 1)));
  if (answers) out.push(section("Answers", Object.entries(answers).map(([q, a]) => `${q}: ${a.choice}${a.confidence !== undefined ? ` (confidence ${p(a.confidence)})` : ""}\n  ${Object.entries(a.probabilities ?? {}).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${p(v)}`).join(" · ")}`).join("\n")));
  if (text !== undefined) out.push(section("Reply", String(text)));
  if (error) out.push(section("Error", String(error)));
  const left = Object.fromEntries(Object.entries(rest).filter(([k]) => !["at", "provider", "operation", "model", "effort", "latencyMs", "firstTextMs", "costUsd", "tokens"].includes(k)));
  if (Object.keys(left).length) out.push(section("The rest of the call", JSON.stringify(left, null, 1)));
  return out.join("\n\n");
}

function questionsSaid(questions: Record<string, { instructions?: string; criteria?: Record<string, string> }>): string {
  return Object.entries(questions).map(([id, q]) => `${id}: ${q.instructions ?? ""}\n${Object.entries(q.criteria ?? {}).map(([k, v]) => `  - ${k}: ${v}`).join("\n")}`).join("\n\n");
}

/** A snapshot: which, the scene's state, its transcript, and its world from above. `which`: a turn, a file name, or "latest". */
export function snapshotDetail(dump: Dump, which: string, raw = false): string {
  const snap = snapshotOf(dump, which);
  if (raw) return JSON.stringify(snap.state, null, 1);
  const s = snap.state as SessionState;
  const scene = s.sceneId;
  const out = [[
    `Snapshot ${snap.name} (written ${snap.mtime})`,
    `  ${titleOf(scene)} (${scene}), beat ${s.beat}, turn ${s.turn} (${s.turnsInBeat} in the beat)${s.sceneStatus ? `; ${s.sceneStatus}` : ""}${s.endingLead ? `; leaning to ${s.endingLead.exitId} (${s.endingLead.count}×)` : ""}${s.pendingExit ? `; ending pending: ${s.pendingExit.exitId}` : ""}${s.closing ? `; closing: ${s.closing.exitId}` : ""}${s.ended ? `; ended: ${s.ended.exitId}` : ""}`,
    ...(s.rules?.status ? [`  ${s.player.name}: ${s.rules.status}`] : []),
    ...(s.landed?.length || s.hinted?.length ? [`  landed: ${(s.landed ?? []).join(", ") || "-"}; hinted: ${(s.hinted ?? []).join(", ") || "-"}`] : []),
    ...(s.guard && Object.keys(s.guard).length ? [`  guard: ${Object.entries(s.guard).map(([k, g]) => `${k} ${g.stage}`).join(", ")}`] : []),
    ...(s.threat ? [`  threat: ${JSON.stringify(s.threat)}`] : []),
    ...(s.brawl ? [`  brawl: ${JSON.stringify(s.brawl)}`] : []),
    ...(s.notes ? [`  co-GM notes: ${s.notes}`] : []),
  ].join("\n"), section("Transcript (this scene)", (s.transcript ?? []).filter(e => (e.scene ?? scene) === scene).map(e => entrySaid(e, scene, s)).join("\n\n"))];
  if (s.world) out.push(section("The world from above", asciiMap(s.world)), section("The world's log", s.world.log.map(l => `turn ${l.turn} · ${l.by}: ${l.text}`).join("\n")));
  return out.join("\n\n");
}

/**
 * The world between two turns (their snapshots): who and what came, went, moved, changed hands or
 * state, and the notes added, with the session's own changes (the beat, what landed). Given one
 * turn, it's from the snapshot before that turn's to its own.
 */
export function worldDiff(dump: Dump, from: string, to?: string): string {
  const [a, b] = to ? [snapshotOf(dump, from), snapshotOf(dump, to)] : [previousSnapshot(dump, from), snapshotOf(dump, from)];
  const sa = a.state as SessionState, sb = b.state as SessionState;
  const out = [`The world from ${a.name} to ${b.name}`];
  if (sa.sceneId !== sb.sceneId) out.push(`  (different scenes: ${sa.sceneId} → ${sb.sceneId}; their worlds aren't the same place)`);
  const session = [
    sa.beat !== sb.beat ? `beat ${sa.beat} → ${sb.beat}` : "",
    sa.sceneStatus !== sb.sceneStatus ? `status ${sa.sceneStatus ?? "-"} → ${sb.sceneStatus ?? "-"}` : "",
    added(sa.landed, sb.landed, "landed"), added(sa.hinted, sb.hinted, "hinted"), added(sa.established, sb.established, "established"),
    sa.rules?.status !== sb.rules?.status ? `rules: ${sa.rules?.status ?? "-"} → ${sb.rules?.status ?? "-"}` : "",
    JSON.stringify(sa.guard ?? {}) !== JSON.stringify(sb.guard ?? {}) ? `guard: ${JSON.stringify(sb.guard ?? {})}` : "",
  ].filter(Boolean);
  if (session.length) out.push("  The session:", ...session.map(l => `    ${l}`));
  out.push(...entitiesDiff(sa.world, sb.world));
  const log = (sb.world?.log ?? []).filter(l => l.turn > sa.turn && l.turn <= sb.turn);
  if (log.length) out.push("  The world's log for those turns:", ...log.map(l => `    turn ${l.turn} · ${l.by}: ${l.text}`));
  return out.join("\n");
}

function entitiesDiff(a: SceneWorld | undefined, b: SceneWorld | undefined): string[] {
  if (!a || !b) return [`  The world: ${!a && !b ? "neither has one" : !a ? "only the second has one" : "only the first has one"}`];
  const out: string[] = ["  The world:"];
  const name = (w: SceneWorld, id: string | null | undefined) => (id ? w.entities[id]?.name ?? id : "nowhere");
  for (const e of Object.values(b.entities)) {
    const before = a.entities[e.id];
    if (!before) { out.push(`    + ${e.name} [${e.id}] (${e.kind}) in ${name(b, e.parent)}${e.states.length ? `: ${e.states.join(", ")}` : ""}`); continue; }
    const changes = entityChanges(a, b, before, e, name);
    if (changes.length) out.push(`    ~ ${e.name} [${e.id}]: ${changes.join("; ")}`);
  }
  for (const e of Object.values(a.entities)) if (!b.entities[e.id]) out.push(`    - ${e.name} [${e.id}] (gone from the world)`);
  if (out.length === 1) out.push("    nothing changed");
  return out;
}

function entityChanges(a: SceneWorld, b: SceneWorld, was: Entity, now: Entity, name: (w: SceneWorld, id: string | null | undefined) => string): string[] {
  const changes: string[] = [];
  if (was.parent !== now.parent) changes.push(`${name(a, was.parent)} → ${name(b, now.parent)}`);
  if (was.at && now.at && Math.hypot(was.at.x - now.at.x, was.at.y - now.at.y) >= 1) changes.push(`moved ${Math.round(Math.hypot(was.at.x - now.at.x, was.at.y - now.at.y))} ft to ${Math.round(now.at.x)},${Math.round(now.at.y)}`);
  const plus = now.states.filter(s => !was.states.includes(s)), minus = was.states.filter(s => !now.states.includes(s));
  if (plus.length || minus.length) changes.push([...plus.map(s => `+${s}`), ...minus.map(s => `-${s}`)].join(" "));
  if ((was.quantity ?? 1) !== (now.quantity ?? 1)) changes.push(`${was.quantity ?? 1} → ${now.quantity ?? 1}`);
  if (was.hp && now.hp && was.hp.current !== now.hp.current) changes.push(`HP ${was.hp.current} → ${now.hp.current}/${now.hp.max}`);
  const notes = now.notes.filter(n => !was.notes.some(m => m.text === n.text));
  for (const n of notes) changes.push(`note (${n.by}, turn ${n.turn}): ${n.text}`);
  if (now.notes.length < was.notes.length - notes.length) changes.push(`${was.notes.length - (now.notes.length - notes.length)} notes forgotten`);
  return changes;
}

const added = (was: string[] | undefined, now: string[] | undefined, what: string) => {
  const more = (now ?? []).filter(x => !(was ?? []).includes(x));
  return more.length ? `${what} +${more.join(", +")}` : "";
};

export function screensDetail(dump: Dump): string {
  const shots = [...dump.screens.recent.map(s => ({ title: `${clock(s.at)} · ${s.screen}`, text: s.text })), ...(dump.screens.now ? [{ title: "as it was reported", text: dump.screens.now }] : [])];
  if (!shots.length) return "No screens in the report.";
  return shots.map(s => `── ${s.title} ──\n${plain(s.text)}`).join("\n\n");
}

export function errorsDetail(dump: Dump): string {
  if (!dump.errors.length) return "No errors were caught.";
  return dump.errors.map(e => `${e.at} · ${e.where}${elsewhere(dump, e.game)}\n${e.stack ?? e.message}`).join("\n\n");
}

export function callsList(dump: Dump): string {
  const calls = callsOf(dump);
  const session = state(dump);
  const turns = session ? turnsOfCalls(calls, session) : [];
  return calls.map((call, i) => `${clock(call.at)} turn ${turns[i] ?? "-"} ${callTag({ n: i + 1, call })} ${call.provider ?? ""} ${call.model ?? ""}`.trimEnd()).join("\n") || "No calls.";
}

/** The world now, from above (the scene's, as the game has it). */
export function worldNow(dump: Dump): string {
  const world = state(dump)?.world;
  return world ? `${titleOf(world.scene)}, from above:\n${asciiMap(world)}` : "No scene world now (the game isn't in a scene with one).";
}

// ---------------------------------------------------------------------------------------------
// Helpers

/** The session as it was reported: what was in memory mid-turn, else the last save. */
function state(dump: Dump): SessionState | undefined {
  const s = (dump.game?.live?.session ?? dump.game?.files.state) as SessionState | { unreadable: string } | undefined;
  return s && !("unreadable" in s) ? s : undefined;
}

const callsOf = (dump: Dump): Call[] => (dump.game?.calls.kept ?? []) as Call[];

function snapshotOf(dump: Dump, which: string): { name: string; mtime: string; state: unknown } {
  const snaps = dump.game?.snapshots ?? [];
  if (!snaps.length) throw new Error("The report has no snapshots (no scene turns were played).");
  const found = which === "latest" ? snaps.at(-1)
    : snaps.find(s => s.name === which || s.name === `${which}.json`) ?? snaps.findLast(s => (s.state as SessionState)?.turn === Number(which));
  if (!found) throw new Error(`No snapshot "${which}": the report has ${snaps.map(s => s.name).join(", ")}`);
  return found;
}

function previousSnapshot(dump: Dump, which: string) {
  const snaps = dump.game?.snapshots ?? [];
  const at = snaps.indexOf(snapshotOf(dump, which) as (typeof snaps)[number]);
  if (at <= 0) throw new Error(`No snapshot before ${snaps[at]?.name} in the report: give two turns (--diff <from> <to>)`);
  return snaps[at - 1]!;
}

function entrySaid(e: Entry, scene: string, s: SessionState): string {
  return e.kind === "player" ? `> ${s.player.name}: ${e.text}` : e.kind === "roll" ? `🎲 ${e.text}` : e.kind === "system" ? `— ${e.text} —` : e.kind === "dialogue" ? `${castName(e.speaker, scene)}: ${e.text}` : e.text;
}

function titleOf(sceneId: string): string {
  try { return sceneById(sceneId).title; } catch { return sceneId; }
}

function castName(id: string, sceneId: string): string {
  try { return sceneById(sceneId).cast.find(c => c.id === id)?.name ?? id; } catch { return id; }
}

const section = (title: string, body: string) => `── ${title} ──\n${body}`;
const indent = (text: string, n: number) => text.split("\n").map(l => `${" ".repeat(n)}${l}`).join("\n");
const ms = (n: number | null | undefined) => (n === null || n === undefined ? "-" : n >= 10000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`);
const p = (x: number) => x.toFixed(2).replace(/^0/, "");
const clock = (iso: string | undefined) => (iso ? iso.slice(11, 19) : "--:--:--");
