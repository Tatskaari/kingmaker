// After the GM loop's src/eval/loop/html.ts at 5f01806 (origin/claude/gm-loop, draft PR #663), itself after the 2026-10-16 autopsy's report: the escaping and Markdown, the call viewer (each call opened as its own transcript, a part unchanged since the last call of its kind folded, a changed one diffed) and the page with its CSS, as they were but for the call's type (calls.ts) and a request's json given by name; the transcript's entry is the game's (record.ts): who said each spoken line, by name, in a colour of their own, and the findings marked on the words they quote. `value` and `locate` are left out (locate is review.ts's).
import type { Call } from "./calls.ts";
import type { Entry } from "./record.ts";
import { locate, type Finding } from "./review.ts";

/**
 * The GM loop's reports as HTML: every model call in full (its instructions, each message, a
 * decider's state and every option's probability, what came back), and the transcript with the
 * review's findings marked on the words they quote.
 */

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

// ---------------------------------------------------------------------------------------------
// Model calls: a row each on the page, opened in a panel as the call's own transcript

/** What a call said, in a line: its answers, or the start of what it wrote. */
function preview(c: Call): string {
  if (c.answers) return Object.entries(c.answers).map(([q, a]) => `${q} → ${a.choice}${a.probabilities?.[a.choice] !== undefined ? ` (${Number(a.probabilities[a.choice]).toFixed(2)})` : ""}`).join(" · ");
  return (c.error ? `failed: ${c.error}` : c.text ?? "").replace(/\s+/g, " ").slice(0, 180);
}

/**
 * A page's model calls. Each is a row (`row`); the page carries them all as JSON (`script`), long
 * strings stored once, and a viewer that opens one as its own transcript: the instructions, every
 * message in order, what came back, a decider's questions with every option's probability.
 */
export class CallBook {
  private strings: string[] = [];
  private index = new Map<string, number>();
  private calls: Array<{ id: string; label: string; call: unknown }> = [];

  private pack(v: unknown): unknown {
    if (typeof v === "string") {
      if (v.length < 120) return v;
      let i = this.index.get(v);
      if (i === undefined) { i = this.strings.length; this.strings.push(v); this.index.set(v, i); }
      return { $s: i };
    }
    if (Array.isArray(v)) return v.map(x => this.pack(x));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.pack(x)]));
    return v;
  }

  /** A row that opens the call; `label` is how the page names it ("#12", "judge #3"). */
  row(c: Call, options: { id: string; label: string }): string {
    this.calls.push({ id: options.id, label: options.label, call: this.pack(c) });
    const kind = c.answers ? "decision" : "writes text";
    const meta = [c.model, c.latencyMs !== undefined ? `${(c.latencyMs / 1000).toFixed(1)} s` : "", c.tokens ? `${(c.tokens.in ?? 0).toLocaleString()} in` : "", c.costUsd !== undefined ? `$${Number(c.costUsd).toFixed(4)}` : ""].filter(Boolean);
    return `<li><button type="button" class="callrow${c.error ? " failed" : ""}" data-call="${esc(options.id)}"><span class="callno">${esc(options.label)}</span><span class="op">${esc(c.operation ?? "?")}</span><span class="kind">${kind}</span><span class="meta">${esc(meta.join(" · "))}</span><span class="pv">${esc(preview(c))}</span></button></li>`;
  }

  /** The calls' data, the panel and the viewer: once per page, at the end. */
  script(): string {
    // Escaped so the JSON can't end the script tag, nor a line in older parsers (U+2028, U+2029).
    const json = JSON.stringify({ strings: this.strings, calls: this.calls }).replace(/</g, "\\u003c")
      .replaceAll(String.fromCharCode(0x2028), "\\u2028").replaceAll(String.fromCharCode(0x2029), "\\u2029");
    return `<div class="panel-back" id="km-back" hidden></div>
<aside class="panel" id="km-panel" hidden aria-label="A model call" tabindex="-1">
<div class="panel-head"><div class="panel-title" id="km-title"></div><div class="panel-nav">
<button type="button" id="km-prev" title="Previous call (←)">←</button><button type="button" id="km-next" title="Next call (→)">→</button>
<button type="button" id="km-copy">Copy JSON</button><button type="button" id="km-close" title="Close (Esc)">Close</button></div></div>
<div class="panel-body" id="km-body"></div>
</aside>
<script type="application/json" id="km-calls">${json}</script>
<script>${VIEWER}</script>`;
  }
}

