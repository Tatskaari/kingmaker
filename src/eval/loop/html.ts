/**
 * The GM loop's reports as HTML: every model call in full (its instructions, each message, a
 * decider's state and every option's probability, what came back), JSON rendered as reading
 * rather than dumped, and the transcript with the review's findings marked on the words they quote.
 * Ported from the 2026-10-16 autopsy (kingmaker-scratch/qa-divulging-2026-10-16/round2/report).
 */
import type { Entry } from "../../runtime/session.ts";
import type { Finding } from "./fixture.ts";

export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const inline = (s: string) => esc(s)
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");

/** Markdown-ish text as HTML, keeping every character of it. */
export function md(text: string): string {
  const lines = String(text ?? "").split("\n");
  const out: string[] = []; let para: string[] = []; const stack: string[] = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; } };
  const closeLists = (depth = 0) => { while (stack.length > depth) out.push(`</${stack.pop()}>`); };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const li = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (!line.trim()) { flush(); closeLists(); continue; }
    if (h) { flush(); closeLists(); const n = Math.min(6, h[1]!.length + 2); out.push(`<h${n} class="md-h">${inline(h[2]!)}</h${n}>`); continue; }
    if (li) {
      flush();
      const depth = Math.floor(li[1]!.length / 2) + 1, tag = /\d/.test(li[2]!) ? "ol" : "ul";
      while (stack.length < depth) { out.push(`<${tag}>`); stack.push(tag); }
      closeLists(depth);
      out.push(`<li>${inline(li[3]!)}</li>`);
      continue;
    }
    if (stack.length && /^\s{2,}\S/.test(raw)) { out.push(`<div class="cont">${inline(line.trim())}</div>`); continue; }
    closeLists();
    para.push(line);
  }
  flush(); closeLists();
  return `<div class="md">${out.join("\n")}</div>`;
}

/**
 * A page's long texts, so one repeated in a later call (the GM's instructions, every turn) is shown
 * once and pointed back to after that.
 */
export class Seen {
  private texts = new Map<string, string>();
  text(text: string, anchor: string, label: string): string {
    if (text.length >= 1500) {
      const first = this.texts.get(text);
      if (first) return `<p class="faint same">The same ${text.length.toLocaleString()} characters as <a href="#${esc(first)}">${esc(first.replace(/^call-/, "call #"))}</a>'s ${esc(label)}.</p>`;
      this.texts.set(text, anchor);
    }
    return md(text);
  }
}

/** Any JSON as HTML, every field. */
export function value(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return `<span class="nil">${v === null ? "null" : "—"}</span>`;
  if (typeof v === "string") return v.length > 160 || v.includes("\n") ? md(v) : `<span class="str">${inline(v)}</span>`;
  if (typeof v === "number" || typeof v === "boolean") return `<span class="num">${esc(v)}</span>`;
  if (Array.isArray(v)) return v.length ? `<ol class="arr">${v.map(x => `<li>${value(x, depth + 1)}</li>`).join("")}</ol>` : `<span class="nil">[ ]</span>`;
  const keys = Object.keys(v as object);
  return keys.length ? `<dl class="kv d${Math.min(depth, 3)}">${keys.map(k => `<dt>${esc(k)}</dt><dd>${value((v as Record<string, unknown>)[k], depth + 1)}</dd>`).join("")}</dl>` : `<span class="nil">{ }</span>`;
}

