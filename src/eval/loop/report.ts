/**
 * A QA round's report: report/index.html (the round at a glance, the arms side by side, every
 * finding) and report/games/<game>.html (the game turn by turn: the reply with the findings marked
 * on its words, and every model call the turn made, in full). Regenerate it any time: it's built
 * from the round's files alone.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sceneById } from "../../../scenes/index.ts";
import { turnsOfCalls } from "../../report/inspect.ts";
import type { SessionState } from "../../runtime/session.ts";
import type { Finding } from "./fixture.ts";
import { CallBook, entryHtml, esc, md, page, PENALTY, sevChip, type Call, type Speakers } from "./html.ts";
import { loadTriage, whyHtml, type Verdict } from "./triage.ts";
import { RATINGS, turnsOf, type Review } from "./review.ts";
import { gameDir, loadRound, loadVariant, personas, roundDir, type Round } from "./round.ts";

export interface Game {
  id: string; arm: string; variant: string; persona: string; as: string;
  state?: SessionState; calls: Call[]; review?: Review; notes?: string;
  /** The review's findings, numbered, with their triage (severity as triaged); `kept`: not discarded. */
  findings: Array<Finding & { n: number; v?: Verdict }>; kept: Array<Finding & { n: number; v?: Verdict }>;
  replies: number; penalty: number; costUsd: number; firstTextMs?: number;
}

