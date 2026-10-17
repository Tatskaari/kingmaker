/**
 * Triage: a careful read of each finding before it's believed. The judge (or a blind reviewer) is
 * fallible, so every finding gets a verdict in triage.json beside the run or round: kept (it's real,
 * with why in plain words, perhaps at another severity) or discarded (it isn't, and why). The
 * reports show the triage's why first and count only what was kept.
 *
 *   eval run: "<variant>/<case>/<sample>/<n>" for a finding (n from 1), "<variant>/<case>/<sample>/criterion"
 *             for the criterion's verdict (discard: the judge called it wrong, so it's flipped)
 *   QA round: "<game>/<n>"
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionState } from "../../runtime/session.ts";
import { evalsRoot, results } from "./eval.ts";
import { readCase, type LoopCase } from "./fixture.ts";
import { PENALTY } from "./html.ts";
import type { Judgement } from "./judge.ts";
import { CASES_DIR } from "./paths.ts";
import { turnsOf, turnText, type Review } from "./review.ts";
import { gameDir, roundDir } from "./round.ts";

export interface Verdict { verdict: "keep" | "discard"; why: string; severity?: number }
export type Triage = Record<string, Verdict>;

export function loadTriage(dir: string): Triage {
  const file = join(dir, "triage.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as Triage : {};
}

export const sampleKey = (r: { variant: string; case: string; sample: number }) => `${r.variant}/${r.case}/${r.sample}`;

/** A judgement after triage: discarded findings out, severities as triaged, the criterion as triaged. */
export function triaged(c: LoopCase, key: string, j: Judgement, t: Triage): { pass: boolean; penalty: number; criterionPass: boolean; untriaged: number } {
  const crit = t[`${key}/criterion`];
  const criterionPass = crit?.verdict === "discard" ? !j.criterion.pass : j.criterion.pass;
  const kept = j.findings.map((f, i) => ({ f, v: t[`${key}/${i + 1}`] })).filter(x => x.v?.verdict !== "discard")
    .map(x => ({ ...x.f, severity: x.v?.severity ?? x.f.severity }));
  const failing = kept.some(f => c.checks.includes(f.check) && f.severity >= c.failAt);
  return {
    pass: criterionPass && !failing,
    penalty: kept.reduce((a, f) => a + (PENALTY[f.severity] ?? 0), 0),
    criterionPass,
    untriaged: j.findings.filter((_, i) => !t[`${key}/${i + 1}`]).length + (crit ? 0 : 1),
  };
}

/**
 * The worksheet for triage: every finding (and every criterion the judge failed) with its key, the
 * reply it's about and what's already been decided. Writing triage.json from it is a careful read,
 * not a formality: check each against the reply, the case's criterion and the truth sheet.
 */
export function triageSheet(target: string): string {
  const evalDir = existsSync(join(target, "run.json")) ? target : existsSync(join(evalsRoot(), target, "run.json")) ? join(evalsRoot(), target) : undefined;
  const out: string[] = [];
  if (evalDir) {
    const t = loadTriage(evalDir);
    out.push(`# Triage for ${evalDir}\n\nWrite ${join(evalDir, "triage.json")}: { "<key>": { "verdict": "keep" | "discard", "why": "...", "severity"?: n } }.\nFor a criterion, "discard" means the judge called it wrong (the verdict flips).`);
    const byCase = new Map<string, LoopCase>();
    for (const r of results(evalDir).filter(r => r.ok && r.judgement)) {
      const c = byCase.get(r.case) ?? readCase(join(CASES_DIR, r.case));
      byCase.set(r.case, c);
      const key = sampleKey(r);
      const j = r.judgement!;
      const items = [
        ...(!j.criterion.pass ? [`- \`${key}/criterion\`${t[`${key}/criterion`] ? ` [${t[`${key}/criterion`]!.verdict}]` : ""}: the judge says it misses the criterion: ${j.criterion.reason}`] : []),
        ...j.findings.map((f, i) => `- \`${key}/${i + 1}\`${t[`${key}/${i + 1}`] ? ` [${t[`${key}/${i + 1}`]!.verdict}]` : ""}: ${f.check} ${f.severity} on "${f.quote}"${f.quoted ? "" : " (quote not in the reply)"}: ${f.why}`),
      ];
      if (!items.length) continue;
      out.push(`## ${key}: ${j.pass ? "pass" : "fail"} as judged\n\nThe player: ${c.input}\n\nThe reply:\n${r.reply!.split("\n").map(l => `> ${l}`).join("\n")}\n\n${items.join("\n")}`);
    }
    return out.join("\n\n");
  }
  const dir = existsSync(join(target, "round.json")) ? target : roundDir(target);
  if (!existsSync(join(dir, "round.json"))) throw new Error(`${target} is neither an eval run nor a round.`);
  const name = JSON.parse(readFileSync(join(dir, "round.json"), "utf8")).name as string;
  const t = loadTriage(dir);
  out.push(`# Triage for round ${name}\n\nWrite ${join(dir, "triage.json")}: { "<game>/<n>": { "verdict": "keep" | "discard", "why": "...", "severity"?: n } }.`);
  for (const file of readdirSync(join(dir, "reviews")).filter(f => /^g\d+\.json$/.test(f)).sort()) {
    const game = file.replace(/\.json$/, "");
    const review = JSON.parse(readFileSync(join(dir, "reviews", file), "utf8")) as Review;
    const state = JSON.parse(readFileSync(join(gameDir(name, game), "state.json"), "utf8")) as SessionState;
    const turns = turnsOf(state);
    for (const [i, f] of review.findings.entries()) {
      const key = `${game}/${i + 1}`;
      out.push(`## ${key}${t[key] ? ` [${t[key]!.verdict}]` : ""}: ${f.check} ${f.severity}, turn ${f.turn}\n\n${turnText(state, turns.get(f.turn) ?? []).split("\n").map(l => `> ${l}`).join("\n")}\n\nQuote: "${f.quote}"\nWhy: ${f.why}${f.better ? `\nBetter: ${f.better}` : ""}`);
    }
  }
  return out.join("\n\n");
}

/** A finding's why, as the report shows it: the triage's own words first, then the judge's. */
export function whyHtml(esc: (s: unknown) => string, judgeWhy: string, v: Verdict | undefined, who = "judge"): string {
  if (!v) return `<div class="triage"><span>${esc(judgeWhy)}</span><span class="faint">(${who}; not triaged yet)</span></div>`;
  return `<div class="triage"><span class="mine"><span class="pill ${v.verdict === "keep" ? "fail" : "pass"}">${v.verdict === "keep" ? "kept" : "discarded"}</span> ${esc(v.why)}</span><span class="faint">${who}: ${esc(judgeWhy)}</span></div>`;
}
