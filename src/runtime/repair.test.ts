import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
const RUNS = mkdtempSync(join(tmpdir(), "km-repair-"));
process.env.KM_RUNS_DIR = RUNS;
process.env.KM_COST_LEDGER = join(RUNS, "cost-ledger.jsonl");
process.env.OPENROUTER_API_KEY = "offline";
const { SCENES, sceneById } = await import("../../scenes/index.ts");
const { effectiveScene, leftBehind, openRoutes } = await import("./brief.ts");
const { applyPendingRepairs, applyRepair, repairFile, writeRepair } = await import("./repair.ts");
const { playerTurn } = await import("./engine.ts");
const { saveSession } = await import("./session.ts");
const { fakeOpenRouter } = await import("../llm/fake-openrouter.ts");
type SessionState = import("./session.ts").SessionState;
type RepairResult = import("./session.ts").RepairResult;

/**
 * The co-GM can't undo progress (src/runtime/repair.ts): its tracker moves and its routes don't take
 * a scene back past what's been settled, a question to the GM isn't the scene's time passing, and a
 * quick co-GM's late answer isn't overwritten by the full review of the same turn.
 */

const rat = sceneById("drowned-rat");
const IDENTIFIED = rat.beats.find(b => b.id === "the-rat")!.transitions.find(t => t.id === "found-him")!.establishes![0]!;
const ADMITTED = "Hobb has admitted he held Prout in the loft and held the rope.";

/** The Rat as Brother Ambrose played it: Hobb found, the co-GM's bell at T53, then its move to the confession at T57. */
function confessing(id: string): SessionState {
  return {
    id, sceneId: "drowned-rat", approach: "v2", seed: 3, rollCount: 0,
    player: { name: "Brother Ambrose Hake", concept: "a disgraced temple bookkeeper", modifiers: { persuasion: 0, insight: 6 } },
    turn: 62, beat: "confession", turnsInBeat: 4,
    path: [
      { turn: 47, from: "the-rat", to: "big-hobb", via: "found-him", source: "post", known: 0 },
      { turn: 53, from: "big-hobb", to: "on-his-feet", via: "repair", source: "repair", known: 1 },
      { turn: 57, from: "on-his-feet", to: "confession", via: "repair", source: "repair", known: 1 },
    ],
    established: [IDENTIFIED, ADMITTED], canon: [], notes: null, notesTurn: null,
    patches: [], repairs: [], transcript: [], metrics: [], history: [],
  };
}

/** The co-GM's route of T63: "after the eleventh bell, Hobb rises to leave for the Heron", back to on-his-feet. */
const BACK = { turn: 62, why: "the bell", transition: { beat: "confession", transition: { id: "improv-63-0", on: "outcome" as const, when: "After the eleventh bell, Hobb rises to leave for the Heron without bolting.", to: "on-his-feet" } } };
const review = (r: Partial<RepairResult>): RepairResult => ({ turn: 62, assessment: "", status: "on_track", notes: "", canon: [], patches: [], costUsd: 0, latencyMs: 0, ...r });

test("a beat the scene left before something was settled is behind it", () => {
  const state = confessing("repair-behind");
  assert.equal(leftBehind(state, "on-his-feet"), true, "left at T57, and the admission is on record since");
  assert.equal(leftBehind(state, "confession"), false, "where it is now");
  const fresh = { ...confessing("repair-fresh"), established: [IDENTIFIED] };
  assert.equal(leftBehind(fresh, "on-his-feet"), false, "nothing settled since it was left");
  // A path from before moves were counted can't tell: it doesn't hold anything back.
  assert.equal(leftBehind({ ...state, path: state.path.map(({ known, ...p }) => { void known; return p; }) }, "on-his-feet"), false);
});

test("the co-GM's route back past what's settled isn't open; the scene's own way back is", () => {
  const state = confessing("repair-routes");
  state.patches.push(BACK);
  const scene = effectiveScene(rat, state.patches);
  const here = [...scene.beats.find(b => b.id === "confession")!.transitions, ...(scene.anytime ?? [])];
  const open = openRoutes(here, state).map(t => t.id);
  assert.ok(!open.includes("improv-63-0"), "Hobb going to work can't undo his confession");
  assert.ok(open.includes("hobb-runs"), "the prep's own: his nerve goes and he bolts");
  // Before anything was settled since, the same route would be open.
  assert.ok(openRoutes(here, { ...state, established: [IDENTIFIED] }).some(t => t.id === "improv-63-0"));
});

