// After the GM loop's src/eval/loop/report.ts at 5f01806 (origin/claude/gm-loop, draft PR #663): the round at a glance, the arms side by side, every finding with the triage's why first, and each game turn by turn with its model calls, each opened as its own transcript. On the game a game's calls are its stack's call log, by each call's key; the games can be on different scenes, so the endings are graded and counted, and a turn's waits (the in-flight cap) are shown.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CallBook, entryHtml, esc, md, page, sevChip, Speakers } from "./html.ts";
import { notesPath, recordPath, reviewPath, roundDir, RUBRIC, type LoopConfig } from "./paths.ts";
import { callsBefore, type Call } from "./calls.ts";
import { fightEntries, readRecord, turnsOf, type FightLog, type GameRecord } from "./record.ts";
import { armStats, byCheck, fightsOf, gameStats, mean, OUTCOMES, type ArmStats, type GameStats } from "./report-data.ts";
import { locate, RATINGS, type Review } from "./review.ts";
import { loadRound, personas, type Round } from "./round.ts";
import type { Ending } from "./scenes.ts";
import { loadTriage, strays, type Triaged } from "./triage.ts";

/** What the report reads beyond the round's own files: each game's calls (its stack's log) and each scene's endings and title. */
export interface ReportDeps {
  calls(record: GameRecord): Call[];
  scene(record: GameRecord | undefined, key: string): Promise<{ title: string; endings: Ending[] }>;
}

/**
 * The round's report: report/index.html (the round at a glance) and report/games/<game>.html (each
 * game played, turn by turn), built from the round's files alone, so it can be built again at any
 * time. Returns the files (published path → file) and their size.
 */
export async function roundReport(config: LoopConfig, name: string, deps: ReportDeps): Promise<{ dir: string; files: Record<string, string>; bytes: number; strays: string[] }> {
  const round = loadRound(config, name);
  const games = await statsOf(config, round, deps);
  const titles = await sceneTitles(round, games, deps);
  const dir = join(roundDir(config, name), "report");
  mkdirSync(join(dir, "games"), { recursive: true });

  writeFileSync(join(dir, "index.html"), indexPage(round, games, titles));
  const files: Record<string, string> = {};
  for (const g of games.filter(g => g.record?.sceneRow)) {
    files[`games/${g.id}.html`] = join(dir, "games", `${g.id}.html`);
    writeFileSync(files[`games/${g.id}.html`]!, gamePage(round, g, titles));
  }

  const bytes = [join(dir, "index.html"), ...Object.values(files)].reduce((sum, f) => sum + statSync(f).size, 0);
  const found = Object.fromEntries(games.map(g => [g.id, g.findings.length]));
  return { dir, files, bytes, strays: strays(loadTriage(config, name), found) };
}

async function statsOf(config: LoopConfig, round: Round, deps: ReportDeps): Promise<GameStats[]> {
  const triage = loadTriage(config, round.name);
  const all = personas();
  return await Promise.all(Object.entries(round.games).map(async ([id, spec]) => {
    const record = readRecord(recordPath(config, round.name, id));
    const scene = await deps.scene(record, record?.scene ?? spec.scene).catch(() => ({ title: spec.scene, endings: [] }));
    return gameStats(round, id, all, {
      record, review: readJson<Review>(reviewPath(config, round.name, id)), notes: readText(notesPath(config, round.name, id)),
      triage, calls: record ? deps.calls(record) : [], endings: scene.endings,
    });
  }));
}

async function sceneTitles(round: Round, games: GameStats[], deps: ReportDeps): Promise<Record<string, string>> {
  const pairs = await Promise.all(round.scenes.map(async s => {
    const record = games.find(g => g.scene === s.scene && g.record)?.record;
    const scene = await deps.scene(record, record?.scene ?? s.scene).catch(() => ({ title: s.scene }));
    return [s.scene, scene.title] as const;
  }));
  return Object.fromEntries(pairs);
}

// ---------------------------------------------------------------------------------------------
// The round's page