const VIEWER = String.raw`(() => {
  const data = JSON.parse(document.getElementById("km-calls").textContent);
  const S = data.strings;
  const isRef = v => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && "$s" in v;
  const un = v => isRef(v) ? S[v.$s] : Array.isArray(v) ? v.map(un) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, un(x)])) : v;
  const byId = new Map(data.calls.map((c, i) => [c.id, i]));
  const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const inline = s => esc(s).replace(/\x60([^\x60]+)\x60/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  function md(text) {
    const out = []; let para = []; const stack = [];
    const flush = () => { if (para.length) { out.push("<p>" + para.map(inline).join("<br>") + "</p>"); para = []; } };
    const close = (d = 0) => { while (stack.length > d) out.push("</" + stack.pop() + ">"); };
    for (const raw of String(text ?? "").split("\n")) {
      const line = raw.replace(/\s+$/, "");
      const h = /^(#{1,6})\s+(.*)$/.exec(line), li = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
      if (!line.trim()) { flush(); close(); continue; }
      if (h) { flush(); close(); out.push('<h6 class="md-h">' + inline(h[2]) + "</h6>"); continue; }
      if (li) { flush(); const d = Math.floor(li[1].length / 2) + 1, tag = /\d/.test(li[2]) ? "ol" : "ul"; while (stack.length < d) { out.push("<" + tag + ">"); stack.push(tag); } close(d); out.push("<li>" + inline(li[3]) + "</li>"); continue; }
      close(); para.push(line);
    }
    flush(); close();
    return '<div class="md">' + out.join("") + "</div>";
  }
  // What changed since the same part of an earlier call: a line diff (longest common subsequence).
  function diff(a, b) {
    const x = a.split("\n"), y = b.split("\n"), n = x.length, m = y.length;
    if (n * m > 4e6) return '<p class="faint">Too long to compare.</p>';
    const t = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = x[i] === y[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    const rows = []; let i = 0, j = 0, same = 0;
    const keep = () => { if (same) rows.push('<div class="d-same">… ' + same + " unchanged line" + (same === 1 ? "" : "s") + "</div>"); same = 0; };
    while (i < n || j < m) {
      if (i < n && j < m && x[i] === y[j]) { same++; i++; j++; }
      else if (j < m && (i >= n || t[i][j + 1] >= t[i + 1][j])) { keep(); rows.push('<div class="d-add">+ ' + esc(y[j]) + "</div>"); j++; }
      else { keep(); rows.push('<div class="d-del">− ' + esc(x[i]) + "</div>"); i++; }
    }
    keep();
    return '<div class="diff">' + rows.join("") + "</div>";
  }
  // The same part of the last call of the same kind before this one: its raw (packed) value and label.
  function earlier(i, pick) {
    const op = un(data.calls[i].call.operation);
    for (let k = i - 1; k >= 0; k--) if (un(data.calls[k].call.operation) === op) return { label: data.calls[k].label, value: pick(data.calls[k].call) };
    return undefined;
  }
  function bubble(kind, title, packed, before, body) {
    const text = un(packed);
    const same = before && before.value !== undefined && JSON.stringify(before.value) === JSON.stringify(packed);
    const changed = before && before.value !== undefined && !same && typeof text === "string" && typeof un(before.value) === "string";
    const badge = !before || before.value === undefined ? "" : same ? '<span class="badge">unchanged since ' + esc(before.label) + "</span>" : '<span class="badge new">changed since ' + esc(before.label) + "</span>";
    const len = typeof text === "string" ? " · " + text.length.toLocaleString() + " characters" : "";
    // What's the same as last time starts folded, so what's new this call is what shows.
    const id = "km-b" + toc.length;
    toc.push('<a href="#' + id + '" class="' + (same ? "same" : changed ? "changed" : "") + '">' + esc(title) + "</a>");
    return '<details class="bubble b-' + kind + '" id="' + id + '"' + (same ? "" : " open") + '><summary><span class="role">' + esc(title) + "</span>" + badge + '<span class="faint">' + len + "</span></summary>" +
      (changed ? '<details class="sub"><summary>What changed since ' + esc(before.label) + "</summary>" + diff(un(before.value), text) + "</details>" : "") + body + "</details>";
  }
  const pre = v => '<pre class="json">' + esc(typeof v === "string" ? v : JSON.stringify(v, null, 2)) + "</pre>";
  const rawText = s => '<div class="raw">' + esc(s).replace(/\[([^\]:]{1,60})\](?=\s*[“"])/g, '<span class="tag">[$1]</span>').replace(/\[(why|know|you):([^\]]*)\]/g, '<span class="mark">[$1:$2]</span>') + "</div>";
  let toc = [];
  function render(i) {
    toc = [];
    const packed = data.calls[i].call, c = un(packed), r = c.request || {}, parts = [];
    const meta = [c.provider, c.model, c.effort && "effort " + c.effort, c.latencyMs !== undefined && Math.round(c.latencyMs) + " ms", c.firstTextMs && "first text " + Math.round(c.firstTextMs) + " ms", c.tokens && (c.tokens.in || 0).toLocaleString() + " tokens in, " + (c.tokens.out || 0) + " out", c.costUsd !== undefined && "$" + Number(c.costUsd).toFixed(4), c.at].filter(Boolean);
    parts.push('<p class="meta">' + esc(meta.join(" · ")) + "</p>");
    if (c.error) parts.push('<p class="err">Failed: ' + esc(c.error) + "</p>");
    if (c.answers) {
      parts.push(bubble("state", "What it was shown (the decision state)", packed.request && packed.request.state, earlier(i, x => x.request && x.request.state), typeof r.state === "string" ? md(r.state) : pre(r.state)));
      for (const [q, spec] of Object.entries(r.questions || {})) {
        const a = (c.answers || {})[q] || {}, probs = a.probabilities || {};
        const opts = [...new Set([...Object.keys(spec.criteria || {}), ...Object.keys(probs)])];
        const rows = opts.map(o => '<tr class="' + (a.choice === o ? "chosen" : "") + '"><td><code>' + esc(o) + "</code></td><td class=\"bar\"><span style=\"--p:" + (probs[o] || 0) + '"></span><b>' + (probs[o] === undefined ? "–" : Number(probs[o]).toFixed(2)) + "</b></td><td>" + (spec.criteria && spec.criteria[o] ? md(spec.criteria[o]) : "") + "</td></tr>").join("");
        parts.push(bubble("q", "Question " + q + " → " + (a.choice || "?") + (a.confidence !== undefined ? " (confidence " + Number(a.confidence).toFixed(2) + ")" : ""), undefined, undefined,
          (spec.instructions ? md(spec.instructions) : "") + '<div class="scroll"><table class="opts"><thead><tr><th>option</th><th>probability</th><th>what it means</th></tr></thead><tbody>' + rows + "</tbody></table></div>"));
      }
    } else {
      parts.push(bubble("system", "Instructions (system)", packed.request && packed.request.instructions, earlier(i, x => x.request && x.request.instructions), md(r.instructions)));
      (r.input || []).forEach((m, k) => parts.push(bubble(m.role, m.role + " message " + (k + 1) + " of " + r.input.length, packed.request.input[k].content, earlier(i, x => x.request && x.request.input && x.request.input[k] && x.request.input[k].role === m.role ? x.request.input[k].content : undefined), md(m.content))));
      if (r.json) parts.push('<p class="faint">Answering as JSON: <code>' + esc(typeof r.json === "string" ? r.json : r.json.name || "") + "</code></p>");
      for (const t of c.calls || []) parts.push(bubble("tool", "Tool call: " + t.name, undefined, undefined, pre({ args: t.args, result: t.result })));
      let out; try { out = pre(JSON.parse(c.text)); } catch { out = rawText(c.text || ""); }
      parts.push(bubble("out", "What it wrote", undefined, undefined, out));
    }
    return '<nav class="ptoc">' + toc.join("") + '</nav><p class="faint">Parts unchanged since the last call of this kind start folded; changed ones are marked, with what changed.</p>' + parts.join("");
  }
  const panel = document.getElementById("km-panel"), back = document.getElementById("km-back"), body = document.getElementById("km-body"), title = document.getElementById("km-title");
  let at = -1;
  function open(i) {
    if (i < 0 || i >= data.calls.length) return;
    at = i;
    const c = data.calls[i];
    title.innerHTML = '<span class="callno">' + esc(c.label) + '</span> <span class="op">' + esc(un(c.call.operation)) + "</span>";
    body.innerHTML = render(i);
    body.scrollTop = 0;
    panel.hidden = false; back.hidden = false; panel.focus();
  }
  function shut() { panel.hidden = true; back.hidden = true; at = -1; }
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-call]"); if (b) { const i = byId.get(b.getAttribute("data-call")); if (i !== undefined) open(i); } });
  back.addEventListener("click", shut);
  document.getElementById("km-close").addEventListener("click", shut);
  document.getElementById("km-prev").addEventListener("click", () => open(at - 1));
  document.getElementById("km-next").addEventListener("click", () => open(at + 1));
  document.getElementById("km-copy").addEventListener("click", e => {
    const text = JSON.stringify(un(data.calls[at].call), null, 1), btn = e.currentTarget;
    const fallback = () => { body.insertAdjacentHTML("afterbegin", '<textarea class="copybox" readonly>' + esc(text) + "</textarea>"); const t = body.querySelector(".copybox"); t.focus(); t.select(); };
    try { navigator.clipboard.writeText(text).then(() => { btn.textContent = "Copied"; setTimeout(() => { btn.textContent = "Copy JSON"; }, 1500); }, fallback); } catch { fallback(); }
  });
  document.addEventListener("keydown", e => {
    if (panel.hidden) return;
    if (e.key === "Escape") shut();
    else if (e.key === "ArrowLeft" && !e.target.closest("textarea")) open(at - 1);
    else if (e.key === "ArrowRight" && !e.target.closest("textarea")) open(at + 1);
  });
})();`;


