import assert from "node:assert/strict";
import { test } from "node:test";
import { callsBefore, callsByTurn, capped, costOf, type Call } from "./calls.ts";
import { newRecord, type GameRecord } from "./record.ts";
import { armStats, byCheck, gameStats } from "./report-data.ts";
import type { Review } from "./review.ts";
import { personas, type Round } from "./round.ts";
import type { Ending } from "./scenes.ts";
import { keptOf, strays, triaged, type Triage } from "./triage.ts";

const ROUND: Round = {
  name: "r1", created: "2026-10-17T20:00:00.000Z", build: { commit: "abc1234", dirty: false }, maxTurns: 3,
  scenes: [{ scene: "hanged-clerk", games: 2 }, { scene: "drowned-rat", games: 1 }],
  arms: { k1: { name: "baseline", stack: "runs/loop-stack" }, k2: { name: "candidate", stack: "other" } },
  games: { g01: { arm: "k1", persona: "thief", scene: "hanged-clerk" }, g02: { arm: "k2", persona: "thief", scene: "hanged-clerk" }, g03: { arm: "k1", persona: "absurd", scene: "drowned-rat" } },
};
const ENDINGS: Ending[] = [{ id: "open-case", title: "Murder by persons unknown", grade: "good", kind: "progress" }, { id: "wrong-man", title: "The wrong name in the book", kind: "other" }];

/** A game of three turns, the opening's and two lines', ended or not. */
function played(id: string, ended?: string): GameRecord {
  return {
    ...newRecord({ round: "r1", game: id, scene: "hanged-clerk", stack: "runs/loop-stack" }), sceneRow: "7", uid: "u1",
    entries: [
      { turn: 0, kind: "narration", text: "The yard." },
      { turn: 1, kind: "player", text: "Hello." }, { turn: 1, kind: "narration", text: "Kell nods." },
      { turn: 2, kind: "player", text: "Who?" }, { turn: 2, kind: "narration", text: "Nobody says." },
    ],
    turns: { "0": { at: "a", ms: 9000, waits: [] }, "1": { at: "b", ms: 4000, waits: [{ at: "c", why: "no answer yet", ms: 20_000 }] }, "2": { at: "d", ms: 6000, waits: [] } },
    ...(ended ? { ended: { turn: 2, title: ended } } : {}),
  };
}

const review = (findings: Review["findings"], overall: number): Review => ({ game: "g", summary: "s", ratings: { pacing: 3, agency: 3, characters: 3, improvisation: 3, dice: 0, overall }, findings, good: [] });

const CALLS: Call[] = [
  { key: "u1:c1:offer", text: "builds", costUsd: 0.01 },
  { key: "u1:s7:t0:open", started: "/v1/responses" },
  { key: "u1:s7:t0:open", text: "The yard.", costUsd: 0.002 },
  { key: "u1:s7:t1:reply", error: "OpenRouter reply HTTP 402: {\"error\":\"in_flight_budget_exhausted\"}" },
  { key: "u1:s7:t1:reply", retry: 1, status: 429 },
  { key: "u1:s7:t1:reply", text: "Kell nods.", costUsd: 0.003 },
  { key: "u1:s7:t1:decide", answers: { attempt: { choice: "none" } }, costUsd: 0.001 },
  { key: "u1:s3:t2:boundary", text: "hand-off", costUsd: 0.004 },
];

test("calls by the turn their key names, whole ones only; what they cost; the 402s; the calls before the scene", () => {
  const byTurn = callsByTurn(CALLS, "7");
  assert.deepEqual([...byTurn.keys()], [0, 1]);
  assert.equal(byTurn.get(0)!.length, 1, "the call going out isn't a call");
  assert.equal(byTurn.get(1)!.length, 3, "a failure is, a try again isn't");
  assert.equal(capped(byTurn.get(1)!), 1);
  assert.equal(Math.round(costOf(CALLS) * 1000), 20);
  assert.deepEqual(callsBefore(CALLS, "7").map(c => c.key), ["u1:c1:offer", "u1:s3:t2:boundary"]);
});

