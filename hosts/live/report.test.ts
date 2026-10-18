import { test } from "node:test";
import assert from "node:assert/strict";
import type { Call, LiveRecord, TurnRecord } from "./record.ts";
import { markdownOf, percentile } from "./report.ts";
import { SCRIPTS } from "./scripts.ts";

const call = (turn: number, operation: string, costUsd: number, latencyMs = 1000): Call => ({ key: `g:s1:t${turn}:x`, turn, operation, model: "openai/gpt-6-luna", costUsd, latencyMs });

const S = 1e6;
/** A turn said at second n*10: first words 1.5 s on, the reply 3 s on, done at 6 s. */
function turn(n: number, more: Partial<TurnRecord>): TurnRecord {
  return {
    n, saidAt: n * 10 * S, firstAt: (n * 10 + 1.5) * S, finalAt: (n * 10 + 3) * S, doneAt: (n * 10 + 6) * S,
    suggest: "none", calls: [], entries: [], lines: [], dropped: [], ...more,
  };
}

const opening = turn(0, {
  linesMs: 2_800, suggest: "landed",
  calls: [call(0, "gm.opening", 0.002), call(0, "scene.suggest", 0.0004), call(0, "scene.suggest.judge", 0.0005, 300)],
  entries: [{
    kind: "narration", speaker: "gm", text: "“Missed him.” “Sergeant Agnes Kell.”",
    spoken: [{ who: "Cob", text: "“Missed him.”" }, { who: "Sergeant Agnes Kell", tag: "Sergeant Kell", text: "“Sergeant Agnes Kell.”" }],
  }],
  lines: [{ turn: 0, ord: 1, kind: "say", text: "Sergeant, who found him?" }, { turn: 0, ord: 2, kind: "try", text: "(I try to win the boy round)" }],
  dropped: [{ text: "Who's Hobb?", why: "a name not heard: Hobb" }],
});
const first = turn(1, {
  step: "act say_1", said: "Sergeant, who found him?", suggest: "lost",
  calls: [call(1, "gm.reply", 0.003)],
  entries: [
    { kind: "player", speaker: "player:1", text: "Sergeant, who found him?", spoken: [] },
    { kind: "narration", speaker: "gm", text: "“The porters.” “Cob don’t talk.”", spoken: [{ who: "Sergeant Agnes Kell", tag: "Kell", text: "“The porters.”" }, { who: "nobody can tell", text: "“Cob don’t talk.”" }] },
  ],
});
const record: LiveRecord = {
  script: SCRIPTS.v5!, date: "2026-10-16", rehearse: true, lines: 2, mode: "namespace", model: "fake", game: "g-uid",
  who: "Wren Ashdown: an investigator", build: "halfling rogue 3", turns: [opening, first],
  skipped: [{ step: "act the try line, else say_2", skipped: "no suggested line to pick after turn 1" }],
  stopped: "the dearest turn so far ($0.0034) is more than the $0.0010 left of the budget",
  calls: [...opening.calls, ...first.calls], cost: 0.0059,
  held: { secrets: [{ who: "Cob", text: "He saw the two men." }], essentials: [{ what: "The page in the boot.", with: ["Prout's boots"] }] },
};
const md = markdownOf(record, "npm run live -- --script v5 --lines 2 --rehearse");