/** A GM reply's raw text with its markup lit: speaker tags and marked phrases. */
const rawReply = (s: string) => esc(s)
  .replace(/\[([^\]:]{1,60})\](?=\s*[“"])/g, `<span class="tag">[$1]</span>`)
  .replace(/\[(why|know|you):([^\]]*)\]/g, `<span class="mark">[$1:$2]</span>`);

// ---------------------------------------------------------------------------------------------
// A model call

export interface Call {
  at?: string; provider?: string; operation?: string; model?: string; effort?: string;
  request?: { instructions?: string; input?: Array<{ role: string; content: string }>; json?: { name?: string }; state?: unknown; questions?: Record<string, { instructions?: string; criteria?: Record<string, string> }> } & Record<string, unknown>;
  text?: string; answers?: Record<string, { choice: string; probabilities?: Record<string, number>; confidence?: number }>;
  calls?: Array<{ name: string; args?: unknown; result?: unknown }>;
  latencyMs?: number; firstTextMs?: number | null; costUsd?: number; tokens?: { in?: number; out?: number; reasoning?: number }; error?: string;
}

const ROLE: Record<string, string> = { developer: "developer (prep and notes)", user: "user (the player's turn)", assistant: "assistant (earlier replies)", system: "system" };

function decisionCall(c: Call, seen: Seen, anchor: string): string {
  const q = c.request?.questions ?? {};
  const qs = Object.entries(q).map(([name, spec]) => {
    const ans = c.answers?.[name];
    const probs = ans?.probabilities ?? {};
    const opts = [...new Set([...Object.keys(spec.criteria ?? {}), ...Object.keys(probs)])];
    const rows = opts.map(o => {
      const p = probs[o]; const chosen = ans?.choice === o;
      return `<tr class="${chosen ? "chosen" : ""}"><td class="opt"><code>${esc(o)}</code>${chosen ? ` <span class="pill">chosen</span>` : ""}</td><td class="bar"><span style="--p:${p ?? 0}"></span><b>${p === undefined ? "–" : Number(p).toFixed(2)}</b></td><td>${spec.criteria?.[o] ? md(spec.criteria[o]!) : `<span class="nil">(no description)</span>`}</td></tr>`;
    }).join("");
    return `<section class="q"><h5><code>${esc(name)}</code>${ans ? ` → <code class="ans">${esc(ans.choice)}</code>${ans.confidence !== undefined ? ` <span class="faint">confidence ${Number(ans.confidence).toFixed(2)}</span>` : ""}` : ""}</h5>${spec.instructions ? md(spec.instructions) : ""}<div class="scroll"><table class="opts"><thead><tr><th>option</th><th>probability</th><th>what the option means</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }).join("");
  const state = c.request?.state;
  const shown = typeof state === "string" ? seen.text(state, anchor, "decision state") : value(state);
  return `<details class="part"><summary>What it was shown: the decision state</summary>${shown}</details>
<details class="part" open><summary>The questions, its answers and every option's probability (${Object.keys(q).length})</summary>${qs}</details>`;
}

function generativeCall(c: Call, seen: Seen, anchor: string): string {
  const input = c.request?.input ?? [];
  const msgs = input.map((m, i) => `<details class="msg"><summary><span class="role ${esc(m.role)}">${esc(ROLE[m.role] ?? m.role)}</span> message ${i + 1} of ${input.length} · ${String(m.content ?? "").length.toLocaleString()} characters</summary>${seen.text(String(m.content ?? ""), anchor, `message ${i + 1}`)}</details>`).join("");
  const text = c.text ?? "";
  let out: string;
  try { out = value(JSON.parse(text)); } catch { out = `<div class="raw">${rawReply(text)}</div>`; }
  const tools = c.calls?.length ? `<details class="part"><summary>Its tool calls (${c.calls.length})</summary><ol class="tools">${c.calls.map(t => `<li><code>${esc(t.name)}</code>${value({ args: t.args, result: t.result })}</li>`).join("")}</ol></details>` : "";
  const instructions = c.request?.instructions ?? "";
  return `<details class="part"><summary>Its instructions (${instructions.length.toLocaleString()} characters)</summary>${seen.text(instructions, anchor, "instructions")}</details>
<details class="part"><summary>Its input: ${input.length} message${input.length === 1 ? "" : "s"}${c.request?.json ? `, answering as JSON (<code>${esc(c.request.json.name ?? "")}</code>)` : ""}</summary>${msgs}</details>
${tools}
<details class="part" open><summary>What it wrote</summary>${out}</details>`;
}

/** One call as a card: the line about it, and the whole call behind a disclosure. */
export function callCard(c: Call, n: number, seen: Seen, note?: { flag?: boolean; html: string }): string {
  const kind = c.answers ? "decision" : "generative";
  const anchor = `call-${n}`;
  const meta = [c.provider, c.model, c.effort ? `effort ${c.effort}` : "", c.latencyMs !== undefined ? `${Math.round(c.latencyMs).toLocaleString()} ms` : "", c.firstTextMs ? `first text ${Math.round(c.firstTextMs)} ms` : "", c.tokens ? `${(c.tokens.in ?? 0).toLocaleString()} in, ${c.tokens.out ?? 0} out` : "", c.costUsd !== undefined ? `$${Number(c.costUsd).toFixed(4)}` : ""].filter(Boolean);
  const body = kind === "decision" ? decisionCall(c, seen, anchor) : generativeCall(c, seen, anchor);
  return `<li class="call${note?.flag ? " flag" : ""}${c.error ? " failed" : ""}" id="${anchor}">
<div class="callhead"><span class="callno">#${n}</span><span class="op">${esc(c.operation ?? "?")}</span><span class="kind">${kind === "decision" ? "decision" : "writes text"}</span><span class="meta">${meta.map(esc).join(" · ")}</span></div>
${c.error ? `<div class="err">Failed: ${esc(c.error)}</div>` : ""}${note ? `<div class="note">${note.html}</div>` : ""}
<details class="full"><summary>The whole call</summary>${body}</details>
</li>`;
}

// ---------------------------------------------------------------------------------------------
// The transcript

/** Where a quote sits in a text: exactly, or with curly quotes and spacing taken as plain. */
export function locate(text: string, quote: string): [number, number] | undefined {
  if (!quote.trim()) return undefined;
  const plain = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, "\"").replace(/[—–]/g, "-").replace(/\s/g, " ").toLowerCase();
  const at = plain(text).indexOf(plain(quote.trim()));
  return at === -1 ? undefined : [at, at + quote.trim().length];
}

export interface Speakers { name(id: string): string; colour(id: string): number }

/** A transcript entry, with who says what, its marked phrases, and any findings on its words. */
export function entryHtml(e: Entry, who: Speakers, findings: Array<Finding & { n: number }> = []): string {
  if (e.kind === "player") return `<div class="t player"><span class="who">Player</span><div>${inline(e.text)}</div></div>`;
  if (e.kind === "roll") return `<div class="t roll"><span class="who">Dice</span><div>${esc(e.text)}</div></div>`;
  if (e.kind === "system") return `<div class="t sys"><span class="who">Game</span><div>${esc(e.text)}</div></div>`;
  const text = e.text ?? ""; const speech = e.marked?.speech ?? []; const marks = e.marked?.marks ?? [];
  const events: Array<{ at: number; open: boolean; rank: number; html: string }> = [];
  for (const s of speech) {
    events.push({ at: s.start, open: true, rank: 0, html: `<span class="say c${s.speaker ? who.colour(s.speaker) : 0}" title="${esc(s.speaker ? who.name(s.speaker) : "nobody can tell")}">` });
    events.push({ at: s.end, open: false, rank: 0, html: "</span>" });
  }
  marks.forEach((m, i) => {
    events.push({ at: m.start, open: true, rank: 1, html: `<span class="mk k-${esc(m.kind)}">` });
    events.push({ at: m.end, open: false, rank: 1, html: `</span><sup class="mref">${i + 1}</sup>` });
  });
  for (const f of findings) {
    const at = locate(text, f.quote);
    if (!at) continue;
    events.push({ at: at[0], open: true, rank: 2, html: `<mark class="f s${f.severity}" id="f-${f.n}">` });
    events.push({ at: at[1], open: false, rank: 2, html: `</mark><sup class="fref s${f.severity}"><a href="#fd-${f.n}">${f.n}</a></sup>` });
  }
  // Spans can cross: close and reopen at each boundary would be exact; close-before-open is enough here.
  events.sort((a, b) => a.at - b.at || (a.open === b.open ? (a.open ? a.rank - b.rank : b.rank - a.rank) : a.open ? 1 : -1));
  let html = ""; let pos = 0;
  for (const ev of events) { html += esc(text.slice(pos, ev.at)); html += ev.html; pos = ev.at; }
  html += esc(text.slice(pos));
  const speaker = e.kind === "dialogue" ? `<span class="who">${esc(who.name(e.speaker))}</span>` : `<span class="who">GM</span>`;
  const noteList = marks.length ? `<ol class="mnotes">${marks.map(m => `<li><span class="pill k-${esc(m.kind)}">${esc(m.kind)}</span> on “${esc(text.slice(m.start, m.end))}”: ${esc(m.note ?? "")}</li>`).join("")}</ol>` : "";
  return `<div class="t gm">${speaker}<div><div class="prose">${html.replace(/\n/g, "<br>")}</div>${noteList}</div></div>`;
}

export const sevChip = (s: number) => `<span class="sevchip s${s}">${s}</span>`;
export const PENALTY: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };

// ---------------------------------------------------------------------------------------------
// The page

/**
 * A page. The artifact's own page goes without its document skeleton (the host adds it); a page
 * published beside it (a game, a case) is a whole document.
 */
export function page(title: string, body: string, options: { standalone: boolean }): string {
  const head = `<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@500;700&family=IBM+Plex+Sans:ital,wght@0,400;0,600;1,400&display=swap">
<style>${CSS}</style>`;
  return options.standalone
    ? `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n${head}\n</head>\n<body>\n<div class="wrap">${body}</div>\n</body>\n</html>\n`
    : `${head}\n<div class="wrap">${body}</div>\n`;
}

const CSS = `
/* Layout: one reading column for the play and the findings, full-width evidence cards for the calls. */
:root {
  --paper: #f4f6f8; --surface: #ffffff; --ink: #1b2029; --muted: #5b6472; --rule: #d6dbe3;
  --accent: #1d5876; --accent-soft: #e2edf3;
  --s5: #b42318; --s4: #c2410c; --s3: #946200; --s2: #46607a; --s1: #6b7280;
  --good: #2c6a4d; --c0: #46607a; --c1: #2c6a4d; --c2: #8a4a0c; --c3: #7b2c6c; --c4: #1d5876; --c5: #8a6d00; --c6: #5a3e9b;
  --display: "IBM Plex Sans Condensed", "Arial Narrow", system-ui, sans-serif;
  --body: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --paper: #111419; --surface: #171b21; --ink: #e4e7ed; --muted: #98a1af; --rule: #2a303a; --accent: #7dbfdf; --accent-soft: #15303d;
  --s5: #ff6b5e; --s4: #ff9b55; --s3: #e1b245; --s2: #91b2d2; --s1: #9aa3b1;
  --good: #72d0a1; --c0: #91b2d2; --c1: #72d0a1; --c2: #f0a45e; --c3: #e28ed2; --c4: #7dbfdf; --c5: #e1c45e; --c6: #b9a2f0; color-scheme: dark; } }
:root[data-theme="dark"] {
  --paper: #111419; --surface: #171b21; --ink: #e4e7ed; --muted: #98a1af; --rule: #2a303a; --accent: #7dbfdf; --accent-soft: #15303d;
  --s5: #ff6b5e; --s4: #ff9b55; --s3: #e1b245; --s2: #91b2d2; --s1: #9aa3b1;
  --good: #72d0a1; --c0: #91b2d2; --c1: #72d0a1; --c2: #f0a45e; --c3: #e28ed2; --c4: #7dbfdf; --c5: #e1c45e; --c6: #b9a2f0; color-scheme: dark; }
body { background: var(--paper); color: var(--ink); font-family: var(--body); font-size: 15px; line-height: 1.55; margin: 0; }
.wrap { max-width: 1120px; margin: 0 auto; padding-inline: 16px; padding-block: 28px 64px; display: grid; gap: 36px; }
section, header, footer { min-width: 0; display: grid; gap: 12px; align-content: start; }
h1, h2, h3, h4, h5 { font-family: var(--display); text-wrap: balance; margin: 0; line-height: 1.2; }
h1 { font-size: 2.3rem; font-weight: 700; letter-spacing: -0.01em; }
h2 { font-size: 1.55rem; font-weight: 700; padding-block-start: 8px; border-block-start: 2px solid var(--ink); }
h3 { font-size: 1.25rem; font-weight: 700; } h4 { font-size: 1.05rem; font-weight: 700; } h5 { font-size: 0.95rem; font-weight: 500; }
p { margin: 0; max-width: 72ch; }
code { font-family: var(--mono); font-size: 0.86em; background: var(--accent-soft); padding: 0 4px; border-radius: 3px; overflow-wrap: anywhere; }
pre.cmd { font-family: var(--mono); font-size: 0.82rem; background: var(--surface); border: 1px solid var(--rule); border-radius: 4px; padding: 8px 10px; overflow-x: auto; margin: 0; white-space: pre; }
a { color: var(--accent); }
a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.faint { color: var(--muted); font-size: 0.9em; }
.eyebrow { font-family: var(--mono); font-size: 0.76rem; letter-spacing: 0.07em; text-transform: uppercase; color: var(--muted); }
.lede { font-size: 1.06rem; max-width: 70ch; }
.toc { display: flex; flex-wrap: wrap; gap: 6px 14px; font-family: var(--display); font-weight: 500; }
.toc a { text-decoration: none; border-block-end: 1px solid var(--rule); }
.sevchip { display: inline-grid; place-items: center; min-width: 1.6em; height: 1.6em; padding: 0 4px; border-radius: 4px; font-family: var(--mono); font-weight: 600; font-size: 0.85rem; color: var(--paper); vertical-align: middle; }
.sevchip.s5 { background: var(--s5); } .sevchip.s4 { background: var(--s4); } .sevchip.s3 { background: var(--s3); } .sevchip.s2 { background: var(--s2); } .sevchip.s1 { background: var(--s1); }
.pill { display: inline-block; font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.04em; text-transform: uppercase; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--rule); color: var(--muted); vertical-align: middle; }
.pill.pass { color: var(--good); border-color: var(--good); } .pill.fail { color: var(--s5); border-color: var(--s5); }
.pill.k-know { color: var(--accent); border-color: var(--accent); } .pill.k-why { color: var(--s4); border-color: var(--s4); } .pill.k-you { color: var(--good); border-color: var(--good); }
.scroll { overflow-x: auto; max-width: 100%; }
table.data, table.opts { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
table.data th, table.data td, table.opts th, table.opts td { text-align: left; vertical-align: top; padding: 7px 10px; border-block-end: 1px solid var(--rule); }
table.data th, table.opts th { font-family: var(--display); font-weight: 700; font-size: 0.85rem; border-block-end: 2px solid var(--ink); }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
td.q { max-width: 34ch; } td.w { max-width: 46ch; }
tr.best td { background: var(--accent-soft); }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.tile { background: var(--surface); border: 1px solid var(--rule); border-radius: 6px; padding: 10px 12px; display: grid; gap: 2px; min-width: 0; }
.tile b { font-family: var(--display); font-size: 1.5rem; font-variant-numeric: tabular-nums; }
.finding { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; background: var(--surface); border: 1px solid var(--rule); border-radius: 6px; padding: 10px 12px; }
.finding .body { display: grid; gap: 4px; min-width: 0; }
.finding.good { border-color: var(--good); }
.turn { display: grid; gap: 8px; padding-block: 14px; border-block-end: 1px solid var(--rule); }
.turn.flagged { border-inline-start: 4px solid var(--s4); padding-inline-start: 12px; }
.tn { font-family: var(--display); font-weight: 700; color: var(--muted); display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: baseline; }
.facts { font-family: var(--mono); font-size: 0.8rem; color: var(--muted); display: grid; gap: 2px; }
.t { display: grid; grid-template-columns: 6.5rem minmax(0, 1fr); gap: 10px; align-items: start; }
.t .who { font-family: var(--mono); font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); padding-block-start: 3px; overflow-wrap: anywhere; }
.t.player > div { font-style: italic; }
.t.roll > div, .t.sys > div { font-family: var(--mono); font-size: 0.86rem; }
.prose { max-width: 72ch; }
.say { border-block-end: 2px solid currentColor; }
.say.c0 { color: var(--c0); } .say.c1 { color: var(--c1); } .say.c2 { color: var(--c2); } .say.c3 { color: var(--c3); } .say.c4 { color: var(--c4); } .say.c5 { color: var(--c5); } .say.c6 { color: var(--c6); }
.mk { text-decoration: underline dotted 2px; text-underline-offset: 3px; }
.mk.k-know { text-decoration-color: var(--accent); } .mk.k-why { text-decoration-color: var(--s4); } .mk.k-you { text-decoration-color: var(--good); }
mark.f { background: color-mix(in srgb, var(--s3) 26%, transparent); color: inherit; outline: 1px solid color-mix(in srgb, var(--s3) 60%, transparent); border-radius: 2px; }
mark.f.s5, mark.f.s4 { background: color-mix(in srgb, var(--s5) 24%, transparent); outline-color: color-mix(in srgb, var(--s5) 60%, transparent); }
sup.fref a { font-family: var(--mono); font-size: 0.72em; color: var(--s4); text-decoration: none; }
.mref { font-family: var(--mono); font-size: 0.7em; color: var(--muted); }
.mnotes { margin: 8px 0 0; padding-inline-start: 22px; font-size: 0.88rem; display: grid; gap: 4px; max-width: 75ch; }
ol.calls { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.call { border: 1px solid var(--rule); border-radius: 6px; padding: 10px 12px; background: var(--paper); min-width: 0; }
.call.flag { border-color: var(--s5); border-inline-start-width: 4px; }
.call.failed { border-color: var(--s4); }
.err { color: var(--s5); font-family: var(--mono); font-size: 0.82rem; }
.callhead { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: baseline; }
.callno { font-family: var(--mono); font-weight: 600; }
.op { font-family: var(--mono); font-weight: 600; color: var(--accent); }
.kind { font-family: var(--mono); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
.meta { font-family: var(--mono); font-size: 0.76rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.note { margin-block-start: 6px; max-width: 80ch; }
details { min-width: 0; }
details > summary { cursor: pointer; font-family: var(--display); font-weight: 500; padding-block: 4px; color: var(--accent); }
details.full > summary { font-size: 0.9rem; }
details.part, details.msg, details.sub, details.callsof { margin-block: 6px; padding-inline-start: 12px; border-inline-start: 2px solid var(--rule); }
.role { font-family: var(--mono); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink); }
.role.developer { color: var(--c0); } .role.user { color: var(--c1); } .role.assistant { color: var(--c2); }
.md { font-size: 0.9rem; max-width: 92ch; overflow-wrap: anywhere; display: grid; gap: 6px; }
.md ul, .md ol { margin: 0; padding-inline-start: 22px; }
.md .md-h { font-size: 0.98rem; margin-block-start: 8px; }
.md .cont { padding-inline-start: 22px; }
.raw { font-family: var(--mono); font-size: 0.84rem; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--surface); border: 1px solid var(--rule); border-radius: 4px; padding: 10px; }
.raw .tag { color: var(--accent); font-weight: 600; } .raw .mark { color: var(--s4); }
dl.kv { display: grid; grid-template-columns: minmax(7rem, max-content) minmax(0, 1fr); gap: 4px 12px; margin: 4px 0; font-size: 0.88rem; }
dl.kv dt { font-family: var(--mono); color: var(--muted); overflow-wrap: anywhere; }
dl.kv dd { margin: 0; min-width: 0; }
dl.kv.d1, dl.kv.d2, dl.kv.d3 { border-inline-start: 2px solid var(--rule); padding-inline-start: 8px; }
ol.arr { margin: 2px 0; padding-inline-start: 22px; display: grid; gap: 4px; }
.str { overflow-wrap: anywhere; } .num { font-family: var(--mono); } .nil { color: var(--muted); font-family: var(--mono); }
ol.tools { padding-inline-start: 22px; display: grid; gap: 8px; }
section.q { margin-block: 10px; display: grid; gap: 4px; }
code.ans { background: var(--accent); color: var(--paper); }
table.opts td.opt { white-space: nowrap; }
table.opts tr.chosen td { background: var(--accent-soft); }
td.bar { min-width: 8rem; white-space: nowrap; }
td.bar span { display: inline-block; width: calc(var(--p) * 5rem); height: 0.7em; background: var(--accent); vertical-align: middle; margin-inline-end: 6px; border-radius: 2px; }
td.bar b { font-family: var(--mono); font-weight: 600; font-variant-numeric: tabular-nums; }
.same { font-style: italic; }
footer { border-block-start: 1px solid var(--rule); padding-block-start: 12px; }
@media (max-width: 640px) {
  h1 { font-size: 1.8rem; }
  .t { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  dl.kv { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
`;