// ---------------------------------------------------------------------------------------------
// The transcript

/** Who spoke, by name, in one of six colours: the order they first spoke in the game. */
export class Speakers {
  private readonly order: string[] = [];
  colour(name: string): number {
    if (!this.order.includes(name)) this.order.push(name);
    return (this.order.indexOf(name) % 6) + 1;
  }
}

/** A transcript entry: the player's line, the dice, the game's line, or the GM's words with each spoken line in its speaker's colour, and any findings marked on the words they quote. */
export function entryHtml(e: Entry, who: Speakers, findings: Array<Finding & { n: number }> = []): string {
  if (e.kind === "player") return `<div class="t player"><span class="who">Player</span><div>${inline(e.text)}</div></div>`;
  if (e.kind === "roll") return `<div class="t roll"><span class="who">Dice</span><div>${esc(e.text)}</div></div>`;
  if (e.kind === "system") return `<div class="t sys"><span class="who">Game</span><div>${esc(e.text)}</div></div>`;
  const text = e.text ?? "";
  const events: Array<{ at: number; open: boolean; rank: number; html: string }> = [];
  for (const s of e.speech ?? []) {
    events.push({ at: s.start, open: true, rank: 0, html: `<span class="say c${who.colour(s.who)}" title="${esc(s.who)}"><span class="sayer">${esc(s.who)}:</span> ` });
    events.push({ at: s.end, open: false, rank: 0, html: "</span>" });
  }
  for (const f of findings) {
    const at = locate(text, unlabelled(f.quote, e));
    if (!at) continue;
    events.push({ at: at[0], open: true, rank: 2, html: `<mark class="f s${f.severity}" id="f-${f.n}">` });
    events.push({ at: at[1], open: false, rank: 2, html: `</mark><sup class="fref s${f.severity}"><a href="#fd-${f.n}">${f.n}</a></sup>` });
  }
  // Spans can cross: close and reopen at each boundary would be exact; close-before-open is enough here.
  events.sort((a, b) => a.at - b.at || (a.open === b.open ? (a.open ? a.rank - b.rank : b.rank - a.rank) : a.open ? 1 : -1));
  let html = "", pos = 0;
  for (const ev of events) { html += esc(text.slice(pos, ev.at)); html += ev.html; pos = ev.at; }
  html += esc(text.slice(pos));
  const speaker = e.kind === "dialogue" ? `<span class="who c${who.colour(e.who ?? "Someone")}">${esc(e.who ?? "Someone")}</span>` : `<span class="who">GM</span>`;
  return `<div class="t gm">${speaker}<div class="prose">${html.replace(/\n/g, "<br>")}</div></div>`;
}

