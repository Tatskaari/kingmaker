/**
 * An eval run's report (or several runs side by side, before and after a change):
 * index.html, the cases against the variants (pass rate, penalty) with the judge's verdict on each
 * recorded reply beside them, and every finding with its triage; cases/<case>.html, every sample's
 * reply with the findings marked, and the sample's model calls and the judge's, each opened as its
 * own transcript. Pass, fail and penalty count the findings as triaged (triage.ts).
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { sceneById } from "../../../scenes/index.ts";
import type { SessionState } from "../../runtime/session.ts";
import { evalsRoot, results, sampleDir, type EvalRun, type SampleResult } from "./eval.ts";
import { readCase, type LoopCase } from "./fixture.ts";
import { CallBook, entryHtml, esc, md, page, sevChip, type Call, type Speakers } from "./html.ts";
import { CASES_DIR } from "./paths.ts";
import { turnsOf } from "./review.ts";
import { loadTriage, sampleKey, triaged, whyHtml, type Verdict } from "./triage.ts";

interface Column { key: string; run: EvalRun; dir: string; variant: string }

/** A sample as the report counts it: where it lives, and its judgement after triage. */
type Sample = SampleResult & {
  dir: string; col: string;
  t?: ReturnType<typeof triaged>;
  verdicts: Array<Verdict | undefined>; criterionVerdict?: Verdict;
};

const readCalls = (file: string): Call[] => existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as Call) : [];
const fmt = (x: number | undefined, d = 1) => x === undefined || Number.isNaN(x) ? "–" : x.toFixed(d);
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
const anchor = (col: string, sample: number) => `${col.replace(/[^\w-]+/g, "_")}-${sample}`;

function speakersOf(c: LoopCase): Speakers {
  const scene = sceneById(c.scene);
  const order = scene.cast.map(x => x.id);
  return { name: id => scene.cast.find(x => x.id === id)?.name ?? id, colour: id => { const i = order.indexOf(id); return i === -1 ? 0 : (i % 6) + 1; } };
}

function verdictPill(r: Sample): string {
  if (!r.ok) return `<span class="pill fail">error</span>`;
  return r.t!.pass ? `<span class="pill pass">pass</span>` : `<span class="pill fail">fail</span>`;
}

function findingsList(r: Sample): string {
  const j = r.judgement!;
  const crit = r.criterionVerdict;
  const critPass = r.t!.criterionPass;
  return `<div class="finding${critPass ? " good" : ""}"><span class="pill ${critPass ? "pass" : "fail"}">criterion</span><div class="body">${whyHtml(esc, `${j.criterion.pass ? "meets it" : "misses it"}: ${j.criterion.reason}`, crit)}</div></div>
${j.findings.map((f, i) => { const v = r.verdicts[i]; return `<div class="finding${v?.verdict === "discard" ? " good" : ""}">${sevChip(v?.severity ?? f.severity)}<div class="body"><p><b>${esc(f.check)}</b> · “${esc(f.quote)}”${f.quoted ? "" : ` <span class="pill">quote not found in the reply</span>`}</p>${whyHtml(esc, f.why, v)}</div></div>`; }).join("")}`;
}

function sampleCard(c: LoopCase, r: Sample, book: CallBook, who: Speakers): string {
  const calls = readCalls(join(r.dir, "calls.jsonl"));
  const judge = readCalls(join(r.dir, "judge.jsonl"));
  const kept = (r.judgement?.findings ?? []).map((f, i) => ({ ...f, severity: r.verdicts[i]?.severity ?? f.severity, turn: c.turn, n: i + 1 })).filter((_, i) => r.verdicts[i]?.verdict !== "discard");
  const reply = r.entries?.length ? r.entries.map(e => entryHtml(e, who, kept)).join("") : `<div class="t gm"><span class="who">GM</span><div><div class="prose">${esc(r.reply ?? "").replace(/\n/g, "<br>")}</div></div></div>`;
  const facts = [...(r.moves ?? []).map(m => `path: ${m.from} → ${m.to} via ${m.via}${m.roll ? ` · ${m.roll.skill} ${m.roll.total} vs DC ${m.roll.dc}` : ""}`), ...(r.rulings ?? []).map(x => `ruling: ${x.act} → ${x.kind}${x.kind === "roll" ? ` ${x.skill} DC ${x.dc}` : ""}`)];
  const id = anchor(r.col, r.sample);
  const rows = [...calls.map((call, i) => book.row(call, { id: `${id}-c${i + 1}`, label: `${r.col} s${r.sample} #${i + 1}` })), ...judge.map((call, i) => book.row(call, { id: `${id}-j${i + 1}`, label: `${r.col} s${r.sample} judge` }))];
  return `<div class="turn${r.ok && !r.t!.pass ? " flagged" : ""}" id="${id}">
<div class="tn"><span>${esc(r.col)} · sample ${r.sample}${r.sample === 0 && r.variant !== "recorded" ? " (the game's own dice)" : ""}</span>${verdictPill(r)}${r.t ? `<span class="faint">penalty ${r.t.penalty}${r.t.untriaged ? ` · ${r.t.untriaged} not triaged` : ""}</span>` : ""}<span class="faint">${r.turnCostUsd !== undefined ? `turn $${r.turnCostUsd.toFixed(4)}` : ""}${r.firstTextMs ? ` · first text ${(r.firstTextMs / 1000).toFixed(1)} s` : ""}</span></div>
${r.ok ? reply : `<pre class="cmd">${esc(r.error ?? "")}</pre>`}
${facts.length ? `<div class="facts">${facts.map(f => `<span>${esc(f)}</span>`).join("")}</div>` : ""}
${r.judgement ? findingsList(r) : ""}
${rows.length ? `<details class="callsof"><summary>The turn's ${calls.length} model calls, and the judge's</summary><ol class="callrows">${rows.join("")}</ol></details>` : ""}
</div>`;
}