test("triage: numbered from 1, the severity as triaged; a discarded finding doesn't count; a verdict for a finding there isn't is caught", () => {
  const findings = [{ turn: 1, check: "knows", severity: 5, quote: "q", why: "w" }, { turn: 2, check: "drag", severity: 1, quote: "q", why: "w" }];
  const t: Triage = { "g01/1": { verdict: "keep", why: "real", severity: 3 }, "g01/2": { verdict: "discard", why: "no" } };
  const out = triaged("g01", findings, t);
  assert.deepEqual(out.map(f => [f.n, f.severity, f.v?.verdict]), [[1, 3, "keep"], [2, 1, "discard"]]);
  assert.deepEqual(keptOf(out).map(f => f.n), [1]);
  assert.deepEqual(keptOf(triaged("g01", findings, {})).length, 2, "not triaged yet: it counts as filed");
  assert.deepEqual(strays({ ...t, "g01/3": { verdict: "keep", why: "" }, "g07/1": { verdict: "keep", why: "" }, "nonsense": { verdict: "keep", why: "" } }, { g01: 2 }), ["g01/3", "g07/1", "nonsense"]);
});

test("a game's numbers: its replies (the opening's among them), the kept findings' penalty per 10 replies, its ending graded, its calls and cost, its waits, its median turn", () => {
  const g = gameStats(ROUND, "g01", personas(), {
    record: played("g01", "Murder by persons unknown"), review: review([{ turn: 1, check: "knows", severity: 5, quote: "q", why: "w" }, { turn: 2, check: "drag", severity: 2, quote: "q", why: "w" }], 4),
    triage: { "g01/2": { verdict: "discard", why: "no" } }, calls: CALLS, endings: ENDINGS,
  });
  assert.equal(g.replies, 3);
  assert.equal(g.penalty, 16);
  assert.equal(g.per10!.toFixed(1), "53.3");
  assert.deepEqual(g.ending, { title: "Murder by persons unknown", exit: "open-case", outcome: "good" });
  assert.equal(g.outcome, "good");
  assert.equal(g.turns, 2);
  assert.deepEqual([...g.byTurn.keys()], [0, 1]);
  assert.equal(Math.round(g.sceneCostUsd * 1000), 6);
  assert.equal(Math.round(g.costUsd * 1000), 20);
  assert.equal(g.waits, 1);
  assert.equal(g.capped, 1);
  assert.equal(g.medianMs, 6000, "the player's turns, not the opening");

  const ungraded = gameStats(ROUND, "g02", personas(), { record: played("g02", "The wrong name in the book"), triage: {}, calls: [], endings: ENDINGS });
  assert.equal(ungraded.outcome, "ungraded");
  assert.equal(ungraded.per10, undefined, "not reviewed");
  assert.equal(gameStats(ROUND, "g03", personas(), { record: played("g03"), triage: {}, calls: [], endings: [] }).outcome, "none");
  assert.equal(gameStats(ROUND, "g03", personas(), { triage: {}, calls: [], endings: [] }).outcome, "not played");
});

test("the arms side by side, and the findings by check", () => {
  const games = [
    gameStats(ROUND, "g01", personas(), { record: played("g01", "Murder by persons unknown"), review: review([{ turn: 1, check: "knows", severity: 5, quote: "q", why: "w" }], 4), triage: {}, calls: CALLS, endings: ENDINGS }),
    gameStats(ROUND, "g02", personas(), { record: played("g02"), review: review([{ turn: 1, check: "drag", severity: 1, quote: "q", why: "w" }, { turn: 2, check: "knows", severity: 3, quote: "q", why: "w" }], 2), triage: {}, calls: [], endings: ENDINGS }),
    gameStats(ROUND, "g03", personas(), { triage: {}, calls: [], endings: ENDINGS }),
  ];
  const [k1, k2] = armStats(ROUND, games);
  assert.deepEqual([k1!.arm, k1!.name, k1!.games, k1!.played, k1!.reviewed], ["k1", "baseline", 2, 1, 1]);
  assert.deepEqual(k1!.outcomes, { good: 1, mixed: 0, bad: 0, ungraded: 0, none: 0, "not played": 1 });
  assert.equal(k1!.per10!.toFixed(1), "53.3");
  assert.deepEqual(k1!.bySeverity, [1, 0, 0, 0, 0]);
  assert.deepEqual([k2!.outcomes.none, k2!.per10!.toFixed(1), k2!.overall], [1, "16.7", 2]);
  assert.deepEqual(byCheck(games).map(c => [c.check, c.penalty, c.arms.k1?.count ?? 0, c.arms.k2?.count ?? 0]), [["knows", 20, 1, 1], ["drag", 1, 0, 1]]);
});