function indexPage(round: Round, games: GameStats[], titles: Record<string, string>): string {
  const played = games.filter(g => g.outcome !== "not played");
  const reviewed = played.filter(g => g.review);
  const scenes = round.scenes.map(s => `<b>${esc(titles[s.scene] ?? s.scene)}</b> (${s.games})`).join(", ");
  const html = `<header>
<p class="eyebrow">GM loop · QA round · ${esc(round.created.slice(0, 16).replace("T", " "))} · <code>${esc(round.build.commit.slice(0, 7))}</code>${round.build.dirty ? " (with local changes)" : ""}</p>
<h1>${esc(round.name)}</h1>
<p class="lede">${played.length} of ${games.length} blind games played: ${scenes}, up to ${round.maxTurns} turns each, on ${Object.keys(round.arms).length} arm${Object.keys(round.arms).length === 1 ? "" : "s"}; ${reviewed.length} reviewed blind against <a href="#rubric">the rubric</a>. The testers and reviewers saw only the neutral names; this page unblinds them.</p>
<nav class="toc"><a href="#arms">The arms</a><a href="#scenes">The scenes</a>${hasFights(games) ? `<a href="#fights">The fights</a>` : ""}<a href="#checks">By check</a><a href="#findings">Every finding</a><a href="#games">The games</a><a href="#rubric">The rubric</a></nav>
</header>
<section id="arms"><h2>The arms side by side</h2><p class="faint">Penalty per 10 replies sums each kept finding's penalty (severity 1 to 5: 1, 2, 4, 8, 16) over the reviewed games' GM replies, the openings among them. An ending is good, mixed or bad as its scene grades it (its result); ungraded is an ending the scene's file hasn't got (the game's own), and none is out of turns or stopped. Waits are the loop's waits on a busy GM, and 402s the calls OpenRouter turned away on the key's in-flight cap. With a handful of games an arm, read the findings before the numbers.</p>${armTable(armStats(round, games))}</section>
<section id="scenes"><h2>The scenes</h2>${sceneTable(round, games, titles)}</section>
${hasFights(games) ? `<section id="fights"><h2>The fights</h2><p class="faint">Each fight in the conversation (docs/combat-gm.md) as the player saw it: the turn it broke out on and the line that brought it, the initiative order, who joined, ran or kept clear as they picked their sides, who came as it went on, and how it ended. Under each game, the blows rolled with no fight on, and any reply that called for initiative with no fight after it.</p>${fightTable(games, titles)}</section>` : ""}
<section id="checks"><h2>Findings by check</h2>${checkTable(round, games)}</section>
<section id="findings"><h2>Every finding (${reviewed.reduce((sum, g) => sum + g.kept.length, 0)} kept of ${reviewed.reduce((sum, g) => sum + g.findings.length, 0)})</h2><p class="faint">Most severe first; the triage's why first, then the reviewer's. A discarded finding is struck through and counts for nothing.</p>${findingTable(games)}</section>
<section id="games"><h2>The games</h2>${gameTable(games, titles)}</section>
<section id="rubric"><h2>The rubric</h2><details><summary>qa/loop/rubric.md, as the reviewers had it</summary>${md(readFileSync(RUBRIC, "utf8"))}</details></section>
<footer class="faint">Built by <code>npm run loop -- report ${esc(round.name)}</code> from the round's files.</footer>`;
  return page(`GM loop ${round.name}`, html, { standalone: false });
}

function armTable(arms: ArmStats[]): string {
  const best = Math.min(...arms.map(a => a.per10 ?? Infinity));
  const rows = arms.map(a => `<tr class="${arms.length > 1 && a.per10 === best ? "best" : ""}"><td><b>${esc(a.arm)}</b></td><td><code>${esc(a.name)}</code><div class="faint">${esc(a.stack)}</div></td>
<td class="n">${a.played} of ${a.games}</td><td class="n">${a.reviewed}</td><td class="n">${fmt(a.meanTurns)}</td><td class="n">${OUTCOMES.map(o => a.outcomes[o]).join(" · ")}</td>
<td class="n">${fmt(a.per10)}</td><td class="n">${a.bySeverity.join(" · ")}</td><td class="n">${fmt(a.overall)}</td><td class="n">${fmt(a.pacing)}</td>
<td class="n">${a.costPerGame === undefined ? "–" : `$${a.costPerGame.toFixed(3)}`}</td><td class="n">${a.waits} · ${a.capped}</td></tr>`).join("\n");
  return `<div class="scroll"><table class="data"><thead><tr><th>Arm</th><th>Build</th><th class="n">Played</th><th class="n">Reviewed</th><th class="n">Mean turns</th><th class="n">Endings: good · mixed · bad · ungraded · none</th><th class="n">Penalty / 10 replies</th><th class="n">5 · 4 · 3 · 2 · 1</th><th class="n">Overall</th><th class="n">Pacing</th><th class="n">Cost / game</th><th class="n">Waits · 402s</th></tr></thead><tbody>
${rows}
</tbody></table></div>`;
}