/** A quote as the pack showed it, a speaker's "Name: " before a spoken line, as it is in the entry's own words. */
function unlabelled(quote: string, e: Entry): string {
  return (e.speech ?? []).reduce((q, s) => q.split(`${s.who}: `).join(""), quote);
}

export const sevChip = (s: number) => `<span class="sevchip s${s}">${s}</span>`;

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
[hidden] { display: none !important; }
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
.say .sayer { font-family: var(--mono); font-size: 0.74em; text-transform: uppercase; letter-spacing: 0.04em; }
.t .who.c1 { color: var(--c1); } .t .who.c2 { color: var(--c2); } .t .who.c3 { color: var(--c3); } .t .who.c4 { color: var(--c4); } .t .who.c5 { color: var(--c5); } .t .who.c6 { color: var(--c6); }
.waits { font-family: var(--mono); font-size: 0.8rem; color: var(--s3); display: grid; gap: 2px; }
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
ol.callrows { list-style: none; padding: 0; margin: 4px 0 0; display: grid; gap: 4px; }
button.callrow { all: unset; box-sizing: border-box; cursor: pointer; width: 100%; display: flex; flex-wrap: wrap; gap: 2px 10px; align-items: baseline; padding: 6px 10px; border: 1px solid var(--rule); border-radius: 5px; background: var(--paper); }
button.callrow:hover { border-color: var(--accent); }
button.callrow:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
button.callrow.failed { border-color: var(--s4); }
button.callrow .pv { flex-basis: 100%; font-size: 0.84rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.panel-back { position: fixed; inset: 0; background: color-mix(in srgb, var(--ink) 35%, transparent); z-index: 10; }
.panel { position: fixed; inset-block: 0; inset-inline-end: 0; width: min(1000px, 100vw); background: var(--surface); border-inline-start: 1px solid var(--rule); z-index: 11; display: grid; grid-template-rows: auto minmax(0, 1fr); outline: none; }
.panel-head { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; justify-content: space-between; padding: calc(10px + env(safe-area-inset-top, 0px)) 16px 10px; border-block-end: 1px solid var(--rule); }
.panel-title { font-family: var(--display); font-size: 1.1rem; font-weight: 700; display: flex; gap: 8px; align-items: baseline; }
.panel-nav { display: flex; gap: 6px; }
.panel-nav button { font: 500 0.88rem var(--display); color: var(--accent); background: var(--paper); border: 1px solid var(--rule); border-radius: 4px; padding: 4px 10px; cursor: pointer; }
.panel-nav button:hover { border-color: var(--accent); }
.panel-body { overflow-y: auto; padding: 12px 16px calc(40px + env(safe-area-inset-bottom, 0px)); display: grid; gap: 10px; align-content: start; }
.panel-body .meta { margin: 0; }
.ptoc { display: flex; flex-wrap: wrap; gap: 4px 12px; font-family: var(--mono); font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.04em; }
.ptoc a { text-decoration: none; color: var(--accent); }
.ptoc a.same { color: var(--muted); } .ptoc a.changed { color: var(--s3); font-weight: 600; }
details.bubble { border: 1px solid var(--rule); border-inline-start: 4px solid var(--c0); border-radius: 6px; padding: 6px 12px 10px; background: var(--paper); min-width: 0; }
details.bubble > summary { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; color: var(--ink); }
.bubble .role { font-family: var(--mono); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; }
.b-system { border-inline-start-color: var(--c6); } .b-developer { border-inline-start-color: var(--c4); } .b-user { border-inline-start-color: var(--c1); }
.b-assistant { border-inline-start-color: var(--c2); } .b-out { border-inline-start-color: var(--accent); background: var(--accent-soft); } .b-state, .b-q { border-inline-start-color: var(--c5); } .b-tool { border-inline-start-color: var(--c3); }
.badge { font-family: var(--mono); font-size: 0.7rem; padding: 0 6px; border-radius: 999px; border: 1px solid var(--rule); color: var(--muted); }
.badge.new { color: var(--s3); border-color: var(--s3); }
pre.json { font-family: var(--mono); font-size: 0.8rem; white-space: pre-wrap; overflow-wrap: anywhere; margin: 6px 0 0; }
.diff { font-family: var(--mono); font-size: 0.78rem; white-space: pre-wrap; overflow-wrap: anywhere; display: grid; gap: 1px; margin-block: 6px; }
.d-add { background: color-mix(in srgb, var(--good) 18%, transparent); } .d-del { background: color-mix(in srgb, var(--s5) 16%, transparent); } .d-same { color: var(--muted); font-style: italic; }
textarea.copybox { width: 100%; min-height: 8rem; font-family: var(--mono); font-size: 0.78rem; background: var(--paper); color: var(--ink); border: 1px solid var(--rule); }
.triage { display: grid; gap: 2px; }
.triage .mine { font-weight: 600; }
tr.discarded td { opacity: 0.55; } tr.discarded td.q { text-decoration: line-through; }
@media (max-width: 640px) {
  h1 { font-size: 1.8rem; }
  .t { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  dl.kv { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
`;