function casePage(c: LoopCase, cols: Column[], samples: Sample[], recorded: Sample | undefined): string {
  const who = speakersOf(c);
  const book = new CallBook();
  const caseDir = join(CASES_DIR, c.id);
  const before = existsSync(join(caseDir, "transcript.json")) ? { ...JSON.parse(readFileSync(join(caseDir, "state.json"), "utf8")), transcript: JSON.parse(readFileSync(join(caseDir, "transcript.json"), "utf8")) } as SessionState : undefined;
  const recent = before ? [...turnsOf(before)].sort((a, b) => a[0] - b[0]).slice(-3).map(([n, es]) => `<div class="turn"><div class="tn">Turn ${n}</div>${es.map(e => entryHtml(e, who)).join("")}</div>`).join("") : "";
  const recordedCard = recorded ? `<h3>The reply as recorded, judged: ${recorded.ok ? (recorded.t!.pass ? "the eval doesn't see the failure" : "the eval sees the failure") : "error"}</h3>${sampleCard(c, recorded, book, who)}` : "";
  const html = `<header>
<p class="eyebrow"><a href="../index.html">Eval report</a> · case</p>
<h1>${esc(c.id)}</h1>
<p class="lede">${esc(c.observed.why)}</p>
<div class="tiles"><div class="tile"><span class="eyebrow">Scene</span><b>${esc(c.scene)}</b></div><div class="tile"><span class="eyebrow">Turn</span><b>${c.turn}</b></div><div class="tile"><span class="eyebrow">Fails on</span><b>${esc(c.checks.join(", "))} ≥ ${c.failAt}</b></div><div class="tile"><span class="eyebrow">Co-GM, memory</span><b>${esc(c.harness)}, ${esc(c.memory)}</b></div></div>
</header>
<section><h2>The moment</h2>${recent ? `<details><summary>The last turns before it</summary>${recent}</details>` : ""}
<div class="t player"><span class="who">Player</span><div>${esc(c.input)}</div></div>
<h3>The criterion</h3>${md(c.criterion)}
<p class="faint">Source: ${esc(c.source.kind)} ${esc(c.source.path)}, game ${esc(c.source.game)}${c.source.build ? ` at ${esc(c.source.build.slice(0, 7))}` : ""}. Observed: ${esc(c.observed.check)} ${c.observed.severity}, “${esc(c.observed.quote)}”.</p>
${recordedCard}</section>
${cols.map(col => { const rs = samples.filter(r => r.col === col.key && r.case === c.id); return `<section><h2>${esc(col.key)}: ${rs.filter(r => r.ok && r.t!.pass).length} of ${rs.length} pass</h2><p class="faint">${esc(col.run.variants[col.variant]?.description ?? "")} · run ${esc(col.run.name)} at ${esc(col.run.build.commit.slice(0, 7))}${col.run.build.dirty ? " (with local changes)" : ""}</p>${rs.map(r => sampleCard(c, r, book, who)).join("")}</section>`; }).join("")}
<footer class="faint">Built by <code>npm run loop -- run-report</code>. Judge: ${esc(cols[0]?.run.judge ?? "")}.</footer>
${book.script()}`;
  return page(`Eval ${c.id}`, html, { standalone: true });
}