const readJson = <T>(path: string): T | undefined => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as T : undefined;
const median = (xs: number[]) => { if (!xs.length) return undefined; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
const fmt = (x: number | undefined, digits = 1) => x === undefined || Number.isNaN(x) ? "–" : x.toFixed(digits);

export function loadGames(round: Round): Game[] {
  const all = personas();
  const triage = loadTriage(roundDir(round.name));
  return Object.entries(round.games).map(([id, g]) => {
    const dir = gameDir(round.name, id);
    const state = readJson<SessionState>(join(dir, "state.json"));
    const calls = existsSync(join(dir, "calls.jsonl")) ? readFileSync(join(dir, "calls.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as Call) : [];
    const review = readJson<Review>(join(roundDir(round.name), "reviews", `${id}.json`));
    const notesFile = join(roundDir(round.name), "notes", `${id}.md`);
    const replies = state ? [...turnsOf(state).values()].filter(es => es.some(e => e.kind !== "player")).length : 0;
    const findings = (review?.findings ?? []).map((f, i) => { const v = triage[`${id}/${i + 1}`]; return { ...f, n: i + 1, ...(v ? { v, severity: v.severity ?? f.severity } : {}) }; });
    const kept = findings.filter(f => f.v?.verdict !== "discard");
    const penalty = kept.reduce((a, f) => a + (PENALTY[f.severity] ?? 0), 0);
    const first = (state?.metrics ?? []).map(m => m.firstTextMs ?? m.replyMs).filter((x): x is number => typeof x === "number");
    return {
      id, arm: g.arm, variant: round.arms[g.arm]!, persona: g.persona, as: all.find(p => p.id === g.persona)?.as ?? g.persona,
      ...(state ? { state } : {}), calls, ...(review ? { review } : {}), findings, kept,
      ...(existsSync(notesFile) ? { notes: readFileSync(notesFile, "utf8") } : {}),
      replies, penalty, costUsd: calls.reduce((a, c) => a + (c.costUsd ?? 0), 0), ...(first.length ? { firstTextMs: median(first)! } : {}),
    };
  });
}

function speakers(state: SessionState): Speakers {
  const scene = sceneById(state.sceneId);
  const order = scene.cast.map(c => c.id);
  return {
    name: id => id === "you" ? state.player.name : scene.cast.find(c => c.id === id)?.name ?? id,
    colour: id => { const i = order.indexOf(id); return i === -1 ? 0 : (i % 6) + 1; },
  };
}

// ---------------------------------------------------------------------------------------------
// A game's page

function gamePage(round: Round, g: Game): string {
  const s = g.state!;
  const who = speakers(s);
  const book = new CallBook();
  const turnOf = turnsOfCalls(g.calls, s);
  const findings = g.findings;
  const variant = loadVariant(g.variant);
  const turns = [...turnsOf(s)].sort((a, b) => a[0] - b[0]);
  const body = turns.map(([n, entries]) => {
    const mine = findings.filter(f => f.turn === n);
    const good = (g.review?.good ?? []).filter(x => x.turn === n);
    const moves = s.path.filter(p => p.turn === n && n > 0);
    const rulings = (s.rulings ?? []).filter(r => r.turn === n);
    const calls = g.calls.map((c, i) => ({ c, i })).filter(({ i }) => turnOf[i] === n);
    const cost = calls.reduce((a, { c }) => a + (c.costUsd ?? 0), 0);
    return `<div class="turn${mine.length ? " flagged" : ""}" id="t-${n}">
<div class="tn"><span>Turn ${n}${n === 0 ? " · the opening" : ""}</span>${mine.filter(f => f.v?.verdict !== "discard").map(f => sevChip(f.severity)).join(" ")}<span class="faint">${calls.length} calls · $${cost.toFixed(4)}</span></div>
${entries.map(e => entryHtml(e, who, mine.filter(f => f.v?.verdict !== "discard"))).join("\n")}
${moves.length || rulings.length ? `<div class="facts">${moves.map(m => `<span>path: ${esc(m.from)} → ${esc(m.to)} via ${esc(m.via)} (${esc(m.source)})${m.roll ? ` · ${esc(m.roll.skill)} ${m.roll.total} vs DC ${m.roll.dc}` : ""}</span>`).join("")}${rulings.map(r => `<span>ruling: ${esc(r.act)} → ${esc(r.kind)}${r.kind === "roll" ? ` ${esc(r.skill)} DC ${r.dc}` : ""} (${esc(r.why)})</span>`).join("")}</div>` : ""}
${mine.map(f => findingCard(f)).join("")}
${good.map(x => `<div class="finding good"><span class="pill pass">good</span><div class="body"><p>${esc(x.what)}</p></div></div>`).join("")}
${calls.length ? `<details class="callsof"><summary>The ${calls.length} model calls of this turn</summary><ol class="callrows">${calls.map(({ c, i }) => book.row(c, { id: `c${i + 1}`, label: `#${i + 1}` })).join("")}</ol></details>` : ""}
</div>`;
  }).join("\n");
  const ratings = g.review ? `<div class="tiles">${RATINGS.map(r => `<div class="tile"><span class="eyebrow">${r}</span><b>${fmt(g.review!.ratings?.[r], 0)}</b></div>`).join("")}</div>` : "";
  const html = `<header>
<p class="eyebrow"><a href="../index.html">Round ${esc(round.name)}</a> · game ${esc(g.id)}</p>
<h1>${esc(sceneById(s.sceneId).title)}: ${esc(s.player.name)}</h1>
<p class="lede">${esc(g.as)}. Played on arm <b>${esc(g.arm)}</b> (variant <code>${esc(g.variant)}</code>: ${esc(variant.description)}), approach <code>${esc(s.approach)}</code>, by the <b>${esc(g.persona)}</b> persona.</p>
<div class="tiles">
<div class="tile"><span class="eyebrow">Turns</span><b>${s.turn}</b></div>
<div class="tile"><span class="eyebrow">Ending</span><b>${esc(s.ended?.exitId ?? "none")}</b></div>
<div class="tile"><span class="eyebrow">Penalty / 10 replies</span><b>${g.review ? fmt(g.penalty / Math.max(1, g.replies) * 10) : "–"}</b></div>
<div class="tile"><span class="eyebrow">Findings kept</span><b>${g.kept.length}${g.kept.length !== findings.length ? ` of ${findings.length}` : ""}</b></div>
<div class="tile"><span class="eyebrow">Model calls</span><b>${g.calls.length}</b></div>
<div class="tile"><span class="eyebrow">Cost</span><b>$${g.costUsd.toFixed(3)}</b></div>
<div class="tile"><span class="eyebrow">First text, median</span><b>${g.firstTextMs ? `${(g.firstTextMs / 1000).toFixed(1)} s` : "–"}</b></div>
</div>
</header>
<section><h2>The blind review</h2>${g.review ? `<p>${esc(g.review.summary)}</p>${ratings}` : `<p class="faint">No review yet: <code>npm run loop -- review-pack ${esc(round.name)} ${esc(g.id)}</code>, then a blind reviewer writes reviews/${esc(g.id)}.json.</p>`}</section>
${g.notes ? `<section><h2>The tester's notes</h2>${md(g.notes)}</section>` : ""}
<section><h2>The game, turn by turn</h2><p class="faint">Findings are marked on the words they quote. Each turn's model calls are under it, numbered as in calls.jsonl (and <code>npm run report -- inspect --call n</code>): open one to read it as its own transcript: the instructions, every message in order, and what came back, each part marked unchanged or changed since the last call of its kind (with what changed). ← and → step through the calls.</p>${body}</section>
<footer class="faint">Built by <code>npm run loop -- report ${esc(round.name)}</code> from ${esc(gameDir(round.name, g.id))}.</footer>
${book.script()}`;
  return page(`${round.name} ${g.id}`, html, { standalone: true });
}

function findingCard(f: Finding & { n: number; v?: Verdict }): string {
  return `<div class="finding${f.v?.verdict === "discard" ? " good" : ""}" id="fd-${f.n}">${sevChip(f.severity)}<div class="body">
<p><b>${esc(f.check)}</b> · turn ${f.turn} · “${esc(f.quote)}”</p>
${whyHtml(esc, f.why, f.v, "reviewer")}${f.better ? `<p class="faint">Better: ${esc(f.better)}</p>` : ""}</div></div>`;
}

// ---------------------------------------------------------------------------------------------
// The round's page

function indexPage(round: Round, games: Game[]): string {
  const scene = sceneById(round.scene);
  const arms = Object.keys(round.arms).sort();
  const played = games.filter(g => g.state);
  const reviewed = played.filter(g => g.review);
  const armRow = (arm: string) => {
    const gs = played.filter(g => g.arm === arm);
    const rv = gs.filter(g => g.review);
    const replies = rv.reduce((a, g) => a + g.replies, 0);
    const pen = rv.reduce((a, g) => a + g.penalty, 0);
    const bySev = [5, 4, 3, 2, 1].map(sv => rv.reduce((a, g) => a + g.kept.filter(f => f.severity === sv).length, 0));
    const ended = gs.filter(g => g.state!.ended).length;
    return { arm, variant: round.arms[arm]!, games: gs.length, reviewed: rv.length, turns: mean(gs.map(g => g.state!.turn)), per10: replies ? pen / replies * 10 : undefined, bySev, ended,
      overall: mean(rv.map(g => g.review!.ratings?.overall).filter((x): x is number => typeof x === "number")),
      pacing: mean(rv.map(g => g.review!.ratings?.pacing).filter((x): x is number => typeof x === "number")),
      cost: mean(gs.map(g => g.costUsd)), first: median(gs.flatMap(g => g.firstTextMs ? [g.firstTextMs] : [])) };
  };
  const rows = arms.map(armRow);
  const imported = (v: string) => v.startsWith("import:");
  const best = Math.min(...rows.filter(r => !imported(r.variant)).map(r => r.per10 ?? Infinity));
  const armTable = `<div class="scroll"><table class="data"><thead><tr><th>Arm</th><th>Variant</th><th class="n">Games</th><th class="n">Reviewed</th><th class="n">Mean turns</th><th class="n">Scenes ended</th><th class="n">Penalty / 10 replies</th><th class="n">5 · 4 · 3 · 2 · 1</th><th class="n">Overall</th><th class="n">Pacing</th><th class="n">Cost / game</th><th class="n">First text</th></tr></thead><tbody>
${rows.map(r => `<tr class="${rows.length > 1 && !imported(r.variant) && r.per10 === best ? "best" : ""}"><td><b>${esc(r.arm)}</b></td><td><code>${esc(r.variant)}</code><div class="faint">${esc(loadVariant(r.variant).description)}${imported(r.variant) ? " Not a controlled arm: a different player and build, so not comparable with the others." : ""}</div></td><td class="n">${r.games}</td><td class="n">${r.reviewed}</td><td class="n">${fmt(r.turns)}</td><td class="n">${r.ended}</td><td class="n">${fmt(r.per10)}</td><td class="n">${r.bySev.join(" · ")}</td><td class="n">${fmt(r.overall)}</td><td class="n">${fmt(r.pacing)}</td><td class="n">$${fmt(r.cost, 3)}</td><td class="n">${r.first ? `${(r.first / 1000).toFixed(1)} s` : "–"}</td></tr>`).join("")}
</tbody></table></div>`;

  const every = reviewed.flatMap(g => g.findings.map(f => ({ ...f, game: g })));
  const all = every.filter(f => f.v?.verdict !== "discard");
  const checks = [...new Set(all.map(f => f.check))].sort((a, b) => all.filter(f => f.check === b).reduce((s, f) => s + PENALTY[f.severity]!, 0) - all.filter(f => f.check === a).reduce((s, f) => s + PENALTY[f.severity]!, 0));
  const checkTable = checks.length ? `<div class="scroll"><table class="data"><thead><tr><th>Check</th>${arms.map(a => `<th class="n">${esc(a)} (count · penalty)</th>`).join("")}</tr></thead><tbody>
${checks.map(c => `<tr><td><code>${esc(c)}</code></td>${arms.map(a => { const fs = all.filter(f => f.check === c && f.game.arm === a); return `<td class="n">${fs.length ? `${fs.length} · ${fs.reduce((s, f) => s + PENALTY[f.severity]!, 0)}` : "–"}</td>`; }).join("")}</tr>`).join("")}
</tbody></table></div>` : `<p class="faint">No findings yet.</p>`;

  const sorted = [...every].sort((a, b) => b.severity - a.severity || a.check.localeCompare(b.check) || a.game.id.localeCompare(b.game.id) || a.turn - b.turn);
  const findingRows = sorted.map(f => `<tr class="${f.v?.verdict === "discard" ? "discarded" : ""}"><td>${sevChip(f.severity)}</td><td><code>${esc(f.check)}</code></td><td><a href="games/${esc(f.game.id)}.html#t-${f.turn}">${esc(f.game.id)} t${f.turn}</a><div class="faint">${esc(f.game.arm)} · ${esc(f.game.persona)}</div></td><td class="q">“${esc(f.quote)}”</td><td class="w">${whyHtml(esc, f.why, f.v, "reviewer")}${f.better ? `<div class="faint">Better: ${esc(f.better)}</div>` : ""}</td><td><code>npm run loop -- case ${esc(round.name)} ${esc(f.game.id)} ${f.n} --id ${esc(`${round.scene}-${f.check}-${f.game.id}t${f.turn}`)}</code></td></tr>`).join("");

  const gameRows = games.map(g => `<tr><td>${g.state ? `<a href="games/${esc(g.id)}.html">${esc(g.id)}</a>` : esc(g.id)}</td><td>${esc(g.arm)}</td><td>${esc(g.persona)}</td><td class="n">${g.state?.turn ?? "–"}</td><td>${esc(g.state ? g.state.ended?.exitId ?? "(none)" : "not played")}</td><td class="n">${g.review ? g.kept.length : "–"}</td><td class="n">${g.review ? fmt(g.penalty / Math.max(1, g.replies) * 10) : "–"}</td><td class="n">${fmt(g.review?.ratings?.overall, 0)}</td><td class="w">${g.review ? esc(g.review.summary) : `<span class="faint">${g.state ? "not reviewed" : ""}</span>`}</td></tr>`).join("");

  const html = `<header>
<p class="eyebrow">GM loop · QA round · ${esc(round.created.slice(0, 16).replace("T", " "))} · <code>${esc(round.build.commit.slice(0, 7))}</code>${round.build.dirty ? " (with local changes)" : ""}</p>
<h1>${esc(round.name)}</h1>
<p class="lede">${played.length} blind games of <b>${esc(scene.title)}</b> (<code>${esc(scene.id)}</code>), up to ${round.maxTurns} turns each, on ${arms.length} arm${arms.length === 1 ? "" : "s"}; ${reviewed.length} reviewed blind against <a href="#rubric">the rubric</a>. The testers and reviewers saw only the arms' neutral names; this page unblinds them.</p>
<nav class="toc"><a href="#arms">The arms</a><a href="#checks">By check</a><a href="#findings">Every finding</a><a href="#games">The games</a><a href="#rubric">The rubric</a></nav>
</header>
<section id="arms"><h2>The arms side by side</h2><p class="faint">Penalty per 10 replies sums each finding's penalty (severity 1 to 5: 1, 2, 4, 8, 16) over the reviewed games' GM replies. With a handful of games an arm, read the findings before the numbers.</p>${armTable}</section>
<section id="checks"><h2>Findings by check</h2>${checkTable}</section>
<section id="findings"><h2>Every finding (${all.length})</h2><p class="faint">Most severe first. The last column cuts that moment into an eval case (evals/loop/cases/), with the finding filled in.</p><div class="scroll"><table class="data"><thead><tr><th>Sev</th><th>Check</th><th>Where</th><th>Quote</th><th>Why</th><th>Make it a case</th></tr></thead><tbody>${findingRows}</tbody></table></div></section>
<section id="games"><h2>The games</h2><div class="scroll"><table class="data"><thead><tr><th>Game</th><th>Arm</th><th>Persona</th><th class="n">Turns</th><th>Ending</th><th class="n">Findings</th><th class="n">Pen / 10</th><th class="n">Overall</th><th>The review's summary</th></tr></thead><tbody>${gameRows}</tbody></table></div></section>
<section id="rubric"><h2>The rubric</h2><details><summary>evals/loop/rubric.md, as the reviewers had it</summary>${md(readFileSync(join(import.meta.dirname, "..", "..", "..", "evals", "loop", "rubric.md"), "utf8"))}</details></section>
<footer class="faint">Built by <code>npm run loop -- report ${esc(round.name)}</code> from ${esc(roundDir(round.name))}.</footer>`;
  return page(`GM loop ${round.name}`, html, { standalone: false });
}

/** Write the round's report; returns the files (published path → file on disk) and their sizes. */
export function roundReport(name: string): { dir: string; files: Record<string, string>; bytes: number } {
  const round = loadRound(name);
  const games = loadGames(round);
  const dir = join(roundDir(name), "report");
  mkdirSync(join(dir, "games"), { recursive: true });
  const files: Record<string, string> = {};
  writeFileSync(join(dir, "index.html"), indexPage(round, games));
  for (const g of games.filter(g => g.state)) {
    const file = join(dir, "games", `${g.id}.html`);
    writeFileSync(file, gamePage(round, g));
    files[`games/${g.id}.html`] = file;
  }
  const bytes = [join(dir, "index.html"), ...Object.values(files)].reduce((a, f) => a + statSync(f).size, 0);
  return { dir, files, bytes };
}