function sceneTable(round: Round, games: GameStats[], titles: Record<string, string>): string {
  const rows = round.scenes.map(({ scene }) => {
    const mine = games.filter(g => g.scene === scene && g.outcome !== "not played");
    const endings = [...new Set(mine.map(g => g.ending ? `${g.ending.title} (${g.ending.outcome})` : "no ending"))].map(e => `${esc(e)}: ${mine.filter(g => (g.ending ? `${g.ending.title} (${g.ending.outcome})` : "no ending") === e).length}`);
    const reviewed = mine.filter(g => g.per10 !== undefined);
    return `<tr><td><b>${esc(titles[scene] ?? scene)}</b><div class="faint"><code>${esc(scene)}</code></div></td><td class="n">${mine.length}</td><td>${endings.join("<br>") || "–"}</td><td class="n">${fmt(mean(reviewed.map(g => g.per10!)))}</td><td class="n">${fmt(mean(reviewed.flatMap(g => typeof g.review?.ratings?.overall === "number" ? [g.review.ratings.overall] : [])))}</td></tr>`;
  }).join("\n");
  return `<div class="scroll"><table class="data"><thead><tr><th>Scene</th><th class="n">Played</th><th>Endings reached</th><th class="n">Mean penalty / 10</th><th class="n">Overall</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function checkTable(round: Round, games: GameStats[]): string {
  const arms = Object.keys(round.arms).sort();
  const checks = byCheck(games);
  if (!checks.length) return `<p class="faint">No findings kept yet.</p>`;
  return `<div class="scroll"><table class="data"><thead><tr><th>Check</th>${arms.map(a => `<th class="n">${esc(a)} (count · penalty)</th>`).join("")}</tr></thead><tbody>
${checks.map(c => `<tr><td><code>${esc(c.check)}</code></td>${arms.map(a => `<td class="n">${c.arms[a] ? `${c.arms[a]!.count} · ${c.arms[a]!.penalty}` : "–"}</td>`).join("")}</tr>`).join("\n")}
</tbody></table></div>`;
}

function findingTable(games: GameStats[]): string {
  const every = games.flatMap(g => g.findings.map(f => ({ f, g })));
  if (!every.length) return `<p class="faint">No findings yet.</p>`;
  const sorted = every.sort((a, b) => b.f.severity - a.f.severity || a.f.check.localeCompare(b.f.check) || a.g.id.localeCompare(b.g.id) || a.f.turn - b.f.turn);
  return `<div class="scroll"><table class="data"><thead><tr><th>Sev</th><th>Check</th><th>Where</th><th>Quote</th><th>Why</th></tr></thead><tbody>
${sorted.map(({ f, g }) => `<tr class="${f.v?.verdict === "discard" ? "discarded" : ""}"><td>${sevChip(f.severity)}</td><td><code>${esc(f.check)}</code></td><td><a href="games/${esc(g.id)}.html#t-${f.turn}">${esc(g.id)} t${f.turn}</a><div class="faint">${esc(g.arm)} · ${esc(g.persona)} · ${esc(g.scene)}</div></td><td class="q">“${esc(f.quote)}”</td><td class="w">${whyHtml(f)}${f.better ? `<div class="faint">Better: ${esc(f.better)}</div>` : ""}</td></tr>`).join("\n")}
</tbody></table></div>`;
}

/** Whether any game of the round had a fight, or violence: the fights section's. */
const hasFights = (games: GameStats[]) => games.some(g => g.record && (fightsOf(g.record.entries).fights.length || fightsOf(g.record.entries).blows.length));

function fightTable(games: GameStats[], titles: Record<string, string>): string {
  const rows = games.filter(g => g.record).flatMap(g => {
    const seen = fightsOf(g.record!.entries);
    const game = `<td>${g.record?.sceneRow ? `<a href="games/${esc(g.id)}.html">${esc(g.id)}</a>` : esc(g.id)}</td><td>${esc(g.persona)}</td><td>${esc(titles[g.scene] ?? g.scene)}</td>`;
    const outside = [
      ...seen.blows.map(b => `t${b.turn}: ${esc(b.roll.replace(/: \d+.*$/, ""))} <span class="faint">(«${esc(b.line.slice(0, 90))}»)</span>`),
      ...seen.calledOnly.map(t => `t${t}: "Roll for initiative!" with no fight after it`),
    ];
    const logs = g.record!.fights ?? [];
    const fights = seen.fights.map(f => {
      const log = logs.find(l => l.turn === f.from);
      const board = log ? `${log.events.filter(e => e.kind === "turn").length} turns, ${log.events.filter(e => e.kind === "gm").length} told · ${log.moves} by the player` : "–";
      return `<tr>${game}<td class="n">t${f.from}${f.to !== undefined ? `–${f.to}` : ""}</td><td class="w">«${esc(f.line.slice(0, 140))}»</td><td class="w">${esc(f.sides)}</td><td class="n">${log?.rounds ?? f.rounds ?? "–"}</td><td class="w">${esc(board)}</td><td class="w">${esc(f.ended ?? log?.over ?? "not over")}</td></tr>`;
    });
    return [...fights, ...(outside.length ? [`<tr>${game}<td colspan="6" class="w"><span class="faint">Outside a fight:</span> ${outside.join("; ")}</td></tr>`] : [])];
  });
  return `<div class="scroll"><table class="data"><thead><tr><th>Game</th><th>Persona</th><th>Scene</th><th class="n">Turns</th><th>What brought it</th><th>The sides</th><th class="n">Rounds</th><th>On the board</th><th>How it went</th></tr></thead><tbody>${rows.join("\n")}</tbody></table></div>`;
}

function gameTable(games: GameStats[], titles: Record<string, string>): string {
  const rows = games.map(g => `<tr><td>${g.record?.sceneRow ? `<a href="games/${esc(g.id)}.html">${esc(g.id)}</a>` : esc(g.id)}</td><td>${esc(g.arm)}</td><td>${esc(g.persona)}</td><td>${esc(titles[g.scene] ?? g.scene)}</td>
<td class="n">${g.record?.sceneRow ? g.turns : "–"}</td><td>${esc(g.outcome === "not played" ? g.record?.stopped ?? "not played" : g.ending ? `${g.ending.title} (${g.ending.outcome})` : "(none)")}</td>
<td class="n">${g.review ? g.kept.length : "–"}</td><td class="n">${fmt(g.per10)}</td><td class="n">${fmt(g.review?.ratings?.overall, 0)}</td><td class="w">${g.review ? esc(g.review.summary) : `<span class="faint">${g.record?.sceneRow ? "not reviewed" : ""}</span>`}</td></tr>`).join("\n");
  return `<div class="scroll"><table class="data"><thead><tr><th>Game</th><th>Arm</th><th>Persona</th><th>Scene</th><th class="n">Turns</th><th>Ending</th><th class="n">Findings kept</th><th class="n">Pen / 10</th><th class="n">Overall</th><th>The review's summary</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---------------------------------------------------------------------------------------------
// A game's page

function gamePage(round: Round, g: GameStats, titles: Record<string, string>): string {
  const record = g.record!;
  const book = new CallBook();
  const speakers = new Speakers();
  const before = callsBefore(g.calls, record.sceneRow);
  const turns = turnsOf(record.entries).map(([n, entries]) => turnHtml(g, n, entries, book, speakers)).join("\n");
  const html = `<header>
<p class="eyebrow"><a href="../index.html">Round ${esc(round.name)}</a> · game ${esc(g.id)}</p>
<h1>${esc(titles[g.scene] ?? g.scene)}: ${esc(record.player?.name ?? g.id)}</h1>
<p class="lede">${esc(g.as)}. Played on arm <b>${esc(g.arm)}</b> (<code>${esc(round.arms[g.arm]?.name ?? "")}</code>, ${esc(round.arms[g.arm]?.stack ?? "")}) by the <b>${esc(g.persona)}</b> persona. The character: ${esc(record.player?.build ?? "?")}, made ${esc(record.player?.made ?? "?")}.${record.skipped.length ? ` On the way, for the test: ${esc(record.skipped.map(s => `${s.scene} ended on “${s.title ?? s.exit}”`).join("; "))}.` : ""}</p>
<div class="tiles">
${tile("Turns", String(g.turns))}${tile("Ending", g.ending ? `${g.ending.title} (${g.ending.outcome})` : "none")}${tile("Penalty / 10 replies", fmt(g.per10))}
${tile("Findings kept", `${g.kept.length}${g.kept.length !== g.findings.length ? ` of ${g.findings.length}` : ""}`)}${tile("The scene's calls", String([...g.byTurn.values()].flat().length))}
${tile("The scene's cost", `$${g.sceneCostUsd.toFixed(3)}`)}${tile("The game's cost", `$${g.costUsd.toFixed(3)}`)}${tile("A turn, median", g.medianMs === undefined ? "–" : `${(g.medianMs / 1000).toFixed(1)} s`)}${tile("Waits · 402s", `${g.waits} · ${g.capped}`)}
</div>
</header>
<section><h2>The blind review</h2>${g.review ? `<p>${esc(g.review.summary)}</p><div class="tiles">${RATINGS.map(r => tile(r, fmt(g.review!.ratings?.[r], 0))).join("")}</div>` : `<p class="faint">No review yet: <code>npm run loop -- review-pack ${esc(round.name)} ${esc(g.id)}</code>, then a blind reviewer writes reviews/${esc(g.id)}.json.</p>`}</section>
${g.notes ? `<section><h2>The tester's notes</h2>${md(g.notes)}</section>` : ""}
${record.notebook || record.hook ? `<section><h2>What the player was told</h2>${record.hook ? `<p>${esc(record.hook)}</p>` : ""}${record.notebook ? `<details><summary>Their notebook of the story so far</summary>${md(record.notebook.join("\n\n"))}</details>` : ""}</section>` : ""}
<section><h2>The game, turn by turn</h2><p class="faint">Findings are marked on the words they quote, and who speaks on each spoken line. Each turn's model calls are under it, from the stack's call log (by each call's key): open one to read it as its own transcript: the instructions, every message in order, and what came back, each part marked unchanged or changed since the last call of its kind (with what changed). ← and → step through the calls.</p>${turns}</section>
${before.length ? `<section><h2>Before the scene</h2><details class="callsof"><summary>The ${before.length} model calls that made the character${record.skipped.length ? " and took the story to the scene" : ""}</summary><ol class="callrows">${before.map((c, i) => book.row(c, { id: `b${i + 1}`, label: `b${i + 1}` })).join("")}</ol></details></section>` : ""}
<footer class="faint">Built by <code>npm run loop -- report ${esc(round.name)}</code>; the calls from ${esc(record.stack)}/ai/games/${esc(record.uid ?? "?")}/calls.jsonl.</footer>
${book.script()}`;
  return page(`${round.name} ${g.id}`, html, { standalone: true });
}

function turnHtml(g: GameStats, n: number, entries: GameRecord["entries"], book: CallBook, speakers: Speakers): string {
  const record = g.record!;
  const mine = g.findings.filter(f => f.turn === n);
  const shown = mine.filter(f => f.v?.verdict !== "discard");
  const good = (g.review?.good ?? []).filter(x => x.turn === n);
  const calls = g.byTurn.get(n) ?? [];
  const log = record.turns[String(n)];
  const cost = calls.reduce((sum, c) => sum + (c.costUsd ?? 0), 0);
  return `<div class="turn${shown.length ? " flagged" : ""}" id="t-${n}">
<div class="tn"><span>Turn ${n}${n === 0 ? " · the opening" : ""}</span>${shown.map(f => sevChip(f.severity)).join(" ")}<span class="faint">${calls.length} calls · $${cost.toFixed(4)}${log?.ms !== undefined ? ` · ${(log.ms / 1000).toFixed(1)} s` : ""}</span></div>
${entries.map(e => entryHtml(e, speakers, shown)).join("\n")}
${(record.fights ?? []).filter(f => f.turn === n).map(f => fightHtml(f, speakers, shown)).join("\n")}
${log?.waits.length || log?.capped || log?.failed ? `<div class="waits">${log.waits.map(w => `<span>waited ${Math.round(w.ms / 1000)} s: ${esc(w.why)}</span>`).join("")}${log.capped ? `<span>${log.capped} call${log.capped === 1 ? "" : "s"} turned away with a 402 (the in-flight cap), tried again by the game</span>` : ""}${log.failed ? `<span>failed: ${esc(log.failed)}</span>` : ""}</div>` : ""}
${mine.map(findingCard).join("")}
${good.map(x => `<div class="finding good"><span class="pill pass">good</span><div class="body"><p>${esc(x.what)}</p></div></div>`).join("")}
${calls.length ? `<details class="callsof"><summary>The ${calls.length} model calls of this turn</summary><ol class="callrows">${calls.map((c, i) => book.row(c, { id: `t${n}c${i + 1}`, label: `t${n}#${i + 1}` })).join("")}</ol></details>` : ""}
</div>`;
}

/** A fight on the board, under the turn it broke out on: its log as the player read it (the board's lines and dice, the GM's tellings, the player's own words), findings marked on the words they quote. */
function fightHtml(f: FightLog, speakers: Speakers, shown: Triaged[]): string {
  const entries = fightEntries(f);
  const marked = shown.some(s => entries.some(e => locate(e.text, s.quote)));
  const told = f.events.filter(e => e.kind === "gm").length;
  const turns = f.events.filter(e => e.kind === "turn").length;
  return `<details class="fightlog"${marked ? " open" : ""}><summary>The fight on the board: ${esc(f.title)} <span class="faint">${turns} turns, ${told} told by the GM · ${f.moves} move${f.moves === 1 ? "" : "s"} by the player${f.rounds ? ` · ${f.rounds} round${f.rounds === 1 ? "" : "s"}` : ""} · ${esc(f.over ?? "not over")}</span></summary>
${entries.map(e => entryHtml(e, speakers, shown)).join("\n")}
</details>`;
}

function findingCard(f: Triaged): string {
  return `<div class="finding${f.v?.verdict === "discard" ? " good" : ""}" id="fd-${f.n}">${sevChip(f.severity)}<div class="body">
<p><b>${esc(f.check)}</b> · turn ${f.turn} · “${esc(f.quote)}”</p>
${whyHtml(f)}${f.better ? `<p class="faint">Better: ${esc(f.better)}</p>` : ""}</div></div>`;
}

/** A finding's why, as the report shows it: the triage's own words first, then the reviewer's. */
function whyHtml(f: Triaged): string {
  if (!f.v) return `<div class="triage"><span>${esc(f.why)}</span><span class="faint">(reviewer; not triaged yet)</span></div>`;
  return `<div class="triage"><span class="mine"><span class="pill ${f.v.verdict === "keep" ? "fail" : "pass"}">${f.v.verdict === "keep" ? "kept" : "discarded"}</span> ${esc(f.v.why)}</span><span class="faint">reviewer: ${esc(f.why)}</span></div>`;
}

// ---------------------------------------------------------------------------------------------

const tile = (label: string, value: string) => `<div class="tile"><span class="eyebrow">${esc(label)}</span><b>${esc(value)}</b></div>`;
const fmt = (x: number | undefined, digits = 1) => (x === undefined || Number.isNaN(x) ? "–" : x.toFixed(digits));
const readJson = <T>(path: string): T | undefined => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as T : undefined);
const readText = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, "utf8") : undefined);
