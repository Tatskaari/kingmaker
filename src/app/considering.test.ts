import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
const RUNS = mkdtempSync(join(tmpdir(), "km-app-considering-"));
process.env.KM_RUNS_DIR = RUNS;
process.env.KM_COST_LEDGER = join(RUNS, "cost-ledger.jsonl");
process.env.KM_LOOK_MODEL = "off";
process.env.KM_GLYPHS = "ascii";
process.env.KM_APP_STEP_MS = "0";
process.env.KM_APP_COMBAT_DELAY_MS = "0";
process.env.OPENROUTER_API_KEY = "offline";
const { BusyLines, CONSIDERING, Game, GM_BUSY } = await import("./game.ts");
const { rng } = await import("../runtime/dice.ts");
const { setBackgroundRunner } = await import("../runtime/background.ts");
const { fakeOpenRouter } = await import("../llm/fake-openrouter.ts");
const { Game: Core } = await import("../game/play.ts");
const { town } = await import("../game/town.ts");
const { mapFights } = await import("../game/fights.ts");
const { PREGENS } = await import("../game/combat/index.ts");

/**
 * While the GM considers what the player attempted (a considered turn: src/runtime/consider.ts),
 * the scene's status line moves on at each step of the ruling, through the GM's spinner lines,
 * never the same line twice running.
 */

// The GM's notes between turns would be processes of their own: not here.
setBackgroundRunner(() => {});

test("the spinner's lines are dealt like cards: each once a deal, never the same twice running, and short enough for 80 columns", () => {
  const lines = new BusyLines(GM_BUSY, rng(7));
  let showing: string | undefined;
  const seen: string[] = [];
  for (let i = 0; i < GM_BUSY.length * 6; i++) {
    const next = lines.next(showing);
    assert.notEqual(next, showing, `draw ${i} repeated the line on screen`);
    seen.push(next);
    showing = next;
  }
  assert.deepEqual([...new Set(seen.slice(0, GM_BUSY.length))].sort(), [...GM_BUSY].sort(), "the first deal is every line once");
  // Even a line on screen from elsewhere (the considering line, a deal's last card) isn't dealt next.
  const two = new BusyLines(["a…", "b…"], () => 0.99);
  for (let i = 0, last = "a…"; i < 20; i++) { const n = two.next(last); assert.notEqual(n, last); last = n; }
  for (const line of [...GM_BUSY, CONSIDERING]) assert.ok(line.length <= 60, `"${line}" is ${line.length} characters`);
  assert.ok(GM_BUSY.length >= 20, "plenty, so a long turn doesn't come round again soon");
  assert.ok(!GM_BUSY.includes(CONSIDERING), "the considering line opens a considered turn; the rest follow");
});

const RULING = {
  act: "talk the boy into opening his boot's lining", target: "cob", skill: "persuasion", stakes: "guarded", approach: "plausible", disposition: "wary",
  same_again: false, difficulty: "moderate", reason: "to get the boy to open his boot's lining",
  success: { happens: "He drags the boot off and picks out a folded page.", to: "stay", counts_as: "page-found", establishes: [], reveals: ["page"], closes: [] },
  failure: { happens: "He bolts behind the water butt and into the granary.", to: "stay", counts_as: "none", establishes: ["The boy has bolted into the granary."], reveals: [], closes: ["win-cob"] },
};

test("a considered turn in the app: the status line says the GM is considering, then moves on at each step of the ruling, never the same twice running", async () => {
  const fake = fakeOpenRouter({ choices: { roll_call: "new" }, byName: { ruling: RULING }, replies: ["Prout turns on the hoist. Kell looks up from her notebook.", "The boy glares, then tugs at the boot."] });
  try {
    const core = await Core.create({ player: "Tamsin Vell: a disgraced palace auditor", level: 3, build: PREGENS.rogue!.build, explorer: town, fights: mapFights(), seed: 7 });
    for (let i = 0; i < 6 && core.state.mode === "explore"; i++) await core.act("go_to_lead");
    assert.equal(core.state.mode, "scene");
    const app = new Game();
    app.core = core;
    app.screen = "scene";
    const shown: Array<string | undefined> = [];
    app.subscribe(() => { if (shown.at(-1) !== app.busy) shown.push(app.busy); });
    await app.input("*crouches by the boy* Take the left boot off yourself and feel along the lining. Your boot, your hands.");
    const from = shown.indexOf(CONSIDERING);
    assert.ok(from >= 0, `the GM is considering: ${JSON.stringify(shown)}`);
    // consider, then the ruling's three parts and the roll: four more lines, all the GM's spinner's.
    const steps = shown.slice(from + 1, from + 5);
    assert.equal(steps.length, 4, JSON.stringify(shown));
    for (const line of steps) assert.ok(GM_BUSY.includes(line!), `"${line}" is a spinner line`);
    for (let i = 1; i < shown.length; i++) assert.notEqual(shown[i], shown[i - 1], "never the same line twice running");
    assert.ok(shown.includes("The GM makes a note…"), "then the reply, and the notes after it");
    assert.equal(app.busy, undefined, "and the floor is the player's again");
    assert.ok(core.session.transcript.some(e => e.kind === "roll" && /^Persuasion check to get the boy to open his boot's lining/.test(e.text)), "the roll was made");
  } finally {
    fake.restore();
  }
});