/** Write the report for one run or several (the columns are each run's variants). */
export function evalReport(runs: string[], out?: string): { dir: string; files: Record<string, string>; bytes: number } {
  const dirs = runs.map(r => existsSync(join(r, "run.json")) ? r : join(evalsRoot(), r));
  const metas = dirs.map(d => JSON.parse(readFileSync(join(d, "run.json"), "utf8")) as EvalRun);
  const cols: Column[] = metas.flatMap((run, i) => Object.keys(run.variants).map(v => ({ key: metas.length > 1 ? `${v} @ ${run.name}` : v, run, dir: dirs[i]!, variant: v })));
  const caseIds = [...new Set(metas.flatMap(m => m.cases))].filter(id => existsSync(join(CASES_DIR, id, "case.json")));
  const cases = new Map(caseIds.map(id => [id, readCase(join(CASES_DIR, id))]));
  const samples: Sample[] = [];
  const recorded = new Map<string, Sample>();
  dirs.forEach((d, i) => {
    const t = loadTriage(d);
    for (const r of results(d)) {
      const c = cases.get(r.case);
      if (!c) continue;
      const key = sampleKey(r);
      const col = r.variant === "recorded" ? "recorded" : metas.length > 1 ? `${r.variant} @ ${metas[i]!.name}` : r.variant;
      const s: Sample = {
        ...r, dir: sampleDir(d, r.variant, r.case, r.sample), col,
        verdicts: (r.judgement?.findings ?? []).map((_, n) => t[`${key}/${n + 1}`]),
        ...(t[`${key}/criterion`] ? { criterionVerdict: t[`${key}/criterion`] } : {}),
        ...(r.ok && r.judgement ? { t: triaged(c, key, r.judgement, t) } : {}),
      };
      if (r.variant === "recorded") { if (!recorded.has(r.case)) recorded.set(r.case, s); } else samples.push(s);
    }
  });
  const dir = out ?? join(dirs.at(-1)!, "report");
  mkdirSync(join(dir, "cases"), { recursive: true });
  const files: Record<string, string> = {};
  for (const c of cases.values()) {
    const file = join(dir, "cases", `${c.id}.html`);
    writeFileSync(file, casePage(c, cols, samples, recorded.get(c.id)));
    files[`cases/${c.id}.html`] = file;
  }
  const cell = (col: Column, c: LoopCase) => {
    const rs = samples.filter(r => r.col === col.key && r.case === c.id);
    if (!rs.length) return `<td class="n">–</td>`;
    const ok = rs.filter(r => r.ok);
    return `<td class="n"><a href="cases/${esc(c.id)}.html#${anchor(col.key, 0)}">${ok.filter(r => r.t!.pass).length}/${rs.length}</a>${rs.length - ok.length ? ` <span class="faint">(${rs.length - ok.length} errors)</span>` : ""}<div class="faint">pen ${fmt(mean(ok.map(r => r.t!.penalty)))}</div></td>`;
  };
  const total = (col: Column) => {
    const rs = samples.filter(r => r.col === col.key && r.ok);
    return `<td class="n"><b>${rs.filter(r => r.t!.pass).length}/${rs.length}</b><div class="faint">pen ${fmt(mean(rs.map(r => r.t!.penalty)))}</div></td>`;
  };
  const caught = (c: LoopCase) => { const r = recorded.get(c.id); return !r ? `<span class="faint">not judged</span>` : !r.ok ? `<span class="pill fail">error</span>` : r.t!.pass ? `<span class="pill fail">missed</span>` : `<span class="pill pass">caught</span><div class="faint">${esc(r.judgement!.findings.filter((f, i) => r.verdicts[i]?.verdict !== "discard" && f.severity >= 3).map(f => `${f.check} ${f.severity}`).join(", ") || "criterion")}</div>`; };

  // Every finding, and every criterion the judge failed, with the triage's why.
  const every = [...recorded.values(), ...samples].filter(r => r.ok && r.judgement).flatMap(r => [
    ...(r.judgement!.criterion.pass && !r.criterionVerdict ? [] : [{ r, sev: 0, check: "criterion", quote: "", why: `${r.judgement!.criterion.pass ? "meets it" : "misses it"}: ${r.judgement!.criterion.reason}`, v: r.criterionVerdict }]),
    ...r.judgement!.findings.map((f, i) => ({ r, sev: r.verdicts[i]?.severity ?? f.severity, check: f.check, quote: f.quote, why: f.why, v: r.verdicts[i] })),
  ]).sort((a, b) => (a.v?.verdict === "discard" ? 1 : 0) - (b.v?.verdict === "discard" ? 1 : 0) || b.sev - a.sev);
  const untriaged = every.filter(f => !f.v).length;
  const findingRows = every.map(f => `<tr class="${f.v?.verdict === "discard" ? "discarded" : ""}"><td>${f.sev ? sevChip(f.sev) : `<span class="pill">crit</span>`}</td><td><code>${esc(f.check)}</code></td><td><a href="cases/${esc(f.r.case)}.html#${anchor(f.r.col, f.r.sample)}">${esc(f.r.case)}</a><div class="faint">${esc(f.r.col)} · sample ${f.r.sample}</div></td><td class="q">${f.quote ? `“${esc(f.quote)}”` : ""}</td><td class="w">${whyHtml(esc, f.why, f.v)}</td></tr>`).join("");

  const html = `<header>
<p class="eyebrow">GM loop · eval · ${metas.map(m => `${esc(m.name)} at <code>${esc(m.build.commit.slice(0, 7))}</code>${m.build.dirty ? " (local changes)" : ""}`).join(" · ")}</p>
<h1>${metas.length > 1 ? "Eval comparison" : `Eval ${esc(metas[0]!.name)}`}</h1>
<p class="lede">${cases.size} case${cases.size === 1 ? "" : "s"}, each a turn that went wrong in play, played again from its fixture on ${cols.length} variant${cols.length === 1 ? "" : "s"} and judged by the rubric (${esc(metas[0]!.judge)}). Every finding is then triaged by hand: kept, or discarded as the judge's mistake, with why. A sample passes when it meets the case's criterion and keeps no finding on the case's checks at its severity or worse. The recorded column is the judge on the reply as it was played: if it doesn't catch the failure there, the criterion or the rubric needs work before the rest means anything.${untriaged ? ` <b>${untriaged} finding${untriaged === 1 ? " isn't" : "s aren't"} triaged yet.</b>` : ""}</p>
<nav class="toc"><a href="#matrix">Cases against variants</a><a href="#findings">Every finding</a><a href="#variants">The variants</a></nav>
</header>
<section id="matrix"><h2>Cases against variants</h2><div class="scroll"><table class="data"><thead><tr><th>Case</th><th>Recorded reply</th>${cols.map(col => `<th class="n">${esc(col.key)}</th>`).join("")}</tr></thead><tbody>
${[...cases.values()].map(c => `<tr><td><a href="cases/${esc(c.id)}.html">${esc(c.id)}</a><div class="faint">${esc(c.checks.join(", "))} · turn ${c.turn}</div></td><td>${caught(c)}</td>${cols.map(col => cell(col, c)).join("")}</tr>`).join("")}
<tr><td><b>All</b></td><td></td>${cols.map(total).join("")}</tr>
</tbody></table></div><p class="faint">Samples passing, and the mean penalty per reply (kept findings: 1, 2, 4, 8, 16 by severity). With a few samples a case, one or two either way is noise: read the replies.</p></section>
<section id="findings"><h2>Every finding (${every.length})</h2><p class="faint">Kept findings first, most severe first; discarded ones last, struck through. The why column is the triage's; the judge's own reason is under it.</p><div class="scroll"><table class="data"><thead><tr><th>Sev</th><th>Check</th><th>Where</th><th>Quote</th><th>Why</th></tr></thead><tbody>${findingRows}</tbody></table></div></section>
<section id="variants"><h2>The variants</h2><div class="scroll"><table class="data"><thead><tr><th>Variant</th><th>What it is</th><th>Run</th></tr></thead><tbody>${cols.map(col => `<tr><td><code>${esc(col.key)}</code></td><td>${esc(col.run.variants[col.variant]?.description ?? "")}${col.run.variants[col.variant]?.promptsDir ? `<div class="faint">prompts: evals/loop/variants/${esc(basename(join(col.run.variants[col.variant]!.promptsDir!, "..")))}/prompts</div>` : ""}</td><td>${esc(col.run.name)}</td></tr>`).join("")}</tbody></table></div></section>
<footer class="faint">Built by <code>npm run loop -- run-report ${esc(metas.map(m => m.name).join(" "))}</code>.</footer>`;
  writeFileSync(join(dir, "index.html"), page(metas.length > 1 ? "GM loop eval comparison" : `GM loop eval ${metas[0]!.name}`, html, { standalone: false }));
  const bytes = [join(dir, "index.html"), ...Object.values(files)].reduce((a, f) => a + statSync(f).size, 0);
  return { dir, files, bytes };
}
