import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCENES, sceneById } from "../../scenes/index.ts";
import { buildWorld, joinWorld, worldView } from "../world/scene-world.ts";
import { effectiveScene, openRoutes, presentCast, sceneBrief } from "./brief.ts";
import { bringOver, carryLines, owedAtEnd, owedKey, owedPrep, owedText, placeOwedThings, placing, trace, type OwedVerdict } from "./owed.ts";
import { validateScene, type Scene } from "./scene.ts";
import type { Owed, SessionState } from "./session.ts";
import { endTalk, startTalk } from "./talk.ts";

/**
 * What the story still owes the player (src/runtime/owed.ts), without model calls: Prout's page,
 * missed at the granary, goes on with the boots on Cob's feet into the Drowned Rat, as the Rat's own
 * prep for it, with its routes; found at the granary, none of it is there; and the boundary's
 * verdict, when there is one, has the last word on whether it was found after all and whether it
 * can come up next.
 */

process.env.KM_RUNS_DIR = mkdtempSync(join(tmpdir(), "km-owed-"));

const clerk = sceneById("hanged-clerk");
const rat = sceneById("drowned-rat");

/** The granary yard as it ends: its world as the spec left it, and what the record says the player came across. */
function granary(landed: string[] = [], hinted: string[] = []): SessionState {
  const state = {
    id: "owed-test", sceneId: clerk.id, approach: "v2", seed: 7, rollCount: 0, turn: 9,
    player: { name: "Wren Ashdown", concept: "a quick-witted investigator", modifiers: {} },
    beat: "doubt", turnsInBeat: 2, path: [], established: [], canon: [], notes: null, notesTurn: null,
    patches: [], repairs: [], transcript: [], metrics: [], history: [], landed, hinted,
  } as SessionState;
  state.world = buildWorld(clerk.id, clerk.world!, presentCast(clerk, state).map(c => ({ id: c.id, name: c.name })), state.player);
  return state;
}

/** Across the boundary into a scene, as chainScene leaves it (its own state fresh, the world not yet built). */
function into(state: SessionState, next: Scene): SessionState {
  delete state.world;
  Object.assign(state, { sceneId: next.id, beat: next.start, turnsInBeat: 0, path: [], established: [], patches: [], landed: [], hinted: [] });
  return state;
}

/** Across the boundary as chainScene crosses it: what's owed, read as the scene ends; the next scene's own state; what's brought over. */
function cross(state: SessionState, from: Scene, next: Scene, verdict?: OwedVerdict[]): Owed[] {
  const owed = owedAtEnd(from, state);
  bringOver(into(state, next), next, owed, verdict);
  return owed;
}

/** The scene's world, built as openScene builds it (with what's owed placed). */
function open(state: SessionState, scene: Scene): void {
  state.world = buildWorld(scene.id, scene.world!, presentCast(scene, state).map(c => ({ id: c.id, name: c.name })), state.player);
  placeOwedThings(state);
}

test("missed at the granary, the page is owed: in the boot, on Cob's feet, and a sign of it stays given", () => {
  const owed = owedAtEnd(clerk, granary([], ["page"]));
  assert.equal(owed.length, 1, "only what the story needs later (the page), not every essential missed");
  const page = owed[0]!;
  assert.equal(owedKey(page), "hanged-clerk:page");
  assert.equal(page.hinted, true);
  assert.deepEqual(page.holders, ["cob"]);
  assert.deepEqual(page.things?.map(t => [t.id, t.parent]), [["boots", "cob"], ["ledger-page", "boots"]], "the boots go with Cob, and the page in them");
  assert.ok(page.things?.every(t => t.at === undefined), "held things are where their holder is");
  assert.match(page.where!, /folded page sewn into the left boot's lining, in Prout's good black boots, with Cob/);
});