test("the co-GM's tracker moves: forward, with what put the story there on record; never back past what's settled, nor for a word out of character", () => {
  const forward = confessing("repair-forward");
  forward.beat = "on-his-feet";
  forward.path = forward.path.slice(0, 2);
  forward.established = [IDENTIFIED];
  applyRepair(rat, forward, review({ moveTo: "confession", moveBecause: ADMITTED }));
  assert.equal(forward.beat, "confession");
  assert.deepEqual(forward.established, [IDENTIFIED, ADMITTED], "the confession is a fact from now on");
  assert.deepEqual(forward.path.at(-1), { turn: 62, from: "on-his-feet", to: "confession", via: "repair", source: "repair", known: 1 });

  const back = confessing("repair-back");
  applyRepair(rat, back, review({ moveTo: "on-his-feet" }));
  assert.equal(back.beat, "confession", "not undone");
  assert.match(back.repairs.at(-1)!.assessment, /\[move_to on-his-feet refused: the scene has left it, and something has been settled since\]/);

  const ooc = { ...confessing("repair-ooc"), beat: "big-hobb", path: [], established: [IDENTIFIED], oocTurns: [62] };
  applyRepair(rat, ooc, review({ moveTo: "on-his-feet" }));
  assert.equal(ooc.beat, "big-hobb", "the bell isn't rung for a question to the GM");
  assert.match(ooc.repairs.at(-1)!.assessment, /refused: the turn was out of character/);
});

test("a quick co-GM's late answer and the full review of the same turn both land", () => {
  const state = confessing("repair-files");
  saveSession(state);
  const route = { turn: 62, why: "a real chance", transition: { beat: "*", transition: { id: "quick-62", on: "attempt" as const, when: "The player promises Hobb his mother will be kept safe tonight.", check: { skill: "persuasion" as const, dc: 13, reason: "to talk Kell into hiding Hobb's mother", success: "Kell agrees, for one night.", failure: "Kell won't.", onSuccess: "confession" } } } };
  writeRepair(state, review({ quick: true, assessment: "quick: open_route", patches: [route] }));
  writeRepair(state, review({ notes: "Let Kell grumble and agree to one night." }));
  assert.ok(existsSync(repairFile(state.id, 62, true)) && existsSync(repairFile(state.id, 62)), "a file each");
  const merged = applyPendingRepairs(rat, state);
  assert.deepEqual(merged.map(r => r.quick === true), [true, false], "the quick one first; the full one's notes supersede its");
  assert.ok(state.patches.some(p => p.transition?.transition.id === "quick-62"), "the quick ruling's route is there");
  assert.equal(state.notes, "Let Kell grumble and agree to one night.");
  assert.deepEqual(applyPendingRepairs(rat, state), [], "each merged once");
});

test("in v2-quick, a quick co-GM past its deadline writes its own file, beside the full review's", async () => {
  // As the Rat's T57 was played: the quick co-GM answered 97 ms after its deadline, and the full
  // review of the same turn, writing to the same name, overwrote it.
  const authored = SCENES.find(s => s.id === "hanged-clerk")!;
  const was = authored.approach;
  authored.approach = { ...was, repairDeadlineMs: 20 };
  const quick = { move: "open_route", essential: "none", carrier: "none", target: "doubt", when: "The player promises Cob a hot dinner every day this week if he'll show what's in his boot.", roll_skill: "persuasion", roll_dc: 13, roll_reason: "to talk Cob into it", failure: "Cob won't, and says so.", note: "Give the promise a real chance." };
  const fake = fakeOpenRouter({ choices: { off_graph: "off_graph" }, byName: { quick_fix: quick }, replies: ["Cob eyes you."] });
  const inner = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as { text?: { format?: { name?: string } } } : {};
    if (body.text?.format?.name === "quick_fix") await new Promise(r => setTimeout(r, 150));
    return inner(input, init);
  };
  try {
    const state: SessionState = {
      id: "repair-v2-quick", sceneId: "hanged-clerk", approach: "v2-quick", seed: 5, rollCount: 0,
      player: { name: "Pell Marrow", concept: "a hedge-wizard", modifiers: { persuasion: 2 } },
      turn: 4, beat: "yard", turnsInBeat: 3, path: [], established: [], canon: [], notes: null, notesTurn: null,
      patches: [], repairs: [], transcript: [], metrics: [], history: [],
    };
    await playerTurn(state, "Cob, a hot dinner every day this week if you'll show me what's in that boot.");
    assert.equal(state.lateRepairs, 1, "past its deadline");
    for (let i = 0; i < 40 && !existsSync(repairFile(state.id, 5, true)); i++) await new Promise(r => setTimeout(r, 25));
    assert.ok(existsSync(repairFile(state.id, 5, true)), "repair-005-quick.json");
    writeRepair(state, review({ turn: 5, notes: "The boot is a door, not a wall." }));
    applyPendingRepairs(authored, state);
    assert.ok(state.patches.some(p => p.transition?.transition.id === "quick-5"), "the late ruling lands next turn, whatever the full review wrote");
    assert.equal(state.notes, "The boot is a door, not a wall.");
  } finally {
    globalThis.fetch = inner;
    fake.restore();
    authored.approach = was;
  }
});