test("the record opens with the run at a glance, and its turns' moments", () => {
  assert.match(md, /^# V5 live run, 2026-10-16\n/);
  assert.match(md, /with \*\*the fake model: a rehearsal, not a live run\*\*: `npm run dev` in namespace mode, then `npm run live -- --script v5 --lines 2 --rehearse`/);
  assert.match(md, /\| Turns \| 2: the opening and 1 line, of 2 asked for \|/);
  assert.match(md, /\| Stopped early \| the dearest turn so far/);
  assert.match(md, /\| Skipped \| act the try line, else say_2: no suggested line to pick after turn 1 \|/);
  assert.match(md, /\| 0 \| \(the opening\) \| 1\.5 s \| 3\.0 s \| 2\.8 s \| 6\.0 s \| 3 \| \$0\.0029 \|/);
  assert.match(md, /\| 1 \| act say_1 → Sergeant, who found him\? \| 1\.5 s \| 3\.0 s \| lost \| 6\.0 s \| 1 \| \$0\.0030 \|/);
});

test("the measures against the prototype's: the lines' times, speakers, cost by kind of call (no notes since M2)", () => {
  assert.doesNotMatch(md, /notes/i);
  assert.match(md, /\| The lines after the reply, p50 \| 2\.8 s \(1 set\) \| 2\.8 s \(21 replies\) \|/);
  assert.match(md, /\| Spoken lines the GM tagged \| 2 of 4 \(50%\) \| 43 of 52 \(83%\) \|/);
  assert.match(md, /\| Spoken lines with a speaker \| 3 of 4 /);
  assert.match(md, /\| A reply's lines \(the call and the judge\) \| \$0\.00090 \(1\) \| \$0\.0009 \|/);
});

test("turn by turn: who says what, the lines offered and those screened out", () => {
  assert.match(md, /### The opening\n\n“Missed him\.” “Sergeant Agnes Kell\.”\n/);
  assert.match(md, /- Sergeant Agnes Kell \[Sergeant Kell\]: “Sergeant Agnes Kell\.”/);
  assert.match(md, /Lines offered \(landed, 2\.8 s after the reply\):\n1\. say: Sergeant, who found him\?\n2\. try: \(I try to win the boy round\)/);
  assert.match(md, /Screened out: “Who's Hobb\?” \(a name not heard: Hobb\)\./);
  assert.match(md, /### Turn 1: act say_1 → Sergeant, who found him\?\n\n> Sergeant, who found him\?/);
  assert.match(md, /- nobody can tell: “Cob don’t talk\.”/);
  assert.match(md, /Lines offered: none \(lost: the job gave up\)\./);
});

test("it ends with what the scene holds back, to read every line against", () => {
  assert.match(md, /## What the scene holds back\n[\s\S]*- Cob: He saw the two men\.\n[\s\S]*- The page in the boot\. \(with: Prout's boots\)\n$/);
});

test("percentiles by nearest rank", () => {
  assert.equal(percentile([3, 1, 2], 0.5), 2);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
  assert.equal(percentile([], 0.5), 0);
});

test("a script that records the GM's side: each turn's ruling, memory review and co-GM review, and where the co-GM left the scene", () => {
  const ruledTurn = turn(3, { said: "(I try to lift the folded paper out of the boy's boot)", waited: 12_300 });
  const gm = {
    beat: "yard", sceneStatus: "drifting", notes: "Pull the talk back to Prout.", notesTurn: 6, offGraphTurn: 5, lastRepairTurn: 6,
    rulings: ["3: lift the paper -> sleight_of_hand DC 12 (19) [guarded to lose, plausible cover, wary: they could notice]: success: The investigator has the paper."],
    memoryReviews: ["0: nothing flagged", "3: witnessed — memory kell: What the investigator did"],
    repairs: ["3: on_track — The yard is moving. [merged at t4]"],
    whispers: ["6: moll: She wants to be asked about the songs."], canon: [], patches: ["yard + The player waits in the loft."], established: [],
  };
  const text = markdownOf({ ...record, script: SCRIPTS.gm!, turns: [opening, ruledTurn], gm, settledMs: 4_000 }, "npm run live -- --script gm --rehearse");

  assert.match(text, /## The GM's side\n\nWhat `npm run status` showed once the run was over \(the background jobs waited for: 4\.0 s\)/);
  assert.match(text, /\| 0 \| \(the opening\) \| no \| nothing flagged \|  \|/);
  assert.match(text, /\| 3 \| \(I try to lift the folded paper out of the boy's boot\) \(after 12\.3 s waiting for the background jobs\) \| lift the paper -> sleight_of_hand DC 12 \(19\) \[guarded to lose, plausible cover, wary: they could notice\]: success: The investigator has the paper\. \| witnessed — memory kell: What the investigator did \| on_track — The yard is moving\. \[merged at t4\] \|/);
  assert.match(text, /Where it was left: beat yard; the scene drifting; the co-GM's notes: Pull the talk back to Prout\. \(from turn 6\); the last turn off the graph with nothing ruled on it: 5; the turn the co-GM last reviewed \(merged\): 6\./);
  assert.match(text, /\*\*Whispers\*\*\n\n- 6: moll: She wants to be asked about the songs\.\n\n\*\*Canon\*\*: none\.\n\n\*\*Patches\*\*\n\n- yard \+ The player waits in the loft\.\n/);
  assert.doesNotMatch(md, /## The GM's side/);
});