test("found at the granary, nothing is owed, and the Rat has none of its prep for it", () => {
  assert.deepEqual(owedAtEnd(clerk, granary(["page"])), []);
  const plain = effectiveScene(rat, []);
  assert.ok(!plain.essentials?.some(e => e.id === "prouts-page"), "the Rat's prep for a missed page isn't the Rat's");
  assert.ok(plain.beats.every(b => b.transitions.every(t => !t.essential)), "and nor are its routes");
  assert.doesNotMatch(sceneBrief(plain, into(granary(["page"]), rat)), /Prout's page, still sewn/);
});

test("across the boundary into the Rat: the page is the Rat's own prep for it, with its ways in, and its sign stays given", () => {
  const state = granary([], ["page"]);
  const owed = owedAtEnd(clerk, state);
  bringOver(into(state, rat), rat, owed, undefined);
  assert.deepEqual(state.owed?.map(owedKey), ["hanged-clerk:page"], "owed until the player comes across it");
  assert.equal(state.patches.length, 1);
  assert.equal(state.patches[0]!.essential?.id, "prouts-page");
  assert.deepEqual(state.hinted, ["prouts-page"]);
  const scene = effectiveScene(rat, state.patches);
  const page = scene.essentials!.find(e => e.id === "prouts-page")!;
  assert.deepEqual(page.carriers, ["cob", "nan-quill"]);
  for (const beat of ["the-rat", "big-hobb", "confession"]) {
    const ids = scene.beats.find(b => b.id === beat)!.transitions.map(t => t.id);
    for (const id of ["bribe-cob", "kind-to-cob", "trust-cob", "coax-cob", "nan-vouches", "page-shown"]) assert.ok(ids.includes(id), `${beat} has ${id}`);
  }
  const route = (id: string) => scene.beats[0]!.transitions.find(t => t.id === id)!;
  const coax = route("coax-cob");
  assert.equal(coax.check?.skill, "persuasion", "a try that could go either way is a roll (a lie rolls Deception: the method decides)");
  assert.match(coax.when, /Paying for a look isn't this/);
  assert.match(coax.check!.failure, /slop hatch[\s\S]*Mrs Q[\s\S]*Hobb looks up/, "failing costs: he bolts, he tells Nan, Hobb looks up");
  // A bribe has a route of its own, so it isn't read as a try: no dice, and the boot stays on.
  const bribe = route("bribe-cob");
  assert.equal(bribe.check, undefined);
  assert.equal(bribe.to, "the-rat");
  assert.match(bribe.when, /the boot stays on[\s\S]*Bought attention isn't trust[\s\S]*not out here/, "refused, but not a dead end");
  // Trust or a promise that answers his fear, out of Hobb's sight (or Nan's word), needs no dice either: the page comes out.
  const trust = route("trust-cob");
  assert.equal(trust.check, undefined);
  assert.equal(trust.given, undefined, "the decider can offer it as something that simply works");
  assert.match(trust.when, /Out of the big cove's sight[\s\S]*his name kept out of it, the big cove put away[\s\S]*the King and not the watch[\s\S]*Nan/);
  assert.match(trust.establishes![0]!, /countersigned 'J\. Sallow, for the Royal Purveyor'/);
  assert.equal(scene.beats[0]!.transitions.find(t => t.id === "page-shown")!.given, true, "the page is Cob's to give");
  // The GM's prep has it, as missed before and already hinted at.
  const brief = sceneBrief(scene, state);
  assert.match(brief, /Prout's page, still sewn into the lining of the left boot on Cob's feet[^\n]*missed in an earlier scene[^\n]*already hinted at/);
});

test("its things go with Cob into the Rat's world, the page still in the boot, when he's there", () => {
  const state = granary();
  const owed = owedAtEnd(clerk, state);
  bringOver(into(state, rat), rat, owed, undefined);
  open(state, rat);
  assert.equal(state.world!.entities.boots?.parent, "cob");
  assert.equal(state.world!.entities["ledger-page"]?.parent, "boots");
  assert.match(worldView(state.world!, { full: true }), /- Cob \[cob\][^\n]*\n\s+- Prout's good black boots \[boots\]\n\s+- a folded page sewn into the left boot's lining \[ledger-page\]/);
  // Not twice.
  assert.deepEqual(placeOwedThings(state), []);
});

test("someone not on stage yet brings what's owed when they come", () => {
  const state = granary();
  const owed = owedAtEnd(clerk, state);
  bringOver(into(state, rat), rat, owed, undefined);
  state.absent = ["cob"];
  open(state, rat);
  assert.equal(state.world!.entities.boots, undefined, "nobody here has the boots");
  state.absent = [];
  joinWorld(state.world!, [{ id: "cob", name: "Cob" }], 3);
  assert.deepEqual(placeOwedThings(state), ["Prout's good black boots"]);
  assert.equal(state.world!.entities["ledger-page"]?.parent, "boots");
});

test("come across in the Rat, its routes go and it's owed no more; carried off unread, it stays owed with the player", () => {
  const state = granary();
  cross(state, clerk, rat);
  open(state, rat);
  const scene = effectiveScene(rat, state.patches);
  const routes = (s: SessionState) => openRoutes(scene.beats[0]!.transitions, s).map(t => t.id);
  assert.ok(routes(state).includes("coax-cob"));
  state.landed = ["prouts-page"];
  assert.ok(!routes(state).some(id => ["bribe-cob", "kind-to-cob", "trust-cob", "coax-cob", "nan-vouches", "page-shown"].includes(id)), "nothing offers what's already out");
  assert.ok(routes(state).includes("win-hobb"), "the rest are as they were");
  assert.deepEqual(owedAtEnd(rat, state), [], "found here: owed no more");
  // Not come across, but the boots are the player's now (taken, the page unread): it's with them.
  state.landed = [];
  state.world!.entities.boots!.parent = "player";
  const still = owedAtEnd(rat, state);
  assert.deepEqual(still.map(o => [owedKey(o), o.holders, o.things]), [["hanged-clerk:page", ["player"], undefined]], "the player carries the boots on anyway");
  assert.match(still[0]!.where!, /the player has it/);
});

test("the boundary's verdict: found after all, it's owed no more; can't come up next, it waits; its own prep or its placing", () => {
  const owed = owedAtEnd(clerk, granary());
  const key = "hanged-clerk:page";
  // Found after all (the record missed it): nothing carried, nothing owed.
  let state = into(granary(), rat);
  bringOver(state, rat, owed, [{ id: key, found: true, here: true, placedWith: [], carriers: [], why: "Cob showed them" }]);
  assert.equal(state.owed, undefined);
  assert.equal(state.patches.length, 0);
  // It can't come up in the Rat tonight (Cob's in the cells): still owed, not the Rat's.
  state = into(granary(), rat);
  bringOver(state, rat, owed, [{ id: key, found: false, here: false, placedWith: [], carriers: [], why: "Cob is in the cells" }]);
  assert.equal(state.owed?.length, 1);
  assert.equal(state.patches.length, 0);
  // A scene with no prep of its own, and nobody there who has it: things stay where they are, whatever the verdict says.
  const afternoon = sceneById("caerwyn-afternoon");
  assert.equal(placing(owed[0]!, afternoon, undefined), undefined, "without the verdict, only where someone who has it will be");
  assert.equal(placing(owed[0]!, afternoon, { id: key, found: false, here: true, placedWith: ["Kell's notebook"], carriers: ["kell"], why: "" }), undefined, "nobody's given what they couldn't have");
  // Where whoever has it will be, the verdict places it, with whoever there could bring it out.
  const withCob: Scene = { ...afternoon, cast: [...afternoon.cast, rat.cast.find(c => c.id === "cob")!] };
  const placed = placing(owed[0]!, withCob, { id: key, found: false, here: true, placedWith: ["the boots on Cob's feet, which crackle"], carriers: ["kell", "cob", "nobody"], why: "" })!;
  assert.deepEqual([placed.id, placed.missed, placed.carriers, placed.placedWith], ["page", key, ["kell", "cob"], ["the boots on Cob's feet, which crackle"]], "carriers from that scene's people only");
  // Without the verdict, it's placed with whoever has it, where it is now.
  assert.deepEqual(placing(owed[0]!, withCob, undefined)?.carriers, ["cob"]);
  assert.match(placing(owed[0]!, withCob, undefined)!.placedWith[0]!, /with Cob/);
  // An id that's taken there gets the scene's name.
  const clash: Scene = { ...withCob, essentials: [{ id: "page", what: "x", placedWith: [], unlocks: "y" }] };
  assert.equal(placing(owed[0]!, clash, { id: key, found: false, here: true, placedWith: [], carriers: [], why: "" })!.id, "hanged-clerk-page");
  // The player took the boots and never looked inside: it comes up wherever they go, where it is,
  // not by the Rat's prep for Cob having it.
  const unread: Owed = { ...owed[0]!, holders: ["player"], where: "a folded page sewn into the left boot's lining, in Prout's good black boots: the player has it" };
  delete unread.things;
  for (const next of [rat, afternoon]) {
    const it = placing(unread, next, { id: key, found: false, here: false, placedWith: [], carriers: [], why: "" })!;
    assert.deepEqual([it.id, it.carriers, it.placedWith], ["page", [], [unread.where]], next.id);
  }
});

test("in the scene harness, the afternoon can't bring it out, so it waits for the Rat", () => {
  const state = granary();
  const afternoon = sceneById("caerwyn-afternoon");
  cross(state, clerk, afternoon);
  assert.equal(state.patches.length, 0);
  // The interlude has no world: the page is still where the granary left it.
  const again = owedAtEnd(afternoon, state);
  assert.deepEqual(again.map(o => o.holders), [["cob"]]);
  bringOver(into(state, rat), rat, again, undefined);
  assert.equal(state.patches[0]!.essential?.id, "prouts-page");
  open(state, rat);
  assert.equal(state.world!.entities["ledger-page"]?.parent, "boots");
});

test("the verdict is told what's owed, where it is now, and each upcoming scene's own prep for it", () => {
  const owed = owedAtEnd(clerk, granary([], ["page"]));
  const text = owedText(owed);
  assert.match(text, /\[hanged-clerk:page\] Prout found grain/);
  assert.match(text, /Needed later: the King's morning needs proof he can hold/);
  assert.match(text, /Where it is now: a folded page sewn into the left boot's lining, in Prout's good black boots, with Cob\./);
  assert.match(text, /had a sign of it already/);
  assert.match(owedPrep(rat, owed)!, /\[hanged-clerk:page\] placed with: the left boot on Cob's feet/);
  assert.equal(owedPrep(sceneById("heron-warehouse"), owed), undefined);
  assert.match(carryLines(owed, rat, undefined)[0]!, /still owed, and it comes up in The Drowned Rat/);
  assert.match(carryLines(owed, sceneById("caerwyn-afternoon"), undefined)[0]!, /can't come up in Caerwyn, the afternoon; it waits/);
});

test("where things are, as a world leaves them", () => {
  const world = granary().world!;
  assert.equal(trace(world, ["nothing-here"]), undefined, "not in this world: where it was");
  world.entities["ledger-page"]!.parent = "yard";
  assert.match(trace(world, ["ledger-page"])!.where, /left in the yard, The yard behind the King's Granary/);
  assert.deepEqual(trace(world, ["ledger-page"])!.things, []);
  world.entities["ledger-page"]!.states.push("destroyed");
  assert.match(trace(world, ["ledger-page"])!.where, /destroyed/);
});

test("a talk between scenes keeps what's owed (it's the story's), and the scene's own prep for it comes back after", () => {
  const state = granary();
  cross(state, clerk, rat);
  startTalk(state, "kell", "the river stairs, dusk");
  assert.equal(state.owed?.length, 1, "what the story owes isn't the talk's to set aside");
  assert.equal(state.patches.length, 0);
  state.ended = { exitId: "goodbye", turn: state.turn, operations: [], warnings: [] };
  endTalk(state);
  assert.equal(state.owed?.length, 1);
  assert.equal(state.patches[0]!.essential?.id, "prouts-page");
});

test("every scene validates, and every scene's prep for a missed essential stands for one the story carries", () => {
  for (const scene of SCENES) assert.deepEqual(validateScene(scene), [], scene.id);
  for (const scene of SCENES) {
    for (const e of scene.essentials ?? []) {
      if (!e.missed) continue;
      const [from, id] = e.missed.split(":");
      const original = sceneById(from!).essentials?.find(x => x.id === id);
      assert.ok(original, `${scene.id}'s ${e.id} stands for ${e.missed}, which exists`);
      assert.ok(original!.later, `${e.missed} is one the story needs later, so it's carried`);
    }
  }
});

test("an owed essential's record survives the session's save as JSON", () => {
  const owed: Owed[] = JSON.parse(JSON.stringify(owedAtEnd(clerk, granary())));
  const state = into(granary(), rat);
  bringOver(state, rat, owed, undefined);
  open(state, rat);
  assert.equal(state.world!.entities["ledger-page"]?.parent, "boots");
});
