import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { SessionState } from "../../runtime/session.ts";
import type { LoopCase } from "./fixture.ts";
import { locate } from "./html.ts";
import type { Judgement } from "./judge.ts";
import { CASES_DIR } from "./paths.ts";
import { checkReview, rubricChecks, type Review } from "./review.ts";
import { triaged } from "./triage.ts";

test("the rubric's checks are its #### `id` headings", () => {
  const checks = rubricChecks();
  for (const id of ["knows", "player-words", "dump", "withheld", "roll-failure", "broken"]) assert.ok(checks.includes(id), id);
  assert.equal(new Set(checks).size, checks.length, "no check twice");
});

test("a quote is found with curly quotes and spacing taken as plain", () => {
  assert.deepEqual(locate("Kell says “We don’t have the page.”", "We don't have the page"), [11, 33]);
  assert.equal(locate("Kell says nothing.", "the page"), undefined);
});

test("a review's quotes must be in the reply of the turn they name", () => {
  const dir = join(CASES_DIR, "hc-kell-page-leak");
  const state = { ...JSON.parse(readFileSync(join(dir, "state.json"), "utf8")), transcript: JSON.parse(readFileSync(join(dir, "transcript.json"), "utf8")) } as SessionState;
  const base: Review = { game: "g01", summary: "s", ratings: { pacing: 3, agency: 3, characters: 3, improvisation: 3, dice: 0, overall: 3 }, findings: [], good: [] };
  assert.deepEqual(checkReview(base, state), []);
  const reply3 = state.transcript.find(e => e.turn === 3 && e.kind !== "player")!.text;
  const quote = reply3.slice(0, 30);
  assert.deepEqual(checkReview({ ...base, findings: [{ turn: 3, check: "player-words", severity: 5, quote, why: "w" }] }, state), []);
  const bad = checkReview({ ...base, findings: [{ turn: 4, check: "player-words", severity: 5, quote, why: "w" }, { turn: 3, check: "nope", severity: 9, quote, why: "w" }] }, state);
  assert.ok(bad.some(p => p.includes("isn't in turn 4's reply")));
  assert.ok(bad.some(p => p.includes('no check "nope"')));
  assert.ok(bad.some(p => p.includes("severity must be 1 to 5")));
});

test("triage: discarded findings don't count, a discarded criterion verdict flips", () => {
  const c = { checks: ["knows"], failAt: 3 } as LoopCase;
  const j: Judgement = {
    findings: [{ check: "knows", severity: 5, quote: "q", why: "w", quoted: true }, { check: "drag", severity: 1, quote: "q", why: "w", quoted: true }],
    criterion: { pass: false, reason: "r" }, pass: false, penalty: 17, costUsd: 0, model: "m",
  };
  assert.equal(triaged(c, "k", j, {}).pass, false);
  assert.equal(triaged(c, "k", j, {}).untriaged, 3);
  const t = triaged(c, "k", j, { "k/1": { verdict: "discard", why: "x" }, "k/criterion": { verdict: "discard", why: "y" }, "k/2": { verdict: "keep", why: "z" } });
  assert.deepEqual(t, { pass: true, penalty: 1, criterionPass: true, untriaged: 0 });
  assert.equal(triaged(c, "k", j, { "k/1": { verdict: "keep", why: "x", severity: 2 }, "k/criterion": { verdict: "discard", why: "y" } }).pass, true, "kept below failAt");
});
